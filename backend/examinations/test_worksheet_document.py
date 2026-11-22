"""Paper Builder v2, Phase 6b: a worksheet saved as blocks through the same code as papers
(paper_document.py), its header, old worksheets converted, the endpoints, and questions shared between
papers and worksheets."""
import io
from decimal import Decimal

import pytest

from examinations.models import (
    ExamPaper, PaperFeedback, PaperQuestion, PaperUpload, Question, Worksheet, WorksheetItem,
)

SHEETS = '/api/examinations/worksheets/'
PAPERS = '/api/examinations/exam-papers/'


def _document(with_marks=False):
    short = {'id': 'short', 'type': 'short_answer', 'title': 'Answer these.',
             'data': {'items': [{'text': 'Why?'}, {'text': 'How?'}]}}
    count = {'id': 'count', 'type': 'count_write', 'title': 'Count and write.',
             'data': {'rows': [{'picture': 'star', 'count': 3}]}}
    if with_marks:
        short['marks'], count['marks'] = 4, 2
    return {'blocks': [{'type': 'section_heading', 'title': 'Practice'}, count, short]}


def _ctx(seed_data, who='admin'):
    return seed_data['tokens'][who], seed_data['SID_A']


def _old_items(worksheet, rows, structure=None):
    """Old-style worksheet rows, as the removed manual_items autosave stored them before Phase 6b."""
    if structure is not None:
        worksheet.structure = structure
        worksheet.save(update_fields=['structure'])
    for order, (text, section_key, marks_override) in enumerate(rows, start=1):
        question = Question.objects.create(school_id=worksheet.school_id, subject_id=worksheet.subject_id,
                                           question_text=text, question_type='SHORT', marks=Decimal('1'))
        item = WorksheetItem.objects.create(worksheet=worksheet, question=question, item_order=order,
                                            section_key=section_key, marks_override=marks_override)
        item.sync_item_snapshot()


@pytest.fixture
def worksheet(api, seed_data):
    response = api.post(f'{SHEETS}ensure-draft/', {
        'class_obj': seed_data['classes'][0].id,
        'subject': seed_data['subjects'][0].id,
        'title': 'Counting practice',
    }, *_ctx(seed_data))
    assert response.status_code == 201, response.content
    return Worksheet.objects.get(id=response.json()['id'])


def _autosave(api, seed_data, worksheet, body, who='admin'):
    return api.post(f'{SHEETS}{worksheet.id}/autosave/', body, *_ctx(seed_data, who))


@pytest.mark.django_db
class TestSavingWorksheetBlocks:
    def test_blocks_are_saved_as_worksheet_items_without_marks(self, api, seed_data, worksheet):
        response = _autosave(api, seed_data, worksheet, {'document': _document()})
        assert response.status_code == 200, response.content
        assert response.json()['uses_blocks'] is True
        worksheet.refresh_from_db()
        rows = list(worksheet.items.select_related('question').order_by('item_order'))
        assert [r.section_key for r in rows] == ['count', 'short', 'short']
        assert [r.item_order for r in rows] == [1, 2, 3]
        # Ungraded practice: no marks on the sheet, 0 on the bank question (the column cannot be empty).
        assert [r.marks_override for r in rows] == [None, None, None]
        assert {r.question.marks for r in rows} == {Decimal('0')}
        assert rows[0].question.type_data['block']['data']['rows'][0] == {'picture': 'star', 'count': 3}
        assert rows[1].item_snapshot['question_text'] == 'Why?'
        assert all('marks' not in b for b in worksheet.document['blocks'])
        assert not PaperQuestion.objects.filter(question__in=[r.question for r in rows]).exists()

    def test_marks_are_kept_when_given(self, api, seed_data, worksheet):
        assert _autosave(api, seed_data, worksheet, {'document': _document(with_marks=True)}).status_code == 200
        rows = list(worksheet.items.order_by('item_order'))
        assert [r.marks_override for r in rows] == [Decimal('2'), Decimal('2'), Decimal('2')]

    def test_saving_again_updates_in_place_and_drops_removed_parts(self, api, seed_data, worksheet):
        _autosave(api, seed_data, worksheet, {'document': _document()})
        worksheet.refresh_from_db()
        document = worksheet.document
        first_ids = sorted(worksheet.items.values_list('question_id', flat=True))
        document['blocks'][2]['data']['items'] = document['blocks'][2]['data']['items'][:1]
        document['blocks'][2]['data']['items'][0]['text'] = 'Why not?'
        assert _autosave(api, seed_data, worksheet, {'document': document}).status_code == 200
        rows = list(worksheet.items.select_related('question').order_by('item_order'))
        assert len(rows) == 2
        assert rows[1].question.question_text == 'Why not?'
        assert {r.question_id for r in rows} <= set(first_ids)            # edited in place, not copied

    def test_details_and_document_cannot_be_mixed_with_old_items(self, api, seed_data, worksheet):
        response = _autosave(api, seed_data, worksheet, {'document': _document(), 'manual_items': []})
        assert response.status_code == 400

    def test_old_app_items_are_refused_on_a_block_worksheet(self, api, seed_data, worksheet):
        _autosave(api, seed_data, worksheet, {'document': _document()})
        response = _autosave(api, seed_data, worksheet, {'manual_items': []})
        assert response.status_code == 409
        assert worksheet.items.count() == 3

    def test_bad_document_is_refused(self, api, seed_data, worksheet):
        response = _autosave(api, seed_data, worksheet, {'document': {'blocks': [{'type': 'nope'}]}})
        assert response.status_code == 400 and 'document' in response.json()

    def test_teacher_without_the_class_cannot_save(self, api, seed_data, worksheet):
        response = _autosave(api, seed_data, worksheet, {'document': _document()}, who='teacher')
        assert response.status_code in (403, 404)
        worksheet.refresh_from_db()
        assert worksheet.document == {}


