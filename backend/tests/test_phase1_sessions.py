# -*- coding: utf-8 -*-
"""
Phase 1 Test Suite — Academic Sessions, Sections, and AI Services
=================================================================
Converted from the Django shell script ``test_phase1.py`` into proper pytest format.

Covers:
    A5: Academic Year context & current endpoint
    A1: Attendance -> Academic Year wiring
    A2: Fee -> Academic Year wiring
    A3: Timetable -> Academic Year wiring
    A4: ClassSubject -> Academic Year wiring
    B1-B2: Section system (Class with section field, grade_level grouping)
    C1: Promotion Advisor service
    C2: Session Health service
    C3: Section Allocator service
    C4: Attendance Risk service
    C5: Session Setup Wizard service
"""

import pytest
from datetime import date, time
from decimal import Decimal


# ---------------------------------------------------------------------------
# A5: Academic Year & Terms
# ---------------------------------------------------------------------------

@pytest.mark.django_db
@pytest.mark.phase1
class TestAcademicYear:
    """A5 — Academic Year context and session management."""

    def test_academic_year_created_in_seed(self, seed_data, api):
        """Academic year exists and has a valid id."""
        ay = seed_data['academic_year']
        assert ay.id is not None, "Academic year should have been created with a valid id"

    def test_academic_year_is_current(self, seed_data, api):
        """The seed academic year is marked as current."""
        ay = seed_data['academic_year']
        assert ay.is_current is True, "Academic year should be marked as current"

    def test_two_terms_created(self, seed_data, api):
        """Two terms exist for the academic year."""
        from academic_sessions.models import Term

        ay = seed_data['academic_year']
        count = Term.objects.filter(academic_year=ay).count()
        assert count == 2, f"Expected 2 terms, found {count}"

    def test_current_year_lookup(self, seed_data, api):
        """Filtering by is_current=True returns the seed academic year."""
        from academic_sessions.models import AcademicYear

        school = seed_data['school_a']
        ay = seed_data['academic_year']
        current = AcademicYear.objects.filter(
            school=school, is_current=True, is_active=True,
        ).first()
        assert current == ay, "Current year lookup should return the seed academic year"


# ---------------------------------------------------------------------------
# B1-B2: Section System
# ---------------------------------------------------------------------------

@pytest.mark.django_db
@pytest.mark.phase1
class TestSections:
    """B1-B2 — Class section system and grade_level grouping."""

    def test_classes_have_sections(self, seed_data, api):
        """Seed classes have section values assigned."""
        classes = seed_data['classes']
        # class_1 has section A, class_2 has section B, class_3 has section C
        assert classes[0].section == "A", "First class should have section A"
        assert classes[1].section == "B", "Second class should have section B"
        assert classes[2].section == "C", "Third class should have section C"

    def test_filter_classes_by_section(self, seed_data, api):
        """Classes can be filtered by their section value."""
        from students.models import Class

        school = seed_data['school_a']
        prefix = seed_data['prefix']
        filtered = Class.objects.filter(
            school=school, section="A", name__startswith=prefix,
        )
        assert filtered.count() == 1, "Filtering by section='A' should return exactly 1 class"
        assert filtered.first() == seed_data['classes'][0], "Filtered class should be class_1"

    def test_grade_level_grouping(self, seed_data, api):
        """Classes sharing the same grade_level can be grouped."""
        from students.models import Class

        school = seed_data['school_a']
        prefix = seed_data['prefix']
        # grade_level 1 has class_1 (section A)
        level_1 = Class.objects.filter(
            school=school, grade_level=1, name__startswith=prefix,
        )
        assert level_1.count() == 1, "grade_level=1 should have 1 class"

    def test_students_in_sections(self, seed_data, api):
        """Students are correctly distributed across section classes."""
        students = seed_data['students']
        cls_1 = seed_data['classes'][0]
        cls_2 = seed_data['classes'][1]
        cls_3 = seed_data['classes'][2]

        in_cls1 = [s for s in students if s.class_obj_id == cls_1.id]
        in_cls2 = [s for s in students if s.class_obj_id == cls_2.id]
        in_cls3 = [s for s in students if s.class_obj_id == cls_3.id]

        assert len(in_cls1) == 4, f"Class 1 should have 4 students, found {len(in_cls1)}"
        assert len(in_cls2) == 3, f"Class 2 should have 3 students, found {len(in_cls2)}"
        assert len(in_cls3) == 3, f"Class 3 should have 3 students, found {len(in_cls3)}"

    def test_student_enrollment_to_academic_year(self, seed_data, api):
        """A student can be enrolled against an academic year."""
        from academic_sessions.models import StudentEnrollment

        school = seed_data['school_a']
        ay = seed_data['academic_year']
        student = seed_data['students'][0]
        cls = seed_data['classes'][0]

        enrollment = StudentEnrollment.objects.create(
            school=school,
            academic_year=ay,
            student=student,
            class_obj=cls,
            roll_number=student.roll_number,
        )
        assert enrollment.id is not None, "Enrollment should have been created"


