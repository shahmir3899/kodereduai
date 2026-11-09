"""Learning loop, step 3: weekly grouping (fake model), retention cleanup, beat schedule, draft export."""
import json
from datetime import timedelta
from io import StringIO
from unittest.mock import patch

import pytest
from django.conf import settings
from django.core.management import call_command
from django.utils import timezone

from assistant import grouping, llm, tasks
from assistant.models import AgentGap, AgentGapGroup

pytestmark = pytest.mark.django_db


def _gap(seed, summary='', kind='missing_tool', role='SCHOOL_ADMIN', tool_hint='', agent='students', group=None, expired=False):
    return AgentGap.objects.create(
        school_id=seed['SID_A'], user=seed['users']['admin'], role=role, kind=kind, summary=summary, tool_hint=tool_hint,
        agent=agent, group=group,
        delete_after=timezone.now() + (timedelta(days=-1) if expired else timedelta(days=90)),
    )


def _model(answer):
    """Fake model: `answer` is a string or a function of the prompt. Records every prompt."""
    calls = []

    def fake(messages, **kwargs):
        calls.append((messages[0]['content'], kwargs))
        text = answer(messages[0]['content']) if callable(answer) else answer
        return llm.LLMReply(content=text)

    return fake, calls


class TestTextGrouping:
    def test_rows_join_an_existing_group_or_a_new_one(self, seed_data):
        existing = AgentGapGroup.objects.create(label='Scholarship list')
        a = _gap(seed_data, 'list scholarship holders')
        b = _gap(seed_data, 'parents of fee pending children')
        fake, calls = _model('[{"n":1,"label":"scholarship LIST"},{"n":2,"label":"Parents of defaulters","description":"contact numbers"}]')
        with patch('assistant.llm.complete', fake):
            out = grouping.run()
        a.refresh_from_db(); b.refresh_from_db()
        assert a.group_id == existing.pk                      # case-insensitive match, no duplicate group
        assert b.group.label == 'Parents of defaulters' and b.group.status == 'new' and b.group.description == 'contact numbers'
        assert AgentGapGroup.objects.count() == 2 and out['assigned_rows'] == 2
        assert calls[0][1]['tier'] == 'fast' and 'Scholarship list' in calls[0][0]

    def test_identical_summaries_are_sent_once_and_all_rows_grouped(self, seed_data):
        rows = [_gap(seed_data, 'same question') for _ in range(3)]
        fake, calls = _model('[{"n":1,"label":"Same"}]')
        with patch('assistant.llm.complete', fake):
            grouping.run()
        assert calls[0][0].count('same question') == 1
        assert all(AgentGap.objects.get(pk=r.pk).group_id for r in rows)

    @pytest.mark.parametrize('answer', ['not json', '[{"n":9,"label":"x"}]', '{"n":1}', '[{"n":1}]'])
    def test_bad_model_output_leaves_rows_ungrouped(self, seed_data, answer):
        row = _gap(seed_data, 'something')
        fake, _ = _model(answer)
        with patch('assistant.llm.complete', fake):
            grouping.run()
        row.refresh_from_db()
        assert row.group_id is None and AgentGapGroup.objects.count() == 0

    def test_code_fenced_json_is_accepted(self, seed_data):
        row = _gap(seed_data, 'something')
        fake, _ = _model('```json\n[{"n":1,"label":"Thing"}]\n```')
        with patch('assistant.llm.complete', fake):
            grouping.run()
        row.refresh_from_db()
        assert row.group.label == 'Thing'

    def test_model_unavailable_stops_cleanly_and_changes_nothing(self, seed_data):
        existing = AgentGapGroup.objects.create(label='Keep me', status='planned', note='n')
        row = _gap(seed_data, 'something')

        def down(*a, **k):
            raise llm.LLMUnavailable('rate limited')

        with patch('assistant.llm.complete', down):
            out = grouping.run()
        row.refresh_from_db(); existing.refresh_from_db()
        assert row.group_id is None and 'unavailable' in out['stopped']
        assert (existing.status, existing.note) == ('planned', 'n')

    def test_batches_and_call_cap(self, seed_data):
        for i in range(grouping.BATCH_SIZE * (grouping.MAX_CALLS + 1)):
            _gap(seed_data, f'distinct question {i}')
        fake, calls = _model('[]')
        with patch('assistant.llm.complete', fake):
            out = grouping.run()
        assert len(calls) == grouping.MAX_CALLS and 'cap' in out['stopped']

    def test_students_parents_thumbs_up_and_empty_text_are_never_sent(self, seed_data):
        _gap(seed_data, '', role='PARENT')
        _gap(seed_data, '', role='STUDENT', kind='thumbs_down')
        _gap(seed_data, 'happy', kind='thumbs_up')
        fake, calls = _model('[]')
        with patch('assistant.llm.complete', fake):
            grouping.run()
        assert calls == []

    def test_dry_run_changes_nothing(self, seed_data):
        row = _gap(seed_data, 'something')
        _gap(seed_data, kind='denied', tool_hint='get_balance')
        fake, _ = _model('[{"n":1,"label":"Thing"}]')
        with patch('assistant.llm.complete', fake):
            out = grouping.run(dry_run=True)
        row.refresh_from_db()
        assert row.group_id is None and AgentGapGroup.objects.count() == 0 and out['plan'][0]['label'] == 'Thing'


