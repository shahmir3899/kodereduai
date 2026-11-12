"""The baseline question file is checked WITHOUT a model: a renamed tool or a wrong role would otherwise only show up as a mysterious miss in a
real run that costs a day of free tokens (docs/handoff/08M_EVAL_ROUTINE.md)."""
import json
from pathlib import Path

import pytest

from assistant import registry
from assistant.skills import load_all

BASELINE = Path(__file__).resolve().parents[1] / 'baseline'
QUESTIONS = json.loads((BASELINE / 'questions.json').read_text(encoding='utf-8'))
LANGS = {'en', 'ur_roman'}
ROLES = {'SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL', 'MANAGER', 'MANAGER_FINANCE', 'TEACHER', 'STAFF', 'DRIVER', 'PARENT', 'STUDENT'}


@pytest.fixture(scope='module', autouse=True)
def _tools():
    load_all()


def test_the_set_is_big_enough_and_ids_are_unique():
    ids = [q['id'] for q in QUESTIONS]
    assert len(ids) == len(set(ids))
    assert len(QUESTIONS) >= 150


def test_every_question_is_well_formed():
    for q in QUESTIONS:
        assert set(q) >= {'id', 'agent', 'role', 'lang', 'q', 'expect'}, q['id']
        assert q['lang'] in LANGS and q['role'] in ROLES, q['id']
        assert q['q'].strip(), q['id']
        kinds = {k for k in ('tool', 'write', 'denied', 'blocked') if k in q['expect']}
        assert len(kinds) == 1, (q['id'], kinds)


def test_every_expected_tool_exists_with_the_right_kind():
    for q in QUESTIONS:
        e = q['expect']
        if 'tool' in e:
            tool = registry.get_tool(e['tool'])
            assert tool is not None and tool.kind == 'read', (q['id'], e['tool'])
        if 'write' in e:
            tool = registry.get_tool(e['write'])
            assert tool is not None and tool.kind == 'write', (q['id'], e['write'])
        for name in e.get('accept') or []:
            assert registry.get_tool(name) is not None, (q['id'], name)


def test_the_asking_role_may_use_the_expected_tool():
    """A question that expects a tool its own role cannot call can never pass; only `denied` questions are meant to be refused."""
    for q in QUESTIONS:
        e = q['expect']
        name = e.get('tool') or e.get('write')
        if not name:
            continue
        tool = registry.get_tool(name)
        assert q['role'] in tool.roles, (q['id'], q['role'], name)


def test_languages_are_both_well_represented():
    ur = sum(1 for q in QUESTIONS if q['lang'] == 'ur_roman')
    assert ur >= 45 and len(QUESTIONS) - ur >= 100
