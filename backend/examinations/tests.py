import base64
import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient
import importlib.util
from decimal import Decimal

from academics.models import Subject
from schools.models import Organization, School
from students.models import Class

from .models import ExamPaper, PaperFeedback, PaperQuestion, PaperUpload, Question
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


class BuildContinuationContextFromPriorPagesTests(TestCase):
    """tasks._build_continuation_context reads prior PaperUpload rows in the same
    group_id, scoped to the same school, to feed the prompt builder above."""

    @classmethod
    def setUpTestData(cls):
        cls.school = _make_school()
        cls.other_school = _make_school(suffix='-cc')
        cls.user = get_user_model().objects.create_superuser(
            username='continuation_admin',
            email='continuation_admin@test.com',
            password='test12345',
        )

    def _make_upload(self, school, group_id, page_number, ai_extracted_json=None):
        return PaperUpload.objects.create(
            school=school,
            uploaded_by=self.user,
            image_url='https://example.test/p.png',
            group_id=group_id,
            page_number=page_number,
            ai_extracted_json=ai_extracted_json,
            status=PaperUpload.Status.EXTRACTED,
        )

    def test_returns_none_for_page_one(self):
        import uuid
        page1 = self._make_upload(self.school, uuid.uuid4(), 1)
        self.assertIsNone(_build_continuation_context(page1))

    def test_returns_none_when_group_id_absent(self):
        page = PaperUpload.objects.create(
            school=self.school,
            uploaded_by=self.user,
            image_url='https://example.test/p.png',
            page_number=2,  # nonsensical without a group, but must still short-circuit
            status=PaperUpload.Status.EXTRACTED,
        )
        self.assertIsNone(_build_continuation_context(page))

    def test_summarizes_prior_page_for_page_two(self):
        import uuid
        group_id = uuid.uuid4()
        self._make_upload(self.school, group_id, 1, ai_extracted_json={
            'header': {'class_label': 'FIFTH', 'subject_label': 'SS'},
            'sections': [{'title': 'Section A', 'instruction': None, 'question_type_guess': 'MCQ'}],
            'questions': [{'question_text': 'Q1'}, {'question_text': 'Q2'}],
            'computed_total_marks': 10,
        })
        page2 = self._make_upload(self.school, group_id, 2)

        context = _build_continuation_context(page2)

        self.assertEqual(context['page_number'], 2)
        self.assertEqual(context['header']['class_label'], 'FIFTH')
        self.assertEqual(context['last_section']['title'], 'Section A')
        self.assertEqual(context['questions_so_far'], 2)
        self.assertEqual(context['marks_so_far'], 10)

    def test_does_not_leak_another_schools_group_id_collision(self):
        """A group_id that happens to also exist under another school must not
        contribute that school's extraction data as continuation context."""
        import uuid
        group_id = uuid.uuid4()
        self._make_upload(self.other_school, group_id, 1, ai_extracted_json={
            'header': {'class_label': 'OTHER SCHOOL CLASS'},
            'sections': [{'title': 'Other School Section', 'instruction': None, 'question_type_guess': 'MCQ'}],
            'questions': [{'question_text': 'Q1'}],
            'computed_total_marks': 5,
        })
        page2 = self._make_upload(self.school, group_id, 2)

        context = _build_continuation_context(page2)

        # This school has no prior page in this group_id -- must come back None,
        # not the other school's data.
        self.assertIsNone(context)


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