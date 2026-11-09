"""Exams through Aura: results, marks entry status, entering marks, creating / moving / deleting exams.

Every read and write goes through the same viewsets the web app uses (ExamViewSet, StudentMarkViewSet,
ExamSubjectViewSet), called as the signed-in user. So the teacher scope (class teacher, or the subject
teacher of that class), the "departed students get no marks" rule and the marks range check apply
unchanged. Writes only PROPOSE; a person presses Approve on the card.
"""
from datetime import date as date_cls
from decimal import Decimal, InvalidOperation

from ..internal_api import call
from ..registry import ADMINS, ProposalError, Tool, register
from . import lms_common as lc

READ_ROLES = ADMINS + ('TEACHER',)
MARK_WRITE_ROLES = ADMINS + ('TEACHER',)
EXAM_WRITE_ROLES = ADMINS
TOP_N = 5
LIST_LIMIT = 40


# ── plumbing ─────────────────────────────────────────────────────────────────

def _year_id(ctx):
    from academic_sessions.utils import resolve_current_academic_year_id
    year = resolve_current_academic_year_id(ctx.school_id)
    if not year:
        raise ProposalError('No current academic year is set for this school.')
    return year


def _items(body):
    if isinstance(body, dict) and 'results' in body:
        return body['results']
    return body if isinstance(body, list) else []


def _fail(body, fallback):
    return str((body or {}).get('detail') or (body or {}).get('error') or body or fallback)[:300]


def _exams(ctx, **params):
    from examinations.views import ExamViewSet

    p = {'academic_year': _year_id(ctx), 'include_marks_status': 'true', 'page_size': 200, **params}
    status, body = call(ctx.user, ctx.school_id, ExamViewSet, {'get': 'list'}, 'get', '/api/examinations/exams/', p)
    if status != 200:
        raise ProposalError(_fail(body, 'Could not read exams.'))
    return _items(body)


def _exam_subjects(ctx, exam_id):
    """Subjects of an exam this user may see (a subject teacher sees only theirs)."""
    from examinations.views import ExamSubjectViewSet

    status, body = call(ctx.user, ctx.school_id, ExamSubjectViewSet, {'get': 'list'}, 'get',
                        '/api/examinations/exam-subjects/', {'exam': exam_id, 'page_size': 200})
    if status != 200:
        raise ProposalError(_fail(body, 'Could not read the exam subjects.'))
    return _items(body)


def _describe(e):
    return f"{e['name']} ({e.get('class_name') or 'class ?'}, {e.get('status', '').replace('_', ' ').title()}, exam id {e['id']})"


def _find_exam(ctx, exam_id=None, exam_name=None, class_name=None, section=None):
    """Exactly one exam of the current year, or a ProposalError listing the candidates to ask about."""
    pool = _exams(ctx)
    if exam_id:
        hit = [e for e in pool if e['id'] == int(exam_id)]
        if not hit:
            raise ProposalError(f'No exam with id {exam_id} that you can work with.')
        return hit[0]
    if class_name:
        sections = lc.find_sections(ctx, class_name, section)
        if not sections:
            raise ProposalError(f'No class matching "{class_name}" in the current academic year.')
        section_ids = {sc.id for sc in sections}
        class_ids = {sc.class_obj_id for sc in sections}
        pool = [e for e in pool if e.get('session_class') in section_ids
                or (e.get('session_class') is None and e.get('class_obj') in class_ids)]
    if exam_name:
        want = lc.tokens(exam_name)
        pool = [e for e in pool if all(w in lc.tokens(f"{e['name']} {e.get('exam_type_name', '')}") for w in want)]
    if not pool:
        raise ProposalError('No exam matches that. Ask the user for the exam name and class.')
    if len(pool) > 1:
        raise ProposalError('Several exams match: ' + '; '.join(_describe(e) for e in pool[:8])
                            + '. Ask the user which one, then pass exam_id.')
    return pool[0]


