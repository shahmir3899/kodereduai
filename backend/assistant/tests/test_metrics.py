"""assistant_metrics: the rollout numbers are computed from existing tables (no model call, no writes)."""
import pytest
from django.core.management import call_command
from django.utils import timezone

from assistant.management.commands.assistant_metrics import compute, percentile, verdicts
from assistant.models import AgentAction, AgentAuditLog, AgentConversation, AgentGap, AgentMessage, AgentUsageDay

pytestmark = pytest.mark.django_db


def _log(school, user, ok=True, kind='read', ms=100):
    AgentAuditLog.objects.create(school=school, user=user, tool_name='t', kind=kind, ok=ok, duration_ms=ms)


def _card(school, user, status):
    from datetime import timedelta
    from django.utils import timezone
    return AgentAction.objects.create(school=school, user=user, sub_agent='finance', tool_name='t', status=status,
                                      idempotency_key=f'{status}-{AgentAction.objects.count()}', expires_at=timezone.now() + timedelta(hours=1))


def test_percentile():
    assert percentile([], 95) == 0
    assert percentile([1, 2, 3, 4, 100], 95) == 100
    assert percentile([10, 20, 30], 50) == 20


def test_rates_from_the_tables(seed_data):
    school, user = seed_data['school_a'], seed_data['users']['admin']
    for _ in range(9):
        _log(school, user)
    _log(school, user, ok=False, ms=900)
    _log(school, user, kind='denied', ok=False)           # a refusal by the guard is not a failed tool
    for status in ('executed', 'executed', 'rejected', 'failed', 'pending'):
        _card(school, user, status)
    AgentGap.objects.create(school=school, user=user, kind='card_edited', delete_after='2030-01-01T00:00:00Z')
    conv = AgentConversation.objects.create(school=school, user=user)
    for _ in range(4):
        AgentMessage.objects.create(conversation=conv, role='user', content='q')
    AgentUsageDay.objects.create(school=school, user=user, date=timezone.localdate(), tokens=2000, calls=8, fallbacks=2)

    m = compute(school.id)
    assert m['tool_calls'] == 10 and m['denied'] == 1
    assert m['tool_success'] == pytest.approx(0.9)
    assert m['cards_decided'] == 4 and m['approval_rate'] == pytest.approx(0.5)
    assert m['reject_rate'] == pytest.approx(0.25) and m['fail_rate'] == pytest.approx(0.25)
    assert m['edit_rate'] == pytest.approx(1 / 5)
    assert m['tokens_per_message'] == pytest.approx(500) and m['fallback_rate'] == pytest.approx(0.25)


def test_another_school_is_not_counted(seed_data):
    _log(seed_data['school_b'], seed_data['users']['admin'])
    assert compute(seed_data['school_a'].id)['tool_calls'] == 0


def test_verdicts_and_no_data(seed_data):
    empty = compute(seed_data['school_a'].id)
    assert all(passed is None for *_x, passed in verdicts(empty))
    school, user = seed_data['school_a'], seed_data['users']['admin']
    for _ in range(5):
        _log(school, user, ok=False, ms=30000)
    assert [p for *_x, p in verdicts(compute(school.id))][0] is False


def test_command_prints(seed_data, capsys):
    call_command('assistant_metrics', school_id=seed_data['school_a'].id)
    out = capsys.readouterr().out
    assert 'Go / no-go' in out and 'no data' in out