@pytest.mark.django_db
class TestWorksheetWithoutSubject:
    @pytest.fixture
    def no_subject(self, api, seed_data):
        response = api.post(f'{SHEETS}ensure-draft/', {'class_obj': seed_data['classes'][0].id, 'title': 'Revision'},
                            *_ctx(seed_data))
        assert response.status_code == 201, response.content
        return Worksheet.objects.get(id=response.json()['id'])

    def test_questions_need_a_subject(self, api, seed_data, no_subject):
        response = _autosave(api, seed_data, no_subject, {'document': _document()})
        assert response.status_code == 400
        assert 'subject' in response.json()['document'][0]
        no_subject.refresh_from_db()
        assert no_subject.document == {} and no_subject.items.count() == 0

    def test_a_subject_sent_with_the_blocks_counts(self, api, seed_data, no_subject):
        response = _autosave(api, seed_data, no_subject,
                             {'subject': seed_data['subjects'][0].id, 'document': _document()})
        assert response.status_code == 200, response.content
        assert no_subject.items.count() == 3

    def test_headings_alone_are_fine_and_the_footer_has_no_subject(self, api, seed_data, no_subject):
        heading = {'blocks': [{'type': 'section_heading', 'title': 'Practice'}]}
        assert _autosave(api, seed_data, no_subject, {'document': heading}).status_code == 200
        html = api.get(f'{SHEETS}{no_subject.id}/print-html/', *_ctx(seed_data)).content.decode()
        assert 'Revision' in html and '()' not in html