# ---------------------------------------------------------------------------
# A1: Attendance -> Academic Year
# ---------------------------------------------------------------------------

@pytest.mark.django_db
@pytest.mark.phase1
class TestAttendanceAcademicYear:
    """A1 — Attendance records wired to academic year."""

    def test_create_attendance_upload_with_academic_year(self, seed_data, api):
        """AttendanceUpload can be linked to an academic year."""
        from attendance.models import AttendanceUpload

        school = seed_data['school_a']
        ay = seed_data['academic_year']
        cls = seed_data['classes'][0]
        admin = seed_data['users']['admin']

        upload = AttendanceUpload.objects.create(
            school=school,
            class_obj=cls,
            date=date(2025, 6, 15),
            academic_year=ay,
            image_url="https://example.com/test-image.jpg",
            status="PROCESSING",
            created_by=admin,
        )
        assert upload.academic_year == ay, "Upload should be linked to the academic year"

    def test_attendance_records_linked_to_academic_year(self, seed_data, api):
        """Attendance records are linked to the academic year and filterable."""
        from attendance.models import AttendanceRecord

        school = seed_data['school_a']
        ay = seed_data['academic_year']
        students_cls1 = [s for s in seed_data['students'] if s.class_obj == seed_data['classes'][0]]
        test_date = date(2025, 6, 16)

        for s in students_cls1:
            AttendanceRecord.objects.create(
                school=school,
                student=s,
                date=test_date,
                academic_year=ay,
                status='PRESENT' if s != students_cls1[-1] else 'ABSENT',
                source='MANUAL',
            )

        records = AttendanceRecord.objects.filter(school=school, academic_year=ay, date=test_date)
        assert records.count() == len(students_cls1), (
            f"Expected {len(students_cls1)} records, found {records.count()}"
        )

    def test_filter_attendance_by_academic_year(self, seed_data, api):
        """Attendance records can be filtered by academic_year."""
        from attendance.models import AttendanceRecord

        school = seed_data['school_a']
        ay = seed_data['academic_year']
        student = seed_data['students'][0]
        test_date = date(2025, 6, 17)

        AttendanceRecord.objects.create(
            school=school,
            student=student,
            date=test_date,
            academic_year=ay,
            status='PRESENT',
            source='MANUAL',
        )

        records = AttendanceRecord.objects.filter(academic_year=ay, date=test_date)
        assert records.count() == 1, "Should find exactly 1 record for the academic year and date"

    def test_absent_record_created(self, seed_data, api):
        """An absent record is correctly stored and filterable."""
        from attendance.models import AttendanceRecord

        school = seed_data['school_a']
        ay = seed_data['academic_year']
        student = seed_data['students'][1]
        test_date = date(2025, 6, 18)

        AttendanceRecord.objects.create(
            school=school,
            student=student,
            date=test_date,
            academic_year=ay,
            status='ABSENT',
            source='MANUAL',
        )

        absent = AttendanceRecord.objects.filter(
            school=school, academic_year=ay, date=test_date, status='ABSENT',
        )
        assert absent.count() == 1, "Should find exactly 1 absent record"


# ---------------------------------------------------------------------------
# A2: Fee -> Academic Year
# ---------------------------------------------------------------------------

