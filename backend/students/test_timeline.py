"""The student timeline: one history across a branch transfer, read live (nothing copied).

    old record at Branch Alpha  ->  ends 2026-03-01 (exclusive)
    new record at Branch Beta   ->  starts 2026-03-01 (inclusive)
"""
from datetime import date
from decimal import Decimal

import pytest

from academics.models import Subject
from attendance.models import AttendanceRecord
from examinations.models import Exam, ExamSubject, ExamType, StudentMark
from finance.models import FeePayment, MonthlyFeeCategory
from schools.models import Organization, School
from student_exits.models import StudentExit
from student_exits.tests.transfer_helpers import destination_placement
from students import timeline
from students.models import Student

LEAVING = date(2026, 3, 1)


# ── helpers ──────────────────────────────────────────────────────────────────

def link(ctx, old, school, *, leaving=LEAVING, roll='7', status=StudentExit.Status.FINALIZED,
         exit_type=StudentExit.ExitType.TRANSFERRED, class_obj=None):
    """A new record at ``school`` created from ``old`` by a transfer on ``leaving``."""
    new = Student.objects.create(
        school=school, class_obj=class_obj or ctx['place']['master'], roll_number=roll,
        name=old.name, transferred_from=old,
    )
    StudentExit.objects.create(
        school=old.school, student=old, exit_type=exit_type, status=status, leaving_date=leaving,
        destination_school=school if exit_type == StudentExit.ExitType.TRANSFERRED else None,
        destination_student=new,
    )
    return new


@pytest.fixture
def ctx(seed_data):
    place = destination_placement(seed_data)
    return {**seed_data, 'place': place, 'old': seed_data['students'][0]}


def attendance(ctx, student, school, year, day, status='PRESENT'):
    return AttendanceRecord.objects.create(school=school, academic_year=year, student=student, date=day, status=status)


# ── Chain resolution ─────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestChain:
    def test_a_student_who_never_transferred_has_one_segment_and_costs_no_queries(self, ctx, django_assert_num_queries):
        old = Student.objects.get(pk=ctx['old'].pk)          # nothing pre-loaded: even the school is not fetched
        with django_assert_num_queries(0):
            segments = timeline.student_timeline(old)
        assert len(segments) == 1 and segments[0].is_current
        assert (segments[0].student_id, segments[0].school_id, segments[0].start, segments[0].end) == (
            old.id, old.school_id, None, None)
        assert not timeline.has_history(old)

    def test_a_transferred_student_has_the_old_branch_then_the_new_one(self, ctx):
        new = link(ctx, ctx['old'], ctx['school_b'])
        old_seg, new_seg = timeline.student_timeline(new)
        assert (old_seg.student_id, old_seg.school_id, old_seg.start, old_seg.end, old_seg.is_current) == (
            ctx['old'].id, ctx['school_a'].id, None, LEAVING, False)
        assert (new_seg.student_id, new_seg.school_id, new_seg.start, new_seg.end, new_seg.is_current) == (
            new.id, ctx['school_b'].id, LEAVING, None, True)
        assert old_seg.school_name == ctx['school_a'].name

    def test_the_old_record_never_sees_the_new_branch(self, ctx):
        link(ctx, ctx['old'], ctx['school_b'])
        segments = timeline.student_timeline(ctx['old'])
        assert [s.student_id for s in segments] == [ctx['old'].id]

    def test_a_chain_of_transfers_is_followed_through_every_branch(self, ctx):
        third = School.objects.create(organization=ctx['org'], name='PYTEST_Gamma', subdomain='pytest-gamma')
        from students.models import Class
        gamma_class = Class.objects.create(school=third, name='PYTEST_Gamma_1', grade_level=1)
        second = link(ctx, ctx['old'], ctx['school_b'], leaving=date(2026, 3, 1))
        last = link(ctx, second, third, leaving=date(2026, 6, 1), roll='3', class_obj=gamma_class)
        segments = timeline.student_timeline(last)
        assert [(s.school_id, s.start, s.end) for s in segments] == [
            (ctx['school_a'].id, None, date(2026, 3, 1)),
            (ctx['school_b'].id, date(2026, 3, 1), date(2026, 6, 1)),
            (third.id, date(2026, 6, 1), None),
        ]
        assert [s.is_current for s in segments] == [False, False, True]

    def test_a_transfer_back_to_the_first_branch_is_three_separate_segments(self, ctx):
        second = link(ctx, ctx['old'], ctx['school_b'], leaving=date(2026, 3, 1))
        back = link(ctx, second, ctx['school_a'], leaving=date(2026, 6, 1), roll='9',
                    class_obj=ctx['old'].class_obj)
        segments = timeline.student_timeline(back)
        assert [s.school_id for s in segments] == [ctx['school_a'].id, ctx['school_b'].id, ctx['school_a'].id]
        assert len({s.student_id for s in segments}) == 3

    def test_the_result_is_cached_on_the_instance(self, ctx, django_assert_num_queries):
        new = link(ctx, ctx['old'], ctx['school_b'])
        new = Student.objects.select_related('school').get(pk=new.pk)
        first = timeline.student_timeline(new)
        with django_assert_num_queries(0):
            assert timeline.student_timeline(new) is first


