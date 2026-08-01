"""
Phase 6: Examinations Module -- Comprehensive Pytest Suite

Tests: ExamType, Exam, ExamSubject, StudentMark, GradeScale, ReportCard
Roles: SCHOOL_ADMIN (write), PRINCIPAL (write), TEACHER (read-only)

Run:
    cd backend
    pytest tests/test_phase6_examinations.py -v -m phase6
"""

import pytest
from decimal import Decimal

from examinations.models import ExamType, ExamGroup, Exam, ExamSubject, StudentMark, GradeScale
from academic_sessions.models import AcademicYear, StudentEnrollment
from academics.models import ClassSubject, Subject


# ---- Prefix used by this phase (unique to avoid collisions) ----
P6 = "P6EX_"


# ---- Phase-specific fixture: subjects and helper lookups --------

@pytest.fixture
def exam_prereqs(seed_data, api):
    """
    Create phase-specific prerequisite data that the examinations tests need:
    three Subject objects and convenient aliases.
    """
    school_a = seed_data['school_a']
    classes = seed_data['classes']
    terms = seed_data['terms']
    students = seed_data['students']

    subj_math = Subject.objects.create(
        school=school_a, name=f'{P6}Mathematics', code=f'{P6}MATH',
        is_elective=False,
    )
    subj_eng = Subject.objects.create(
        school=school_a, name=f'{P6}English', code=f'{P6}ENG',
        is_elective=False,
    )
    subj_sci = Subject.objects.create(
        school=school_a, name=f'{P6}Science', code=f'{P6}SCI',
        is_elective=False,
    )

    class_1 = classes[0]
    class_2 = classes[1]
    class_3 = classes[2]
    term_1 = terms[0]
    term_2 = terms[1]

    class_1_students = [s for s in students if s.class_obj_id == class_1.id]

    return {
        **seed_data,
        'subj_math': subj_math,
        'subj_eng': subj_eng,
        'subj_sci': subj_sci,
        'class_1': class_1,
        'class_2': class_2,
        'class_3': class_3,
        'term_1': term_1,
        'term_2': term_2,
        'class_1_students': class_1_students,
    }


# ==================================================================
# LEVEL A: EXAM TYPES API
# ==================================================================

@pytest.mark.django_db
@pytest.mark.phase6
class TestExamTypes:

    def test_a1_create_exam_type_admin(self, seed_data, api):
        """A1: Admin can create an exam type."""
        resp = api.post('/api/examinations/exam-types/', {
            'name': f'{P6}Mid Term',
            'weight': '30.00',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, f"status={resp.status_code} body={resp.content[:200]}"

    def test_a2_create_exam_type_principal(self, seed_data, api):
        """A2: Principal can create an exam type."""
        resp = api.post('/api/examinations/exam-types/', {
            'name': f'{P6}Final Exam',
            'weight': '70.00',
        }, seed_data['tokens']['principal'], seed_data['SID_A'])
        assert resp.status_code == 201, f"status={resp.status_code}"

    def test_a3_create_exam_type_teacher_forbidden(self, seed_data, api):
        """A3: Teacher cannot create an exam type -> 403."""
        resp = api.post('/api/examinations/exam-types/', {
            'name': f'{P6}Quiz',
            'weight': '10.00',
        }, seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, f"status={resp.status_code}"

    def test_a4_duplicate_name_rejected(self, seed_data, api):
        """A4: Duplicate exam type name -> 400."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        api.post('/api/examinations/exam-types/', {
            'name': f'{P6}Mid Term', 'weight': '30.00',
        }, token, sid)
        resp = api.post('/api/examinations/exam-types/', {
            'name': f'{P6}Mid Term', 'weight': '30.00',
        }, token, sid)
        assert resp.status_code == 400, f"status={resp.status_code}"

    def test_a5_list_exam_types(self, seed_data, api):
        """A5: List exam types returns created types."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        api.post('/api/examinations/exam-types/', {
            'name': f'{P6}Mid Term', 'weight': '30.00',
        }, token, sid)
        api.post('/api/examinations/exam-types/', {
            'name': f'{P6}Final Exam', 'weight': '70.00',
        }, token, sid)

        resp = api.get('/api/examinations/exam-types/', token, sid)
        assert resp.status_code == 200
        data = resp.json()
        p6_types = [t for t in data if t.get('name', '').startswith(P6)]
        assert len(p6_types) >= 2, f"count={len(p6_types)}"

    def test_a6_retrieve_single_exam_type(self, seed_data, api):
        """A6: Retrieve a single exam type by id."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        api.post('/api/examinations/exam-types/', {
            'name': f'{P6}Mid Term', 'weight': '30.00',
        }, token, sid)
        et = ExamType.objects.filter(school=seed_data['school_a'], name=f'{P6}Mid Term').first()
        assert et is not None, "ExamType was not created"

        resp = api.get(f'/api/examinations/exam-types/{et.id}/', token, sid)
        assert resp.status_code == 200
        assert resp.json().get('name') == f'{P6}Mid Term'

    def test_a7_update_exam_type(self, seed_data, api):
        """A7: Update exam type weight."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        api.post('/api/examinations/exam-types/', {
            'name': f'{P6}Mid Term', 'weight': '30.00',
        }, token, sid)
        et = ExamType.objects.filter(school=seed_data['school_a'], name=f'{P6}Mid Term').first()
        assert et is not None

        resp = api.patch(f'/api/examinations/exam-types/{et.id}/', {
            'weight': '35.00',
        }, token, sid)
        assert resp.status_code == 200, f"status={resp.status_code}"

    def test_a8_soft_delete_exam_type(self, seed_data, api):
        """A8: Soft-delete sets is_active=False."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        et_temp = ExamType.objects.create(
            school=seed_data['school_a'], name=f'{P6}TempType', weight=Decimal('10.00'),
        )
        resp = api.delete(f'/api/examinations/exam-types/{et_temp.id}/', token, sid)
        assert resp.status_code in (200, 204), f"status={resp.status_code}"
        et_temp.refresh_from_db()
        assert et_temp.is_active is False, f"is_active={et_temp.is_active}"

    def test_a9_school_b_isolation(self, seed_data, api):
        """A9: School B sees no School A exam types."""
        token_admin = seed_data['tokens']['admin']
        sid_a = seed_data['SID_A']
        api.post('/api/examinations/exam-types/', {
            'name': f'{P6}Mid Term', 'weight': '30.00',
        }, token_admin, sid_a)

        resp = api.get('/api/examinations/exam-types/',
                       seed_data['tokens']['admin_b'], seed_data['SID_B'])
        assert resp.status_code == 200
        data = resp.json()
        p6_types_b = [t for t in data if t.get('name', '').startswith(P6)]
        assert len(p6_types_b) == 0, f"count={len(p6_types_b)}"


# ==================================================================
# LEVEL B: EXAMS API
# ==================================================================

@pytest.mark.django_db
@pytest.mark.phase6
class TestExams:

    # ---- helpers ----
    def _create_exam_types(self, seed_data, api):
        """Create mid-term and final exam types, return their ids."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school = seed_data['school_a']
        api.post('/api/examinations/exam-types/', {
            'name': f'{P6}Mid Term', 'weight': '30.00',
        }, token, sid)
        api.post('/api/examinations/exam-types/', {
            'name': f'{P6}Final Exam', 'weight': '70.00',
        }, token, sid)
        et_mid = ExamType.objects.filter(school=school, name=f'{P6}Mid Term').first()
        et_final = ExamType.objects.filter(school=school, name=f'{P6}Final Exam').first()
        return et_mid.id, et_final.id

    def test_b1_create_exam_admin(self, exam_prereqs, api):
        """B1: Admin can create an exam."""
        d = exam_prereqs
        et_mid_id, _ = self._create_exam_types(d, api)
        resp = api.post('/api/examinations/exams/', {
            'academic_year': d['academic_year'].id,
            'term': d['term_1'].id,
            'exam_type': et_mid_id,
            'class_obj': d['class_1'].id,
            'name': f'{P6}Mid Term Class 1A',
            'start_date': '2026-03-01',
            'end_date': '2026-03-10',
        }, d['tokens']['admin'], d['SID_A'])
        assert resp.status_code == 201, f"status={resp.status_code} body={resp.content[:200]}"

    def test_b2_create_exam_principal(self, exam_prereqs, api):
        """B2: Principal can create an exam."""
        d = exam_prereqs
        et_mid_id, _ = self._create_exam_types(d, api)
        resp = api.post('/api/examinations/exams/', {
            'academic_year': d['academic_year'].id,
            'term': d['term_1'].id,
            'exam_type': et_mid_id,
            'class_obj': d['class_2'].id,
            'name': f'{P6}Mid Term Class 2B',
            'start_date': '2026-03-01',
            'end_date': '2026-03-10',
        }, d['tokens']['principal'], d['SID_A'])
        assert resp.status_code == 201, f"status={resp.status_code}"

    def test_b3_create_exam_teacher_forbidden(self, exam_prereqs, api):
        """B3: Teacher cannot create an exam -> 403."""
        d = exam_prereqs
        _, et_final_id = self._create_exam_types(d, api)
        resp = api.post('/api/examinations/exams/', {
            'academic_year': d['academic_year'].id,
            'term': d['term_1'].id,
            'exam_type': et_final_id,
            'class_obj': d['class_1'].id,
            'name': f'{P6}Illegal Exam',
            'start_date': '2026-06-01',
            'end_date': '2026-06-10',
        }, d['tokens']['teacher'], d['SID_A'])
        assert resp.status_code == 403, f"status={resp.status_code}"

    def test_b4_start_date_after_end_date_rejected(self, exam_prereqs, api):
        """B4: start_date > end_date -> 400."""
        d = exam_prereqs
        _, et_final_id = self._create_exam_types(d, api)
        resp = api.post('/api/examinations/exams/', {
            'academic_year': d['academic_year'].id,
            'term': d['term_2'].id,
            'exam_type': et_final_id,
            'class_obj': d['class_1'].id,
            'name': f'{P6}Bad Dates',
            'start_date': '2026-06-10',
            'end_date': '2026-06-01',
        }, d['tokens']['admin'], d['SID_A'])
        assert resp.status_code == 400, f"status={resp.status_code}"

    def test_b5_list_exams(self, exam_prereqs, api):
        """B5: List exams returns created exams."""
        d = exam_prereqs
        token = d['tokens']['admin']
        sid = d['SID_A']
        et_mid_id, _ = self._create_exam_types(d, api)
        api.post('/api/examinations/exams/', {
            'academic_year': d['academic_year'].id, 'term': d['term_1'].id,
            'exam_type': et_mid_id, 'class_obj': d['class_1'].id,
            'name': f'{P6}Mid Term Class 1A',
            'start_date': '2026-03-01', 'end_date': '2026-03-10',
        }, token, sid)
        api.post('/api/examinations/exams/', {
            'academic_year': d['academic_year'].id, 'term': d['term_1'].id,
            'exam_type': et_mid_id, 'class_obj': d['class_2'].id,
            'name': f'{P6}Mid Term Class 2B',
            'start_date': '2026-03-01', 'end_date': '2026-03-10',
        }, token, sid)

        resp = api.get('/api/examinations/exams/', token, sid)
        assert resp.status_code == 200
        data = resp.json()
        p6_exams = [e for e in data if e.get('name', '').startswith(P6)]
        assert len(p6_exams) >= 2, f"count={len(p6_exams)}"

    def test_b6_filter_by_class_obj(self, exam_prereqs, api):
        """B6: Filter exams by class_obj."""
        d = exam_prereqs
        token = d['tokens']['admin']
        sid = d['SID_A']
        et_mid_id, _ = self._create_exam_types(d, api)
        api.post('/api/examinations/exams/', {
            'academic_year': d['academic_year'].id, 'term': d['term_1'].id,
            'exam_type': et_mid_id, 'class_obj': d['class_1'].id,
            'name': f'{P6}Mid Term Class 1A',
            'start_date': '2026-03-01', 'end_date': '2026-03-10',
        }, token, sid)

        resp = api.get(f'/api/examinations/exams/?class_obj={d["class_1"].id}', token, sid)
        assert resp.status_code == 200
        data = resp.json()
        p6_filtered = [e for e in data if e.get('name', '').startswith(P6)]
        assert len(p6_filtered) >= 1, f"count={len(p6_filtered)}"

    def test_b7_filter_by_exam_type(self, exam_prereqs, api):
        """B7: Filter exams by exam_type."""
        d = exam_prereqs
        token = d['tokens']['admin']
        sid = d['SID_A']
        et_mid_id, _ = self._create_exam_types(d, api)
        api.post('/api/examinations/exams/', {
            'academic_year': d['academic_year'].id, 'term': d['term_1'].id,
            'exam_type': et_mid_id, 'class_obj': d['class_1'].id,
            'name': f'{P6}Mid Term Class 1A',
            'start_date': '2026-03-01', 'end_date': '2026-03-10',
        }, token, sid)

        resp = api.get(f'/api/examinations/exams/?exam_type={et_mid_id}', token, sid)
        assert resp.status_code == 200
        data = resp.json()
        p6_filtered = [e for e in data if e.get('name', '').startswith(P6)]
        assert len(p6_filtered) >= 1, f"count={len(p6_filtered)}"

    def test_b8_filter_by_status(self, exam_prereqs, api):
        """B8: Filter exams by status=SCHEDULED."""
        d = exam_prereqs
        token = d['tokens']['admin']
        sid = d['SID_A']
        et_mid_id, _ = self._create_exam_types(d, api)
        api.post('/api/examinations/exams/', {
            'academic_year': d['academic_year'].id, 'term': d['term_1'].id,
            'exam_type': et_mid_id, 'class_obj': d['class_1'].id,
            'name': f'{P6}Mid Term Class 1A',
            'start_date': '2026-03-01', 'end_date': '2026-03-10',
        }, token, sid)

        resp = api.get('/api/examinations/exams/?status=SCHEDULED', token, sid)
        assert resp.status_code == 200
        data = resp.json()
        p6_scheduled = [e for e in data if e.get('name', '').startswith(P6)]
        assert len(p6_scheduled) >= 1, f"count={len(p6_scheduled)}"

    def test_b9_retrieve_single_exam(self, exam_prereqs, api):
        """B9: Retrieve a single exam, check exam_type_name."""
        d = exam_prereqs
        token = d['tokens']['admin']
        sid = d['SID_A']
        et_mid_id, _ = self._create_exam_types(d, api)
        api.post('/api/examinations/exams/', {
            'academic_year': d['academic_year'].id, 'term': d['term_1'].id,
            'exam_type': et_mid_id, 'class_obj': d['class_1'].id,
            'name': f'{P6}Mid Term Class 1A',
            'start_date': '2026-03-01', 'end_date': '2026-03-10',
        }, token, sid)
        exam = Exam.objects.filter(school=d['school_a'], name=f'{P6}Mid Term Class 1A').first()
        assert exam is not None

        resp = api.get(f'/api/examinations/exams/{exam.id}/', token, sid)
        assert resp.status_code == 200
        assert resp.json().get('exam_type_name') == f'{P6}Mid Term'

    def test_b10_update_exam(self, exam_prereqs, api):
        """B10: Update exam status to MARKS_ENTRY."""
        d = exam_prereqs
        token = d['tokens']['admin']
        sid = d['SID_A']
        et_mid_id, _ = self._create_exam_types(d, api)
        api.post('/api/examinations/exams/', {
            'academic_year': d['academic_year'].id, 'term': d['term_1'].id,
            'exam_type': et_mid_id, 'class_obj': d['class_1'].id,
            'name': f'{P6}Mid Term Class 1A',
            'start_date': '2026-03-01', 'end_date': '2026-03-10',
        }, token, sid)
        exam = Exam.objects.filter(school=d['school_a'], name=f'{P6}Mid Term Class 1A').first()
        assert exam is not None

        resp = api.patch(f'/api/examinations/exams/{exam.id}/', {
            'status': 'MARKS_ENTRY',
        }, token, sid)
        assert resp.status_code == 200, f"status={resp.status_code}"

    def test_b11_publish_exam(self, exam_prereqs, api):
        """B11: Publish exam via action endpoint."""
        d = exam_prereqs
        token = d['tokens']['admin']
        sid = d['SID_A']
        _, et_final_id = self._create_exam_types(d, api)
        api.post('/api/examinations/exams/', {
            'academic_year': d['academic_year'].id, 'term': d['term_2'].id,
            'exam_type': et_final_id, 'class_obj': d['class_1'].id,
            'name': f'{P6}Final Exam Class 1A',
            'start_date': '2026-06-01', 'end_date': '2026-06-10',
        }, token, sid)
        exam = Exam.objects.filter(school=d['school_a'], name=f'{P6}Final Exam Class 1A').first()
        assert exam is not None

        resp = api.post(f'/api/examinations/exams/{exam.id}/publish/', {}, token, sid)
        data = resp.json() if resp.status_code == 200 else {}
        assert resp.status_code == 200, f"status={resp.status_code}"
        assert data.get('status') == 'PUBLISHED', f"exam_status={data.get('status')}"

    def test_b12_soft_delete_exam(self, exam_prereqs, api):
        """B12: Soft-delete sets is_active=False."""
        d = exam_prereqs
        token = d['tokens']['admin']
        sid = d['SID_A']
        et_mid_id, _ = self._create_exam_types(d, api)
        exam_temp = Exam.objects.create(
            school=d['school_a'], academic_year=d['academic_year'], term=d['term_2'],
            exam_type=ExamType.objects.get(id=et_mid_id), class_obj=d['class_2'],
            name=f'{P6}TempExam', status='SCHEDULED',
        )
        resp = api.delete(f'/api/examinations/exams/{exam_temp.id}/', token, sid)
        assert resp.status_code in (200, 204), f"status={resp.status_code}"
        exam_temp.refresh_from_db()
        assert exam_temp.is_active is False, f"is_active={exam_temp.is_active}"

    def test_b13_duplicate_standalone_tests_allowed(self, exam_prereqs, api):
        """B13: Standalone tests can share exam_type+class+term when they differ by subject."""
        d = exam_prereqs
        token = d['tokens']['admin']
        sid = d['SID_A']
        et_mid_id, _ = self._create_exam_types(d, api)
        # Create the first exam
        api.post('/api/examinations/exams/', {
            'academic_year': d['academic_year'].id, 'term': d['term_1'].id,
            'exam_type': et_mid_id, 'class_obj': d['class_1'].id,
            'name': f'{P6}Mid Term Class 1A',
            'start_date': '2026-03-01', 'end_date': '2026-03-10',
        }, token, sid)
        # Attempt duplicate
        resp = api.post('/api/examinations/exams/', {
            'academic_year': d['academic_year'].id, 'term': d['term_1'].id,
            'exam_type': et_mid_id, 'class_obj': d['class_1'].id,
            'name': f'{P6}Duplicate Exam',
            'start_date': '2026-03-15', 'end_date': '2026-03-20',
        }, token, sid)
        assert resp.status_code == 201, f"status={resp.status_code} body={resp.content[:200]}"

    def test_b14_school_b_isolation(self, exam_prereqs, api):
        """B14: School B sees no School A exams."""
        d = exam_prereqs
        et_mid_id, _ = self._create_exam_types(d, api)
        api.post('/api/examinations/exams/', {
            'academic_year': d['academic_year'].id, 'term': d['term_1'].id,
            'exam_type': et_mid_id, 'class_obj': d['class_1'].id,
            'name': f'{P6}Mid Term Class 1A',
            'start_date': '2026-03-01', 'end_date': '2026-03-10',
        }, d['tokens']['admin'], d['SID_A'])

        resp = api.get('/api/examinations/exams/', d['tokens']['admin_b'], d['SID_B'])
        assert resp.status_code == 200
        data = resp.json()
        p6_exams_b = [e for e in data if e.get('name', '').startswith(P6)]
        assert len(p6_exams_b) == 0, f"count={len(p6_exams_b)}"