@pytest.mark.django_db
class TestWorksheetPages:
    def test_document_header_is_a_worksheet_header(self, api, seed_data, worksheet):
        body = api.get(f'{SHEETS}{worksheet.id}/document/', *_ctx(seed_data)).json()
        assert body['converted'] is False and body['document']['blocks'] == []
        header = body['header']
        assert header['exam_title'] == 'Counting practice'
        assert header['kind'] == 'worksheet'
        assert (header['marks_table'], header['show_time_marks'], header['time_label']) == (False, False, '')

    def test_print_page_has_no_office_table_or_time(self, api, seed_data, worksheet):
        _autosave(api, seed_data, worksheet, {'document': _document(with_marks=True)})
        html = api.get(f'{SHEETS}{worksheet.id}/print-html/', *_ctx(seed_data)).content.decode()
        assert 'Counting practice' in html and 'Subject:' in html
        assert 'For office Use Only' not in html and 'Time:' not in html and 'Total Marks' not in html
        assert '(2)' in html                                               # block marks still print

    def test_teacher_can_turn_the_total_on(self, api, seed_data, worksheet):
        document = {**_document(with_marks=True), 'header': {'show_time_marks': True}}
        _autosave(api, seed_data, worksheet, {'document': document})
        html = api.get(f'{SHEETS}{worksheet.id}/print-html/', *_ctx(seed_data)).content.decode()
        assert 'Total Marks: 6' in html and 'Time:' not in html

    def test_preview_of_unsaved_blocks(self, api, seed_data, worksheet):
        response = api.post(f'{SHEETS}{worksheet.id}/preview/?embed=1', {'document': _document()}, *_ctx(seed_data))
        assert response.status_code == 200
        html = response.content.decode()
        assert 'Count and write.' in html and 'paper-picture-library' not in html
        worksheet.refresh_from_db()
        assert worksheet.document == {}

    def test_pdf_is_refused_and_word_uses_the_block_renderer(self, api, seed_data, worksheet):
        from docx import Document
        _autosave(api, seed_data, worksheet, {'document': _document()})
        assert api.get(f'{SHEETS}{worksheet.id}/generate-pdf/', *_ctx(seed_data)).status_code == 409
        response = api.get(f'{SHEETS}{worksheet.id}/generate-docx/', *_ctx(seed_data))
        assert response.status_code == 200
        text = '\n'.join(p.text for p in Document(io.BytesIO(response.content)).paragraphs)
        assert 'Counting practice' in text and 'Subject:' in text and 'For office' not in text

    def test_duplicate_copies_the_blocks_and_editing_the_copy_leaves_the_original(self, api, seed_data, worksheet):
        _autosave(api, seed_data, worksheet, {'document': _document()})
        worksheet.refresh_from_db()
        clone_id = api.post(f'{SHEETS}{worksheet.id}/duplicate/', {}, *_ctx(seed_data)).json()['id']
        clone = Worksheet.objects.get(id=clone_id)
        assert clone.document == worksheet.document
        document = clone.document
        document['blocks'][2]['data']['items'][0]['text'] = 'Changed in the copy'
        assert _autosave(api, seed_data, clone, {'document': document}).status_code == 200
        original = worksheet.items.select_related('question').order_by('item_order')[1].question
        assert original.question_text == 'Why?'
        assert clone.items.select_related('question').order_by('item_order')[1].question_id != original.id


@pytest.mark.django_db
class TestOldWorksheets:
    def test_zero_marks_are_left_off(self, api, seed_data, worksheet):
        _old_items(worksheet, [('Say it.', '', Decimal('0'))])
        [block] = api.get(f'{SHEETS}{worksheet.id}/document/', *_ctx(seed_data)).json()['document']['blocks']
        assert 'marks' not in block

    def test_old_items_open_converted_and_are_not_rewritten(self, api, seed_data, worksheet):
        _old_items(worksheet, [('What is 2 + 2?', 's1', None), ('What is 3 + 3?', 's1', None)],
                   structure=[{'key': 's1', 'title': 'Section A', 'question_type': 'SHORT', 'instruction': 'Answer.'}])
        body = api.get(f'{SHEETS}{worksheet.id}/document/', *_ctx(seed_data)).json()
        assert body['converted'] is True
        [block] = body['document']['blocks']
        # The old PDF printed each item's marks (the bank default, 1), so the converted block keeps them.
        assert block['type'] == 'short_answer' and block['marks'] == 2.0
        assert [i['text'] for i in block['data']['items']] == ['What is 2 + 2?', 'What is 3 + 3?']
        worksheet.refresh_from_db()
        assert worksheet.document == {}
        # Since Phase 7 an old worksheet prints from print-html too (converted on the fly).
        page = api.get(f'{SHEETS}{worksheet.id}/print-html/', *_ctx(seed_data))
        assert page.status_code == 200 and 'What is 3 + 3?' in page.content.decode()

        old_ids = sorted(worksheet.items.values_list('question_id', flat=True))
        assert _autosave(api, seed_data, worksheet, {'document': body['document']}).status_code == 200
        assert sorted(worksheet.items.values_list('question_id', flat=True)) == old_ids


