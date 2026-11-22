"""Paper Builder v2, Phase 3a: a paper saved as blocks, kept in step with the question bank, old papers
converted to blocks, and the preview / print / Word endpoints."""
import io
from decimal import Decimal

import pytest
from django.test import override_settings

from examinations.models import ExamPaper, PaperQuestion, Question, QuestionType
from examinations.paper_blocks.registry import BLOCK_TYPES
from examinations.paper_document import convert_old_paper

PAPERS = '/api/examinations/exam-papers/'


def _mcq_item(text, answer='A'):
    return {'text': f'<p>{text}</p>', 'answer': answer,
            'options': [{'text': 'one'}, {'text': 'two'}, {'text': 'three'}, {'text': 'four'}]}


def _document():
    return {
        'header': {'marks_table': True, 'show_time_marks': True, 'school_name': 'ignored, comes from the paper'},
        'blocks': [
            {'type': 'section_heading', 'title': 'Section A', 'marks': 99},
            {'id': 'count', 'type': 'count_write', 'title': 'Count and write.', 'marks': 5,
             'data': {'rows': [{'picture': 'star', 'count': 3}, {'picture': 'apple', 'count': 2}]}},
            {'id': 'choose', 'type': 'mcq', 'title': 'Choose the correct option.', 'marks': 4,
             'data': {'items': [_mcq_item('Which is a fruit?'), _mcq_item('Which is a colour?', 'B')]}},
            {'id': 'fill', 'type': 'fill_blank', 'title': 'Fill in the blanks.', 'marks': 2,
             'data': {'items': [{'text': 'The sun is a ___.', 'answers': ['star']}]}},
            {'id': 'pairs', 'type': 'matching', 'title': 'Match the columns.', 'marks': 3,
             'data': {'items': [{'left': 'Cat', 'right': 'Kitten'}, {'left': 'Dog', 'right': 'Puppy'}]}},
            {'id': 'short', 'type': 'short_answer', 'title': 'Answer any two.', 'marks': 6,
             'data': {'attempt': 2, 'items': [{'text': 'Why?'}, {'text': 'How?'}, {'text': 'When?'}]}},
        ],
    }


@pytest.fixture
def paper(api, seed_data):
    response = api.post(f'{PAPERS}ensure-draft/', {
        'class_obj': seed_data['classes'][0].id,
        'subject': seed_data['subjects'][0].id,
        'paper_title': 'Block paper',
        'duration_minutes': 120,
    }, seed_data['tokens']['admin'], seed_data['SID_A'])
    assert response.status_code == 201, response.content
    return ExamPaper.objects.get(id=response.json()['id'])


def _autosave(api, seed_data, paper, document, who='admin'):
    return api.post(f'{PAPERS}{paper.id}/autosave/', {'document': document}, seed_data['tokens'][who], seed_data['SID_A'])


@pytest.mark.django_db
class TestBlockTypesEndpoint:
    def test_lists_every_block_with_its_fields(self, api, seed_data):
        body = api.get('/api/examinations/paper-blocks/', seed_data['tokens']['teacher'], seed_data['SID_A']).json()
        assert {b['type'] for b in body['blocks']} == set(BLOCK_TYPES)
        mcq = next(b for b in body['blocks'] if b['type'] == 'mcq')
        assert mcq['kind'] == 'text'
        items = next(f for f in mcq['fields'] if f['name'] == 'items')
        assert {f['name'] for f in items['fields']} >= {'text', 'options', 'answer'}
        assert {m['kind'] for m in body['makers']} >= {'clock', 'fraction'}


