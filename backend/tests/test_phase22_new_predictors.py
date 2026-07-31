"""
Phase 22 — new AI predictors: Academic Risk, Admissions Conversion Likelihood,
HR Staff Risk, Inventory Reorder Prediction, and the composite Student Risk
Score. Density matches TestAttendanceRiskService in test_phase1_sessions.py —
smoke coverage plus one severity-classification case per service, not exhaustive.
"""

from datetime import date, timedelta

import pytest


@pytest.mark.django_db
class TestAcademicRiskService:
    """Academic Risk Predictor — examinations app."""

    def test_risk_report_returns_dict(self, seed_data, api):
        from examinations.academic_risk_service import AcademicRiskService

        svc = AcademicRiskService(seed_data['SID_A'], seed_data['academic_year'].id)
        report = svc.get_at_risk_students()
        assert isinstance(report, dict)
        assert 'students' in report
        assert 'total_students' in report

    def test_failing_trend_flags_student_high(self, seed_data, api):
        from academic_sessions.models import Term
        from examinations.models import ExamType, ExamGroup, Exam, ExamSubject, StudentMark
        from examinations.academic_risk_service import AcademicRiskService
        from academics.models import Subject

        school_a = seed_data['school_a']
        ay = seed_data['academic_year']
        term1 = Term.objects.get(school=school_a, academic_year=ay, order=1)
        student = seed_data['students'][0]
        subject = Subject.objects.filter(school=school_a).first()
        exam_type = ExamType.objects.create(school=school_a, name='PYTEST_Midterm')

        for i, start_offset in enumerate([60, 30]):
            exam = Exam.objects.create(
                school=school_a, academic_year=ay, term=term1, exam_type=exam_type,
                class_obj=student.class_obj, name=f'PYTEST_Exam_{i}',
                start_date=date.today() - timedelta(days=start_offset),
                status='COMPLETED',
            )
            exam_subject = ExamSubject.objects.create(
                school=school_a, exam=exam, subject=subject,
                total_marks=100, passing_marks=40,
            )
            # Declining, failing marks: 35% then 20%.
            StudentMark.objects.create(
                school=school_a, exam_subject=exam_subject, student=student,
                marks_obtained=35 - (i * 15), is_absent=False,
            )

        svc = AcademicRiskService(seed_data['SID_A'], ay.id)
        report = svc.get_at_risk_students(threshold=40.0)
        flagged = {s['student_id']: s for s in report['students']}
        assert student.id in flagged
        assert flagged[student.id]['severity'] == 'HIGH'


@pytest.mark.django_db
@pytest.mark.phase15
class TestConversionLikelihoodService:
    """Admissions Conversion Likelihood scoring."""

    def test_scored_enquiries_returns_dict(self, seed_data, api):
        from admissions.conversion_likelihood_service import ConversionLikelihoodService

        svc = ConversionLikelihoodService(seed_data['SID_A'])
        report = svc.get_scored_enquiries()
        assert isinstance(report, dict)
        assert 'enquiries' in report
        assert 'total_open' in report

    def test_overdue_followup_no_activity_scores_low(self, seed_data, api):
        from admissions.models import AdmissionEnquiry
        from admissions.conversion_likelihood_service import ConversionLikelihoodService

        enquiry = AdmissionEnquiry.objects.create(
            school=seed_data['school_a'],
            name='PYTEST_Cold Lead', father_name='PYTEST_Father', mobile='0300000000',
            source='OTHER', status='NEW',
            next_followup_date=date.today() - timedelta(days=30),
        )

        svc = ConversionLikelihoodService(seed_data['SID_A'])
        report = svc.get_scored_enquiries()
        scored = {e['enquiry_id']: e for e in report['enquiries']}
        assert enquiry.id in scored
        assert scored[enquiry.id]['likelihood'] == 'LOW'


@pytest.mark.django_db
@pytest.mark.phase5
class TestStaffRiskService:
    """HR Staff Attrition / Leave-Abuse Risk."""

    def test_risk_report_returns_dict(self, seed_data, api):
        from hr.staff_risk_service import StaffRiskService

        svc = StaffRiskService(seed_data['SID_A'])
        report = svc.get_at_risk_staff()
        assert isinstance(report, dict)
        assert 'staff' in report
        assert 'total_staff' in report

    def test_consecutive_absence_streak_flags_staff(self, seed_data, api):
        from hr.models import StaffAttendance
        from hr.staff_risk_service import StaffRiskService

        staff = seed_data['staff'][0]
        today = date.today()
        for i in range(6):
            StaffAttendance.objects.create(
                school=seed_data['school_a'], staff_member=staff,
                date=today - timedelta(days=i), status='ABSENT',
            )

        svc = StaffRiskService(seed_data['SID_A'])
        report = svc.get_at_risk_staff()
        flagged = {s['staff_id']: s for s in report['staff']}
        assert staff.id in flagged
        assert flagged[staff.id]['severity'] == 'HIGH'


@pytest.mark.django_db
class TestReorderPredictionService:
    """Inventory Reorder Prediction."""

    def test_reorder_report_returns_dict(self, seed_data, api):
        from inventory.reorder_prediction_service import ReorderPredictionService

        svc = ReorderPredictionService(seed_data['SID_A'])
        report = svc.get_items_to_reorder()
        assert isinstance(report, dict)
        assert 'items' in report
        assert 'total_items' in report

    def test_low_stock_item_flagged_high(self, seed_data, api):
        from inventory.models import InventoryCategory, InventoryItem
        from inventory.reorder_prediction_service import ReorderPredictionService

        category = InventoryCategory.objects.create(school=seed_data['school_a'], name='PYTEST_Stationery')
        item = InventoryItem.objects.create(
            school=seed_data['school_a'], category=category,
            name='PYTEST_Marker', current_stock=2, minimum_stock=10,
        )

        svc = ReorderPredictionService(seed_data['SID_A'])
        report = svc.get_items_to_reorder()
        flagged = {i['item_id']: i for i in report['items']}
        assert item.id in flagged
        assert flagged[item.id]['severity'] == 'HIGH'


@pytest.mark.django_db
class TestStudentRiskScoreService:
    """Composite Student Risk Score."""

    def test_risk_score_returns_dict(self, seed_data, api):
        from academic_sessions.student_risk_score_service import StudentRiskScoreService

        svc = StudentRiskScoreService(seed_data['SID_A'], seed_data['academic_year'].id)
        report = svc.get_student_risk_scores()
        assert isinstance(report, dict)
        assert 'students' in report
        assert 'total_students' in report
        assert 'risk_levels' in report
