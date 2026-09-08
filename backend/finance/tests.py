"""
Tests for finance generation tasks.
"""
from datetime import date
from decimal import Decimal

from django.test import TestCase, override_settings
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from academic_sessions.models import AcademicYear, SessionClass, StudentEnrollment
from finance.models import (
    Account,
    AnnualFeeCategory,
    FeePayment,
    FeeStructure,
    MonthlyFeeCategory,
)
from finance.generation_planner import build_preview_plan
from finance.tasks import generate_annual_fees_task, generate_monthly_fees_task
from finance.views import _filter_students_by_scope
from schools.models import Organization, School
from students.models import Class, Student


def _make_school():
    org = Organization.objects.create(name="Test Org", slug="test-org-fees")
    school = School.objects.create(organization=org, name="Test School", subdomain="test-fees-school")
    return school


@override_settings(CELERY_TASK_ALWAYS_EAGER=True)
class TestSingleFeeGenerationEndpoint(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.school = _make_school()
        cls.class_obj = Class.objects.create(school=cls.school, name='Class 1', grade_level=1)
        cls.student = Student.objects.create(
            school=cls.school,
            class_obj=cls.class_obj,
            name='Single Fee Student',
            roll_number='1',
        )
        cls.monthly_cat = MonthlyFeeCategory.objects.create(
            school=cls.school,
            name='Tuition',
            is_active=True,
        )
        cls.annual_cat = AnnualFeeCategory.objects.create(
            school=cls.school,
            name='Annual Charge',
            is_active=True,
        )

        FeeStructure.objects.create(
            school=cls.school,
            class_obj=cls.class_obj,
            fee_type='MONTHLY',
            monthly_category=cls.monthly_cat,
            monthly_amount=Decimal('500'),
            effective_from=date(2024, 1, 1),
            is_active=True,
        )
        FeeStructure.objects.create(
            school=cls.school,
            class_obj=cls.class_obj,
            fee_type='ANNUAL',
            annual_category=cls.annual_cat,
            monthly_amount=Decimal('4000'),
            effective_from=date(2024, 1, 1),
            is_active=True,
        )

        cls.account = Account.objects.create(
            school=cls.school,
            name='Cash Box',
            account_type=Account.AccountType.CASH,
        )

        cls.user = get_user_model().objects.create_superuser(
            username='single_fee_admin',
            email='single_fee_admin@test.com',
            password='test12345',
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.school_header = {'HTTP_X_SCHOOL_ID': str(self.school.id)}

    def test_generate_single_monthly_includes_previous_balance(self):
        FeePayment.objects.create(
            school=self.school,
            student=self.student,
            fee_type='MONTHLY',
            monthly_category=self.monthly_cat,
            month=3,
            year=2026,
            amount_due=Decimal('1000'),
            amount_paid=Decimal('300'),
            previous_balance=Decimal('0'),
            base_monthly_fee=Decimal('500'),
            payment_date=date(2026, 3, 10),
            account=self.account,
        )

        response = self.client.post(
            '/api/finance/fee-payments/generate_single/',
            {
                'student': self.student.id,
                'fee_type': 'MONTHLY',
                'month': 4,
                'year': 2026,
                'monthly_category': self.monthly_cat.id,
            },
            format='json',
            **self.school_header,
        )

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertTrue(payload['created'])

        record = payload['record']
        self.assertEqual(record['previous_balance'], '700.00')
        self.assertEqual(record['amount_due'], '1200.00')

        generated = FeePayment.objects.get(id=record['id'])
        self.assertEqual(generated.base_monthly_fee, Decimal('500.00'))

    def test_generate_single_annual_uses_structure_without_carry_forward(self):
        response = self.client.post(
            '/api/finance/fee-payments/generate_single/',
            {
                'student': self.student.id,
                'fee_type': 'ANNUAL',
                'year': 2026,
                'annual_category': self.annual_cat.id,
            },
            format='json',
            **self.school_header,
        )

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertTrue(payload['created'])

        record = payload['record']
        self.assertEqual(record['month'], 0)
        self.assertEqual(record['amount_due'], '4000.00')
        self.assertEqual(record['previous_balance'], '0.00')


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


@override_settings(CELERY_TASK_ALWAYS_EAGER=True)
class TestFeeGenerationSessionClassScoping(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.school = _make_school()
        cls.academic_year = AcademicYear.objects.create(
            school=cls.school,
            name='2026-2027',
            start_date=date(2026, 4, 1),
            end_date=date(2027, 3, 31),
            is_current=True,
            is_active=True,
        )
        cls.playgroup = Class.objects.create(school=cls.school, name='Playgroup', grade_level=0)
        cls.session_a = SessionClass.objects.create(
            school=cls.school,
            academic_year=cls.academic_year,
            class_obj=cls.playgroup,
            display_name='Playgroup',
            section='A',
            grade_level=0,
            is_active=True,
        )
        cls.session_b = SessionClass.objects.create(
            school=cls.school,
            academic_year=cls.academic_year,
            class_obj=cls.playgroup,
            display_name='Playgroup',
            section='B',
            grade_level=0,
            is_active=True,
        )
        cls.student_a = Student.objects.create(
            school=cls.school,
            class_obj=cls.playgroup,
            name='Alpha Student',
            roll_number='1',
        )
        cls.student_b = Student.objects.create(
            school=cls.school,
            class_obj=cls.playgroup,
            name='Beta Student',
            roll_number='2',
        )
        StudentEnrollment.objects.create(
            school=cls.school,
            student=cls.student_a,
            academic_year=cls.academic_year,
            class_obj=cls.playgroup,
            session_class=cls.session_a,
            status='ACTIVE',
            is_active=True,
        )
        StudentEnrollment.objects.create(
            school=cls.school,
            student=cls.student_b,
            academic_year=cls.academic_year,
            class_obj=cls.playgroup,
            session_class=cls.session_b,
            status='ACTIVE',
            is_active=True,
        )
        cls.monthly_cat = MonthlyFeeCategory.objects.create(
            school=cls.school,
            name='Tuition Fee',
            is_active=True,
        )
        cls.annual_cat = AnnualFeeCategory.objects.create(
            school=cls.school,
            name='Admission Fee',
            is_active=True,
        )
        effective = date(2026, 1, 1)
        FeeStructure.objects.create(
            school=cls.school,
            class_obj=cls.playgroup,
            fee_type='MONTHLY',
            monthly_category=cls.monthly_cat,
            monthly_amount=Decimal('1500'),
            effective_from=effective,
        )
        FeeStructure.objects.create(
            school=cls.school,
            class_obj=cls.playgroup,
            fee_type='ANNUAL',
            annual_category=cls.annual_cat,
            monthly_amount=Decimal('6000'),
            effective_from=effective,
        )

    def test_preview_scope_prefers_session_class(self):
        students = list(_filter_students_by_scope(
            Student.objects.filter(school=self.school, is_active=True),
            class_id=self.playgroup.id,
            academic_year_id=self.academic_year.id,
            session_class_id=self.session_a.id,
        ))

        self.assertEqual([student.id for student in students], [self.student_a.id])

        preview = build_preview_plan(
            school_id=self.school.id,
            students=students,
            fee_type='MONTHLY',
            year=2026,
            month=5,
            monthly_category_ids=[self.monthly_cat.id],
            academic_year_id=self.academic_year.id,
        )

        self.assertEqual(preview['will_create'], 1)
        self.assertEqual(preview['students'][0]['student_id'], self.student_a.id)

    def test_generate_monthly_session_class_overrides_master_class_scope(self):
        result = generate_monthly_fees_task.apply(kwargs={
            'school_id': self.school.id,
            'month': 5,
            'year': 2026,
            'class_id': self.playgroup.id,
            'session_class_id': self.session_a.id,
            'academic_year_id': self.academic_year.id,
            'monthly_category_ids': [self.monthly_cat.id],
        }).get()

        self.assertEqual(result['created'], 1)
        self.assertEqual(
            FeePayment.objects.filter(
                school=self.school,
                month=5,
                year=2026,
                fee_type='MONTHLY',
                monthly_category=self.monthly_cat,
            ).count(),
            1,
        )
        self.assertTrue(FeePayment.objects.filter(student=self.student_a).exists())
        self.assertFalse(FeePayment.objects.filter(student=self.student_b).exists())

    def test_generate_annual_session_class_overrides_master_class_scope(self):
        result = generate_annual_fees_task.apply(kwargs={
            'school_id': self.school.id,
            'year': 2026,
            'annual_category_ids': [self.annual_cat.id],
            'class_id': self.playgroup.id,
            'session_class_id': self.session_a.id,
            'academic_year_id': self.academic_year.id,
        }).get()

        self.assertEqual(result['created'], 1)
        self.assertEqual(
            FeePayment.objects.filter(
                school=self.school,
                month=0,
                year=2026,
                fee_type='ANNUAL',
                annual_category=self.annual_cat,
            ).count(),
            1,
        )
        self.assertTrue(FeePayment.objects.filter(student=self.student_a).exists())
        self.assertFalse(FeePayment.objects.filter(student=self.student_b).exists())


class TestFeeSummaryWithdrawnStudentGrouping(TestCase):
    """A student withdrawn mid-year must still be grouped under their real
    class in fee_summary's by_class breakdown, not split into a second
    "Playgroup"/"Class 3"-looking row keyed by the master class alone.
    See CLASS_SYSTEM_GUIDE.md Known Issue 6 for the underlying orphan-link
    pattern this reproduces."""

    @classmethod
    def setUpTestData(cls):
        cls.school = _make_school()
        cls.academic_year = AcademicYear.objects.create(
            school=cls.school,
            name='2026-2027',
            start_date=date(2026, 4, 1),
            end_date=date(2027, 3, 31),
            is_current=True,
            is_active=True,
        )
        cls.playgroup = Class.objects.create(school=cls.school, name='Playgroup', grade_level=0)
        cls.session_a = SessionClass.objects.create(
            school=cls.school,
            academic_year=cls.academic_year,
            class_obj=cls.playgroup,
            display_name='Playgroup',
            section='',
            grade_level=0,
            is_active=True,
        )
        cls.student_active = Student.objects.create(
            school=cls.school,
            class_obj=cls.playgroup,
            name='Active Student',
            roll_number='1',
            status='ACTIVE',
        )
        cls.student_withdrawn = Student.objects.create(
            school=cls.school,
            class_obj=cls.playgroup,
            name='Withdrawn Student',
            roll_number='2',
            status='WITHDRAWN',
        )
        StudentEnrollment.objects.create(
            school=cls.school,
            student=cls.student_active,
            academic_year=cls.academic_year,
            class_obj=cls.playgroup,
            session_class=cls.session_a,
            status='ACTIVE',
            is_active=True,
            roll_number='1',
        )
        # Withdrawn mid-year: enrollment left inactive, mirroring how the
        # withdrawal workflow marks it, but the session_class link is still
        # the correct historical placement for the months already billed.
        StudentEnrollment.objects.create(
            school=cls.school,
            student=cls.student_withdrawn,
            academic_year=cls.academic_year,
            class_obj=cls.playgroup,
            session_class=cls.session_a,
            status='WITHDRAWN',
            is_active=False,
            roll_number='2',
        )
        cls.monthly_cat = MonthlyFeeCategory.objects.create(
            school=cls.school,
            name='Tuition Fee',
            is_active=True,
        )
        cls.account = Account.objects.create(
            school=cls.school,
            name='Cash Box',
            account_type=Account.AccountType.CASH,
        )
        FeePayment.objects.create(
            school=cls.school,
            student=cls.student_active,
            academic_year=cls.academic_year,
            fee_type='MONTHLY',
            monthly_category=cls.monthly_cat,
            month=4,
            year=2026,
            amount_due=Decimal('1500'),
            amount_paid=Decimal('1500'),
            base_monthly_fee=Decimal('1500'),
            payment_date=date(2026, 4, 5),
            account=cls.account,
        )
        FeePayment.objects.create(
            school=cls.school,
            student=cls.student_withdrawn,
            academic_year=cls.academic_year,
            fee_type='MONTHLY',
            monthly_category=cls.monthly_cat,
            month=5,
            year=2026,
            amount_due=Decimal('1500'),
            amount_paid=Decimal('1500'),
            base_monthly_fee=Decimal('1500'),
            payment_date=date(2026, 5, 5),
            account=cls.account,
        )
        cls.user = get_user_model().objects.create_superuser(
            username='fee_summary_admin',
            email='fee_summary_admin@test.com',
            password='test12345',
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.school_header = {'HTTP_X_SCHOOL_ID': str(self.school.id)}

    def test_fee_summary_groups_withdrawn_student_with_active_classmate(self):
        response = self.client.get(
            '/api/finance/fee-payments/fee_summary/',
            {'fee_type': 'MONTHLY', 'academic_year': self.academic_year.id},
            **self.school_header,
        )

        self.assertEqual(response.status_code, 200)
        by_class = response.json()['by_class']

        # Exactly one Playgroup row, not two (mc: fallback bucket must not
        # appear alongside the sc: session-class bucket).
        playgroup_rows = [c for c in by_class if c['class_name'] == 'Playgroup']
        self.assertEqual(len(playgroup_rows), 1, by_class)
        row = playgroup_rows[0]
        self.assertEqual(row['students'], 2)
        self.assertEqual(row['class_key'], f'session:{self.session_a.id}')

        # Withdrawn student's balance is still counted in the class total,
        # but also broken out separately so staff can tell it apart from a
        # still-enrolled family's balance.
        self.assertEqual(row['left_count'], 1)
        self.assertEqual(Decimal(str(row['left_total_due'])), Decimal('1500'))
        self.assertEqual(Decimal(str(row['left_total_collected'])), Decimal('1500'))
        self.assertEqual(Decimal(str(row['total_due'])), Decimal('3000'))

    def test_payment_list_resolves_session_class_for_withdrawn_student(self):
        response = self.client.get(
            '/api/finance/fee-payments/',
            {'fee_type': 'MONTHLY', 'academic_year': self.academic_year.id, 'page_size': 50},
            **self.school_header,
        )

        self.assertEqual(response.status_code, 200)
        results = response.json()['results']
        by_student = {r['student_name']: r for r in results}

        # Both records must resolve to the same class_key the fee_summary
        # bucket used above, or the frontend's expand-row matching breaks.
        self.assertEqual(
            by_student['Active Student']['session_class_id'],
            by_student['Withdrawn Student']['session_class_id'],
        )
        self.assertEqual(by_student['Withdrawn Student']['session_class_id'], self.session_a.id)

        # student_status lets the frontend split the expanded student list
        # into "currently enrolled" vs. "left" without a second class row.
        self.assertEqual(by_student['Active Student']['student_status'], 'ACTIVE')
        self.assertEqual(by_student['Withdrawn Student']['student_status'], 'WITHDRAWN')


class TestFeeSummaryMissingEnrollmentGrouping(TestCase):
    """Covers the real-world case behind the still-duplicated "Playgroup" row seen in
    production: a student with NO StudentEnrollment row at all for the academic year
    (not merely an inactive one — TestFeeSummaryWithdrawnStudentGrouping above covers
    that case). Confirms the class_resolution fallback resolves them via their master
    class when it maps to exactly one active SessionClass for the year."""

    @classmethod
    def setUpTestData(cls):
        cls.school = _make_school()
        cls.academic_year = AcademicYear.objects.create(
            school=cls.school,
            name='2026-2027',
            start_date=date(2026, 4, 1),
            end_date=date(2027, 3, 31),
            is_current=True,
            is_active=True,
        )
        cls.playgroup = Class.objects.create(school=cls.school, name='Playgroup', grade_level=0)
        cls.session_a = SessionClass.objects.create(
            school=cls.school,
            academic_year=cls.academic_year,
            class_obj=cls.playgroup,
            display_name='Playgroup',
            section='',
            grade_level=0,
            is_active=True,
        )
        cls.student_active = Student.objects.create(
            school=cls.school,
            class_obj=cls.playgroup,
            name='Active Student',
            roll_number='1',
            status='ACTIVE',
        )
        cls.student_no_enrollment = Student.objects.create(
            school=cls.school,
            class_obj=cls.playgroup,
            name='No Enrollment Student',
            roll_number='2',
            status='WITHDRAWN',
        )
        StudentEnrollment.objects.create(
            school=cls.school,
            student=cls.student_active,
            academic_year=cls.academic_year,
            class_obj=cls.playgroup,
            session_class=cls.session_a,
            status='ACTIVE',
            is_active=True,
            roll_number='1',
        )
        # Deliberately no StudentEnrollment row for student_no_enrollment at all —
        # the case an inactive-enrollment fix can't reach.
        cls.monthly_cat = MonthlyFeeCategory.objects.create(
            school=cls.school,
            name='Tuition Fee',
            is_active=True,
        )
        cls.account = Account.objects.create(
            school=cls.school,
            name='Cash Box',
            account_type=Account.AccountType.CASH,
        )
        FeePayment.objects.create(
            school=cls.school,
            student=cls.student_active,
            academic_year=cls.academic_year,
            fee_type='MONTHLY',
            monthly_category=cls.monthly_cat,
            month=4,
            year=2026,
            amount_due=Decimal('1500'),
            amount_paid=Decimal('1500'),
            base_monthly_fee=Decimal('1500'),
            payment_date=date(2026, 4, 5),
            account=cls.account,
        )
        FeePayment.objects.create(
            school=cls.school,
            student=cls.student_no_enrollment,
            academic_year=cls.academic_year,
            fee_type='MONTHLY',
            monthly_category=cls.monthly_cat,
            month=5,
            year=2026,
            amount_due=Decimal('1500'),
            amount_paid=Decimal('1500'),
            base_monthly_fee=Decimal('1500'),
            payment_date=date(2026, 5, 5),
            account=cls.account,
        )
        cls.user = get_user_model().objects.create_superuser(
            username='fee_summary_admin2',
            email='fee_summary_admin2@test.com',
            password='test12345',
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.school_header = {'HTTP_X_SCHOOL_ID': str(self.school.id)}

    def test_fee_summary_merges_student_with_no_enrollment_row(self):
        response = self.client.get(
            '/api/finance/fee-payments/fee_summary/',
            {'fee_type': 'MONTHLY', 'academic_year': self.academic_year.id},
            **self.school_header,
        )

        self.assertEqual(response.status_code, 200)
        by_class = response.json()['by_class']

        playgroup_rows = [c for c in by_class if c['class_name'] == 'Playgroup']
        self.assertEqual(len(playgroup_rows), 1, by_class)
        row = playgroup_rows[0]
        self.assertEqual(row['students'], 2)
        self.assertEqual(row['class_key'], f'session:{self.session_a.id}')
        self.assertEqual(row['left_count'], 1)

    def test_payment_list_resolves_session_class_with_no_enrollment_row(self):
        response = self.client.get(
            '/api/finance/fee-payments/',
            {'fee_type': 'MONTHLY', 'academic_year': self.academic_year.id, 'page_size': 50},
            **self.school_header,
        )

        self.assertEqual(response.status_code, 200)
        results = response.json()['results']
        by_student = {r['student_name']: r for r in results}

        self.assertEqual(
            by_student['No Enrollment Student']['session_class_id'],
            self.session_a.id,
        )


class TestFeeSummaryAmbiguousSessionClassStaysUnmerged(TestCase):
    """When a master class has genuinely split into two or more sections and a
    student has no enrollment row linking them to either, class_resolution must NOT
    guess — the student stays in the master-class-only fallback bucket rather than
    being silently assigned to the wrong section."""

    @classmethod
    def setUpTestData(cls):
        cls.school = _make_school()
        cls.academic_year = AcademicYear.objects.create(
            school=cls.school,
            name='2026-2027',
            start_date=date(2026, 4, 1),
            end_date=date(2027, 3, 31),
            is_current=True,
            is_active=True,
        )
        cls.class1 = Class.objects.create(school=cls.school, name='Class 1', grade_level=1)
        cls.section_a = SessionClass.objects.create(
            school=cls.school,
            academic_year=cls.academic_year,
            class_obj=cls.class1,
            display_name='Class 1',
            section='A',
            grade_level=1,
            is_active=True,
        )
        cls.section_b = SessionClass.objects.create(
            school=cls.school,
            academic_year=cls.academic_year,
            class_obj=cls.class1,
            display_name='Class 1',
            section='B',
            grade_level=1,
            is_active=True,
        )
        cls.student_a = Student.objects.create(
            school=cls.school,
            class_obj=cls.class1,
            name='Section A Student',
            roll_number='1',
            status='ACTIVE',
        )
        cls.student_unlinked = Student.objects.create(
            school=cls.school,
            class_obj=cls.class1,
            name='Unlinked Student',
            roll_number='2',
            status='WITHDRAWN',
        )
        StudentEnrollment.objects.create(
            school=cls.school,
            student=cls.student_a,
            academic_year=cls.academic_year,
            class_obj=cls.class1,
            session_class=cls.section_a,
            status='ACTIVE',
            is_active=True,
            roll_number='1',
        )
        cls.monthly_cat = MonthlyFeeCategory.objects.create(
            school=cls.school,
            name='Tuition Fee',
            is_active=True,
        )
        cls.account = Account.objects.create(
            school=cls.school,
            name='Cash Box',
            account_type=Account.AccountType.CASH,
        )
        FeePayment.objects.create(
            school=cls.school,
            student=cls.student_a,
            academic_year=cls.academic_year,
            fee_type='MONTHLY',
            monthly_category=cls.monthly_cat,
            month=4,
            year=2026,
            amount_due=Decimal('1500'),
            amount_paid=Decimal('1500'),
            base_monthly_fee=Decimal('1500'),
            payment_date=date(2026, 4, 5),
            account=cls.account,
        )
        FeePayment.objects.create(
            school=cls.school,
            student=cls.student_unlinked,
            academic_year=cls.academic_year,
            fee_type='MONTHLY',
            monthly_category=cls.monthly_cat,
            month=5,
            year=2026,
            amount_due=Decimal('1500'),
            amount_paid=Decimal('1500'),
            base_monthly_fee=Decimal('1500'),
            payment_date=date(2026, 5, 5),
            account=cls.account,
        )
        cls.user = get_user_model().objects.create_superuser(
            username='fee_summary_admin3',
            email='fee_summary_admin3@test.com',
            password='test12345',
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.school_header = {'HTTP_X_SCHOOL_ID': str(self.school.id)}

    def test_ambiguous_class_is_not_merged_into_either_section(self):
        response = self.client.get(
            '/api/finance/fee-payments/fee_summary/',
            {'fee_type': 'MONTHLY', 'academic_year': self.academic_year.id},
            **self.school_header,
        )

        self.assertEqual(response.status_code, 200)
        by_class = response.json()['by_class']

        section_a_row = next(c for c in by_class if c['class_key'] == f'session:{self.section_a.id}')
        self.assertEqual(section_a_row['students'], 1)

        # The unlinked student must not have been guessed into section A or B —
        # it stays in its own master-class-only bucket.
        fallback_rows = [c for c in by_class if c['class_key'] not in (
            f'session:{self.section_a.id}', f'session:{self.section_b.id}',
        )]
        self.assertEqual(len(fallback_rows), 1, by_class)
        self.assertEqual(fallback_rows[0]['students'], 1)
