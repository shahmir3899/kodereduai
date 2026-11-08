import json
from pathlib import Path

from assistant.baseline.scoring import score, summarize

QUESTIONS = Path(__file__).resolve().parents[1] / 'baseline' / 'questions.json'


def test_question_set_is_well_formed():
    qs = json.loads(QUESTIONS.read_text(encoding='utf-8'))
    ids = [q['id'] for q in qs]
    assert len(ids) == len(set(ids)) and len(qs) >= 90
    for q in qs:
        assert {'id', 'agent', 'role', 'lang', 'q', 'expect'} <= set(q)
        assert q['lang'] in ('en', 'ur_roman', 'ur')
        assert set(q['expect']) & {'tool', 'write', 'denied', 'blocked'}
    assert {q['lang'] for q in qs} >= {'en', 'ur_roman'}
    assert sum(1 for q in qs if q['expect'].get('denied')) >= 5
    assert sum(1 for q in qs if q['expect'].get('blocked')) >= 3


def test_every_finance_read_expectation_names_a_registered_tool():
    from assistant import registry
    names = {t.name for t in registry.all_tools()}
    for q in json.loads(QUESTIONS.read_text(encoding='utf-8')):
        if q['agent'] == 'finance' and 'tool' in q['expect']:
            assert q['expect']['tool'] in names, q['id']


def test_read_scoring():
    q = {'expect': {'tool': 'get_pending_fees', 'args': {'class_name': '5'}}}
    assert score(q, [{'name': 'get_pending_fees', 'args': {'class_name': 'Class 5'}, 'ok': True}])['pass']
    assert not score(q, [{'name': 'get_pending_fees', 'args': {}, 'ok': True}])['pass']
    assert not score(q, [{'name': 'get_balance', 'args': {}, 'ok': True}])['pass']
    assert not score(q, [])['pass']


def test_denied_and_blocked_scoring():
    assert score({'expect': {'denied': True}}, [{'name': 'x', 'args': {}, 'ok': False}])['pass']
    assert not score({'expect': {'denied': True}}, [{'name': 'x', 'args': {}, 'ok': True}])['pass']
    assert score({'expect': {'blocked': True}}, [])['pass']
    assert not score({'expect': {'blocked': True}}, [], proposals=['run_payroll'])['pass']


def test_write_scoring_needs_a_proposal():
    q = {'expect': {'write': 'create_expense'}}
    assert not score(q, [])['pass']
    assert score(q, [], proposals=['create_expense'])['pass']


def test_summary_groups_results():
    qs = [
        {'agent': 'finance', 'lang': 'en', 'expect': {'tool': 'a'}},
        {'agent': 'finance', 'lang': 'ur_roman', 'expect': {'tool': 'a'}},
        {'agent': 'study', 'lang': 'en', 'expect': {'write': 'w'}},
    ]
    out = summarize([
        {'question': qs[0], 'pass': True, 'ms': 10},
        {'question': qs[1], 'pass': False, 'ms': 30},
        {'question': qs[2], 'pass': False, 'ms': 20},
    ])
    assert out['total'] == 3 and out['pass_rate'] == 33.3
    assert out['by_agent']['finance']['pass_rate'] == 50.0
    assert out['by_kind']['write']['n'] == 1
    assert out['median_ms'] == 20


def test_academics_and_finance_expectations_name_registered_tools():
    from assistant import registry
    names = {t.name for t in registry.all_tools()}
    for q in json.loads(QUESTIONS.read_text(encoding='utf-8')):
        if q['agent'] in ('academics', 'finance', 'attendance'):
            want = q['expect'].get('tool') or q['expect'].get('write')
            if want:
                assert want in names, (q['id'], want)