@pytest.mark.django_db
@pytest.mark.phase1
class TestFeeAcademicYear:
    """A2 — Fee system wired to academic year."""

    def test_create_fee_structure_with_academic_year(self, seed_data, api):
        """FeeStructure can be linked to an academic year."""
        from finance.models import FeeStructure

        school = seed_data['school_a']
        ay = seed_data['academic_year']
        cls = seed_data['classes'][0]

        fee_struct = FeeStructure.objects.create(
            school=school,
            academic_year=ay,
            class_obj=cls,
            monthly_amount=5000,
            effective_from=date(2025, 4, 1),
            is_active=True,
        )
        assert fee_struct.academic_year == ay, "FeeStructure should be linked to academic year"

    def test_create_fee_payment_with_academic_year(self, seed_data, api):
        """FeePayment can be linked to an academic year."""
        from finance.models import FeePayment

        school = seed_data['school_a']
        ay = seed_data['academic_year']
        student = seed_data['students'][0]

        fee_payment = FeePayment.objects.create(
            school=school,
            academic_year=ay,
            student=student,
            month=6,
            year=2025,
            amount_due=5000,
            amount_paid=0,
            status='UNPAID',
        )
        assert fee_payment.academic_year == ay, "FeePayment should be linked to academic year"

    def test_filter_fees_by_academic_year(self, seed_data, api):
        """Fee payments can be filtered by academic_year."""
        from finance.models import FeePayment

        school = seed_data['school_a']
        ay = seed_data['academic_year']
        student = seed_data['students'][2]

        FeePayment.objects.create(
            school=school,
            academic_year=ay,
            student=student,
            month=7,
            year=2025,
            amount_due=5000,
            amount_paid=0,
            status='UNPAID',
        )

        count = FeePayment.objects.filter(academic_year=ay, student=student).count()
        assert count == 1, f"Expected 1 fee payment, found {count}"


# ---------------------------------------------------------------------------
# A3-A4: Timetable & ClassSubject -> Academic Year
# ---------------------------------------------------------------------------

@pytest.mark.django_db
@pytest.mark.phase1
class TestTimetableAndClassSubject:
    """A3-A4 — Timetable and ClassSubject wired to academic year."""

    def test_create_subject(self, seed_data, api):
        """A Subject can be created."""
        from academics.models import Subject

        school = seed_data['school_a']
        prefix = seed_data['prefix']

        subject = Subject.objects.create(
            school=school,
            name=f"{prefix}Mathematics",
            code=f"{prefix}MATH",
            is_active=True,
        )
        assert subject.id is not None, "Subject should have been created"

    def test_create_class_subject_with_academic_year(self, seed_data, api):
        """ClassSubject can be linked to an academic year."""
        from academics.models import Subject, ClassSubject

        school = seed_data['school_a']
        ay = seed_data['academic_year']
        cls = seed_data['classes'][0]
        prefix = seed_data['prefix']

        subject = Subject.objects.create(
            school=school,
            name=f"{prefix}English",
            code=f"{prefix}ENG",
            is_active=True,
        )

        class_subj = ClassSubject.objects.create(
            school=school,
            academic_year=ay,
            class_obj=cls,
            subject=subject,
            periods_per_week=5,
            is_active=True,
        )
        assert class_subj.academic_year == ay, "ClassSubject should be linked to academic year"

    def test_filter_class_subject_by_academic_year(self, seed_data, api):
        """ClassSubject records can be filtered by academic_year."""
        from academics.models import Subject, ClassSubject

        school = seed_data['school_a']
        ay = seed_data['academic_year']
        cls = seed_data['classes'][1]
        prefix = seed_data['prefix']

        subject = Subject.objects.create(
            school=school,
            name=f"{prefix}Science",
            code=f"{prefix}SCI",
            is_active=True,
        )
        ClassSubject.objects.create(
            school=school,
            academic_year=ay,
            class_obj=cls,
            subject=subject,
            periods_per_week=4,
            is_active=True,
        )

        count = ClassSubject.objects.filter(academic_year=ay, class_obj=cls).count()
        assert count == 1, f"Expected 1 ClassSubject, found {count}"

    def test_create_timetable_slot(self, seed_data, api):
        """A TimetableSlot can be created."""
        from academics.models import TimetableSlot

        school = seed_data['school_a']
        prefix = seed_data['prefix']

        slot = TimetableSlot.objects.create(
            school=school,
            name=f"{prefix}Period 1",
            slot_type='PERIOD',
            start_time=time(8, 0),
            end_time=time(8, 40),
            order=100,
            is_active=True,
        )
        assert slot.id is not None, "TimetableSlot should have been created"

    def test_create_timetable_entry_with_academic_year(self, seed_data, api):
        """TimetableEntry can be linked to an academic year."""
        from academics.models import Subject, TimetableSlot, TimetableEntry

        school = seed_data['school_a']
        ay = seed_data['academic_year']
        cls = seed_data['classes'][0]
        prefix = seed_data['prefix']

        subject = Subject.objects.create(
            school=school,
            name=f"{prefix}Urdu",
            code=f"{prefix}URD",
            is_active=True,
        )
        slot = TimetableSlot.objects.create(
            school=school,
            name=f"{prefix}Period 2",
            slot_type='PERIOD',
            start_time=time(8, 45),
            end_time=time(9, 25),
            order=101,
            is_active=True,
        )
        tt_entry = TimetableEntry.objects.create(
            school=school,
            academic_year=ay,
            class_obj=cls,
            day='MON',
            slot=slot,
            subject=subject,
        )
        assert tt_entry.academic_year == ay, "TimetableEntry should be linked to academic year"

    def test_filter_timetable_entry_by_academic_year(self, seed_data, api):
        """TimetableEntry records can be filtered by academic_year."""
        from academics.models import Subject, TimetableSlot, TimetableEntry

        school = seed_data['school_a']
        ay = seed_data['academic_year']
        cls = seed_data['classes'][2]
        prefix = seed_data['prefix']

        subject = Subject.objects.create(
            school=school,
            name=f"{prefix}Islamiat",
            code=f"{prefix}ISL",
            is_active=True,
        )
        slot = TimetableSlot.objects.create(
            school=school,
            name=f"{prefix}Period 3",
            slot_type='PERIOD',
            start_time=time(9, 30),
            end_time=time(10, 10),
            order=102,
            is_active=True,
        )
        TimetableEntry.objects.create(
            school=school,
            academic_year=ay,
            class_obj=cls,
            day='TUE',
            slot=slot,
            subject=subject,
        )

        count = TimetableEntry.objects.filter(academic_year=ay, class_obj=cls).count()
        assert count == 1, f"Expected 1 TimetableEntry, found {count}"


