"""Assignment submissions through Aura (backlog item H): who has handed work in, who has not, grading and returning.

Reads and writes go through AssignmentSubmissionViewSet as the signed-in user, so teacher scoping (own classes and subjects), the module gate and the
mark limits of the app apply. Writes only PROPOSE a card; a person presses Approve.
"""
from django.utils import timezone

from ..internal_api import call
from ..registry import ADMINS, ProposalError, Tool, register
from . import lms_common as lc
from .student_tools import _fail, _items

READ_ROLES = ADMINS + ('MANAGER', 'TEACHER')
WRITE_ROLES = ADMINS + ('TEACHER',)
LIMIT = 60
MAX_ROWS = 60
_O = {'additionalProperties': False}
_A = {'assignment_id': {'type': 'integer', 'description': 'Exact id when known (from list_assignments)'},
      'title': {'type': 'string', 'description': 'Part of the assignment title'}, 'class_name': {'type': 'string'}, 'section': {'type': 'string'},
      'subject_name': {'type': 'string'}}


def _find_assignment(ctx, assignment_id=None, title=None, class_name=None, section=None, subject_name=None):
    """Exactly one assignment of this school (a teacher: one of their own), or a question listing the candidates."""
    from lms.models import Assignment

    qs = Assignment.objects.filter(school_id=ctx.school_id, is_active=True).select_related('subject', 'class_obj', 'session_class', 'teacher')
    if ctx.role == 'TEACHER':
        qs = qs.filter(teacher=lc.resolve_teacher(ctx))
    if assignment_id:
        hit = qs.filter(pk=int(assignment_id)).first()
        if not hit:
            raise ProposalError(f'No assignment with id {assignment_id}.')
        return hit
    if not (title or class_name or subject_name):
        raise ProposalError('Which assignment? Ask the user for its title, or the class and subject.')
    if class_name:
        sections = lc.find_sections(ctx, class_name, section)
        if not sections:
            raise ProposalError(f'No class matching "{class_name}" in the current academic year.')
        qs = qs.filter(class_obj_id__in={sc.class_obj_id for sc in sections})
        if section:
            qs = qs.filter(session_class__in=sections)
    if subject_name:
        qs = qs.filter(subject=lc.find_subject(ctx, subject_name))
    pool = list(qs.order_by('-created_at')[:200])
    if title:
        want = lc.tokens(title)
        pool = [a for a in pool if all(w in lc.tokens(a.title) for w in want)]
    if not pool:
        raise ProposalError('No assignment matches that. Check the title, class or subject with the user.')
    if len(pool) > 1:
        raise ProposalError('Several assignments match: ' + '; '.join(
            f'{a.title} ({lc.section_label(a.session_class) if a.session_class_id else a.class_obj.name}, {a.subject.name}, due {a.due_date.date() if a.due_date else "no date"}, id {a.id})'
            for a in pool[:8]) + '. Ask which one.')
    return pool[0]


def _label(a):
    return f'{a.title} ({lc.section_label(a.session_class) if a.session_class_id else a.class_obj.name}, {a.subject.name})'


def _submissions(ctx, assignment, **params):
    from lms.views import AssignmentSubmissionViewSet

    code, body = call(ctx.user, ctx.school_id, AssignmentSubmissionViewSet, {'get': 'list'}, 'get', '/api/lms/submissions/',
                      {'assignment_id': assignment.id, 'page_size': 500, **params})
    if code != 200:
        raise ProposalError(_fail(body, 'Could not read the submissions.'))
    return _items(body)


def _roster(ctx, assignment):
    """{student_id: name} of the section (or class) the assignment is for, from this year's enrolments."""
    from academic_sessions.roster import enrollments_in_scope

    enrollments = enrollments_in_scope(ctx.school_id, academic_year_id=assignment.academic_year_id,
                                       session_class_id=assignment.session_class_id, class_obj_id=assignment.class_obj_id)
    if enrollments is not None:
        return {e.student_id: e.student.name for e in enrollments.select_related('student')}
    from students.models import Student
    return {s.id: s.name for s in Student.objects.filter(school_id=ctx.school_id, class_obj_id=assignment.class_obj_id, is_active=True)}


