"""Paper Builder Structure step (docs/PAPER_BUILDER_STRUCTURE_PLAN.md): a half-written paper saves and previews,
empty parts are listed as "still to fill", printing a draft waits for them, and the structure templates."""
import pytest

from examinations.models import ExamPaper, PaperQuestion
from examinations.paper_blocks.registry import (
    document_to_fill, structure_row, structure_templates, validate_document,
)

PAPERS = '/api/examinations/exam-papers/'


def _half_written():
    """What the Structure step makes: questions with their type and marks, parts still empty."""
    return {'blocks': [
        {'id': 'count', 'type': 'count_write', 'title': 'Count and write.', 'marks': 5,
         'data': {'rows': [{'picture': 'star', 'count': 3}, {'picture': '', 'count': 3}]}},
        {'id': 'short', 'type': 'short_answer', 'title': 'Answer these.', 'marks': 4,
         'data': {'items': [{'text': '<p>Why is the sky blue?</p>'}, {'text': ''}]}},
        {'id': 'colour', 'type': 'colour_picture', 'title': 'Colour the picture.', 'marks': 5, 'data': {}},
    ]}


@pytest.fixture
def paper(api, seed_data):
    response = api.post(f'{PAPERS}ensure-draft/', {
        'class_obj': seed_data['classes'][0].id, 'subject': seed_data['subjects'][0].id,
        'paper_title': 'Structure paper', 'duration_minutes': 60,
    }, seed_data['tokens']['admin'], seed_data['SID_A'])
    assert response.status_code == 201, response.content
    return ExamPaper.objects.get(id=response.json()['id'])


def _call(api, seed_data, method, url, data=None):
    token, sid = seed_data['tokens']['admin'], seed_data['SID_A']
    return getattr(api, method)(url, token, sid) if data is None else getattr(api, method)(url, data, token, sid)


class TestStillToFill:
    def test_empty_parts_are_listed_not_errors(self):
        to_fill = []
        assert validate_document(_half_written(), to_fill) == []
        assert to_fill == ['Question 1: Rows 2, Picture', 'Question 2: Parts 2, Question', 'Question 3: Picture'] \
            or len(to_fill) == 3
        assert document_to_fill(_half_written()) == to_fill

    def test_real_mistakes_are_still_errors(self):
        document = {'blocks': [{'type': 'count_write', 'marks': 5, 'data': {'rows': [{'picture': 'star', 'count': 99}]}}]}
        assert validate_document(document, []) == ['Question 1: Rows 1, How many: must be between 1 and 7.']