class TestRuleGrouping:
    def test_errors_denials_and_card_changes_group_by_tool_without_the_model(self, seed_data):
        rows = {k: _gap(seed_data, kind=k, tool_hint='get_balance') for k in ('denied', 'tool_error', 'card_rejected', 'card_edited')}
        again = _gap(seed_data, kind='denied', tool_hint='get_balance')
        with patch('assistant.llm.complete', side_effect=AssertionError('model must not be called')):
            grouping.run()
        labels = {k: AgentGap.objects.get(pk=r.pk).group.label for k, r in rows.items()}
        assert labels == {'denied': 'Not allowed: get_balance', 'tool_error': 'Tool error: get_balance',
                          'card_rejected': 'Card rejected: get_balance', 'card_edited': 'Card edited: get_balance'}
        assert AgentGap.objects.get(pk=again.pk).group_id == AgentGap.objects.get(pk=rows['denied'].pk).group_id


class TestCleanupAndSchedule:
    def test_only_expired_rows_are_deleted_in_chunks(self, seed_data):
        for _ in range(5):
            _gap(seed_data, 'old', expired=True)
        keep = _gap(seed_data, 'fresh')
        with patch('assistant.tasks.CHUNK', 2):
            assert tasks.cleanup_expired_gaps() == 5
        assert list(AgentGap.objects.values_list('pk', flat=True)) == [keep.pk]

    def test_both_jobs_are_on_the_beat_schedule(self):
        paths = {v['task'] for v in settings.CELERY_BEAT_SCHEDULE.values()}
        assert {'assistant.tasks.cleanup_expired_gaps', 'assistant.tasks.group_new_gaps'} <= paths

    def test_the_task_wrapper_returns_the_summary(self, seed_data):
        _gap(seed_data, kind='denied', tool_hint='x')
        out = tasks.group_new_gaps()
        assert out['rule_rows'] == 1 and 'plan' not in out


class TestExport:
    def _run(self, *args):
        out = StringIO()
        call_command('export_gap_questions', *args, stdout=out)
        return out.getvalue()

    def test_drafts_use_redacted_examples_and_leave_expect_to_fill_in(self, seed_data):
        group = AgentGapGroup.objects.create(label='g')
        for i in range(7):
            _gap(seed_data, f'list <student> scholarship {i}', group=group)
        _gap(seed_data, '', group=group, role='PARENT')
        drafts = json.loads(self._run('--group', str(group.pk)))
        assert len(drafts) == 5 and drafts[0]['id'] == f'G{group.pk}-1'
        assert drafts[0]['expect'] == {'tool': 'TODO'} and drafts[0]['agent'] == 'students' and drafts[0]['role'] == 'SCHOOL_ADMIN'

    def test_a_group_with_no_text_exports_nothing(self, seed_data):
        group = AgentGapGroup.objects.create(label='g')
        _gap(seed_data, '', group=group, role='PARENT')
        assert 'Nothing to export' in self._run('--group', str(group.pk))

    def test_questions_json_is_never_touched(self, seed_data, tmp_path):
        from pathlib import Path

        import assistant
        path = Path(assistant.__file__).parent / 'baseline' / 'questions.json'
        before = path.read_bytes()
        group = AgentGapGroup.objects.create(label='g')
        _gap(seed_data, 'something', group=group)
        out = tmp_path / 'draft.json'
        self._run('--group', str(group.pk), '--out', str(out))
        assert out.exists() and path.read_bytes() == before
