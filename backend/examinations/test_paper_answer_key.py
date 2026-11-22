"""Paper Builder v2 step 7b: the answer key of a block paper or worksheet (paper_blocks/answer_key.py) and its
endpoints (print-html?answer_key=1, generate-docx?answer_key=1)."""
import io
from decimal import Decimal

import pytest

from examinations.models import ExamPaper, PaperQuestion, Question
from examinations.paper_blocks.answer_key import key_questions, missing_count, render_key_docx, render_key_html
from examinations.paper_blocks.text_blocks import shuffled_right

PAPERS = '/api/examinations/exam-papers/'

HEADER = {'school_name': 'Alpha School', 'exam_title': 'Mid Term', 'subject': 'Science', 'class_name': 'Class 5'}


def _doc(blocks, direction='ltr'):
    return {'version': 1, 'direction': direction, 'header': HEADER, 'footer': 'Mid Term — Class: Class 5', 'blocks': blocks}


MCQ = {'id': 'm', 'type': 'mcq', 'title': 'Choose.', 'marks': 2, 'data': {'items': [
    {'text': 'Which is a star?', 'options': [{'text': 'Moon'}, {'text': 'Sun'}], 'answer': 'B'},
    {'text': 'No answer here', 'options': [{'text': 'a'}, {'text': 'b'}]},
]}}
TF = {'id': 't', 'type': 'true_false', 'title': 'True or false.', 'data': {'items': [
    {'text': 'Fish fly.', 'answer': 'FALSE'}, {'text': 'Ice is cold.', 'answer': 'TRUE'}]}}
FILL = {'id': 'f', 'type': 'fill_blank', 'title': 'Fill in.', 'data': {'items': [
    {'text': 'The ____ rises in the ____.', 'answers': ['sun', 'east']}]}}
SHORT = {'id': 's', 'type': 'short_answer', 'title': 'Answer.', 'data': {'items': [
    {'text': 'What is H2O?', 'answer': '<p>Water</p>'}, {'text': 'Why?'}]}}
MATCH = {'id': 'match-1', 'type': 'matching', 'title': 'Match.', 'data': {'items': [
    {'left': 'Cow', 'right': 'Milk'}, {'left': 'Hen', 'right': 'Egg'}, {'left': 'Bee', 'right': 'Honey'}]}}
COUNT = {'id': 'c', 'type': 'count_write', 'title': 'Count.', 'data': {'rows': [
    {'picture': 'star', 'count': 3}, {'picture': 'apple', 'count': 5}]}}
FIND = {'id': 'fc', 'type': 'find_colour', 'title': 'Colour A.', 'data': {'target': 'A', 'items': ['A', 'b', 'a', 'C', 'A']}}
GRID = {'id': 'g', 'type': 'writing_grid', 'title': 'Write.', 'data': {'rows': 2, 'cols': 2}}
HEADING = {'id': 'h', 'type': 'section_heading', 'title': 'Section B'}


def _lines(question):
    return [(line.label, line.text, line.missing) for line in question.lines]


class TestKeyQuestions:
    def test_text_blocks_give_their_saved_answers(self):
        mcq, tf, fill, short = key_questions(_doc([MCQ, TF, FILL, SHORT]))
        assert _lines(mcq) == [('i', 'B. Sun', False), ('ii', 'No answer saved', True)]
        assert _lines(tf) == [('i', 'False', False), ('ii', 'True', False)]
        assert _lines(fill) == [('i', 'The [sun] rises in the [east].', False)]
        assert _lines(short) == [('i', 'Water', False), ('ii', 'No answer saved', True)]

    def test_matching_uses_the_letters_column_b_is_printed_with(self):
        [match] = key_questions(_doc([MATCH]))
        printed = shuffled_right(MATCH)
        for line, item in zip(match.lines, MATCH['data']['items']):
            letter = chr(97 + printed.index(item['right']))
            assert line.text == f"{item['left']} → {letter}. {item['right']}"

    def test_activities_count_or_are_left_to_the_teacher(self):
        count, find, grid = key_questions(_doc([COUNT, FIND, GRID]))
        assert [line.text for line in count.lines] == ['Row 1: 3', 'Row 2: 5']
        assert [line.text for line in find.lines] == ['Colour 3 circle(s) with A']
        assert [line.text for line in grid.lines] == ['Marked by the teacher']

    def test_numbering_skips_headings_and_missing_answers_are_counted(self):
        entries = key_questions(_doc([MCQ, HEADING, SHORT]))
        assert entries[1] == 'Section B'
        assert [e.number for e in entries if not isinstance(e, str)] == [1, 2]
        assert missing_count(entries) == 2

    def test_fill_blank_with_more_answers_than_blanks_lists_the_rest(self):
        block = {'id': 'f2', 'type': 'fill_blank', 'title': 'Fill.', 'data': {'items': [{'text': 'Name two colours.', 'answers': ['red', 'blue']}]}}
        [fill] = key_questions(_doc([block]))
        assert fill.lines[0].text == 'Name two colours. [red], [blue]'


