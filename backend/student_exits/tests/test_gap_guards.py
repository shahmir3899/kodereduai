"""The attendance/fee/exam guards leave a re-admitted student's time away empty.

A re-admitted student's enrollment is active again, so only their EnrollmentBreak
rows say which days and months they were not enrolled.
"""
from datetime import date

import pytest

from academic_sessions.leaving import enrolled_on_q, left_by, left_message, returns_after
from academic_sessions.models import StudentEnrollment
from academic_sessions.roster import filter_students_in_scope
from academic_sessions.utils import enrollment_covers_month
from attendance.models import AttendanceRecord
from face_attendance.services.attendance_writer import upsert_attendance_record
from student_exits.models import EnrollmentBreak
from students.models import Student

BREAK_START = date(2026, 1, 10)
BREAK_END = date(2026, 2, 10)  # first day back


@pytest.fixture
def ctx(seed_data):
    """Student 0 is back (enrollment active) after being away 10 Jan to 10 Feb 2026."""
    student, other = seed_data['students'][0], seed_data['students'][1]
    enrollments = {}
    for s in (student, other):
        enrollments[s.id] = StudentEnrollment.objects.create(
            school=seed_data['school_a'], student=s, academic_year=seed_data['academic_year'],
            class_obj=s.class_obj, roll_number=s.roll_number, status='ACTIVE',
        )
    EnrollmentBreak.objects.create(
        school=seed_data['school_a'], student=student, start_date=BREAK_START, end_date=BREAK_END,
    )
    return {**seed_data, 'student': student, 'other': other, 'enrollments': enrollments}


def add_break(ctx, start, end=None, student=None):
    return EnrollmentBreak.objects.create(
        school=ctx['school_a'], student=student or ctx['student'], start_date=start, end_date=end,
    )


def months_covered(ctx, shape):
    """{(year, month)} in which the student is counted, using one of the three query
    shapes enrollment_covers_month is applied to across the code base."""
    student = ctx['student']
    covered = set()
    for year, month in [(2025, 12), (2026, 1), (2026, 2), (2026, 3), (2026, 4), (2026, 5)]:
        if shape == 'enrollment':
            hit = StudentEnrollment.objects.filter(student=student).filter(enrollment_covers_month(year, month)).exists()
        elif shape == 'student':
            hit = Student.objects.filter(pk=student.pk).filter(
                enrollment_covers_month(year, month, prefix='enrollments')).exists()
        else:
            AttendanceRecord.objects.get_or_create(
                student=student, date=date(2026, 6, 1),
                defaults={'school': ctx['school_a'], 'academic_year': ctx['academic_year'], 'status': 'PRESENT'},
            )
            hit = AttendanceRecord.objects.filter(student=student).filter(
                enrollment_covers_month(year, month, prefix='student__enrollments')).exists()
        if hit:
            covered.add((year, month))
    return covered


# ── month guard ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize('shape', ['enrollment', 'student', 'attendance_record'])
class TestMonthGuard:
    def test_a_month_fully_inside_the_break_is_left_out_and_partial_months_stay(self, ctx, shape):
        # Away 10 Jan to 10 Feb: January and February are each only partly away.
        assert months_covered(ctx, shape) == {(2025, 12), (2026, 1), (2026, 2), (2026, 3), (2026, 4), (2026, 5)}

    def test_every_month_the_break_spans_completely_is_excluded(self, ctx, shape):
        EnrollmentBreak.objects.filter(student=ctx['student']).delete()
        add_break(ctx, date(2026, 1, 1), date(2026, 4, 1))  # Jan, Feb, Mar entirely away
        assert months_covered(ctx, shape) == {(2025, 12), (2026, 4), (2026, 5)}

    def test_the_return_month_counts_even_when_they_return_late_in_it(self, ctx, shape):
        EnrollmentBreak.objects.filter(student=ctx['student']).delete()
        add_break(ctx, date(2026, 1, 1), date(2026, 4, 28))
        assert (2026, 4) in months_covered(ctx, shape)
        assert (2026, 3) not in months_covered(ctx, shape)

    def test_an_open_break_excludes_everything_from_its_first_full_month(self, ctx, shape):
        EnrollmentBreak.objects.filter(student=ctx['student']).delete()
        add_break(ctx, date(2026, 2, 1))
        assert months_covered(ctx, shape) == {(2025, 12), (2026, 1)}

    def test_several_breaks_each_apply(self, ctx, shape):
        EnrollmentBreak.objects.filter(student=ctx['student']).delete()
        add_break(ctx, date(2026, 1, 1), date(2026, 2, 1))
        add_break(ctx, date(2026, 4, 1), date(2026, 5, 1))
        assert months_covered(ctx, shape) == {(2025, 12), (2026, 2), (2026, 3), (2026, 5)}

    def test_another_students_break_does_not_matter(self, ctx, shape):
        EnrollmentBreak.objects.filter(student=ctx['student']).delete()
        add_break(ctx, date(2025, 1, 1), student=ctx['other'])
        assert months_covered(ctx, shape) == {(2025, 12), (2026, 1), (2026, 2), (2026, 3), (2026, 4), (2026, 5)}


class TestMonthGuardStillHonoursLeaving:
    def test_a_student_who_is_still_out_is_cut_off_after_the_leaving_month(self, ctx):
        enrollment = ctx['enrollments'][ctx['student'].id]
        enrollment.is_active = False
        enrollment.status = 'WITHDRAWN'
        enrollment.left_date = date(2026, 3, 15)
        enrollment.save()
        EnrollmentBreak.objects.filter(student=ctx['student']).delete()
        add_break(ctx, date(2026, 3, 15))
        covered = months_covered(ctx, 'enrollment')
        assert (2026, 3) in covered       # left mid-March: March still counts
        assert (2026, 4) not in covered