@pytest.mark.django_db
class TestLinksThatAreIgnored:
    def test_an_unfinished_transfer_is_ignored(self, ctx):
        new = link(ctx, ctx['old'], ctx['school_b'], status=StudentExit.Status.OPEN)
        assert len(timeline.student_timeline(new)) == 1

    def test_a_cancelled_transfer_is_ignored(self, ctx):
        new = link(ctx, ctx['old'], ctx['school_b'], status=StudentExit.Status.CANCELLED)
        assert len(timeline.student_timeline(new)) == 1

    def test_a_withdrawal_is_not_a_transfer(self, ctx):
        new = link(ctx, ctx['old'], ctx['school_b'], exit_type=StudentExit.ExitType.WITHDRAWN)
        assert len(timeline.student_timeline(new)) == 1

    def test_a_link_with_no_exit_behind_it_is_ignored(self, ctx):
        new = Student.objects.create(
            school=ctx['school_b'], class_obj=ctx['place']['master'], roll_number='5', name='X',
            transferred_from=ctx['old'],
        )
        assert len(timeline.student_timeline(new)) == 1

    def test_an_exit_that_does_not_connect_these_two_records_is_ignored(self, ctx):
        new = link(ctx, ctx['old'], ctx['school_b'])
        other = ctx['students'][1]
        new.transferred_from = other           # the pointer disagrees with the exit
        new.save()
        assert len(timeline.student_timeline(Student.objects.get(pk=new.pk))) == 1

    def test_a_branch_of_another_organization_is_ignored(self, ctx):
        outside = School.objects.create(
            organization=Organization.objects.create(name='PYTEST_Out', slug='pytest-out'),
            name='PYTEST_Outside', subdomain='pytest-outside',
        )
        from students.models import Class
        out_class = Class.objects.create(school=outside, name='PYTEST_Out_1', grade_level=1)
        new = link(ctx, ctx['old'], outside, class_obj=out_class)
        assert len(timeline.student_timeline(new)) == 1

    def test_a_loop_in_the_links_terminates(self, ctx):
        a = ctx['old']
        b = link(ctx, a, ctx['school_b'])
        StudentExit.objects.create(
            school=ctx['school_b'], student=b, exit_type='TRANSFERRED', status='FINALIZED',
            leaving_date=date(2026, 5, 1), destination_school=ctx['school_a'], destination_student=a,
        )
        a.transferred_from = b
        a.save()
        segments = timeline.student_timeline(Student.objects.get(pk=b.pk))
        assert len(segments) <= timeline.MAX_HOPS and len({s.student_id for s in segments}) == len(segments)


# ── Filters: each branch's own rows, inside its own dates ────────────────────

