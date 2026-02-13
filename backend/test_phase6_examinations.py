"""
Phase 6: Examinations Module — Comprehensive Test Suite

Tests: ExamType, Exam, ExamSubject, StudentMark, GradeScale, ReportCard
Roles: SCHOOL_ADMIN (write), PRINCIPAL (write), TEACHER (read-only)

Prerequisites:
    Seed data via seed_test_data.py (auto-created if missing).

Run:
    cd backend
    python manage.py shell -c "exec(open('test_phase6_examinations.py', encoding='utf-8').read())"
"""

import json
import traceback
from datetime import date, timedelta
from decimal import Decimal

# ── Load shared seed data ────────────────────────────────────────────────────
exec(open('seed_test_data.py', encoding='utf-8').read())
seed = get_seed_data()
reset_counters()

# ── Unpack seed data ─────────────────────────────────────────────────────────
school_a = seed['school_a']
school_b = seed['school_b']
SID_A = seed['SID_A']
SID_B = seed['SID_B']
academic_year = seed['academic_year']
terms = seed['terms']
classes = seed['classes']
students = seed['students']

token_admin = seed['tokens']['admin']
token_principal = seed['tokens']['principal']
token_teacher = seed['tokens']['teacher']
token_admin_b = seed['tokens']['admin_b']

P6 = "P6EX_"

# ── Phase-specific imports ───────────────────────────────────────────────────
from examinations.models import ExamType, Exam, ExamSubject, StudentMark, GradeScale
from academics.models import Subject

# ── Snapshot original counts for integrity check ─────────────────────────────
orig_exam_type_count = ExamType.objects.exclude(school__name__startswith=SEED_PREFIX).count()
orig_exam_count = Exam.objects.exclude(school__name__startswith=SEED_PREFIX).count()

# ==============================================================================
print("=" * 70)
print("  PHASE 6 COMPREHENSIVE TEST SUITE — EXAMINATIONS")
print("=" * 70)