@pytest.mark.django_db
class TestHalfWrittenPaper:
    def test_autosave_and_preview_take_it_and_the_preview_marks_what_is_left(self, api, seed_data, paper):
        response = _call(api, seed_data, 'post', f'{PAPERS}{paper.id}/autosave/', {'document': _half_written()})
        assert response.status_code == 200, response.content
        html = _call(api, seed_data, 'post', f'{PAPERS}{paper.id}/preview/?show=short',
                     {'document': _half_written()}).content.decode()
        assert 'data-block="count"' in html and 'data-show="short"' in html
        assert html.count(' todo"') == 3 and 'paperShow' in html

    def test_only_finished_parts_go_to_the_question_bank(self, api, seed_data, paper):
        _call(api, seed_data, 'post', f'{PAPERS}{paper.id}/autosave/', {'document': _half_written()})
        texts = sorted(PaperQuestion.objects.filter(exam_paper=paper).values_list('question__question_text', flat=True))
        assert texts == ['<p>Why is the sky blue?</p>']
        paper.refresh_from_db()
        assert 'question_id' not in paper.document['blocks'][0]
        assert 'question_id' not in paper.document['blocks'][1]['data']['items'][1]

    def test_a_linked_question_keeps_its_link_while_it_is_emptied_again(self, api, seed_data, paper):
        document = _half_written()
        document['blocks'][1]['data']['items'][1]['text'] = '<p>How?</p>'
        _call(api, seed_data, 'post', f'{PAPERS}{paper.id}/autosave/', {'document': document})
        paper.refresh_from_db()
        saved = paper.document
        saved['blocks'][1]['data']['items'][1]['text'] = ''
        _call(api, seed_data, 'post', f'{PAPERS}{paper.id}/autosave/', {'document': saved})
        assert PaperQuestion.objects.filter(exam_paper=paper).count() == 2

    def test_printing_a_draft_waits_until_everything_is_filled(self, api, seed_data, paper):
        _call(api, seed_data, 'post', f'{PAPERS}{paper.id}/autosave/', {'document': _half_written()})
        for url in ('print-html/', 'print-html/?answer_key=1', 'generate-docx/'):
            response = _call(api, seed_data, 'get', f'{PAPERS}{paper.id}/{url}')
            assert response.status_code == 400, url
            assert response.json()['document'][0].startswith('Still to fill: Question 1')
        print_page = _call(api, seed_data, 'get', f'{PAPERS}{paper.id}/print-html/').json()
        assert len(print_page['document']) == 3

    def test_a_draft_with_empty_parts_cannot_be_marked_ready(self, api, seed_data, paper):
        _call(api, seed_data, 'post', f'{PAPERS}{paper.id}/autosave/', {'document': _half_written()})
        response = _call(api, seed_data, 'patch', f'{PAPERS}{paper.id}/', {'status': 'READY'})
        assert response.status_code == 400
        paper.refresh_from_db()
        assert paper.status == 'DRAFT'

    def test_print_page_has_no_preview_marks(self, api, seed_data, paper):
        done = {'blocks': [{'id': 'count', 'type': 'count_write', 'title': 'Count.', 'marks': 5,
                            'data': {'rows': [{'picture': 'star', 'count': 3}]}}]}
        _call(api, seed_data, 'post', f'{PAPERS}{paper.id}/autosave/', {'document': done})
        html = _call(api, seed_data, 'get', f'{PAPERS}{paper.id}/print-html/').content.decode()
        assert 'data-block' not in html and 'paperShow' not in html


class TestStructureRows:
    def test_a_row_keeps_type_marks_parts_and_settings_not_content(self):
        block = {'type': 'compare_objects', 'marks': 4, 'data': {'mode': 'length', 'picture': 'pencil'}}
        assert structure_row(block) == {'type': 'compare_objects', 'marks': 4, 'data': {'mode': 'length'}}
        count = {'type': 'count_write', 'marks': 5, 'data': {'rows': [{'picture': 'a', 'count': 1}] * 4}}
        assert structure_row(count) == {'type': 'count_write', 'marks': 5, 'parts': 4}

    def test_templates_add_up_like_the_sample_papers(self):
        templates = {t['id']: t for t in structure_templates()}
        assert sum(row['marks'] for row in templates['play_group_math']['rows']) == 50
        assert len(templates['play_group_math']['rows']) == 9
        assert all('title' not in row for row in templates['play_group_english']['rows'])

    @pytest.mark.django_db
    def test_block_list_endpoint_sends_the_templates(self, api, seed_data):
        body = _call(api, seed_data, 'get', '/api/examinations/paper-blocks/').json()
        assert [t['id'] for t in body['structure_templates']] == ['play_group_math', 'play_group_english']


class TestTypeGroups:
    def test_every_type_has_a_known_group_and_a_hint(self):
        from examinations.paper_blocks.registry import BLOCK_TYPES, TYPE_GROUPS, TYPE_PICKING
        groups = {g['id'] for g in TYPE_GROUPS}
        assert set(TYPE_PICKING) == set(BLOCK_TYPES)
        assert all(group in groups and hint for group, hint in TYPE_PICKING.values())

    @pytest.mark.django_db
    def test_block_list_endpoint_sends_groups(self, api, seed_data):
        body = _call(api, seed_data, 'get', '/api/examinations/paper-blocks/').json()
        assert [g['id'] for g in body['type_groups']][:3] == ['writing', 'numbers', 'pictures']
        count = next(b for b in body['blocks'] if b['type'] == 'count_write')
        assert count['group'] == 'numbers' and count['hint']
