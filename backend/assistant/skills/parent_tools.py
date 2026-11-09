"""Aura for parents (sub-agent `family`): read-only views of their own children, the same data the parent portal shows.

Every read goes through the parent portal's own Child* views as the signed-in parent, so the rule "a parent only reaches their linked
children" is the app's, not ours. Parents get no write tools at all (owner decision 2026-11-07; the registry also refuses it).
Left out: paying fees, applying for leave, sending messages to the school - those stay on the portal.
"""
from ..internal_api import call
from ..registry import ProposalError, Tool, register
from . import lms_common as lc
from .student_tools import _fail, _items

ROLES = ('PARENT',)
LIST_LIMIT = 40


def _links(ctx):
    from parents.models import ParentChild
    return list(ParentChild.objects.filter(school_id=ctx.school_id, parent__user_id=ctx.user.id).select_related('student'))


def _child(ctx, child_id=None, child_name=None):
    """The one child the question is about; with a single child no question is needed."""
    links = _links(ctx)
    if not links:
        raise ProposalError('No children are linked to your account at this school yet. The school office can link them.')
    if child_id:
        hit = [l for l in links if l.student_id == int(child_id)]
        if not hit:
            raise ProposalError('That child is not linked to your account.')
        return hit[0].student
    if child_name:
        want = lc.tokens(child_name)
        hit = [l for l in links if all(w in lc.tokens(l.student.name) for w in want)]
        if len(hit) == 1:
            return hit[0].student
        if not hit:
            raise ProposalError('None of your children matches "' + child_name + '": ' + ', '.join(l.student.name for l in links))
    if len(links) == 1:
        return links[0].student
    raise ProposalError('Which child? ' + ', '.join(f'{l.student.name} (child_id {l.student_id})' for l in links) + '. Ask the parent.')


def _trim(body):
    if isinstance(body, list):
        return {'count': len(body), 'items': body[:LIST_LIMIT], **({'note': f'Showing the first {LIST_LIMIT}.'} if len(body) > LIST_LIMIT else {})}
    if isinstance(body, dict):
        for key, val in list(body.items()):
            if isinstance(val, list) and len(val) > LIST_LIMIT:
                body[key] = val[:LIST_LIMIT]
                body['note'] = f'Lists are cut to {LIST_LIMIT} items.'
    return body


def _child_view(view_name, label):
    def handler(ctx, child_id=None, child_name=None, **params):
        import parents.views as pv

        st = _child(ctx, child_id, child_name)
        status, body = call(ctx.user, ctx.school_id, getattr(pv, view_name), None, 'get', f'/api/parents/children/{st.id}/', params, student_id=st.id)
        if status == 403:
            raise ProposalError('That child is not linked to your account.')
        if status != 200:
            raise ProposalError(_fail(body, f'Could not read {label}.'))
        return {'child': st.name, **(_trim(body) if isinstance(body, dict) else _trim(body))}
    return handler


def get_my_children(ctx):
    from parents.serializers import ParentChildSerializer

    data = ParentChildSerializer(_links(ctx), many=True).data
    return {'children': [{'child_id': d['student'], 'name': d['student_name'], 'class': d.get('class_name'), 'roll': d.get('student_roll_number'),
                          'school': d['school_name'], 'relation': d.get('relation')} for d in data]}


def get_child_leave_requests(ctx, child_id=None, child_name=None):
    from parents.views import ParentLeaveRequestViewSet

    st = _child(ctx, child_id, child_name)
    status, body = call(ctx.user, ctx.school_id, ParentLeaveRequestViewSet, {'get': 'list'}, 'get', '/api/parents/leave-requests/', {'page_size': 50})
    if status != 200:
        raise ProposalError(_fail(body, 'Could not read the leave requests.'))
    rows = [r for r in _items(body) if r.get('student') == st.id]
    return {'child': st.name, **_trim(rows)}


def get_child_homework(ctx, child_id=None, child_name=None, status=None):
    from students.study_helper_service import StudyHelperService

    st = _child(ctx, child_id, child_name)
    out = StudyHelperService(st, st.school)._execute_tool('get_my_assignments', {'status': status} if status else {})
    return {'child': st.name, **(out if isinstance(out, dict) else {'items': out})}


def get_my_message_threads(ctx):
    from parents.views import ParentMessageViewSet

    status, body = call(ctx.user, ctx.school_id, ParentMessageViewSet, {'get': 'list_threads'}, 'get', '/api/parents/messages/threads/')
    if status != 200:
        raise ProposalError(_fail(body, 'Could not read your messages.'))
    return _trim(body)


_O = {'additionalProperties': False}
_CHILD = {'child_id': {'type': 'integer', 'description': 'From get_my_children'}, 'child_name': {'type': 'string'}}


def _reg(name, desc, props, handler):
    register(Tool(name=name, description=desc, parameters={'type': 'object', **_O, 'properties': props}, handler=handler,
                  sub_agent='family', module=None, roles=ROLES))


_reg('get_my_children', 'The children linked to this parent account: name, class, roll number, school.', {}, get_my_children)
_reg('get_child_overview', "One child's dashboard: attendance summary, fees outstanding, latest and next exam, today's status, pending leave.", dict(_CHILD),
     _child_view('ChildOverviewView', 'the overview'))
_reg('get_child_attendance', "A child's attendance records; optional month and year.", {**_CHILD, 'month': {'type': 'integer'}, 'year': {'type': 'integer'}},
     _child_view('ChildAttendanceView', 'attendance'))
_reg('get_child_fees', "A child's fee records and what is still owed.", dict(_CHILD), _child_view('ChildFeesView', 'the fees'))
_reg('get_child_timetable', "A child's class timetable.", dict(_CHILD), _child_view('ChildTimetableView', 'the timetable'))
_reg('get_child_exam_schedule', "A child's upcoming exam dates.", dict(_CHILD), _child_view('ChildExamScheduleView', 'the exam schedule'))
_reg('get_child_exam_results', "A child's published exam results.", dict(_CHILD), _child_view('ChildExamResultsView', 'the results'))
_reg('get_child_library', "Books a child has borrowed, current and past.", dict(_CHILD), _child_view('ChildLibraryView', 'the library record'))
_reg('get_child_transport', "A child's bus route, stop and times.", dict(_CHILD), _child_view('ChildTransportView', 'the transport details'))
_reg('get_child_homework', "A child's homework, diary and assignments with their status (pending, submitted, graded) and teacher feedback.",
     {**_CHILD, 'status': {'type': 'string', 'enum': ['PENDING', 'SUBMITTED', 'GRADED']}}, get_child_homework)
_reg('get_child_leave_requests', "Leave requests this parent has sent for a child, with their status.", dict(_CHILD), get_child_leave_requests)
_reg('get_my_message_threads', "The parent's message threads with the school.", {}, get_my_message_threads)
