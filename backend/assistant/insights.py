"""Read side of the learning loop: what people asked that Aura could not do, grouped and counted.

Scope is decided here, not by the caller: a school admin or principal only ever sees their own school's
rows; the super admin sees every school and may narrow with ?school=. Student and parent rows have no
text, so they only add to counts and never produce examples.
"""
from collections import Counter
from datetime import timedelta

from django.db.models import Count
from django.utils import timezone

from .models import AgentGap, AgentGapGroup

ALLOWED_DAYS = (7, 30, 90)
MAX_EXAMPLES = 3
TOP = 3
# Thumbs-up is a satisfaction count, not a gap.
GAP_KINDS = [k for k in AgentGap.Kind.values if k != AgentGap.Kind.THUMBS_UP]


def _top(counter):
    return [{'key': k, 'count': n} for k, n in counter.most_common(TOP) if k]


def _entry(group, rows, now, days, with_schools):
    """One line of the table, built from this group's (already scoped and filtered) rows."""
    d7, d30 = now - timedelta(days=7), now - timedelta(days=30)
    in7 = sum(1 for r in rows if r['created_at'] >= d7)
    in30 = sum(1 for r in rows if r['created_at'] >= d30)
    series = Counter(r['created_at'].date().isoformat() for r in rows if r['created_at'] >= d30)
    trend = [{'date': (now - timedelta(days=i)).date().isoformat(),
              'count': series.get((now - timedelta(days=i)).date().isoformat(), 0)} for i in range(29, -1, -1)]
    examples, seen = [], set()
    for r in rows:                              # rows are newest first
        text = r['summary']
        if text and text not in seen:
            seen.add(text)
            examples.append(text)
        if len(examples) >= MAX_EXAMPLES:
            break
    out = {
        'id': group.id if group else None,
        'label': group.label if group else 'Ungrouped',
        'description': group.description if group else 'Not grouped yet. The weekly job will sort these.',
        'status': group.status if group else None,
        'note': group.note if group else '',
        'baseline_question_id': group.baseline_question_id if group else None,
        'total': len(rows), 'last_7_days': in7, 'last_30_days': in30,
        'roles': _top(Counter(r['role'] for r in rows)),
        'agents': _top(Counter(r['agent'] for r in rows)),
        'languages': _top(Counter(r['language'] for r in rows)),
        'kinds': _top(Counter(r['kind'] for r in rows)),
        'trend': trend,
        'examples': examples,
    }
    if with_schools:
        out['schools'] = [{'school_id': k, 'count': n} for k, n in Counter(r['school_id'] for r in rows).most_common()]
    return out


def build(school_id, super_admin, *, days=30, kind=None, agent=None, role=None, status=None, school_filter=None):
    """The insights payload. `school_id` is the caller's active school (ignored for the super admin)."""
    days = days if days in ALLOWED_DAYS else 30
    now = timezone.now()
    qs = AgentGap.objects.filter(kind__in=GAP_KINDS, created_at__gte=now - timedelta(days=days))
    if super_admin:
        if school_filter:
            qs = qs.filter(school_id=school_filter)
    else:
        qs = qs.filter(school_id=school_id)
    if kind:
        qs = qs.filter(kind=kind)
    if agent:
        qs = qs.filter(agent=agent)
    if role:
        qs = qs.filter(role=role)

    rows = list(qs.order_by('-created_at').values('group_id', 'school_id', 'role', 'agent', 'language', 'kind', 'summary', 'created_at'))
    by_group = {}
    for r in rows:
        by_group.setdefault(r['group_id'], []).append(r)

    groups = {g.id: g for g in AgentGapGroup.objects.filter(id__in=[g for g in by_group if g])}
    result = []
    for gid, items in by_group.items():
        group = groups.get(gid) if gid else None
        if status and (not group or group.status != status):
            continue
        result.append(_entry(group, items, now, days, super_admin))
    result.sort(key=lambda e: (-e['last_7_days'], -e['total']))

    thumbs = AgentGap.objects.filter(created_at__gte=now - timedelta(days=days), kind__in=[AgentGap.Kind.THUMBS_UP, AgentGap.Kind.THUMBS_DOWN])
    if super_admin:
        if school_filter:
            thumbs = thumbs.filter(school_id=school_filter)
    else:
        thumbs = thumbs.filter(school_id=school_id)
    counts = {r['kind']: r['n'] for r in thumbs.values('kind').annotate(n=Count('id'))}

    payload = {
        'days': days,
        'groups': result,
        'satisfaction': {'up': counts.get('thumbs_up', 0), 'down': counts.get('thumbs_down', 0)},
        'filters': {'kinds': GAP_KINDS, 'statuses': AgentGapGroup.Status.values, 'days': list(ALLOWED_DAYS)},
    }
    if super_admin:
        from schools.models import School
        payload['schools'] = list(School.objects.filter(agent_gaps__isnull=False).distinct().values('id', 'name'))
    return payload