try:
    # ── Create phase-specific prerequisite data ──────────────────────────────
    # Examinations need Subject objects (from academics module)
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

    class_1 = classes[0]  # SEED_TEST_Class_1A
    class_2 = classes[1]  # SEED_TEST_Class_2B
    term_1 = terms[0]     # SEED_TEST_Term 1
    term_2 = terms[1]     # SEED_TEST_Term 2

    # Students in class_1 (first 4 of 10 seed students)
    class_1_students = [s for s in students if s.class_obj_id == class_1.id]

    # ==================================================================
    # LEVEL A: EXAM TYPES API
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL A: EXAM TYPES API")
    print("=" * 70)

    # A1: Create exam type (Admin)
    resp = api_post('/api/examinations/exam-types/', {
        'name': f'{P6}Mid Term',
        'weight': '30.00',
    }, token_admin, SID_A)
    check("A1  Create exam type (Admin)", resp.status_code == 201,
          f"status={resp.status_code} body={resp.content[:200]}")

    def get_exam_type_id(name):
        obj = ExamType.objects.filter(school=school_a, name=name).first()
        return obj.id if obj else None

    et_mid_id = get_exam_type_id(f'{P6}Mid Term')

    # A2: Create exam type (Principal)
    resp = api_post('/api/examinations/exam-types/', {
        'name': f'{P6}Final Exam',
        'weight': '70.00',
    }, token_principal, SID_A)
    check("A2  Create exam type (Principal)", resp.status_code == 201,
          f"status={resp.status_code}")
    et_final_id = get_exam_type_id(f'{P6}Final Exam')

    # A3: Create exam type (Teacher) -> 403
    resp = api_post('/api/examinations/exam-types/', {
        'name': f'{P6}Quiz',
        'weight': '10.00',
    }, token_teacher, SID_A)
    check("A3  Create exam type (Teacher) -> 403", resp.status_code == 403,
          f"status={resp.status_code}")

    # A4: Duplicate name -> 400
    resp = api_post('/api/examinations/exam-types/', {
        'name': f'{P6}Mid Term',
        'weight': '30.00',
    }, token_admin, SID_A)
    check("A4  Duplicate name -> 400", resp.status_code == 400,
          f"status={resp.status_code}")

    # A5: List exam types
    resp = api_get('/api/examinations/exam-types/', token_admin, SID_A)
    data = resp.json() if resp.status_code == 200 else []
    p6_types = [t for t in data if t.get('name', '').startswith(P6)]
    check("A5  List exam types", resp.status_code == 200 and len(p6_types) >= 2,
          f"status={resp.status_code} count={len(p6_types)}")

    # A6: Retrieve single
    if et_mid_id:
        resp = api_get(f'/api/examinations/exam-types/{et_mid_id}/', token_admin, SID_A)
        check("A6  Retrieve single", resp.status_code == 200 and resp.json().get('name') == f'{P6}Mid Term',
              f"status={resp.status_code}")
    else:
        check("A6  Retrieve single", False, "no id")

    # A7: Update exam type
    if et_mid_id:
        resp = api_patch(f'/api/examinations/exam-types/{et_mid_id}/', {
            'weight': '35.00',
        }, token_admin, SID_A)
        check("A7  Update exam type", resp.status_code == 200,
              f"status={resp.status_code}")
    else:
        check("A7  Update exam type", False, "no id")

    # A8: Soft-delete exam type
    # Create a temp one to delete
    et_temp = ExamType.objects.create(school=school_a, name=f'{P6}TempType', weight=Decimal('10.00'))
    resp = api_delete(f'/api/examinations/exam-types/{et_temp.id}/', token_admin, SID_A)
    check("A8  Soft-delete exam type", resp.status_code in (200, 204),
          f"status={resp.status_code}")
    et_temp.refresh_from_db()
    check("A8b is_active=False", et_temp.is_active == False,
          f"is_active={et_temp.is_active}")

    # A9: School B isolation
    resp = api_get('/api/examinations/exam-types/', token_admin_b, SID_B)
    data = resp.json() if resp.status_code == 200 else []
    p6_types_b = [t for t in data if t.get('name', '').startswith(P6)]
    check("A9  School B isolation (empty)", resp.status_code == 200 and len(p6_types_b) == 0,
          f"status={resp.status_code} count={len(p6_types_b)}")

    # ==================================================================
    # LEVEL B: EXAMS API
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL B: EXAMS API")
    print("=" * 70)

    # B1: Create exam (Admin)
    resp = api_post('/api/examinations/exams/', {
        'academic_year': academic_year.id,
        'term': term_1.id,
        'exam_type': et_mid_id,
        'class_obj': class_1.id,
        'name': f'{P6}Mid Term Class 1A',
        'start_date': '2026-03-01',
        'end_date': '2026-03-10',
    }, token_admin, SID_A)
    check("B1  Create exam (Admin)", resp.status_code == 201,
          f"status={resp.status_code} body={resp.content[:200]}")

    def get_exam_id(name):
        obj = Exam.objects.filter(school=school_a, name=name).first()
        return obj.id if obj else None

    exam_mid_1a_id = get_exam_id(f'{P6}Mid Term Class 1A')

    # B2: Create exam (Principal)
    resp = api_post('/api/examinations/exams/', {
        'academic_year': academic_year.id,
        'term': term_1.id,
        'exam_type': et_mid_id,
        'class_obj': class_2.id,
        'name': f'{P6}Mid Term Class 2B',
        'start_date': '2026-03-01',
        'end_date': '2026-03-10',
    }, token_principal, SID_A)
    check("B2  Create exam (Principal)", resp.status_code == 201,
          f"status={resp.status_code}")
    exam_mid_2b_id = get_exam_id(f'{P6}Mid Term Class 2B')

    # B3: Create exam (Teacher) -> 403
    resp = api_post('/api/examinations/exams/', {
        'academic_year': academic_year.id,
        'term': term_1.id,
        'exam_type': et_final_id,
        'class_obj': class_1.id,
        'name': f'{P6}Illegal Exam',
        'start_date': '2026-06-01',
        'end_date': '2026-06-10',
    }, token_teacher, SID_A)
    check("B3  Create exam (Teacher) -> 403", resp.status_code == 403,
          f"status={resp.status_code}")

    # B4: start_date > end_date -> 400
    resp = api_post('/api/examinations/exams/', {
        'academic_year': academic_year.id,
        'term': term_2.id,
        'exam_type': et_final_id,
        'class_obj': class_1.id,
        'name': f'{P6}Bad Dates',
        'start_date': '2026-06-10',
        'end_date': '2026-06-01',
    }, token_admin, SID_A)
    check("B4  start_date > end_date -> 400", resp.status_code == 400,
          f"status={resp.status_code}")

    # B5: List exams
    resp = api_get('/api/examinations/exams/', token_admin, SID_A)
    data = resp.json() if resp.status_code == 200 else []
    p6_exams = [e for e in data if e.get('name', '').startswith(P6)]
    check("B5  List exams", resp.status_code == 200 and len(p6_exams) >= 2,
          f"status={resp.status_code} count={len(p6_exams)}")

    # B6: Filter by class_obj
    resp = api_get(f'/api/examinations/exams/?class_obj={class_1.id}', token_admin, SID_A)
    data = resp.json() if resp.status_code == 200 else []
    p6_filtered = [e for e in data if e.get('name', '').startswith(P6)]
    check("B6  Filter by class_obj", resp.status_code == 200 and len(p6_filtered) >= 1,
          f"status={resp.status_code} count={len(p6_filtered)}")

    # B7: Filter by exam_type
    if et_mid_id:
        resp = api_get(f'/api/examinations/exams/?exam_type={et_mid_id}', token_admin, SID_A)
        data = resp.json() if resp.status_code == 200 else []
        p6_filtered = [e for e in data if e.get('name', '').startswith(P6)]
        check("B7  Filter by exam_type", resp.status_code == 200 and len(p6_filtered) >= 1,
              f"status={resp.status_code} count={len(p6_filtered)}")
    else:
        check("B7  Filter by exam_type", False, "no et id")

    # B8: Filter by status
    resp = api_get('/api/examinations/exams/?status=SCHEDULED', token_admin, SID_A)
    data = resp.json() if resp.status_code == 200 else []
    p6_scheduled = [e for e in data if e.get('name', '').startswith(P6)]
    check("B8  Filter by status", resp.status_code == 200 and len(p6_scheduled) >= 1,
          f"status={resp.status_code} count={len(p6_scheduled)}")

    # B9: Retrieve single exam
    if exam_mid_1a_id:
        resp = api_get(f'/api/examinations/exams/{exam_mid_1a_id}/', token_admin, SID_A)
        data = resp.json() if resp.status_code == 200 else {}
        check("B9  Retrieve single exam",
              resp.status_code == 200 and data.get('exam_type_name') == f'{P6}Mid Term',
              f"status={resp.status_code}")
    else:
        check("B9  Retrieve single exam", False, "no id")

    # B10: Update exam
    if exam_mid_1a_id:
        resp = api_patch(f'/api/examinations/exams/{exam_mid_1a_id}/', {
            'status': 'MARKS_ENTRY',
        }, token_admin, SID_A)
        check("B10 Update exam", resp.status_code == 200,
              f"status={resp.status_code}")
    else:
        check("B10 Update exam", False, "no id")

    # B11: Publish exam (will publish later after entering marks)
    # Create a separate exam for publish test
    resp = api_post('/api/examinations/exams/', {
        'academic_year': academic_year.id,
        'term': term_2.id,
        'exam_type': et_final_id,
        'class_obj': class_1.id,
        'name': f'{P6}Final Exam Class 1A',
        'start_date': '2026-06-01',
        'end_date': '2026-06-10',
    }, token_admin, SID_A)
    exam_final_1a_id = get_exam_id(f'{P6}Final Exam Class 1A')
    if exam_final_1a_id:
        resp = api_post(f'/api/examinations/exams/{exam_final_1a_id}/publish/',
                        {}, token_admin, SID_A)
        data = resp.json() if resp.status_code == 200 else {}
        check("B11 Publish exam",
              resp.status_code == 200 and data.get('status') == 'PUBLISHED',
              f"status={resp.status_code} exam_status={data.get('status')}")
    else:
        check("B11 Publish exam", False, "no id")

    # B12: Soft-delete exam
    exam_temp = Exam.objects.create(
        school=school_a, academic_year=academic_year, term=term_2,
        exam_type=ExamType.objects.get(id=et_mid_id), class_obj=class_2,
        name=f'{P6}TempExam', status='SCHEDULED',
    )
    resp = api_delete(f'/api/examinations/exams/{exam_temp.id}/', token_admin, SID_A)
    check("B12 Soft-delete exam", resp.status_code in (200, 204),
          f"status={resp.status_code}")
    exam_temp.refresh_from_db()
    check("B12b is_active=False", exam_temp.is_active == False,
          f"is_active={exam_temp.is_active}")

    # B13: Duplicate exam_type+class+term -> 400
    # exam_mid_1a already exists for (et_mid, class_1, term_1)
    resp = api_post('/api/examinations/exams/', {
        'academic_year': academic_year.id,
        'term': term_1.id,
        'exam_type': et_mid_id,
        'class_obj': class_1.id,
        'name': f'{P6}Duplicate Exam',
        'start_date': '2026-03-15',
        'end_date': '2026-03-20',
    }, token_admin, SID_A)
    check("B13 Duplicate exam_type+class+term -> 400", resp.status_code == 400,
          f"status={resp.status_code}")

    # B14: School B isolation
    resp = api_get('/api/examinations/exams/', token_admin_b, SID_B)
    data = resp.json() if resp.status_code == 200 else []
    p6_exams_b = [e for e in data if e.get('name', '').startswith(P6)]
    check("B14 School B isolation (empty)", resp.status_code == 200 and len(p6_exams_b) == 0,
          f"status={resp.status_code} count={len(p6_exams_b)}")

    # ==================================================================
    # LEVEL C: EXAM SUBJECTS API
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL C: EXAM SUBJECTS API")
    print("=" * 70)

    # C1: Create exam subject (Admin)
    if exam_mid_1a_id:
        resp = api_post('/api/examinations/exam-subjects/', {
            'exam': exam_mid_1a_id,
            'subject': subj_math.id,
            'total_marks': '100.00',
            'passing_marks': '33.00',
            'exam_date': '2026-03-02',
        }, token_admin, SID_A)
        check("C1  Create exam subject (Admin)", resp.status_code == 201,
              f"status={resp.status_code} body={resp.content[:200]}")
    else:
        check("C1  Create exam subject (Admin)", False, "no exam id")

    def get_exam_subject_id(exam_id, subject_id):
        obj = ExamSubject.objects.filter(
            school=school_a, exam_id=exam_id, subject_id=subject_id,
        ).first()
        return obj.id if obj else None

    es_math_id = get_exam_subject_id(exam_mid_1a_id, subj_math.id) if exam_mid_1a_id else None

    # C2: Create exam subject (Principal)
    if exam_mid_1a_id:
        resp = api_post('/api/examinations/exam-subjects/', {
            'exam': exam_mid_1a_id,
            'subject': subj_eng.id,
            'total_marks': '100.00',
            'passing_marks': '33.00',
            'exam_date': '2026-03-03',
        }, token_principal, SID_A)
        check("C2  Create exam subject (Principal)", resp.status_code == 201,
              f"status={resp.status_code}")
    else:
        check("C2  Create exam subject (Principal)", False, "no exam id")

    es_eng_id = get_exam_subject_id(exam_mid_1a_id, subj_eng.id) if exam_mid_1a_id else None

    # C3: Create exam subject (Teacher) -> 403
    if exam_mid_1a_id:
        resp = api_post('/api/examinations/exam-subjects/', {
            'exam': exam_mid_1a_id,
            'subject': subj_sci.id,
            'total_marks': '100.00',
            'passing_marks': '33.00',
        }, token_teacher, SID_A)
        check("C3  Create exam subject (Teacher) -> 403", resp.status_code == 403,
              f"status={resp.status_code}")
    else:
        check("C3  Create exam subject (Teacher) -> 403", False, "no exam id")

    # C4: Duplicate subject in same exam -> 400
    if exam_mid_1a_id:
        resp = api_post('/api/examinations/exam-subjects/', {
            'exam': exam_mid_1a_id,
            'subject': subj_math.id,
            'total_marks': '50.00',
            'passing_marks': '20.00',
        }, token_admin, SID_A)
        check("C4  Duplicate subject in same exam -> 400", resp.status_code == 400,
              f"status={resp.status_code}")
    else:
        check("C4  Duplicate subject in same exam -> 400", False, "no exam id")

    # C5: passing_marks > total_marks -> 400
    if exam_mid_1a_id:
        resp = api_post('/api/examinations/exam-subjects/', {
            'exam': exam_mid_1a_id,
            'subject': subj_sci.id,
            'total_marks': '50.00',
            'passing_marks': '60.00',
        }, token_admin, SID_A)
        check("C5  passing_marks > total_marks -> 400", resp.status_code == 400,
              f"status={resp.status_code}")
    else:
        check("C5  passing_marks > total_marks -> 400", False, "no exam id")

    # Create science exam subject (needed for later)
    if exam_mid_1a_id:
        api_post('/api/examinations/exam-subjects/', {
            'exam': exam_mid_1a_id,
            'subject': subj_sci.id,
            'total_marks': '100.00',
            'passing_marks': '33.00',
            'exam_date': '2026-03-04',
        }, token_admin, SID_A)
    es_sci_id = get_exam_subject_id(exam_mid_1a_id, subj_sci.id) if exam_mid_1a_id else None

    # C6: List exam subjects
    resp = api_get('/api/examinations/exam-subjects/', token_admin, SID_A)
    data = resp.json() if resp.status_code == 200 else []
    check("C6  List exam subjects", resp.status_code == 200 and len(data) >= 3,
          f"status={resp.status_code} count={len(data)}")

    # C7: Filter by exam
    if exam_mid_1a_id:
        resp = api_get(f'/api/examinations/exam-subjects/?exam={exam_mid_1a_id}',
                       token_admin, SID_A)
        data = resp.json() if resp.status_code == 200 else []
        check("C7  Filter by exam", resp.status_code == 200 and len(data) >= 3,
              f"status={resp.status_code} count={len(data)}")
    else:
        check("C7  Filter by exam", False, "no exam id")

    # C8: Update exam subject
    if es_math_id:
        resp = api_patch(f'/api/examinations/exam-subjects/{es_math_id}/', {
            'passing_marks': '40.00',
        }, token_admin, SID_A)
        check("C8  Update exam subject", resp.status_code == 200,
              f"status={resp.status_code}")
        # Reset passing marks back for later tests
        api_patch(f'/api/examinations/exam-subjects/{es_math_id}/', {
            'passing_marks': '33.00',
        }, token_admin, SID_A)
    else:
        check("C8  Update exam subject", False, "no id")

    # C9: Soft-delete exam subject (use exam_mid_2b to avoid unique clash)
    if exam_mid_2b_id:
        es_temp = ExamSubject.objects.create(
            school=school_a, exam_id=exam_mid_2b_id, subject=subj_eng,
            total_marks=Decimal('100'), passing_marks=Decimal('33'),
        )
        resp = api_delete(f'/api/examinations/exam-subjects/{es_temp.id}/',
                          token_admin, SID_A)
        check("C9  Soft-delete exam subject", resp.status_code in (200, 204),
              f"status={resp.status_code}")
        es_temp.refresh_from_db()
        check("C9b is_active=False", es_temp.is_active == False,
              f"is_active={es_temp.is_active}")
    else:
        check("C9  Soft-delete exam subject", False, "no exam2 id")
        check("C9b is_active=False", False, "no exam2 id")

    # C10: School B isolation
    resp = api_get('/api/examinations/exam-subjects/', token_admin_b, SID_B)
    data = resp.json() if resp.status_code == 200 else []
    check("C10 School B isolation (empty)", resp.status_code == 200 and len(data) == 0,
          f"status={resp.status_code} count={len(data)}")

    # ==================================================================
    # LEVEL D: STUDENT MARKS API
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL D: STUDENT MARKS API")
    print("=" * 70)

    # We'll use class_1 students for marks
    student_1 = class_1_students[0] if len(class_1_students) > 0 else None
    student_2 = class_1_students[1] if len(class_1_students) > 1 else None
    student_3 = class_1_students[2] if len(class_1_students) > 2 else None
    student_4 = class_1_students[3] if len(class_1_students) > 3 else None

    # D1: Create student mark (Admin)
    if es_math_id and student_1:
        resp = api_post('/api/examinations/marks/', {
            'exam_subject': es_math_id,
            'student': student_1.id,
            'marks_obtained': '85.00',
            'is_absent': False,
            'remarks': 'Good performance',
        }, token_admin, SID_A)
        check("D1  Create student mark (Admin)", resp.status_code == 201,
              f"status={resp.status_code} body={resp.content[:200]}")
    else:
        check("D1  Create student mark (Admin)", False, f"es_math={es_math_id} student={student_1}")

    def get_mark_id(exam_subject_id, student_id):
        obj = StudentMark.objects.filter(
            school=school_a, exam_subject_id=exam_subject_id, student_id=student_id,
        ).first()
        return obj.id if obj else None

    mark_1_math_id = get_mark_id(es_math_id, student_1.id) if (es_math_id and student_1) else None

    # D2: Create mark (Teacher) -> 403
    if es_math_id and student_2:
        resp = api_post('/api/examinations/marks/', {
            'exam_subject': es_math_id,
            'student': student_2.id,
            'marks_obtained': '70.00',
        }, token_teacher, SID_A)
        check("D2  Create mark (Teacher) -> 403", resp.status_code == 403,
              f"status={resp.status_code}")
    else:
        check("D2  Create mark (Teacher) -> 403", False, "no ids")

    # D3: marks_obtained > total_marks -> 400
    if es_math_id and student_2:
        resp = api_post('/api/examinations/marks/', {
            'exam_subject': es_math_id,
            'student': student_2.id,
            'marks_obtained': '150.00',
        }, token_admin, SID_A)
        check("D3  marks_obtained > total_marks -> 400", resp.status_code == 400,
              f"status={resp.status_code}")
    else:
        check("D3  marks_obtained > total_marks -> 400", False, "no ids")

    # D4: Mark as absent
    if es_math_id and student_2:
        resp = api_post('/api/examinations/marks/', {
            'exam_subject': es_math_id,
            'student': student_2.id,
            'is_absent': True,
        }, token_admin, SID_A)
        check("D4  Mark as absent", resp.status_code == 201,
              f"status={resp.status_code}")
    else:
        check("D4  Mark as absent", False, "no ids")

    # Create more marks for later tests (student_3 and student_4 in math)
    if es_math_id and student_3:
        api_post('/api/examinations/marks/', {
            'exam_subject': es_math_id,
            'student': student_3.id,
            'marks_obtained': '45.00',
        }, token_admin, SID_A)
    if es_math_id and student_4:
        api_post('/api/examinations/marks/', {
            'exam_subject': es_math_id,
            'student': student_4.id,
            'marks_obtained': '30.00',
        }, token_admin, SID_A)

    # Add English marks for all students
    if es_eng_id and student_1:
        api_post('/api/examinations/marks/', {
            'exam_subject': es_eng_id,
            'student': student_1.id,
            'marks_obtained': '90.00',
        }, token_admin, SID_A)
    if es_eng_id and student_2:
        api_post('/api/examinations/marks/', {
            'exam_subject': es_eng_id,
            'student': student_2.id,
            'marks_obtained': '60.00',
            'is_absent': False,
        }, token_admin, SID_A)
    if es_eng_id and student_3:
        api_post('/api/examinations/marks/', {
            'exam_subject': es_eng_id,
            'student': student_3.id,
            'marks_obtained': '55.00',
        }, token_admin, SID_A)
    if es_eng_id and student_4:
        api_post('/api/examinations/marks/', {
            'exam_subject': es_eng_id,
            'student': student_4.id,
            'marks_obtained': '25.00',
        }, token_admin, SID_A)

    # Add Science marks for student_1
    if es_sci_id and student_1:
        api_post('/api/examinations/marks/', {
            'exam_subject': es_sci_id,
            'student': student_1.id,
            'marks_obtained': '92.00',
        }, token_admin, SID_A)

    # D5: List marks (has computed fields)
    resp = api_get('/api/examinations/marks/', token_admin, SID_A)
    data = resp.json() if resp.status_code == 200 else []
    check("D5  List marks", resp.status_code == 200 and len(data) >= 5,
          f"status={resp.status_code} count={len(data)}")
    if data:
        first_mark = data[0]
        has_computed = 'percentage' in first_mark and 'is_pass' in first_mark
        check("D5b Has computed fields", has_computed,
              f"keys={list(first_mark.keys())[:10]}")

    # D6: Filter by exam_subject
    if es_math_id:
        resp = api_get(f'/api/examinations/marks/?exam_subject={es_math_id}',
                       token_admin, SID_A)
        data = resp.json() if resp.status_code == 200 else []
        check("D6  Filter by exam_subject", resp.status_code == 200 and len(data) >= 3,
              f"status={resp.status_code} count={len(data)}")
    else:
        check("D6  Filter by exam_subject", False, "no es_math id")

    # D7: Filter by student
    if student_1:
        resp = api_get(f'/api/examinations/marks/?student={student_1.id}',
                       token_admin, SID_A)
        data = resp.json() if resp.status_code == 200 else []
        check("D7  Filter by student", resp.status_code == 200 and len(data) >= 2,
              f"status={resp.status_code} count={len(data)}")
    else:
        check("D7  Filter by student", False, "no student")

    # D8: Bulk entry (create) — create science marks for students 2-4
    if es_sci_id and student_2 and student_3 and student_4:
        resp = api_post('/api/examinations/marks/bulk_entry/', {
            'exam_subject_id': es_sci_id,
            'marks': [
                {'student_id': student_2.id, 'marks_obtained': 65, 'is_absent': False},
                {'student_id': student_3.id, 'marks_obtained': 50, 'is_absent': False},
                {'student_id': student_4.id, 'marks_obtained': 40, 'is_absent': False},
            ],
        }, token_admin, SID_A)
        data = resp.json() if resp.status_code == 200 else {}
        check("D8  Bulk entry (create)",
              resp.status_code == 200 and data.get('created', 0) >= 3,
              f"status={resp.status_code} data={data}")
    else:
        check("D8  Bulk entry (create)", False, "missing ids")

    # D9: Bulk entry (update existing)
    if es_sci_id and student_2 and student_3:
        resp = api_post('/api/examinations/marks/bulk_entry/', {
            'exam_subject_id': es_sci_id,
            'marks': [
                {'student_id': student_2.id, 'marks_obtained': 70, 'is_absent': False, 'remarks': 'Updated'},
                {'student_id': student_3.id, 'marks_obtained': 55, 'is_absent': False, 'remarks': 'Updated'},
            ],
        }, token_admin, SID_A)
        data = resp.json() if resp.status_code == 200 else {}
        check("D9  Bulk entry (update existing)",
              resp.status_code == 200 and data.get('updated', 0) >= 2,
              f"status={resp.status_code} data={data}")
    else:
        check("D9  Bulk entry (update existing)", False, "missing ids")

    # D10: By student
    if student_1:
        resp = api_get(f'/api/examinations/marks/by_student/?student_id={student_1.id}',
                       token_admin, SID_A)
        data = resp.json() if resp.status_code == 200 else []
        check("D10 By student", resp.status_code == 200 and len(data) >= 3,
              f"status={resp.status_code} count={len(data)}")
    else:
        check("D10 By student", False, "no student")

    # D11: Percentage & is_pass computed correctly
    if mark_1_math_id:
        resp = api_get(f'/api/examinations/marks/{mark_1_math_id}/', token_admin, SID_A)
        data = resp.json() if resp.status_code == 200 else {}
        pct = data.get('percentage')
        is_pass = data.get('is_pass')
        # 85 out of 100 = 85%, passing marks = 33 -> is_pass = True
        check("D11 Percentage & is_pass computed",
              resp.status_code == 200 and pct == 85.0 and is_pass == True,
              f"status={resp.status_code} pct={pct} is_pass={is_pass}")
    else:
        check("D11 Percentage & is_pass computed", False, "no mark id")

    # D12: School B isolation
    resp = api_get('/api/examinations/marks/', token_admin_b, SID_B)
    data = resp.json() if resp.status_code == 200 else []
    check("D12 School B isolation (empty)", resp.status_code == 200 and len(data) == 0,
          f"status={resp.status_code} count={len(data)}")

    # ==================================================================
    # LEVEL E: GRADE SCALES API
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL E: GRADE SCALES API")
    print("=" * 70)

    # Grade labels max_length=5, so no prefix. Scoped to test school.
    # E1: Create grade scale (Admin)
    resp = api_post('/api/examinations/grade-scales/', {
        'grade_label': 'A+',
        'min_percentage': '90.00',
        'max_percentage': '100.00',
        'gpa_points': '4.0',
        'order': 1,
    }, token_admin, SID_A)
    check("E1  Create grade scale (Admin)", resp.status_code == 201,
          f"status={resp.status_code} body={resp.content[:200]}")

    def get_grade_id(label):
        obj = GradeScale.objects.filter(school=school_a, grade_label=label).first()
        return obj.id if obj else None

    gs_aplus_id = get_grade_id('A+')

    # E2: Create multiple grades
    grades_to_create = [
        ('A', '80.00', '89.99', '3.7', 2),
        ('B+', '70.00', '79.99', '3.3', 3),
        ('B', '60.00', '69.99', '3.0', 4),
        ('C', '50.00', '59.99', '2.5', 5),
        ('D', '33.00', '49.99', '2.0', 6),
        ('F', '0.00', '32.99', '0.0', 7),
    ]
    all_created = True
    for label, mn, mx, gpa, order in grades_to_create:
        resp = api_post('/api/examinations/grade-scales/', {
            'grade_label': label,
            'min_percentage': mn,
            'max_percentage': mx,
            'gpa_points': gpa,
            'order': order,
        }, token_admin, SID_A)
        if resp.status_code != 201:
            all_created = False
    check("E2  Create multiple grades", all_created, "some failed")

    # E3: Create grade scale (Teacher) -> 403
    resp = api_post('/api/examinations/grade-scales/', {
        'grade_label': 'X',
        'min_percentage': '0.00',
        'max_percentage': '10.00',
        'gpa_points': '0.0',
        'order': 99,
    }, token_teacher, SID_A)
    check("E3  Create grade scale (Teacher) -> 403", resp.status_code == 403,
          f"status={resp.status_code}")

    # E4: Teacher can't READ grade scales -> 403 (IsSchoolAdmin, not IsSchoolAdminOrReadOnly)
    resp = api_get('/api/examinations/grade-scales/', token_teacher, SID_A)
    check("E4  Teacher can't READ grade scales -> 403", resp.status_code == 403,
          f"status={resp.status_code}")

    # E5: Duplicate grade_label -> 400
    resp = api_post('/api/examinations/grade-scales/', {
        'grade_label': 'A+',
        'min_percentage': '95.00',
        'max_percentage': '100.00',
        'gpa_points': '4.0',
        'order': 99,
    }, token_admin, SID_A)
    check("E5  Duplicate grade_label -> 400", resp.status_code == 400,
          f"status={resp.status_code}")

    # E6: min > max percentage -> 400
    resp = api_post('/api/examinations/grade-scales/', {
        'grade_label': 'Z',
        'min_percentage': '80.00',
        'max_percentage': '50.00',
        'gpa_points': '0.0',
        'order': 99,
    }, token_admin, SID_A)
    check("E6  min > max percentage -> 400", resp.status_code == 400,
          f"status={resp.status_code}")

    # E7: List grade scales (admin)
    resp = api_get('/api/examinations/grade-scales/', token_admin, SID_A)
    data = resp.json() if resp.status_code == 200 else []
    check("E7  List grade scales", resp.status_code == 200 and len(data) >= 7,
          f"status={resp.status_code} count={len(data)}")

    # E8: Soft-delete grade scale
    gs_temp = GradeScale.objects.create(
        school=school_a, grade_label='TMP',
        min_percentage=Decimal('0'), max_percentage=Decimal('1'),
        gpa_points=Decimal('0'), order=99,
    )
    resp = api_delete(f'/api/examinations/grade-scales/{gs_temp.id}/', token_admin, SID_A)
    check("E8  Soft-delete grade scale", resp.status_code in (200, 204),
          f"status={resp.status_code}")
    gs_temp.refresh_from_db()
    check("E8b is_active=False", gs_temp.is_active == False,
          f"is_active={gs_temp.is_active}")

    # E9: School B isolation
    resp = api_get('/api/examinations/grade-scales/', token_admin_b, SID_B)
    data = resp.json() if resp.status_code == 200 else []
    p6_grades_b = [g for g in data if g.get('grade_label', '').startswith(P6)]
    check("E9  School B isolation (empty)", resp.status_code == 200 and len(p6_grades_b) == 0,
          f"status={resp.status_code} count={len(p6_grades_b)}")

    # ==================================================================
    # LEVEL F: RESULTS & REPORT CARD
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL F: RESULTS & REPORT CARD")
    print("=" * 70)

    # First, publish the mid-term exam so report card can find it
    if exam_mid_1a_id:
        Exam.objects.filter(id=exam_mid_1a_id).update(status='PUBLISHED')

    # Also create marks on the final exam for report card testing
    if exam_final_1a_id:
        # Create exam subjects for the final exam
        es_final_math = ExamSubject.objects.create(
            school=school_a, exam_id=exam_final_1a_id, subject=subj_math,
            total_marks=Decimal('100'), passing_marks=Decimal('33'),
        )
        es_final_eng = ExamSubject.objects.create(
            school=school_a, exam_id=exam_final_1a_id, subject=subj_eng,
            total_marks=Decimal('100'), passing_marks=Decimal('33'),
        )
        # Add marks for student_1 on final exam
        if student_1:
            StudentMark.objects.create(
                school=school_a, exam_subject=es_final_math,
                student=student_1, marks_obtained=Decimal('88'),
            )
            StudentMark.objects.create(
                school=school_a, exam_subject=es_final_eng,
                student=student_1, marks_obtained=Decimal('95'),
            )

    # F1: Exam results
    if exam_mid_1a_id:
        resp = api_get(f'/api/examinations/exams/{exam_mid_1a_id}/results/',
                       token_admin, SID_A)
        data = resp.json() if resp.status_code == 200 else {}
        has_results = 'results' in data and 'subjects' in data and 'exam' in data
        check("F1  Exam results", resp.status_code == 200 and has_results,
              f"status={resp.status_code} keys={list(data.keys())}")

        # F2: Results have correct structure
        results = data.get('results', [])
        if results:
            first = results[0]
            has_fields = all(k in first for k in ['student_id', 'student_name', 'marks',
                                                    'total_obtained', 'total_possible',
                                                    'percentage', 'grade', 'rank', 'is_pass'])
            check("F2  Results have correct structure", has_fields,
                  f"keys={list(first.keys())}")
            # Check that ranks are assigned
            ranks = [r['rank'] for r in results]
            check("F2b Ranks assigned", len(ranks) > 0 and ranks[0] == 1,
                  f"ranks={ranks[:5]}")
        else:
            check("F2  Results have correct structure", False, "no results")
            check("F2b Ranks assigned", False, "no results")
    else:
        check("F1  Exam results", False, "no exam id")
        check("F2  Results have correct structure", False, "no exam id")
        check("F2b Ranks assigned", False, "no exam id")

    # F3: Class summary
    if exam_mid_1a_id:
        resp = api_get(f'/api/examinations/exams/{exam_mid_1a_id}/class_summary/',
                       token_admin, SID_A)
        data = resp.json() if resp.status_code == 200 else {}
        has_summary = 'subject_stats' in data and 'total_students' in data
        check("F3  Class summary", resp.status_code == 200 and has_summary,
              f"status={resp.status_code} keys={list(data.keys())}")

        # F4: Summary has correct stats
        stats = data.get('subject_stats', [])
        if stats:
            first = stats[0]
            has_stat_fields = all(k in first for k in ['subject_name', 'total_marks',
                                                        'students_appeared', 'average',
                                                        'highest', 'lowest', 'passed', 'failed'])
            check("F4  Summary has correct stats", has_stat_fields,
                  f"keys={list(first.keys())}")
        else:
            check("F4  Summary has correct stats", False, "no stats")
    else:
        check("F3  Class summary", False, "no exam id")
        check("F4  Summary has correct stats", False, "no exam id")

    # F5: Report card
    if student_1:
        resp = api_get(f'/api/examinations/report-card/?student_id={student_1.id}',
                       token_admin, SID_A)
        data = resp.json() if resp.status_code == 200 else {}
        has_rc = 'student' in data and 'exams' in data and 'summary' in data
        check("F5  Report card", resp.status_code == 200 and has_rc,
              f"status={resp.status_code} keys={list(data.keys())}")

        # F6: Report card structure
        student_info = data.get('student', {})
        has_student_fields = all(k in student_info for k in ['id', 'name', 'roll_number', 'class_name'])
        summary_info = data.get('summary', {})
        has_summary_fields = all(k in summary_info for k in ['total_obtained', 'total_possible', 'percentage', 'grade'])
        check("F6  Report card structure", has_student_fields and has_summary_fields,
              f"student_keys={list(student_info.keys())} summary_keys={list(summary_info.keys())}")

        # F7: Report card only shows published exams
        exams_in_rc = data.get('exams', [])
        exam_names = [e.get('exam_name', '') for e in exams_in_rc]
        has_published = any(P6 in n for n in exam_names)
        check("F7  Report card shows published exams", has_published and len(exams_in_rc) >= 1,
              f"exam_count={len(exams_in_rc)} names={exam_names}")
    else:
        check("F5  Report card", False, "no student")
        check("F6  Report card structure", False, "no student")
        check("F7  Report card shows published exams", False, "no student")

    # F8: Report card missing student_id -> 400
    resp = api_get('/api/examinations/report-card/', token_admin, SID_A)
    check("F8  Report card missing student_id -> 400", resp.status_code == 400,
          f"status={resp.status_code}")

    # ==================================================================
    # LEVEL G: CROSS-CUTTING TESTS
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL G: CROSS-CUTTING TESTS")
    print("=" * 70)

    # G1: Unauthenticated -> 401
    resp = _client.get('/api/examinations/exam-types/')
    check("G1  Unauthenticated -> 401", resp.status_code == 401,
          f"status={resp.status_code}")

    # G2: Invalid token -> 401
    resp = _client.get(
        '/api/examinations/exam-types/',
        HTTP_AUTHORIZATION='Bearer invalid_garbage_token',
        HTTP_X_SCHOOL_ID=str(SID_A),
    )
    check("G2  Invalid token -> 401", resp.status_code == 401,
          f"status={resp.status_code}")

    # G3: Wrong school header -> no data
    resp = api_get('/api/examinations/exam-types/', token_admin, SID_B)
    data = resp.json() if resp.status_code == 200 else []
    p6_wrong = [t for t in data if t.get('name', '').startswith(P6)]
    check("G3  Wrong school header -> no data", len(p6_wrong) == 0,
          f"count={len(p6_wrong)}")

    # G4: Teacher can READ exam types
    resp = api_get('/api/examinations/exam-types/', token_teacher, SID_A)
    check("G4  Teacher can READ exam types", resp.status_code == 200,
          f"status={resp.status_code}")

    # G5: Teacher can READ exams
    resp = api_get('/api/examinations/exams/', token_teacher, SID_A)
    check("G5  Teacher can READ exams", resp.status_code == 200,
          f"status={resp.status_code}")

    # G6: Teacher can READ marks
    resp = api_get('/api/examinations/marks/', token_teacher, SID_A)
    check("G6  Teacher can READ marks", resp.status_code == 200,
          f"status={resp.status_code}")

    # G7: Teacher can't PATCH exam
    if exam_mid_1a_id:
        resp = api_patch(f'/api/examinations/exams/{exam_mid_1a_id}/', {
            'name': 'Hacked',
        }, token_teacher, SID_A)
        check("G7  Teacher can't PATCH exam -> 403", resp.status_code == 403,
              f"status={resp.status_code}")
    else:
        check("G7  Teacher can't PATCH exam -> 403", False, "no exam id")

    # G8: Original data untouched
    curr_et = ExamType.objects.exclude(school__name__startswith=SEED_PREFIX).count()
    curr_ex = Exam.objects.exclude(school__name__startswith=SEED_PREFIX).count()
    check("G8a Original exam types untouched", curr_et == orig_exam_type_count,
          f"orig={orig_exam_type_count} curr={curr_et}")
    check("G8b Original exams untouched", curr_ex == orig_exam_count,
          f"orig={orig_exam_count} curr={curr_ex}")