class TestKeyPage:
    def test_page_has_the_banner_answers_and_the_missing_note(self):
        html = render_key_html(_doc([MCQ, FILL, GRID]))
        assert 'Answer key — Not for students' in html
        assert '<b class="ans">sun</b>' in html and '<b>B.</b> Sun' in html
        assert '1 part(s) have no answer saved' in html
        assert 'Marked by the teacher' in html
        # The key is not the paper: no name/roll boxes, no office table, no answer lines.
        assert 'class="cand"' not in html and 'class="office"' not in html and 'class="lines"' not in html

    def test_teacher_text_is_cleaned(self):
        evil = {'id': 'x', 'type': 'short_answer', 'title': '<script>x()</script>', 'data': {'items': [
            {'text': 'q', 'answer': '<img src=x onerror=alert(1)>ok'}]}}
        html = render_key_html(_doc([evil]))
        assert '<script>x()' not in html and 'onerror' not in html

    def test_urdu_key(self):
        urdu = {'id': 'u', 'type': 'true_false', 'title': 'درست یا غلط', 'data': {'items': [{'text': 'پانی گیلا ہے', 'answer': 'TRUE'}]}}
        doc = _doc([urdu], direction='rtl')
        [entry] = key_questions(doc)
        assert entry.lines[0].label == 'الف' and entry.lines[0].text == 'درست'
        html = render_key_html(doc)
        assert 'dir="rtl"' in html and 'جوابات — طلبہ کے لیے نہیں' in html

    def test_word_key(self):
        from docx import Document
        data = render_key_docx(_doc([MCQ, FILL, MATCH]))
        text = '\n'.join(p.text for p in Document(io.BytesIO(data)).paragraphs)
        assert 'Answer key — Not for students' in text
        assert 'B. Sun' in text and 'The [sun] rises in the [east].' in text and 'Cow →' in text

    def test_urdu_word_key_embeds_the_font(self):
        urdu = {'id': 'u', 'type': 'true_false', 'title': 'درست یا غلط', 'data': {'items': [{'text': 'پانی', 'answer': 'FALSE'}]}}
        data = render_key_docx(_doc([urdu], direction='rtl'))
        assert data[:2] == b'PK' and b'odttf' in data


@pytest.fixture
def paper(api, seed_data):
    response = api.post(f'{PAPERS}ensure-draft/', {
        'class_obj': seed_data['classes'][0].id, 'subject': seed_data['subjects'][0].id,
        'paper_title': 'Key paper', 'duration_minutes': 60,
    }, seed_data['tokens']['admin'], seed_data['SID_A'])
    assert response.status_code == 201, response.content
    return ExamPaper.objects.get(id=response.json()['id'])


