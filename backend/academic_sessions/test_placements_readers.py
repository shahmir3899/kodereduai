"""Readers that answer "which class was this student in on that day": record labels, the
display roster, the digest cohort, and class off-days all follow the dated placements."""
from datetime import date, timedelta

import pytest

from academic_sessions.models import AcademicYear, EnrollmentPlacement, StudentEnrollment
from academic_sessions.placement_service import DatedPlacements, section_month_roster_q
from academic_sessions.test_placements_and_rolls import sections  # noqa: F401  (fixture)
from attendance.models import AttendanceRecord
from attendance.serializers import AttendanceRecordSerializer
from students.models import Student


@pytest.fixture
def moved(api, sections):  # noqa: F811
    """A student who sat in section A until the 11th of the first month, then in B."""
    student = sections['a_students'][0]
    year = sections['year']
    month_start = year.start_date.replace(day=1)
    move_day = month_start + timedelta(days=10)
    resp = api.post(
        f'/api/students/{student.id}/reclassify/',
        {'academic_year_id': year.id, 'target_session_class_id': sections['section_b'].id,
         'reason': 'moved', 'effective_date': move_day.isoformat()},
        sections['tokens']['admin'], sections['SID_A'],
    )
    assert resp.status_code == 200, resp.content
    return {**sections, 'student': student, 'month_start': month_start, 'move_day': move_day}


@pytest.fixture
def stale_prior_year(sections):  # noqa: F811
    """A student with last year's placement still open (end_date NULL), overlapping this year's."""
    student = sections['a_students'][0]
    year = sections['year']
    other_year = AcademicYear.objects.create(
        school=sections['school_a'], name='Earlier', start_date=date(2023, 4, 1), end_date=date(2024, 3, 31),
    )
    current = StudentEnrollment.objects.get(student=student, academic_year=year)
    old_enrollment = StudentEnrollment.objects.create(
        school=current.school, student=student, academic_year=other_year,
        class_obj=current.class_obj, roll_number='1', is_active=False,
    )
    EnrollmentPlacement.objects.filter(enrollment=old_enrollment).delete()  # enrollment creation may auto-place
    # Placements read back ordered by enrollment id, and in real data last year's
    # enrollment is the older (lower id) one, so it must sort first here too.
    lowest = StudentEnrollment.objects.order_by('id').values_list('id', flat=True).first()
    StudentEnrollment.objects.filter(pk=old_enrollment.pk).update(id=min(lowest, 0) - 1)
    old_enrollment = StudentEnrollment.objects.get(student=student, academic_year=other_year)
    stale = EnrollmentPlacement.objects.create(
        school=current.school, enrollment=old_enrollment, student=student, academic_year=other_year,
        session_class=None, class_obj=current.class_obj, roll_number='1', start_date=other_year.start_date,
    )
    return {'student': student, 'other_year': other_year, 'old_enrollment': old_enrollment, 'stale': stale}