except Exception as e:
    print(f"\n[ERROR] Test suite crashed: {e}")
    traceback.print_exc()

# ==============================================================================
# RESULTS
# ==============================================================================
print("\n" + "=" * 70)
total = passed + failed
print(f"  RESULTS: {passed} passed / {failed} failed / {total} total")
if failed == 0:
    print("  ALL TESTS PASSED!")
else:
    print(f"  {failed} TEST(S) FAILED")
print("=" * 70)

# ==============================================================================
# CLEANUP
# ==============================================================================
print("\n[CLEANUP] Removing Phase 6 test data...")
try:
    # Delete in reverse dependency order
    StudentMark.objects.filter(school=school_a, exam_subject__exam__name__startswith=P6).delete()
    print("   Deleted: StudentMarks")
    # Also delete marks on directly-created exam subjects
    StudentMark.objects.filter(school=school_a).filter(
        exam_subject__exam__name__startswith=P6
    ).delete()

    ExamSubject.objects.filter(school=school_a, exam__name__startswith=P6).delete()
    print("   Deleted: ExamSubjects")

    Exam.objects.filter(school=school_a, name__startswith=P6).delete()
    print("   Deleted: Exams")

    ExamType.objects.filter(school=school_a, name__startswith=P6).delete()
    print("   Deleted: ExamTypes")

    GradeScale.objects.filter(school=school_a).delete()
    print("   Deleted: GradeScales")

    Subject.objects.filter(school=school_a, name__startswith=P6).delete()
    print("   Deleted: P6 Subjects")

except Exception as e:
    print(f"   Cleanup error: {e}")

print("[CLEANUP] Phase 6 data removed. Seed data preserved.\n")
print("Done.")