# ── reads ────────────────────────────────────────────────────────────────────

def list_submissions(ctx, assignment_id=None, title=None, class_name=None, section=None, subject_name=None, status=None):
    a = _find_assignment(ctx, assignment_id, title, class_name, section, subject_name)
    rows = _submissions(ctx, a, **({'status': status} if status else {}))
    counts = {}
    for r in rows:
        counts[r.get('status')] = counts.get(r.get('status'), 0) + 1
    return {'assignment': _label(a), 'assignment_id': a.id, 'total_marks': float(a.total_marks) if a.total_marks is not None else None,
            'due': a.due_date, 'by_status': counts, 'count': len(rows),
            'submissions': [{'submission_id': r['id'], 'student': r.get('student_name'), 'status': r.get('status'), 'submitted': str(r.get('submitted_at') or '')[:16],
                             'marks': r.get('marks_obtained'), 'feedback': (r.get('feedback') or '')[:150]} for r in rows[:LIMIT]],
            **({'note': f'Showing the first {LIMIT}.'} if len(rows) > LIMIT else {})}


def get_missing_submissions(ctx, assignment_id=None, title=None, class_name=None, section=None, subject_name=None):
    a = _find_assignment(ctx, assignment_id, title, class_name, section, subject_name)
    roster = _roster(ctx, a)
    done = {r.get('student') for r in _submissions(ctx, a)}
    missing = sorted(name for sid, name in roster.items() if sid not in done)
    return {'assignment': _label(a), 'assignment_id': a.id, 'due': a.due_date, 'class_size': len(roster), 'submitted': len(roster) - len(missing),
            'not_submitted': len(missing), 'students': missing[:LIMIT], **({'note': f'Showing the first {LIMIT}.'} if len(missing) > LIMIT else {})}


# ── writes: grade and return ─────────────────────────────────────────────────

def _subs_by_student(ctx, a):
    from lms.models import AssignmentSubmission

    return {s.student_id: s for s in AssignmentSubmission.objects.filter(school_id=ctx.school_id, assignment=a).select_related('student')}


def _grade_card(ctx, payload):
    from lms.models import Assignment

    a = Assignment.objects.filter(school_id=ctx.school_id, pk=payload['assignment'], is_active=True).select_related('subject', 'class_obj', 'session_class').first()
    if a is None:
        raise ProposalError('That assignment no longer exists.')
    subs = {s.id: s for s in _subs_by_student(ctx, a).values()}
    rows, warnings, total = [], [], a.total_marks
    for r in payload['rows']:
        s = subs.get(r['key'])
        if s is None:
            warnings.append(f'Submission {r["key"]} no longer exists - removed.')
            continue
        try:
            marks = float(r['marks'])
        except (TypeError, ValueError):
            raise ProposalError(f'"{r["marks"]}" is not a valid mark for {s.student.name}.')
        if marks < 0:
            raise ProposalError(f'Marks cannot be negative ({s.student.name}).')
        if total is not None and marks > float(total):
            raise ProposalError(f'{s.student.name}: {marks:g} is above the total of {float(total):g}.')
        rows.append({'key': s.id, 'student': s.student.name, 'status': s.status, 'was': float(s.marks_obtained) if s.marks_obtained is not None else None,
                     'marks': marks, 'feedback': (r.get('feedback') or '')[:300]})
    if not rows:
        raise ProposalError('Nothing to grade.')
    regrade = sum(1 for r in rows if r['was'] is not None)
    if regrade:
        warnings.append(f'{regrade} of these already have marks; they will be overwritten.')
    return {'payload': {'kind': 'grade_submissions', 'assignment': a.id, 'rows': [{'key': r['key'], 'marks': r['marks'], 'feedback': r['feedback']} for r in rows]},
            'preview': {'kind': 'grade_submissions', 'title': 'Grade submissions', 'summary': f'{len(rows)} student(s) - {_label(a)}',
                        'columns': ['Student', 'Now', 'Marks', 'Feedback'], 'rows': rows, 'totals': {'count': len(rows), 'out_of': float(total) if total is not None else None},
                        'warnings': warnings, 'editable': {'remove_keys': True, 'amounts': True}}}


