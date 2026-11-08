"""Academics tools: the 13 timetable queries of the old Academics chat.

Roles are narrower than the old view (which let any non-portal user ask anything):
schedules for admins, managers and teachers; analysis that exposes every teacher's
workload or proposes timetable changes for admins and managers only.
"""
from ..registry import ADMINS, Tool, register

SCHEDULE_ROLES = ADMINS + ('MANAGER', 'TEACHER')
PLANNING_ROLES = ADMINS + ('MANAGER',)

_DAY = {'type': 'string', 'enum': ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']}
_CLASS = {'type': 'string', 'description': 'Class name, e.g. "Class 4" or "4A"'}
_TEACHER = {'type': 'string', 'description': 'Teacher name; partial names are fine'}

# name -> (description, properties, required, roles)
_SPECS = {
    'get_class_schedule': ('Weekly timetable of a class.', {'class_name': _CLASS}, ['class_name'], SCHEDULE_ROLES),
    'get_teacher_schedule': ("A teacher's full weekly schedule.", {'teacher_name': _TEACHER}, ['teacher_name'], SCHEDULE_ROLES),
    'get_free_teachers': ('Teachers who are free on a day (optionally a period).',
                          {'day': _DAY, 'period': {'type': 'string', 'description': 'Period number or name'}}, ['day'], SCHEDULE_ROLES),
    'get_subject_schedule': ('When and where a subject is taught.',
                             {'subject_name': {'type': 'string'}, 'class_name': _CLASS}, ['subject_name'], SCHEDULE_ROLES),
    'get_workload_summary': ('Teacher workload overview; omit the name for all teachers.', {'teacher_name': _TEACHER}, [], PLANNING_ROLES),
    'get_class_info': ('Subjects and teachers assigned to a class.', {'class_name': _CLASS}, ['class_name'], SCHEDULE_ROLES),
    'get_quality_score': ('Score a class timetable (idle gaps, distribution, breaks, workload, constraints).',
                          {'class_name': _CLASS}, ['class_name'], PLANNING_ROLES),
    'find_substitute': ('Available substitute teachers for an absent teacher on a date.',
                        {'teacher_name': _TEACHER, 'date': {'type': 'string', 'description': 'YYYY-MM-DD'}},
                        ['teacher_name', 'date'], PLANNING_ROLES),
    'get_curriculum_gaps': ('Missing subjects, unmet period requirements, unassigned teachers; omit class for the whole school.',
                            {'class_name': _CLASS}, [], PLANNING_ROLES),
    'resolve_conflict': ('Alternative teachers, slots and swaps for a scheduling conflict.',
                         {'teacher_name': _TEACHER, 'day': _DAY, 'period': {'type': 'string'}, 'class_name': _CLASS},
                         ['teacher_name', 'day', 'period', 'class_name'], PLANNING_ROLES),
    'get_workload_analysis': ('Which teachers are overloaded or underloaded (whole school).', {}, [], PLANNING_ROLES),
    'get_room_usage': ('Room occupancy and availability.', {'room_name': {'type': 'string'}, 'day': _DAY}, [], SCHEDULE_ROLES),
    'compare_schedules': ('Side-by-side comparison of two classes or two teachers.',
                          {'class_name_1': _CLASS, 'class_name_2': _CLASS, 'teacher_name_1': _TEACHER, 'teacher_name_2': _TEACHER},
                          [], PLANNING_ROLES),
}


def _make_handler(tool_name):
    def handler(ctx, **params):
        from academics.ai_engine import AcademicsAIAgent
        return AcademicsAIAgent(ctx.school_id)._execute_tool(tool_name, params)
    return handler


for _name, (_desc, _props, _required, _roles) in _SPECS.items():
    register(Tool(
        name=_name,
        description=_desc,
        parameters={'type': 'object', 'properties': _props, 'required': _required, 'additionalProperties': False},
        handler=_make_handler(_name),
        sub_agent='academics',
        module='academics',
        roles=_roles,
    ))