# ── day guard ────────────────────────────────────────────────────────────────

class TestDayGuard:
    @pytest.mark.parametrize('day, expected', [
        (date(2026, 1, 9), True), (date(2026, 1, 10), False), (date(2026, 2, 9), False),
        (date(2026, 2, 10), True), (date(2026, 3, 1), True),
    ])
    def test_enrolled_on_a_day_means_not_inside_the_break(self, ctx, day, expected):
        qs = StudentEnrollment.objects.filter(student=ctx['student']).filter(enrolled_on_q(day))
        assert qs.exists() is expected

    def test_the_other_student_is_enrolled_on_every_day(self, ctx):
        qs = StudentEnrollment.objects.filter(student=ctx['other']).filter(enrolled_on_q(date(2026, 1, 20)))
        assert qs.exists()

    def test_left_by_reports_a_student_inside_a_break_with_the_day_it_started(self, ctx):
        ids = [ctx['student'].id, ctx['other'].id]
        assert left_by(ctx['SID_A'], ids, date(2026, 1, 20)) == {ctx['student'].id: BREAK_START}
        assert left_by(ctx['SID_A'], ids, date(2026, 1, 9)) == {}
        assert left_by(ctx['SID_A'], ids, BREAK_END) == {}

    def test_returns_after_gives_the_first_day_back_for_closed_breaks_only(self, ctx):
        ids = [ctx['student'].id]
        assert returns_after(ctx['SID_A'], ids, date(2026, 1, 20)) == {ctx['student'].id: BREAK_END}
        EnrollmentBreak.objects.filter(student=ctx['student']).delete()
        add_break(ctx, date(2026, 1, 1))
        assert returns_after(ctx['SID_A'], ids, date(2026, 1, 20)) == {}

    def test_the_refusal_says_when_they_come_back(self):
        message = left_message('Ali', BREAK_START, back_on=BREAK_END)
        assert message == "Ali was away from 10 Jan 2026 until 10 Feb 2026; attendance can't be recorded for that period."
        assert 'left the school on 10 Jan 2026' in left_message('Ali', BREAK_START)


# ── writers ──────────────────────────────────────────────────────────────────

class TestWriters:
    def bulk(self, api, ctx, day, student=None):
        s = student or ctx['student']
        return api.post('/api/attendance/records/bulk_entry/', {
            'class_id': s.class_obj_id, 'date': day.isoformat(),
            'entries': [{'student_id': s.id, 'status': 'PRESENT'}],
        }, ctx['tokens']['admin'], ctx['SID_A'])

    def test_manual_entry_is_refused_on_a_day_inside_the_break(self, api, ctx):
        resp = self.bulk(api, ctx, date(2026, 1, 20))
        assert resp.status_code == 200, resp.content
        body = resp.json()
        assert body['created'] == 0
        assert 'was away from 10 Jan 2026 until 10 Feb 2026' in body['errors'][0]['error']
        assert not AttendanceRecord.objects.filter(student=ctx['student'], date=date(2026, 1, 20)).exists()

    def test_manual_entry_works_before_the_break_and_after_the_return(self, api, ctx):
        for day in (date(2026, 1, 6), date(2026, 2, 11)):
            body = self.bulk(api, ctx, day).json()
            assert body['created'] == 1, (day, body)
            assert body['errors'] == []

    def test_manual_entry_for_a_student_who_never_left_is_unaffected(self, api, ctx):
        assert self.bulk(api, ctx, date(2026, 1, 20), student=ctx['other']).json()['created'] == 1

    def test_the_face_writer_refuses_a_day_inside_the_break_and_accepts_others(self, ctx):
        kwargs = dict(student=ctx['student'], school=ctx['school_a'], academic_year=ctx['academic_year'],
                      attendance_status='PRESENT', source='FACE', face_session=None)
        assert upsert_attendance_record(date=date(2026, 1, 20), **kwargs) == (None, False)
        record, created = upsert_attendance_record(date=date(2026, 2, 12), **kwargs)
        assert created and record.date == date(2026, 2, 12)


# ── fees and exams roster ────────────────────────────────────────────────────

class TestRoster:
    def billed(self, ctx, year, month):
        qs = filter_students_in_scope(
            Student.objects.filter(school_id=ctx['SID_A']), ctx['SID_A'],
            academic_year_id=ctx['academic_year'].id, class_obj_id=ctx['student'].class_obj_id,
            year=year, month=month,
        )
        return set(qs.values_list('id', flat=True))

    def test_monthly_fee_roster_skips_months_fully_away_and_bills_the_return_month(self, ctx):
        EnrollmentBreak.objects.filter(student=ctx['student']).delete()
        add_break(ctx, date(2026, 1, 1), date(2026, 3, 20))  # Jan and Feb entirely away
        sid, other = ctx['student'].id, ctx['other'].id
        assert self.billed(ctx, 2025, 12) >= {sid, other}
        assert sid not in self.billed(ctx, 2026, 1)
        assert sid not in self.billed(ctx, 2026, 2)
        assert other in self.billed(ctx, 2026, 2)
        assert sid in self.billed(ctx, 2026, 3)  # back on 20 March: March is billed
        assert sid in self.billed(ctx, 2026, 4)