@pytest.mark.django_db
class TestSavingBlocks:
    def test_old_app_question_list_is_refused_on_a_block_paper(self, api, seed_data, paper):
        assert _autosave(api, seed_data, paper, _document()).status_code == 200
        kept = paper.paper_questions.count()
        response = api.post(f'{PAPERS}{paper.id}/autosave/', {'manual_questions': []},
                            seed_data['tokens']['admin'], seed_data['SID_A'])
        assert response.status_code == 409
        assert paper.paper_questions.count() == kept

    def test_the_old_question_list_is_refused_even_on_an_old_paper(self, api, seed_data, paper):
        """Phase 7: only an app from before Phase 6 sends manual_questions; every paper answers 409."""
        response = api.post(f'{PAPERS}{paper.id}/autosave/', {'manual_questions': []},
                            seed_data['tokens']['admin'], seed_data['SID_A'])
        assert response.status_code == 409

    def test_blocks_are_saved_and_kept_in_the_question_bank(self, api, seed_data, paper):
        response = _autosave(api, seed_data, paper, _document())
        assert response.status_code == 200, response.content
        body = response.json()
        assert body['uses_blocks'] is True
        paper.refresh_from_db()
        assert paper.total_marks == Decimal('20.00')                 # headings carry no marks
        blocks = paper.document['blocks']
        assert blocks[0] == {'id': blocks[0]['id'], 'type': 'section_heading', 'title': 'Section A'}
        assert 'school_name' not in paper.document['header']

        rows = list(paper.paper_questions.select_related('question').order_by('question_order'))
        # count (1) + mcq parts (2) + fill part (1) + matching (1) + short parts (3)
        assert [r.section_key for r in rows] == ['count', 'choose', 'choose', 'fill', 'pairs', 'short', 'short', 'short']
        assert [r.question.question_type for r in rows] == [
            QuestionType.ACTIVITY, 'MCQ', 'MCQ', 'FILL_BLANK', 'MATCHING', 'SHORT', 'SHORT', 'SHORT']
        assert [r.marks_override for r in rows] == [Decimal(m) for m in ('5', '2', '2', '2', '3', '3', '3', '3')]
        activity, mcq_b = rows[0].question, rows[2].question
        assert activity.type_data['block']['data']['rows'][0] == {'picture': 'star', 'count': 3}
        assert (mcq_b.option_b, mcq_b.correct_answer) == ('two', 'B')
        assert rows[3].question.type_data['accepted_answers'] == ['star']
        # The question bank's shape (two lists linked by index), so the bank form opens it.
        matching = rows[4].question.type_data
        assert (matching['left_items'][1], matching['right_items'][1], matching['pairs'][1]) == ('Dog', 'Puppy', {'left': 1, 'right': 1})
        assert all(r.question.school_id == seed_data['SID_A'] for r in rows)
        assert all(r.question_snapshot for r in rows)
        # Every block and part now carries its bank question.
        assert blocks[1]['question_id'] == activity.id
        assert blocks[2]['data']['items'][1]['question_id'] == mcq_b.id

    def test_saving_again_updates_the_same_questions(self, api, seed_data, paper):
        saved = _autosave(api, seed_data, paper, _document()).json()['document']
        questions_before = Question.objects.count()
        saved['blocks'][2]['data']['items'][0]['text'] = '<p>Which is a vegetable?</p>'
        del saved['blocks'][5]['data']['items'][2]          # drop one short-answer part
        saved['blocks'][5]['data']['attempt'] = 2
        assert _autosave(api, seed_data, paper, saved).status_code == 200
        assert Question.objects.count() == questions_before   # nothing new, nothing deleted from the bank
        first = paper.paper_questions.get(section_key='choose', question_order=2).question
        assert first.question_text == '<p>Which is a vegetable?</p>'
        assert paper.paper_questions.filter(section_key='short').count() == 2

    def test_a_question_shared_with_another_paper_is_copied_not_changed(self, api, seed_data, paper):
        saved = _autosave(api, seed_data, paper, _document()).json()['document']
        shared_id = saved['blocks'][2]['data']['items'][0]['question_id']
        other = ExamPaper.objects.create(
            school_id=seed_data['SID_A'], class_obj=paper.class_obj, subject=paper.subject, paper_title='Other')
        PaperQuestion.objects.create(exam_paper=other, question_id=shared_id, question_order=1)

        saved['blocks'][2]['data']['items'][0]['text'] = '<p>Changed here only</p>'
        new_doc = _autosave(api, seed_data, paper, saved).json()['document']
        new_id = new_doc['blocks'][2]['data']['items'][0]['question_id']
        assert new_id != shared_id
        assert Question.objects.get(id=shared_id).question_text == '<p>Which is a fruit?</p>'
        assert Question.objects.get(id=new_id).question_text == '<p>Changed here only</p>'
        assert other.paper_questions.get().question_id == shared_id

    def test_bad_documents_are_refused_and_nothing_changes(self, api, seed_data, paper):
        bad = _document()
        bad['blocks'][1]['data']['rows'][0]['count'] = 50
        bad['blocks'][2]['data']['items'][0]['answer'] = 'Z'
        bad['blocks'].append({'type': 'hologram', 'data': {}})
        response = _autosave(api, seed_data, paper, bad)
        assert response.status_code == 400
        problems = response.json()['document']
        assert 'Question 1: Rows 1, How many: must be between 1 and 7.' in problems
        assert 'Question 2: Questions 1, Correct option: must be one of A, B, C, D, E, F.' in problems
        assert any('hologram' in p for p in problems)
        paper.refresh_from_db()
        assert paper.document == {} and paper.paper_questions.count() == 0

    def test_both_document_and_manual_questions_is_refused(self, api, seed_data, paper):
        response = api.post(f'{PAPERS}{paper.id}/autosave/', {'document': _document(), 'manual_questions': []},
                            seed_data['tokens']['admin'], seed_data['SID_A'])
        assert response.status_code == 400

    @override_settings(SUPABASE_URL='https://files.example.test')
    def test_picture_addresses_must_be_our_own_storage(self, api, seed_data, paper):
        document = {'blocks': [{'type': 'colour_picture', 'title': 'Colour', 'marks': 2,
                                'data': {'picture': {'url': 'https://evil.example.com/x.png'}}}]}
        assert _autosave(api, seed_data, paper, document).status_code == 400
        document['blocks'][0]['data']['picture'] = {'url': 'https://files.example.test/storage/v1/object/a.png'}
        assert _autosave(api, seed_data, paper, document).status_code == 200

    def test_a_new_empty_paper_is_not_called_old(self, api, seed_data, paper):
        body = api.get(f'{PAPERS}{paper.id}/document/', seed_data['tokens']['admin'], seed_data['SID_A']).json()
        assert body['converted'] is False and body['document']['blocks'] == []

    def test_another_school_cannot_read_or_save_the_paper(self, api, seed_data, paper):
        token, sid = seed_data['tokens']['admin_b'], seed_data['SID_B']
        assert api.get(f'{PAPERS}{paper.id}/document/', token, sid).status_code == 404
        assert api.post(f'{PAPERS}{paper.id}/autosave/', {'document': _document()}, token, sid).status_code == 404