# ==================================================================
# LEVEL G: EXAM GROUP WIZARD + BULK PUBLISH
#
# Regression coverage for update-date-by-subject / download-date-sheet /
# publish-all, which were previously defined as @action methods on
# StudentResponseViewSet (registered under /student-responses/) instead of
# ExamGroupViewSet (registered under /exam-groups/), making the frontend's
# calls to /exam-groups/{id}/... 404. Also covers publish-all's notification
# fan-out, which previously did a bare status update with no notification.
# ==================================================================

@pytest.mark.django_db
@pytest.mark.phase6
class TestExamGroupWizardAndPublishAll:

    def _create_group_with_two_classes(self, d, api):
        token = d['tokens']['admin']
        sid = d['SID_A']
        school = d['school_a']

        ClassSubject.objects.create(school=school, class_obj=d['class_1'], subject=d['subj_math'])
        ClassSubject.objects.create(school=school, class_obj=d['class_1'], subject=d['subj_eng'])
        ClassSubject.objects.create(school=school, class_obj=d['class_2'], subject=d['subj_math'])

        et = ExamType.objects.create(school=school, name=f'{P6}GroupType', weight=Decimal('50.00'))

        resp = api.post('/api/examinations/exam-groups/wizard-create/', {
            'academic_year': d['academic_year'].id,
            'term': d['term_1'].id,
            'exam_type': et.id,
            'name': f'{P6}Group Wizard Test',
            'class_ids': [d['class_1'].id, d['class_2'].id],
            'default_total_marks': '100',
            'default_passing_marks': '33',
            'start_date': '2026-04-01',
            'end_date': '2026-04-05',
        }, token, sid)
        assert resp.status_code == 201, f"status={resp.status_code} body={resp.content[:300]}"
        return resp.json()

    def test_g1_wizard_create_group_and_subjects(self, exam_prereqs, api):
        """G1: wizard-create builds one Exam per class and ExamSubjects from ClassSubject assignments."""
        d = exam_prereqs
        data = self._create_group_with_two_classes(d, api)
        assert data['exams_created'] == 2, data
        assert data['subjects_created'] == 3, data  # 2 subjects for class_1 + 1 for class_2

        group = ExamGroup.objects.get(id=data['group_id'])
        exams = list(group.exams.all())
        assert len(exams) == 2
        assert {e.class_obj_id for e in exams} == {d['class_1'].id, d['class_2'].id}
        assert all(e.exam_group_id == group.id for e in exams)

    def test_g1b_wizard_create_respects_class_subjects_filter(self, exam_prereqs, api):
        """G1b: an explicit class_subjects entry narrows that class's ExamSubjects to the
        listed subset; a class omitted from class_subjects (test_g1) keeps every ClassSubject
        assigned to it."""
        d = exam_prereqs
        token = d['tokens']['admin']
        sid = d['SID_A']
        school = d['school_a']

        ClassSubject.objects.create(school=school, class_obj=d['class_1'], subject=d['subj_math'])
        ClassSubject.objects.create(school=school, class_obj=d['class_1'], subject=d['subj_eng'])
        ClassSubject.objects.create(school=school, class_obj=d['class_2'], subject=d['subj_math'])

        et = ExamType.objects.create(school=school, name=f'{P6}FilteredType', weight=Decimal('50.00'))
        resp = api.post('/api/examinations/exam-groups/wizard-create/', {
            'academic_year': d['academic_year'].id,
            'term': d['term_1'].id,
            'exam_type': et.id,
            'name': f'{P6}Filtered Group',
            'class_ids': [d['class_1'].id, d['class_2'].id],
            'class_subjects': [
                {'class_id': d['class_1'].id, 'subject_ids': [d['subj_math'].id]},
                {'class_id': d['class_2'].id, 'subject_ids': [d['subj_math'].id]},
            ],
            'default_total_marks': '100',
            'default_passing_marks': '33',
            'start_date': '2026-04-01',
            'end_date': '2026-04-05',
        }, token, sid)
        assert resp.status_code == 201, f"status={resp.status_code} body={resp.content[:300]}"
        data = resp.json()

        # Only Math for each of the 2 classes -- English is excluded even though
        # class_1 has it assigned, because it wasn't listed for class_1.
        assert data['subjects_created'] == 2, data

        group = ExamGroup.objects.get(id=data['group_id'])
        subjects_in_group = set(
            ExamSubject.objects.filter(exam__exam_group=group).values_list('subject_id', flat=True)
        )
        assert subjects_in_group == {d['subj_math'].id}, subjects_in_group

    def test_g1c_wizard_create_class_subjects_are_independent_per_class(self, exam_prereqs, api):
        """G1c: two classes sharing a subject can be filtered independently -- class_1 keeps
        only English, class_2 keeps only Math, even though both classes have Math assigned."""
        d = exam_prereqs
        token = d['tokens']['admin']
        sid = d['SID_A']
        school = d['school_a']

        ClassSubject.objects.create(school=school, class_obj=d['class_1'], subject=d['subj_math'])
        ClassSubject.objects.create(school=school, class_obj=d['class_1'], subject=d['subj_eng'])
        ClassSubject.objects.create(school=school, class_obj=d['class_2'], subject=d['subj_math'])

        et = ExamType.objects.create(school=school, name=f'{P6}IndependentType', weight=Decimal('50.00'))
        resp = api.post('/api/examinations/exam-groups/wizard-create/', {
            'academic_year': d['academic_year'].id,
            'term': d['term_1'].id,
            'exam_type': et.id,
            'name': f'{P6}Independent Group',
            'class_ids': [d['class_1'].id, d['class_2'].id],
            'class_subjects': [
                {'class_id': d['class_1'].id, 'subject_ids': [d['subj_eng'].id]},
                {'class_id': d['class_2'].id, 'subject_ids': [d['subj_math'].id]},
            ],
            'default_total_marks': '100',
            'default_passing_marks': '33',
            'start_date': '2026-04-01',
            'end_date': '2026-04-05',
        }, token, sid)
        assert resp.status_code == 201, f"status={resp.status_code} body={resp.content[:300]}"
        data = resp.json()
        assert data['subjects_created'] == 2, data

        group = ExamGroup.objects.get(id=data['group_id'])
        exam_1 = group.exams.get(class_obj=d['class_1'])
        exam_2 = group.exams.get(class_obj=d['class_2'])
        assert set(ExamSubject.objects.filter(exam=exam_1).values_list('subject_id', flat=True)) == {d['subj_eng'].id}
        assert set(ExamSubject.objects.filter(exam=exam_2).values_list('subject_id', flat=True)) == {d['subj_math'].id}

    def test_g1d_wizard_create_class_subjects_empty_list_means_zero_subjects(self, exam_prereqs, api):
        """G1d: a class explicitly listed with an empty subject_ids gets zero ExamSubjects --
        distinct from omitting the class entirely, which keeps every ClassSubject (test_g1)."""
        d = exam_prereqs
        token = d['tokens']['admin']
        sid = d['SID_A']
        school = d['school_a']

        ClassSubject.objects.create(school=school, class_obj=d['class_1'], subject=d['subj_math'])
        ClassSubject.objects.create(school=school, class_obj=d['class_2'], subject=d['subj_math'])

        et = ExamType.objects.create(school=school, name=f'{P6}EmptyType', weight=Decimal('50.00'))
        resp = api.post('/api/examinations/exam-groups/wizard-create/', {
            'academic_year': d['academic_year'].id,
            'term': d['term_1'].id,
            'exam_type': et.id,
            'name': f'{P6}Empty Group',
            'class_ids': [d['class_1'].id, d['class_2'].id],
            'class_subjects': [
                {'class_id': d['class_1'].id, 'subject_ids': []},
            ],
            'default_total_marks': '100',
            'default_passing_marks': '33',
            'start_date': '2026-04-01',
            'end_date': '2026-04-05',
        }, token, sid)
        assert resp.status_code == 201, f"status={resp.status_code} body={resp.content[:300]}"
        data = resp.json()

        # class_1 explicitly empty -> 0 subjects; class_2 omitted -> keeps its 1 ClassSubject.
        assert data['subjects_created'] == 1, data
        group = ExamGroup.objects.get(id=data['group_id'])
        exam_1 = group.exams.get(class_obj=d['class_1'])
        assert ExamSubject.objects.filter(exam=exam_1).count() == 0

    def test_g1e_partial_update_end_date_only_does_not_500(self, exam_prereqs, api):
        """G1e: PATCHing just {'end_date': ...} (shrinking the date-sheet range from the
        Calendar view's per-row delete) must not 500 -- ExamGroupCreateSerializer.validate()
        used to access data['name']/data['academic_year'] unconditionally, which KeyErrors
        on any partial update that omits them."""
        d = exam_prereqs
        data = self._create_group_with_two_classes(d, api)
        group_id = data['group_id']
        token = d['tokens']['admin']
        sid = d['SID_A']

        resp = api.patch(f'/api/examinations/exam-groups/{group_id}/', {
            'end_date': '2026-04-04',
        }, token, sid)
        assert resp.status_code == 200, f"status={resp.status_code} body={resp.content[:300]}"
        assert resp.json()['end_date'] == '2026-04-04'

        group = ExamGroup.objects.get(id=group_id)
        assert str(group.end_date) == '2026-04-04'
        assert group.name == f'{P6}Group Wizard Test'  # untouched by the partial update

    def test_g1f_wizard_create_reuses_existing_group_for_a_new_batch_of_classes(self, exam_prereqs, api):
        """G1f: calling wizard-create again with the same name/academic_year/term/exam_type
        but a different set of classes adds those classes into the existing group instead of
        hitting the ExamGroup (school, name, academic_year) unique constraint."""
        d = exam_prereqs
        token = d['tokens']['admin']
        sid = d['SID_A']
        school = d['school_a']

        ClassSubject.objects.create(school=school, class_obj=d['class_1'], subject=d['subj_math'])
        ClassSubject.objects.create(school=school, class_obj=d['class_3'], subject=d['subj_sci'])

        et = ExamType.objects.create(school=school, name=f'{P6}BulkType', weight=Decimal('50.00'))
        payload = {
            'academic_year': d['academic_year'].id,
            'term': d['term_1'].id,
            'exam_type': et.id,
            'name': f'{P6}Bulk Wizard Test',
            'default_total_marks': '100',
            'default_passing_marks': '33',
            'start_date': '2026-04-01',
            'end_date': '2026-04-05',
        }

        resp1 = api.post('/api/examinations/exam-groups/wizard-create/',
                          {**payload, 'class_ids': [d['class_1'].id]}, token, sid)
        assert resp1.status_code == 201, f"status={resp1.status_code} body={resp1.content[:300]}"
        group_id_1 = resp1.json()['group_id']

        resp2 = api.post('/api/examinations/exam-groups/wizard-create/',
                          {**payload, 'class_ids': [d['class_3'].id]}, token, sid)
        assert resp2.status_code == 201, f"status={resp2.status_code} body={resp2.content[:300]}"
        group_id_2 = resp2.json()['group_id']

        assert group_id_1 == group_id_2, "second call should reuse the same group, not fail or fork a new one"
        group = ExamGroup.objects.get(id=group_id_1)
        assert {e.class_obj_id for e in group.exams.all()} == {d['class_1'].id, d['class_3'].id}

    def test_g1g_wizard_create_same_class_twice_still_conflicts(self, exam_prereqs, api):
        """G1g: reusing the group (test_g1f) must not bypass the per-class active-exam
        conflict check -- resubmitting the same class for the same exam type/term is still
        rejected with the friendly 409, not a duplicate Exam."""
        d = exam_prereqs
        token = d['tokens']['admin']
        sid = d['SID_A']
        school = d['school_a']

        ClassSubject.objects.create(school=school, class_obj=d['class_1'], subject=d['subj_math'])

        et = ExamType.objects.create(school=school, name=f'{P6}RepeatType', weight=Decimal('50.00'))
        payload = {
            'academic_year': d['academic_year'].id,
            'term': d['term_1'].id,
            'exam_type': et.id,
            'name': f'{P6}Repeat Wizard Test',
            'class_ids': [d['class_1'].id],
            'default_total_marks': '100',
            'default_passing_marks': '33',
            'start_date': '2026-04-01',
            'end_date': '2026-04-05',
        }

        resp1 = api.post('/api/examinations/exam-groups/wizard-create/', payload, token, sid)
        assert resp1.status_code == 201, f"status={resp1.status_code} body={resp1.content[:300]}"

        resp2 = api.post('/api/examinations/exam-groups/wizard-create/', payload, token, sid)
        assert resp2.status_code == 409, f"status={resp2.status_code} body={resp2.content[:300]}"
        assert resp2.json()['conflicts'][0]['class_id'] == d['class_1'].id

    def test_g1h_wizard_create_same_name_different_exam_type_is_a_friendly_400_not_500(self, exam_prereqs, api):
        """G1h: a same-named group already existing under a different exam type is a genuine
        naming collision -- must surface as a clean 400 with a helpful message, not the raw
        psycopg2 UniqueViolation traceback as an unhandled 500."""
        d = exam_prereqs
        token = d['tokens']['admin']
        sid = d['SID_A']
        school = d['school_a']

        ClassSubject.objects.create(school=school, class_obj=d['class_1'], subject=d['subj_math'])
        ClassSubject.objects.create(school=school, class_obj=d['class_2'], subject=d['subj_math'])

        et_a = ExamType.objects.create(school=school, name=f'{P6}CollideA', weight=Decimal('50.00'))
        et_b = ExamType.objects.create(school=school, name=f'{P6}CollideB', weight=Decimal('50.00'))
        shared_name = f'{P6}Collision Group'

        resp1 = api.post('/api/examinations/exam-groups/wizard-create/', {
            'academic_year': d['academic_year'].id,
            'term': d['term_1'].id,
            'exam_type': et_a.id,
            'name': shared_name,
            'class_ids': [d['class_1'].id],
            'default_total_marks': '100',
            'default_passing_marks': '33',
            'start_date': '2026-04-01',
            'end_date': '2026-04-05',
        }, token, sid)
        assert resp1.status_code == 201, f"status={resp1.status_code} body={resp1.content[:300]}"

        resp2 = api.post('/api/examinations/exam-groups/wizard-create/', {
            'academic_year': d['academic_year'].id,
            'term': d['term_1'].id,
            'exam_type': et_b.id,
            'name': shared_name,
            'class_ids': [d['class_2'].id],
            'default_total_marks': '100',
            'default_passing_marks': '33',
            'start_date': '2026-04-01',
            'end_date': '2026-04-05',
        }, token, sid)
        assert resp2.status_code == 400, f"status={resp2.status_code} body={resp2.content[:300]}"
        assert 'already exists' in resp2.json()['detail']

    def test_g2_group_actions_resolve_under_exam_groups_not_404(self, exam_prereqs, api):
        """G2: download-date-sheet/update-date-by-subject/publish-all resolve under
        /exam-groups/, confirming they are no longer stranded under /student-responses/."""
        d = exam_prereqs
        data = self._create_group_with_two_classes(d, api)
        group_id = data['group_id']
        token = d['tokens']['admin']
        sid = d['SID_A']

        resp = api.get(f'/api/examinations/exam-groups/{group_id}/download-date-sheet/', token, sid)
        assert resp.status_code == 200, f"status={resp.status_code}"
        assert resp['Content-Type'] == 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

        resp = api.post(f'/api/examinations/exam-groups/{group_id}/update-date-by-subject/', {
            'subject_id': d['subj_math'].id, 'exam_date': '2026-04-02',
        }, token, sid)
        assert resp.status_code == 200, f"status={resp.status_code} body={resp.content[:300]}"
        assert resp.json()['updated_count'] == 2  # subj_math appears in both classes

        resp = api.post(f'/api/examinations/exam-groups/{group_id}/publish-all/', {}, token, sid)
        assert resp.status_code == 200, f"status={resp.status_code} body={resp.content[:300]}"

    def test_g3_group_actions_teacher_forbidden(self, exam_prereqs, api):
        """G3: teacher role gets 403 on the relocated actions (ExamGroupViewSet is IsSchoolAdmin-gated,
        same as every other ExamGroup action)."""
        d = exam_prereqs
        data = self._create_group_with_two_classes(d, api)
        group_id = data['group_id']
        token = d['tokens']['teacher']
        sid = d['SID_A']

        resp = api.get(f'/api/examinations/exam-groups/{group_id}/download-date-sheet/', token, sid)
        assert resp.status_code == 403, f"status={resp.status_code}"

        resp = api.post(f'/api/examinations/exam-groups/{group_id}/publish-all/', {}, token, sid)
        assert resp.status_code == 403, f"status={resp.status_code}"

    def test_g4_publish_all_sets_status_on_all_child_exams(self, exam_prereqs, api):
        """G4: publish-all marks every active exam in the group PUBLISHED."""
        d = exam_prereqs
        data = self._create_group_with_two_classes(d, api)
        group_id = data['group_id']
        token = d['tokens']['admin']
        sid = d['SID_A']

        resp = api.post(f'/api/examinations/exam-groups/{group_id}/publish-all/', {}, token, sid)
        assert resp.status_code == 200, f"status={resp.status_code}"
        assert resp.json()['published_count'] == 2

        group = ExamGroup.objects.get(id=group_id)
        statuses = set(group.exams.values_list('status', flat=True))
        assert statuses == {Exam.Status.PUBLISHED}, statuses

    def test_g5_publish_all_notifies_admins_per_exam(self, exam_prereqs, api):
        """G5: publish-all fires the same EXAM_RESULT notification fan-out a single-exam
        publish would, once per exam in the group (not merged into one notification)."""
        from notifications.models import NotificationLog

        d = exam_prereqs
        data = self._create_group_with_two_classes(d, api)
        group_id = data['group_id']
        token = d['tokens']['admin']
        sid = d['SID_A']

        before_count = NotificationLog.objects.filter(
            school=d['school_a'], event_type='EXAM_RESULT',
        ).count()

        resp = api.post(f'/api/examinations/exam-groups/{group_id}/publish-all/', {}, token, sid)
        assert resp.status_code == 200, f"status={resp.status_code}"

        after_count = NotificationLog.objects.filter(
            school=d['school_a'], event_type='EXAM_RESULT',
        ).count()
        # 2 exams in the group x (admin + principal) recipients = 4 notifications minimum
        assert after_count - before_count >= 4, f"before={before_count} after={after_count}"

        # Each of the two exams should have generated its own distinct notification body
        # for the same admin recipient (i.e. not deduped away as "the same notification").
        bodies = set(
            NotificationLog.objects.filter(
                school=d['school_a'], event_type='EXAM_RESULT',
                recipient_user=d['users']['admin'],
            ).values_list('body', flat=True)
        )
        group = ExamGroup.objects.get(id=group_id)
        exam_names = set(group.exams.values_list('name', flat=True))
        assert len(bodies) >= len(exam_names), f"bodies={bodies} exam_names={exam_names}"
        for name in exam_names:
            assert any(name in body for body in bodies), f"no notification body mentions {name!r}: {bodies}"