@pytest.mark.django_db
class TestQuestionsSharedWithPapers:
    @pytest.fixture
    def paper(self, api, seed_data):
        response = api.post(f'{PAPERS}ensure-draft/', {
            'class_obj': seed_data['classes'][0].id, 'subject': seed_data['subjects'][0].id,
            'paper_title': 'Block paper', 'duration_minutes': 60,
        }, *_ctx(seed_data))
        return ExamPaper.objects.get(id=response.json()['id'])

    def _paper_with_short(self, api, seed_data, paper, text='Why?'):
        document = {'blocks': [{'id': 'p', 'type': 'short_answer', 'title': 'Answer.', 'marks': 2,
                                'data': {'items': [{'text': text}]}}]}
        assert api.post(f'{PAPERS}{paper.id}/autosave/', {'document': document}, *_ctx(seed_data)).status_code == 200
        return paper.paper_questions.get().question

    def test_a_paper_question_picked_unchanged_is_reused(self, api, seed_data, paper, worksheet):
        question = self._paper_with_short(api, seed_data, paper)
        document = {'blocks': [{'id': 'w', 'type': 'short_answer', 'title': 'Answer.',
                                'data': {'items': [{'text': 'Why?', 'question_id': question.id}]}}]}
        assert _autosave(api, seed_data, worksheet, {'document': document}).status_code == 200
        assert worksheet.items.get().question_id == question.id

    def test_editing_it_on_the_worksheet_copies_it(self, api, seed_data, paper, worksheet):
        question = self._paper_with_short(api, seed_data, paper)
        document = {'blocks': [{'id': 'w', 'type': 'short_answer', 'title': 'Answer.',
                                'data': {'items': [{'text': 'Why?', 'question_id': question.id}]}}]}
        _autosave(api, seed_data, worksheet, {'document': document})
        worksheet.refresh_from_db()
        document = worksheet.document
        document['blocks'][0]['data']['items'][0]['text'] = 'Why, on the worksheet?'
        assert _autosave(api, seed_data, worksheet, {'document': document}).status_code == 200
        question.refresh_from_db()
        assert question.question_text == 'Why?'
        assert worksheet.items.get().question_id != question.id

    def test_editing_on_the_paper_a_question_a_worksheet_uses_copies_it(self, api, seed_data, paper, worksheet):
        question = self._paper_with_short(api, seed_data, paper)
        WorksheetItem.objects.create(worksheet=worksheet, question=question, item_order=1)
        paper.refresh_from_db()
        document = paper.document
        document['blocks'][0]['data']['items'][0]['text'] = 'Why, on the paper?'
        assert api.post(f'{PAPERS}{paper.id}/autosave/', {'document': document}, *_ctx(seed_data)).status_code == 200
        question.refresh_from_db()
        assert question.question_text == 'Why?'
        assert paper.paper_questions.get().question.question_text == 'Why, on the paper?'


@pytest.mark.django_db
class TestWorksheetScanConfirm:
    def test_confirm_with_a_worksheet_records_feedback_and_creates_no_paper(self, api, seed_data, worksheet):
        upload = PaperUpload.objects.create(
            school_id=seed_data['SID_A'], image_url='https://example.invalid/p.png',
            status=PaperUpload.Status.EXTRACTED, ai_extracted_json={'scan_mode': 'blocks', 'blocks': []},
        )
        papers_before = ExamPaper.objects.count()
        response = api.post(f'/api/examinations/paper-uploads/{upload.id}/confirm/', {
            'worksheet_id': worksheet.id, 'confirmed_data': {'blocks': [{'type': 'mcq'}, {'type': 'oral'}]},
        }, *_ctx(seed_data))
        assert response.status_code == 200, response.content
        assert response.json()['worksheet_id'] == worksheet.id
        upload.refresh_from_db()
        assert upload.status == PaperUpload.Status.CONFIRMED and upload.exam_paper_id is None
        assert ExamPaper.objects.count() == papers_before
        feedback = PaperFeedback.objects.get(paper_upload=upload)
        assert feedback.accuracy_metrics['total_questions'] == 2

    def test_another_schools_worksheet_is_not_found(self, api, seed_data, worksheet):
        upload = PaperUpload.objects.create(school_id=seed_data['SID_A'], image_url='https://example.invalid/p.png',
                                            status=PaperUpload.Status.EXTRACTED)
        response = api.post(f'/api/examinations/paper-uploads/{upload.id}/confirm/', {
            'worksheet_id': worksheet.id + 999, 'confirmed_data': {'blocks': []},
        }, *_ctx(seed_data))
        assert response.status_code in (400, 404)
        assert ExamPaper.objects.count() == 0 or not ExamPaper.objects.filter(paper_title='Untitled Paper').exists()