@pytest.mark.django_db
class TestKeyEndpoints:
    def _save(self, api, seed_data, paper, blocks):
        response = api.post(f'{PAPERS}{paper.id}/autosave/', {'document': {'blocks': blocks}},
                            seed_data['tokens']['admin'], seed_data['SID_A'])
        assert response.status_code == 200, response.content

    def test_print_html_and_word_give_the_key(self, api, seed_data, paper):
        self._save(api, seed_data, paper, [MCQ, FILL])
        token, sid = seed_data['tokens']['admin'], seed_data['SID_A']
        page = api.get(f'{PAPERS}{paper.id}/print-html/?answer_key=1', token, sid)
        assert page.status_code == 200 and 'Answer key' in page.content.decode()
        assert 'Content-Security-Policy' in page
        plain = api.get(f'{PAPERS}{paper.id}/print-html/', token, sid).content.decode()
        assert 'Answer key' not in plain
        word = api.get(f'{PAPERS}{paper.id}/generate-docx/?answer_key=1', token, sid)
        assert word.status_code == 200 and '_answer_key.docx' in word['Content-Disposition']

    def test_only_those_who_may_edit_the_paper_get_it(self, api, seed_data, paper):
        self._save(api, seed_data, paper, [MCQ])
        sid = seed_data['SID_A']
        staff = seed_data['tokens']['staff']
        assert api.get(f'{PAPERS}{paper.id}/print-html/?answer_key=1', staff, sid).status_code == 403
        assert api.get(f'{PAPERS}{paper.id}/generate-docx/?answer_key=1', staff, sid).status_code == 403
        principal = seed_data['tokens']['principal']
        assert api.get(f'{PAPERS}{paper.id}/print-html/?answer_key=1', principal, sid).status_code == 200

    def test_old_paper_key_is_converted(self, api, seed_data, paper):
        question = Question.objects.create(
            school_id=seed_data['SID_A'], subject=seed_data['subjects'][0], question_type='MCQ', question_text='2 + 2?',
            option_a='3', option_b='4', correct_answer='B', marks=Decimal('1'))
        PaperQuestion.objects.create(exam_paper=paper, question=question, question_order=1).sync_question_snapshot()
        html = api.get(f'{PAPERS}{paper.id}/print-html/?answer_key=1', seed_data['tokens']['admin'], seed_data['SID_A']).content.decode()
        assert '<b>B.</b> 4' in html
        paper.refresh_from_db()
        assert not (paper.document or {}).get('blocks')

    def test_worksheet_key(self, api, seed_data):
        sheets = '/api/examinations/worksheets/'
        token, sid = seed_data['tokens']['admin'], seed_data['SID_A']
        created = api.post(f'{sheets}ensure-draft/', {'class_obj': seed_data['classes'][0].id,
                                                      'subject': seed_data['subjects'][0].id, 'title': 'Sheet'}, token, sid)
        sheet_id = created.json()['id']
        assert api.post(f'{sheets}{sheet_id}/autosave/', {'document': {'blocks': [TF]}}, token, sid).status_code == 200
        page = api.get(f'{sheets}{sheet_id}/print-html/?answer_key=1', token, sid)
        assert page.status_code == 200 and 'False' in page.content.decode()
        assert api.get(f'{sheets}{sheet_id}/generate-docx/?answer_key=1', token, sid).status_code == 200


class TestOldMatchingQuestions:
    """Found while checking the keys on scratch: the question bank form saves matching as left/right items linked by
    index, which the old-paper converter did not read, so old matching questions printed (and keyed) empty."""

    def test_bank_form_pairs_become_text_pairs(self):
        from examinations.paper_document import matching_pairs
        type_data = {'left_items': ['Fish', 'Bird', 'Cow'], 'right_items': ['Water', 'Nest', 'Barn'],
                     'pairs': [{'left': 0, 'right': 0}, {'left': 1, 'right': 1}]}
        assert matching_pairs(type_data) == [
            {'left': 'Fish', 'right': 'Water'}, {'left': 'Bird', 'right': 'Nest'}, {'left': 'Cow', 'right': ''}]
        assert matching_pairs({'pairs': [{'left': 'a', 'right': 'b'}]}) == [{'left': 'a', 'right': 'b'}]
        assert matching_pairs({'left_items': ['x'], 'right_items': ['y'], 'pairs': [{'left': 0, 'right': 9}]}) == [
            {'left': 'x', 'right': ''}]


@pytest.mark.django_db
def test_old_matching_paper_prints_and_keys_its_pairs(api, seed_data, paper):
    question = Question.objects.create(
        school_id=seed_data['SID_A'], subject=seed_data['subjects'][0], question_type='MATCHING',
        question_text='Match the animals.', marks=Decimal('2'),
        type_data={'left_items': ['Fish', 'Bird'], 'right_items': ['Water', 'Nest'],
                   'pairs': [{'left': 0, 'right': 0}, {'left': 1, 'right': 1}]})
    PaperQuestion.objects.create(exam_paper=paper, question=question, question_order=1).sync_question_snapshot()
    token, sid = seed_data['tokens']['admin'], seed_data['SID_A']
    block = api.get(f'{PAPERS}{paper.id}/document/', token, sid).json()['document']['blocks'][0]
    assert block['data']['items'] == [{'left': 'Fish', 'right': 'Water'}, {'left': 'Bird', 'right': 'Nest'}]
    page = api.get(f'{PAPERS}{paper.id}/print-html/', token, sid).content.decode()
    assert 'Fish' in page and 'Nest' in page
    key = api.get(f'{PAPERS}{paper.id}/print-html/?answer_key=1', token, sid).content.decode()
    printed = shuffled_right(block)
    assert f'Fish → <b>{chr(97 + printed.index("Water"))}.</b> Water' in key