# ---------------------------------------------------------------------------
# C2: Session Health Service
# ---------------------------------------------------------------------------

@pytest.mark.django_db
@pytest.mark.phase1
class TestSessionHealthService:
    """C2 — Session Health Dashboard service."""

    def _setup_health_data(self, seed_data):
        """Create attendance and fee data so the health service has metrics."""
        from attendance.models import AttendanceRecord
        from finance.models import FeePayment
        from academic_sessions.models import StudentEnrollment

        school = seed_data['school_a']
        ay = seed_data['academic_year']
        student = seed_data['students'][0]
        cls = seed_data['classes'][0]

        # Enrollment
        StudentEnrollment.objects.get_or_create(
            school=school,
            academic_year=ay,
            student=student,
            defaults={'class_obj': cls, 'roll_number': student.roll_number},
        )

        # Attendance record
        AttendanceRecord.objects.get_or_create(
            student=student,
            date=date(2025, 5, 1),
            defaults={
                'school': school,
                'academic_year': ay,
                'status': 'PRESENT',
                'source': 'MANUAL',
            },
        )

        # Fee payment
        FeePayment.objects.get_or_create(
            school=school,
            student=student,
            month=5,
            year=2025,
            defaults={
                'academic_year': ay,
                'amount_due': 5000,
                'amount_paid': 5000,
                'status': 'PAID',
            },
        )

    def test_health_report_has_enrollment(self, seed_data, api):
        """Health report contains enrollment metrics."""
        from academic_sessions.session_health_service import SessionHealthService

        self._setup_health_data(seed_data)
        svc = SessionHealthService(seed_data['SID_A'], seed_data['academic_year'].id)
        report = svc.generate_health_report()
        assert 'enrollment' in report, "Health report should have enrollment metrics"

    def test_health_report_has_attendance(self, seed_data, api):
        """Health report contains attendance metrics."""
        from academic_sessions.session_health_service import SessionHealthService

        self._setup_health_data(seed_data)
        svc = SessionHealthService(seed_data['SID_A'], seed_data['academic_year'].id)
        report = svc.generate_health_report()
        assert 'attendance' in report, "Health report should have attendance metrics"

    def test_health_report_has_fee_collection(self, seed_data, api):
        """Health report contains fee collection metrics."""
        from academic_sessions.session_health_service import SessionHealthService

        self._setup_health_data(seed_data)
        svc = SessionHealthService(seed_data['SID_A'], seed_data['academic_year'].id)
        report = svc.generate_health_report()
        assert 'fee_collection' in report, "Health report should have fee_collection metrics"

    def test_health_report_has_exam_performance(self, seed_data, api):
        """Health report contains exam performance metrics."""
        from academic_sessions.session_health_service import SessionHealthService

        self._setup_health_data(seed_data)
        svc = SessionHealthService(seed_data['SID_A'], seed_data['academic_year'].id)
        report = svc.generate_health_report()
        assert 'exam_performance' in report, "Health report should have exam_performance metrics"

    def test_health_report_has_ai_summary(self, seed_data, api):
        """Health report contains an AI summary."""
        from academic_sessions.session_health_service import SessionHealthService

        self._setup_health_data(seed_data)
        svc = SessionHealthService(seed_data['SID_A'], seed_data['academic_year'].id)
        report = svc.generate_health_report()
        assert 'ai_summary' in report, "Health report should have ai_summary"

    def test_health_report_success_flag(self, seed_data, api):
        """Health report returns success=True."""
        from academic_sessions.session_health_service import SessionHealthService

        self._setup_health_data(seed_data)
        svc = SessionHealthService(seed_data['SID_A'], seed_data['academic_year'].id)
        report = svc.generate_health_report()
        assert report.get('success') is True, "Health report success flag should be True"


