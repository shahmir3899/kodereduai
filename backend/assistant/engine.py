"""Proposal engine: the only way the assistant changes data.

    model asks for a write -> create_proposal (nothing changes)
    user sees the preview card -> edit (optional, repeatable) -> approve | reject
    approve -> tool.apply() calls the real API as the user

Rules enforced here, for every write tool:
  * only the user who was shown the card can act on it, in the same school
  * a proposal expires (15 min) and can be approved once
  * at approval the preview is rebuilt from the database; if it no longer matches what the user
    saw (a fee was paid meanwhile, an amount changed) nothing runs and they see the new card
  * the role is checked again at approval time, not just when the model proposed
"""
import json
import logging
import uuid
from datetime import timedelta

from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.utils import timezone

from . import registry
from .models import AgentAction

logger = logging.getLogger(__name__)

EXPIRY = timedelta(minutes=15)
OPEN = (AgentAction.Status.PENDING, AgentAction.Status.EDITED)


class ActionError(Exception):
    def __init__(self, message, status=400, code='error', extra=None):
        super().__init__(message)
        self.message, self.status, self.code, self.extra = message, status, code, extra or {}


def _jsonable(data):
    return json.loads(json.dumps(data, cls=DjangoJSONEncoder))


def _ctx_for(action, user):
    role = user.get_role_for_school(action.school_id)
    if not role and user.role not in registry.NO_WRITE_ROLES:
        role = user.role
    return registry.ToolContext(user=user, school_id=action.school_id, role=role, conversation=action.conversation)


def create_proposal(ctx, tool, args) -> AgentAction:
    built = tool.handler(ctx, **args)           # may raise registry.ProposalError
    payload, preview = _jsonable(built['payload']), _jsonable(built['preview'])

    # A model that repeats itself must not stack identical cards.
    for open_action in AgentAction.objects.filter(
        school_id=ctx.school_id, user=ctx.user, conversation=ctx.conversation, tool_name=tool.name,
        status__in=OPEN, expires_at__gt=timezone.now(),
    )[:20]:
        if open_action.payload == payload:
            return open_action

    return AgentAction.objects.create(
        school_id=ctx.school_id, user=ctx.user, conversation=ctx.conversation,
        sub_agent=tool.sub_agent, tool_name=tool.name, payload=payload, preview=preview,
        idempotency_key=uuid.uuid4().hex, expires_at=timezone.now() + EXPIRY,
    )


def serialize(action: AgentAction) -> dict:
    return {
        'id': action.id,
        'tool': action.tool_name,
        'sub_agent': action.sub_agent,
        'status': action.status,
        'preview': action.preview,
        'result': action.result,
        'error': action.error,
        'expires_at': action.expires_at,
        'created_at': action.created_at,
        'can_act': action.status in OPEN and action.expires_at > timezone.now(),
    }


def _load(pk, user, school_id, lock=False):
    qs = AgentAction.objects.all()
    if lock:
        qs = qs.select_for_update()
    try:
        action = qs.get(pk=pk, school_id=school_id, user=user)   # not yours -> same as missing
    except AgentAction.DoesNotExist:
        raise ActionError('Action not found.', status=404, code='not_found')
    if action.status in OPEN and action.expires_at <= timezone.now():
        action.status = AgentAction.Status.EXPIRED
        action.save(update_fields=['status'])
    return action


def _open_tool_and_ctx(action, user):
    if action.status not in OPEN:
        raise ActionError(f'This action is already {action.status}.', status=409, code=action.status)
    tool = registry.get_tool(action.tool_name)
    ctx = _ctx_for(action, user)
    if tool is None or tool.kind != 'write' or not registry.is_allowed(tool, ctx):
        raise ActionError('You no longer have permission for this action.', status=403, code='forbidden')
    return tool, ctx


def get_action(pk, user, school_id) -> AgentAction:
    return _load(pk, user, school_id)


def _transition(pk, user, school_id, body):
    """Run `body(action, tool, ctx)` under a row lock. An ActionError raised by the body (or by
    the checks) is re-raised only AFTER the transaction commits, so state the engine changed on
    the way - a card marked expired, a card refreshed because the data moved - is kept."""
    failure = None
    action = None
    with transaction.atomic():
        try:
            action = _load(pk, user, school_id, lock=True)
            tool, ctx = _open_tool_and_ctx(action, user)
            body(action, tool, ctx)
        except ActionError as exc:
            failure = exc
    if failure:
        raise failure
    return action, tool, ctx


def edit(pk, user, school_id, edits: dict) -> AgentAction:
    def body(action, tool, ctx):
        try:
            built = tool.revise(ctx, action.payload, edits or {})
        except registry.ProposalError as exc:
            raise ActionError(str(exc), code='invalid_edit')
        action.payload, action.preview = _jsonable(built['payload']), _jsonable(built['preview'])
        action.status = AgentAction.Status.EDITED
        action.expires_at = timezone.now() + EXPIRY
        action.save(update_fields=['payload', 'preview', 'status', 'expires_at'])

    return _transition(pk, user, school_id, body)[0]


def reject(pk, user, school_id) -> AgentAction:
    def body(action, tool, ctx):
        action.status = AgentAction.Status.REJECTED
        action.decided_at = timezone.now()
        action.save(update_fields=['status', 'decided_at'])

    return _transition(pk, user, school_id, body)[0]


def approve(pk, user, school_id) -> AgentAction:
    def body(action, tool, ctx):
        try:
            fresh = tool.revise(ctx, action.payload, {})
        except registry.ProposalError as exc:
            raise ActionError(str(exc), status=409, code='changed')
        fresh_payload = _jsonable(fresh['payload'])
        if fresh_payload != action.payload:
            action.payload, action.preview = fresh_payload, _jsonable(fresh['preview'])
            action.status = AgentAction.Status.EDITED
            action.save(update_fields=['payload', 'preview', 'status'])
            raise ActionError(
                'The data changed since this card was prepared. Review the updated card and approve again.',
                status=409, code='changed', extra={'action': serialize(action)},
            )
        # Committed before the call so a double click or retry cannot run it twice.
        action.status = AgentAction.Status.APPROVED
        action.decided_at = timezone.now()
        action.save(update_fields=['status', 'decided_at'])

    action, tool, ctx = _transition(pk, user, school_id, body)

    try:
        result = _jsonable(tool.apply(ctx, action.payload))
    except Exception as exc:
        logger.error('assistant action %s failed: %s', action.pk, exc, exc_info=True)
        action.status, action.error = AgentAction.Status.FAILED, str(exc)[:1000]
        action.save(update_fields=['status', 'error'])
        return action

    action.result = result
    action.executed_at = timezone.now()
    if result.get('ok', True):
        action.status = AgentAction.Status.EXECUTED
    else:
        action.status, action.error = AgentAction.Status.FAILED, str(result.get('error', ''))[:1000]
    action.save(update_fields=['result', 'executed_at', 'status', 'error'])
    return action


def pending_for(user, school_id):
    now = timezone.now()
    AgentAction.objects.filter(school_id=school_id, user=user, status__in=OPEN, expires_at__lte=now).update(
        status=AgentAction.Status.EXPIRED)
    return AgentAction.objects.filter(school_id=school_id, user=user, status__in=OPEN)
