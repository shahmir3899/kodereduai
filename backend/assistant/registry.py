"""Tool registry: one place that knows every tool, who may see it and how it is audited.

The model is never the security boundary. `tools_for` hides tools a user may not use,
and `execute` re-checks the same rules before running anything.

Two kinds of tool:
  read   `handler(ctx, **args)` runs immediately and returns data.
  write  never runs from the model. `handler` only PROPOSES (validates, builds the preview
         card); a human approves, and only then does `apply` call the real API.
"""
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from django.core.serializers.json import DjangoJSONEncoder

logger = logging.getLogger(__name__)

ADMINS = ('SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL')
FINANCE_ROLES = ADMINS + ('ACCOUNTANT',)

# Parents and students never get write tools, whatever a tool declares.
NO_WRITE_ROLES = ('PARENT', 'STUDENT')

# Keeps one runaway tool result from filling the model's context.
MAX_RESULT_CHARS = 12000


class ProposalError(Exception):
    """A write proposal cannot be built; `str(exc)` goes back to the model so it can ask the user."""


@dataclass
class ToolContext:
    user: Any
    school_id: int
    role: Optional[str]
    conversation: Any = None
    _school: Any = field(default=None, repr=False)

    @property
    def school(self):
        if self._school is None:
            from schools.models import School
            self._school = School.objects.select_related('organization').get(pk=self.school_id)
        return self._school


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    parameters: dict            # JSON schema for the arguments
    handler: Callable           # read: handler(ctx, **args) -> data;  write: propose(ctx, **args) -> {'payload','preview'}
    sub_agent: str              # chip shown in the UI: 'finance', 'academics', ...
    module: Optional[str]       # school module that must be enabled (None = no module gate)
    roles: tuple                # roles that may use the tool
    kind: str = 'read'
    # Lookup helpers (find_student...) ride along with whichever sub-agent the router picks.
    shared: bool = False
    # write tools only:
    revise: Optional[Callable] = None   # revise(ctx, payload, edits) -> {'payload','preview'}; re-reads the DB
    apply: Optional[Callable] = None    # apply(ctx, payload) -> result dict; calls the real API

    def spec(self):
        return {
            'type': 'function',
            'function': {
                'name': self.name,
                'description': self.description,
                'parameters': self.parameters,
            },
        }


_TOOLS: dict = {}


def register(tool: Tool):
    if tool.kind == 'write':
        if not (tool.revise and tool.apply):
            raise ValueError(f'{tool.name}: a write tool needs revise and apply')
        if set(tool.roles) & set(NO_WRITE_ROLES):
            raise ValueError(f'{tool.name}: parents and students cannot have write tools')
    elif tool.kind != 'read':
        raise ValueError(f'{tool.name}: unknown kind {tool.kind}')
    if tool.name in _TOOLS:
        raise ValueError(f'duplicate tool {tool.name}')
    _TOOLS[tool.name] = tool


def clear():
    _TOOLS.clear()


def all_tools():
    return list(_TOOLS.values())


def get_tool(name):
    return _TOOLS.get(name)


def is_allowed(tool: Tool, ctx: ToolContext) -> bool:
    if ctx.role not in tool.roles:
        return False
    if tool.kind == 'write' and ctx.role in NO_WRITE_ROLES:
        return False
    if not tool.module:
        return True
    try:
        return bool(ctx.school.get_enabled_module(tool.module))
    except Exception:
        return False


def tools_for(ctx: ToolContext):
    return [t for t in _TOOLS.values() if is_allowed(t, ctx)]


def _clean_args(tool: Tool, args):
    allowed = set((tool.parameters or {}).get('properties', {}))
    if not isinstance(args, dict):
        return {}, ['arguments must be an object']
    clean = {k: v for k, v in args.items() if k in allowed and v not in (None, '')}
    ignored = [k for k in args if k not in allowed]
    return clean, ignored


def _to_jsonable(data):
    return json.loads(json.dumps(data, cls=DjangoJSONEncoder))


def _gap(ctx, kind, tool):
    """Learning loop: remember that a tool was refused or crashed. Tool name only, never user text."""
    from . import gaps
    gaps.record_gap(ctx, kind, agent=tool.sub_agent, tool_hint=tool.name)


def execute(ctx: ToolContext, name: str, args) -> dict:
    """Run a tool for the model. Always returns a dict; errors become {'error': ...}
    so the model can correct itself instead of the whole turn failing.
    A write tool returns {'proposal': ...} and changes nothing."""
    from .models import AgentAuditLog

    tool = _TOOLS.get(name)
    started = time.monotonic()

    def audit(kind, ok, error='', clean=None):
        try:
            AgentAuditLog.objects.create(
                school_id=ctx.school_id, user=ctx.user, conversation=ctx.conversation,
                sub_agent=tool.sub_agent if tool else '', tool_name=name, kind=kind,
                args=clean if clean is not None else {}, ok=ok, error=error[:1000],
                duration_ms=int((time.monotonic() - started) * 1000),
            )
        except Exception:
            logger.exception('assistant audit log write failed')

    if tool is None:
        audit(AgentAuditLog.Kind.DENIED, False, 'unknown tool')
        return {'error': f'Unknown tool: {name}'}
    if not is_allowed(tool, ctx):
        audit(AgentAuditLog.Kind.DENIED, False, 'not permitted')
        _gap(ctx, 'denied', tool)
        return {'error': 'You do not have permission to use this tool.'}

    clean, ignored = _clean_args(tool, args)
    kind = AgentAuditLog.Kind.WRITE if tool.kind == 'write' else AgentAuditLog.Kind.READ

    if tool.kind == 'write':
        from . import engine
        try:
            action = engine.create_proposal(ctx, tool, clean)
        except ProposalError as exc:
            audit(kind, False, str(exc), clean)
            return {'error': str(exc)}
        except TypeError as exc:
            audit(kind, False, str(exc), clean)
            return {'error': f'Bad arguments for {name}: {exc}'}
        except Exception as exc:
            logger.error('assistant proposal %s failed: %s', name, exc, exc_info=True)
            audit(kind, False, str(exc), clean)
            _gap(ctx, 'tool_error', tool)
            return {'error': f'{name} failed. Tell the user it is unavailable.'}
        audit(kind, True, '', clean)
        return {
            'proposal': {'action_id': action.id, 'summary': (action.preview or {}).get('summary', '')},
            'status': 'awaiting_user_approval',
            'instruction': ('NOTHING has been changed. The user now sees a preview card with Approve, Edit '
                            'and Reject buttons. Tell them briefly what you prepared and to review the card. '
                            'Never say the change was made.'),
        }

    try:
        data = _to_jsonable(tool.handler(ctx, **clean))
    except ProposalError as exc:          # e.g. "which period?" - the model should ask the user
        audit(kind, False, str(exc), clean)
        return {'error': str(exc)}
    except TypeError as exc:
        audit(kind, False, str(exc), clean)
        return {'error': f'Bad arguments for {name}: {exc}'}
    except Exception as exc:
        logger.error('assistant tool %s failed: %s', name, exc, exc_info=True)
        audit(kind, False, str(exc), clean)
        _gap(ctx, 'tool_error', tool)
        return {'error': f'{name} failed. Try different arguments or tell the user it is unavailable.'}

    audit(kind, True, '', clean)
    result = {'data': data}
    if ignored:
        result['ignored_arguments'] = ignored
    if len(json.dumps(result)) > MAX_RESULT_CHARS:
        result = {'error': 'Result too large. Narrow the request with filters (class, month, dates).'}
    return result
