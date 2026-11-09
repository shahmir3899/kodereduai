"""Rollout metrics for the assistant, to compare against the Phase 0 baseline (docs/handoff/08B_ROLLOUT.md).

    python manage.py assistant_metrics --school-id 42 [--days 7]

Reads only; writes nothing. Everything comes from tables that already exist:
tool-call success and latency from AgentAuditLog, approval / reject / fail rates from AgentAction,
edits from AgentGap (an edited card keeps no flag of its own: a card edited and then approved is only "executed"),
tokens per message from AgentUsageDay and AgentMessage.
"""
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db.models import Count, Sum
from django.utils import timezone

from assistant.models import AgentAction, AgentAuditLog, AgentGap, AgentMessage, AgentUsageDay

# Go / no-go limits proposed in docs/handoff/08B_ROLLOUT.md; the owner can change them there and here.
MIN_TOOL_SUCCESS = 0.90
MAX_BAD_CARDS = 0.15          # rejected + failed, out of cards a person decided on
MAX_P95_MS = 20000


def percentile(values, pct):
    if not values:
        return 0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(round(pct / 100 * (len(ordered) - 1))))]


def compute(school_id, days=7):
    since = timezone.now() - timedelta(days=days)
    logs = AgentAuditLog.objects.filter(school_id=school_id, created_at__gte=since)
    # A denied call is the guard doing its job, not a failed tool: leave it out of the success rate.
    calls = logs.exclude(kind=AgentAuditLog.Kind.DENIED)
    total, ok = calls.count(), calls.filter(ok=True).count()
    durations = list(calls.values_list('duration_ms', flat=True))

    actions = AgentAction.objects.filter(school_id=school_id, created_at__gte=since)
    by_status = {r['status']: r['n'] for r in actions.values('status').annotate(n=Count('id'))}
    executed, rejected, failed = (by_status.get(s, 0) for s in ('executed', 'rejected', 'failed'))
    decided = executed + rejected + failed
    edits = AgentGap.objects.filter(school_id=school_id, kind=AgentGap.Kind.CARD_EDITED, created_at__gte=since).count()

    tokens = AgentUsageDay.objects.filter(school_id=school_id, date__gte=since.date()).aggregate(t=Sum('tokens'), c=Sum('calls'), f=Sum('fallbacks'))
    messages = AgentMessage.objects.filter(conversation__school_id=school_id, role='user', created_at__gte=since).count()

    return {
        'days': days,
        'tool_calls': total,
        'tool_success': (ok / total) if total else None,
        'denied': logs.filter(kind=AgentAuditLog.Kind.DENIED).count(),
        'latency_p50_ms': percentile(durations, 50),
        'latency_p95_ms': percentile(durations, 95),
        'cards': actions.count(),
        'cards_decided': decided,
        'approval_rate': (executed / decided) if decided else None,
        'reject_rate': (rejected / decided) if decided else None,
        'fail_rate': (failed / decided) if decided else None,
        'edit_rate': (edits / actions.count()) if actions.count() else None,
        'user_messages': messages,
        'tokens': tokens['t'] or 0,
        'model_calls': tokens['c'] or 0,
        'fallback_rate': ((tokens['f'] or 0) / tokens['c']) if tokens['c'] else None,
        'tokens_per_message': ((tokens['t'] or 0) / messages) if messages else None,
    }


def verdicts(m):
    """(label, value, limit text, passed or None when there is no data yet)."""
    bad = None if not m['cards_decided'] else (m['reject_rate'] + m['fail_rate'])
    return [
        ('Tool-call success', m['tool_success'], f'>= {MIN_TOOL_SUCCESS:.0%}', None if m['tool_success'] is None else m['tool_success'] >= MIN_TOOL_SUCCESS),
        ('Cards rejected or failed', bad, f'<= {MAX_BAD_CARDS:.0%}', None if bad is None else bad <= MAX_BAD_CARDS),
        ('Latency p95 (ms)', m['latency_p95_ms'] if m['tool_calls'] else None, f'<= {MAX_P95_MS}', None if not m['tool_calls'] else m['latency_p95_ms'] <= MAX_P95_MS),
    ]


def _fmt(value):
    if value is None:
        return 'no data'
    return f'{value:.1%}' if isinstance(value, float) and value <= 1 else f'{value:,.0f}'


class Command(BaseCommand):
    help = 'Tool success, approval / edit rate, latency and tokens per message for one school.'

    def add_arguments(self, parser):
        parser.add_argument('--school-id', type=int, required=True)
        parser.add_argument('--days', type=int, default=7)

    def handle(self, *args, **opts):
        m = compute(opts['school_id'], opts['days'])
        out = self.stdout.write
        out(f'School {opts["school_id"]}, last {m["days"]} days')
        out(f'  user messages {m["user_messages"]:,}   tokens {m["tokens"]:,}   per message {_fmt(m["tokens_per_message"])}   fallback rate {_fmt(m["fallback_rate"])}')
        out(f'  tool calls {m["tool_calls"]:,} (denied {m["denied"]})   success {_fmt(m["tool_success"])}   latency p50 {m["latency_p50_ms"]} ms, p95 {m["latency_p95_ms"]} ms')
        out(f'  cards {m["cards"]} (decided {m["cards_decided"]})   approved {_fmt(m["approval_rate"])}   rejected {_fmt(m["reject_rate"])}   failed {_fmt(m["fail_rate"])}   edited {_fmt(m["edit_rate"])}')
        out('\nGo / no-go')
        for label, value, limit, passed in verdicts(m):
            mark = 'no data' if passed is None else ('GO' if passed else 'NO-GO')
            out(f'  {label:<26}{_fmt(value):>10}   limit {limit:<8} {mark}')
        out('\nThe baseline pass rate (104 of 127 at Phase 0) comes from `assistant_baseline`, not from here.')
