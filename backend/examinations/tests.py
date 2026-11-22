import base64
import json
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient
import importlib.util
from decimal import Decimal

from datetime import date

from academic_sessions.models import AcademicYear, StudentEnrollment
from academics.models import Subject
from schools.models import Organization, School
from students.models import Class, Student

from .models import Exam, ExamGroup, ExamPaper, ExamSubject, ExamType, PaperFeedback, PaperQuestion, PaperUpload, Question, StudentMark, Worksheet, WorksheetItem


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

    def _old_paper_question(self, paper_id, text, marks='4'):
        """An old-style (pre-block) paper row, as papers made before Phase 3 were stored."""
        question = Question.objects.create(
            school=self.school, subject=self.subject, question_text=text, question_type='SHORT',
            difficulty_level='MEDIUM', marks=Decimal(marks), answer_text='F = ma',
        )
        link = PaperQuestion.objects.create(exam_paper_id=paper_id, question=question, question_order=1)
        link.sync_question_snapshot()
        return question

    def test_autosave_with_the_old_question_list_is_refused(self):
        """Phase 7: only an app build from before Phase 6 still sends manual_questions; it gets 409 and
        nothing is saved."""
        draft = self._ensure_draft()
        response = self.client.post(
            f"/api/examinations/exam-papers/{draft['id']}/autosave/",
            {'manual_questions': [{'question_text': 'What is photosynthesis?', 'question_type': 'SHORT',
                                   'difficulty_level': 'MEDIUM', 'marks': '5', 'answer_text': 'x'}]},
            format='json', **self.school_header,
        )
        self.assertEqual(response.status_code, 409)
        self.assertIn('Update the app', response.json()['detail'])
        self.assertEqual(Question.objects.count(), 0)

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
        question = self._old_paper_question(draft['id'], 'Define evaporation.')

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

    def test_generate_docx_of_an_old_paper_uses_the_block_renderer(self):
        """Phase 7: an old paper's Word file comes from the converter + block Word renderer (nothing saved)."""
        import io
        from docx import Document

        draft = self._ensure_draft()
        self._old_paper_question(draft['id'], 'State Newton second law.')

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
        text = ' '.join(p.text for p in Document(io.BytesIO(response.content)).paragraphs)
        self.assertIn('State Newton second law.', text)
        self.assertFalse((ExamPaper.objects.get(id=draft['id']).document or {}).get('blocks'))

    def test_generate_pdf_answers_409_for_every_paper(self):
        """Phase 7: papers print on the device from print-html; an app from Phase 6 on prints on the phone
        when it gets this 409."""
        draft = self._ensure_draft()
        self._old_paper_question(draft['id'], 'State Newton second law.')

        response = self.client.get(
            f"/api/examinations/exam-papers/{draft['id']}/generate-pdf/",
            **self.school_header,
        )

        self.assertEqual(response.status_code, 409)
        self.assertIn('Update the app', response.json()['detail'])


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
            ai_extracted_json=extracted if extracted is not None else {'scan_mode': 'blocks', 'header': {}, 'blocks': [
                {'id': f'b{number}', 'type': 'section_heading', 'title': f'S{number}', 'data': {}}]},
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

    def test_returns_the_merged_blocks_once_every_declared_page_is_extracted(self):
        self._page(2)
        self._page(1)
        body = self._get(2).json()
        self.assertTrue(body['complete'])
        self.assertEqual([b['title'] for b in body['result']['blocks']], ['S1', 'S2'])

    def test_a_page_read_by_the_removed_old_scan_gives_no_result(self):
        """Phase 7: a capture started by the old questions scan before the deploy is not mixed into blocks."""
        self._page(1, extracted={'sections': [{'title': 'S1', 'questions': []}]})
        body = self._get(1).json()
        self.assertTrue(body['complete'])
        self.assertIsNone(body['result'])

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
            {'image': image, 'class_obj': self.class_obj.id, 'subject': self.subject.id, 'mode': 'blocks'},
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
            {'image': image, 'mode': 'blocks'},
            format='multipart',
            **self.school_header,
        )

        self.assertEqual(response.status_code, 201)
        upload = PaperUpload.objects.get(id=response.json()['id'])
        self.assertIsNone(upload.context_class_id)
        self.assertIsNone(upload.context_subject_id)
        self.assertEqual(upload.ai_extracted_json, {'scan_mode': 'blocks'})

    @patch('examinations.tasks.process_paper_upload_ocr')
    @patch('core.storage.SupabaseStorageService.upload_file')
    def test_upload_without_the_blocks_mode_is_refused(self, mock_upload_file, mock_ocr_task):
        """Phase 7: the old questions scan is gone; only an app from before Phase 6 sends no mode."""
        image = SimpleUploadedFile('paper.png', TINY_PNG_BYTES, content_type='image/png')
        response = self.client.post(
            '/api/examinations/paper-uploads/upload-image/', {'image': image}, format='multipart',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 409)
        self.assertIn('Update the app', response.json()['detail'])
        mock_upload_file.assert_not_called()
        self.assertFalse(PaperUpload.objects.exists())


