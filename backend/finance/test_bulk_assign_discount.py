"""Regression test for the per-student query fix on bulk_assign discount (perf fix #2)."""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from academic_sessions.models import AcademicYear
from finance.models import Discount, StudentDiscount
from schools.models import Organization, School
from students.models import Class, Student


def _make_school():
    org = Organization.objects.create(name='BulkAssign Test Org', slug='bulkassign-test-org')
    return School.objects.create(
        organization=org,
        name='BulkAssign Test School',
        subdomain='bulkassign-test-school',
    )


class BulkAssignDiscountTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.school = _make_school()
        cls.user = get_user_model().objects.create_superuser(
            username='bulk_assign_admin',
            email='bulk_assign_admin@test.com',
            password='test12345',
        )
        cls.class_obj = Class.objects.create(school=cls.school, name='Class 1', grade_level=1)
        cls.students = [
            Student.objects.create(
                school=cls.school, class_obj=cls.class_obj, roll_number=str(i), name=f'Student {i}', is_active=True,
            )
            for i in range(6)
        ]
        cls.academic_year = AcademicYear.objects.create(
            school=cls.school, name='2025-2026',
            start_date='2026-01-01', end_date='2026-12-31', is_current=True,
        )
        cls.discount = Discount.objects.create(
            school=cls.school, name='Sibling Discount', discount_type='PERCENTAGE', value=10,
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.school_header = {'HTTP_X_SCHOOL_ID': str(self.school.id)}

    def _bulk_assign(self):
        return self.client.post(
            '/api/finance/student-discounts/bulk_assign/',
            {
                'discount_id': self.discount.id,
                'class_id': self.class_obj.id,
                'academic_year_id': self.academic_year.id,
            },
            format='json',
            **self.school_header,
        )

    def test_bulk_assign_creates_for_all_students(self):
        response = self._bulk_assign()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['created'], 6)
        self.assertEqual(response.data['skipped'], 0)
        self.assertEqual(response.data['total_students'], 6)
        self.assertEqual(
            StudentDiscount.objects.filter(discount=self.discount, is_active=True).count(), 6,
        )

    def test_bulk_assign_is_idempotent_and_skips_existing(self):
        self._bulk_assign()
        response = self._bulk_assign()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['created'], 0)
        self.assertEqual(response.data['skipped'], 6)
        self.assertEqual(
            StudentDiscount.objects.filter(discount=self.discount, is_active=True).count(), 6,
        )