# ==================================================================
# LEVEL H: DATE SHEET CALENDAR GRID (Excel + PDF exports)
# ==================================================================

@pytest.mark.django_db
@pytest.mark.phase6
class TestDateSheetGrid:

    def _create_group_and_set_dates(self, d, api):
        """Same 2-class/3-subject setup as TestExamGroupWizardAndPublishAll, then
        assigns dates that exercise the grid pivot: two subjects sharing one
        date+class (class_1's Math and English both on 2026-04-01), and one
        subject deliberately left undated (class_2's Math)."""
        from datetime import date

        token = d['tokens']['admin']
        sid = d['SID_A']
        school = d['school_a']

        ClassSubject.objects.create(school=school, class_obj=d['class_1'], subject=d['subj_math'])
        ClassSubject.objects.create(school=school, class_obj=d['class_1'], subject=d['subj_eng'])
        ClassSubject.objects.create(school=school, class_obj=d['class_2'], subject=d['subj_math'])

        et = ExamType.objects.create(school=school, name=f'{P6}GridType', weight=Decimal('50.00'))
        resp = api.post('/api/examinations/exam-groups/wizard-create/', {
            'academic_year': d['academic_year'].id,
            'term': d['term_1'].id,
            'exam_type': et.id,
            'name': f'{P6}Grid Test',
            'class_ids': [d['class_1'].id, d['class_2'].id],
            'default_total_marks': '100',
            'default_passing_marks': '33',
            'start_date': '2026-04-01',
            'end_date': '2026-04-05',
        }, token, sid)
        assert resp.status_code == 201, f"status={resp.status_code} body={resp.content[:300]}"
        group = ExamGroup.objects.get(id=resp.json()['group_id'])

        ExamSubject.objects.filter(
            exam__exam_group=group, exam__class_obj=d['class_1'], subject=d['subj_math'],
        ).update(exam_date=date(2026, 4, 1))
        ExamSubject.objects.filter(
            exam__exam_group=group, exam__class_obj=d['class_1'], subject=d['subj_eng'],
        ).update(exam_date=date(2026, 4, 1))
        # class_2's Math is left with no exam_date on purpose.
        return group

    def test_h1_grid_pivots_dates_to_rows_and_classes_to_columns(self, exam_prereqs, api):
        """H1: one row per distinct date, one column per class, cells hold the
        subject name(s) for that date+class; two subjects sharing a cell are joined."""
        from examinations.views import _build_date_sheet_grid

        d = exam_prereqs
        group = self._create_group_and_set_dates(d, api)

        grid = _build_date_sheet_grid(group, d['school_a'].id)

        assert len(grid['rows']) == 1, grid['rows']
        assert grid['rows'][0]['date'] == '2026-04-01'
        assert grid['rows'][0]['day_name'] == 'Wednesday'

        class_ids = {col['class_id'] for col in grid['columns']}
        assert class_ids == {d['class_1'].id, d['class_2'].id}

        class_1_cell = grid['rows'][0]['cells'][d['class_1'].id]
        assert d['subj_math'].name in class_1_cell
        assert d['subj_eng'].name in class_1_cell

        class_2_cell = grid['rows'][0]['cells'][d['class_2'].id]
        assert class_2_cell == '', f"class_2 has no dated subject, expected blank cell, got {class_2_cell!r}"

    def test_h2_unscheduled_subjects_listed_not_dropped(self, exam_prereqs, api):
        """H2: a subject with no exam_date is reported in 'unscheduled', not silently dropped."""
        from examinations.views import _build_date_sheet_grid

        d = exam_prereqs
        group = self._create_group_and_set_dates(d, api)
        grid = _build_date_sheet_grid(group, d['school_a'].id)

        assert len(grid['unscheduled']) == 1, grid['unscheduled']
        assert grid['unscheduled'][0]['subject_name'] == d['subj_math'].name

    def test_h3_download_excel_grid(self, exam_prereqs, api):
        """H3: Excel export returns a workbook."""
        d = exam_prereqs
        group = self._create_group_and_set_dates(d, api)

        resp = api.get(
            f'/api/examinations/exam-groups/{group.id}/download-date-sheet/',
            d['tokens']['admin'], d['SID_A'],
        )
        assert resp.status_code == 200, f"status={resp.status_code}"
        assert resp['Content-Type'] == 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        assert len(resp.content) > 1000

    def test_h4_download_pdf_grid(self, exam_prereqs, api):
        """H4: PDF export returns a valid PDF."""
        d = exam_prereqs
        group = self._create_group_and_set_dates(d, api)

        resp = api.get(
            f'/api/examinations/exam-groups/{group.id}/download-date-sheet-pdf/',
            d['tokens']['admin'], d['SID_A'],
        )
        assert resp.status_code == 200, f"status={resp.status_code}"
        assert resp['Content-Type'] == 'application/pdf'
        assert resp.content[:4] == b'%PDF'

    def test_h5_pdf_download_teacher_forbidden(self, exam_prereqs, api):
        """H5: same admin-only gate as the other exam-group actions."""
        d = exam_prereqs
        group = self._create_group_and_set_dates(d, api)

        resp = api.get(
            f'/api/examinations/exam-groups/{group.id}/download-date-sheet-pdf/',
            d['tokens']['teacher'], d['SID_A'],
        )
        assert resp.status_code == 403, f"status={resp.status_code}"


