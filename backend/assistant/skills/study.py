"""Study Helper tools. Each one answers only about the logged-in student.

The student is resolved from the user, never from an argument, so there is no way to
ask for another student's marks. Daily limits and content filters live in guards.py.
"""
from ..registry import Tool, register

_SUBJECT = {'subject_name': {'type': 'string'}}

# name -> (description, properties)
_SPECS = {
    'get_my_marks': ('Exam marks and grades.', {'exam_name': {'type': 'string'}, **_SUBJECT}),
    'get_my_assignments': ('Assignment status and feedback.',
                           {'status': {'type': 'string', 'enum': ['PENDING', 'SUBMITTED', 'GRADED']}}),
    'get_topic_details': ('Curriculum topics from the textbooks.', _SUBJECT),
    'get_my_attendance': ('Attendance record.', {'days': {'type': 'integer', 'minimum': 1, 'maximum': 365}}),
    'get_exam_schedule': ('Upcoming exam dates.', {}),
    'get_lesson_materials': ('Lesson attachments and resources.', _SUBJECT),
    'get_grade_targets': ('Grade boundaries and the marks needed for each grade.', _SUBJECT),
    'get_teacher_feedback': ('Feedback from graded assignments.', {}),
}


def _make_handler(tool_name):
    def handler(ctx, **params):
        from students.study_helper_service import StudyHelperService
        try:
            student = ctx.user.student_profile.student
        except Exception:
            raise RuntimeError('No student profile is linked to this account.')
        if student.school_id != ctx.school_id:
            raise RuntimeError('This student does not belong to the active school.')
        return StudyHelperService(student, student.school)._execute_tool(tool_name, params)
    return handler


for _name, (_desc, _props) in _SPECS.items():
    register(Tool(
        name=_name,
        description=_desc,
        parameters={'type': 'object', 'properties': _props, 'additionalProperties': False},
        handler=_make_handler(_name),
        sub_agent='study',
        module=None,          # the student portal is not a school module
        roles=('STUDENT',),
    ))