@pytest.mark.django_db
class TestAttendanceFilter:
    def test_only_the_days_inside_each_segment_are_read(self, ctx):
        old, new = ctx['old'], link(ctx, ctx['old'], ctx['school_b'])
        year_a, year_b = ctx['academic_year'], ctx['place']['year']
        keep_old = attendance(ctx, old, ctx['school_a'], year_a, date(2026, 2, 27))
        attendance(ctx, old, ctx['school_a'], year_a, date(2026, 3, 1))     # the leaving day is the new branch's
        attendance(ctx, old, ctx['school_a'], year_a, date(2026, 3, 2))     # recorded after leaving: never shown
        keep_new_1 = attendance(ctx, new, ctx['school_b'], year_b, date(2026, 3, 1))
        keep_new_2 = attendance(ctx, new, ctx['school_b'], year_b, date(2026, 3, 3))

        rows = AttendanceRecord.objects.filter(timeline.attendance_q(timeline.student_timeline(new)))
        assert set(rows.values_list('id', flat=True)) == {keep_old.id, keep_new_1.id, keep_new_2.id}

    def test_no_day_is_counted_by_two_branches(self, ctx):
        old, new = ctx['old'], link(ctx, ctx['old'], ctx['school_b'])
        attendance(ctx, old, ctx['school_a'], ctx['academic_year'], date(2026, 3, 1))
        attendance(ctx, new, ctx['school_b'], ctx['place']['year'], date(2026, 3, 1))
        rows = AttendanceRecord.objects.filter(timeline.attendance_q(timeline.student_timeline(new)))
        assert rows.filter(date=date(2026, 3, 1)).count() == 1

    def test_other_students_rows_are_never_included(self, ctx):
        old, new = ctx['old'], link(ctx, ctx['old'], ctx['school_b'])
        stranger = ctx['students'][1]
        attendance(ctx, stranger, ctx['school_a'], ctx['academic_year'], date(2026, 2, 27))
        rows = AttendanceRecord.objects.filter(timeline.attendance_q(timeline.student_timeline(new)))
        assert not rows.filter(student=stranger).exists()

    def test_a_student_with_no_history_reads_only_their_own_rows(self, ctx):
        old = ctx['old']
        mine = attendance(ctx, old, ctx['school_a'], ctx['academic_year'], date(2026, 2, 27))
        attendance(ctx, ctx['students'][1], ctx['school_a'], ctx['academic_year'], date(2026, 2, 27))
        rows = AttendanceRecord.objects.filter(timeline.attendance_q(timeline.student_timeline(old)))
        assert list(rows.values_list('id', flat=True)) == [mine.id]


@pytest.mark.django_db
class TestMarksFilter:
    def _mark(self, ctx, student, school, year, subject, exam_date, marks):
        exam_type, _ = ExamType.objects.get_or_create(school=school, name='PYTEST_Type')
        exam = Exam.objects.create(
            school=school, academic_year=year, exam_type=exam_type, class_obj=student.class_obj,
            name=f'PYTEST_{school.id}_{exam_date}', start_date=exam_date, status='COMPLETED',
        )
        es = ExamSubject.objects.create(school=school, exam=exam, subject=subject, total_marks=100, passing_marks=40)
        return StudentMark.objects.create(school=school, exam_subject=es, student=student, marks_obtained=marks)

    def test_exams_of_both_branches_are_read_by_their_own_dates(self, ctx):
        old, new = ctx['old'], link(ctx, ctx['old'], ctx['school_b'])
        subject_a = Subject.objects.filter(school=ctx['school_a']).first()
        subject_b = Subject.objects.create(school=ctx['school_b'], name='PYTEST_Math_B', code='PMB')
        keep_old = self._mark(ctx, old, ctx['school_a'], ctx['academic_year'], subject_a, date(2026, 2, 10), 60)
        self._mark(ctx, old, ctx['school_a'], ctx['academic_year'], subject_a, date(2026, 3, 20), 10)   # after leaving
        keep_new = self._mark(ctx, new, ctx['school_b'], ctx['place']['year'], subject_b, date(2026, 3, 20), 80)
        rows = StudentMark.objects.filter(timeline.marks_q(timeline.student_timeline(new)))
        assert set(rows.values_list('id', flat=True)) == {keep_old.id, keep_new.id}


@pytest.mark.django_db
class TestFeesFilter:
    def _fee(self, ctx, student, school, year, month, due, *, fee_type='MONTHLY', category=None):
        return FeePayment.objects.create(
            school=school, academic_year=year, student=student, fee_type=fee_type,
            monthly_category=category if fee_type == 'MONTHLY' else None, month=month if fee_type == 'MONTHLY' else 0,
            year=2026, amount_due=Decimal(due), amount_paid=Decimal('0'), status='UNPAID',
        )

    def test_both_ledgers_are_read_but_old_months_after_leaving_are_not(self, ctx):
        old, new = ctx['old'], link(ctx, ctx['old'], ctx['school_b'])
        cat_a = MonthlyFeeCategory.objects.create(school=ctx['school_a'], name='Tuition')
        cat_b = MonthlyFeeCategory.objects.create(school=ctx['school_b'], name='Tuition')
        jan = self._fee(ctx, old, ctx['school_a'], ctx['academic_year'], 1, '1000', category=cat_a)
        mar = self._fee(ctx, old, ctx['school_a'], ctx['academic_year'], 3, '3000', category=cat_a)      # leaving month: kept
        self._fee(ctx, old, ctx['school_a'], ctx['academic_year'], 4, '4000', category=cat_a)            # after: not anybody's
        annual = self._fee(ctx, old, ctx['school_a'], ctx['academic_year'], 0, '800', fee_type='ANNUAL')
        carried = self._fee(ctx, new, ctx['school_b'], ctx['place']['year'], 3, '3000', category=cat_b)
        rows = FeePayment.objects.filter(timeline.fees_q(timeline.student_timeline(new)))
        assert set(rows.values_list('id', flat=True)) == {jan.id, mar.id, annual.id, carried.id}


