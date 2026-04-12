"""
Tests for finance generation tasks.
"""
from datetime import date
from decimal import Decimal

from django.test import TestCase, override_settings

from academic_sessions.models import AcademicYear, StudentEnrollment
from finance.models import (
    AnnualFeeCategory,
    FeePayment,
    FeeStructure,
    MonthlyFeeCategory,
)
from finance.generation_planner import build_preview_plan
from finance.tasks import generate_annual_fees_task, generate_monthly_fees_task
from schools.models import Organization, School
from students.models import Class, Student


def _make_school():
    org = Organization.objects.create(name="Test Org", slug="test-org-fees")
    school = School.objects.create(organization=org, name="Test School", subdomain="test-fees-school")
    return school


@override_settings(CELERY_TASK_ALWAYS_EAGER=True)
class TestFeeGenerationClassScoping(TestCase):
    """
    Regression test: existing_payments in generation tasks must be scoped to the
    current class's students, not school-wide. Otherwise, when class B is generated
    after class A (same category), class A's existing records bleed into
    remaining_existing_ids → skipped_count for class B's run.
    """

    @classmethod
    def setUpTestData(cls):
        cls.school = _make_school()
        cls.class_a = Class.objects.create(school=cls.school, name="Class A", grade_level=1)
        cls.class_b = Class.objects.create(school=cls.school, name="Class B", grade_level=2)

        cls.students_a = [
            Student.objects.create(
                school=cls.school, class_obj=cls.class_a,
                name=f"Student A{i}", roll_number=f"A{i}",
            )
            for i in range(3)
        ]
        cls.students_b = [
            Student.objects.create(
                school=cls.school, class_obj=cls.class_b,
                name=f"Student B{i}", roll_number=f"B{i}",
            )
            for i in range(2)
        ]

        cls.monthly_cat = MonthlyFeeCategory.objects.create(
            school=cls.school, name="Tuition", is_active=True,
        )
        cls.annual_cat = AnnualFeeCategory.objects.create(
            school=cls.school, name="School Fee", is_active=True,
        )

        effective = date(2024, 1, 1)
        for cls_obj in (cls.class_a, cls.class_b):
            FeeStructure.objects.create(
                school=cls.school,
                class_obj=cls_obj,
                fee_type='MONTHLY',
                monthly_category=cls.monthly_cat,
                monthly_amount=Decimal('1000'),
                effective_from=effective,
            )
            FeeStructure.objects.create(
                school=cls.school,
                class_obj=cls_obj,
                fee_type='ANNUAL',
                annual_category=cls.annual_cat,
                monthly_amount=Decimal('5000'),
                effective_from=effective,
            )

    # ── Monthly generation ────────────────────────────────────────────────────

    def test_monthly_class_a_creates_exactly_three_records(self):
        result = generate_monthly_fees_task.apply(kwargs={
            'school_id': self.school.id,
            'month': 4,
            'year': 2026,
            'class_id': self.class_a.id,
            'monthly_category_ids': [self.monthly_cat.id],
        }).get()

        self.assertEqual(result['created'], 3)
        self.assertEqual(result['skipped'], 0)
        self.assertEqual(result['unchanged_existing'], 0)

    def test_monthly_class_b_creates_exactly_two_records_without_bleed(self):
        """After class A is generated, class B must NOT see class A's records as skipped."""
        # Pre-generate class A records (same category, same month/year)
        generate_monthly_fees_task.apply(kwargs={
            'school_id': self.school.id,
            'month': 4,
            'year': 2026,
            'class_id': self.class_a.id,
            'monthly_category_ids': [self.monthly_cat.id],
        }).get()

        result = generate_monthly_fees_task.apply(kwargs={
            'school_id': self.school.id,
            'month': 4,
            'year': 2026,
            'class_id': self.class_b.id,
            'monthly_category_ids': [self.monthly_cat.id],
        }).get()

        self.assertEqual(result['created'], 2)
        self.assertEqual(result['skipped'], 0,
            msg="Class B generation must not see class A's 3 records as skipped")
        self.assertEqual(result['unchanged_existing'], 0)

    # ── Annual generation ─────────────────────────────────────────────────────

    def test_annual_class_a_creates_exactly_three_records(self):
        result = generate_annual_fees_task.apply(kwargs={
            'school_id': self.school.id,
            'year': 2026,
            'annual_category_ids': [self.annual_cat.id],
            'class_id': self.class_a.id,
        }).get()

        self.assertEqual(result['created'], 3)
        self.assertEqual(result['skipped'], 0)
        self.assertEqual(result['unchanged_existing'], 0)

    def test_annual_class_b_creates_exactly_two_records_without_bleed(self):
        """After class A annual fees are generated, class B must NOT count them as skipped."""
        generate_annual_fees_task.apply(kwargs={
            'school_id': self.school.id,
            'year': 2026,
            'annual_category_ids': [self.annual_cat.id],
            'class_id': self.class_a.id,
        }).get()

        result = generate_annual_fees_task.apply(kwargs={
            'school_id': self.school.id,
            'year': 2026,
            'annual_category_ids': [self.annual_cat.id],
            'class_id': self.class_b.id,
        }).get()

        self.assertEqual(result['created'], 2)
        self.assertEqual(result['skipped'], 0,
            msg="Class B annual generation must not see class A's 3 records as skipped")
        self.assertEqual(result['unchanged_existing'], 0)


