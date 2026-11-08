"""Parent-communication tools: per-student / per-class lookups and message drafting.

`draft_message` only returns text for the user to review. Actually sending to parents is a
write and arrives with the approval flow (Phase 4).
"""
from ..registry import ADMINS, Tool, register

_STUDENT = {'student_id': {'type': 'integer', 'description': 'From find_student'}}
_CLASS = {'class_id': {'type': 'integer', 'description': 'From find_class'}}

# name -> (description, properties, required)
_SPECS = {
    'get_student_info': ('Student details: class, parent contact, attendance rate, fee status.', _STUDENT, ['student_id']),
    # Renamed: Academics already has a get_class_info that takes a class *name*.
    'get_class_overview': ('Class details by class_id: student count and teacher.', _CLASS, ['class_id']),
    'get_attendance_summary': ('Attendance summary for one student or a whole class.', {**_STUDENT, **_CLASS}, []),
    'get_fee_status': ("A student's fee payment status.", _STUDENT, ['student_id']),
    'draft_message': ('Draft a message to parents. Returns text for the user to review; it does not send anything.',
                      {'type': {'type': 'string', 'enum': ['absence_followup', 'fee_reminder', 'meeting_invite', 'progress_update', 'circular']},
                       'recipient': {'type': 'string', 'description': 'Parent name or "all parents"'},
                       'context': {'type': 'string', 'description': 'Extra details to include'}}, ['type']),
    'get_exam_performance': ("A student's exam marks, grades and pass/fail.", _STUDENT, ['student_id']),
    'get_assignment_status': ("A student's assignments: pending, submitted, graded, with feedback.", _STUDENT, ['student_id']),
    'get_detailed_attendance': ('Day-by-day attendance for the last N days, with absence dates.',
                                {**_STUDENT, 'days': {'type': 'integer', 'minimum': 1, 'maximum': 365}}, ['student_id']),
    'get_transport_status': ("A student's transport route, stop and recent boarding records.", _STUDENT, ['student_id']),
    'get_class_teacher_info': ('Subject teachers assigned to a class.', _CLASS, ['class_id']),
    'get_communication_preferences': ("A parent's notification channel preferences (opt-in/out).", _STUDENT, ['student_id']),
    'get_leave_requests': ('Pending/approved leave requests for a student.', _STUDENT, ['student_id']),
    'get_financial_aid_status': ('Scholarships and discounts applied to a student.', _STUDENT, ['student_id']),
    'get_notification_history': ('Notifications already sent for a student.', _STUDENT, ['student_id']),
    'get_curriculum_progress': ('Recent and upcoming lessons for a class.',
                                {**_CLASS, 'subject_id': {'type': 'integer'}}, ['class_id']),
}


_LEGACY_NAME = {'get_class_overview': 'get_class_info'}


def _make_handler(tool_name):
    legacy_name = _LEGACY_NAME.get(tool_name, tool_name)

    def handler(ctx, **params):
        from notifications.ai_agent import ParentCommunicationAgent
        out = ParentCommunicationAgent(ctx.school_id)._execute_tool(legacy_name, params)
        # The old agent reports failures as plain strings; the registry expects an exception.
        if isinstance(out, str) and out.startswith(('Error:', 'Unknown tool')):
            raise RuntimeError(out)
        return out
    return handler


for _name, (_desc, _props, _required) in _SPECS.items():
    register(Tool(
        name=_name,
        description=_desc,
        parameters={'type': 'object', 'properties': _props, 'required': _required, 'additionalProperties': False},
        handler=_make_handler(_name),
        sub_agent='communication',
        module='notifications',
        roles=ADMINS,
    ))
