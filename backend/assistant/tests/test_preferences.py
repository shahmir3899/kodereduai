"""Long-term preferences (backlog item D): stored per user and school, validated, used by the prompt and by the class lookup.
No model is reached."""
import pytest

from assistant import engine, orchestrator, prefs, registry
from assistant.models import AgentConversation, AgentPreference
from assistant.skills import lms_common as lc

pytestmark = pytest.mark.django_db
URL = '/api/assistant/preferences/'


@pytest.fixture(autouse=True)
def _on(settings):
    settings.ASSISTANT_DEFAULT_ENABLED = True


def _ctx(user, role=None):
    return registry.ToolContext(user=user, school_id=user.school_id, role=role or user.role)


def test_nothing_saved_means_empty(seed_data):
    assert prefs.get(seed_data['school_a'].id, seed_data['users']['admin'].id) == {}


def test_save_get_and_clear(seed_data):
    ctx = _ctx(seed_data['users']['admin'])
    prefs.save(ctx, {'language': 'roman'})
    assert prefs.get(ctx.school_id, ctx.user.id) == {'language': 'roman'}
    prefs.save(ctx, {'language': None})
    assert prefs.get(ctx.school_id, ctx.user.id) == {}


def test_each_user_has_their_own(seed_data):
    a, p = seed_data['users']['admin'], seed_data['users']['principal']
    prefs.save(_ctx(a), {'language': 'ur'})
    assert prefs.get(a.school_id, p.id) == {}


def test_validation_refuses_bad_values(seed_data):
    ctx = _ctx(seed_data['users']['admin'])
    with pytest.raises(registry.ProposalError, match='language must be'):
        prefs.save(ctx, {'language': 'klingon'})
    with pytest.raises(registry.ProposalError, match='Unknown preference'):
        prefs.save(ctx, {'password': 'x'})
    with pytest.raises(registry.ProposalError, match='No class matching'):
        prefs.save(ctx, {'default_class': '99Z'})
    assert prefs.get(ctx.school_id, ctx.user.id) == {}


def test_usual_class_fills_in_a_missing_class_but_a_named_class_wins(seed_data, seed_sections):
    ctx, master = _ctx(seed_data['users']['admin']), seed_sections['master']
    with pytest.raises(registry.ProposalError, match='Which class'):
        lc.find_sections(ctx, None)
    prefs.save(ctx, {'default_class': f'{master.name} B'})
    assert [s.section for s in lc.find_sections(ctx, None)] == ['B']
    assert {s.section for s in lc.find_sections(ctx, master.name)} == {'A', 'B'}


def test_the_prompt_mentions_only_what_is_saved(seed_data):
    user = seed_data['users']['admin']
    ctx = _ctx(user)
    conv = AgentConversation.objects.create(school_id=ctx.school_id, user=user)
    assert 'Saved preferences' not in orchestrator._system_prompt(ctx, conv)
    prefs.save(ctx, {'language': 'roman'})
    prompt = orchestrator._system_prompt(ctx, conv)
    assert 'Saved preferences' in prompt and 'Roman Urdu' in prompt
    prefs.save(ctx, {'language': 'auto'})
    assert 'Saved preferences' not in orchestrator._system_prompt(ctx, conv)


def test_chat_tool_proposes_a_card_and_saves_only_on_approval(seed_data):
    user = seed_data['users']['admin']
    ctx = _ctx(user)
    ctx.conversation = AgentConversation.objects.create(school_id=ctx.school_id, user=user)
    out = registry.execute(ctx, 'set_my_preferences', {'language': 'ur'})
    assert out['status'] == 'awaiting_user_approval'
    assert prefs.get(ctx.school_id, user.id) == {}
    engine.approve(out['proposal']['action_id'], user, ctx.school_id)
    assert prefs.get(ctx.school_id, user.id) == {'language': 'ur'}


def test_parents_and_students_can_read_but_not_use_the_chat_write_tool(seed_data):
    admin = seed_data['users']['admin']
    for role in registry.NO_WRITE_ROLES:
        names = {t.name for t in registry.tools_for(_ctx(admin, role))}
        assert 'set_my_preferences' not in names


class TestApi:
    def test_get_and_patch_belong_to_the_signed_in_user(self, seed_data, api):
        tok, sid = seed_data['tokens']['admin'], seed_data['SID_A']
        assert api.get(URL, tok, sid).json()['preferences'] == {}
        res = api.patch(URL, {'language': 'roman'}, tok, sid)
        assert res.status_code == 200 and res.json()['preferences'] == {'language': 'roman'}
        other = api.get(URL, seed_data['tokens']['principal'], sid).json()
        assert other['preferences'] == {}

    def test_a_bad_value_is_a_400_with_a_message(self, seed_data, api):
        res = api.patch(URL, {'language': 'klingon'}, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert res.status_code == 400 and 'language' in res.json()['error']
        assert not AgentPreference.objects.exists()

    def test_closed_when_the_assistant_is_off_for_the_school(self, seed_data, api):
        from assistant import usage
        usage.set_assistant_enabled(seed_data['school_a'], False)
        assert api.get(URL, seed_data['tokens']['admin'], seed_data['SID_A']).status_code == 404


class TestRenameConversation:
    """Item E: the title can be changed through the conversation endpoint; empty, huge or foreign ones are refused."""

    def _conv(self, seed_data, key='admin'):
        return AgentConversation.objects.create(school_id=seed_data['school_a'].id, user=seed_data['users'][key], title='old')

    def test_rename_trims_and_saves(self, seed_data, api):
        conv = self._conv(seed_data)
        res = api.patch(f'/api/assistant/conversations/{conv.id}/', {'title': '  Fee follow-up  '}, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert res.status_code == 200 and res.json()['title'] == 'Fee follow-up'

    def test_empty_or_too_long_is_a_400_and_changes_nothing(self, seed_data, api):
        conv = self._conv(seed_data)
        for bad in ('   ', 'x' * 201):
            res = api.patch(f'/api/assistant/conversations/{conv.id}/', {'title': bad}, seed_data['tokens']['admin'], seed_data['SID_A'])
            assert res.status_code == 400 and res.json()['error']
        conv.refresh_from_db()
        assert conv.title == 'old'

    def test_someone_elses_conversation_looks_missing(self, seed_data, api):
        conv = self._conv(seed_data, 'principal')
        res = api.patch(f'/api/assistant/conversations/{conv.id}/', {'title': 'mine now'}, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert res.status_code == 404
