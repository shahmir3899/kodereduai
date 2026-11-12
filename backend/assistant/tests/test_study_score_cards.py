"""Study helper extras (backlog item K): the running quiz score and the flashcard topics. The student service is faked; no model is reached."""
from unittest.mock import patch

import pytest

from assistant import registry
from assistant.models import AgentConversation
from assistant.tests.test_item4_tools import FakeService

pytestmark = pytest.mark.django_db


@pytest.fixture
def student(seed_data):
    user = seed_data['users']['staff']
    user.role = 'STUDENT'
    return user


def _ctx(user, conv, role='STUDENT'):
    return registry.ToolContext(user=user, school_id=user.school_id, role=role, conversation=conv)


def _run(user, conv, tool, svc=None, **args):
    with patch('assistant.skills.study_extras._service', lambda c: svc or FakeService()):
        return registry.execute(_ctx(user, conv), tool, args)


@pytest.fixture
def chat(student):
    return AgentConversation.objects.create(school_id=student.school_id, user=student)


def test_the_score_runs_across_answers_and_survives_in_the_chat_state(student, chat):
    assert _run(student, chat, 'record_quiz_answer', subject='Maths', correct=True)['data']['score'] == '1/1'
    _run(student, chat, 'record_quiz_answer', subject='maths', correct=False)           # same subject, different case
    out = _run(student, chat, 'record_quiz_answer', subject='Maths', correct=True)['data']
    assert out['score'] == '2/3' and out['total'] == '2/3'
    chat.refresh_from_db()
    assert chat.state['quiz'] == {'Maths': {'asked': 3, 'correct': 2}}
    assert _run(student, chat, 'record_quiz_answer', subject='Urdu', correct=True)['data']['total'] == '3/4'


def test_reset_clears_everything_or_one_subject(student, chat):
    for subject in ('Maths', 'Urdu'):
        _run(student, chat, 'record_quiz_answer', subject=subject, correct=True)
    _run(student, chat, 'record_quiz_answer', subject='Maths', reset=True)
    chat.refresh_from_db()
    assert list(chat.state['quiz']) == ['Urdu']
    _run(student, chat, 'record_quiz_answer', reset=True)
    chat.refresh_from_db()
    assert chat.state['quiz'] == {}


def test_missing_or_unclear_input_asks(student, chat):
    assert 'Which subject' in _run(student, chat, 'record_quiz_answer', correct=True)['error']
    assert 'right or wrong' in _run(student, chat, 'record_quiz_answer', subject='Maths')['error']


def test_scores_of_two_chats_do_not_mix(student, chat):
    other = AgentConversation.objects.create(school_id=student.school_id, user=student)
    _run(student, chat, 'record_quiz_answer', subject='Maths', correct=True)
    assert _run(student, other, 'record_quiz_answer', subject='Maths', correct=False)['data']['score'] == '0/1'


def test_flashcard_topics_for_a_named_subject_and_for_the_weakest(student, chat):
    named = _run(student, chat, 'get_flashcard_topics', subject='Maths')['data']
    assert [t['topic'] for t in named['topics']] == ['Adding', 'Place value'] and 'two-column' in named['how_to_use']
    weakest = _run(student, chat, 'get_flashcard_topics')['data']
    assert weakest['subjects'][0] == 'Maths'                      # Maths has the lowest average in the fake marks


def test_no_results_and_no_curriculum_are_explained(student, chat):
    class Empty(FakeService):
        def _execute_tool(self, name, params):
            return {'marks': []} if name == 'get_my_marks' else {'books': []}
    assert 'No published results' in _run(student, chat, 'get_flashcard_topics', svc=Empty())['data']['note']
    assert 'No curriculum topics' in _run(student, chat, 'get_flashcard_topics', svc=Empty(), subject='Maths')['data']['note']


def test_the_topic_list_is_capped(student, chat):
    class Many(FakeService):
        def _execute_tool(self, name, params):
            if name == 'get_topic_details':
                return {'books': [{'subject': 'Maths', 'title': 'B', 'chapters': [{'chapter_number': 1, 'title': 'C', 'topics': [{'title': f't{i}'} for i in range(30)]}]}]}
            return super()._execute_tool(name, params)
    out = _run(student, chat, 'get_flashcard_topics', svc=Many(), subject='Maths')['data']
    assert len(out['topics']) == 12 and 'Showing 12 of 30' in out['note']


def test_only_students_get_these_tools(seed_data, chat):
    for role in ('admin', 'teacher', 'finance_manager'):
        user = seed_data['users'][role]
        out = registry.execute(_ctx(user, chat, user.role), 'record_quiz_answer', {'subject': 'Maths', 'correct': True})
        assert out == {'error': 'You do not have permission to use this tool.'}