@pytest.mark.django_db
class TestOldPapers:
    def _old_paper(self, seed_data):
        paper = ExamPaper.objects.create(
            school_id=seed_data['SID_A'], class_obj=seed_data['classes'][0], subject=seed_data['subjects'][0],
            paper_title='Old paper', structure=[
                {'key': 's1', 'title': 'Question # 1', 'question_type': 'MCQ', 'slots_shown': 3, 'slots_counted': 2,
                 'marks_per_question': 1},
                {'key': 'd1', 'type': 'divider', 'title': 'Section B'},
                {'key': 's2', 'title': 'Question # 2', 'question_type': 'SHORT', 'instruction': 'Answer briefly.',
                 'slots_shown': 1, 'slots_counted': 1, 'marks_per_question': 4},
            ])

        def add(order, key, **fields):
            question = Question.objects.create(school_id=seed_data['SID_A'], subject=paper.subject, **fields)
            row = PaperQuestion.objects.create(exam_paper=paper, question=question, question_order=order,
                                               section_key=key, marks_override=fields.get('marks', 1))
            row.sync_question_snapshot()
            return question

        add(1, 's1', question_type='MCQ', question_text='2 + 2 = ?', option_a='3', option_b='4', option_c='5',
            option_d='6', correct_answer='B', marks=1)
        add(2, 's1', question_type='MCQ', question_text='Capital of Pakistan?', option_a='Lahore',
            option_b='Islamabad', correct_answer='B', marks=1)
        add(3, 's1', question_type='TRUE_FALSE', question_text='Fish can fly.', correct_answer='false', marks=1)
        add(4, 's2', question_type='SHORT', question_text='What is rain?', answer_text='Water falling', marks=4)
        add(5, '', question_type='MATCHING', question_text='Match', marks=2,
            type_data={'pairs': [{'left': 'A', 'right': 'a'}, {'left': 'B', 'right': 'b'}]})
        return paper

    def test_old_paper_opens_as_blocks_without_being_changed(self, api, seed_data):
        paper = self._old_paper(seed_data)
        body = api.get(f'{PAPERS}{paper.id}/document/', seed_data['tokens']['admin'], seed_data['SID_A']).json()
        assert body['converted'] is True
        assert body['header']['class_name'] and body['header']['subject'] == paper.subject.name
        blocks = body['document']['blocks']
        assert [b['type'] for b in blocks] == ['mcq', 'true_false', 'section_heading', 'short_answer', 'matching']
        mcq = blocks[0]
        assert mcq['title'] == 'Choose the correct option.'           # the type's default instruction
        assert [i['answer'] for i in mcq['data']['items']] == ['B', 'B']
        assert [o['text'] for o in mcq['data']['items'][1]['options']] == ['Lahore', 'Islamabad']
        assert blocks[1]['data']['items'][0]['answer'] == 'FALSE'
        assert blocks[3]['title'] == 'Answer briefly.' and blocks[3]['marks'] == 4.0
        assert blocks[3]['data']['items'][0]['answer'] == 'Water falling'
        assert blocks[4]['data']['items'] == [{'left': 'A', 'right': 'a'}, {'left': 'B', 'right': 'b'}]
        paper.refresh_from_db()
        assert paper.document == {}                                   # nothing saved by opening it

    def test_section_attempt_and_marks_carry_over(self, seed_data):
        paper = self._old_paper(seed_data)
        # Make section 1 three MCQs with "attempt any 2" at 1 mark each.
        true_false = paper.paper_questions.get(question__question_type='TRUE_FALSE').question
        true_false.question_type, true_false.option_a, true_false.option_b = 'MCQ', 'yes', 'no'
        true_false.save()
        for row in paper.paper_questions.all():
            row.sync_question_snapshot()
        mcq = convert_old_paper(paper)['blocks'][0]
        assert mcq['type'] == 'mcq' and len(mcq['data']['items']) == 3
        assert mcq['marks'] == 2.0 and mcq['data']['attempt'] == 2

    def test_saving_a_converted_paper_reuses_its_questions(self, api, seed_data):
        paper = self._old_paper(seed_data)
        before = Question.objects.count()
        document = api.get(f'{PAPERS}{paper.id}/document/', seed_data['tokens']['admin'], seed_data['SID_A']).json()['document']
        assert _autosave(api, seed_data, paper, document).status_code == 200
        assert Question.objects.count() == before
        paper.refresh_from_db()
        assert paper.paper_questions.count() == 5
        again = api.get(f'{PAPERS}{paper.id}/document/', seed_data['tokens']['admin'], seed_data['SID_A']).json()
        assert again['converted'] is False