def _find_exam_subject(ctx, exam, subject_name):
    subjects = _exam_subjects(ctx, exam['id'])
    if not subjects:
        raise ProposalError(f"You have no subjects of {exam['name']} to work with.")
    if not subject_name:
        if len(subjects) == 1:
            return subjects[0]
        raise ProposalError('Which subject? ' + ', '.join(s['subject_name'] for s in subjects) + '. Ask the user.')
    want = lc.tokens(subject_name)
    hits = [s for s in subjects if all(w in lc.tokens(s['subject_name']) for w in want)]
    if not hits:
        raise ProposalError(f'"{subject_name}" is not one of the subjects you can use here: '
                            + ', '.join(s['subject_name'] for s in subjects))
    if len(hits) > 1:
        raise ProposalError('Several subjects match: ' + ', '.join(s['subject_name'] for s in hits) + '. Ask the user which.')
    return hits[0]


def _results(ctx, exam):
    from examinations.views import ExamViewSet

    status, body = call(ctx.user, ctx.school_id, ExamViewSet, {'get': 'results'}, 'get',
                        f"/api/examinations/exams/{exam['id']}/results/", pk=exam['id'])
    if status != 200:
        raise ProposalError(_fail(body, 'Could not read the results.'))
    return body


def _num(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# ── reads ────────────────────────────────────────────────────────────────────

def list_exams(ctx, class_name=None, section=None, exam_name=None, status=None):
    params = {'status': status} if status else {}
    pool = _exams(ctx, **params)
    if class_name:
        sections = lc.find_sections(ctx, class_name, section)
        section_ids = {sc.id for sc in sections}
        class_ids = {sc.class_obj_id for sc in sections}
        pool = [e for e in pool if e.get('session_class') in section_ids
                or (e.get('session_class') is None and e.get('class_obj') in class_ids)]
    if exam_name:
        want = lc.tokens(exam_name)
        pool = [e for e in pool if all(w in lc.tokens(f"{e['name']} {e.get('exam_type_name', '')}") for w in want)]
    rows = [{
        'exam_id': e['id'], 'name': e['name'], 'class': e.get('class_name'), 'type': e.get('exam_type_name'),
        'status': e.get('status'), 'start_date': e.get('start_date'), 'end_date': e.get('end_date'),
        'subjects': e.get('subjects_count'), 'marks_entered': e.get('marks_entered_count'),
        'marks_expected': e.get('marks_expected_count'), 'marks_entry_complete': e.get('marks_entry_complete'),
        'schedule_published': bool(e.get('schedule_published_at')),
    } for e in pool[:LIST_LIMIT]]
    return {'count': len(pool), 'exams': rows, **({'note': f'Showing the first {LIST_LIMIT}.'} if len(pool) > LIST_LIMIT else {})}


def get_exam_results(ctx, exam_id=None, exam_name=None, class_name=None, section=None):
    exam = _find_exam(ctx, exam_id, exam_name, class_name, section)
    body = _results(ctx, exam)
    people = body.get('results', [])
    done = [r for r in people if not r.get('is_incomplete')]
    passed = [r for r in done if r.get('is_pass')]
    failed = [r for r in done if not r.get('is_pass')]
    subjects = []
    for s in body.get('subjects', []):
        marks = [m for r in people for m in r.get('marks', []) if m.get('subject_id') == s['subject']]
        sat = [m for m in marks if not m.get('is_absent') and _num(m.get('marks_obtained')) is not None]
        total = _num(s.get('total_marks')) or 0
        subjects.append({
            'subject': s['subject_name'], 'total_marks': total, 'entered': len(sat) + sum(1 for m in marks if m.get('is_absent')),
            'average': round(sum(_num(m['marks_obtained']) for m in sat) / len(sat), 1) if sat else None,
            'highest': max((_num(m['marks_obtained']) for m in sat), default=None),
            'pass_percent': round(100 * sum(1 for m in sat if m.get('is_pass')) / len(sat), 1) if sat else None,
        })
    ranked = sorted(done, key=lambda r: (r.get('rank') or 10 ** 6))
    return {
        'exam': exam['name'], 'class': exam.get('class_name'), 'status': exam.get('status'),
        'students': len(people), 'complete': len(done), 'incomplete': len(people) - len(done),
        'passed': len(passed), 'failed': len(failed),
        'pass_percent': round(100 * len(passed) / len(done), 1) if done else None,
        'average_percent': round(sum(r['percentage'] for r in done) / len(done), 1) if done else None,
        'top': [{'rank': r.get('rank'), 'name': r['student_name'], 'percentage': r['percentage'], 'grade': r.get('grade')} for r in ranked[:TOP_N]],
        'failed_students': [{'name': r['student_name'], 'percentage': r['percentage'], 'failed_subjects': r.get('failed_subjects')} for r in failed[:15]],
        'subjects': subjects,
        **({'note': 'Some students have marks missing, so they are not ranked.'} if len(people) > len(done) else {}),
    }


def get_marks_entry_status(ctx, exam_id=None, exam_name=None, class_name=None, section=None):
    exam = _find_exam(ctx, exam_id, exam_name, class_name, section)
    body = _results(ctx, exam)
    people = body.get('results', [])
    out = []
    for s in body.get('subjects', []):
        missing = []
        for r in people:
            m = next((m for m in r.get('marks', []) if m.get('subject_id') == s['subject']), None)
            if m is None or (_num(m.get('marks_obtained')) is None and not m.get('is_absent')):
                missing.append(r['student_name'])
        out.append({'subject': s['subject_name'], 'entered': len(people) - len(missing), 'missing': len(missing),
                    'missing_names': missing[:10], 'done': not missing})
    return {'exam': exam['name'], 'class': exam.get('class_name'), 'students': len(people),
            'all_marks_entered': all(o['done'] for o in out) if out else False, 'subjects': out}


def get_student_marks(ctx, student_id=None):
    from examinations.models import ExamSubject
    from examinations.views import StudentMarkViewSet

    if not student_id:
        raise ProposalError('Which student? Use find_student first and pass student_id.')
    status, body = call(ctx.user, ctx.school_id, StudentMarkViewSet, {'get': 'by_student'}, 'get',
                        '/api/examinations/marks/by_student/', {'student_id': student_id, 'academic_year': _year_id(ctx)})
    if status != 200:
        raise ProposalError(_fail(body, 'Could not read marks.'))
    marks = body if isinstance(body, list) else _items(body)
    by_subject = {es.id: es for es in ExamSubject.objects.filter(
        school_id=ctx.school_id, id__in=[m['exam_subject'] for m in marks]).select_related('exam')}
    exams = {}
    for m in marks:
        es = by_subject.get(m['exam_subject'])
        if es is None:
            continue
        entry = exams.setdefault(es.exam_id, {'exam': es.exam.name, 'status': es.exam.status, 'subjects': []})
        entry['subjects'].append({'subject': m['subject_name'], 'marks': _num(m['marks_obtained']), 'out_of': _num(m['total_marks']),
                                  'absent': m['is_absent'], 'pass': m['is_pass']})
    if not exams:
        return {'exams': [], 'note': 'No marks found for this student (or none you may see).'}
    return {'exams': list(exams.values())}


def get_grade_scale(ctx):
    from examinations.models import GradeScale
    rows = GradeScale.objects.filter(school_id=ctx.school_id, is_active=True).order_by('-min_percentage')
    return {'grades': [{'grade': g.grade_label, 'from_percent': float(g.min_percentage), 'to_percent': float(g.max_percentage),
                        'gpa': float(g.gpa_points) if g.gpa_points is not None else None} for g in rows]}


def get_at_risk_students(ctx, threshold=None):
    from examinations.views import AcademicRiskView

    params = {'threshold': threshold} if threshold is not None else {}
    status, body = call(ctx.user, ctx.school_id, AcademicRiskView, {'get': 'get'}, 'get', '/api/examinations/academic-risk/', params)
    if status != 200:
        raise ProposalError(_fail(body, 'Could not run the risk check.'))
    if isinstance(body, dict):
        for key in ('students', 'at_risk', 'results'):
            if isinstance(body.get(key), list):
                return {**{k: v for k, v in body.items() if k != key}, key: body[key][:30],
                        **({'note': 'Showing the first 30.'} if len(body[key]) > 30 else {})}
    return body


# ── entering marks ───────────────────────────────────────────────────────────

def _fmt_mark(value, absent):
    if absent:
        return 'Absent'
    return '—' if value is None else (f'{value:g}' if isinstance(value, float) else value)


def _build_marks(ctx, payload):
    from examinations.models import Exam, ExamSubject, StudentMark
    from examinations.views import _exam_roster

    es = ExamSubject.objects.filter(school_id=ctx.school_id, id=payload['exam_subject'], is_active=True).select_related('exam', 'subject').first()
    if es is None:
        raise ProposalError('That exam subject no longer exists.')
    exam = Exam.objects.get(pk=es.exam_id)
    students, _ = _exam_roster(ctx.school_id, exam, for_entry=True)
    roster = {s.id: s.name for s in students}
    total, passing = es.total_marks, es.passing_marks
    existing = {m.student_id: m for m in StudentMark.objects.filter(exam_subject=es, student_id__in=list(roster))}

    rows, entries, warnings = [], [], []
    for e in payload['entries']:
        sid = e['student_id']
        if sid not in roster:
            warnings.append(f'Student {sid} is not on the marks list for this exam and was removed.')
            continue
        absent = bool(e.get('absent'))
        marks = None if absent else Decimal(str(e['marks']))
        if marks is not None and (marks < 0 or marks > total):
            raise ProposalError(f'{roster[sid]}: marks must be between 0 and {total:g}.')
        old = existing.get(sid)
        was = _fmt_mark(float(old.marks_obtained) if old and old.marks_obtained is not None else None, bool(old and old.is_absent))
        entries.append({'student_id': sid, 'marks': None if marks is None else str(marks), 'absent': absent, 'was': was})
        rows.append({'student_id': sid, 'student': roster[sid], 'was': was,
                     'marks': None if marks is None else float(marks), 'absent': absent})
    if not entries:
        raise ProposalError('Nothing to save.')
    for r in rows:
        if r['absent']:
            r['marks_text'] = 'Absent'
    graded = [r['marks'] for r in rows if r['marks'] is not None]
    below = sum(1 for m in graded if Decimal(str(m)) < passing)
    replaced = sum(1 for r in rows if r['was'] != '—' and r['was'] != _fmt_mark(r['marks'], r['absent']))
    left = len(roster) - len({r['student_id'] for r in rows} | {sid for sid, m in existing.items() if m.marks_obtained is not None or m.is_absent})
    if replaced:
        warnings.append(f'{replaced} existing mark(s) will be replaced.')
    if below:
        warnings.append(f'{below} student(s) are below the passing marks ({passing:g}).')
    if left > 0:
        warnings.append(f'{left} student(s) in the class still have no mark after this.')
    if es.exam.status == Exam.Status.PUBLISHED:
        warnings.append('Results of this exam are already published; students and parents will see the change.')
    average = round(sum(graded) / len(graded), 1) if graded else None
    new_payload = {**payload, 'entries': entries}
    return {'payload': new_payload, 'preview': {
        'kind': 'marks_entry', 'title': 'Enter marks',
        'summary': f"{es.exam.name}, {es.subject.name} (out of {total:g}): {len(rows)} student(s)"
                   + (f', average {average:g}' if average is not None else ''),
        'columns': ['Student', 'Now', 'Marks'], 'rows': rows,
        'totals': {'count': len(rows), 'average': average, 'below_passing': below},
        'warnings': warnings,
        'assumptions': {'exam': es.exam.name, 'subject': es.subject.name, 'out of': f'{total:g}', 'passing': f'{passing:g}'},
        'editable': {'amounts': True, 'remove': True},
    }}


def enter_marks(ctx, exam_id=None, exam_name=None, class_name=None, section=None, subject_name=None, entries=None):
    from examinations.models import Exam
    from examinations.views import _exam_roster

    if not entries:
        raise ProposalError('Which students and marks? Ask the user.')
    exam = _find_exam(ctx, exam_id, exam_name, class_name, section)
    es = _find_exam_subject(ctx, exam, subject_name)
    students, _ = _exam_roster(ctx.school_id, Exam.objects.get(pk=exam['id']), for_entry=True)
    roster = {s.id: s.name for s in students}
    if not roster:
        raise ProposalError(f"{exam['name']} has no students on its marks list.")
    resolved = {}
    for item in entries:
        who = lc.match_names(roster, [item['student_name']] if item.get('student_name') else None,
                             [item['student_id']] if item.get('student_id') else None, ' for these marks')
        if len(who) != 1:
            raise ProposalError('Each entry needs one student (a name or a student_id).')
        sid = next(iter(who))
        absent = bool(item.get('absent'))
        if not absent and item.get('marks') is None:
            raise ProposalError(f'No marks given for {roster[sid]}. Ask the user.')
        try:
            marks = None if absent else Decimal(str(item['marks']))
        except InvalidOperation:
            raise ProposalError(f"\"{item['marks']}\" is not a number.")
        resolved[sid] = {'student_id': sid, 'marks': None if marks is None else str(marks), 'absent': absent}
    return _build_marks(ctx, {'kind': 'marks_entry', 'exam_subject': es['id'], 'entries': list(resolved.values())})


def revise_marks(ctx, payload, edits):
    payload = {**payload, 'entries': [dict(e) for e in payload['entries']]}
    drop = {int(i) for i in edits.get('remove_ids') or []}
    payload['entries'] = [e for e in payload['entries'] if e['student_id'] not in drop]
    by_id = {e['student_id']: e for e in payload['entries']}
    for sid, value in (edits.get('amounts') or {}).items():
        if int(sid) not in by_id:
            raise ProposalError(f'Student {sid} is not on this card.')
        try:
            by_id[int(sid)]['marks'] = str(Decimal(str(value)))
            by_id[int(sid)]['absent'] = False
        except InvalidOperation:
            raise ProposalError(f'"{value}" is not a number.')
    return _build_marks(ctx, payload)


def apply_marks(ctx, payload):
    from examinations.views import StudentMarkViewSet

    data = {'exam_subject_id': payload['exam_subject'], 'marks': [
        {'student_id': e['student_id'], 'is_absent': bool(e.get('absent')),
         **({} if e.get('absent') else {'marks_obtained': e['marks']})} for e in payload['entries']]}
    status, body = call(ctx.user, ctx.school_id, StudentMarkViewSet, {'post': 'bulk_entry'}, 'post',
                        '/api/examinations/marks/bulk_entry/', data)
    if status != 200:
        return {'ok': False, 'error': _fail(body, 'Marks could not be saved.')}
    saved = body.get('created', 0) + body.get('updated', 0)
    return {'ok': saved > 0, 'saved': saved, 'errors': body.get('errors', []),
            **({} if saved else {'error': 'No marks could be saved: ' + str(body.get('errors'))[:200]})}


# ── exams: create, move, delete ──────────────────────────────────────────────

def _iso(value, what):
    return lc.parse_date(value, what).isoformat() if value else None


def _exam_type(ctx, name):
    from examinations.models import ExamType

    types = list(ExamType.objects.filter(school_id=ctx.school_id, is_active=True))
    if not name:
        raise ProposalError('Which exam type? ' + ', '.join(t.name for t in types) + '. Ask the user.')
    want = lc.tokens(name)
    hits = [t for t in types if all(w in lc.tokens(t.name) for w in want)]
    if len(hits) != 1:
        raise ProposalError(f'Exam type "{name}" is not clear. Available: ' + ', '.join(t.name for t in types) + '. Ask the user.')
    return hits[0]


def _build_create(ctx, payload):
    from examinations.models import Exam
    from academic_sessions.models import SessionClass

    start, end = payload.get('start_date'), payload.get('end_date')
    if start and end and start > end:
        raise ProposalError('The end date is before the start date.')
    sc = SessionClass.objects.filter(school_id=ctx.school_id, id=payload['section']).select_related('class_obj').first()
    if sc is None:
        raise ProposalError('That class no longer exists.')
    year = _year_id(ctx)
    warnings = []
    if Exam.objects.filter(school_id=ctx.school_id, academic_year_id=year, class_obj_id=sc.class_obj_id,
                           exam_type_id=payload['exam_type'], is_active=True).exists():
        warnings.append('An exam of this type already exists for this class this year.')
    siblings = SessionClass.objects.filter(school_id=ctx.school_id, academic_year_id=year, class_obj_id=sc.class_obj_id, is_active=True).count()
    if siblings > 1:
        warnings.append(f'This exam covers every section of {sc.display_name} ({siblings} sections).')
    warnings.append('The exam starts with all of the class subjects. Marks and dates can be added afterwards.')
    rows = [{'field': 'Name', 'value': payload['name']}, {'field': 'Class', 'value': sc.display_name},
            {'field': 'Type', 'value': payload['exam_type_name']}, {'field': 'Start', 'value': start or 'not set'},
            {'field': 'End', 'value': end or 'not set'}]
    return {'payload': payload, 'preview': {
        'kind': 'exam_create', 'title': 'Create exam', 'summary': f"{payload['name']} for {sc.display_name}",
        'columns': ['Field', 'Value'], 'rows': rows, 'totals': {'count': 1}, 'warnings': warnings,
        'editable': {},
    }}


def create_exam(ctx, class_name=None, section=None, exam_type=None, name=None, start_date=None, end_date=None):
    sections = lc.find_sections(ctx, class_name, section)
    if not sections:
        raise ProposalError(f'No class matching "{class_name}" in the current academic year.')
    if len({sc.class_obj_id for sc in sections}) > 1:
        raise ProposalError('That matches more than one class: ' + ', '.join(lc.section_label(sc) for sc in sections[:8]) + '. Ask which.')
    sc = sections[0]
    etype = _exam_type(ctx, exam_type)
    return _build_create(ctx, {
        'kind': 'exam_create', 'section': sc.id, 'class_obj': sc.class_obj_id, 'exam_type': etype.id, 'exam_type_name': etype.name,
        'name': (name or f'{etype.name} - {sc.display_name}')[:200],
        'start_date': _iso(start_date, 'start_date'), 'end_date': _iso(end_date, 'end_date'),
    })


def revise_create(ctx, payload, edits):
    payload = dict(payload)
    for key in ('name', 'start_date', 'end_date'):
        if key in edits:
            payload[key] = (edits[key] if key == 'name' else _iso(edits[key], key))
    return _build_create(ctx, payload)


def apply_create(ctx, payload):
    from examinations.views import ExamViewSet

    data = {'academic_year': _year_id(ctx), 'exam_type': payload['exam_type'], 'class_obj': payload['class_obj'],
            'name': payload['name'], **{k: payload[k] for k in ('start_date', 'end_date') if payload.get(k)}}
    status, body = call(ctx.user, ctx.school_id, ExamViewSet, {'post': 'create'}, 'post', '/api/examinations/exams/', data)
    if status not in (200, 201):
        return {'ok': False, 'error': _fail(body, 'The exam could not be created.')}
    return {'ok': True, 'exam_id': (body or {}).get('id'), 'name': payload['name']}


def _build_reschedule(ctx, payload):
    from examinations.models import Exam

    exam = Exam.objects.filter(school_id=ctx.school_id, id=payload['exam_id'], is_active=True).first()
    if exam is None:
        raise ProposalError('That exam no longer exists.')
    if exam.status in (Exam.Status.COMPLETED, Exam.Status.PUBLISHED):
        raise ProposalError(f"{exam.name} is {exam.get_status_display().lower()}; its dates are not changed from here.")
    start, end = payload.get('start_date') or None, payload.get('end_date') or None
    if (start or exam.start_date and exam.start_date.isoformat()) and (end or exam.end_date and exam.end_date.isoformat()):
        s = start or exam.start_date.isoformat()
        e = end or exam.end_date.isoformat()
        if s > e:
            raise ProposalError('The new end date is before the start date.')
    rows = []
    if start:
        rows.append({'what': 'Exam starts', 'from': exam.start_date or 'not set', 'to': start})
    if end:
        rows.append({'what': 'Exam ends', 'from': exam.end_date or 'not set', 'to': end})
    subject_changes = []
    for item in payload.get('subjects') or []:
        es = exam.exam_subjects.filter(id=item['exam_subject'], is_active=True).select_related('subject').first()
        if es is None:
            continue
        rows.append({'what': f'{es.subject.name} paper', 'from': es.exam_date or 'not set', 'to': item['date']})
        subject_changes.append(item)
    if not rows:
        raise ProposalError('No date to change. Ask the user for the new dates.')
    warnings = []
    if exam.schedule_published_at:
        warnings.append('The schedule is already published; students and parents will see the new dates.')
    return {'payload': {**payload, 'subjects': subject_changes}, 'preview': {
        'kind': 'exam_reschedule', 'title': 'Change exam dates', 'summary': f'{exam.name}: {len(rows)} date(s)',
        'columns': ['What', 'From', 'To'], 'rows': rows, 'totals': {'count': len(rows)}, 'warnings': warnings, 'editable': {},
    }}


def reschedule_exam(ctx, exam_id=None, exam_name=None, class_name=None, section=None, start_date=None, end_date=None, subject_dates=None):
    exam = _find_exam(ctx, exam_id, exam_name, class_name, section)
    subjects = []
    if subject_dates:
        pool = _exam_subjects(ctx, exam['id'])
        for item in subject_dates:
            want = lc.tokens(item.get('subject_name'))
            hits = [s for s in pool if all(w in lc.tokens(s['subject_name']) for w in want)]
            if len(hits) != 1:
                raise ProposalError(f"Subject \"{item.get('subject_name')}\" is not clear. Subjects: " + ', '.join(s['subject_name'] for s in pool))
            subjects.append({'exam_subject': hits[0]['id'], 'date': _iso(item.get('date'), 'date')})
    return _build_reschedule(ctx, {'kind': 'exam_reschedule', 'exam_id': exam['id'],
                                   'start_date': _iso(start_date, 'start_date'), 'end_date': _iso(end_date, 'end_date'), 'subjects': subjects})


def revise_reschedule(ctx, payload, edits):
    return _build_reschedule(ctx, payload)


def apply_reschedule(ctx, payload):
    from examinations.views import ExamSubjectViewSet, ExamViewSet

    done = []
    dates = {k: payload[k] for k in ('start_date', 'end_date') if payload.get(k)}
    if dates:
        status, body = call(ctx.user, ctx.school_id, ExamViewSet, {'patch': 'partial_update'}, 'patch',
                            f"/api/examinations/exams/{payload['exam_id']}/", dates, pk=payload['exam_id'])
        if status != 200:
            return {'ok': False, 'error': _fail(body, 'The dates could not be changed.')}
        done.append('exam dates')
    for item in payload.get('subjects') or []:
        status, body = call(ctx.user, ctx.school_id, ExamSubjectViewSet, {'patch': 'partial_update'}, 'patch',
                            f"/api/examinations/exam-subjects/{item['exam_subject']}/", {'exam_date': item['date']}, pk=item['exam_subject'])
        if status != 200:
            return {'ok': False, 'done': done, 'error': _fail(body, 'A paper date could not be changed.')}
        done.append(f"paper {item['exam_subject']}")
    return {'ok': True, 'changed': done}


def _build_delete(ctx, payload):
    from examinations.models import Exam, StudentMark

    exam = Exam.objects.filter(school_id=ctx.school_id, id=payload['exam_id'], is_active=True).select_related('class_obj').first()
    if exam is None:
        raise ProposalError('That exam no longer exists.')
    if exam.status != Exam.Status.SCHEDULED:
        raise ProposalError(f"{exam.name} is {exam.get_status_display().lower()}. Only an exam that has not started can be deleted here.")
    entered = StudentMark.objects.filter(exam_subject__exam=exam).exclude(marks_obtained__isnull=True, is_absent=False).count()
    if entered:
        raise ProposalError(f'{exam.name} already has {entered} mark(s) entered, so it cannot be deleted from here.')
    return {'payload': payload, 'preview': {
        'kind': 'delete_exams', 'title': 'Delete exam', 'summary': f'{exam.name} ({exam.class_obj.name})',
        'columns': ['Exam', 'Class', 'Status'], 'rows': [{'id': exam.id, 'exam': exam.name, 'class': exam.class_obj.name, 'status': exam.get_status_display()}],
        'totals': {'count': 1}, 'warnings': ['The exam and its subject list are removed. This cannot be undone.'], 'editable': {},
    }}


def delete_exam(ctx, exam_id=None, exam_name=None, class_name=None, section=None):
    exam = _find_exam(ctx, exam_id, exam_name, class_name, section)
    return _build_delete(ctx, {'kind': 'delete_exams', 'exam_id': exam['id']})


def revise_delete(ctx, payload, edits):
    return _build_delete(ctx, payload)


def apply_delete(ctx, payload):
    from examinations.views import ExamViewSet

    status, body = call(ctx.user, ctx.school_id, ExamViewSet, {'delete': 'destroy'}, 'delete',
                        f"/api/examinations/exams/{payload['exam_id']}/", pk=payload['exam_id'])
    if status not in (200, 204):
        return {'ok': False, 'error': _fail(body, 'The exam could not be deleted.')}
    return {'ok': True}


# ── registration ─────────────────────────────────────────────────────────────

_O = {'additionalProperties': False}
_FIND = {
    'exam_id': {'type': 'integer', 'description': 'Exact exam id when known (from list_exams)'},
    'exam_name': {'type': 'string', 'description': 'Words from the exam name or type, e.g. "mid term"'},
    'class_name': {'type': 'string', 'description': 'e.g. "Class 5" or "8B"'},
    'section': {'type': 'string', 'description': 'Section letter, e.g. "A"'},
}
_DATE = {'type': 'string', 'description': 'YYYY-MM-DD'}


def _read(name, desc, props, handler, roles=READ_ROLES):
    register(Tool(name=name, description=desc, parameters={'type': 'object', **_O, 'properties': props},
                  handler=handler, sub_agent='exams', module='examinations', roles=roles))


_read('list_exams', 'Exams of the current academic year with status, dates and how many marks are entered. Filter by class, name or status.',
      {'class_name': _FIND['class_name'], 'section': _FIND['section'], 'exam_name': _FIND['exam_name'],
       'status': {'type': 'string', 'enum': ['SCHEDULED', 'IN_PROGRESS', 'MARKS_ENTRY', 'COMPLETED', 'PUBLISHED']}}, list_exams)
_read('get_exam_results', 'Results of one exam: pass/fail counts, pass percent, class average, top students, failed students and each subject average. '
      'Use for "how did class 5 do in the mid term?". Ask which exam if several match.', _FIND, get_exam_results)
_read('get_marks_entry_status', 'Which subjects of an exam still have marks missing, and for which students ("which marks are left to enter?").',
      _FIND, get_marks_entry_status)
_read('get_student_marks', "One student's marks in every exam this year. Needs student_id (use find_student).",
      {'student_id': {'type': 'integer'}}, get_student_marks)
_read('get_grade_scale', 'The school grade scale: letter grade, percentage range and GPA.', {}, get_grade_scale, roles=READ_ROLES)
_read('get_at_risk_students', 'Students whose marks are trending towards failing this year (admins only).',
      {'threshold': {'type': 'number', 'description': 'Optional percentage below which a student counts as at risk'}}, get_at_risk_students, roles=ADMINS)

register(Tool(
    name='enter_marks',
    description=(
        'PREPARE marks for one exam subject for review ("class 5 mid term maths: Ali 45, Sara 38, Zain absent"). One subject at a time; '
        'if the exam or subject is unclear, ask. If a name matches several students, ask which. Marks must be within the paper total. '
        'Nothing is saved until the user presses Approve. A teacher can only enter marks for their own class and subject.'),
    parameters={'type': 'object', **_O, 'properties': {
        **_FIND, 'subject_name': {'type': 'string'},
        'entries': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False, 'properties': {
            'student_name': {'type': 'string'}, 'student_id': {'type': 'integer'},
            'marks': {'type': 'number'}, 'absent': {'type': 'boolean'}}}}}},
    handler=enter_marks, sub_agent='exams', module='examinations', roles=MARK_WRITE_ROLES, kind='write',
    revise=revise_marks, apply=apply_marks,
))
register(Tool(
    name='create_exam',
    description='PREPARE a new exam for a class ("class 6 ka final term exam banao 1 se 10 march"). The exam starts with all the class subjects. '
                'Needs the exam type; ask if not given. Nothing is created until the user approves.',
    parameters={'type': 'object', **_O, 'properties': {
        'class_name': _FIND['class_name'], 'section': _FIND['section'], 'exam_type': {'type': 'string', 'description': 'e.g. "Mid Term"'},
        'name': {'type': 'string'}, 'start_date': _DATE, 'end_date': _DATE}},
    handler=create_exam, sub_agent='exams', module='examinations', roles=EXAM_WRITE_ROLES, kind='write',
    revise=revise_create, apply=apply_create,
))
register(Tool(
    name='reschedule_exam',
    description='PREPARE new dates for an exam that has not finished, and optionally for single papers ("maths ka paper 12 march ko kar do"). '
                'Nothing changes until the user approves.',
    parameters={'type': 'object', **_O, 'properties': {
        **_FIND, 'start_date': _DATE, 'end_date': _DATE,
        'subject_dates': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False, 'properties': {
            'subject_name': {'type': 'string'}, 'date': _DATE}}}}},
    handler=reschedule_exam, sub_agent='exams', module='examinations', roles=EXAM_WRITE_ROLES, kind='write',
    revise=revise_reschedule, apply=apply_reschedule,
))
register(Tool(
    name='delete_exam',
    description='PREPARE deleting an exam that has not started and has no marks. Anything else is refused. Nothing is deleted until the user approves.',
    parameters={'type': 'object', **_O, 'properties': dict(_FIND)},
    handler=delete_exam, sub_agent='exams', module='examinations', roles=EXAM_WRITE_ROLES, kind='write',
    revise=revise_delete, apply=apply_delete,
))