# ==================================================================
# LEVEL C: EXAM SUBJECTS API
# ==================================================================

@pytest.mark.django_db
@pytest.mark.phase6
class TestExamSubjects:

    def _setup_exam(self, d, api):
        """Create exam types and an exam, return (exam_mid_1a_id, et_mid_id)."""
        token = d['tokens']['admin']
        sid = d['SID_A']
        school = d['school_a']
        api.post('/api/examinations/exam-types/', {
            'name': f'{P6}Mid Term', 'weight': '30.00',
        }, token, sid)
        et_mid = ExamType.objects.filter(school=school, name=f'{P6}Mid Term').first()
        api.post('/api/examinations/exams/', {
            'academic_year': d['academic_year'].id, 'term': d['term_1'].id,
            'exam_type': et_mid.id, 'class_obj': d['class_1'].id,
            'name': f'{P6}Mid Term Class 1A',
            'start_date': '2026-03-01', 'end_date': '2026-03-10',
        }, token, sid)
        exam = Exam.objects.filter(school=school, name=f'{P6}Mid Term Class 1A').first()
        return exam.id, et_mid.id

    def _setup_exam_with_class2(self, d, api):
        """Create exam types and exams for class_1 and class_2."""
        token = d['tokens']['admin']
        sid = d['SID_A']
        school = d['school_a']
        api.post('/api/examinations/exam-types/', {
            'name': f'{P6}Mid Term', 'weight': '30.00',
        }, token, sid)
        et_mid = ExamType.objects.filter(school=school, name=f'{P6}Mid Term').first()
        api.post('/api/examinations/exams/', {
            'academic_year': d['academic_year'].id, 'term': d['term_1'].id,
            'exam_type': et_mid.id, 'class_obj': d['class_1'].id,
            'name': f'{P6}Mid Term Class 1A',
            'start_date': '2026-03-01', 'end_date': '2026-03-10',
        }, token, sid)
        api.post('/api/examinations/exams/', {
            'academic_year': d['academic_year'].id, 'term': d['term_1'].id,
            'exam_type': et_mid.id, 'class_obj': d['class_2'].id,
            'name': f'{P6}Mid Term Class 2B',
            'start_date': '2026-03-01', 'end_date': '2026-03-10',
        }, token, sid)
        exam_1a = Exam.objects.filter(school=school, name=f'{P6}Mid Term Class 1A').first()
        exam_2b = Exam.objects.filter(school=school, name=f'{P6}Mid Term Class 2B').first()
        return exam_1a.id, exam_2b.id, et_mid.id

    def test_c1_create_exam_subject_admin(self, exam_prereqs, api):
        """C1: Admin can create exam subject."""
        d = exam_prereqs
        exam_id, _ = self._setup_exam(d, api)
        resp = api.post('/api/examinations/exam-subjects/', {
            'exam': exam_id,
            'subject': d['subj_math'].id,
            'total_marks': '100.00',
            'passing_marks': '33.00',
            'exam_date': '2026-03-02',
        }, d['tokens']['admin'], d['SID_A'])
        assert resp.status_code == 201, f"status={resp.status_code} body={resp.content[:200]}"

    def test_c2_create_exam_subject_principal(self, exam_prereqs, api):
        """C2: Principal can create exam subject."""
        d = exam_prereqs
        exam_id, _ = self._setup_exam(d, api)
        resp = api.post('/api/examinations/exam-subjects/', {
            'exam': exam_id,
            'subject': d['subj_eng'].id,
            'total_marks': '100.00',
            'passing_marks': '33.00',
            'exam_date': '2026-03-03',
        }, d['tokens']['principal'], d['SID_A'])
        assert resp.status_code == 201, f"status={resp.status_code}"

    def test_c3_create_exam_subject_teacher_forbidden(self, exam_prereqs, api):
        """C3: Teacher cannot create exam subject -> 403."""
        d = exam_prereqs
        exam_id, _ = self._setup_exam(d, api)
        resp = api.post('/api/examinations/exam-subjects/', {
            'exam': exam_id,
            'subject': d['subj_sci'].id,
            'total_marks': '100.00',
            'passing_marks': '33.00',
        }, d['tokens']['teacher'], d['SID_A'])
        assert resp.status_code == 403, f"status={resp.status_code}"

    def test_c4_duplicate_subject_in_same_exam_rejected(self, exam_prereqs, api):
        """C4: Duplicate subject in same exam -> 400."""
        d = exam_prereqs
        exam_id, _ = self._setup_exam(d, api)
        token = d['tokens']['admin']
        sid = d['SID_A']
        api.post('/api/examinations/exam-subjects/', {
            'exam': exam_id, 'subject': d['subj_math'].id,
            'total_marks': '100.00', 'passing_marks': '33.00',
        }, token, sid)
        resp = api.post('/api/examinations/exam-subjects/', {
            'exam': exam_id, 'subject': d['subj_math'].id,
            'total_marks': '50.00', 'passing_marks': '20.00',
        }, token, sid)
        assert resp.status_code == 400, f"status={resp.status_code}"

    def test_c5_passing_marks_exceeds_total_rejected(self, exam_prereqs, api):
        """C5: passing_marks > total_marks -> 400."""
        d = exam_prereqs
        exam_id, _ = self._setup_exam(d, api)
        resp = api.post('/api/examinations/exam-subjects/', {
            'exam': exam_id, 'subject': d['subj_sci'].id,
            'total_marks': '50.00', 'passing_marks': '60.00',
        }, d['tokens']['admin'], d['SID_A'])
        assert resp.status_code == 400, f"status={resp.status_code}"

    def test_c6_list_exam_subjects(self, exam_prereqs, api):
        """C6: List exam subjects returns all created."""
        d = exam_prereqs
        exam_id, _ = self._setup_exam(d, api)
        token = d['tokens']['admin']
        sid = d['SID_A']
        for subj, dt in [(d['subj_math'], '2026-03-02'), (d['subj_eng'], '2026-03-03'),
                         (d['subj_sci'], '2026-03-04')]:
            api.post('/api/examinations/exam-subjects/', {
                'exam': exam_id, 'subject': subj.id,
                'total_marks': '100.00', 'passing_marks': '33.00', 'exam_date': dt,
            }, token, sid)

        resp = api.get('/api/examinations/exam-subjects/', token, sid)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 3, f"count={len(data)}"

    def test_c7_filter_by_exam(self, exam_prereqs, api):
        """C7: Filter exam subjects by exam."""
        d = exam_prereqs
        exam_id, _ = self._setup_exam(d, api)
        token = d['tokens']['admin']
        sid = d['SID_A']
        for subj, dt in [(d['subj_math'], '2026-03-02'), (d['subj_eng'], '2026-03-03'),
                         (d['subj_sci'], '2026-03-04')]:
            api.post('/api/examinations/exam-subjects/', {
                'exam': exam_id, 'subject': subj.id,
                'total_marks': '100.00', 'passing_marks': '33.00', 'exam_date': dt,
            }, token, sid)

        resp = api.get(f'/api/examinations/exam-subjects/?exam={exam_id}', token, sid)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 3, f"count={len(data)}"