@pytest.mark.django_db
class TestPrintingBlocks:
    def test_preview_shows_an_unsaved_document_with_the_papers_header(self, api, seed_data, paper):
        document = _document()
        document['blocks'][2]['data']['items'][0]['text'] = '<p>Safe?<script>alert(1)</script><img src=x onerror=1></p>'
        response = api.post(f'{PAPERS}{paper.id}/preview/', {'document': document},
                            seed_data['tokens']['admin'], seed_data['SID_A'])
        assert response.status_code == 200
        assert response['Content-Type'].startswith('text/html')
        assert "default-src 'none'" in response['Content-Security-Policy']
        html = response.content.decode()
        assert seed_data['school_a'].name.replace('&', '&amp;') in html
        assert 'Time: 2 hours' in html and 'Total Marks: 20' in html
        assert 'Section A' in html and 'Q5: Answer any two.' in html and 'Attempt any 2.' in html
        assert '<script>alert' not in html and 'onerror' not in html
        # Library pictures are linked, not embedded, so the page stays small.
        assert '/api/examinations/paper-picture-library/star/' in html
        assert 'data:image/svg+xml;base64' not in html
        paper.refresh_from_db()
        assert paper.document == {}

    def test_preview_with_embed_puts_the_library_pictures_inside_the_page(self, api, seed_data, paper):
        # The editors ask for this: their sandboxed preview frame cannot load pictures from a local API address.
        token, sid = seed_data['tokens']['admin'], seed_data['SID_A']
        linked = api.post(f'{PAPERS}{paper.id}/preview/', {'document': _document()}, token, sid).content.decode()
        embedded = api.post(f'{PAPERS}{paper.id}/preview/?embed=1', {'document': _document()}, token, sid).content.decode()
        assert 'paper-picture-library/' not in embedded and 'data:image/' in embedded
        # Only the two pictures the paper uses are added, so the page stays small.
        assert len(embedded) - len(linked) < 20_000

    def test_preview_of_a_bad_document_is_refused(self, api, seed_data, paper):
        response = api.post(f'{PAPERS}{paper.id}/preview/', {'document': {'blocks': 'no'}},
                            seed_data['tokens']['admin'], seed_data['SID_A'])
        assert response.status_code == 400

    def test_print_word_and_pdf_for_a_block_paper(self, api, seed_data, paper):
        from docx import Document
        _autosave(api, seed_data, paper, _document())
        token, sid = seed_data['tokens']['admin'], seed_data['SID_A']
        html = api.get(f'{PAPERS}{paper.id}/print-html/', token, sid).content.decode()
        assert 'Q1: Count and write.' in html and 'For office Use Only' in html
        # The phone prints with the library pictures inside the page.
        embedded = api.get(f'{PAPERS}{paper.id}/print-html/?embed=1', token, sid).content.decode()
        assert 'paper-picture-library/' not in embedded and 'data:image/' in embedded

        response = api.get(f'{PAPERS}{paper.id}/generate-docx/', token, sid)
        assert response.status_code == 200
        word = Document(io.BytesIO(response.content))
        text = '\n'.join(p.text for p in word.paragraphs)
        assert 'Q2: Choose the correct option.' in text and 'Which is a fruit?' in text
        assert 'Section A' in text

        response = api.get(f'{PAPERS}{paper.id}/generate-pdf/', token, sid)
        assert response.status_code == 409
        assert 'Update the app' in response.json()['detail'] and 'website' in response.json()['detail']

    def test_generate_pdf_is_gone_for_old_papers_too(self, api, seed_data, paper):
        """Phase 7: every paper prints on the device from print-html; the phone app prints there on this 409."""
        response = api.get(f'{PAPERS}{paper.id}/generate-pdf/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert response.status_code == 409


@pytest.mark.django_db
class TestBankQuestions:
    def _bank_question(self, seed_data, **extra):
        return Question.objects.create(
            school_id=seed_data['SID_A'], subject=seed_data['subjects'][0], question_type='SHORT',
            question_text='<p>Define energy.</p>', answer_text='Ability to do work', marks=2, **extra)

    def _doc(self, question, text=None):
        return {'blocks': [{'id': 'b1', 'type': 'short_answer', 'title': 'Answer.', 'marks': 5, 'data': {'items': [
            {'question_id': question.id, 'text': text or question.question_text, 'answer': question.answer_text}]}}]}

    def test_an_unchanged_bank_question_is_reused_not_copied(self, api, seed_data, paper):
        question = self._bank_question(seed_data)
        before = Question.objects.count()
        saved = _autosave(api, seed_data, paper, self._doc(question)).json()['document']
        assert Question.objects.count() == before
        assert saved['blocks'][0]['data']['items'][0]['question_id'] == question.id
        row = paper.paper_questions.get()
        assert row.question_id == question.id and row.marks_override == Decimal('5.00')
        question.refresh_from_db()
        assert question.marks == Decimal('2.00')                     # the bank question's own mark is untouched

    def test_an_edited_bank_question_is_copied(self, api, seed_data, paper):
        question = self._bank_question(seed_data)
        saved = _autosave(api, seed_data, paper, self._doc(question, '<p>Define power.</p>')).json()['document']
        new_id = saved['blocks'][0]['data']['items'][0]['question_id']
        assert new_id != question.id
        question.refresh_from_db()
        assert question.question_text == '<p>Define energy.</p>'

    def _activity_from_bank(self, question, marks):
        # What the editors make from a picked bank activity (blockDocument.bankQuestionsToBlocks).
        saved = question.type_data['block']
        return {'id': 'again', 'type': saved['type'], 'title': saved['title'], 'marks': marks,
                'question_id': question.id, 'data': saved['data']}

    def test_an_activity_goes_paper_to_bank_to_new_paper_with_the_same_drawing(self, api, seed_data, paper):
        first = _autosave(api, seed_data, paper, _document()).json()['document']
        activity = Question.objects.get(id=first['blocks'][1]['question_id'])
        other = ExamPaper.objects.create(
            school_id=seed_data['SID_A'], class_obj=paper.class_obj, subject=paper.subject, paper_title='Second')
        before = Question.objects.count()
        # A different mark on the new paper is not an edit: the bank question is reused, not copied.
        response = _autosave(api, seed_data, other, {'blocks': [self._activity_from_bank(activity, 8)]})
        assert response.status_code == 200, response.content
        block = response.json()['document']['blocks'][0]
        assert Question.objects.count() == before
        assert block['question_id'] == activity.id
        assert block['data']['rows'] == [{'picture': 'star', 'count': 3}, {'picture': 'apple', 'count': 2}]
        assert other.paper_questions.get().marks_override == Decimal('8.00')
        activity.refresh_from_db()
        assert activity.type_data['block']['marks'] == 5             # the first paper's block is untouched

    def test_the_same_bank_question_twice_in_one_paper_saves_a_copy(self, api, seed_data, paper):
        question = self._bank_question(seed_data)
        document = self._doc(question)
        document['blocks'].append({**document['blocks'][0], 'id': 'b2'})
        response = _autosave(api, seed_data, paper, document)
        assert response.status_code == 200, response.content
        ids = [b['data']['items'][0]['question_id'] for b in response.json()['document']['blocks']]
        assert ids[0] == question.id and ids[1] != question.id
        assert paper.paper_questions.count() == 2
        assert Question.objects.get(id=ids[1]).question_text == question.question_text

    def test_another_schools_question_is_never_linked(self, api, seed_data, paper):
        foreign = Question.objects.create(
            school_id=seed_data['SID_B'], subject=seed_data['subjects'][0], question_type='SHORT', question_text='x')
        saved = _autosave(api, seed_data, paper, self._doc(foreign)).json()['document']
        assert saved['blocks'][0]['data']['items'][0]['question_id'] != foreign.id
        assert paper.paper_questions.get().question.school_id == seed_data['SID_A']


@pytest.mark.django_db
def test_bloom_level_is_kept_on_the_bank_question_and_comes_back(api, seed_data, paper):
    document = {'blocks': [{'id': 'b', 'type': 'short_answer', 'title': 'Answer.', 'marks': 4, 'data': {'items': [
        {'key': 'k1', 'text': 'Define force.', 'bloom_level': 'remember'},
        {'key': 'k2', 'text': 'Why do ships float?', 'bloom_level': 'analyze'},
        {'key': 'k3', 'text': 'No level'},
    ]}}]}
    body = _autosave(api, seed_data, paper, document).json()
    assert [pq['bloom_level'] for pq in sorted(body['paper_questions'], key=lambda r: r['question_order'])] == [
        'remember', 'analyze', '']
    bad = {'blocks': [{'type': 'short_answer', 'title': 'x', 'marks': 1, 'data': {'items': [{'text': 'x', 'bloom_level': 'guess'}]}}]}
    assert _autosave(api, seed_data, paper, bad).status_code == 400
    # An old-style copy of the same questions converts back with its levels.
    paper.document = {}
    paper.save(update_fields=['document'])
    items = convert_old_paper(paper)['blocks'][0]['data']['items']
    assert [i.get('bloom_level') for i in items] == ['remember', 'analyze', None]


EDITOR_EQUATION = ('<p>Solve <span data-latex="x^2+1 &lt; 5" data-evaluate="no" data-display="no" '
                   'data-type="inlineMath">$x^2+1 &lt; 5$</span> now</p>')


class TestEditorEquations:
    """The rich editor saves an equation as span[data-type=inlineMath] with the LaTeX in data-latex.
    Found 2026-11-16: block papers printed it as "$x^2+1$" on the page and in Word."""

    def test_sanitizers_keep_the_latex_without_dollars(self):
        from examinations.html_sanitize import sanitize_for_docx, sanitize_for_html
        assert sanitize_for_html(EDITOR_EQUATION) == '<p>Solve <span class="math">x^2+1 &lt; 5</span> now</p>'
        assert sanitize_for_docx(EDITOR_EQUATION) == 'Solve x^2+1 < 5 now'

    def test_attributes_cannot_inject_markup(self):
        from examinations.html_sanitize import sanitize_for_html
        evil = '<span data-type="inlineMath" data-latex="&lt;/span&gt;&lt;script&gt;x()&lt;/script&gt;">$x$</span>'
        assert '<script>' not in sanitize_for_html(evil)

    def test_page_draws_it_and_word_shows_it_plainly(self):
        from docx import Document
        from examinations.paper_blocks.docx_renderer import render_docx
        from examinations.paper_blocks.html_renderer import render_html
        from examinations.paper_blocks.pictures import PictureStore
        document = {'header': {'school_name': 'T'}, 'blocks': [
            {'id': 'a', 'type': 'short_answer', 'title': 'Answer.', 'marks': 2, 'data': {'items': [{'text': EDITOR_EQUATION}]}},
        ]}
        page = render_html(document, PictureStore())
        assert '<span class="math">x^2+1 &lt; 5</span>' in page and 'katex.min.js' in page and '$x^2' not in page
        word = Document(io.BytesIO(render_docx(document, PictureStore())))
        text = '\n'.join(p.text for p in word.paragraphs)
        assert 'Solve x^2+1 < 5 now' in text and '$' not in text


@pytest.mark.django_db
class TestOldPapersAfterPhase7:
    """Phase 7 removed the old PDF/Word/scan code: an old paper (structure + bank questions, no block list) must
    still print from print-html, give a Word file and keep its students' answers when it is saved as blocks."""
    DIAGRAM = 'https://files.example.test/storage/v1/object/public/atten-reg/papers/1/figures/fig_a.jpg'

    def _old_paper(self, seed_data, paper):
        from examinations.models import StudentResponse
        paper.structure = [{'key': 's1', 'title': 'Section A', 'question_type': 'SHORT', 'instruction': 'Answer.'}]
        paper.save(update_fields=['structure'])
        questions = []
        for order, (text, picture) in enumerate([('Label the parts of the flower.', self.DIAGRAM),
                                                 ('What is pollination?', None)], start=1):
            question = Question.objects.create(
                school_id=seed_data['SID_A'], subject=seed_data['subjects'][0], question_type='SHORT',
                question_text=text, question_image_url=picture, answer_text='x', marks=Decimal('3'))
            link = PaperQuestion.objects.create(exam_paper=paper, question=question, question_order=order,
                                                section_key='s1')
            link.sync_question_snapshot()
            questions.append(question)
        student = seed_data['students'][0]
        for question in questions:
            StudentResponse.objects.create(exam_paper=paper, question=question, student=student,
                                           response_text='answer', marks_awarded=Decimal('2'))
        return questions

    @override_settings(SUPABASE_URL='https://files.example.test')
    def test_old_paper_with_a_diagram_prints_and_gives_word(self, api, seed_data, paper):
        self._old_paper(seed_data, paper)
        token, sid = seed_data['tokens']['admin'], seed_data['SID_A']
        page = api.get(f'{PAPERS}{paper.id}/print-html/', token, sid)
        assert page.status_code == 200
        html = page.content.decode()
        assert 'Label the parts of the flower.' in html and self.DIAGRAM in html
        word = api.get(f'{PAPERS}{paper.id}/generate-docx/', token, sid)
        assert word.status_code == 200 and word.content[:2] == b'PK'
        paper.refresh_from_db()
        assert not (paper.document or {}).get('blocks')            # printing never rewrites an old paper

    @override_settings(SUPABASE_URL='https://files.example.test')
    def test_saving_an_old_paper_as_blocks_keeps_its_questions_and_answers(self, api, seed_data, paper):
        from examinations.models import StudentResponse
        questions = self._old_paper(seed_data, paper)
        token, sid = seed_data['tokens']['admin'], seed_data['SID_A']
        body = api.get(f'{PAPERS}{paper.id}/document/', token, sid).json()
        assert body['converted'] is True
        [block] = body['document']['blocks']
        assert block['data']['items'][0]['picture'] == {'url': self.DIAGRAM}
        response = api.post(f'{PAPERS}{paper.id}/autosave/', {'document': body['document']}, token, sid)
        assert response.status_code == 200, response.content
        paper.refresh_from_db()
        assert paper.document['blocks']
        assert sorted(paper.paper_questions.values_list('question_id', flat=True)) == sorted(q.id for q in questions)
        assert StudentResponse.objects.filter(exam_paper=paper).count() == 2
        assert set(StudentResponse.objects.filter(exam_paper=paper).values_list('question_id', flat=True)) \
            == {q.id for q in questions}

    @pytest.mark.parametrize('question_type', ['FILL_BLANK', 'TRUE_FALSE'])
    @override_settings(SUPABASE_URL='https://files.example.test')
    def test_the_diagram_of_an_old_blank_or_true_false_question_prints(self, api, seed_data, paper, question_type):
        """Found on scratch in Phase 7: these two block types had no picture, so an old diagram was dropped."""
        question = Question.objects.create(
            school_id=seed_data['SID_A'], subject=seed_data['subjects'][0], question_type=question_type,
            question_text='The ____ rises in the east.', question_image_url=self.DIAGRAM, correct_answer='TRUE',
            type_data={'accepted_answers': ['sun']} if question_type == 'FILL_BLANK' else {}, marks=Decimal('1'))
        PaperQuestion.objects.create(exam_paper=paper, question=question, question_order=1).sync_question_snapshot()
        token, sid = seed_data['tokens']['admin'], seed_data['SID_A']
        body = api.get(f'{PAPERS}{paper.id}/document/', token, sid).json()
        assert body['document']['blocks'][0]['data']['items'][0]['picture'] == {'url': self.DIAGRAM}
        html = api.get(f'{PAPERS}{paper.id}/print-html/', token, sid).content.decode()
        assert self.DIAGRAM in html
        assert api.post(f'{PAPERS}{paper.id}/autosave/', {'document': body['document']}, token, sid).status_code == 200


@pytest.mark.django_db
class TestMatchingBankShape:
    """Matching questions from the block editor are kept in the question bank's own shape (left_items, right_items,
    index pairs), so the bank form opens them; an unchanged pick is reused whatever shape it was stored in."""

    BANK = {'left_items': ['Fish', 'Bird'], 'right_items': ['Water', 'Nest'],
            'pairs': [{'left': 0, 'right': 0}, {'left': 1, 'right': 1}]}

    def _block(self, question_id=None, pairs=(('Fish', 'Water'), ('Bird', 'Nest'))):
        items = [{'left': left, 'right': right} for left, right in pairs]
        block = {'id': 'mt', 'type': 'matching', 'title': 'Match.', 'marks': 2, 'data': {'items': items}}
        if question_id:
            block['question_id'] = question_id
        return {'blocks': [block]}

    def _bank(self, seed_data, type_data):
        return Question.objects.create(school_id=seed_data['SID_A'], subject=seed_data['subjects'][0],
                                       question_type='MATCHING', question_text='Match.', type_data=type_data, marks=2)

    def test_a_new_matching_block_is_saved_in_the_bank_shape(self, api, seed_data, paper):
        assert _autosave(api, seed_data, paper, self._block()).status_code == 200
        assert paper.paper_questions.get().question.type_data == self.BANK

    def test_an_unchanged_bank_question_is_reused_not_copied(self, api, seed_data, paper):
        question = self._bank(seed_data, self.BANK)
        before = Question.objects.count()
        assert _autosave(api, seed_data, paper, self._block(question.id)).status_code == 200
        assert Question.objects.count() == before
        assert paper.paper_questions.get().question_id == question.id

    def test_one_in_the_older_text_pair_shape_is_reused_too(self, api, seed_data, paper):
        question = self._bank(seed_data, {'pairs': [{'left': 'Fish', 'right': 'Water'}, {'left': 'Bird', 'right': 'Nest'}]})
        before = Question.objects.count()
        assert _autosave(api, seed_data, paper, self._block(question.id)).status_code == 200
        assert Question.objects.count() == before

    def test_a_bank_distractor_does_not_count_as_an_edit(self, api, seed_data, paper):
        question = self._bank(seed_data, {**self.BANK, 'right_items': ['Water', 'Nest', 'Sky']})
        before = Question.objects.count()
        assert _autosave(api, seed_data, paper, self._block(question.id)).status_code == 200
        assert Question.objects.count() == before

    def test_changed_pairs_on_a_bank_question_make_a_copy(self, api, seed_data, paper):
        question = self._bank(seed_data, self.BANK)
        before = Question.objects.count()
        document = self._block(question.id, pairs=(('Fish', 'Sea'), ('Bird', 'Nest')))
        assert _autosave(api, seed_data, paper, document).status_code == 200
        assert Question.objects.count() == before + 1
        question.refresh_from_db()
        assert question.type_data == self.BANK
        copy = paper.paper_questions.get().question
        assert copy.type_data['right_items'] == ['Sea', 'Nest']

    def test_the_bank_serializer_accepts_what_the_editor_saved(self, api, seed_data, paper):
        from examinations.serializers import QuestionCreateUpdateSerializer
        _autosave(api, seed_data, paper, self._block())
        saved = paper.paper_questions.get().question
        data = {'question_text': saved.question_text, 'question_type': 'MATCHING', 'difficulty_level': 'MEDIUM',
                'marks': '2', 'subject': saved.subject_id, 'type_data': saved.type_data}
        serializer = QuestionCreateUpdateSerializer(instance=saved, data=data, partial=True)
        assert serializer.is_valid(), serializer.errors