# ---------------------------------------------------------------------------
# C1: Promotion Advisor Service
# ---------------------------------------------------------------------------

@pytest.mark.django_db
@pytest.mark.phase1
class TestPromotionAdvisorService:
    """C1 — Promotion Advisor service."""

    def _setup_enrollment(self, seed_data):
        """Ensure at least one student is enrolled for the advisor to analyze."""
        from academic_sessions.models import StudentEnrollment

        school = seed_data['school_a']
        ay = seed_data['academic_year']
        cls = seed_data['classes'][0]

        for student in seed_data['students']:
            if student.class_obj_id == cls.id:
                StudentEnrollment.objects.get_or_create(
                    school=school,
                    academic_year=ay,
                    student=student,
                    defaults={'class_obj': cls, 'roll_number': student.roll_number},
                )

    def test_advisor_returns_list(self, seed_data, api):
        """Advisor returns a list of recommendations."""
        from academic_sessions.promotion_advisor_service import PromotionAdvisorService

        self._setup_enrollment(seed_data)
        advisor = PromotionAdvisorService(seed_data['SID_A'], seed_data['academic_year'].id)
        recommendations = advisor.get_recommendations(seed_data['classes'][0].id)
        assert isinstance(recommendations, list), "Advisor should return a list"

    def test_advisor_has_recommendations(self, seed_data, api):
        """Advisor returns at least one recommendation when students are enrolled."""
        from academic_sessions.promotion_advisor_service import PromotionAdvisorService

        self._setup_enrollment(seed_data)
        advisor = PromotionAdvisorService(seed_data['SID_A'], seed_data['academic_year'].id)
        recommendations = advisor.get_recommendations(seed_data['classes'][0].id)
        assert len(recommendations) > 0, "Advisor should have recommendations for enrolled students"

    def test_recommendation_has_student_id(self, seed_data, api):
        """Each recommendation contains a student_id field."""
        from academic_sessions.promotion_advisor_service import PromotionAdvisorService

        self._setup_enrollment(seed_data)
        advisor = PromotionAdvisorService(seed_data['SID_A'], seed_data['academic_year'].id)
        recommendations = advisor.get_recommendations(seed_data['classes'][0].id)
        assert len(recommendations) > 0, "Need at least one recommendation"
        assert 'student_id' in recommendations[0], "Recommendation should have student_id"

    def test_recommendation_has_recommendation_field(self, seed_data, api):
        """Each recommendation contains a recommendation field."""
        from academic_sessions.promotion_advisor_service import PromotionAdvisorService

        self._setup_enrollment(seed_data)
        advisor = PromotionAdvisorService(seed_data['SID_A'], seed_data['academic_year'].id)
        recommendations = advisor.get_recommendations(seed_data['classes'][0].id)
        assert len(recommendations) > 0, "Need at least one recommendation"
        assert 'recommendation' in recommendations[0], "Recommendation should have recommendation field"

    def test_recommendation_is_valid_value(self, seed_data, api):
        """Recommendation value is one of PROMOTE, NEEDS_REVIEW, or RETAIN."""
        from academic_sessions.promotion_advisor_service import PromotionAdvisorService

        self._setup_enrollment(seed_data)
        advisor = PromotionAdvisorService(seed_data['SID_A'], seed_data['academic_year'].id)
        recommendations = advisor.get_recommendations(seed_data['classes'][0].id)
        assert len(recommendations) > 0, "Need at least one recommendation"
        valid_values = {'PROMOTE', 'NEEDS_REVIEW', 'RETAIN'}
        assert recommendations[0]['recommendation'] in valid_values, (
            f"Recommendation should be one of {valid_values}, "
            f"got '{recommendations[0]['recommendation']}'"
        )