@pytest.mark.django_db
@pytest.mark.phase6
class TestBulkStandaloneTests:

    def _create_exam_type(self, seed_data, api):
        api.post('/api/examinations/exam-types/', {
            'name': f'{P6}Unit Test',
            'weight': '10.00',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        exam_type = ExamType.objects.get(school=seed_data['school_a'], name=f'{P6}Unit Test')
        return exam_type.id

    def _teacher_token(self, seed_data, api, index=0):
        return api.login(f"{seed_data['prefix']}staff_teacher{index + 1}")

    def _assign_subjects(self, d):
        ClassSubject.objects.create(
            school=d['school_a'],
            academic_year=d['academic_year'],
            class_obj=d['class_1'],
            subject=d['subj_math'],
            teacher=d['staff'][0],
            is_active=True,
        )
        ClassSubject.objects.create(
            school=d['school_a'],
            academic_year=d['academic_year'],
            class_obj=d['class_1'],
            subject=d['subj_eng'],
            teacher=d['staff'][0],
            is_active=True,
        )
        ClassSubject.objects.create(
            school=d['school_a'],
            academic_year=d['academic_year'],
            class_obj=d['class_1'],
            subject=d['subj_sci'],
            teacher=d['staff'][1],
            is_active=True,
        )

    def test_bt1_preview_admin_sees_multiple_subject_tests(self, exam_prereqs, api):
        d = exam_prereqs
        self._assign_subjects(d)
        exam_type_id = self._create_exam_type(d, api)
        resp = api.post('/api/examinations/exams/bulk-test-preview/', {
            'academic_year': d['academic_year'].id,
            'term': d['term_1'].id,
            'exam_type': exam_type_id,
            'class_obj': d['class_1'].id,
            'tests': [
                {'subject_id': d['subj_math'].id, 'exam_date': '2026-03-02'},
                {'subject_id': d['subj_eng'].id, 'exam_date': '2026-03-03', 'start_time': '09:00:00', 'end_time': '10:00:00'},
            ],
        }, d['tokens']['admin'], d['SID_A'])
        assert resp.status_code == 200, f"status={resp.status_code} body={resp.content[:200]}"
        payload = resp.json()
        assert payload['counts']['create'] == 2
        assert payload['can_apply'] is True
        assert all(item['status'] == 'create' for item in payload['tests'])

    def test_bt2_apply_admin_creates_standalone_tests(self, exam_prereqs, api):
        d = exam_prereqs
        self._assign_subjects(d)
        exam_type_id = self._create_exam_type(d, api)
        resp = api.post('/api/examinations/exams/bulk-test-apply/', {
            'academic_year': d['academic_year'].id,
            'term': d['term_1'].id,
            'exam_type': exam_type_id,
            'class_obj': d['class_1'].id,
            'tests': [
                {'subject_id': d['subj_math'].id, 'exam_date': '2026-03-02'},
                {'subject_id': d['subj_eng'].id, 'exam_date': '2026-03-03'},
            ],
        }, d['tokens']['admin'], d['SID_A'])
        assert resp.status_code == 201, f"status={resp.status_code} body={resp.content[:200]}"
        payload = resp.json()
        assert payload['created_count'] == 2

        exams = list(Exam.objects.filter(
            school=d['school_a'],
            class_obj=d['class_1'],
            exam_type_id=exam_type_id,
            term=d['term_1'],
            exam_group__isnull=True,
        ).order_by('name'))
        assert len(exams) == 2
        assert all(exam.start_date == exam.end_date for exam in exams)
        assert all(exam.exam_subjects.filter(is_active=True).count() == 1 for exam in exams)

    def test_bt3_preview_teacher_blocks_unassigned_subjects(self, exam_prereqs, api):
        d = exam_prereqs
        self._assign_subjects(d)
        exam_type_id = self._create_exam_type(d, api)
        teacher_token = self._teacher_token(d, api, index=0)
        resp = api.post('/api/examinations/exams/bulk-test-preview/', {
            'academic_year': d['academic_year'].id,
            'term': d['term_1'].id,
            'exam_type': exam_type_id,
            'class_obj': d['class_1'].id,
            'tests': [
                {'subject_id': d['subj_math'].id, 'exam_date': '2026-03-02'},
                {'subject_id': d['subj_sci'].id, 'exam_date': '2026-03-04'},
            ],
        }, teacher_token, d['SID_A'])
        assert resp.status_code == 200, f"status={resp.status_code} body={resp.content[:200]}"
        payload = resp.json()
        assert payload['counts']['create'] == 1
        assert payload['counts']['forbidden'] == 1
        assert payload['can_apply'] is False
        forbidden = next(item for item in payload['tests'] if item['subject_id'] == d['subj_sci'].id)
        assert forbidden['status'] == 'forbidden'

    def test_bt4_apply_teacher_allowed_subject_only(self, exam_prereqs, api):
        d = exam_prereqs
        self._assign_subjects(d)
        exam_type_id = self._create_exam_type(d, api)
        teacher_token = self._teacher_token(d, api, index=0)
        resp = api.post('/api/examinations/exams/bulk-test-apply/', {
            'academic_year': d['academic_year'].id,
            'term': d['term_1'].id,
            'exam_type': exam_type_id,
            'class_obj': d['class_1'].id,
            'tests': [
                {'subject_id': d['subj_math'].id, 'exam_date': '2026-03-02'},
            ],
        }, teacher_token, d['SID_A'])
        assert resp.status_code == 201, f"status={resp.status_code} body={resp.content[:200]}"
        exam = Exam.objects.filter(
            school=d['school_a'],
            class_obj=d['class_1'],
            exam_type_id=exam_type_id,
            term=d['term_1'],
            exam_group__isnull=True,
        ).first()
        assert exam is not None
        assert exam.exam_subjects.filter(subject=d['subj_math']).count() == 1

    def test_bt5_preview_detects_existing_subject_conflict(self, exam_prereqs, api):
        d = exam_prereqs
        self._assign_subjects(d)
        exam_type_id = self._create_exam_type(d, api)
        existing_exam = Exam.objects.create(
            school=d['school_a'],
            academic_year=d['academic_year'],
            term=d['term_1'],
            exam_type_id=exam_type_id,
            class_obj=d['class_1'],
            name=f'{P6}Existing Math Test',
            start_date='2026-03-01',
            end_date='2026-03-01',
        )
        ExamSubject.objects.create(
            school=d['school_a'],
            exam=existing_exam,
            subject=d['subj_math'],
            exam_date='2026-03-01',
        )

        resp = api.post('/api/examinations/exams/bulk-test-preview/', {
            'academic_year': d['academic_year'].id,
            'term': d['term_1'].id,
            'exam_type': exam_type_id,
            'class_obj': d['class_1'].id,
            'tests': [
                {'subject_id': d['subj_math'].id, 'exam_date': '2026-03-02'},
            ],
        }, d['tokens']['admin'], d['SID_A'])
        assert resp.status_code == 200
        payload = resp.json()
        assert payload['counts']['conflict'] == 1
        assert payload['tests'][0]['status'] == 'conflict'


@pytest.mark.django_db
@pytest.mark.phase6
class TestExamSubjectsContinuation(TestExamSubjects):

    def test_c8_update_exam_subject(self, exam_prereqs, api):
        """C8: Update exam subject passing marks."""
        d = exam_prereqs
        exam_id, _ = self._setup_exam(d, api)
        token = d['tokens']['admin']
        sid = d['SID_A']
        api.post('/api/examinations/exam-subjects/', {
            'exam': exam_id, 'subject': d['subj_math'].id,
            'total_marks': '100.00', 'passing_marks': '33.00', 'exam_date': '2026-03-02',
        }, token, sid)
        es = ExamSubject.objects.filter(
            school=d['school_a'], exam_id=exam_id, subject=d['subj_math'],
        ).first()
        assert es is not None

        resp = api.patch(f'/api/examinations/exam-subjects/{es.id}/', {
            'passing_marks': '40.00',
        }, token, sid)
        assert resp.status_code == 200, f"status={resp.status_code}"

    def test_c9_soft_delete_exam_subject(self, exam_prereqs, api):
        """C9: Soft-delete exam subject sets is_active=False."""
        d = exam_prereqs
        _, exam_2b_id, _ = self._setup_exam_with_class2(d, api)
        token = d['tokens']['admin']
        sid = d['SID_A']
        es_temp = ExamSubject.objects.create(
            school=d['school_a'], exam_id=exam_2b_id, subject=d['subj_eng'],
            total_marks=Decimal('100'), passing_marks=Decimal('33'),
        )
        resp = api.delete(f'/api/examinations/exam-subjects/{es_temp.id}/', token, sid)
        assert resp.status_code in (200, 204), f"status={resp.status_code}"
        es_temp.refresh_from_db()
        assert es_temp.is_active is False, f"is_active={es_temp.is_active}"

    def test_c10_school_b_isolation(self, exam_prereqs, api):
        """C10: School B sees no exam subjects from School A."""
        d = exam_prereqs
        exam_id, _ = self._setup_exam(d, api)
        api.post('/api/examinations/exam-subjects/', {
            'exam': exam_id, 'subject': d['subj_math'].id,
            'total_marks': '100.00', 'passing_marks': '33.00',
        }, d['tokens']['admin'], d['SID_A'])

        resp = api.get('/api/examinations/exam-subjects/',
                       d['tokens']['admin_b'], d['SID_B'])
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 0, f"count={len(data)}"


# ==================================================================
# LEVEL D: STUDENT MARKS API
# ==================================================================

@pytest.mark.django_db
@pytest.mark.phase6
class TestMarks:

    def _setup_marks_env(self, d, api):
        """
        Create exam types, exam, exam subjects (math, eng, sci) and return
        all the ids needed for marks tests.
        """
        token = d['tokens']['admin']
        sid = d['SID_A']
        school = d['school_a']

        # Exam type
        api.post('/api/examinations/exam-types/', {
            'name': f'{P6}Mid Term', 'weight': '30.00',
        }, token, sid)
        et_mid = ExamType.objects.filter(school=school, name=f'{P6}Mid Term').first()

        # Exam
        api.post('/api/examinations/exams/', {
            'academic_year': d['academic_year'].id, 'term': d['term_1'].id,
            'exam_type': et_mid.id, 'class_obj': d['class_1'].id,
            'name': f'{P6}Mid Term Class 1A',
            'start_date': '2026-03-01', 'end_date': '2026-03-10',
        }, token, sid)
        exam = Exam.objects.filter(school=school, name=f'{P6}Mid Term Class 1A').first()

        # Update exam status to allow marks entry
        api.patch(f'/api/examinations/exams/{exam.id}/', {
            'status': 'MARKS_ENTRY',
        }, token, sid)

        # Exam subjects
        subjects_map = {}
        for subj_key, subj_obj, dt in [
            ('math', d['subj_math'], '2026-03-02'),
            ('eng', d['subj_eng'], '2026-03-03'),
            ('sci', d['subj_sci'], '2026-03-04'),
        ]:
            api.post('/api/examinations/exam-subjects/', {
                'exam': exam.id, 'subject': subj_obj.id,
                'total_marks': '100.00', 'passing_marks': '33.00', 'exam_date': dt,
            }, token, sid)
            es = ExamSubject.objects.filter(
                school=school, exam=exam, subject=subj_obj,
            ).first()
            subjects_map[subj_key] = es.id

        students = d['class_1_students']
        return {
            'exam_id': exam.id,
            'et_mid_id': et_mid.id,
            'es_math_id': subjects_map['math'],
            'es_eng_id': subjects_map['eng'],
            'es_sci_id': subjects_map['sci'],
            'student_1': students[0] if len(students) > 0 else None,
            'student_2': students[1] if len(students) > 1 else None,
            'student_3': students[2] if len(students) > 2 else None,
            'student_4': students[3] if len(students) > 3 else None,
        }

    def test_d1_create_student_mark_admin(self, exam_prereqs, api):
        """D1: Admin can create a student mark."""
        d = exam_prereqs
        env = self._setup_marks_env(d, api)
        resp = api.post('/api/examinations/marks/', {
            'exam_subject': env['es_math_id'],
            'student': env['student_1'].id,
            'marks_obtained': '85.00',
            'is_absent': False,
            'remarks': 'Good performance',
        }, d['tokens']['admin'], d['SID_A'])
        assert resp.status_code == 201, f"status={resp.status_code} body={resp.content[:200]}"

    def test_d2_create_mark_teacher_forbidden(self, exam_prereqs, api):
        """D2: Teacher cannot create marks -> 403."""
        d = exam_prereqs
        env = self._setup_marks_env(d, api)
        resp = api.post('/api/examinations/marks/', {
            'exam_subject': env['es_math_id'],
            'student': env['student_2'].id,
            'marks_obtained': '70.00',
        }, d['tokens']['teacher'], d['SID_A'])
        assert resp.status_code == 403, f"status={resp.status_code}"

    def test_d3_marks_exceed_total_rejected(self, exam_prereqs, api):
        """D3: marks_obtained > total_marks -> 400."""
        d = exam_prereqs
        env = self._setup_marks_env(d, api)
        resp = api.post('/api/examinations/marks/', {
            'exam_subject': env['es_math_id'],
            'student': env['student_2'].id,
            'marks_obtained': '150.00',
        }, d['tokens']['admin'], d['SID_A'])
        assert resp.status_code == 400, f"status={resp.status_code}"

    def test_d4_mark_as_absent(self, exam_prereqs, api):
        """D4: Mark a student as absent."""
        d = exam_prereqs
        env = self._setup_marks_env(d, api)
        resp = api.post('/api/examinations/marks/', {
            'exam_subject': env['es_math_id'],
            'student': env['student_2'].id,
            'is_absent': True,
        }, d['tokens']['admin'], d['SID_A'])
        assert resp.status_code == 201, f"status={resp.status_code}"

    def test_d5_list_marks_with_computed_fields(self, exam_prereqs, api):
        """D5: List marks, verify computed fields (percentage, is_pass)."""
        d = exam_prereqs
        env = self._setup_marks_env(d, api)
        token = d['tokens']['admin']
        sid = d['SID_A']
        # Create multiple marks
        for student, marks in [
            (env['student_1'], '85.00'), (env['student_2'], '70.00'),
            (env['student_3'], '45.00'), (env['student_4'], '30.00'),
        ]:
            api.post('/api/examinations/marks/', {
                'exam_subject': env['es_math_id'],
                'student': student.id, 'marks_obtained': marks,
            }, token, sid)
        api.post('/api/examinations/marks/', {
            'exam_subject': env['es_eng_id'],
            'student': env['student_1'].id, 'marks_obtained': '90.00',
        }, token, sid)

        resp = api.get('/api/examinations/marks/', token, sid)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 5, f"count={len(data)}"
        first_mark = data[0]
        assert 'percentage' in first_mark, f"keys={list(first_mark.keys())[:10]}"
        assert 'is_pass' in first_mark, f"keys={list(first_mark.keys())[:10]}"

    def test_d6_filter_by_exam_subject(self, exam_prereqs, api):
        """D6: Filter marks by exam_subject."""
        d = exam_prereqs
        env = self._setup_marks_env(d, api)
        token = d['tokens']['admin']
        sid = d['SID_A']
        for student, marks in [
            (env['student_1'], '85.00'), (env['student_3'], '45.00'),
            (env['student_4'], '30.00'),
        ]:
            api.post('/api/examinations/marks/', {
                'exam_subject': env['es_math_id'],
                'student': student.id, 'marks_obtained': marks,
            }, token, sid)

        resp = api.get(f'/api/examinations/marks/?exam_subject={env["es_math_id"]}', token, sid)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 3, f"count={len(data)}"

    def test_d7_filter_by_student(self, exam_prereqs, api):
        """D7: Filter marks by student."""
        d = exam_prereqs
        env = self._setup_marks_env(d, api)
        token = d['tokens']['admin']
        sid = d['SID_A']
        # Give student_1 marks in math and eng
        api.post('/api/examinations/marks/', {
            'exam_subject': env['es_math_id'],
            'student': env['student_1'].id, 'marks_obtained': '85.00',
        }, token, sid)
        api.post('/api/examinations/marks/', {
            'exam_subject': env['es_eng_id'],
            'student': env['student_1'].id, 'marks_obtained': '90.00',
        }, token, sid)

        resp = api.get(f'/api/examinations/marks/?student={env["student_1"].id}', token, sid)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 2, f"count={len(data)}"

    def test_d8_bulk_entry_create(self, exam_prereqs, api):
        """D8: Bulk entry creates marks for multiple students."""
        d = exam_prereqs
        env = self._setup_marks_env(d, api)
        token = d['tokens']['admin']
        sid = d['SID_A']
        resp = api.post('/api/examinations/marks/bulk_entry/', {
            'exam_subject_id': env['es_sci_id'],
            'marks': [
                {'student_id': env['student_2'].id, 'marks_obtained': 65, 'is_absent': False},
                {'student_id': env['student_3'].id, 'marks_obtained': 50, 'is_absent': False},
                {'student_id': env['student_4'].id, 'marks_obtained': 40, 'is_absent': False},
            ],
        }, token, sid)
        assert resp.status_code == 200, f"status={resp.status_code}"
        data = resp.json()
        assert data.get('created', 0) >= 3, f"data={data}"

    def test_d9_bulk_entry_update_existing(self, exam_prereqs, api):
        """D9: Bulk entry updates existing marks."""
        d = exam_prereqs
        env = self._setup_marks_env(d, api)
        token = d['tokens']['admin']
        sid = d['SID_A']
        # Create initial marks
        api.post('/api/examinations/marks/bulk_entry/', {
            'exam_subject_id': env['es_sci_id'],
            'marks': [
                {'student_id': env['student_2'].id, 'marks_obtained': 65, 'is_absent': False},
                {'student_id': env['student_3'].id, 'marks_obtained': 50, 'is_absent': False},
            ],
        }, token, sid)
        # Update them
        resp = api.post('/api/examinations/marks/bulk_entry/', {
            'exam_subject_id': env['es_sci_id'],
            'marks': [
                {'student_id': env['student_2'].id, 'marks_obtained': 70, 'is_absent': False, 'remarks': 'Updated'},
                {'student_id': env['student_3'].id, 'marks_obtained': 55, 'is_absent': False, 'remarks': 'Updated'},
            ],
        }, token, sid)
        assert resp.status_code == 200, f"status={resp.status_code}"
        data = resp.json()
        assert data.get('updated', 0) >= 2, f"data={data}"

    def test_d10_by_student_endpoint(self, exam_prereqs, api):
        """D10: by_student endpoint returns marks for a student."""
        d = exam_prereqs
        env = self._setup_marks_env(d, api)
        token = d['tokens']['admin']
        sid = d['SID_A']
        # Create marks in 3 subjects for student_1
        for es_id, marks in [
            (env['es_math_id'], '85.00'),
            (env['es_eng_id'], '90.00'),
            (env['es_sci_id'], '92.00'),
        ]:
            api.post('/api/examinations/marks/', {
                'exam_subject': es_id,
                'student': env['student_1'].id, 'marks_obtained': marks,
            }, token, sid)

        resp = api.get(
            f'/api/examinations/marks/by_student/?student_id={env["student_1"].id}',
            token, sid,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 3, f"count={len(data)}"

    def test_d11_percentage_and_is_pass_computed(self, exam_prereqs, api):
        """D11: Percentage and is_pass are computed correctly (85/100 = 85%, pass >= 33)."""
        d = exam_prereqs
        env = self._setup_marks_env(d, api)
        token = d['tokens']['admin']
        sid = d['SID_A']
        api.post('/api/examinations/marks/', {
            'exam_subject': env['es_math_id'],
            'student': env['student_1'].id,
            'marks_obtained': '85.00',
            'is_absent': False,
        }, token, sid)
        mark = StudentMark.objects.filter(
            school=d['school_a'], exam_subject_id=env['es_math_id'],
            student=env['student_1'],
        ).first()
        assert mark is not None

        resp = api.get(f'/api/examinations/marks/{mark.id}/', token, sid)
        assert resp.status_code == 200
        data = resp.json()
        assert data.get('percentage') == 85.0, f"pct={data.get('percentage')}"
        assert data.get('is_pass') is True, f"is_pass={data.get('is_pass')}"

    def test_d12_school_b_isolation(self, exam_prereqs, api):
        """D12: School B sees no marks from School A."""
        d = exam_prereqs
        env = self._setup_marks_env(d, api)
        api.post('/api/examinations/marks/', {
            'exam_subject': env['es_math_id'],
            'student': env['student_1'].id, 'marks_obtained': '85.00',
        }, d['tokens']['admin'], d['SID_A'])

        resp = api.get('/api/examinations/marks/', d['tokens']['admin_b'], d['SID_B'])
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 0, f"count={len(data)}"


# ==================================================================
# LEVEL E: GRADE SCALES API
# ==================================================================

@pytest.mark.django_db
@pytest.mark.phase6
class TestGradeScales:

    def test_e1_create_grade_scale_admin(self, seed_data, api):
        """E1: Admin can create a grade scale."""
        resp = api.post('/api/examinations/grade-scales/', {
            'grade_label': 'A+',
            'min_percentage': '90.00',
            'max_percentage': '100.00',
            'gpa_points': '4.0',
            'order': 1,
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, f"status={resp.status_code} body={resp.content[:200]}"

    def test_e2_create_multiple_grades(self, seed_data, api):
        """E2: Create a full grade scale set."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        grades = [
            ('A+', '90.00', '100.00', '4.0', 1),
            ('A', '80.00', '89.99', '3.7', 2),
            ('B+', '70.00', '79.99', '3.3', 3),
            ('B', '60.00', '69.99', '3.0', 4),
            ('C', '50.00', '59.99', '2.5', 5),
            ('D', '33.00', '49.99', '2.0', 6),
            ('F', '0.00', '32.99', '0.0', 7),
        ]
        for label, mn, mx, gpa, order in grades:
            resp = api.post('/api/examinations/grade-scales/', {
                'grade_label': label,
                'min_percentage': mn,
                'max_percentage': mx,
                'gpa_points': gpa,
                'order': order,
            }, token, sid)
            assert resp.status_code == 201, f"Failed for label={label} status={resp.status_code}"

    def test_e3_create_grade_scale_teacher_forbidden(self, seed_data, api):
        """E3: Teacher cannot create grade scale -> 403."""
        resp = api.post('/api/examinations/grade-scales/', {
            'grade_label': 'X',
            'min_percentage': '0.00',
            'max_percentage': '10.00',
            'gpa_points': '0.0',
            'order': 99,
        }, seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, f"status={resp.status_code}"

    def test_e4_teacher_cannot_read_grade_scales(self, seed_data, api):
        """E4: Teacher cannot read grade scales -> 403."""
        resp = api.get('/api/examinations/grade-scales/',
                       seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, f"status={resp.status_code}"

    def test_e5_duplicate_grade_label_rejected(self, seed_data, api):
        """E5: Duplicate grade_label -> 400."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        api.post('/api/examinations/grade-scales/', {
            'grade_label': 'A+', 'min_percentage': '90.00',
            'max_percentage': '100.00', 'gpa_points': '4.0', 'order': 1,
        }, token, sid)
        resp = api.post('/api/examinations/grade-scales/', {
            'grade_label': 'A+', 'min_percentage': '95.00',
            'max_percentage': '100.00', 'gpa_points': '4.0', 'order': 99,
        }, token, sid)
        assert resp.status_code == 400, f"status={resp.status_code}"

    def test_e6_min_exceeds_max_percentage_rejected(self, seed_data, api):
        """E6: min > max percentage -> 400."""
        resp = api.post('/api/examinations/grade-scales/', {
            'grade_label': 'Z',
            'min_percentage': '80.00',
            'max_percentage': '50.00',
            'gpa_points': '0.0',
            'order': 99,
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 400, f"status={resp.status_code}"

    def test_e7_list_grade_scales(self, seed_data, api):
        """E7: List grade scales returns all created grades."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        grades = [
            ('A+', '90.00', '100.00', '4.0', 1),
            ('A', '80.00', '89.99', '3.7', 2),
            ('B+', '70.00', '79.99', '3.3', 3),
            ('B', '60.00', '69.99', '3.0', 4),
            ('C', '50.00', '59.99', '2.5', 5),
            ('D', '33.00', '49.99', '2.0', 6),
            ('F', '0.00', '32.99', '0.0', 7),
        ]
        for label, mn, mx, gpa, order in grades:
            api.post('/api/examinations/grade-scales/', {
                'grade_label': label, 'min_percentage': mn,
                'max_percentage': mx, 'gpa_points': gpa, 'order': order,
            }, token, sid)

        resp = api.get('/api/examinations/grade-scales/', token, sid)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 7, f"count={len(data)}"

    def test_e8_soft_delete_grade_scale(self, seed_data, api):
        """E8: Soft-delete grade scale sets is_active=False."""
        gs_temp = GradeScale.objects.create(
            school=seed_data['school_a'], grade_label='TMP',
            min_percentage=Decimal('0'), max_percentage=Decimal('1'),
            gpa_points=Decimal('0'), order=99,
        )
        resp = api.delete(f'/api/examinations/grade-scales/{gs_temp.id}/',
                          seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code in (200, 204), f"status={resp.status_code}"
        gs_temp.refresh_from_db()
        assert gs_temp.is_active is False, f"is_active={gs_temp.is_active}"

    def test_e9_school_b_isolation(self, seed_data, api):
        """E9: School B sees no School A grade scales."""
        token_admin = seed_data['tokens']['admin']
        sid_a = seed_data['SID_A']
        api.post('/api/examinations/grade-scales/', {
            'grade_label': 'A+', 'min_percentage': '90.00',
            'max_percentage': '100.00', 'gpa_points': '4.0', 'order': 1,
        }, token_admin, sid_a)

        resp = api.get('/api/examinations/grade-scales/',
                       seed_data['tokens']['admin_b'], seed_data['SID_B'])
        assert resp.status_code == 200
        data = resp.json()
        p6_grades_b = [g for g in data if g.get('grade_label', '').startswith(P6)]
        assert len(p6_grades_b) == 0, f"count={len(p6_grades_b)}"


# ==================================================================
# LEVEL F: RESULTS & REPORT CARD
# ==================================================================

@pytest.mark.django_db
@pytest.mark.phase6
class TestResultsAndReportCard:

    def _ensure_enrollments(self, d):
        for student in d['class_1_students']:
            StudentEnrollment.objects.get_or_create(
                school=d['school_a'],
                student=student,
                academic_year=d['academic_year'],
                defaults={
                    'class_obj': d['class_1'],
                    'roll_number': student.roll_number,
                    'status': StudentEnrollment.Status.ACTIVE,
                    'is_active': True,
                },
            )

    def _setup_full_env(self, d, api):
        """
        Create a complete environment: exam types, exams, exam subjects,
        student marks, and grade scales. Then publish exams.
        """
        self._ensure_enrollments(d)

        token = d['tokens']['admin']
        sid = d['SID_A']
        school = d['school_a']

        # Exam types
        api.post('/api/examinations/exam-types/', {
            'name': f'{P6}Mid Term', 'weight': '30.00',
        }, token, sid)
        api.post('/api/examinations/exam-types/', {
            'name': f'{P6}Final Exam', 'weight': '70.00',
        }, token, sid)
        et_mid = ExamType.objects.filter(school=school, name=f'{P6}Mid Term').first()
        et_final = ExamType.objects.filter(school=school, name=f'{P6}Final Exam').first()

        # Exams
        api.post('/api/examinations/exams/', {
            'academic_year': d['academic_year'].id, 'term': d['term_1'].id,
            'exam_type': et_mid.id, 'class_obj': d['class_1'].id,
            'name': f'{P6}Mid Term Class 1A',
            'start_date': '2026-03-01', 'end_date': '2026-03-10',
        }, token, sid)
        api.post('/api/examinations/exams/', {
            'academic_year': d['academic_year'].id, 'term': d['term_2'].id,
            'exam_type': et_final.id, 'class_obj': d['class_1'].id,
            'name': f'{P6}Final Exam Class 1A',
            'start_date': '2026-06-01', 'end_date': '2026-06-10',
        }, token, sid)
        exam_mid = Exam.objects.filter(school=school, name=f'{P6}Mid Term Class 1A').first()
        exam_final = Exam.objects.filter(school=school, name=f'{P6}Final Exam Class 1A').first()

        # Set exam status to MARKS_ENTRY
        api.patch(f'/api/examinations/exams/{exam_mid.id}/', {'status': 'MARKS_ENTRY'}, token, sid)

        # Exam subjects for mid-term
        for subj, dt in [
            (d['subj_math'], '2026-03-02'),
            (d['subj_eng'], '2026-03-03'),
            (d['subj_sci'], '2026-03-04'),
        ]:
            api.post('/api/examinations/exam-subjects/', {
                'exam': exam_mid.id, 'subject': subj.id,
                'total_marks': '100.00', 'passing_marks': '33.00', 'exam_date': dt,
            }, token, sid)

        es_math = ExamSubject.objects.filter(school=school, exam=exam_mid, subject=d['subj_math']).first()
        es_eng = ExamSubject.objects.filter(school=school, exam=exam_mid, subject=d['subj_eng']).first()
        es_sci = ExamSubject.objects.filter(school=school, exam=exam_mid, subject=d['subj_sci']).first()

        students = d['class_1_students']
        s1, s2, s3, s4 = students[0], students[1], students[2], students[3]

        # Math marks
        for student, marks in [(s1, '85.00'), (s2, '0.00'), (s3, '45.00'), (s4, '30.00')]:
            payload = {
                'exam_subject': es_math.id,
                'student': student.id,
                'marks_obtained': marks,
            }
            if student == s2:
                payload['is_absent'] = True
            api.post('/api/examinations/marks/', payload, token, sid)

        # English marks
        for student, marks in [(s1, '90.00'), (s2, '60.00'), (s3, '55.00'), (s4, '25.00')]:
            api.post('/api/examinations/marks/', {
                'exam_subject': es_eng.id,
                'student': student.id, 'marks_obtained': marks, 'is_absent': False,
            }, token, sid)

        # Science marks
        api.post('/api/examinations/marks/', {
            'exam_subject': es_sci.id,
            'student': s1.id, 'marks_obtained': '92.00',
        }, token, sid)
        api.post('/api/examinations/marks/bulk_entry/', {
            'exam_subject_id': es_sci.id,
            'marks': [
                {'student_id': s2.id, 'marks_obtained': 65, 'is_absent': False},
                {'student_id': s3.id, 'marks_obtained': 50, 'is_absent': False},
                {'student_id': s4.id, 'marks_obtained': 40, 'is_absent': False},
            ],
        }, token, sid)

        # Publish mid-term
        Exam.objects.filter(id=exam_mid.id).update(status='PUBLISHED')

        # Final exam subjects and marks for student_1
        es_final_math = ExamSubject.objects.create(
            school=school, exam=exam_final, subject=d['subj_math'],
            total_marks=Decimal('100'), passing_marks=Decimal('33'),
        )
        es_final_eng = ExamSubject.objects.create(
            school=school, exam=exam_final, subject=d['subj_eng'],
            total_marks=Decimal('100'), passing_marks=Decimal('33'),
        )
        StudentMark.objects.create(
            school=school, exam_subject=es_final_math,
            student=s1, marks_obtained=Decimal('88'),
        )
        StudentMark.objects.create(
            school=school, exam_subject=es_final_eng,
            student=s1, marks_obtained=Decimal('95'),
        )

        # Publish final exam
        api.post(f'/api/examinations/exams/{exam_final.id}/publish/', {}, token, sid)

        # Grade scales
        grades = [
            ('A+', '90.00', '100.00', '4.0', 1),
            ('A', '80.00', '89.99', '3.7', 2),
            ('B+', '70.00', '79.99', '3.3', 3),
            ('B', '60.00', '69.99', '3.0', 4),
            ('C', '50.00', '59.99', '2.5', 5),
            ('D', '33.00', '49.99', '2.0', 6),
            ('F', '0.00', '32.99', '0.0', 7),
        ]
        for label, mn, mx, gpa, order in grades:
            api.post('/api/examinations/grade-scales/', {
                'grade_label': label, 'min_percentage': mn,
                'max_percentage': mx, 'gpa_points': gpa, 'order': order,
            }, token, sid)

        return {
            'exam_mid_id': exam_mid.id,
            'exam_final_id': exam_final.id,
            'student_1': s1,
        }

    def test_f1_exam_results(self, exam_prereqs, api):
        """F1: Exam results endpoint returns results, subjects, exam."""
        d = exam_prereqs
        env = self._setup_full_env(d, api)
        resp = api.get(
            f'/api/examinations/exams/{env["exam_mid_id"]}/results/',
            d['tokens']['admin'], d['SID_A'],
        )
        assert resp.status_code == 200, f"status={resp.status_code}"
        data = resp.json()
        assert 'results' in data, f"keys={list(data.keys())}"
        assert 'subjects' in data, f"keys={list(data.keys())}"
        assert 'exam' in data, f"keys={list(data.keys())}"

    def test_f2_results_structure_and_ranks(self, exam_prereqs, api):
        """F2: Results have correct structure with ranks assigned."""
        d = exam_prereqs
        env = self._setup_full_env(d, api)
        resp = api.get(
            f'/api/examinations/exams/{env["exam_mid_id"]}/results/',
            d['tokens']['admin'], d['SID_A'],
        )
        assert resp.status_code == 200
        data = resp.json()
        results = data.get('results', [])
        assert len(results) > 0, "no results"

        first = results[0]
        required_keys = [
            'student_id', 'student_name', 'marks',
            'total_obtained', 'total_possible',
            'percentage', 'grade', 'rank', 'is_pass',
        ]
        for key in required_keys:
            assert key in first, f"missing key: {key}, keys={list(first.keys())}"

        ranks = [r['rank'] for r in results]
        assert len(ranks) > 0 and ranks[0] == 1, f"ranks={ranks[:5]}"

    def test_f3_class_summary(self, exam_prereqs, api):
        """F3: Class summary has subject_stats and total_students."""
        d = exam_prereqs
        env = self._setup_full_env(d, api)
        resp = api.get(
            f'/api/examinations/exams/{env["exam_mid_id"]}/class_summary/',
            d['tokens']['admin'], d['SID_A'],
        )
        assert resp.status_code == 200, f"status={resp.status_code}"
        data = resp.json()
        assert 'subject_stats' in data, f"keys={list(data.keys())}"
        assert 'total_students' in data, f"keys={list(data.keys())}"

    def test_f4_class_summary_stats_fields(self, exam_prereqs, api):
        """F4: Subject stats have the correct fields."""
        d = exam_prereqs
        env = self._setup_full_env(d, api)
        resp = api.get(
            f'/api/examinations/exams/{env["exam_mid_id"]}/class_summary/',
            d['tokens']['admin'], d['SID_A'],
        )
        assert resp.status_code == 200
        data = resp.json()
        stats = data.get('subject_stats', [])
        assert len(stats) > 0, "no stats"
        first = stats[0]
        required_keys = [
            'subject_name', 'total_marks', 'students_appeared',
            'average', 'highest', 'lowest', 'passed', 'failed',
        ]
        for key in required_keys:
            assert key in first, f"missing key: {key}, keys={list(first.keys())}"

    def test_f5_report_card(self, exam_prereqs, api):
        """F5: Report card has student, exams, summary."""
        d = exam_prereqs
        env = self._setup_full_env(d, api)
        resp = api.get(
            f'/api/examinations/report-card/?student_id={env["student_1"].id}&academic_year_id={d["academic_year"].id}',
            d['tokens']['admin'], d['SID_A'],
        )
        assert resp.status_code == 200, f"status={resp.status_code}"
        data = resp.json()
        assert 'student' in data, f"keys={list(data.keys())}"
        assert 'exams' in data, f"keys={list(data.keys())}"
        assert 'summary' in data, f"keys={list(data.keys())}"
        assert 'enrollment_info' in data, f"keys={list(data.keys())}"

    def test_f6_report_card_structure(self, exam_prereqs, api):
        """F6: Report card student info and summary have correct fields."""
        d = exam_prereqs
        env = self._setup_full_env(d, api)
        resp = api.get(
            f'/api/examinations/report-card/?student_id={env["student_1"].id}&academic_year_id={d["academic_year"].id}',
            d['tokens']['admin'], d['SID_A'],
        )
        assert resp.status_code == 200
        data = resp.json()

        student_info = data.get('student', {})
        for key in ['id', 'name', 'roll_number', 'class_name']:
            assert key in student_info, f"missing student key: {key}, keys={list(student_info.keys())}"

        summary_info = data.get('summary', {})
        for key in ['total_obtained', 'total_possible', 'percentage', 'grade']:
            assert key in summary_info, f"missing summary key: {key}, keys={list(summary_info.keys())}"

        enrollment_info = data.get('enrollment_info', {})
        for key in ['enrollment_id', 'class_at_report_session', 'current_class', 'academic_year_id']:
            assert key in enrollment_info, f"missing enrollment key: {key}, keys={list(enrollment_info.keys())}"

    def test_f7_report_card_shows_published_exams(self, exam_prereqs, api):
        """F7: Report card only shows published exams."""
        d = exam_prereqs
        env = self._setup_full_env(d, api)
        resp = api.get(
            f'/api/examinations/report-card/?student_id={env["student_1"].id}&academic_year_id={d["academic_year"].id}',
            d['tokens']['admin'], d['SID_A'],
        )
        assert resp.status_code == 200
        data = resp.json()
        exams_in_rc = data.get('exams', [])
        exam_names = [e.get('exam_name', '') for e in exams_in_rc]
        has_published = any(P6 in n for n in exam_names)
        assert has_published and len(exams_in_rc) >= 1, \
            f"exam_count={len(exams_in_rc)} names={exam_names}"

    def test_f8_report_card_missing_student_id(self, seed_data, api):
        """F8: Report card without student_id -> 400."""
        resp = api.get('/api/examinations/report-card/',
                       seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 400, f"status={resp.status_code}"

    def test_f9_report_card_requires_academic_year_or_enrollment(self, exam_prereqs, api):
        """F9: Report card requires academic_year_id or enrollment_id."""
        d = exam_prereqs
        env = self._setup_full_env(d, api)
        resp = api.get(
            f'/api/examinations/report-card/?student_id={env["student_1"].id}',
            d['tokens']['admin'], d['SID_A'],
        )
        assert resp.status_code == 400, f"status={resp.status_code} body={resp.content[:200]}"

    def test_f10_historical_report_card_after_promotion(self, exam_prereqs, api):
        """F10: Old-session report card still uses old class after student is promoted."""
        d = exam_prereqs
        env = self._setup_full_env(d, api)

        student = env['student_1']
        old_enrollment = StudentEnrollment.objects.get(
            school=d['school_a'],
            student=student,
            academic_year=d['academic_year'],
        )

        target_year = AcademicYear.objects.create(
            school=d['school_a'],
            name=f'{P6}2026-2027',
            start_date=d['academic_year'].end_date,
            end_date=d['academic_year'].end_date.replace(year=d['academic_year'].end_date.year + 1),
            is_current=False,
            is_active=True,
        )

        resp = api.post('/api/sessions/enrollments/bulk_promote/', {
            'source_academic_year': d['academic_year'].id,
            'target_academic_year': target_year.id,
            'promotions': [{
                'student_id': student.id,
                'target_class_id': d['class_2'].id,
                'new_roll_number': '11',
                'action': 'PROMOTE',
            }],
        }, d['tokens']['admin'], d['SID_A'])
        assert resp.status_code == 200, f"status={resp.status_code} body={resp.content[:200]}"

        student.refresh_from_db()
        old_enrollment.refresh_from_db()

        report_resp = api.get(
            f'/api/examinations/report-card/?student_id={student.id}&academic_year_id={d["academic_year"].id}',
            d['tokens']['admin'], d['SID_A'],
        )
        assert report_resp.status_code == 200, f"status={report_resp.status_code} body={report_resp.content[:200]}"

        data = report_resp.json()
        assert data['class_name'] == d['class_1'].name
        assert data['enrollment_info']['class_at_report_session'] == d['class_1'].name
        assert data['enrollment_info']['current_class'] == d['class_2'].name
        assert data['student']['class_name'] == d['class_1'].name
        assert old_enrollment.status == StudentEnrollment.Status.PROMOTED


# ==================================================================
# LEVEL G: CROSS-CUTTING TESTS
# ==================================================================

@pytest.mark.django_db
@pytest.mark.phase6
class TestCrossCutting:

    def test_g1_unauthenticated_request(self, api):
        """G1: Unauthenticated -> 401."""
        resp = api.client.get('/api/examinations/exam-types/')
        assert resp.status_code == 401, f"status={resp.status_code}"

    def test_g2_invalid_token(self, seed_data, api):
        """G2: Invalid token -> 401."""
        resp = api.client.get(
            '/api/examinations/exam-types/',
            HTTP_AUTHORIZATION='Bearer invalid_garbage_token',
            HTTP_X_SCHOOL_ID=str(seed_data['SID_A']),
        )
        assert resp.status_code == 401, f"status={resp.status_code}"

    def test_g3_wrong_school_header_no_data(self, seed_data, api):
        """G3: Using wrong school header returns no phase data."""
        token = seed_data['tokens']['admin']
        sid_a = seed_data['SID_A']
        sid_b = seed_data['SID_B']
        api.post('/api/examinations/exam-types/', {
            'name': f'{P6}Mid Term', 'weight': '30.00',
        }, token, sid_a)

        resp = api.get('/api/examinations/exam-types/', token, sid_b)
        data = resp.json() if resp.status_code == 200 else []
        p6_wrong = [t for t in data if t.get('name', '').startswith(P6)]
        assert len(p6_wrong) == 0, f"count={len(p6_wrong)}"

    def test_g4_teacher_can_read_exam_types(self, seed_data, api):
        """G4: Teacher can read exam types."""
        resp = api.get('/api/examinations/exam-types/',
                       seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 200, f"status={resp.status_code}"

    def test_g5_teacher_can_read_exams(self, seed_data, api):
        """G5: Teacher can read exams."""
        resp = api.get('/api/examinations/exams/',
                       seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 200, f"status={resp.status_code}"

    def test_g6_teacher_can_read_marks(self, seed_data, api):
        """G6: Teacher can read marks."""
        resp = api.get('/api/examinations/marks/',
                       seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 200, f"status={resp.status_code}"

    def test_g7_teacher_cannot_patch_exam(self, exam_prereqs, api):
        """G7: Teacher cannot PATCH exam -> 403."""
        d = exam_prereqs
        token = d['tokens']['admin']
        sid = d['SID_A']
        school = d['school_a']
        api.post('/api/examinations/exam-types/', {
            'name': f'{P6}Mid Term', 'weight': '30.00',
        }, token, sid)
        et_mid = ExamType.objects.filter(school=school, name=f'{P6}Mid Term').first()
        api.post('/api/examinations/exams/', {
            'academic_year': d['academic_year'].id, 'term': d['term_1'].id,
            'exam_type': et_mid.id, 'class_obj': d['class_1'].id,
            'name': f'{P6}Mid Term Class 1A',
            'start_date': '2026-03-01', 'end_date': '2026-03-10',
        }, token, sid)
        exam = Exam.objects.filter(school=school, name=f'{P6}Mid Term Class 1A').first()
        assert exam is not None

        resp = api.patch(f'/api/examinations/exams/{exam.id}/', {
            'name': 'Hacked',
        }, d['tokens']['teacher'], sid)
        assert resp.status_code == 403, f"status={resp.status_code}"

    def test_g8_original_data_untouched(self, seed_data, api):
        """G8: Original (non-prefixed) data remains untouched after test operations."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        orig_et_count = ExamType.objects.exclude(school__name__startswith=prefix).count()
        orig_exam_count = Exam.objects.exclude(school__name__startswith=prefix).count()

        # Create some phase data
        api.post('/api/examinations/exam-types/', {
            'name': f'{P6}Mid Term', 'weight': '30.00',
        }, token, sid)

        curr_et = ExamType.objects.exclude(school__name__startswith=prefix).count()
        curr_exam = Exam.objects.exclude(school__name__startswith=prefix).count()
        assert curr_et == orig_et_count, f"orig={orig_et_count} curr={curr_et}"
        assert curr_exam == orig_exam_count, f"orig={orig_exam_count} curr={curr_exam}"
