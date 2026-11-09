"""Study Helper extras (students, read-only): weak subjects from their marks, a revision plan from the exam dates, quiz material from the curriculum.

The numbers (averages, trends, days to each paper, minutes per day) are computed here in code, so the model only words the result.
Everything is the student's own data, through the same StudyHelperService the other study tools use. Nothing is saved or changed.
Flashcards and the running quiz score are here too. Not here: photo-of-a-problem (needs a vision model the Groq project allows, image upload in the chat
API, and a privacy decision about sending a child's photo out; see docs/handoff/08_BACKLOG_FROM_PLAN.md item K).
"""
from datetime import date as date_cls, timedelta

from django.utils import timezone

from .. import memory
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


MAX_QUIZ_SUBJECTS = 10
MAX_CARD_TOPICS = 12


def record_quiz_answer(ctx, subject=None, correct=None, reset=False):
    """A running score for the quiz in THIS chat, kept in the conversation's remembered state (scratch, not school data)."""
    conv = ctx.conversation
    if conv is None:
        raise ProposalError('There is no conversation to keep a score in.')
    quiz = dict((conv.state or {}).get('quiz') or {})
    if reset:
        quiz = {k: v for k, v in quiz.items() if subject and k.lower() != subject.strip().lower()} if subject else {}
        memory.merge_state(conv, {'quiz': quiz})
        return {'score': 'reset', 'all': quiz}
    if not subject or not str(subject).strip():
        raise ProposalError('Which subject is the quiz in? Ask the student.')
    if not isinstance(correct, bool):
        raise ProposalError('Was the answer right or wrong? Pass correct=true or false.')
    name = str(subject).strip()[:40]
    key = next((k for k in quiz if k.lower() == name.lower()), name)
    if key not in quiz and len(quiz) >= MAX_QUIZ_SUBJECTS:
        raise ProposalError('That is a lot of different quizzes in one chat. Start a new chat, or reset the score first.')
    row = dict(quiz.get(key) or {'asked': 0, 'correct': 0})
    row['asked'] += 1
    row['correct'] += 1 if correct else 0
    quiz[key] = row
    memory.merge_state(conv, {'quiz': quiz})
    asked = sum(r['asked'] for r in quiz.values())
    right = sum(r['correct'] for r in quiz.values())
    return {'subject': key, 'score': f"{row['correct']}/{row['asked']}", 'all_subjects': {k: f"{v['correct']}/{v['asked']}" for k, v in quiz.items()},
            'total': f'{right}/{asked}'}


def get_flashcard_topics(ctx, subject=None, limit=MAX_CARD_TOPICS):
    """Curriculum topics to turn into flashcards: the named subject, or the student's weakest subjects when none is named."""
    svc = _service(ctx)
    try:
        cap = max(1, min(int(limit), MAX_CARD_TOPICS))
    except (TypeError, ValueError):
        raise ProposalError('limit must be a number.')
    if subject:
        wanted = [subject]
    else:
        ranked = _by_subject(svc)
        wanted = [s['subject'] for s in ranked[:2]]
        if not wanted:
            return {'topics': [], 'note': 'No published results yet, so there are no weak subjects. Ask which subject to make cards for.'}
    topics = []
    for name in wanted:
        for book in svc._execute_tool('get_topic_details', {'subject_name': name}).get('books', []):
            for ch in book['chapters']:
                for t in ch['topics']:
                    topics.append({'subject': book['subject'], 'chapter': f"Ch {ch['chapter_number']}: {ch['title']}", 'topic': t['title'],
                                   'about': (t.get('description') or '')[:160]})
    if not topics:
        return {'topics': [], 'subjects': wanted, 'note': 'No curriculum topics are set up for this subject yet. Ask the teacher, or make cards from what the student pastes.'}
    return {'subjects': wanted, 'topics': topics[:cap],
            'how_to_use': ('Write one flashcard per topic as a two-column markdown table (Front: a short question or term, Back: the answer in one or two lines), '
                           'only from these topics. Nothing is saved.'),
            **({'note': f'Showing {cap} of {len(topics)} topics; offer more if the student wants.'} if len(topics) > cap else {})}


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
register(Tool(name='record_quiz_answer',
              description=('Keep the running score of the practice quiz in this chat: call it after EACH answer the student gives (correct true or false), then tell them the score. '
                           'reset=true starts a fresh score (for one subject if named). The score lives only in this chat.'),
              parameters={'type': 'object', **_O, 'properties': {'subject': {'type': 'string'}, 'correct': {'type': 'boolean'}, 'reset': {'type': 'boolean'}}},
              handler=record_quiz_answer, sub_agent='study', module=None, roles=ROLES))
register(Tool(name='get_flashcard_topics',
              description='Curriculum topics to make flashcards from ("flashcards banao"): the named subject, or the weakest subjects when none is named.',
              parameters={'type': 'object', **_O, 'properties': {'subject': {'type': 'string'}, 'limit': {'type': 'integer', 'minimum': 1, 'maximum': 12}}},
              handler=get_flashcard_topics, sub_agent='study', module=None, roles=ROLES))