@pytest.mark.django_db
class TestHelpers:
    def test_branch_tag_names_the_old_branch_and_leaves_current_rows_untagged(self, ctx):
        new = link(ctx, ctx['old'], ctx['school_b'])
        segments = timeline.student_timeline(new)
        assert timeline.branch_tag(segments, ctx['old'].id, ctx['school_a'].id) == ctx['school_a'].name
        assert timeline.branch_tag(segments, new.id, ctx['school_b'].id) is None
        assert timeline.branch_tag(segments, 999999, 1) is None

    def test_student_ids_lists_every_record_in_the_chain(self, ctx):
        new = link(ctx, ctx['old'], ctx['school_b'])
        assert set(timeline.student_ids(timeline.student_timeline(new))) == {ctx['old'].id, new.id}

    def test_segment_contains_uses_inclusive_start_and_exclusive_end(self, ctx):
        old_seg, new_seg = timeline.student_timeline(link(ctx, ctx['old'], ctx['school_b']))
        assert old_seg.contains(date(2026, 2, 28)) and not old_seg.contains(LEAVING)
        assert new_seg.contains(LEAVING) and not new_seg.contains(date(2026, 2, 28))

    def test_timelines_for_answers_many_students_at_once(self, ctx):
        new = link(ctx, ctx['old'], ctx['school_b'])
        plain = ctx['students'][1]
        result = timeline.timelines_for([Student.objects.select_related('school').get(pk=new.pk),
                                         Student.objects.select_related('school').get(pk=plain.pk)])
        assert len(result[new.id]) == 2 and len(result[plain.id]) == 1

    def test_the_cross_branch_audit_line_is_written_only_for_students_with_history(self, ctx, monkeypatch):
        calls = []
        monkeypatch.setattr('core.audit.log_admin_action', lambda *a, **k: calls.append(a))
        plain_request = object()
        timeline.audit_cross_branch_read(plain_request, ctx['students'][1], 'attendance')
        assert calls == []
        new = link(ctx, ctx['old'], ctx['school_b'])
        timeline.audit_cross_branch_read(plain_request, new, 'attendance')
        assert len(calls) == 1 and calls[0][1] == 'cross_branch_read'


# ── A real transfer produces a chain the timeline understands ────────────────

@pytest.mark.django_db
def test_a_transfer_made_by_the_real_workflow_is_a_valid_timeline(api, ctx):
    from academic_sessions.models import StudentEnrollment
    from student_exits.tests.test_exit_workflow import URL
    from student_exits.tests.transfer_helpers import placement_body

    old = ctx['old']
    StudentEnrollment.objects.create(
        school=ctx['school_a'], student=old, academic_year=ctx['academic_year'], class_obj=old.class_obj,
        roll_number=old.roll_number, status='ACTIVE',
    )
    body = {
        'student': old.id, 'exit_type': 'TRANSFERRED', 'leaving_date': LEAVING.isoformat(), 'reason': 'Moved',
        'destination_school': ctx['SID_B'], **placement_body(ctx['place']),
    }
    exit_id = api.post(URL, body, ctx['tokens']['admin'], ctx['SID_A']).json()['id']
    assert api.post(f'{URL}{exit_id}/finalize/', {}, ctx['tokens']['admin'], ctx['SID_A']).status_code == 200

    new = StudentExit.objects.get(pk=exit_id).destination_student
    segments = timeline.student_timeline(Student.objects.select_related('school').get(pk=new.pk))
    assert [(s.school_id, s.start, s.end) for s in segments] == [
        (ctx['SID_A'], None, LEAVING), (ctx['SID_B'], LEAVING, None),
    ]
