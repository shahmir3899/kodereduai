"""Weekly grouping of AgentGap rows into AgentGapGroup (learning loop, step 3).

Rules do the cheap part (errors, denials and card changes group by tool name, no model needed).
One small model call per batch does the rest: attach each redacted summary to an existing group
label or name a new one. Only redacted summaries are ever sent; students' and parents' rows have no
text and are never sent. If anything goes wrong rows stay ungrouped and are retried next week;
existing groups, notes and statuses are never touched by a failure.
"""
import json
import logging
import re

from django.db import transaction

from . import llm
from .models import AgentGap, AgentGapGroup

logger = logging.getLogger(__name__)

BATCH_SIZE = 40          # distinct summaries per model call
MAX_CALLS = 5            # per run: a busy week defers the rest instead of losing it
MAX_LABELS_SHOWN = 50
LABEL_MAX = 120
TEXT_KINDS = (AgentGap.Kind.MISSING_TOOL, AgentGap.Kind.THUMBS_DOWN, AgentGap.Kind.CLARIFY_LOOP)
RULE_PREFIX = {
    AgentGap.Kind.DENIED: 'Not allowed',
    AgentGap.Kind.TOOL_ERROR: 'Tool error',
    AgentGap.Kind.CARD_REJECTED: 'Card rejected',
    AgentGap.Kind.CARD_EDITED: 'Card edited',
}

PROMPT = """You sort short, anonymised requests that a school assistant could not handle into groups.
Existing groups: {labels}
Below are numbered requests. For EACH number, either reuse an existing group label EXACTLY, or invent a short new
label (max 6 words, English) with a one-line description. Requests asking for the same thing in different words or
languages belong in one group.
Reply with ONLY a JSON list: [{{"n": 1, "label": "...", "description": "..."}}, ...]. No other text.

{items}"""


def _get_group(label, description='', cache=None):
    """Case-insensitive get-or-create, so a model changing capitalisation cannot split a group."""
    label = re.sub(r'\s+', ' ', (label or '')).strip()[:LABEL_MAX]
    if not label:
        return None
    key = label.lower()
    if cache is not None and key in cache:
        return cache[key]
    group = AgentGapGroup.objects.filter(label__iexact=label).first()
    if not group:
        group = AgentGapGroup.objects.create(label=label, description=(description or '')[:500])
    if cache is not None:
        cache[key] = group
    return group


def group_by_rules():
    """Errors, denials and card changes: one group per kind and tool. Returns rows assigned."""
    done = 0
    for kind, prefix in RULE_PREFIX.items():
        rows = AgentGap.objects.filter(group__isnull=True, kind=kind).exclude(tool_hint='')
        for tool in set(rows.values_list('tool_hint', flat=True)):
            group = _get_group(f'{prefix}: {tool}', f'Automatic group for {kind.replace("_", " ")} on {tool}.')
            done += rows.filter(tool_hint=tool).update(group=group)
    return done


def _parse(text, count):
    """{index: (label, description)} from the model's reply; anything malformed is simply left out."""
    text = re.sub(r'^```(?:json)?|```$', '', (text or '').strip(), flags=re.M).strip()
    start, end = text.find('['), text.rfind(']')
    if start < 0 or end < start:
        return {}
    try:
        items = json.loads(text[start:end + 1])
    except (json.JSONDecodeError, ValueError):
        return {}
    out = {}
    for item in items if isinstance(items, list) else []:
        try:
            n = int(item['n'])
        except (KeyError, TypeError, ValueError):
            continue
        label = item.get('label') if isinstance(item, dict) else None
        if 1 <= n <= count and isinstance(label, str) and label.strip():
            out[n] = (label, str(item.get('description') or ''))
    return out


def group_text_rows(dry_run=False):
    """Model pass over ungrouped rows that carry redacted text. Returns a summary dict."""
    pending = {}                       # summary -> [row ids]
    for pk, summary in (AgentGap.objects.filter(group__isnull=True, kind__in=TEXT_KINDS)
                        .exclude(summary='').order_by('created_at').values_list('pk', 'summary')):
        pending.setdefault(summary, []).append(pk)
    summaries = list(pending)
    result = {'distinct': len(summaries), 'assigned_rows': 0, 'calls': 0, 'stopped': '', 'plan': []}

    for start in range(0, len(summaries), BATCH_SIZE):
        if result['calls'] >= MAX_CALLS:
            result['stopped'] = 'call cap reached; the rest waits for the next run'
            break
        batch = summaries[start:start + BATCH_SIZE]
        labels = list(AgentGapGroup.objects.order_by('-updated_at').values_list('label', flat=True)[:MAX_LABELS_SHOWN])
        prompt = PROMPT.format(labels=json.dumps(labels) if labels else '(none yet)',
                               items='\n'.join(f'{i}. {s}' for i, s in enumerate(batch, 1)))
        result['calls'] += 1
        try:
            reply = llm.complete([{'role': 'user', 'content': prompt}], tier='fast', max_tokens=1500, temperature=0)
        except llm.LLMUnavailable as exc:
            result['stopped'] = f'model unavailable: {exc}'
            logger.warning('assistant gap grouping stopped: %s', exc)
            break
        except Exception:
            result['stopped'] = 'model call failed'
            logger.exception('assistant gap grouping failed')
            break

        assignment = _parse(reply.content, len(batch))
        if dry_run:
            result['plan'] += [{'summary': batch[n - 1], 'label': lab} for n, (lab, _d) in sorted(assignment.items())]
            continue
        cache = {}
        with transaction.atomic():
            for n, (label, description) in assignment.items():
                group = _get_group(label, description, cache)
                if group:
                    result['assigned_rows'] += AgentGap.objects.filter(pk__in=pending[batch[n - 1]], group__isnull=True).update(group=group)
    return result


def run(dry_run=False):
    """The whole weekly job. Returns what happened, for the log and the manual command."""
    rules = 0 if dry_run else group_by_rules()
    out = group_text_rows(dry_run=dry_run)
    out['rule_rows'] = rules
    return out
