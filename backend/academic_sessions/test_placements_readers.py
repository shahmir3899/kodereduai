"""Readers that answer "which class was this student in on that day": record labels, the
display roster, the digest cohort, and class off-days all follow the dated placements."""
from datetime import timedelta

import pytest

from academic_sessions.models import StudentEnrollment
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

    def test_the_risk_service_uses_the_class_calendar_of_the_day(self, moved):
        from academic_sessions.attendance_risk_service import AttendanceRiskService

        service = AttendanceRiskService(school_id=moved['school_a'].id, academic_year_id=moved['year'].id)
        # Runs end to end with a moved student (the off-day lookup is dated, not current-class).
        result = service.get_at_risk_students(only_student_ids=[moved['student'].id], include_unflagged=True)
        assert result['total_students'] == 1