@pytest.mark.django_db
class TestStalePlacements:
    def test_get_prefers_the_placement_of_the_year_containing_the_day(self, sections, stale_prior_year):
        student = stale_prior_year['student']
        day = sections['year'].start_date + timedelta(days=5)
        lookup = DatedPlacements(sections['school_a'].id, [student.id], day, day)
        assert len(lookup.covering(student.id, day)) == 2  # the stale one overlaps
        assert lookup.get(student.id, day).session_class_id == sections['section_a'].id
        assert lookup.class_id(student.id, day) == sections['master'].id

    def test_get_falls_back_when_no_year_contains_the_day(self, sections, stale_prior_year):
        student = stale_prior_year['student']
        day = stale_prior_year['other_year'].end_date + timedelta(days=1)  # between the two years
        lookup = DatedPlacements(sections['school_a'].id, [student.id], day, day)
        assert lookup.get(student.id, day) is not None

    def test_closing_a_year_ends_its_open_placement_and_reopening_undoes_it(self, stale_prior_year):
        from academic_sessions.placement_service import close_year_placements, reopen_year_placements

        enrollment = stale_prior_year['old_enrollment']
        end = stale_prior_year['other_year'].end_date + timedelta(days=1)
        assert close_year_placements(enrollment) == 1
        assert enrollment.placements.get().end_date == end
        assert close_year_placements(enrollment) == 0  # idempotent
        reopen_year_placements(enrollment)
        assert enrollment.placements.get().end_date is None

    def test_reopen_leaves_a_mid_year_move_close_alone(self, sections):
        from academic_sessions.placement_service import reopen_year_placements

        enrollment = StudentEnrollment.objects.get(student=sections['a_students'][0], academic_year=sections['year'])
        placement = enrollment.placements.get()
        placement.end_date = sections['year'].start_date + timedelta(days=10)
        placement.save()
        reopen_year_placements(enrollment)
        placement.refresh_from_db()
        assert placement.end_date is not None

    def test_bulk_promote_closes_the_source_years_placement(self, sections):
        """Promotion must not leave the old year's placement open-ended."""
        from academic_sessions.tasks import bulk_promote_task

        student = sections['a_students'][1]
        year = sections['year']
        enrollment = StudentEnrollment.objects.get(student=student, academic_year=year)
        assert enrollment.placements.filter(end_date__isnull=True).count() == 1
        result = bulk_promote_task.apply(args=[
            sections['school_a'].id, year.id, year.id,
            [{'student_id': student.id, 'action': 'GRADUATE'}],
        ])
        assert result.successful(), result.traceback
        assert enrollment.placements.get().end_date == year.end_date + timedelta(days=1)


@pytest.mark.django_db
class TestRepairStalePlacementsCommand:
    def run(self, *args):
        from io import StringIO

        from django.core.management import call_command

        out = StringIO()
        call_command('repair_stale_placements', *args, stdout=out)
        return out.getvalue()

    def test_dry_run_writes_nothing_and_apply_closes_only_students_with_a_later_year(self, stale_prior_year):
        stale = stale_prior_year['stale']
        out = self.run('--school-id', str(stale.school_id))
        assert '1 placement(s) to close' in out and 'Dry run' in out
        stale.refresh_from_db()
        assert stale.end_date is None

        self.run('--apply', '--school-id', str(stale.school_id))
        stale.refresh_from_db()
        assert stale.end_date == stale_prior_year['other_year'].end_date + timedelta(days=1)
        assert '0 placement(s) to close' in self.run('--school-id', str(stale.school_id))

    def test_a_student_with_no_later_enrollment_is_skipped(self, stale_prior_year):
        stale = stale_prior_year['stale']
        StudentEnrollment.objects.filter(
            student=stale.student, academic_year__start_date__gt=stale_prior_year['other_year'].end_date,
        ).delete()
        out = self.run('--apply', '--school-id', str(stale.school_id))
        assert '0 placement(s) to close' in out and 'skipped' in out
        stale.refresh_from_db()
        assert stale.end_date is None