def grade_submissions(ctx, grades=None, assignment_id=None, title=None, class_name=None, section=None, subject_name=None, default_feedback=None):
    a = _find_assignment(ctx, assignment_id, title, class_name, section, subject_name)
    if not grades:
        raise ProposalError('Whose marks, and how many? Ask the user (a name or student_id with marks for each).')
    if len(grades) > MAX_ROWS:
        raise ProposalError(f'That is {len(grades)} students; please do at most {MAX_ROWS} at a time.')
    by_student = _subs_by_student(ctx, a)
    people = {sid: s.student.name for sid, s in by_student.items()}
    roster = _roster(ctx, a)
    rows = []
    for g in grades:
        if g.get('marks') is None:
            raise ProposalError('Every student needs marks. Ask the user.')
        if g.get('student_id') is None and not g.get('student_name'):
            raise ProposalError('Each entry needs a student_name or student_id.')
        # "Hasn't handed in" and "unknown name" are different answers for a teacher.
        name = g.get('student_name')
        if name and not any(all(w in lc.tokens(n) for w in lc.tokens(name, drop_honorifics=True)) for n in people.values()):
            if any(all(w in lc.tokens(n) for w in lc.tokens(name, drop_honorifics=True)) for n in roster.values()):
                raise ProposalError(f'{name} has not submitted this assignment yet, so there is nothing to grade.')
        ids = lc.match_names(people, [name] if name else None, [g['student_id']] if g.get('student_id') is not None else None, ' who submitted')
        sid = next(iter(ids))
        rows.append({'key': by_student[sid].id, 'marks': g['marks'], 'feedback': g.get('feedback') or default_feedback or ''})
    return _grade_card(ctx, {'kind': 'grade_submissions', 'assignment': a.id, 'rows': rows})


def revise_grade(ctx, payload, edits):
    # The screen sends row ids as JSON keys (strings); the stored keys are integers.
    as_key = lambda k: int(k) if str(k).isdigit() else k
    keys = {r['key'] for r in payload['rows']}
    amounts = {as_key(k): v for k, v in (edits.get('amounts') or {}).items()}
    remove = {as_key(k) for k in (edits.get('remove_keys') or [])}
    unknown = (remove | set(amounts)) - keys
    if unknown:
        raise ProposalError('Rows not on this card: ' + ', '.join(str(k) for k in sorted(unknown, key=str)))
    rows = [{**r, 'marks': amounts.get(r['key'], r['marks'])} for r in payload['rows'] if r['key'] not in remove]
    return _grade_card(ctx, {**payload, 'rows': rows})


def apply_grade(ctx, payload):
    from lms.views import AssignmentSubmissionViewSet

    done, errors = 0, []
    for r in payload['rows']:
        code, body = call(ctx.user, ctx.school_id, AssignmentSubmissionViewSet, {'patch': 'grade'}, 'patch', f"/api/lms/submissions/{r['key']}/grade/",
                          {'marks_obtained': r['marks'], 'feedback': r.get('feedback', '')}, pk=r['key'])
        if code == 200:
            done += 1
        else:
            errors.append({'submission': r['key'], 'error': _fail(body, 'Could not be graded.')})
    return {'ok': done > 0, 'updated': done, 'failed': len(errors), 'errors': errors,
            **({} if done else {'error': 'No submission could be graded: ' + (errors[0]['error'] if errors else '')})}


def _return_card(ctx, payload):
    from lms.models import Assignment, AssignmentSubmission

    a = Assignment.objects.filter(school_id=ctx.school_id, pk=payload['assignment'], is_active=True).select_related('subject', 'class_obj', 'session_class').first()
    if a is None:
        raise ProposalError('That assignment no longer exists.')
    qs = AssignmentSubmission.objects.filter(school_id=ctx.school_id, assignment=a, status='GRADED', id__in=payload['ids']).select_related('student')
    rows = [{'key': s.id, 'student': s.student.name, 'marks': float(s.marks_obtained) if s.marks_obtained is not None else None} for s in qs.order_by('student__name')]
    if not rows:
        raise ProposalError('Nothing to return: only graded work can be returned.')
    return {'payload': {'kind': 'return_submissions', 'assignment': a.id, 'ids': [r['key'] for r in rows]},
            'preview': {'kind': 'return_submissions', 'title': 'Return graded work', 'summary': f'{len(rows)} student(s) - {_label(a)}',
                        'columns': ['Student', 'Marks'], 'rows': rows, 'totals': {'count': len(rows)}, 'warnings': [], 'editable': {'remove_keys': True}}}


