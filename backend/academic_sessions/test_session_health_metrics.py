"""How each session-health card is calculated (retention, attendance, fee collection,
overall pass rate). Reuses the shared seed_data school; year 2025-26 is long over, so
the monthly fee window is the whole year (12 months)."""
from datetime import date
from decimal import Decimal

import pytest

from academic_sessions.models import StudentEnrollment
from academic_sessions.session_health_service import SessionHealthService


@pytest.fixture
def svc(seed_data):
    return SessionHealthService(seed_data['SID_A'], seed_data['academic_year'].id)


def enroll(ctx, student, status='ACTIVE', roll='1', class_obj=None):
    return StudentEnrollment.objects.create(
        school=ctx['school_a'], student=student, academic_year=ctx['academic_year'],
        class_obj=class_obj or student.class_obj, roll_number=roll, status=status,
        is_active=status == 'ACTIVE',
    )


@pytest.mark.django_db
class TestRetention:
    def test_leavers_lower_it_and_promoted_or_graduated_do_not(self, seed_data, svc):
        statuses = ['ACTIVE', 'PROMOTED', 'GRADUATED', 'WITHDRAWN']
        for i, status in enumerate(statuses):
            enroll(seed_data, seed_data['students'][i], status, roll=str(i))

        result = svc._enrollment_metrics(seed_data['academic_year'])

        assert (result['on_roll'], result['retained'], result['left']) == (4, 3, 1)
        assert result['retention_rate'] == 75.0


@pytest.mark.django_db
class TestAttendance:
    def test_leave_counts_as_attended(self, seed_data, svc):
        from attendance.models import AttendanceRecord

        student = seed_data['students'][0]
        for day, status in enumerate(['PRESENT', 'PRESENT', 'LEAVE', 'ABSENT'], start=1):
            AttendanceRecord.objects.create(
                school=seed_data['school_a'], student=student,
                academic_year=seed_data['academic_year'], date=date(2025, 5, day), status=status,
            )

        result = svc._attendance_metrics(seed_data['academic_year'])

        assert result['average_attendance_rate'] == 75.0


@pytest.mark.django_db
class TestFeeCollection:
    def _row(self, ctx, student, fee_type, month, year, due, paid, prev=0):
        from finance.models import FeePayment

        # bulk_create: save() demands a payment date + account for any money received.
        FeePayment.objects.bulk_create([FeePayment(
            school=ctx['school_a'], academic_year=ctx['academic_year'], student=student,
            fee_type=fee_type, month=month, year=year, amount_due=Decimal(due),
            previous_balance=Decimal(prev), amount_paid=Decimal(paid),
        )])

    def test_carried_balance_is_not_counted_twice(self, seed_data, svc):
        from finance.models import FeeStructure

        student = seed_data['students'][0]
        enroll(seed_data, student)
        FeeStructure.objects.create(
            school=seed_data['school_a'], class_obj=student.class_obj, fee_type='MONTHLY',
            monthly_amount=Decimal('1000'), effective_from=date(2025, 4, 1),
        )
        # April unpaid; May's amount_due already holds April's 1000.
        self._row(seed_data, student, 'MONTHLY', 4, 2025, '1000', '0')
        self._row(seed_data, student, 'MONTHLY', 5, 2025, '2000', '500', prev='1000')
        self._row(seed_data, student, 'ANNUAL', 0, 2025, '5000', '2500')

        result = svc._fee_collection_metrics(seed_data['academic_year'])

        assert result['monthly']['months_elapsed'] == 12
        assert result['monthly']['expected'] == 12000
        assert result['monthly']['paid'] == 500
        assert result['yearly']['rate'] == 50.0
        assert result['collection_rate'] == round(3000 / 17000 * 100, 1)
        # Owes 1500 on May's row (the latest); April's UNPAID row is not a second debt.
        assert result['defaulting_students'] == 1

    def test_student_who_settled_the_latest_row_is_not_a_defaulter(self, seed_data, svc):
        student = seed_data['students'][0]
        self._row(seed_data, student, 'MONTHLY', 4, 2025, '1000', '0')
        self._row(seed_data, student, 'MONTHLY', 5, 2025, '2000', '2000', prev='1000')

        assert svc._fee_collection_metrics(seed_data['academic_year'])['defaulting_students'] == 0


@pytest.mark.django_db
class TestPassRate:
    def _exam(self, ctx, class_obj, name='Final', end=date(2026, 3, 1), threshold=2):
        from examinations.models import Exam, ExamType

        exam_type, _ = ExamType.objects.get_or_create(school=ctx['school_a'], name='Annual', defaults={'weight': 100})
        return Exam.objects.create(
            school=ctx['school_a'], academic_year=ctx['academic_year'], exam_type=exam_type,
            class_obj=class_obj, name=name, start_date=end, end_date=end,
            fail_threshold_subjects=threshold,
        )

    def _marks(self, ctx, exam, student, scores):
        from examinations.models import ExamSubject, StudentMark

        for subject, score in zip(ctx['subjects'], scores):
            es, _ = ExamSubject.objects.get_or_create(
                school=ctx['school_a'], exam=exam, subject=subject,
                defaults={'total_marks': Decimal('100'), 'passing_marks': Decimal('33')},
            )
            StudentMark.objects.create(
                school=ctx['school_a'], exam_subject=es, student=student,
                marks_obtained=None if score is None else Decimal(score), is_absent=False,
            )

    def test_counts_students_not_subject_marks(self, seed_data, svc):
        class_1 = seed_data['classes'][0]
        exam = self._exam(seed_data, class_1, threshold=2)
        pass_all, fail_one, fail_both, unfinished = seed_data['students'][:4]
        for i, s in enumerate((pass_all, fail_one, fail_both, unfinished)):
            enroll(seed_data, s, roll=str(i))
        self._marks(seed_data, exam, pass_all, (80, 70))
        self._marks(seed_data, exam, fail_one, (80, 10))     # 1 failed subject < threshold 2: passes
        self._marks(seed_data, exam, fail_both, (10, 10))    # 2 failed subjects: fails overall
        self._marks(seed_data, exam, unfinished, (80, None))  # a mark not entered yet

        result = svc._exam_performance_metrics(seed_data['academic_year'])

        assert result['students_assessed'] == 3
        assert result['students_passed'] == 2
        assert result['average_pass_rate'] == round(2 / 3 * 100, 1)
        assert result['results_pending'] == 1

    def test_the_latest_exam_decides(self, seed_data, svc):
        class_1 = seed_data['classes'][0]
        student = seed_data['students'][0]
        enroll(seed_data, student)
        early = self._exam(seed_data, class_1, name='Mid', end=date(2025, 9, 1))
        final = self._exam(seed_data, class_1, name='Final', end=date(2026, 3, 1))
        self._marks(seed_data, early, student, (10, 10))  # failed the mid-year
        self._marks(seed_data, final, student, (90, 90))  # passed the final

        result = svc._exam_performance_metrics(seed_data['academic_year'])

        assert (result['students_assessed'], result['students_passed']) == (1, 1)

    def test_no_results_yet_is_none_not_zero(self, seed_data, svc):
        self._exam(seed_data, seed_data['classes'][0])  # no marks entered

        assert svc._exam_performance_metrics(seed_data['academic_year'])['average_pass_rate'] is None