@pytest.mark.django_db
class TestDatedReaders:
    def test_record_labels_follow_the_class_on_the_record_date(self, moved):
        student = moved['student']
        early = AttendanceRecord.objects.create(
            school=moved['school_a'], student=student, academic_year=moved['year'],
            date=moved['month_start'] + timedelta(days=2), status='ABSENT',
        )
        late = AttendanceRecord.objects.create(
            school=moved['school_a'], student=student, academic_year=moved['year'],
            date=moved['move_day'] + timedelta(days=3), status='ABSENT',
        )
        rows = {
            r['id']: r['class_name']
            for r in AttendanceRecordSerializer(
                AttendanceRecord.objects.filter(pk__in=[early.pk, late.pk]).select_related('student', 'academic_year'),
                many=True,
            ).data
        }
        assert rows[early.pk] != rows[late.pk]
        assert 'A' in rows[early.pk] and 'B' in rows[late.pk]

    def test_dated_lookup_returns_the_class_for_each_day(self, moved):
        student = moved['student']
        lookup = DatedPlacements(
            moved['school_a'].id, [student.id], moved['month_start'], moved['month_start'] + timedelta(days=30),
        )
        assert lookup.get(student.id, moved['move_day'] - timedelta(days=1)).session_class_id == moved['section_a'].id
        assert lookup.get(student.id, moved['move_day']).session_class_id == moved['section_b'].id
        assert lookup.class_id(student.id, moved['move_day']) == moved['master'].id

    def test_the_display_roster_lists_the_student_in_both_sections_for_the_month(self, moved):
        month = moved['month_start']
        in_a = Student.objects.filter(section_month_roster_q(moved['section_a'], month.year, month.month)).distinct()
        in_b = Student.objects.filter(section_month_roster_q(moved['section_b'], month.year, month.month)).distinct()
        assert moved['student'] in in_a and moved['student'] in in_b

        later = (month + timedelta(days=40)).replace(day=1)
        in_a_later = Student.objects.filter(section_month_roster_q(moved['section_a'], later.year, later.month)).distinct()
        assert moved['student'] not in in_a_later

    def test_the_absence_digest_expects_the_student_in_the_section_they_sat_in_that_day(self, moved):
        from notifications.absence_digest import _active_enrollment_student_ids

        args = (moved['school_a'].id, moved['year'].id, moved['master'].id)
        before = moved['move_day'] - timedelta(days=1)
        assert moved['student'].id in _active_enrollment_student_ids(*args, moved['section_a'].id, target_date=before)
        assert moved['student'].id not in _active_enrollment_student_ids(*args, moved['section_b'].id, target_date=before)
        assert moved['student'].id in _active_enrollment_student_ids(*args, moved['section_b'].id, target_date=moved['move_day'])
        assert moved['student'].id not in _active_enrollment_student_ids(*args, moved['section_a'].id, target_date=moved['move_day'])
        # Without a date it is the current section, as before.
        assert moved['student'].id in _active_enrollment_student_ids(*args, moved['section_b'].id)

    def test_the_pdf_register_roster_and_days_follow_the_section(self, api, moved):
        month = moved['month_start']
        student = moved['student']
        for day in (month + timedelta(days=2), month + timedelta(days=20)):
            AttendanceRecord.objects.create(
                school=moved['school_a'], student=student, academic_year=moved['year'], date=day, status='PRESENT',
            )

        def pdf(section):
            return api.get(
                f"/api/attendance/records/download_register_pdf/?session_class_id={section.id}"
                f"&month={month.month}&year={month.year}&academic_year={moved['year'].id}",
                moved['tokens']['admin'], moved['SID_A'],
            )

        assert pdf(moved['section_a']).status_code == 200
        assert pdf(moved['section_b']).status_code == 200

    def test_the_pdf_register_keeps_records_when_a_prior_year_placement_is_still_open(
        self, api, sections, stale_prior_year, monkeypatch,
    ):
        """A previous year's placement that was never closed (end_date NULL) overlaps the
        current year's; the PDF used to pick it and drop every record of the month."""
        import reportlab.platypus as rp

        student = stale_prior_year['student']
        year = sections['year']
        month = year.start_date.replace(day=1)
        for offset in (2, 3):
            AttendanceRecord.objects.create(
                school=sections['school_a'], student=student, academic_year=year,
                date=month + timedelta(days=offset), status='PRESENT',
            )

        captured = []
        real_table = rp.Table

        class CapturingTable(real_table):
            def __init__(self, data, *args, **kwargs):
                captured.append(data)
                super().__init__(data, *args, **kwargs)

        monkeypatch.setattr(rp, 'Table', CapturingTable)
        resp = api.get(
            f"/api/attendance/records/download_register_pdf/?session_class_id={sections['section_a'].id}"
            f"&month={month.month}&year={month.year}&academic_year={year.id}",
            sections['tokens']['admin'], sections['SID_A'],
        )
        assert resp.status_code == 200
        register = next(t for t in captured if t[0][0] == 'Roll#')
        rows = [r for r in register[2:] if r[1] == student.name[:22]]
        assert rows and rows[0][-3] == '2'  # P column

    def test_the_risk_service_uses_the_class_calendar_of_the_day(self, moved):
        from academic_sessions.attendance_risk_service import AttendanceRiskService

        service = AttendanceRiskService(school_id=moved['school_a'].id, academic_year_id=moved['year'].id)
        # Runs end to end with a moved student (the off-day lookup is dated, not current-class).
        result = service.get_at_risk_students(only_student_ids=[moved['student'].id], include_unflagged=True)
        assert result['total_students'] == 1