def return_submissions(ctx, assignment_id=None, title=None, class_name=None, section=None, subject_name=None, student_names=None):
    a = _find_assignment(ctx, assignment_id, title, class_name, section, subject_name)
    graded = {sid: s for sid, s in _subs_by_student(ctx, a).items() if s.status == 'GRADED'}
    if not graded:
        raise ProposalError('No graded work to return for this assignment.')
    if student_names:
        ids = lc.match_names({sid: s.student.name for sid, s in graded.items()}, student_names, None, ' with graded work')
        graded = {sid: s for sid, s in graded.items() if sid in ids}
    return _return_card(ctx, {'assignment': a.id, 'ids': [s.id for s in graded.values()][:MAX_ROWS * 2]})


def revise_return(ctx, payload, edits):
    remove = {int(k) if str(k).isdigit() else k for k in (edits.get('remove_keys') or [])}
    return _return_card(ctx, {**payload, 'ids': [i for i in payload['ids'] if i not in remove]})


def apply_return(ctx, payload):
    from lms.views import AssignmentSubmissionViewSet

    done, errors = 0, []
    for sid in payload['ids']:
        code, body = call(ctx.user, ctx.school_id, AssignmentSubmissionViewSet, {'post': 'return_to_student'}, 'post', f'/api/lms/submissions/{sid}/return/', {}, pk=sid)
        if code == 200:
            done += 1
        else:
            errors.append({'submission': sid, 'error': _fail(body, 'Could not be returned.')})
    return {'ok': done > 0, 'updated': done, 'failed': len(errors), 'errors': errors,
            **({} if done else {'error': 'Nothing could be returned: ' + (errors[0]['error'] if errors else '')})}


register(Tool(name='list_submissions', description='Who has handed in an assignment and their status, marks and feedback. Name the assignment by title, or by class and subject.',
              parameters={'type': 'object', **_O, 'properties': {**_A, 'status': {'type': 'string', 'enum': ['SUBMITTED', 'LATE', 'GRADED', 'RETURNED']}}},
              handler=list_submissions, sub_agent='academics', module='lms', roles=READ_ROLES))
register(Tool(name='get_missing_submissions', description='Which students of the class have NOT handed in an assignment yet, with the counts.',
              parameters={'type': 'object', **_O, 'properties': dict(_A)}, handler=get_missing_submissions, sub_agent='academics', module='lms', roles=READ_ROLES))
register(Tool(name='grade_submissions',
              description='PREPARE marks and feedback for students who submitted one assignment ("Ali ko 8, Sara ko 9"). Marks above the total are refused. '
                          'Nothing is saved until the user approves.',
              parameters={'type': 'object', **_O, 'properties': {**_A, 'grades': {'type': 'array', 'items': {'type': 'object', **_O, 'properties': {
                  'student_name': {'type': 'string'}, 'student_id': {'type': 'integer'}, 'marks': {'type': 'number'}, 'feedback': {'type': 'string'}}}},
                  'default_feedback': {'type': 'string', 'description': 'Used for students given no feedback of their own'}}},
              handler=grade_submissions, sub_agent='academics', module='lms', roles=WRITE_ROLES, kind='write', revise=revise_grade, apply=apply_grade))
register(Tool(name='return_submissions', description='PREPARE sending graded work back to the students (all graded ones, or the named students). Nothing changes until the user approves.',
              parameters={'type': 'object', **_O, 'properties': {**_A, 'student_names': {'type': 'array', 'items': {'type': 'string'}}}},
              handler=return_submissions, sub_agent='academics', module='lms', roles=WRITE_ROLES, kind='write', revise=revise_return, apply=apply_return))