@override_settings(CELERY_TASK_ALWAYS_EAGER=True)
class TestFeeGenerationHistoricalYearScoping(TestCase):
    """Phase 3 regressions: historical academic-year scope must use enrollment class, not student snapshot class."""

    @classmethod
    def setUpTestData(cls):
        cls.school = _make_school()
        cls.class_old = Class.objects.create(school=cls.school, name="Class Old", grade_level=1)
        cls.class_new = Class.objects.create(school=cls.school, name="Class New", grade_level=2)

        cls.source_year = AcademicYear.objects.create(
            school=cls.school,
            name="2025-2026",
            start_date=date(2025, 4, 1),
            end_date=date(2026, 3, 31),
            is_current=False,
            is_active=True,
        )
        cls.target_year = AcademicYear.objects.create(
            school=cls.school,
            name="2026-2027",
            start_date=date(2026, 4, 1),
            end_date=date(2027, 3, 31),
            is_current=True,
            is_active=True,
        )

        cls.student = Student.objects.create(
            school=cls.school,
            class_obj=cls.class_new,
            name="Historical Scope Student",
            roll_number="10",
        )

        StudentEnrollment.objects.create(
            school=cls.school,
            student=cls.student,
            academic_year=cls.source_year,
            class_obj=cls.class_old,
            roll_number="10",
            status=StudentEnrollment.Status.ACTIVE,
            is_active=True,
        )
        StudentEnrollment.objects.create(
            school=cls.school,
            student=cls.student,
            academic_year=cls.target_year,
            class_obj=cls.class_new,
            roll_number="11",
            status=StudentEnrollment.Status.ACTIVE,
            is_active=True,
        )

        cls.monthly_cat = MonthlyFeeCategory.objects.create(
            school=cls.school,
            name="Monthly Tuition",
            is_active=True,
        )
        cls.annual_cat = AnnualFeeCategory.objects.create(
            school=cls.school,
            name="Annual Fee",
            is_active=True,
        )

        effective = date(2024, 1, 1)
        # Intentionally distinct amounts so incorrect class resolution is obvious.
        FeeStructure.objects.create(
            school=cls.school,
            class_obj=cls.class_old,
            fee_type='MONTHLY',
            monthly_category=cls.monthly_cat,
            monthly_amount=Decimal('1200'),
            effective_from=effective,
        )
        FeeStructure.objects.create(
            school=cls.school,
            class_obj=cls.class_new,
            fee_type='MONTHLY',
            monthly_category=cls.monthly_cat,
            monthly_amount=Decimal('2200'),
            effective_from=effective,
        )
        FeeStructure.objects.create(
            school=cls.school,
            class_obj=cls.class_old,
            fee_type='ANNUAL',
            annual_category=cls.annual_cat,
            monthly_amount=Decimal('7000'),
            effective_from=effective,
        )
        FeeStructure.objects.create(
            school=cls.school,
            class_obj=cls.class_new,
            fee_type='ANNUAL',
            annual_category=cls.annual_cat,
            monthly_amount=Decimal('9000'),
            effective_from=effective,
        )

    def test_generate_monthly_uses_historical_enrollment_class(self):
        result = generate_monthly_fees_task.apply(kwargs={
            'school_id': self.school.id,
            'month': 5,
            'year': 2026,
            'class_id': self.class_old.id,
            'academic_year_id': self.source_year.id,
            'monthly_category_ids': [self.monthly_cat.id],
        }).get()

        self.assertEqual(result['created'], 1)
        payment = FeePayment.objects.get(
            school=self.school,
            student=self.student,
            month=5,
            year=2026,
            fee_type='MONTHLY',
            monthly_category=self.monthly_cat,
        )
        self.assertEqual(payment.amount_due, Decimal('1200'))

    def test_generate_annual_uses_historical_enrollment_class(self):
        result = generate_annual_fees_task.apply(kwargs={
            'school_id': self.school.id,
            'year': 2026,
            'annual_category_ids': [self.annual_cat.id],
            'class_id': self.class_old.id,
            'academic_year_id': self.source_year.id,
        }).get()

        self.assertEqual(result['created'], 1)
        payment = FeePayment.objects.get(
            school=self.school,
            student=self.student,
            month=0,
            year=2026,
            fee_type='ANNUAL',
            annual_category=self.annual_cat,
        )
        self.assertEqual(payment.amount_due, Decimal('7000'))

    def test_preview_plan_uses_historical_class_amount(self):
        students = [self.student]
        preview = build_preview_plan(
            school_id=self.school.id,
            students=students,
            fee_type='MONTHLY',
            year=2026,
            month=5,
            monthly_category_ids=[self.monthly_cat.id],
            academic_year_id=self.source_year.id,
        )

        self.assertEqual(preview['will_create'], 1)
        self.assertEqual(Decimal(preview['students'][0]['amount']), Decimal('1200'))
