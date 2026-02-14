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

from examinations.models import ExamType, Exam, ExamSubject, StudentMark, GradeScale
from academics.models import Subject


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

    def test_b13_duplicate_exam_type_class_term_rejected(self, exam_prereqs, api):
        """B13: Duplicate exam_type+class+term -> 400."""
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
        assert resp.status_code == 400, f"status={resp.status_code}"

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

    def _setup_full_env(self, d, api):
        """
        Create a complete environment: exam types, exams, exam subjects,
        student marks, and grade scales. Then publish exams.
        """
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
            f'/api/examinations/report-card/?student_id={env["student_1"].id}',
            d['tokens']['admin'], d['SID_A'],
        )
        assert resp.status_code == 200, f"status={resp.status_code}"
        data = resp.json()
        assert 'student' in data, f"keys={list(data.keys())}"
        assert 'exams' in data, f"keys={list(data.keys())}"
        assert 'summary' in data, f"keys={list(data.keys())}"

    def test_f6_report_card_structure(self, exam_prereqs, api):
        """F6: Report card student info and summary have correct fields."""
        d = exam_prereqs
        env = self._setup_full_env(d, api)
        resp = api.get(
            f'/api/examinations/report-card/?student_id={env["student_1"].id}',
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

    def test_f7_report_card_shows_published_exams(self, exam_prereqs, api):
        """F7: Report card only shows published exams."""
        d = exam_prereqs
        env = self._setup_full_env(d, api)
        resp = api.get(
            f'/api/examinations/report-card/?student_id={env["student_1"].id}',
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
