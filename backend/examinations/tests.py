from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient
import importlib.util

from academics.models import Subject
from schools.models import Organization, School
from students.models import Class

from .models import ExamPaper, PaperQuestion, Question


def _make_school():
    org = Organization.objects.create(name='Exam Test Org', slug='exam-test-org')
    return School.objects.create(
        organization=org,
        name='Exam Test School',
        subdomain='exam-test-school',
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

        paper_question = PaperQuestion.objects.get(exam_paper_id=draft['id'])
        self.assertEqual(paper_question.question.question_text, 'What is photosynthesis?')
        self.assertEqual(paper_question.question_snapshot['question_text'], 'What is photosynthesis?')
        self.assertEqual(paper_question.question_snapshot['effective_marks'], '5.00')

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