class PaperUploadMultiPageGroupingTests(TestCase):
    """group_id/page_number let the frontend chain sequential page uploads into one
    multi-page capture session; group-status joins the pages of one group."""

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
        data = {'image': SimpleUploadedFile('paper.png', TINY_PNG_BYTES, content_type='image/png'), 'mode': 'blocks'}
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
                'mode': 'blocks',
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

    def test_confirm_without_a_paper_or_worksheet_is_refused(self):
        """Phase 7: the old one-shot confirm that created the paper itself was removed."""
        exam_paper_count_before = ExamPaper.objects.count()
        response = self.client.post(
            f'/api/examinations/paper-uploads/{self.upload.id}/confirm/',
            {'confirmed_data': {'questions': [{'question_text': 'Brand new question', 'question_type': 'SHORT', 'marks': 3}]},
             'paper_metadata': {'class_obj': self.class_obj.id, 'subject': self.subject.id}},
            format='json',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(ExamPaper.objects.count(), exam_paper_count_before)
        self.upload.refresh_from_db()
        self.assertEqual(self.upload.status, PaperUpload.Status.EXTRACTED)


class WorksheetLifecycleTests(TestCase):
    """ensure-draft, the old app's autosave (409), print/Word and duplicate for worksheets."""

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

    def _old_item(self, worksheet_id, text):
        """An old-style (pre-block) worksheet row, as worksheets made before Phase 6b were stored."""
        question = Question.objects.create(
            school=self.school, subject=self.subject, question_text=text, question_type='SHORT',
            difficulty_level='EASY', marks=Decimal('1'),
        )
        item = WorksheetItem.objects.create(worksheet_id=worksheet_id, question=question, item_order=1)
        item.sync_item_snapshot()
        return item

    def test_autosave_with_the_old_item_list_is_refused(self):
        """Phase 7: only an app build from before Phase 6 still sends manual_items."""
        draft = self._ensure_draft()
        response = self.client.post(
            f"/api/examinations/worksheets/{draft['id']}/autosave/",
            {'manual_items': [{'question_text': 'Simplify 4/8.', 'question_type': 'SHORT', 'item_order': 1}]},
            format='json',
            **self.school_header,
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(Question.objects.count(), 0)

    def test_duplicate_copies_items_as_new_draft(self):
        draft = self._ensure_draft()
        self._old_item(draft['id'], 'Q1')

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

    def test_old_worksheet_pdf_is_409_and_word_comes_from_the_block_renderer(self):
        import io
        from docx import Document

        draft = self._ensure_draft()
        self._old_item(draft['id'], 'Simplify 4/8.')

        pdf_response = self.client.get(
            f"/api/examinations/worksheets/{draft['id']}/generate-pdf/",
            **self.school_header,
        )
        self.assertEqual(pdf_response.status_code, 409)

        docx_response = self.client.get(
            f"/api/examinations/worksheets/{draft['id']}/generate-docx/",
            **self.school_header,
        )
        self.assertEqual(docx_response.status_code, 200)
        text = ' '.join(p.text for p in Document(io.BytesIO(docx_response.content)).paragraphs)
        self.assertIn('Simplify 4/8.', text)

    def test_worksheet_uploads_endpoint_is_gone(self):
        response = self.client.get('/api/examinations/worksheet-uploads/', **self.school_header)
        self.assertEqual(response.status_code, 404)


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

    def test_org_ids_are_masked_in_provider_errors(self):
        from examinations.paper_ocr_processor import _mask_provider_ids

        self.assertEqual(_mask_provider_ids('organization `org_01kffk1mhce8` x'), 'organization `org_***` x')


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
            ai_extracted_json={'scan_mode': 'blocks', 'header': {}, 'blocks': [
                {'id': f'b{number}', 'type': 'section_heading', 'title': f'S{number}', 'data': {}}]},
            **extra,
        )

    def test_group_status_returns_each_pages_photo_and_each_blocks_page(self):
        self._page(1)
        self._page(2)
        body = self.client.get(
            '/api/examinations/paper-uploads/group-status/',
            {'group_id': str(self.group_id), 'total_pages': 2}, **self.header,
        ).json()
        self.assertEqual([p['image_url'] for p in body['pages']],
                         ['https://example.test/p1.jpg', 'https://example.test/p2.jpg'])
        self.assertEqual([b['page_number'] for b in body['result']['blocks']], [1, 2])

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
                {'image': SimpleUploadedFile('x.png', b'definitely not a png', content_type='image/png'), 'mode': 'blocks'},
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
# Block scan language hints
# ---------------------------------------------------------------------------
class ScanLanguageHintTests(TestCase):
    """Vision language hints for the block scan (moved from the removed old scan in Phase 7)."""
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
        from examinations.paper_scan_blocks import vision_language_hints
        self.assertEqual(vision_language_hints(self._context(self.urdu)), ['ur', 'en'])
        self.assertEqual(vision_language_hints(self._context(self.islamiyat)), ['ur', 'en'])
        self.assertEqual(vision_language_hints(self._context(self.maths)), ['en'])
        self.assertEqual(vision_language_hints(None), ['en'])

    def test_a_curriculum_book_language_wins_over_the_subject_name(self):
        from examinations.paper_scan_blocks import vision_language_hints
        self.assertEqual(vision_language_hints(self._context(self.book_subject)), ['sd', 'en'])