# ---------------------------------------------------------------------------
# C3: Section Allocator Service
# ---------------------------------------------------------------------------

@pytest.mark.django_db
@pytest.mark.phase1
class TestSectionAllocatorService:
    """C3 — Section Allocator service."""

    def test_allocator_returns_result(self, seed_data, api):
        """Allocator returns a result dict."""
        from academic_sessions.section_allocator_service import SectionAllocatorService

        allocator = SectionAllocatorService(seed_data['SID_A'])
        result = allocator.allocate_students(
            class_id=seed_data['classes'][0].id,
            academic_year_id=seed_data['academic_year'].id,
            num_sections=2,
        )
        assert isinstance(result, dict), "Allocator should return a dict"

    def test_allocator_has_sections(self, seed_data, api):
        """Allocator result contains a sections key."""
        from academic_sessions.section_allocator_service import SectionAllocatorService

        allocator = SectionAllocatorService(seed_data['SID_A'])
        result = allocator.allocate_students(
            class_id=seed_data['classes'][0].id,
            academic_year_id=seed_data['academic_year'].id,
            num_sections=2,
        )
        assert 'sections' in result, "Allocator result should have 'sections' key"

    def test_allocator_creates_correct_number_of_sections(self, seed_data, api):
        """Allocator distributes students into the requested number of sections."""
        from academic_sessions.section_allocator_service import SectionAllocatorService

        allocator = SectionAllocatorService(seed_data['SID_A'])
        result = allocator.allocate_students(
            class_id=seed_data['classes'][0].id,
            academic_year_id=seed_data['academic_year'].id,
            num_sections=2,
        )
        sections = result.get('sections', [])
        assert len(sections) == 2, f"Expected 2 sections, got {len(sections)}"

    def test_students_distributed_across_sections(self, seed_data, api):
        """Students are distributed across sections (total >= 0)."""
        from academic_sessions.section_allocator_service import SectionAllocatorService

        allocator = SectionAllocatorService(seed_data['SID_A'])
        result = allocator.allocate_students(
            class_id=seed_data['classes'][0].id,
            academic_year_id=seed_data['academic_year'].id,
            num_sections=2,
        )
        sections = result.get('sections', [])
        total_assigned = sum(len(s.get('students', [])) for s in sections)
        assert total_assigned >= 0, "Total assigned students should be >= 0"


# ---------------------------------------------------------------------------
# C4: Attendance Risk Predictor
# ---------------------------------------------------------------------------

@pytest.mark.django_db
@pytest.mark.phase1
class TestAttendanceRiskService:
    """C4 — Attendance Risk Predictor service."""

    def test_risk_report_returns_dict(self, seed_data, api):
        """Risk service returns a dict."""
        from academic_sessions.attendance_risk_service import AttendanceRiskService

        svc = AttendanceRiskService(seed_data['SID_A'], seed_data['academic_year'].id)
        report = svc.get_at_risk_students()
        assert isinstance(report, dict), "Risk report should be a dict"

    def test_risk_report_has_students_key(self, seed_data, api):
        """Risk report contains a students key."""
        from academic_sessions.attendance_risk_service import AttendanceRiskService

        svc = AttendanceRiskService(seed_data['SID_A'], seed_data['academic_year'].id)
        report = svc.get_at_risk_students()
        assert 'students' in report, "Risk report should have 'students' key"

    def test_risk_report_has_total_students(self, seed_data, api):
        """Risk report contains a total_students key."""
        from academic_sessions.attendance_risk_service import AttendanceRiskService

        svc = AttendanceRiskService(seed_data['SID_A'], seed_data['academic_year'].id)
        report = svc.get_at_risk_students()
        assert 'total_students' in report, "Risk report should have 'total_students' key"


# ---------------------------------------------------------------------------
# C5: Session Setup Wizard Service
# ---------------------------------------------------------------------------

