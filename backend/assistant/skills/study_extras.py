"""Study Helper extras (students, read-only): weak subjects from their marks, a revision plan from the exam dates, quiz material from the curriculum.

The numbers (averages, trends, days to each paper, minutes per day) are computed here in code, so the model only words the result.
Everything is the student's own data, through the same StudyHelperService the other study tools use. Nothing is saved or changed.
Not here yet: flashcards and photo-of-a-problem (need the vision model).
"""
from datetime import date as date_cls, timedelta

from django.utils import timezone

from ..registry import ProposalError, Tool, register

ROLES = ('STUDENT',)
FALLING_BY = 5.0          # percentage points lower than the exam before counts as "falling"
MAX_PLAN_DAYS = 14


def _service(ctx):
    try:
        student = ctx.user.student_profile.student
    except Exception:
        raise ProposalError('No student profile is linked to this account.')
    if student.school_id != ctx.school_id:
        raise ProposalError('This student does not belong to the active school.')
    from students.study_helper_service import StudyHelperService
    return StudyHelperService(student, student.school)


def _by_subject(svc):
    marks = svc._execute_tool('get_my_marks', {}).get('marks', [])
    subjects = {}
    for m in marks:                # newest first
        if m.get('is_absent'):
            continue
        subjects.setdefault(m['subject'], []).append(m)
    out = []
    for name, rows in subjects.items():
        pct = [r['percentage'] for r in rows]
        latest, previous = pct[0], (pct[1] if len(pct) > 1 else None)
        out.append({'subject': name, 'exams': len(pct), 'average': round(sum(pct) / len(pct), 1), 'latest': round(latest, 1),
                    'change_since_previous': round(latest - previous, 1) if previous is not None else None,
                    'falling': previous is not None and latest <= previous - FALLING_BY,
                    'failed_any': any(not r['is_pass'] for r in rows)})
    return sorted(out, key=lambda s: (s['average'], s['latest']))


def get_weak_subjects(ctx):
    svc = _service(ctx)
    ranked = _by_subject(svc)
    if not ranked:
        return {'subjects': [], 'note': 'No published exam results yet, so there is nothing to compare.'}
    return {'weakest_first': ranked, 'weak': [s['subject'] for s in ranked if s['average'] < 50 or s['falling'] or s['failed_any']][:5],
            'note': 'A subject is called weak when its average is under 50%, it fell by 5 points or more since the previous exam, or a paper was failed.'}


def make_revision_plan(ctx, minutes_per_day=90, days=None):
    svc = _service(ctx)
    try:
        minutes = int(minutes_per_day)
    except (TypeError, ValueError):
        raise ProposalError('Minutes per day must be a number.')
    if not 15 <= minutes <= 600:
        raise ProposalError('Minutes per day should be between 15 and 600.')
    papers = []
    for exam in svc._execute_tool('get_exam_schedule', {}).get('upcoming_exams', []):
        for s in exam['subjects']:
            if s.get('date'):
                papers.append({'exam': exam['name'], 'subject': s['subject'], 'date': date_cls.fromisoformat(s['date'])})
    if not papers:
        return {'plan': [], 'note': 'No exam dates are published yet, so a dated plan is not possible. Ask the teacher for the date sheet.'}
    today = timezone.localdate()
    weak = {s['subject']: s for s in _by_subject(svc)}
    horizon = min(MAX_PLAN_DAYS, int(days)) if days else MAX_PLAN_DAYS
    plan = []
    for offset in range(horizon):
        day = today + timedelta(days=offset)
        live = [p for p in papers if p['date'] > day]
        if not live:
            break
        weights = {}
        for p in live:
            left = (p['date'] - day).days
            avg = weak.get(p['subject'], {}).get('average')
            weakness = 1.0 + ((100 - avg) / 100.0 if avg is not None else 0.3)
            weights[p['subject']] = weights.get(p['subject'], 0) + weakness / left          # nearer paper and weaker subject weigh more
        total = sum(weights.values())
        slots = sorted(((s, round(minutes * w / total / 5) * 5) for s, w in weights.items()), key=lambda x: -x[1])
        plan.append({'date': day.isoformat(), 'weekday': day.strftime('%A'), 'study': [{'subject': s, 'minutes': m} for s, m in slots if m >= 10],
                     'papers_that_day': [p['subject'] for p in papers if p['date'] == day]})
    return {'minutes_per_day': minutes, 'papers': [{'subject': p['subject'], 'date': p['date'].isoformat(), 'days_left': (p['date'] - today).days} for p in
                                                   sorted(papers, key=lambda p: p['date'])],
            'plan': plan, 'note': 'Each day is split by how weak the subject is and how soon its paper is. Rest days are up to the student.'}


def get_quiz_material(ctx, subject=None, chapter_number=None):
    svc = _service(ctx)
    books = svc._execute_tool('get_topic_details', {'subject_name': subject} if subject else {}).get('books', [])
    if not books:
        return {'books': [], 'note': 'No curriculum topics are set up for this subject yet. Ask the teacher, or quiz from the textbook the student names.'}
    if chapter_number is not None:
        for b in books:
            b['chapters'] = [c for c in b['chapters'] if c['chapter_number'] == int(chapter_number)]
    return {'books': books, 'how_to_use': ('Write 5 short practice questions only from these topics, easiest first, mixing types. Do not show answers until the student '
                                           'asks or has tried. Explain wrong answers kindly. Nothing is saved.')}


_O = {'additionalProperties': False}
register(Tool(name='get_weak_subjects', description="Which of the student's subjects are weakest, from their published marks (average, latest, change since the previous exam).",
              parameters={'type': 'object', **_O, 'properties': {}}, handler=get_weak_subjects, sub_agent='study', module=None, roles=ROLES))
register(Tool(name='make_revision_plan', description=('A day-by-day revision plan from the upcoming exam dates and the weak subjects ("exams ki tayyari ka plan banao"). '
                                                     'Call it right away: minutes per day default to 90 and days to 14. Only change them if the student already said so.'),
              parameters={'type': 'object', **_O, 'properties': {'minutes_per_day': {'type': 'integer'}, 'days': {'type': 'integer', 'description': 'How many days to plan (max 14)'}}},
              handler=make_revision_plan, sub_agent='study', module=None, roles=ROLES))
register(Tool(name='get_quiz_material', description='Curriculum topics for a subject (optionally one chapter) to build a practice quiz from. Use before writing quiz questions.',
              parameters={'type': 'object', **_O, 'properties': {'subject': {'type': 'string'}, 'chapter_number': {'type': 'integer'}}},
              handler=get_quiz_material, sub_agent='study', module=None, roles=ROLES))
