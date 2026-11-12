import base64
import json
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient
import importlib.util
from decimal import Decimal

from datetime import date

from academic_sessions.models import AcademicYear, StudentEnrollment
from academics.models import Subject
from schools.models import Organization, School
from students.models import Class, Student

from .models import Exam, ExamGroup, ExamPaper, ExamSubject, ExamType, PaperFeedback, PaperQuestion, PaperUpload, Question, StudentMark, Worksheet, WorksheetItem, WorksheetUpload
from .paper_ocr_processor import PaperOCRProcessor, _build_continuation_hint, _build_extraction_prompt, _parse_structured_paper
from .tasks import _build_continuation_context


def _make_school(suffix=''):
    """suffix lets a single test class create more than one school without colliding
    on Organization.slug/School.subdomain's uniqueness constraints -- every existing
    call site omits it and keeps today's fixed values."""
    org = Organization.objects.create(name=f'Exam Test Org{suffix}', slug=f'exam-test-org{suffix}')
    return School.objects.create(
        organization=org,
        name=f'Exam Test School{suffix}',
        subdomain=f'exam-test-school{suffix}',
    )


class ExamPaperDraftAutosaveTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.school = _make_school()
        cls.class_obj = Class.objects.create(school=cls.school, name='Class 8', grade_level=8)
        cls.subject = Subject.objects.create(
            school=cls.school,
            name='Science',
            code='SCI',
        )
        cls.user = get_user_model().objects.create_superuser(
            username='exam_draft_admin',
            email='exam_draft_admin@test.com',
            password='test12345',
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.school_header = {'HTTP_X_SCHOOL_ID': str(self.school.id)}

    def _ensure_draft(self, **overrides):
        payload = {
            'class_obj': self.class_obj.id,
            'subject': self.subject.id,
            'paper_title': 'Science Midterm Draft',
            'instructions': 'Answer all questions.',
        }
        payload.update(overrides)
        response = self.client.post(
            '/api/examinations/exam-papers/ensure-draft/',
            payload,
            format='json',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 201)
        return response.json()

    def test_ensure_draft_creates_server_backed_draft(self):
        payload = self._ensure_draft()

        self.assertEqual(payload['status'], ExamPaper.Status.DRAFT)
        self.assertEqual(payload['paper_title'], 'Science Midterm Draft')
        self.assertEqual(payload['class_obj'], self.class_obj.id)
        self.assertEqual(payload['subject'], self.subject.id)
        self.assertTrue(ExamPaper.objects.filter(id=payload['id'], status=ExamPaper.Status.DRAFT).exists())

    def test_ensure_draft_persists_structure_and_render_options(self):
        payload = self._ensure_draft(
            structure=[
                {
                    'key': 'sec_1',
                    'title': 'Section A',
                    'instruction': 'Attempt any five questions.',
                    'question_type': 'SHORT',
                    'slots_shown': 7,
                    'slots_counted': 5,
                    'marks_per_question': '5',
                }
            ],
            render_options={'answer_lines': 'true'},
        )

        self.assertEqual(payload['structure'][0]['key'], 'sec_1')
        self.assertEqual(payload['structure'][0]['question_type'], 'SHORT')
        self.assertEqual(payload['render_options']['answer_lines'], True)
        self.assertEqual(payload['structure_marks_total'], '25.00')

        paper = ExamPaper.objects.get(id=payload['id'])
        self.assertEqual(paper.structure[0]['slots_counted'], 5)
        self.assertEqual(paper.render_options.get('answer_lines'), True)

    def test_autosave_creates_questions_and_snapshots(self):
        draft = self._ensure_draft()

        autosave_response = self.client.post(
            f"/api/examinations/exam-papers/{draft['id']}/autosave/",
            {
                'manual_questions': [
                    {
                        'question_text': 'What is photosynthesis?',
                        'question_type': 'SHORT',
                        'difficulty_level': 'MEDIUM',
                        'marks': '5',
                        'answer_text': 'Process by which plants make food.',
                        'question_order': 1,
                        'section_key': 'sec_1',
                        'marks_override': '5',
                    }
                ]
            },
            format='json',
            **self.school_header,
        )

        self.assertEqual(autosave_response.status_code, 200)
        data = autosave_response.json()
        self.assertEqual(data['question_count'], 1)
        self.assertEqual(len(data['paper_questions']), 1)
        self.assertEqual(Question.objects.count(), 1)
        self.assertEqual(data['paper_questions'][0]['section_key'], 'sec_1')

        paper_question = PaperQuestion.objects.get(exam_paper_id=draft['id'])
        self.assertEqual(paper_question.question.question_text, 'What is photosynthesis?')
        self.assertEqual(paper_question.section_key, 'sec_1')
        self.assertEqual(paper_question.question_snapshot['question_text'], 'What is photosynthesis?')
        self.assertEqual(paper_question.question_snapshot['effective_marks'], '5.00')

    def test_autosave_attaches_existing_bank_question_without_duplicating(self):
        """A question already in the bank (not yet linked to this paper) must be
        attached by reference, not raise, and not create a duplicate Question row —
        this is the path used when attaching from the question-bank picker."""
        draft = self._ensure_draft()
        bank_question = Question.objects.create(
            school=self.school,
            subject=self.subject,
            question_text='Pre-existing bank question',
            question_type='SHORT',
            difficulty_level='MEDIUM',
            marks=Decimal('3'),
        )

        autosave_response = self.client.post(
            f"/api/examinations/exam-papers/{draft['id']}/autosave/",
            {
                'manual_questions': [
                    {
                        'question_id': bank_question.id,
                        'question_text': bank_question.question_text,
                        'question_type': bank_question.question_type,
                        'difficulty_level': bank_question.difficulty_level,
                        'marks': '3',
                        'question_order': 1,
                        'section_key': 'sec_1',
                        'marks_override': '5',
                    }
                ]
            },
            format='json',
            **self.school_header,
        )

        self.assertEqual(autosave_response.status_code, 200)
        data = autosave_response.json()
        self.assertEqual(Question.objects.count(), 1, 'must reuse the bank question, not duplicate it')
        self.assertEqual(len(data['paper_questions']), 1)
        self.assertEqual(data['paper_questions'][0]['section_key'], 'sec_1')

        paper_question = PaperQuestion.objects.get(exam_paper_id=draft['id'])
        self.assertEqual(paper_question.question_id, bank_question.id)
        self.assertEqual(paper_question.marks_override, Decimal('5'))

    def test_structure_marks_total_handles_choice_sections(self):
        paper = ExamPaper.objects.create(
            school=self.school,
            class_obj=self.class_obj,
            subject=self.subject,
            paper_title='Structure Total Test',
            structure=[
                {
                    'key': 'sec_choice',
                    'title': 'Q1',
                    'instruction': 'Attempt any five questions.',
                    'question_type': 'SHORT',
                    'slots_shown': 7,
                    'slots_counted': 5,
                    'marks_per_question': '5',
                }
            ],
        )

        self.assertEqual(paper.structure_marks_total, Decimal('25'))

    def test_retrieve_uses_snapshot_when_live_question_changes(self):
        draft = self._ensure_draft()

        autosave_response = self.client.post(
            f"/api/examinations/exam-papers/{draft['id']}/autosave/",
            {
                'manual_questions': [
                    {
                        'question_text': 'Define evaporation.',
                        'question_type': 'SHORT',
                        'difficulty_level': 'EASY',
                        'marks': '2',
                        'answer_text': 'Liquid changing to vapor.',
                        'question_order': 1,
                    }
                ]
            },
            format='json',
            **self.school_header,
        )
        self.assertEqual(autosave_response.status_code, 200)

        question = Question.objects.get()
        question.question_text = 'LIVE VALUE SHOULD NOT LEAK'
        question.save(update_fields=['question_text'])

        detail_response = self.client.get(
            f"/api/examinations/exam-papers/{draft['id']}/",
            **self.school_header,
        )

        self.assertEqual(detail_response.status_code, 200)
        paper_question = detail_response.json()['paper_questions'][0]
        self.assertEqual(paper_question['question_text'], 'Define evaporation.')
        self.assertEqual(paper_question['question_snapshot']['question_text'], 'Define evaporation.')

    def test_generate_docx_download(self):
        if importlib.util.find_spec('docx') is None:
            self.skipTest('python-docx is not installed in this environment.')

        draft = self._ensure_draft()

        autosave_response = self.client.post(
            f"/api/examinations/exam-papers/{draft['id']}/autosave/",
            {
                'manual_questions': [
                    {
                        'question_text': 'State Newton second law.',
                        'question_type': 'SHORT',
                        'difficulty_level': 'MEDIUM',
                        'marks': '4',
                        'answer_text': 'F = ma',
                        'question_order': 1,
                    }
                ]
            },
            format='json',
            **self.school_header,
        )
        self.assertEqual(autosave_response.status_code, 200)

        response = self.client.get(
            f"/api/examinations/exam-papers/{draft['id']}/generate-docx/",
            **self.school_header,
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response['Content-Type'],
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        )
        self.assertIn('.docx', response['Content-Disposition'])

    def test_generate_pdf_download(self):
        if importlib.util.find_spec('reportlab') is None:
            self.skipTest('reportlab is not installed in this environment.')

        draft = self._ensure_draft()

        autosave_response = self.client.post(
            f"/api/examinations/exam-papers/{draft['id']}/autosave/",
            {
                'manual_questions': [
                    {
                        'question_text': 'State Newton second law.',
                        'question_type': 'SHORT',
                        'difficulty_level': 'MEDIUM',
                        'marks': '4',
                        'answer_text': 'F = ma',
                        'question_order': 1,
                    }
                ]
            },
            format='json',
            **self.school_header,
        )
        self.assertEqual(autosave_response.status_code, 200)

        response = self.client.get(
            f"/api/examinations/exam-papers/{draft['id']}/generate-pdf/",
            **self.school_header,
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/pdf')
        self.assertIn('.pdf', response['Content-Disposition'])


class ExamPaperDraftRBACTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.school = _make_school()
        cls.class_obj = Class.objects.create(school=cls.school, name='Class 9', grade_level=9)
        cls.subject = Subject.objects.create(
            school=cls.school,
            name='Mathematics',
            code='MATH',
        )

        User = get_user_model()
        cls.principal_user = User.objects.create_user(
            username='exam_principal',
            email='principal@test.com',
            password='test12345',
            role='PRINCIPAL',
            school=cls.school,
        )
        cls.staff_user = User.objects.create_user(
            username='exam_staff',
            email='staff@test.com',
            password='test12345',
            role='STAFF',
            school=cls.school,
        )
        cls.teacher_user = User.objects.create_user(
            username='exam_teacher',
            email='teacher@test.com',
            password='test12345',
            role='TEACHER',
            school=cls.school,
        )

    def setUp(self):
        self.client = APIClient()
        self.school_header = {'HTTP_X_SCHOOL_ID': str(self.school.id)}

    def _payload(self):
        return {
            'class_obj': self.class_obj.id,
            'subject': self.subject.id,
            'paper_title': 'Role Guard Draft',
            'instructions': 'Role guard test',
        }

    def test_principal_can_create_draft(self):
        self.client.force_authenticate(self.principal_user)
        response = self.client.post(
            '/api/examinations/exam-papers/ensure-draft/',
            self._payload(),
            format='json',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 201)

    def test_staff_cannot_create_draft(self):
        self.client.force_authenticate(self.staff_user)
        response = self.client.post(
            '/api/examinations/exam-papers/ensure-draft/',
            self._payload(),
            format='json',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 403)

    def test_teacher_without_class_teacher_scope_cannot_create_draft(self):
        self.client.force_authenticate(self.teacher_user)
        response = self.client.post(
            '/api/examinations/exam-papers/ensure-draft/',
            self._payload(),
            format='json',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 403)

    def test_subject_teacher_without_class_teacher_scope_can_create_draft(self):
        """A teacher assigned to teach this specific class-subject (via ClassSubject)
        but who is not the class's homeroom class-teacher must still be allowed to
        manage a paper for that subject. _can_manage_exam_papers used to accept a
        subject_id parameter but never check it, so only class-teacher scope counted
        and legitimate subject teachers were blocked with a 403."""
        from academics.models import ClassSubject
        from hr.models import StaffMember

        subject_teacher_user = get_user_model().objects.create_user(
            username='exam_subject_teacher',
            email='subject_teacher@test.com',
            password='test12345',
            role='TEACHER',
            school=self.school,
        )
        staff = StaffMember.objects.create(
            school=self.school, user=subject_teacher_user, first_name='Subject', last_name='Teacher',
        )
        ClassSubject.objects.create(
            school=self.school, class_obj=self.class_obj, subject=self.subject, teacher=staff,
        )

        self.client.force_authenticate(subject_teacher_user)
        response = self.client.post(
            '/api/examinations/exam-papers/ensure-draft/',
            self._payload(),
            format='json',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_subject_teacher_for_other_subject_cannot_create_draft(self):
        """Being assigned to teach a different subject in this class must not grant
        access to create a paper for this subject."""
        from academics.models import ClassSubject
        from hr.models import StaffMember

        other_subject = Subject.objects.create(school=self.school, name='Physics', code='PHY')
        other_subject_teacher = get_user_model().objects.create_user(
            username='exam_other_subject_teacher',
            email='other_subject_teacher@test.com',
            password='test12345',
            role='TEACHER',
            school=self.school,
        )
        staff = StaffMember.objects.create(
            school=self.school, user=other_subject_teacher, first_name='Other', last_name='Teacher',
        )
        ClassSubject.objects.create(
            school=self.school, class_obj=self.class_obj, subject=other_subject, teacher=staff,
        )

        self.client.force_authenticate(other_subject_teacher)
        response = self.client.post(
            '/api/examinations/exam-papers/ensure-draft/',
            self._payload(),  # payload targets self.subject (Mathematics), not other_subject
            format='json',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 403)

    def test_teacher_without_class_teacher_scope_cannot_delete_paper(self):
        """A teacher with no class/subject assignment can't even see the paper via
        get_queryset (teacher-scope filtering), so the object lookup itself 404s
        before perform_destroy's manage-scope check would run."""
        paper = ExamPaper.objects.create(
            school=self.school, class_obj=self.class_obj, subject=self.subject,
            paper_title='Guarded Paper',
        )
        self.client.force_authenticate(self.teacher_user)
        response = self.client.delete(
            f'/api/examinations/exam-papers/{paper.id}/',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 404)
        paper.refresh_from_db()
        self.assertTrue(paper.is_active)

    def test_staff_cannot_delete_paper(self):
        """perform_destroy previously skipped the manage-scope check that create/update
        already enforce. STAFF isn't filtered out by the teacher-scope branch of
        get_queryset (that only applies to the TEACHER role), so the paper is visible
        to them -- this exercises the perform_destroy guard itself, not the queryset
        filter, and would have 204'd before this fix."""
        paper = ExamPaper.objects.create(
            school=self.school, class_obj=self.class_obj, subject=self.subject,
            paper_title='Guarded Paper',
        )
        self.client.force_authenticate(self.staff_user)
        response = self.client.delete(
            f'/api/examinations/exam-papers/{paper.id}/',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 403)
        paper.refresh_from_db()
        self.assertTrue(paper.is_active)

    def test_principal_can_delete_paper(self):
        paper = ExamPaper.objects.create(
            school=self.school, class_obj=self.class_obj, subject=self.subject,
            paper_title='Deletable Paper',
        )
        self.client.force_authenticate(self.principal_user)
        response = self.client.delete(
            f'/api/examinations/exam-papers/{paper.id}/',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 204)
        paper.refresh_from_db()
        self.assertFalse(paper.is_active)

    def test_bulk_delete_skips_papers_outside_manage_scope(self):
        """bulk_delete should delete what the caller is allowed to manage and report
        the rest as skipped, rather than failing the whole request or deleting
        everything indiscriminately."""
        allowed_paper = ExamPaper.objects.create(
            school=self.school, class_obj=self.class_obj, subject=self.subject,
            paper_title='Bulk Allowed',
        )
        other_subject = Subject.objects.create(school=self.school, name='Physics', code='PHY2')
        blocked_paper = ExamPaper.objects.create(
            school=self.school, class_obj=self.class_obj, subject=other_subject,
            paper_title='Bulk Blocked',
        )

        from academics.models import ClassSubject
        from hr.models import StaffMember

        subject_teacher_user = get_user_model().objects.create_user(
            username='exam_bulk_subject_teacher',
            email='bulk_subject_teacher@test.com',
            password='test12345',
            role='TEACHER',
            school=self.school,
        )
        staff = StaffMember.objects.create(
            school=self.school, user=subject_teacher_user, first_name='Bulk', last_name='Teacher',
        )
        ClassSubject.objects.create(
            school=self.school, class_obj=self.class_obj, subject=self.subject, teacher=staff,
        )

        self.client.force_authenticate(subject_teacher_user)
        response = self.client.post(
            '/api/examinations/exam-papers/bulk_delete/',
            {'ids': [allowed_paper.id, blocked_paper.id]},
            format='json',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['deleted'], [allowed_paper.id])
        self.assertEqual(len(response.data['skipped']), 1)
        self.assertEqual(response.data['skipped'][0]['id'], blocked_paper.id)

        allowed_paper.refresh_from_db()
        blocked_paper.refresh_from_db()
        self.assertFalse(allowed_paper.is_active)
        self.assertTrue(blocked_paper.is_active)


class AnnounceResultsMarksGateTests(TestCase):
    """announce_results/announce_results_all used to flip Exam.status to PUBLISHED
    with no regard for whether marks were actually entered. They now hard-block
    (single-exam) or skip-and-report (group, since a group spans several classes
    with independent progress) until every active exam-subject has a mark or an
    absence recorded for every actively-enrolled student."""

    @classmethod
    def setUpTestData(cls):
        cls.school = _make_school()
        cls.class_obj = Class.objects.create(school=cls.school, name='Class 4', grade_level=4)
        cls.subject = Subject.objects.create(school=cls.school, name='English', code='ENG')
        cls.academic_year = AcademicYear.objects.create(
            school=cls.school, name='2025-2026',
            start_date=date(2025, 4, 1), end_date=date(2026, 3, 31), is_current=True,
        )
        cls.exam_type = ExamType.objects.create(school=cls.school, name='Final', weight=Decimal('100.00'))
        cls.student_a = Student.objects.create(
            school=cls.school, class_obj=cls.class_obj, roll_number='1', name='Ayesha',
        )
        cls.student_b = Student.objects.create(
            school=cls.school, class_obj=cls.class_obj, roll_number='2', name='Bilal',
        )
        for student in (cls.student_a, cls.student_b):
            StudentEnrollment.objects.create(
                school=cls.school, student=student, academic_year=cls.academic_year,
                class_obj=cls.class_obj, roll_number=student.roll_number,
            )

        cls.admin_user = get_user_model().objects.create_user(
            username='announce_admin', email='announce_admin@test.com',
            password='test12345', role='SCHOOL_ADMIN', school=cls.school,
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.admin_user)
        self.school_header = {'HTTP_X_SCHOOL_ID': str(self.school.id)}

    def _make_exam(self, name='Final Exam', class_obj=None):
        exam = Exam.objects.create(
            school=self.school, academic_year=self.academic_year, exam_type=self.exam_type,
            class_obj=class_obj or self.class_obj, name=name, status=Exam.Status.COMPLETED,
        )
        exam_subject = ExamSubject.objects.create(
            school=self.school, exam=exam, subject=self.subject,
            total_marks=Decimal('100.00'), passing_marks=Decimal('33.00'),
        )
        return exam, exam_subject

    def test_announce_blocked_when_no_marks_entered(self):
        exam, _ = self._make_exam()
        response = self.client.post(
            f'/api/examinations/exams/{exam.id}/announce-results/', **self.school_header,
        )
        self.assertEqual(response.status_code, 400, response.data)
        exam.refresh_from_db()
        self.assertEqual(exam.status, Exam.Status.COMPLETED)

    def test_announce_blocked_when_marks_partially_entered(self):
        exam, exam_subject = self._make_exam()
        StudentMark.objects.create(
            school=self.school, exam_subject=exam_subject, student=self.student_a,
            marks_obtained=Decimal('80'),
        )
        # student_b has no StudentMark row at all yet.
        response = self.client.post(
            f'/api/examinations/exams/{exam.id}/announce-results/', **self.school_header,
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data['marks_entered_count'], 1)
        self.assertEqual(response.data['marks_expected_count'], 2)

    def test_announce_succeeds_when_all_marks_entered(self):
        exam, exam_subject = self._make_exam()
        StudentMark.objects.create(
            school=self.school, exam_subject=exam_subject, student=self.student_a,
            marks_obtained=Decimal('80'),
        )
        StudentMark.objects.create(
            school=self.school, exam_subject=exam_subject, student=self.student_b,
            is_absent=True,  # counts as "entered" -- absence is a recorded outcome, not a gap
        )
        response = self.client.post(
            f'/api/examinations/exams/{exam.id}/announce-results/', **self.school_header,
        )
        self.assertEqual(response.status_code, 200, response.data)
        exam.refresh_from_db()
        self.assertEqual(exam.status, Exam.Status.PUBLISHED)

    def test_group_announce_all_skips_incomplete_exam_and_publishes_complete_one(self):
        # A separate class for the "blocked" exam: StudentEnrollment is unique per
        # (school, student, academic_year), so student_a/student_b -- already
        # enrolled in self.class_obj for this academic year -- can't also enroll in
        # a second class here.
        other_class = Class.objects.create(school=self.school, name='Class 5', grade_level=5)
        other_student = Student.objects.create(
            school=self.school, class_obj=other_class, roll_number='3', name='Zara',
        )
        StudentEnrollment.objects.create(
            school=self.school, student=other_student, academic_year=self.academic_year,
            class_obj=other_class, roll_number=other_student.roll_number,
        )

        ready_exam, ready_subject = self._make_exam('Ready Exam')
        blocked_exam, _ = self._make_exam('Blocked Exam', class_obj=other_class)
        for student in (self.student_a, self.student_b):
            StudentMark.objects.create(
                school=self.school, exam_subject=ready_subject, student=student,
                marks_obtained=Decimal('70'),
            )

        group = ExamGroup.objects.create(
            school=self.school, academic_year=self.academic_year, exam_type=self.exam_type,
            name='Final Term Group',
        )
        Exam.objects.filter(id__in=[ready_exam.id, blocked_exam.id]).update(exam_group=group)

        response = self.client.post(
            f'/api/examinations/exam-groups/{group.id}/announce-results-all/', **self.school_header,
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['published_count'], 1)
        self.assertEqual(len(response.data['skipped']), 1)
        self.assertEqual(response.data['skipped'][0]['id'], blocked_exam.id)

        ready_exam.refresh_from_db()
        blocked_exam.refresh_from_db()
        self.assertEqual(ready_exam.status, Exam.Status.PUBLISHED)
        self.assertEqual(blocked_exam.status, Exam.Status.COMPLETED)


class StudentMarkEntryRBACTests(TestCase):
    """StudentMarkViewSet used to gate every write (including bulk_entry, the
    endpoint the marks-entry page actually calls) behind IsSchoolAdminOrReadOnly,
    which excludes TEACHER entirely -- even though the queryset is teacher-scoped
    for reads and the frontend links teachers straight to this page. Writes now go
    through the same _can_manage_exam_scope check as exam papers."""

    @classmethod
    def setUpTestData(cls):
        cls.school = _make_school()
        cls.class_obj = Class.objects.create(school=cls.school, name='Class 7', grade_level=7)
        cls.subject = Subject.objects.create(school=cls.school, name='Mathematics', code='MATH')
        cls.academic_year = AcademicYear.objects.create(
            school=cls.school, name='2025-2026',
            start_date=date(2025, 4, 1), end_date=date(2026, 3, 31), is_current=True,
        )
        exam_type = ExamType.objects.create(school=cls.school, name='Midterm', weight=Decimal('100.00'))
        cls.exam = Exam.objects.create(
            school=cls.school, academic_year=cls.academic_year, exam_type=exam_type,
            class_obj=cls.class_obj, name='Midterm Exam',
        )
        cls.exam_subject = ExamSubject.objects.create(
            school=cls.school, exam=cls.exam, subject=cls.subject,
            total_marks=Decimal('100.00'), passing_marks=Decimal('33.00'),
        )
        cls.student = Student.objects.create(
            school=cls.school, class_obj=cls.class_obj, roll_number='1', name='Ali Khan',
        )

        User = get_user_model()
        cls.principal_user = User.objects.create_user(
            username='marks_principal', email='marks_principal@test.com',
            password='test12345', role='PRINCIPAL', school=cls.school,
        )
        cls.teacher_user = User.objects.create_user(
            username='marks_teacher', email='marks_teacher@test.com',
            password='test12345', role='TEACHER', school=cls.school,
        )

    def setUp(self):
        self.client = APIClient()
        self.school_header = {'HTTP_X_SCHOOL_ID': str(self.school.id)}

    def _bulk_entry_payload(self):
        return {
            'exam_subject_id': self.exam_subject.id,
            'marks': [
                {'student_id': self.student.id, 'marks_obtained': 78, 'is_absent': False, 'remarks': ''},
            ],
        }

    def test_principal_can_bulk_enter_marks(self):
        self.client.force_authenticate(self.principal_user)
        response = self.client.post(
            '/api/examinations/marks/bulk_entry/',
            self._bulk_entry_payload(),
            format='json',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(StudentMark.objects.filter(exam_subject=self.exam_subject, student=self.student).exists())

    def test_bulk_entry_rejects_marks_outside_zero_to_total(self):
        self.client.force_authenticate(self.principal_user)
        payload = self._bulk_entry_payload()
        payload['marks'][0]['marks_obtained'] = 150
        response = self.client.post(
            '/api/examinations/marks/bulk_entry/', payload, format='json', **self.school_header,
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data['errors']), 1)
        self.assertFalse(StudentMark.objects.filter(exam_subject=self.exam_subject, student=self.student).exists())
        payload['marks'][0]['marks_obtained'] = -1
        response = self.client.post(
            '/api/examinations/marks/bulk_entry/', payload, format='json', **self.school_header,
        )
        self.assertEqual(len(response.data['errors']), 1)

    def test_unassigned_teacher_cannot_bulk_enter_marks(self):
        self.client.force_authenticate(self.teacher_user)
        response = self.client.post(
            '/api/examinations/marks/bulk_entry/',
            self._bulk_entry_payload(),
            format='json',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(StudentMark.objects.filter(exam_subject=self.exam_subject, student=self.student).exists())

    def test_assigned_subject_teacher_can_bulk_enter_marks(self):
        """A teacher assigned to this class-subject via ClassSubject (not
        necessarily the homeroom class-teacher) must be able to save marks --
        this was the exact gap: previously blocked no matter the assignment."""
        from academics.models import ClassSubject
        from hr.models import StaffMember

        staff = StaffMember.objects.create(
            school=self.school, user=self.teacher_user, first_name='Marks', last_name='Teacher',
        )
        ClassSubject.objects.create(
            school=self.school, class_obj=self.class_obj, subject=self.subject, teacher=staff,
        )

        self.client.force_authenticate(self.teacher_user)
        response = self.client.post(
            '/api/examinations/marks/bulk_entry/',
            self._bulk_entry_payload(),
            format='json',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 200, response.data)
        mark = StudentMark.objects.get(exam_subject=self.exam_subject, student=self.student)
        self.assertEqual(mark.marks_obtained, Decimal('78'))

    def test_teacher_for_other_subject_cannot_bulk_enter_marks(self):
        from academics.models import ClassSubject
        from hr.models import StaffMember

        other_subject = Subject.objects.create(school=self.school, name='Physics', code='PHY')
        staff = StaffMember.objects.create(
            school=self.school, user=self.teacher_user, first_name='Other', last_name='Teacher',
        )
        ClassSubject.objects.create(
            school=self.school, class_obj=self.class_obj, subject=other_subject, teacher=staff,
        )

        self.client.force_authenticate(self.teacher_user)
        response = self.client.post(
            '/api/examinations/marks/bulk_entry/',
            self._bulk_entry_payload(),  # targets self.subject (Mathematics), not other_subject
            format='json',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 403)

    def test_assigned_teacher_can_update_single_mark_via_create(self):
        from academics.models import ClassSubject
        from hr.models import StaffMember

        staff = StaffMember.objects.create(
            school=self.school, user=self.teacher_user, first_name='Marks', last_name='Teacher',
        )
        ClassSubject.objects.create(
            school=self.school, class_obj=self.class_obj, subject=self.subject, teacher=staff,
        )

        self.client.force_authenticate(self.teacher_user)
        response = self.client.post(
            '/api/examinations/marks/',
            {
                'exam_subject': self.exam_subject.id,
                'student': self.student.id,
                'marks_obtained': 90,
                'is_absent': False,
            },
            format='json',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_unassigned_teacher_cannot_create_single_mark(self):
        self.client.force_authenticate(self.teacher_user)
        response = self.client.post(
            '/api/examinations/marks/',
            {
                'exam_subject': self.exam_subject.id,
                'student': self.student.id,
                'marks_obtained': 90,
                'is_absent': False,
            },
            format='json',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 403)


# A 1x1 transparent PNG — enough to satisfy Django's ImageField validation.
TINY_PNG_BYTES = base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
)


FIXTURE_PAPER_JSON = {
    'header': {
        'school_name': 'Green Valley School',
        'exam_title': 'Term 2 Exam',
        'class_label': 'FIFTH',
        'subject_label': 'SS',
        'detected_total_marks': None,
        'duration_label': '2 Hours',
    },
    'sections': [
        {
            'title': 'Q1',
            'instruction': None,
            'question_type_guess': 'FILL_BLANK',
            'marks_per_question': 5,
            'shown_count': 1,
            'counted_count': 1,
            'questions': [
                {
                    'question_text': 'Fill in the blanks:',
                    'question_type': 'FILL_BLANK',
                    'marks': 5,
                    'options': None,
                    'type_data': {
                        'items': [
                            'The capital of Pakistan is ____.',
                            'Water boils at ____ degrees Celsius.',
                            'The largest planet is ____.',
                            '____ is the powerhouse of the cell.',
                            'The chemical symbol for gold is ____.',
                        ],
                    },
                },
            ],
        },
        {
            'title': 'Section B',
            'instruction': 'Attempt any five Questions.',
            'question_type_guess': 'SHORT',
            'marks_per_question': 5,
            'shown_count': 7,
            'counted_count': 5,
            'questions': [
                {
                    'question_text': f'Question {i}',
                    'question_type': 'SHORT',
                    'marks': 5,
                    'options': None,
                    'type_data': None,
                }
                for i in range(1, 8)
            ],
        },
    ],
}


class PaperOCRSchemaParsingTests(TestCase):
    """Unit tests for the header/sections/computed_total_marks extraction schema."""

    def test_parses_header_verbatim(self):
        parsed = _parse_structured_paper(json.dumps(FIXTURE_PAPER_JSON))

        self.assertEqual(parsed['header']['class_label'], 'FIFTH')
        self.assertEqual(parsed['header']['subject_label'], 'SS')
        self.assertIsNone(parsed['header']['detected_total_marks'])
        self.assertEqual(len(parsed['sections']), 2)

    def test_fill_in_the_blanks_heading_becomes_one_grouped_question(self):
        """'Q1: Fill in the blanks (5)' + 5 blank lines -> ONE FILL_BLANK question, 5
        marks, 5 items — not five separate questions."""
        parsed = _parse_structured_paper(json.dumps(FIXTURE_PAPER_JSON))

        section = parsed['sections'][0]
        self.assertEqual(len(section['questions']), 1)
        question = section['questions'][0]
        self.assertEqual(question['question_type'], 'FILL_BLANK')
        self.assertEqual(question['marks'], 5)
        self.assertEqual(len(question['type_data']['items']), 5)

    def test_attempt_any_n_sets_counted_count_independent_of_shown_count(self):
        """'Attempt any five Questions (25)' over 7 printed questions -> shown_count=7,
        counted_count=5, marks_per_question=5."""
        parsed = _parse_structured_paper(json.dumps(FIXTURE_PAPER_JSON))

        section = parsed['sections'][1]
        self.assertEqual(section['shown_count'], 7)
        self.assertEqual(section['counted_count'], 5)
        self.assertEqual(section['marks_per_question'], 5)

    def test_computed_total_marks_sums_counted_count_times_marks_per_question(self):
        parsed = _parse_structured_paper(json.dumps(FIXTURE_PAPER_JSON))

        # section 1: 1 * 5 = 5 ; section 2: 5 * 5 = 25 ; total = 30
        self.assertEqual(parsed['computed_total_marks'], 30.0)

    def test_flat_questions_array_kept_for_backward_compatibility(self):
        parsed = _parse_structured_paper(json.dumps(FIXTURE_PAPER_JSON))

        self.assertEqual(len(parsed['questions']), 1 + 7)
        self.assertEqual(parsed['questions'][0]['question_type'], 'FILL_BLANK')

    def test_never_trusts_printed_numbers_orders_by_position(self):
        """Duplicate/out-of-order printed numbers must not affect ordering — sections
        and questions are trusted only in the order the model returned them (page position)."""
        duplicated = json.loads(json.dumps(FIXTURE_PAPER_JSON))
        duplicated['sections'][1]['questions'][0]['question_text'] = 'Q1 duplicate number'
        duplicated['sections'][1]['questions'][1]['question_text'] = 'Q1 duplicate number too'

        parsed = _parse_structured_paper(json.dumps(duplicated))

        # Order is preserved exactly as given, duplicate labels notwithstanding.
        self.assertEqual(parsed['sections'][1]['questions'][0]['question_text'], 'Q1 duplicate number')
        self.assertEqual(parsed['sections'][1]['questions'][1]['question_text'], 'Q1 duplicate number too')
        self.assertEqual(len(parsed['sections'][1]['questions']), 7)

    def test_invalid_question_type_falls_back_to_short(self):
        malformed = json.loads(json.dumps(FIXTURE_PAPER_JSON))
        malformed['sections'][0]['questions'][0]['question_type'] = 'NOT_A_REAL_TYPE'

        parsed = _parse_structured_paper(json.dumps(malformed))

        self.assertEqual(parsed['sections'][0]['questions'][0]['question_type'], 'SHORT')


class PaperOCRProcessorLLMTests(TestCase):
    """Tests the processor's LLM call plumbing, mocking the model call itself."""

    @patch('examinations.paper_ocr_processor.requests.post')
    def test_parse_paper_with_llm_uses_mocked_model_response(self, mock_post):
        mock_response = mock_post.return_value
        mock_response.raise_for_status.return_value = None
        mock_response.json.return_value = {
            'choices': [{'message': {'content': json.dumps(FIXTURE_PAPER_JSON)}}],
        }

        processor = PaperOCRProcessor(vision_provider='google')
        parsed = processor._parse_paper_with_llm(
            'irrelevant raw ocr text',
            context={'class_name': 'Five', 'subject_name': 'Social Studies'},
        )

        mock_post.assert_called_once()
        self.assertEqual(parsed['header']['class_label'], 'FIFTH')
        self.assertEqual(len(parsed['sections']), 2)
        self.assertEqual(parsed['sections'][1]['counted_count'], 5)
        self.assertEqual(parsed['sections'][1]['shown_count'], 7)
        self.assertEqual(parsed['computed_total_marks'], 30.0)

    @patch('examinations.paper_ocr_processor.requests.post')
    def test_parse_paper_with_llm_falls_back_on_bad_json(self, mock_post):
        mock_response = mock_post.return_value
        mock_response.raise_for_status.return_value = None
        mock_response.json.return_value = {
            'choices': [{'message': {'content': 'not valid json at all'}}],
        }

        processor = PaperOCRProcessor(vision_provider='google')
        parsed = processor._parse_paper_with_llm('Q1. What is 2+2?\nQ2. Name a planet.', context=None)

        # Falls back to pattern-based extraction, still shaped as header/sections/questions.
        self.assertIn('header', parsed)
        self.assertIn('sections', parsed)
        self.assertIsInstance(parsed['questions'], list)


class MultiPageContinuationPromptTests(TestCase):
    """_build_continuation_hint / _build_extraction_prompt: page 2+ of a multi-page
    capture must carry forward a summary of prior pages, and page 1 must not."""

    def test_no_continuation_context_produces_empty_hint(self):
        self.assertEqual(_build_continuation_hint(None), '')
        self.assertEqual(_build_continuation_hint({}), '')

    def test_continuation_hint_includes_page_number_and_last_section(self):
        hint = _build_continuation_hint({
            'page_number': 2,
            'header': {'class_label': 'FIFTH', 'subject_label': 'SS'},
            'last_section': {
                'title': 'Section B',
                'instruction': 'Attempt any five Questions',
                'question_type_guess': 'SHORT',
            },
            'questions_so_far': 3,
            'marks_so_far': 15,
        })

        self.assertIn('page 2', hint)
        self.assertIn("class_label: 'FIFTH'", hint)
        self.assertIn("'Section B'", hint)
        self.assertIn('Attempt any five Questions', hint)
        self.assertIn('3 question(s)', hint)
        self.assertIn('15 mark(s)', hint)

    def test_continuation_hint_handles_no_prior_sections(self):
        hint = _build_continuation_hint({
            'page_number': 2,
            'header': {},
            'last_section': None,
            'questions_so_far': 0,
            'marks_so_far': 0,
        })

        self.assertIn('no sections extracted yet', hint)

    def test_prompt_omits_continuation_block_when_absent(self):
        # Rule 8's static text always mentions "MULTI-PAGE CONTEXT" (it's a
        # conditional instruction for the model to follow *if* present) -- so assert
        # on the dynamic hint's own wording instead of that static phrase.
        prompt = _build_extraction_prompt(ocr_text='some text', continuation_context=None)
        self.assertNotIn('is page', prompt)
        self.assertNotIn('Page(s) before this one', prompt)

    def test_prompt_includes_continuation_block_when_present(self):
        prompt = _build_extraction_prompt(
            ocr_text='some text',
            continuation_context={
                'page_number': 2,
                'header': {},
                'last_section': None,
                'questions_so_far': 0,
                'marks_so_far': 0,
            },
        )
        self.assertIn('MULTI-PAGE CONTEXT', prompt)


class BuildContinuationContextTests(TestCase):
    """Pages of one paper are read at the same time, so a page's context is only its own
    number: it must never depend on (or leak) other uploads."""

    @classmethod
    def setUpTestData(cls):
        cls.school = _make_school()
        cls.user = get_user_model().objects.create_superuser(
            username='continuation_admin',
            email='continuation_admin@test.com',
            password='test12345',
        )

    def _make_upload(self, group_id, page_number):
        return PaperUpload.objects.create(
            school=self.school,
            uploaded_by=self.user,
            image_url='https://example.test/p.png',
            group_id=group_id,
            page_number=page_number,
            status=PaperUpload.Status.EXTRACTED,
        )

    def test_returns_none_for_page_one(self):
        import uuid
        self.assertIsNone(_build_continuation_context(self._make_upload(uuid.uuid4(), 1)))

    def test_returns_none_when_group_id_absent(self):
        self.assertIsNone(_build_continuation_context(self._make_upload(None, 2)))

    def test_later_pages_get_an_independent_context_with_their_number_only(self):
        import uuid
        context = _build_continuation_context(self._make_upload(uuid.uuid4(), 3))
        self.assertEqual(context, {'page_number': 3, 'independent': True})

    def test_independent_hint_asks_for_a_continues_previous_flag(self):
        hint = _build_continuation_hint({'page_number': 2, 'independent': True})
        self.assertIn('page 2', hint)
        self.assertIn('continues_previous', hint)


class ReconcilePagesTests(TestCase):
    """paper_reconcile.reconcile_pages: puts independently-read pages back together."""

    @staticmethod
    def _q(qtype='SHORT', marks=2, confidence=None):
        return {'question_text': 'q', 'question_type': qtype, 'marks': marks, 'type_confidence': confidence,
                'options': None, 'type_data': None}

    def _section(self, title, qtype, n, marks=2, counted=None, continues=False, questions=None):
        return {'title': title, 'instruction': None, 'question_type_guess': qtype, 'marks_per_question': marks,
                'shown_count': n, 'counted_count': n if counted is None else counted,
                'continues_previous': continues, 'questions': questions or [self._q(qtype, marks) for _ in range(n)]}

    def test_orders_pages_by_page_number_not_by_input_order(self):
        from .paper_reconcile import reconcile_pages
        p1 = {'header': {'exam_title': 'Mid Term'}, 'sections': [self._section('A', 'MCQ', 2)]}
        p2 = {'header': {}, 'sections': [self._section('B', 'SHORT', 3)]}
        result = reconcile_pages([(2, p2), (1, p1)])
        self.assertEqual([s['title'] for s in result['sections']], ['A', 'B'])
        self.assertEqual(result['header']['exam_title'], 'Mid Term')

    def test_merges_a_section_flagged_as_continuing_from_the_previous_page(self):
        from .paper_reconcile import reconcile_pages
        p1 = {'sections': [self._section('Short questions', 'SHORT', 3)]}
        p2 = {'sections': [self._section('Short questions (cont.)', 'SHORT', 2, continues=True), self._section('Long', 'LONG', 1, marks=5)]}
        result = reconcile_pages([(1, p1), (2, p2)])
        self.assertEqual([s['title'] for s in result['sections']], ['Short questions', 'Long'])
        merged = result['sections'][0]
        self.assertEqual((merged['shown_count'], merged['counted_count'], len(merged['questions'])), (5, 5, 5))
        self.assertEqual(merged['pages'], [1, 2])

    def test_merges_by_repeated_heading_only_for_the_first_section_of_a_page(self):
        from .paper_reconcile import reconcile_pages
        p1 = {'sections': [self._section('Q2 Short', 'SHORT', 2)]}
        p2 = {'sections': [self._section('q2  short', 'SHORT', 2), self._section('Q2 Short', 'SHORT', 1)]}
        result = reconcile_pages([(1, p1), (2, p2)])
        self.assertEqual(len(result['sections']), 2)

    def test_attempt_any_keeps_the_printed_count_when_merging(self):
        from .paper_reconcile import reconcile_pages
        p1 = {'sections': [self._section('Attempt any 4', 'SHORT', 5, counted=4)]}
        p2 = {'sections': [self._section('x', 'SHORT', 3, continues=True)]}
        merged = reconcile_pages([(1, p1), (2, p2)])['sections'][0]
        self.assertEqual((merged['shown_count'], merged['counted_count']), (8, 4))

    def test_splits_a_mixed_type_section_into_one_section_per_type_run(self):
        from .paper_reconcile import reconcile_pages
        questions = [self._q('MCQ', 1), self._q('MCQ', 1), self._q('TRUE_FALSE', 1)]
        page = {'sections': [self._section('Objective', 'MCQ', 3, marks=1, questions=questions)]}
        sections = reconcile_pages([(1, page)])['sections']
        self.assertEqual([(s['question_type_guess'], s['shown_count']) for s in sections], [('MCQ', 2), ('TRUE_FALSE', 1)])
        self.assertEqual(sections[0]['title'], 'Objective')
        self.assertIn('True/False', sections[1]['title'])

    def test_does_not_split_an_attempt_any_section(self):
        from .paper_reconcile import reconcile_pages
        questions = [self._q('SHORT'), self._q('LONG')]
        page = {'sections': [self._section('Attempt any 1', 'SHORT', 2, counted=1, questions=questions)]}
        self.assertEqual(len(reconcile_pages([(1, page)])['sections']), 1)

    def test_flags_low_confidence_questions_and_checks_marks_and_missing_fields(self):
        from .paper_reconcile import reconcile_pages
        questions = [self._q('SHORT', 2, 0.4), self._q('SHORT', 2, 0.95), self._q('SHORT', 2, None)]
        page = {'header': {'detected_total_marks': 6}, 'sections': [self._section('A', 'SHORT', 3, questions=questions)]}
        result = reconcile_pages([(1, page)])
        self.assertEqual(result['low_confidence_count'], 1)
        self.assertEqual([q['needs_review'] for q in result['questions']], [True, False, False])
        self.assertEqual(result['marks_check'], {'detected': 6, 'computed': 6.0, 'matches': True})
        self.assertEqual(result['missing_fields'], ['class_label', 'subject_label'])

    def test_marks_check_has_no_verdict_without_a_printed_total(self):
        from .paper_reconcile import reconcile_pages
        result = reconcile_pages([(1, {'sections': [self._section('A', 'SHORT', 1)]})])
        self.assertIsNone(result['marks_check']['matches'])
        self.assertIn('detected_total_marks', result['missing_fields'])


class PaperUploadGroupStatusTests(TestCase):
    """GET paper-uploads/group-status/: the declared page count drives completeness."""

    @classmethod
    def setUpTestData(cls):
        cls.school = _make_school()
        cls.other_school = _make_school(suffix='-gs')
        cls.user = get_user_model().objects.create_superuser(
            username='group_status_admin', email='group_status_admin@test.com', password='test12345',
        )

    def setUp(self):
        import uuid
        self.group_id = uuid.uuid4()
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.header = {'HTTP_X_SCHOOL_ID': str(self.school.id)}

    def _page(self, number, status_value=PaperUpload.Status.EXTRACTED, school=None, extracted=None):
        return PaperUpload.objects.create(
            school=school or self.school, uploaded_by=self.user, image_url='https://example.test/p.png',
            group_id=self.group_id, page_number=number, status=status_value,
            ai_extracted_json=extracted if extracted is not None else {'sections': [{
                'title': f'S{number}', 'question_type_guess': 'SHORT', 'marks_per_question': 1, 'shown_count': 1,
                'counted_count': 1, 'questions': [{'question_text': 'q', 'question_type': 'SHORT', 'marks': 1}]}]},
        )

    def _get(self, total_pages):
        return self.client.get(
            '/api/examinations/paper-uploads/group-status/',
            {'group_id': str(self.group_id), 'total_pages': total_pages}, **self.header,
        )

    def test_reports_missing_pages_and_withholds_the_result(self):
        self._page(1)
        body = self._get(3).json()
        self.assertFalse(body['complete'])
        self.assertEqual(body['missing_pages'], [2, 3])
        self.assertIsNone(body['result'])

    def test_failed_page_blocks_completion_and_a_retry_replaces_it(self):
        self._page(1)
        self._page(2, PaperUpload.Status.FAILED)
        body = self._get(2).json()
        self.assertEqual(body['failed_pages'], [2])
        self.assertFalse(body['complete'])
        self._page(2)  # the retry is a newer upload for the same page number
        body = self._get(2).json()
        self.assertTrue(body['complete'])
        self.assertEqual(body['failed_pages'], [])

    def test_returns_the_reconciled_paper_once_every_declared_page_is_extracted(self):
        self._page(2)
        self._page(1)
        body = self._get(2).json()
        self.assertTrue(body['complete'])
        self.assertEqual([s['title'] for s in body['result']['sections']], ['S1', 'S2'])

    def test_rejects_a_missing_or_out_of_range_page_count(self):
        self.assertEqual(self._get(0).status_code, 400)
        self.assertEqual(self._get(31).status_code, 400)
        response = self.client.get('/api/examinations/paper-uploads/group-status/', **self.header)
        self.assertEqual(response.status_code, 400)

    def test_never_reads_another_schools_pages(self):
        self._page(1, school=self.other_school)
        self.assertEqual(self._get(1).json()['missing_pages'], [1])


class PaperUploadContextPersistenceTests(TestCase):
    """Uploading with class/subject must persist them on PaperUpload (context only —
    final selection always happens in the UI)."""

    @classmethod
    def setUpTestData(cls):
        cls.school = _make_school()
        cls.class_obj = Class.objects.create(school=cls.school, name='Class 5', grade_level=5)
        cls.subject = Subject.objects.create(school=cls.school, name='Social Studies', code='SS')
        cls.user = get_user_model().objects.create_superuser(
            username='paper_upload_admin',
            email='paper_upload_admin@test.com',
            password='test12345',
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.school_header = {'HTTP_X_SCHOOL_ID': str(self.school.id)}

    @patch('examinations.tasks.process_paper_upload_ocr')
    @patch('core.storage.SupabaseStorageService.upload_file')
    def test_upload_image_persists_class_and_subject_context(self, mock_upload_file, mock_ocr_task):
        mock_upload_file.return_value = 'https://example.test/papers/1/test.png'

        image = SimpleUploadedFile('paper.png', TINY_PNG_BYTES, content_type='image/png')
        response = self.client.post(
            '/api/examinations/paper-uploads/upload-image/',
            {'image': image, 'class_obj': self.class_obj.id, 'subject': self.subject.id},
            format='multipart',
            **self.school_header,
        )

        self.assertEqual(response.status_code, 201)
        upload = PaperUpload.objects.get(id=response.json()['id'])
        self.assertEqual(upload.context_class_id, self.class_obj.id)
        self.assertEqual(upload.context_subject_id, self.subject.id)

    @patch('examinations.tasks.process_paper_upload_ocr')
    @patch('core.storage.SupabaseStorageService.upload_file')
    def test_upload_image_without_class_subject_still_succeeds(self, mock_upload_file, mock_ocr_task):
        mock_upload_file.return_value = 'https://example.test/papers/1/test.png'

        image = SimpleUploadedFile('paper.png', TINY_PNG_BYTES, content_type='image/png')
        response = self.client.post(
            '/api/examinations/paper-uploads/upload-image/',
            {'image': image},
            format='multipart',
            **self.school_header,
        )

        self.assertEqual(response.status_code, 201)
        upload = PaperUpload.objects.get(id=response.json()['id'])
        self.assertIsNone(upload.context_class_id)
        self.assertIsNone(upload.context_subject_id)


class PaperUploadMultiPageGroupingTests(TestCase):
    """group_id/page_number let the frontend chain sequential page uploads into one
    multi-page capture session -- see backend/examinations/tasks.py's continuation
    context lookup, which relies on this grouping to find the prior page(s)."""

    @classmethod
    def setUpTestData(cls):
        cls.school = _make_school()
        cls.other_school = _make_school(suffix='-2')
        cls.user = get_user_model().objects.create_superuser(
            username='multipage_admin',
            email='multipage_admin@test.com',
            password='test12345',
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.school_header = {'HTTP_X_SCHOOL_ID': str(self.school.id)}

    def _upload(self, group_id=None, page_number=None):
        data = {'image': SimpleUploadedFile('paper.png', TINY_PNG_BYTES, content_type='image/png')}
        if group_id is not None:
            data['group_id'] = str(group_id)
        if page_number is not None:
            data['page_number'] = page_number
        return self.client.post(
            '/api/examinations/paper-uploads/upload-image/',
            data,
            format='multipart',
            **self.school_header,
        )

    @patch('examinations.tasks.process_paper_upload_ocr')
    @patch('core.storage.SupabaseStorageService.upload_file')
    def test_first_page_generates_a_group_id(self, mock_upload_file, mock_ocr_task):
        mock_upload_file.return_value = 'https://example.test/papers/1/test.png'

        response = self._upload()

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertIsNotNone(body['group_id'])
        self.assertEqual(body['page_number'], 1)

    @patch('examinations.tasks.process_paper_upload_ocr')
    @patch('core.storage.SupabaseStorageService.upload_file')
    def test_second_page_reuses_group_id_and_auto_increments_page_number(self, mock_upload_file, mock_ocr_task):
        mock_upload_file.return_value = 'https://example.test/papers/1/test.png'

        first = self._upload().json()
        second = self._upload(group_id=first['group_id']).json()
        third = self._upload(group_id=first['group_id']).json()

        self.assertEqual(second['group_id'], first['group_id'])
        self.assertEqual(second['page_number'], 2)
        self.assertEqual(third['page_number'], 3)

    @patch('examinations.tasks.process_paper_upload_ocr')
    @patch('core.storage.SupabaseStorageService.upload_file')
    def test_page_number_auto_increment_is_scoped_per_school(self, mock_upload_file, mock_ocr_task):
        """A group_id colliding across schools (e.g. a crafted request) must not let
        one school's page count influence another's numbering or grouping."""
        mock_upload_file.return_value = 'https://example.test/papers/1/test.png'

        first = self._upload().json()

        other_header = {'HTTP_X_SCHOOL_ID': str(self.other_school.id)}
        other_response = self.client.post(
            '/api/examinations/paper-uploads/upload-image/',
            {
                'image': SimpleUploadedFile('paper.png', TINY_PNG_BYTES, content_type='image/png'),
                'group_id': first['group_id'],
            },
            format='multipart',
            **other_header,
        )

        self.assertEqual(other_response.status_code, 201)
        # Not page 2 -- this school has no prior page in this group_id, so it starts fresh.
        self.assertEqual(other_response.json()['page_number'], 1)


class ConfirmExtractionFeedbackOnlyTests(TestCase):
    """When exam_paper_id is provided, confirm_extraction must only record feedback
    and link the upload — the paper/questions already exist from the draft pipeline."""

    @classmethod
    def setUpTestData(cls):
        cls.school = _make_school()
        cls.class_obj = Class.objects.create(school=cls.school, name='Class 5', grade_level=5)
        cls.subject = Subject.objects.create(school=cls.school, name='Social Studies', code='SS')
        cls.user = get_user_model().objects.create_superuser(
            username='confirm_admin',
            email='confirm_admin@test.com',
            password='test12345',
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.school_header = {'HTTP_X_SCHOOL_ID': str(self.school.id)}

        self.upload = PaperUpload.objects.create(
            school=self.school,
            uploaded_by=self.user,
            image_url='https://example.test/papers/1/test.png',
            context_class=self.class_obj,
            context_subject=self.subject,
            status=PaperUpload.Status.EXTRACTED,
            ai_extracted_json={'header': {}, 'sections': [], 'questions': []},
            extraction_confidence=0.9,
        )

        # Simulate what ensure-draft + autosave already created for this paper.
        self.exam_paper = ExamPaper.objects.create(
            school=self.school,
            class_obj=self.class_obj,
            subject=self.subject,
            paper_title='Draft Paper From Upload',
            total_marks=10,
            status=ExamPaper.Status.DRAFT,
            generated_by=self.user,
        )
        self.question = Question.objects.create(
            school=self.school,
            subject=self.subject,
            question_text='Already-saved question',
            question_type='SHORT',
            marks=5,
            created_by=self.user,
        )
        PaperQuestion.objects.create(
            exam_paper=self.exam_paper,
            question=self.question,
            question_order=1,
            marks_override=5,
        )

    def test_confirm_with_exam_paper_id_only_records_feedback_no_duplicates(self):
        exam_paper_count_before = ExamPaper.objects.count()
        question_count_before = Question.objects.count()
        paper_question_count_before = PaperQuestion.objects.count()

        response = self.client.post(
            f'/api/examinations/paper-uploads/{self.upload.id}/confirm/',
            {
                'exam_paper_id': self.exam_paper.id,
                'confirmed_data': {
                    'questions': [
                        {'question_text': 'Already-saved question', 'question_type': 'SHORT', 'marks': 5},
                    ],
                },
            },
            format='json',
            **self.school_header,
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['exam_paper_id'], self.exam_paper.id)

        # No new ExamPaper/Question/PaperQuestion rows — the draft pipeline already made them.
        self.assertEqual(ExamPaper.objects.count(), exam_paper_count_before)
        self.assertEqual(Question.objects.count(), question_count_before)
        self.assertEqual(PaperQuestion.objects.count(), paper_question_count_before)

        # PaperFeedback (learning loop) is still recorded.
        self.assertEqual(PaperFeedback.objects.filter(paper_upload=self.upload).count(), 1)

        self.upload.refresh_from_db()
        self.assertEqual(self.upload.status, PaperUpload.Status.CONFIRMED)
        self.assertEqual(self.upload.exam_paper_id, self.exam_paper.id)

    def test_confirm_without_exam_paper_id_still_creates_everything_legacy(self):
        exam_paper_count_before = ExamPaper.objects.count()
        question_count_before = Question.objects.count()

        response = self.client.post(
            f'/api/examinations/paper-uploads/{self.upload.id}/confirm/',
            {
                'confirmed_data': {
                    'questions': [
                        {'question_text': 'Brand new question', 'question_type': 'SHORT', 'marks': 3},
                    ],
                },
                'paper_metadata': {
                    'class_obj': self.class_obj.id,
                    'subject': self.subject.id,
                    'paper_title': 'Legacy Flow Paper',
                },
            },
            format='json',
            **self.school_header,
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(ExamPaper.objects.count(), exam_paper_count_before + 1)
        self.assertEqual(Question.objects.count(), question_count_before + 1)
        self.assertEqual(response.json()['questions_created'], 1)


class PaperExportLayoutTests(TestCase):
    """Unit tests for the shared DOCX/PDF layout-plan builder."""

    @classmethod
    def setUpTestData(cls):
        cls.school = _make_school()
        cls.class_obj = Class.objects.create(school=cls.school, name='Class 5', grade_level=5)
        cls.subject = Subject.objects.create(school=cls.school, name='Social Studies', code='SS')

    def _make_paper(self, structure, render_options=None):
        return ExamPaper.objects.create(
            school=self.school,
            class_obj=self.class_obj,
            subject=self.subject,
            paper_title='Term 2 Examination',
            total_marks=Decimal('60'),
            duration_minutes=90,
            structure=structure,
            render_options=render_options or {},
        )

    def _attach_question(self, paper, order, section_key, **kwargs):
        question = Question.objects.create(
            school=self.school,
            subject=self.subject,
            question_text=kwargs.pop('question_text', f'Question {order}'),
            question_type=kwargs.pop('question_type', 'SHORT'),
            marks=kwargs.pop('marks', 5),
            **kwargs,
        )
        paper_question = PaperQuestion.objects.create(
            exam_paper=paper,
            question=question,
            question_order=order,
            section_key=section_key,
            marks_override=question.marks,
        )
        paper_question.sync_question_snapshot()
        return paper_question

    def test_legacy_paper_returns_none(self):
        from .paper_export_layout import build_export_layout

        paper = self._make_paper(structure=[])
        self.assertIsNone(build_export_layout(paper))

    def test_fill_blank_group_becomes_one_question_with_generic_numbered_blanks(self):
        from .paper_export_layout import build_export_layout

        # type_data.items are the *answers* the teacher typed into the composer's "Answer
        # for blank N" fields (QuestionSlotEditor.jsx) -- mirrored into
        # type_data.accepted_answers for grading. Printing that text used to leak the
        # answer straight onto the student paper (e.g. "The capital of Pakistan is" would
        # actually be an answer like "Islamabad", printed right next to its own blank), so
        # the export now only prints a generic numbered blank per item and never echoes
        # its content -- the question stem (question_text) carries the actual prompt.
        paper = self._make_paper(structure=[
            {
                'key': 'sec_fill', 'title': 'Q1', 'instruction': None,
                'question_type': 'FILL_BLANK', 'slots_shown': 1, 'slots_counted': 1,
                'marks_per_question': '5',
            },
        ])
        self._attach_question(
            paper, order=1, section_key='sec_fill',
            question_text='Fill in the blanks:', question_type='FILL_BLANK', marks=5,
            type_data={'items': ['Islamabad', '100', '']},  # third is a discarded empty blank
        )

        layout = build_export_layout(paper)
        section = layout['blocks'][0]
        self.assertEqual(section['section_marks'], Decimal('5'))
        self.assertEqual(len(section['items']), 1)

        item = section['items'][0]
        self.assertEqual(item['question_type'], 'FILL_BLANK')
        self.assertEqual(item['marks'], 5)
        self.assertEqual(item['fill_blank_items'], [
            'Blank 1: __________',
            'Blank 2: __________',
        ])

    def test_matching_shuffle_is_deterministic_across_rebuilds(self):
        from .paper_export_layout import build_export_layout

        paper = self._make_paper(structure=[
            {
                'key': 'sec_match', 'title': 'Q2', 'instruction': None,
                'question_type': 'MATCHING', 'slots_shown': 1, 'slots_counted': 1,
                'marks_per_question': '5',
            },
        ])
        self._attach_question(
            paper, order=1, section_key='sec_match',
            question_text='Match the columns:', question_type='MATCHING', marks=5,
            type_data={'pairs': [
                {'left': 'France', 'right': 'Paris'},
                {'left': 'Japan', 'right': 'Tokyo'},
                {'left': 'Italy', 'right': 'Rome'},
                {'left': 'Egypt', 'right': 'Cairo'},
            ]},
        )

        first = build_export_layout(paper)
        second = build_export_layout(paper)

        first_pairs = first['blocks'][0]['items'][0]['matching_pairs']
        second_pairs = second['blocks'][0]['items'][0]['matching_pairs']

        self.assertEqual(first_pairs, second_pairs, 're-exports must reproduce the same shuffle')
        self.assertEqual([p['left'] for p in first_pairs], ['France', 'Japan', 'Italy', 'Egypt'])
        self.assertEqual(
            {p['right'] for p in first_pairs},
            {'Paris', 'Tokyo', 'Rome', 'Cairo'},
        )

    def test_choice_section_renders_all_shown_counts_marks_by_counted(self):
        from .paper_export_layout import build_export_layout

        paper = self._make_paper(structure=[
            {
                'key': 'sec_choice', 'title': 'Q4', 'instruction': 'Attempt any five Questions.',
                'question_type': 'SHORT', 'slots_shown': 7, 'slots_counted': 5,
                'marks_per_question': '5',
            },
        ])
        for i in range(7):
            self._attach_question(paper, order=i + 1, section_key='sec_choice', marks=5)

        layout = build_export_layout(paper)
        section = layout['blocks'][0]

        self.assertEqual(len(section['items']), 7, 'all attached questions must render, not just the counted number')
        self.assertEqual(section['section_marks'], Decimal('25'))

    def test_answer_lines_toggle(self):
        from .paper_export_layout import build_export_layout

        structure = [
            {
                'key': 'sec_short', 'title': 'Q1', 'instruction': None,
                'question_type': 'SHORT', 'slots_shown': 1, 'slots_counted': 1,
                'marks_per_question': '5',
            },
        ]
        paper_with_lines = self._make_paper(structure=structure, render_options={'answer_lines': True})
        self._attach_question(paper_with_lines, order=1, section_key='sec_short', question_type='SHORT', marks=5)

        paper_without_lines = self._make_paper(structure=structure, render_options={'answer_lines': False})
        self._attach_question(paper_without_lines, order=1, section_key='sec_short', question_type='SHORT', marks=5)

        with_lines = build_export_layout(paper_with_lines)
        without_lines = build_export_layout(paper_without_lines)

        self.assertEqual(with_lines['blocks'][0]['items'][0]['answer_lines'], 3)
        self.assertEqual(without_lines['blocks'][0]['items'][0]['answer_lines'], 0)

    def test_unassigned_questions_render_in_trailing_block(self):
        from .paper_export_layout import build_export_layout

        paper = self._make_paper(structure=[
            {
                'key': 'sec_a', 'title': 'Q1', 'instruction': None,
                'question_type': 'SHORT', 'slots_shown': 1, 'slots_counted': 1,
                'marks_per_question': '5',
            },
        ])
        self._attach_question(paper, order=1, section_key='sec_a', question_type='SHORT', marks=5)
        self._attach_question(paper, order=2, section_key='', question_type='SHORT', marks=3)

        layout = build_export_layout(paper)
        self.assertEqual(len(layout['blocks']), 2)
        self.assertEqual(layout['blocks'][0]['type'], 'section')
        self.assertEqual(layout['blocks'][1]['type'], 'unstructured')
        self.assertEqual(len(layout['blocks'][1]['items']), 1)
        # The lone section is question group 1, so its one item is its first lettered
        # part; the unassigned question has no section to belong to, so it just gets
        # the next plain group number with no letter.
        self.assertEqual(layout['blocks'][0]['items'][0]['number'], '1(a)')
        self.assertEqual(layout['blocks'][1]['items'][0]['number'], '2')

    def test_docx_generation_smoke_test_structured_and_legacy(self):
        if importlib.util.find_spec('docx') is None:
            self.skipTest('python-docx is not installed in this environment.')

        from .docx_generator import ExamPaperDOCXGenerator

        structured_paper = self._make_paper(structure=[
            {
                'key': 'sec_a', 'title': 'Q1', 'instruction': None,
                'question_type': 'SHORT', 'slots_shown': 1, 'slots_counted': 1,
                'marks_per_question': '5',
            },
        ], render_options={'answer_lines': True})
        self._attach_question(structured_paper, order=1, section_key='sec_a', question_type='SHORT', marks=5)

        legacy_paper = self._make_paper(structure=[])
        self._attach_question(legacy_paper, order=1, section_key='', question_type='SHORT', marks=5)

        self.assertGreater(len(ExamPaperDOCXGenerator(structured_paper).generate()), 0)
        self.assertGreater(len(ExamPaperDOCXGenerator(legacy_paper).generate()), 0)

    def test_render_item_carries_question_and_option_diagram_urls(self):
        """Diagram Mode: question_image_url and per-option *_image_url should flow
        through into the render item unchanged, so PDF/DOCX generators can draw them."""
        from .paper_export_layout import build_export_layout

        paper = self._make_paper(structure=[
            {
                'key': 'sec_mcq', 'title': 'Q1', 'instruction': None,
                'question_type': 'MCQ', 'slots_shown': 1, 'slots_counted': 1,
                'marks_per_question': '1',
            },
        ])
        self._attach_question(
            paper, order=1, section_key='sec_mcq', question_type='MCQ', marks=1,
            question_image_url='https://cdn.test/question.png',
            option_a='Square', option_b='Circle', option_c='', option_d='',
            option_a_image_url='https://cdn.test/option_a.png',
        )

        layout = build_export_layout(paper)
        item = layout['blocks'][0]['items'][0]

        self.assertEqual(item['question_image_url'], 'https://cdn.test/question.png')
        self.assertEqual(item['option_images']['A'], 'https://cdn.test/option_a.png')
        self.assertIsNone(item['option_images']['B'])

    def test_render_item_option_images_none_when_no_option_has_one(self):
        from .paper_export_layout import build_export_layout

        paper = self._make_paper(structure=[
            {
                'key': 'sec_mcq', 'title': 'Q1', 'instruction': None,
                'question_type': 'MCQ', 'slots_shown': 1, 'slots_counted': 1,
                'marks_per_question': '1',
            },
        ])
        self._attach_question(
            paper, order=1, section_key='sec_mcq', question_type='MCQ', marks=1,
            option_a='Square', option_b='Circle', option_c='Triangle', option_d='Hexagon',
        )

        layout = build_export_layout(paper)
        item = layout['blocks'][0]['items'][0]
        self.assertIsNone(item['option_images'])


class DiagramModeExportRenderingTests(TestCase):
    """PDF/DOCX must actually draw a Diagram Mode image, not just carry its URL
    through the layout plan -- see pdf_generator._load_image_stream and
    docx_generator._fetch_image_stream for why the URL can't be handed to
    ReportLab/python-docx directly."""

    @classmethod
    def setUpTestData(cls):
        cls.school = _make_school('_diagram_export')
        cls.class_obj = Class.objects.create(school=cls.school, name='Class 6', grade_level=6)
        cls.subject = Subject.objects.create(school=cls.school, name='Mathematics', code='MATH_DIAG')

    # 1x1 transparent PNG -- smallest input ReportLab/Pillow will actually decode,
    # so the smoke test exercises the real Image()/add_picture() call, not a mock.
    _PNG_BYTES = base64.b64decode(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    )

    def _make_paper(self):
        return ExamPaper.objects.create(
            school=self.school,
            class_obj=self.class_obj,
            subject=self.subject,
            paper_title='Geometry Quiz',
            total_marks=Decimal('1'),
            duration_minutes=20,
            structure=[
                {
                    'key': 'sec_mcq', 'title': 'Q1', 'instruction': None,
                    'question_type': 'MCQ', 'slots_shown': 1, 'slots_counted': 1,
                    'marks_per_question': '1',
                },
            ],
        )

    def _attach_mcq_with_diagrams(self, paper):
        question = Question.objects.create(
            school=self.school,
            subject=self.subject,
            question_text='Which of these is a rhombus?',
            question_type='MCQ',
            marks=1,
            question_image_url='https://cdn.test/question.png',
            option_a='', option_b='Circle', option_c='', option_d='',
            option_a_image_url='https://cdn.test/option_a.png',
        )
        paper_question = PaperQuestion.objects.create(
            exam_paper=paper, question=question, question_order=1,
            section_key='sec_mcq', marks_override=1,
        )
        paper_question.sync_question_snapshot()
        return paper_question

    def test_pdf_generation_embeds_question_and_option_diagrams(self):
        if importlib.util.find_spec('reportlab') is None:
            self.skipTest('reportlab is not installed in this environment.')

        from .pdf_generator import ExamPaperPDFGenerator

        paper = self._make_paper()
        self._attach_mcq_with_diagrams(paper)

        with patch('examinations.pdf_generator.requests.get') as mock_get:
            mock_get.return_value.content = self._PNG_BYTES
            mock_get.return_value.raise_for_status = lambda: None
            pdf_bytes = ExamPaperPDFGenerator(paper).generate()

        self.assertGreater(len(pdf_bytes), 0)
        self.assertGreaterEqual(mock_get.call_count, 2)  # question image + option A image

    def test_docx_generation_embeds_question_and_option_diagrams(self):
        if importlib.util.find_spec('docx') is None:
            self.skipTest('python-docx is not installed in this environment.')

        from .docx_generator import ExamPaperDOCXGenerator

        paper = self._make_paper()
        self._attach_mcq_with_diagrams(paper)

        with patch('examinations.docx_generator.requests.get') as mock_get:
            mock_get.return_value.content = self._PNG_BYTES
            mock_get.return_value.raise_for_status = lambda: None
            docx_bytes = ExamPaperDOCXGenerator(paper).generate()

        self.assertGreater(len(docx_bytes), 0)
        self.assertGreaterEqual(mock_get.call_count, 2)


class WorksheetLifecycleTests(TestCase):
    """Mirrors ExamPaperDraftAutosaveTests -- ensure-draft -> autosave (manual
    items) -> generate-pdf/docx -> duplicate, for the Worksheet sibling model."""

    @classmethod
    def setUpTestData(cls):
        cls.school = _make_school('_worksheet')
        cls.class_obj = Class.objects.create(school=cls.school, name='Class 4', grade_level=4)
        cls.subject = Subject.objects.create(school=cls.school, name='Mathematics', code='MATH_WS')
        cls.user = get_user_model().objects.create_superuser(
            username='worksheet_admin',
            email='worksheet_admin@test.com',
            password='test12345',
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.school_header = {'HTTP_X_SCHOOL_ID': str(self.school.id)}

    def _ensure_draft(self, **overrides):
        payload = {
            'class_obj': self.class_obj.id,
            'subject': self.subject.id,
            'title': 'Fractions Practice Sheet',
            'instructions': 'Show your working.',
        }
        payload.update(overrides)
        response = self.client.post(
            '/api/examinations/worksheets/ensure-draft/',
            payload,
            format='json',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def test_ensure_draft_creates_server_backed_draft(self):
        payload = self._ensure_draft()

        self.assertEqual(payload['status'], Worksheet.Status.DRAFT)
        self.assertEqual(payload['title'], 'Fractions Practice Sheet')
        self.assertEqual(payload['class_obj'], self.class_obj.id)
        self.assertEqual(payload['subject'], self.subject.id)
        self.assertTrue(Worksheet.objects.filter(id=payload['id'], status=Worksheet.Status.DRAFT).exists())

    def test_ensure_draft_rejects_teacher_without_class_subject_scope(self):
        teacher = get_user_model().objects.create_user(
            username='ws_unassigned_teacher',
            email='ws_unassigned_teacher@test.com',
            password='test12345',
            role='TEACHER',
            school=self.school,
        )
        self.client.force_authenticate(teacher)

        response = self.client.post(
            '/api/examinations/worksheets/ensure-draft/',
            {'class_obj': self.class_obj.id, 'subject': self.subject.id, 'title': 'Not allowed'},
            format='json',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 403)

    def test_autosave_creates_items_and_snapshots(self):
        draft = self._ensure_draft(
            structure=[
                {
                    'key': 'sec_1',
                    'title': 'Section A',
                    'question_type': 'SHORT',
                    'slots_shown': 3,
                    'slots_counted': 3,
                    'marks_per_question': '0',
                }
            ],
        )

        autosave_response = self.client.post(
            f"/api/examinations/worksheets/{draft['id']}/autosave/",
            {
                'manual_items': [
                    {
                        'question_text': 'Simplify 4/8.',
                        'question_type': 'SHORT',
                        'difficulty_level': 'EASY',
                        'marks': '0',
                        'answer_text': '1/2',
                        'item_order': 1,
                        'section_key': 'sec_1',
                    }
                ]
            },
            format='json',
            **self.school_header,
        )

        self.assertEqual(autosave_response.status_code, 200, autosave_response.content)
        data = autosave_response.json()
        self.assertEqual(data['item_count'], 1)
        self.assertEqual(len(data['items']), 1)
        self.assertEqual(Question.objects.count(), 1)
        self.assertEqual(data['items'][0]['section_key'], 'sec_1')

        item = WorksheetItem.objects.get(worksheet_id=draft['id'])
        self.assertEqual(item.question.question_text, 'Simplify 4/8.')
        self.assertEqual(item.item_snapshot['question_text'], 'Simplify 4/8.')

    def test_autosave_attaches_existing_bank_question_without_duplicating(self):
        draft = self._ensure_draft()
        bank_question = Question.objects.create(
            school=self.school,
            subject=self.subject,
            question_text='Pre-existing bank question',
            question_type='SHORT',
            difficulty_level='MEDIUM',
            marks=Decimal('0'),
        )

        autosave_response = self.client.post(
            f"/api/examinations/worksheets/{draft['id']}/autosave/",
            {
                'manual_items': [
                    {
                        'question_id': bank_question.id,
                        'question_text': bank_question.question_text,
                        'question_type': bank_question.question_type,
                        'item_order': 1,
                    }
                ]
            },
            format='json',
            **self.school_header,
        )

        self.assertEqual(autosave_response.status_code, 200, autosave_response.content)
        self.assertEqual(Question.objects.count(), 1, 'must reuse the bank question, not duplicate it')
        item = WorksheetItem.objects.get(worksheet_id=draft['id'])
        self.assertEqual(item.question_id, bank_question.id)

    def test_duplicate_copies_items_as_new_draft(self):
        draft = self._ensure_draft()
        self.client.post(
            f"/api/examinations/worksheets/{draft['id']}/autosave/",
            {'manual_items': [{'question_text': 'Q1', 'question_type': 'SHORT', 'item_order': 1}]},
            format='json',
            **self.school_header,
        )

        response = self.client.post(
            f"/api/examinations/worksheets/{draft['id']}/duplicate/",
            {},
            format='json',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 201, response.content)
        clone = response.json()
        self.assertNotEqual(clone['id'], draft['id'])
        self.assertEqual(clone['title'], 'Fractions Practice Sheet (Copy)')
        self.assertEqual(clone['item_count'], 1)
        self.assertEqual(Worksheet.objects.count(), 2)

    def test_generate_pdf_and_docx_smoke(self):
        if importlib.util.find_spec('reportlab') is None or importlib.util.find_spec('docx') is None:
            self.skipTest('reportlab/python-docx not installed in this environment.')

        draft = self._ensure_draft(
            structure=[
                {
                    'key': 'sec_1', 'title': 'Section A', 'question_type': 'SHORT',
                    'slots_shown': 1, 'slots_counted': 1, 'marks_per_question': '0',
                }
            ],
        )
        self.client.post(
            f"/api/examinations/worksheets/{draft['id']}/autosave/",
            {'manual_items': [{'question_text': 'Q1', 'question_type': 'SHORT', 'item_order': 1, 'section_key': 'sec_1'}]},
            format='json',
            **self.school_header,
        )

        pdf_response = self.client.get(
            f"/api/examinations/worksheets/{draft['id']}/generate-pdf/",
            **self.school_header,
        )
        self.assertEqual(pdf_response.status_code, 200)
        self.assertEqual(pdf_response['Content-Type'], 'application/pdf')

        docx_response = self.client.get(
            f"/api/examinations/worksheets/{draft['id']}/generate-docx/",
            **self.school_header,
        )
        self.assertEqual(docx_response.status_code, 200)


class WorksheetUploadTests(TestCase):
    """Upload -> OCR (mocked) -> confirm, mirroring PaperUploadContextPersistenceTests
    but against WorksheetUpload/Worksheet."""

    @classmethod
    def setUpTestData(cls):
        cls.school = _make_school('_worksheet_upload')
        cls.class_obj = Class.objects.create(school=cls.school, name='Class 5', grade_level=5)
        cls.subject = Subject.objects.create(school=cls.school, name='English', code='ENG_WS')
        cls.user = get_user_model().objects.create_superuser(
            username='worksheet_upload_admin',
            email='worksheet_upload_admin@test.com',
            password='test12345',
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.school_header = {'HTTP_X_SCHOOL_ID': str(self.school.id)}

    def test_confirm_links_worksheet_and_marks_confirmed(self):
        worksheet = Worksheet.objects.create(
            school=self.school,
            class_obj=self.class_obj,
            subject=self.subject,
            title='Scanned Worksheet',
            source=Worksheet.Source.SCAN,
        )
        upload = WorksheetUpload.objects.create(
            school=self.school,
            uploaded_by=self.user,
            image_url='https://cdn.test/worksheet.png',
            status=WorksheetUpload.Status.EXTRACTED,
            ai_extracted_json={'questions': []},
        )

        response = self.client.post(
            f"/api/examinations/worksheet-uploads/{upload.id}/confirm/",
            {'worksheet_id': worksheet.id},
            format='json',
            **self.school_header,
        )

        self.assertEqual(response.status_code, 200, response.content)
        upload.refresh_from_db()
        self.assertEqual(upload.status, WorksheetUpload.Status.CONFIRMED)
        self.assertEqual(upload.worksheet_id, worksheet.id)

    def test_confirm_requires_extracted_status(self):
        worksheet = Worksheet.objects.create(
            school=self.school, class_obj=self.class_obj, subject=self.subject, title='X',
        )
        upload = WorksheetUpload.objects.create(
            school=self.school, uploaded_by=self.user,
            image_url='https://cdn.test/worksheet.png',
            status=WorksheetUpload.Status.PENDING,
        )

        response = self.client.post(
            f"/api/examinations/worksheet-uploads/{upload.id}/confirm/",
            {'worksheet_id': worksheet.id},
            format='json',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 400)

# ---------------------------------------------------------------------------
# Paper OCR reliability: single run, user-safe errors, 429 retry, degraded flag
# ---------------------------------------------------------------------------
from django.test import SimpleTestCase, override_settings


class PaperOcrReliabilityTests(SimpleTestCase):
    def test_call_task_does_not_rerun_when_eager_delay_already_ran(self):
        """.delay() in eager mode runs the task inline; an error raised afterwards (bad
        result-backend URL) must not trigger a second run -- that doubled OCR cost."""
        from core.task_utils import call_task

        calls = []

        def task_body(upload_id):
            calls.append(upload_id)

        task_body.delay = lambda *a, **k: (task_body(*a, **k), (_ for _ in ()).throw(RuntimeError('bad rediss url')))
        with override_settings(CELERY_TASK_ALWAYS_EAGER=True):
            self.assertFalse(call_task(task_body, 5))
        self.assertEqual(calls, [5])

    @patch('examinations.tasks.process_paper_upload_ocr')
    def test_start_paper_ocr_runs_once_when_eager(self, mock_task):
        from examinations.tasks import start_paper_ocr

        with override_settings(CELERY_TASK_ALWAYS_EAGER=True):
            start_paper_ocr(7)
        mock_task.assert_called_once_with(7)

    def test_friendly_error_hides_provider_details(self):
        from examinations.paper_ocr_processor import (
            friendly_ocr_error, MSG_AI_BUSY, MSG_GENERIC_FAILURE,
        )

        raw = "Groq API error (m): 429: Rate limit ... organization `org_01abc` ... console.groq.com/settings/billing"
        self.assertEqual(friendly_ocr_error(raw), MSG_AI_BUSY)
        self.assertEqual(friendly_ocr_error("Google Vision API error: key xyz"), MSG_GENERIC_FAILURE)
        self.assertNotIn('org_', friendly_ocr_error(raw))

    def test_org_ids_are_masked_in_provider_errors(self):
        from examinations.paper_ocr_processor import _mask_provider_ids

        self.assertEqual(_mask_provider_ids('organization `org_01kffk1mhce8` x'), 'organization `org_***` x')

    def test_regex_fallback_handles_two_digit_and_paren_numbering(self):
        from examinations.paper_ocr_processor import QuestionReviewAI  # noqa: F401
        from examinations.paper_ocr_processor import PaperOCRProcessor

        processor = PaperOCRProcessor.__new__(PaperOCRProcessor)
        text = "1) What is a noun?\n9. Define verb\n10. Name a pronoun\nQ11 Write an essay"
        questions = processor._fallback_question_extraction(text)
        self.assertEqual(len(questions), 4)

    def test_fallback_result_is_marked_degraded(self):
        from examinations.paper_ocr_processor import PaperOCRProcessor

        processor = PaperOCRProcessor.__new__(PaperOCRProcessor)
        parsed = processor._fallback_or_raise("1. What is a noun?\n2. Define verb", "429: busy")
        self.assertTrue(parsed['degraded'])
        self.assertEqual(len(parsed['questions']), 2)

    def test_groq_429_is_retried_once_after_the_requested_wait(self):
        from examinations.paper_ocr_processor import PaperOCRProcessor

        processor = PaperOCRProcessor.__new__(PaperOCRProcessor)
        busy = MagicMock(status_code=429, text='Please try again in 3.5025s.')
        ok = MagicMock(status_code=200, text='{}')
        with patch('examinations.paper_ocr_processor.requests.post', side_effect=[busy, ok]) as post,                 patch('examinations.paper_ocr_processor.time.sleep') as sleep:
            response = processor._post_groq_with_retry({}, {})
        self.assertIs(response, ok)
        self.assertEqual(post.call_count, 2)
        sleep.assert_called_once()
        self.assertAlmostEqual(sleep.call_args[0][0], 4.0025, places=2)

    def test_near_empty_ocr_text_fails_as_unreadable(self):
        from examinations.paper_ocr_processor import PaperOCRProcessor, MSG_UNREADABLE

        processor = PaperOCRProcessor.__new__(PaperOCRProcessor)
        processor.google_api_key = 'test-key'
        vision = MagicMock(ok=True)
        vision.json.return_value = {'responses': [{'fullTextAnnotation': {'text': 'Q1 name'}}]}
        with patch('examinations.paper_ocr_processor.requests.post', return_value=vision):
            result = processor._process_with_google_vision('https://example.test/p.jpg')
        self.assertFalse(result.success)
        self.assertEqual(result.error, MSG_UNREADABLE)


# ---------------------------------------------------------------------------
# Paper page photos: compressed storage, page photos in group-status, source-pages,
# cleanup of unsaved pages
# ---------------------------------------------------------------------------
import io
from datetime import timedelta
from unittest.mock import PropertyMock

from django.core.management import call_command
from django.utils import timezone
from PIL import Image


def _image_bytes(size, fmt='JPEG', mode='RGB', exif_orientation=None):
    image = Image.new(mode, size, (200, 120, 40) if mode == 'RGB' else (200, 120, 40, 255))
    buffer = io.BytesIO()
    kwargs = {}
    if exif_orientation:
        exif = Image.Exif()
        exif[0x0112] = exif_orientation
        kwargs['exif'] = exif
    image.save(buffer, format=fmt, **kwargs)
    return buffer.getvalue()


class PaperImageCompressionTests(SimpleTestCase):
    def _compress(self, data, content_type='image/jpeg'):
        from core.storage import _compress_if_needed
        return _compress_if_needed(data, content_type, 2000)

    def test_oversized_photo_is_scaled_down_and_stored_as_jpeg(self):
        data, content_type = self._compress(_image_bytes((4000, 3000), 'PNG'), 'image/png')
        image = Image.open(io.BytesIO(data))
        self.assertEqual(content_type, 'image/jpeg')
        self.assertEqual(image.format, 'JPEG')
        self.assertEqual(max(image.size), 2000)

    def test_small_jpeg_is_stored_untouched(self):
        original = _image_bytes((1200, 900))
        data, content_type = self._compress(original)
        self.assertEqual(data, original)
        self.assertEqual(content_type, 'image/jpeg')

    def test_camera_rotation_is_applied(self):
        # Landscape pixels with EXIF orientation 6 (rotate 90 clockwise) must come out portrait.
        data, _ = self._compress(_image_bytes((3000, 2000), exif_orientation=6))
        width, height = Image.open(io.BytesIO(data)).size
        self.assertGreater(height, width)

    def test_transparent_png_is_flattened_to_rgb(self):
        data, _ = self._compress(_image_bytes((2500, 1800), 'PNG', mode='RGBA'), 'image/png')
        self.assertEqual(Image.open(io.BytesIO(data)).mode, 'RGB')

    def test_a_file_that_is_not_an_image_is_rejected(self):
        with self.assertRaises(ValueError):
            self._compress(b'not an image at all', 'application/pdf')

    def test_upload_file_sends_the_compressed_bytes(self):
        from core.storage import SupabaseStorageService

        bucket = MagicMock()
        client = MagicMock()
        client.storage.from_.return_value = bucket
        bucket.get_public_url.return_value = 'https://example.test/p.jpg'
        service = SupabaseStorageService.__new__(SupabaseStorageService)
        service.bucket = 'b'
        with patch.object(SupabaseStorageService, 'is_configured', return_value=True), \
                patch.object(SupabaseStorageService, 'client', new_callable=PropertyMock, return_value=client):
            upload = SimpleUploadedFile('big.png', _image_bytes((4000, 3000), 'PNG'), content_type='image/png')
            url = service.upload_file(upload, 'papers/1', 'paper_x.jpg', max_image_dimension=2000)
        self.assertEqual(url, 'https://example.test/p.jpg')
        kwargs = bucket.upload.call_args.kwargs
        self.assertEqual(kwargs['file_options']['content-type'], 'image/jpeg')
        self.assertEqual(kwargs['file_options']['upsert'], 'true')
        self.assertEqual(max(Image.open(io.BytesIO(kwargs['file'])).size), 2000)
        bucket.remove.assert_not_called()  # the pre-upload DELETE is gone


class PaperPagePhotoApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.school = _make_school(suffix='-photo')
        cls.other_school = _make_school(suffix='-photo2')
        cls.class_obj = Class.objects.create(school=cls.school, name='Class 5', grade_level=5)
        cls.subject = Subject.objects.create(school=cls.school, name='Maths', code='MTH')
        cls.user = get_user_model().objects.create_superuser(
            username='photo_admin', email='photo_admin@test.com', password='test12345',
        )

    def setUp(self):
        import uuid
        self.group_id = uuid.uuid4()
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.header = {'HTTP_X_SCHOOL_ID': str(self.school.id)}

    def _page(self, number, **extra):
        return PaperUpload.objects.create(
            school=self.school, uploaded_by=self.user, image_url=f'https://example.test/p{number}.jpg',
            group_id=self.group_id, page_number=number, status=PaperUpload.Status.EXTRACTED,
            ai_extracted_json={'sections': [{
                'title': f'S{number}', 'question_type_guess': 'SHORT', 'marks_per_question': 1,
                'shown_count': 1, 'counted_count': 1,
                'questions': [{'question_text': f'q{number}', 'question_type': 'SHORT', 'marks': 1}]}]},
            **extra,
        )

    def test_group_status_returns_each_pages_photo_and_each_questions_page(self):
        self._page(1)
        self._page(2)
        body = self.client.get(
            '/api/examinations/paper-uploads/group-status/',
            {'group_id': str(self.group_id), 'total_pages': 2}, **self.header,
        ).json()
        self.assertEqual([p['image_url'] for p in body['pages']],
                         ['https://example.test/p1.jpg', 'https://example.test/p2.jpg'])
        self.assertEqual([q['page_number'] for q in body['result']['questions']], [1, 2])

    def test_source_pages_lists_the_photos_of_a_saved_paper_in_page_order(self):
        paper = ExamPaper.objects.create(
            school=self.school, class_obj=self.class_obj, subject=self.subject, paper_title='Scanned',
        )
        self._page(2, exam_paper=paper)
        self._page(1, exam_paper=paper)
        response = self.client.get(f'/api/examinations/exam-papers/{paper.id}/source-pages/', **self.header)
        self.assertEqual(response.status_code, 200)
        self.assertEqual([p['page_number'] for p in response.json()], [1, 2])
        self.assertEqual(response.json()[0]['image_url'], 'https://example.test/p1.jpg')

    def test_source_pages_is_not_readable_from_another_school(self):
        paper = ExamPaper.objects.create(
            school=self.school, class_obj=self.class_obj, subject=self.subject, paper_title='Scanned',
        )
        other_header = {'HTTP_X_SCHOOL_ID': str(self.other_school.id)}
        response = self.client.get(f'/api/examinations/exam-papers/{paper.id}/source-pages/', **other_header)
        self.assertEqual(response.status_code, 404)

    def test_upload_rejects_a_file_that_is_not_an_image_with_a_clear_message(self):
        from core.storage import SupabaseStorageService

        class _Bucket:
            def upload(self, *a, **k):
                raise AssertionError('must not upload a non-image')

            def get_public_url(self, *a, **k):
                return ''

        client = MagicMock()
        client.storage.from_.return_value = _Bucket()
        with patch.object(SupabaseStorageService, 'is_configured', return_value=True), \
                patch.object(SupabaseStorageService, 'client', new_callable=PropertyMock, return_value=client):
            response = self.client.post(
                '/api/examinations/paper-uploads/upload-image/',
                {'image': SimpleUploadedFile('x.png', b'definitely not a png', content_type='image/png')},
                format='multipart', **self.header,
            )
        # Either the serializer's image validation or the storage guard rejects it: a 400, never a 500.
        self.assertEqual(response.status_code, 400)


class CleanupPaperUploadsCommandTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.school = _make_school(suffix='-clean')
        cls.class_obj = Class.objects.create(school=cls.school, name='Class 5', grade_level=5)
        cls.subject = Subject.objects.create(school=cls.school, name='Maths', code='MTH')

    def _upload(self, status_value, days_old, exam_paper=None):
        upload = PaperUpload.objects.create(
            school=self.school, image_url='https://x.supabase.co/storage/v1/object/public/atten-reg/papers/1/a.jpg',
            status=status_value, exam_paper=exam_paper,
        )
        PaperUpload.objects.filter(pk=upload.pk).update(created_at=timezone.now() - timedelta(days=days_old))
        return upload

    def test_dry_run_changes_nothing(self):
        stale = self._upload(PaperUpload.Status.FAILED, 40)
        out = io.StringIO()
        call_command('cleanup_paper_uploads', stdout=out)
        self.assertTrue(PaperUpload.objects.filter(pk=stale.pk).exists())
        self.assertIn('Dry run', out.getvalue())

    def test_apply_deletes_only_old_unsaved_pages(self):
        paper = ExamPaper.objects.create(
            school=self.school, class_obj=self.class_obj, subject=self.subject, paper_title='Kept',
        )
        old_failed = self._upload(PaperUpload.Status.FAILED, 40)
        old_unsaved = self._upload(PaperUpload.Status.EXTRACTED, 40)
        recent = self._upload(PaperUpload.Status.FAILED, 5)
        confirmed = self._upload(PaperUpload.Status.CONFIRMED, 90, exam_paper=paper)
        linked_odd_status = self._upload(PaperUpload.Status.EXTRACTED, 90, exam_paper=paper)

        with patch('examinations.management.commands.cleanup_paper_uploads.SupabaseStorageService') as service_cls:
            service = service_cls.return_value
            service._extract_storage_path.return_value = 'papers/1/a.jpg'
            service.delete_file.return_value = True
            call_command('cleanup_paper_uploads', '--apply', stdout=io.StringIO())

        remaining = set(PaperUpload.objects.values_list('pk', flat=True))
        self.assertEqual(remaining, {recent.pk, confirmed.pk, linked_odd_status.pk})
        self.assertNotIn(old_failed.pk, remaining)
        self.assertNotIn(old_unsaved.pk, remaining)
        self.assertEqual(service.delete_file.call_count, 2)

    def test_a_photo_that_could_not_be_deleted_keeps_its_row_for_the_next_run(self):
        stale = self._upload(PaperUpload.Status.FAILED, 40)
        with patch('examinations.management.commands.cleanup_paper_uploads.SupabaseStorageService') as service_cls:
            service = service_cls.return_value
            service._extract_storage_path.return_value = 'papers/1/a.jpg'
            service.delete_file.return_value = False
            call_command('cleanup_paper_uploads', '--apply', stdout=io.StringIO())
        self.assertTrue(PaperUpload.objects.filter(pk=stale.pk).exists())


# ---------------------------------------------------------------------------
# Paper layout (Vision v2): the three real handwritten maths pages are the fixtures
# ---------------------------------------------------------------------------
import os
from django.test import override_settings

_FIXTURE_DIR = os.path.join(os.path.dirname(__file__), 'fixtures_paper_layout')


def _vision_fixture(number):
    with open(os.path.join(_FIXTURE_DIR, f'page{number}.json'), encoding='utf-8') as handle:
        return json.load(handle)


class PaperLayoutRealPageTests(SimpleTestCase):
    """The pages are the MCQ page (1), the written-answers page (2) and the HCF/LCM/fractions page (3)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        from examinations import paper_layout
        cls.layouts = {n: paper_layout.build_layout(_vision_fixture(n)) for n in (1, 2, 3)}

    def test_page_tilt_is_found_from_the_words(self):
        self.assertLess(self.layouts[3].skew_degrees, -2.5)
        self.assertGreater(self.layouts[3].skew_degrees, -6.0)

    def test_side_by_side_parts_stay_on_one_row_in_reading_order(self):
        text = self.layouts[3].text
        self.assertIn('Find HCF using prime factorization.', text)
        self.assertIn('15, 95, 35 | 2) 20, 30, 50', text)
        self.assertIn('13,65 | 2) 50,60', text)

    def test_stacked_fractions_are_joined(self):
        text = self.layouts[3].text
        self.assertIn('5/14 + 11/42', text)
        self.assertIn('13/16', text)
        self.assertIn('14/32', text)

    def test_numbers_in_running_text_lists_and_options_are_not_taken_for_fractions(self):
        page2, page1 = self.layouts[2].text, self.layouts[1].text
        self.assertNotIn('295/364', page2)           # "295 sweets ... 364 packets"
        self.assertNotIn('21/75', page2)             # the pattern rows 21, 42, 63 / 75, 63, 51
        self.assertIn('There are 295 sweets in a packet', page2)
        self.assertNotIn('610/10', page1)            # a question and the option row under it
        self.assertIn('Dividing 610 by 10 is', page1)

    def test_handwritten_margin_marks_move_onto_their_question_row(self):
        self.assertRegex(self.layouts[3].text, r'LCM using division method\. \[MARKS 34\]')
        self.assertIn('[MARKS 10]', self.layouts[1].text)
        # An answer option that happens to sit at the page edge is not a mark.
        self.assertIn('99,999', self.layouts[1].text)
        self.assertNotIn('[MARKS 99', self.layouts[1].text)

    def test_text_from_the_neighbouring_sheet_and_the_page_label_are_dropped(self):
        self.assertNotIn('HCF', self.layouts[2].text)     # rotated "Find HCF 15, 95" at the page edge
        self.assertNotIn('Page 3', self.layouts[3].text)

    def test_an_empty_answer_box_in_a_number_pattern_is_marked(self):
        self.assertRegex(self.layouts[2].text, r'63, \[BLANK\] .*105')
        self.assertRegex(self.layouts[1].text, r'14, 28 \[BLANK\]')

    def test_drawings_are_found_and_cut_between_the_lines_of_writing(self):
        layout = self.layouts[3]
        self.assertEqual([f.id for f in layout.figures], ['F1', 'F2'])
        first, second = layout.figures
        fractions_row = next(ln for ln in layout.lines if 'QFractions' in ln.text)
        label_row = next(ln for ln in layout.lines if ln.text == 'Q13')
        self.assertEqual((first.after_line, second.after_line), (fractions_row.id, label_row.id))
        # The first row of circles starts under "QFractions." and ends above the "Q13" label.
        self.assertGreaterEqual(first.box['y0'], fractions_row.box['y1'])
        self.assertLessEqual(first.box['y1'], label_row.box['y0'])
        self.assertGreater(first.box['y1'] - first.box['y0'], 0.15)
        self.assertGreater(second.box['y1'] - second.box['y0'], 0.08)
        # A page with no drawings gets none.
        self.assertEqual(self.layouts[2].figures, [])

    def test_every_line_has_a_box_on_the_photo(self):
        for layout in self.layouts.values():
            for line in layout.lines:
                self.assertTrue(0 <= line.box['x0'] < line.box['x1'] <= 1, line.text)
                self.assertTrue(0 <= line.box['y0'] < line.box['y1'] <= 1, line.text)

    def test_uncertain_digits_are_reported_for_the_lines_they_are_on(self):
        from examinations import paper_layout
        layout = self.layouts[3]
        fractions_row = next(ln for ln in layout.lines if '5/14' in ln.text)
        notes = paper_layout.uncertain_notes(layout, fractions_row.id, fractions_row.id)
        self.assertIn('"11/42" may be misread', notes)  # the numerator read at 0.5 confidence
        # A line of confidently read words reports nothing.
        confident = next(ln for ln in layout.lines if ln.text == 'Find HCF using division method.')
        self.assertEqual(paper_layout.uncertain_notes(layout, confident.id, confident.id), [])

    def test_a_response_with_no_words_gives_no_layout(self):
        from examinations import paper_layout
        self.assertIsNone(paper_layout.build_layout({}))
        self.assertIsNone(paper_layout.build_layout({'fullTextAnnotation': {'pages': [{'width': 10, 'height': 10, 'blocks': []}]}}))


def _synthetic_page(words, width=1000, height=1000):
    """words: [(text, x, y, w, h)] -> a Vision-shaped response with upright boxes."""
    vertices = lambda x, y, w, h: [{'x': x, 'y': y}, {'x': x + w, 'y': y}, {'x': x + w, 'y': y + h}, {'x': x, 'y': y + h}]
    return {'fullTextAnnotation': {'text': ' '.join(t for t, *_ in words), 'pages': [{
        'width': width, 'height': height,
        'blocks': [{'paragraphs': [{'words': [
            {'boundingBox': {'vertices': vertices(x, y, w, h)}, 'confidence': 0.9, 'symbols': [{'text': t}]}
            for t, x, y, w, h in words
        ]}]}],
    }]}}


class PaperLayoutRulesTests(SimpleTestCase):
    def test_list_labels_stacked_in_a_column_are_not_a_fraction(self):
        from examinations import paper_layout
        page = _synthetic_page([
            ('1', 50, 100, 20, 30), (')', 72, 100, 10, 30), ('red', 120, 100, 60, 30),
            ('2', 50, 150, 20, 30), (')', 72, 150, 10, 30), ('blue', 120, 150, 60, 30),
            ('3', 50, 200, 20, 30), (')', 72, 200, 10, 30), ('green', 120, 200, 60, 30),
            ('4', 50, 250, 20, 30), (')', 72, 250, 10, 30), ('pink', 120, 250, 60, 30),
        ])
        text = paper_layout.build_layout(page).text
        self.assertNotIn('1/2', text)
        self.assertIn('1) red', text)

    def test_a_real_stacked_fraction_in_a_row_of_numbers_is_joined(self):
        from examinations import paper_layout
        filler = [(w, 50 + i * 40, 600, 30, 30) for i, w in enumerate('abcdefgh')]
        page = _synthetic_page(filler + [
            ('3', 200, 100, 22, 30), ('+', 240, 118, 20, 20), ('1', 280, 100, 22, 30),
            ('4', 200, 140, 22, 30), ('5', 280, 140, 22, 30),
        ])
        self.assertIn('3/4 + 1/5', paper_layout.build_layout(page).text)

    def test_right_to_left_papers_read_right_to_left_and_keep_the_mark_on_the_left(self):
        from examinations import paper_layout
        words = [('اول', 700, 100, 80, 30), ('دوم', 500, 100, 80, 30), ('سوم', 300, 100, 80, 30), ('5', 30, 100, 20, 30)]
        filler = [(w, 100 + i * 80, 300 + 50 * (i % 2), 60, 30) for i, w in enumerate(['الف', 'ب', 'ج', 'د', 'ه', 'و'])]
        layout = paper_layout.build_layout(_synthetic_page(words + filler), direction='rtl')
        first = layout.lines[0]
        self.assertEqual(first.text, 'اول دوم سوم')
        self.assertEqual(first.marks, '5')

    def test_direction_follows_the_script_of_the_page_not_the_subject(self):
        from examinations.paper_layout_apply import detect_direction
        self.assertEqual(detect_direction({'fullTextAnnotation': {'text': 'سوال نمبر ایک اردو'}}), 'rtl')
        self.assertEqual(detect_direction({'fullTextAnnotation': {'text': 'Islamiyat paper question 1'}}), 'ltr')
        self.assertEqual(detect_direction({}), 'ltr')


class PaperLayoutApplyTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        from lms.models import Book
        cls.school = _make_school(suffix='-layout')
        cls.class_obj = Class.objects.create(school=cls.school, name='Class 5', grade_level=5)
        cls.urdu = Subject.objects.create(school=cls.school, name='Urdu', code='URD')
        cls.maths = Subject.objects.create(school=cls.school, name='Maths', code='MTH')
        cls.islamiyat = Subject.objects.create(school=cls.school, name='Islamiyat', code='ISL')
        cls.book_subject = Subject.objects.create(school=cls.school, name='Reading', code='RDG')
        Book.objects.create(
            school=cls.school, class_obj=cls.class_obj, subject=cls.book_subject, title='Sindhi Reader', language='sd',
        )

    def _context(self, subject):
        return {'school_id': self.school.id, 'class_id': self.class_obj.id, 'subject_id': subject.id,
                'subject_name': subject.name, 'subject_code': subject.code}

    def test_language_hints_come_from_the_subject_with_english_always_included(self):
        from examinations.paper_layout_apply import vision_language_hints
        self.assertEqual(vision_language_hints(self._context(self.urdu)), ['ur', 'en'])
        self.assertEqual(vision_language_hints(self._context(self.islamiyat)), ['ur', 'en'])
        self.assertEqual(vision_language_hints(self._context(self.maths)), ['en'])
        self.assertEqual(vision_language_hints(None), ['en'])

    def test_a_curriculum_book_language_wins_over_the_subject_name(self):
        from examinations.paper_layout_apply import vision_language_hints
        self.assertEqual(vision_language_hints(self._context(self.book_subject)), ['sd', 'en'])

    def test_line_references_become_a_photo_box_and_a_figure_crop(self):
        from examinations import paper_layout
        from examinations.paper_layout_apply import attach_layout

        layout = paper_layout.build_layout(_vision_fixture(3))
        fractions_row = next(ln for ln in layout.lines if 'QFractions' in ln.text)
        add_row = next(ln for ln in layout.lines if '5/14' in ln.text)
        parsed = {'sections': [{'questions': [
            {'question_text': 'Add the following fractions', 'lines': [add_row.id - 1, add_row.id]},
            {'question_text': 'Fractions.', 'lines': [fractions_row.id, fractions_row.id], 'figure': 'F1'},
            {'question_text': 'no lines given'},
        ]}]}
        cut = {}

        def fake_crop(image, box, school_id):
            cut['box'], cut['school_id'] = box, school_id
            return 'https://example.test/figures/f1.jpg'

        with patch('examinations.paper_layout_apply._download_image', return_value=object()), \
                patch('examinations.paper_layout_apply._crop_and_store', side_effect=fake_crop):
            attach_layout(parsed, layout, 'https://example.test/p.jpg', 7)

        add_q, figure_q, plain_q = parsed['sections'][0]['questions']
        rows = [layout.line(add_row.id - 1), layout.line(add_row.id)]
        self.assertEqual(add_q['box']['y0'], min(r.box['y0'] for r in rows))
        self.assertEqual(add_q['box']['y1'], max(r.box['y1'] for r in rows))
        self.assertNotIn('figure_url', add_q)
        self.assertEqual(figure_q['question_image_url'], 'https://example.test/figures/f1.jpg')
        self.assertEqual(cut['box'], layout.figures[0].box)
        self.assertEqual(cut['school_id'], 7)
        self.assertNotIn('box', plain_q)

    def test_no_figure_means_the_photo_is_never_downloaded(self):
        from examinations import paper_layout
        from examinations.paper_layout_apply import attach_layout

        layout = paper_layout.build_layout(_vision_fixture(2))
        parsed = {'sections': [{'questions': [{'question_text': 'q', 'lines': [1, 2]}]}]}
        with patch('examinations.paper_layout_apply._download_image') as download:
            attach_layout(parsed, layout, 'https://example.test/p.jpg', 7)
        download.assert_not_called()
        self.assertIn('box', parsed['sections'][0]['questions'][0])


class PaperLayoutPipelineTests(TestCase):
    """The Vision -> layout -> LLM path of PaperOCRProcessor with both external calls mocked."""

    def _run(self, llm_sections, context=None):
        vision = MagicMock(ok=True)
        vision.json.return_value = {'responses': [_vision_fixture(3)]}
        groq = MagicMock(ok=True, status_code=200)
        groq.json.return_value = {'choices': [{'message': {'content': json.dumps({'header': {}, 'sections': llm_sections})}}]}
        processor = PaperOCRProcessor.__new__(PaperOCRProcessor)
        processor.google_api_key = 'test-key'
        processor.groq_api_key = 'test-key'
        with patch('examinations.paper_ocr_processor.requests.post', side_effect=[vision, groq]) as post, \
                patch('examinations.paper_layout_apply._download_image', return_value=None):
            result = processor._process_with_google_vision('https://example.test/p.jpg', context or {})
        return result, post

    @override_settings(PAPER_LAYOUT_V2=True)
    def test_layout_mode_sends_the_tagged_layout_and_returns_boxes(self):
        sections = [{'title': 'Q1', 'question_type_guess': 'SHORT', 'marks_per_question': 4, 'shown_count': 1, 'counted_count': 1,
                     'questions': [{'question_text': 'Find HCF using prime factorization.\n1) 15, 95, 35', 'question_type': 'SHORT',
                                    'marks': 4, 'lines': [1, 2]}]}]
        result, post = self._run(sections, {'school_id': 1, 'subject_name': 'Urdu'})

        self.assertTrue(result.success)
        vision_body = post.call_args_list[0].kwargs['json']['requests'][0]
        self.assertEqual(vision_body['features'], [{'type': 'DOCUMENT_TEXT_DETECTION'}])
        self.assertEqual(vision_body['imageContext']['languageHints'], ['ur', 'en'])
        prompt = post.call_args_list[1].kwargs['json']['messages'][1]['content']
        self.assertIn('PAGE LAYOUT', prompt)
        self.assertIn('[L1] Find HCF using prime factorization.', prompt)
        self.assertIn('[MARKS 34]', prompt)
        self.assertIn('"lines": [first_id, last_id]', prompt)
        question = result.questions[0]
        self.assertEqual(question['lines'], [1, 2])
        self.assertTrue(0 <= question['box']['y0'] < question['box']['y1'] <= 1)

    @override_settings(PAPER_LAYOUT_V2=False)
    def test_with_the_flag_off_the_flat_text_path_is_unchanged_apart_from_the_slimmer_request(self):
        sections = [{'title': 'Q1', 'question_type_guess': 'SHORT', 'marks_per_question': 1, 'shown_count': 1, 'counted_count': 1,
                     'questions': [{'question_text': 'Find HCF', 'question_type': 'SHORT', 'marks': 1}]}]
        result, post = self._run(sections)
        self.assertTrue(result.success)
        prompt = post.call_args_list[1].kwargs['json']['messages'][1]['content']
        self.assertIn('RAW OCR TEXT', prompt)
        self.assertNotIn('PAGE LAYOUT', prompt)
        self.assertNotIn('box', result.questions[0])

    @override_settings(PAPER_LAYOUT_V2=True)
    def test_a_layout_failure_falls_back_to_the_flat_text(self):
        sections = [{'title': 'Q1', 'question_type_guess': 'SHORT', 'marks_per_question': 1, 'shown_count': 1, 'counted_count': 1,
                     'questions': [{'question_text': 'Find HCF', 'question_type': 'SHORT', 'marks': 1}]}]
        with patch('examinations.paper_layout.build_layout', side_effect=RuntimeError('boom')):
            result, post = self._run(sections)
        self.assertTrue(result.success)
        self.assertIn('RAW OCR TEXT', post.call_args_list[1].kwargs['json']['messages'][1]['content'])


class PaperMarksNormalisationTests(SimpleTestCase):
    def test_zero_marks_from_the_model_mean_unknown_not_a_zero_mark_question(self):
        from examinations.paper_ocr_processor import _parse_structured_paper
        parsed = _parse_structured_paper(json.dumps({'header': {}, 'sections': [{
            'title': 'A', 'question_type_guess': 'SHORT', 'marks_per_question': 0, 'shown_count': 1, 'counted_count': 1,
            'questions': [{'question_text': 'q', 'question_type': 'SHORT', 'marks': 0}]}]}))
        self.assertEqual(parsed['questions'][0]['marks'], 1.0)
        self.assertEqual(parsed['sections'][0]['marks_per_question'], 1.0)