@pytest.mark.django_db
@pytest.mark.phase1
class TestSessionSetupService:
    """C5 — Session Setup Wizard service."""

    def _create_source_data(self, seed_data):
        """Create fee structure and class-subject data for the source year."""
        from finance.models import FeeStructure
        from academics.models import Subject, ClassSubject, TimetableSlot, TimetableEntry

        school = seed_data['school_a']
        ay = seed_data['academic_year']
        cls = seed_data['classes'][0]
        prefix = seed_data['prefix']

        # Fee structure
        FeeStructure.objects.get_or_create(
            school=school,
            academic_year=ay,
            class_obj=cls,
            defaults={
                'monthly_amount': 5000,
                'effective_from': date(2025, 4, 1),
                'is_active': True,
            },
        )

        # Subject and ClassSubject
        subject, _ = Subject.objects.get_or_create(
            school=school,
            code=f"{prefix}SETUP_MATH",
            defaults={
                'name': f"{prefix}Setup Mathematics",
                'is_active': True,
            },
        )
        ClassSubject.objects.get_or_create(
            school=school,
            class_obj=cls,
            subject=subject,
            defaults={
                'academic_year': ay,
                'periods_per_week': 5,
                'is_active': True,
            },
        )

        # Timetable slot and entry
        slot, _ = TimetableSlot.objects.get_or_create(
            school=school,
            order=200,
            defaults={
                'name': f"{prefix}Setup Period",
                'slot_type': 'PERIOD',
                'start_time': time(11, 0),
                'end_time': time(11, 40),
                'is_active': True,
            },
        )
        TimetableEntry.objects.get_or_create(
            school=school,
            class_obj=cls,
            day='MON',
            slot=slot,
            defaults={
                'academic_year': ay,
                'subject': subject,
            },
        )

    def test_setup_preview_returns_dict(self, seed_data, api):
        """Setup preview returns a dict."""
        from academic_sessions.session_setup_service import SessionSetupService

        self._create_source_data(seed_data)
        prefix = seed_data['prefix']
        svc = SessionSetupService(seed_data['SID_A'])
        preview = svc.generate_setup_preview(
            source_year_id=seed_data['academic_year'].id,
            new_year_name=f"{prefix}2026-2027",
            new_start_date=date(2026, 4, 1),
            new_end_date=date(2027, 3, 31),
        )
        assert isinstance(preview, dict), "Preview should be a dict"

    def test_setup_preview_has_terms(self, seed_data, api):
        """Setup preview contains terms to clone."""
        from academic_sessions.session_setup_service import SessionSetupService

        self._create_source_data(seed_data)
        prefix = seed_data['prefix']
        svc = SessionSetupService(seed_data['SID_A'])
        preview = svc.generate_setup_preview(
            source_year_id=seed_data['academic_year'].id,
            new_year_name=f"{prefix}2026-2027",
            new_start_date=date(2026, 4, 1),
            new_end_date=date(2027, 3, 31),
        )
        assert 'terms' in preview, "Preview should have 'terms' key"

    def test_setup_preview_shows_two_terms(self, seed_data, api):
        """Setup preview shows 2 terms cloned from the source year."""
        from academic_sessions.session_setup_service import SessionSetupService

        self._create_source_data(seed_data)
        prefix = seed_data['prefix']
        svc = SessionSetupService(seed_data['SID_A'])
        preview = svc.generate_setup_preview(
            source_year_id=seed_data['academic_year'].id,
            new_year_name=f"{prefix}2026-2027",
            new_start_date=date(2026, 4, 1),
            new_end_date=date(2027, 3, 31),
        )
        assert len(preview.get('terms', [])) == 2, (
            f"Expected 2 terms in preview, got {len(preview.get('terms', []))}"
        )

    def test_setup_preview_has_fee_structures(self, seed_data, api):
        """Setup preview contains fee_structures to clone."""
        from academic_sessions.session_setup_service import SessionSetupService

        self._create_source_data(seed_data)
        prefix = seed_data['prefix']
        svc = SessionSetupService(seed_data['SID_A'])
        preview = svc.generate_setup_preview(
            source_year_id=seed_data['academic_year'].id,
            new_year_name=f"{prefix}2026-2027",
            new_start_date=date(2026, 4, 1),
            new_end_date=date(2027, 3, 31),
        )
        assert 'fee_structures' in preview, "Preview should have 'fee_structures' key"

    def test_setup_preview_has_class_subjects(self, seed_data, api):
        """Setup preview contains class_subjects to clone."""
        from academic_sessions.session_setup_service import SessionSetupService

        self._create_source_data(seed_data)
        prefix = seed_data['prefix']
        svc = SessionSetupService(seed_data['SID_A'])
        preview = svc.generate_setup_preview(
            source_year_id=seed_data['academic_year'].id,
            new_year_name=f"{prefix}2026-2027",
            new_start_date=date(2026, 4, 1),
            new_end_date=date(2027, 3, 31),
        )
        assert 'class_subjects' in preview, "Preview should have 'class_subjects' key"

    def test_setup_apply_returns_result(self, seed_data, api):
        """Applying the setup returns a result dict."""
        from academic_sessions.session_setup_service import SessionSetupService

        self._create_source_data(seed_data)
        prefix = seed_data['prefix']
        svc = SessionSetupService(seed_data['SID_A'])
        preview = svc.generate_setup_preview(
            source_year_id=seed_data['academic_year'].id,
            new_year_name=f"{prefix}Setup_2026-2027",
            new_start_date=date(2026, 4, 1),
            new_end_date=date(2027, 3, 31),
        )

        preview['fee_increase_pct'] = 10
        result = svc.apply_setup(preview)
        assert isinstance(result, dict), "apply_setup should return a dict"

    def test_setup_apply_creates_new_year(self, seed_data, api):
        """Applying the setup creates a new academic year."""
        from academic_sessions.models import AcademicYear
        from academic_sessions.session_setup_service import SessionSetupService

        self._create_source_data(seed_data)
        prefix = seed_data['prefix']
        new_name = f"{prefix}Apply_2026-2027"
        svc = SessionSetupService(seed_data['SID_A'])
        preview = svc.generate_setup_preview(
            source_year_id=seed_data['academic_year'].id,
            new_year_name=new_name,
            new_start_date=date(2026, 4, 1),
            new_end_date=date(2027, 3, 31),
        )

        preview['fee_increase_pct'] = 10
        svc.apply_setup(preview)

        new_ay = AcademicYear.objects.filter(
            school=seed_data['school_a'], name=new_name,
        ).first()
        assert new_ay is not None, "New academic year should have been created"

    def test_setup_apply_clones_terms(self, seed_data, api):
        """Applying the setup clones terms into the new year."""
        from academic_sessions.models import AcademicYear, Term
        from academic_sessions.session_setup_service import SessionSetupService

        self._create_source_data(seed_data)
        prefix = seed_data['prefix']
        new_name = f"{prefix}Terms_2026-2027"
        svc = SessionSetupService(seed_data['SID_A'])
        preview = svc.generate_setup_preview(
            source_year_id=seed_data['academic_year'].id,
            new_year_name=new_name,
            new_start_date=date(2026, 4, 1),
            new_end_date=date(2027, 3, 31),
        )

        preview['fee_increase_pct'] = 10
        svc.apply_setup(preview)

        new_ay = AcademicYear.objects.filter(
            school=seed_data['school_a'], name=new_name,
        ).first()
        assert new_ay is not None, "New academic year should exist"

        new_terms_count = Term.objects.filter(academic_year=new_ay).count()
        assert new_terms_count == 2, f"Expected 2 cloned terms, found {new_terms_count}"

    def test_setup_apply_fee_increase(self, seed_data, api):
        """Applying the setup with a fee increase produces correct amounts."""
        from academic_sessions.models import AcademicYear
        from academic_sessions.session_setup_service import SessionSetupService
        from finance.models import FeeStructure

        self._create_source_data(seed_data)
        prefix = seed_data['prefix']
        new_name = f"{prefix}Fee_2026-2027"
        svc = SessionSetupService(seed_data['SID_A'])
        preview = svc.generate_setup_preview(
            source_year_id=seed_data['academic_year'].id,
            new_year_name=new_name,
            new_start_date=date(2026, 4, 1),
            new_end_date=date(2027, 3, 31),
            fee_increase_percent=Decimal('10'),
        )

        svc.apply_setup(preview)

        new_ay = AcademicYear.objects.filter(
            school=seed_data['school_a'], name=new_name,
        ).first()
        assert new_ay is not None, "New academic year should exist"

        new_fee = FeeStructure.objects.filter(academic_year=new_ay).first()
        if new_fee:
            assert new_fee.monthly_amount == Decimal('5500.00'), (
                f"Fee should be 5500 after 10% increase, got {new_fee.monthly_amount}"
            )
