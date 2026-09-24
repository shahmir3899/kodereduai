"""
Fee notification totals and report labels are per section.

Class 2 has sections A and B sharing one master class. Grouping by the
Student.class_obj snapshot pooled both into one "Class 2" total, and a section
A class teacher was sent section B's overdue amounts too.
"""
from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from academic_sessions.models import AcademicYear, SessionClass, StudentEnrollment
from academics.models import ClassTeacherAssignment
from finance.models import FeePayment, MonthlyFeeCategory
from hr.models import StaffMember
from notifications.models import NotificationLog
from notifications.triggers import trigger_fee_overdue_in_app, trigger_fee_pending_in_app
from reports.generators.fee import FeeCollectionReportGenerator
from schools.models import Organization, School, UserSchoolMembership
from students.models import Class, Student

User = get_user_model()


class TestFeeTotalsPerSection(TestCase):
    @classmethod
    def setUpTestData(cls):
        org = Organization.objects.create(name='Notif Org', slug='notif-section-org')
        cls.school = School.objects.create(organization=org, name='Notif School', subdomain='notif-section-school')
        cls.year = AcademicYear.objects.create(
            school=cls.school, name='2026-2027',
            start_date=date(2026, 4, 1), end_date=date(2027, 3, 31),
            is_current=True, is_active=True,
        )
        cls.master = Class.objects.create(school=cls.school, name='Class 2', grade_level=4)
        cls.section_a = SessionClass.objects.create(
            school=cls.school, academic_year=cls.year, class_obj=cls.master,
            display_name='Class 2', section='A', grade_level=4,
        )
        cls.section_b = SessionClass.objects.create(
            school=cls.school, academic_year=cls.year, class_obj=cls.master,
            display_name='Class 2', section='B', grade_level=4,
        )
        category = MonthlyFeeCategory.objects.create(school=cls.school, name='Tuition', is_active=True)

        for name, section, due in (('A One', cls.section_a, '1000'), ('B One', cls.section_b, '3000')):
            student = Student.objects.create(school=cls.school, class_obj=cls.master, name=name, roll_number='1')
            StudentEnrollment.objects.create(
                school=cls.school, student=student, academic_year=cls.year,
                class_obj=cls.master, session_class=section, roll_number='1',
                status='ACTIVE', is_active=True,
            )
            FeePayment.objects.create(
                school=cls.school, student=student, academic_year=cls.year,
                fee_type='MONTHLY', monthly_category=category,
                month=5, year=2026, amount_due=Decimal(due), amount_paid=Decimal('0'),
            )

        admin = User.objects.create_user(
            username='notif_admin', email='notif_admin@test.com', password='test12345', role='SCHOOL_ADMIN',
        )
        UserSchoolMembership.objects.create(user=admin, school=cls.school, role='SCHOOL_ADMIN', is_default=True)
        cls.admin = admin

        cls.teacher_a = User.objects.create_user(
            username='notif_teacher_a', email='notif_teacher_a@test.com', password='test12345', role='TEACHER',
        )
        staff = StaffMember.objects.create(
            school=cls.school, user=cls.teacher_a, first_name='Teacher', last_name='A', employee_id='NTA',
        )
        ClassTeacherAssignment.objects.create(
            school=cls.school, academic_year=cls.year, session_class=cls.section_a,
            class_obj=cls.master, teacher=staff,
        )

    def _titles_and_bodies(self, user, event_type):
        return list(
            NotificationLog.objects.filter(recipient_user=user, event_type=event_type)
            .values_list('title', 'body')
        )

    def test_fee_pending_admin_totals_are_per_section(self):
        trigger_fee_pending_in_app(self.school, month=5, year=2026)

        titles = sorted(t for t, _ in self._titles_and_bodies(self.admin, 'FEE_DUE'))
        self.assertEqual(titles, ['Fee Pending — Class 2 - A', 'Fee Pending — Class 2 - B'])

    def test_fee_overdue_section_teacher_gets_only_their_section(self):
        trigger_fee_overdue_in_app(self.school, as_of=date(2026, 7, 1))

        sent = self._titles_and_bodies(self.teacher_a, 'FEE_OVERDUE')
        self.assertEqual(len(sent), 1)
        title, body = sent[0]
        self.assertIn('Class 2 - A', title)
        self.assertIn('Rs 1,000', body)

    def test_defaulters_report_lists_fully_unpaid_students(self):
        from reports.generators.fee import FeeDefaultersReportGenerator

        data = FeeDefaultersReportGenerator(self.school, {
            'month': 5, 'year': 2026, 'academic_year': self.year.id,
        }).get_data()

        self.assertEqual(len(data['table_rows']), 2)

    def test_fee_report_rows_are_per_section(self):
        report = FeeCollectionReportGenerator(self.school, {
            'month': 5, 'year': 2026, 'academic_year': self.year.id,
        })

        data = report.get_data()

        labels = sorted(str(row[0]) for row in data['table_rows'])
        self.assertEqual(labels, ['Class 2 - A', 'Class 2 - B'])
