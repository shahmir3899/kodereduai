"""Lesson-plan and diary writes: plan from book chapters, one short plan, delete, diary/homework.

All of them only PROPOSE. The user reviews the card (dates, content, what was skipped) and
approves; then each row is created through the same LMS viewsets the web app uses, so teacher
permissions and serializer validation apply. Dates, allocation and conflicts are decided by
code (lms_common), not by the model.
"""
import calendar
from datetime import date, datetime

from django.utils import timezone

from ..internal_api import call
from ..registry import ADMINS, ProposalError, Tool, register
from . import lms_common as lc

WRITE_ROLES = ADMINS + ('TEACHER',)       # Managers can prepare drafts in the UI, not through chat
MAX_ROWS = 120
TEXT_FIELDS = ('objectives', 'description', 'teaching_methods', 'materials_needed')


def _wd(d):
    return calendar.day_abbr[d.weekday()]


# ── building units from a book ───────────────────────────────────────────────

def _book_units(ctx, section, subject, book_id, chapters, unit, page_from, page_to, custom_units):
    """Units to spread over the days, following the depth of the request: chapter, topic or page.
    Returns (units, book_title, unit_kind). A unit is {label, topic_ids, custom, weight}."""
    from lms.models import Chapter, Topic

    if custom_units:
        return [{'label': u, 'topic_ids': [], 'custom': [u], 'weight': 1} for u in custom_units], '', 'custom'

    books = lc.find_books(ctx, section, subject, book_id)
    if not books:
        raise ProposalError(f'No book is saved for {subject.name} in this class. Ask the user for the chapters or '
                            'topics to plan (pass custom_units), or to add the book first.')
    if len(books) > 1:
        raise ProposalError('Several books exist: ' + '; '.join(f'{b.title} (book_id {b.id})' for b in books[:6])
                            + '. Ask the user which one.')
    book = books[0]
    all_chapters = list(Chapter.objects.filter(book=book).order_by('chapter_number'))
    if not all_chapters:
        raise ProposalError(f'"{book.title}" has no chapters saved. Ask the user how the lessons should be split '
                            '(chapter names or a page range) - or pass custom_units.')
    topics = list(Topic.objects.filter(chapter__book=book).select_related('chapter')
                  .order_by('chapter__chapter_number', 'topic_number'))

    if page_from or page_to:
        lo, hi = int(page_from or 0), int(page_to or 10 ** 6)
        spans = [(t, max(t.page_start, lo), min(t.page_end or t.page_start, hi)) for t in topics if t.page_start]
        spans = [(t, a, b) for t, a, b in spans if a <= b]
        if not spans:
            raise ProposalError(f'"{book.title}" has no page numbers on its topics for those pages. Ask the user to '
                                'name chapters or topics instead.')
        return ([{'label': f'{t.chapter.chapter_number}.{t.topic_number} {t.title}', 'topic_ids': [t.id], 'custom': [],
                  'weight': b - a + 1} for t, a, b in spans], book.title, 'page')

    if not chapters:
        raise ProposalError('Which chapters (or topics, or pages) should be planned? Ask the user. '
                            'Chapters in this book: ' + ', '.join(f'{c.chapter_number} {c.title}' for c in all_chapters[:30]))
    wanted = sorted({int(n) for n in chapters})
    found = [c for c in all_chapters if c.chapter_number in wanted]
    missing = sorted(set(wanted) - {c.chapter_number for c in found})
    if missing:
        raise ProposalError(f'Chapter {", ".join(map(str, missing))} not found in "{book.title}". Available: '
                            + ', '.join(str(c.chapter_number) for c in all_chapters))
    by_chapter = {}
    for t in topics:
        by_chapter.setdefault(t.chapter_id, []).append(t)

    if unit == 'topic':
        units = []
        for c in found:
            ts = by_chapter.get(c.id, [])
            if not ts:      # a chapter without topics counts as one unit
                units.append({'label': f'Ch {c.chapter_number}: {c.title}', 'topic_ids': [],
                              'custom': [f'Chapter {c.chapter_number}: {c.title}'], 'weight': 1})
            units += [{'label': f'{c.chapter_number}.{t.topic_number} {t.title}', 'topic_ids': [t.id], 'custom': [], 'weight': 1}
                      for t in ts]
        return units, book.title, 'topic'

    units = []
    for c in found:
        ts = by_chapter.get(c.id, [])
        units.append({'label': f'Ch {c.chapter_number}: {c.title}', 'topic_ids': [t.id for t in ts],
                      'custom': [] if ts else [f'Chapter {c.chapter_number}: {c.title}'], 'weight': 1})
    return units, book.title, 'chapter'


def _allocate(units, days, kind):
    plan = lc.distribute_weighted([u['weight'] for u in units], len(days)) if kind == 'page' else lc.distribute(len(units), len(days))
    out = []
    for day, idxs in zip(days, plan):
        chosen = [units[i] for i in idxs]
        topic_ids, custom, seen = [], [], set()
        for u in chosen:
            topic_ids += [t for t in u['topic_ids'] if t not in seen and not seen.add(t)]
            custom += u['custom']
        out.append({'date': day, 'label': ' + '.join(u['label'] for u in chosen),
                    'topic_ids': topic_ids, 'custom_topics': custom})
    return out


# ── the card ──────────────────────────────────────────────────────────────────

def _build_plans(ctx, payload):
    """Rebuild the card from the database (same code for propose, edit and approve)."""
    from academic_sessions.models import SessionClass
    from academics.models import Subject
    from hr.models import StaffMember
    from lms.models import LessonPlan, Topic

    rows, warnings, skipped, preview_rows = [], list(payload.get('warnings', [])), [], []
    sections = {s.id: s for s in SessionClass.objects.filter(school_id=ctx.school_id, id__in={r['section'] for r in payload['rows']})}
    subjects = {s.id: s for s in Subject.objects.filter(school_id=ctx.school_id, id__in={r['subject'] for r in payload['rows']})}
    teachers = {s.id: s for s in StaffMember.objects.filter(school_id=ctx.school_id, id__in={r['teacher'] for r in payload['rows']})}
    valid_topics = set(Topic.objects.filter(chapter__book__school_id=ctx.school_id,
                                            id__in={t for r in payload['rows'] for t in r['topic_ids']}).values_list('id', flat=True))
    for r in payload['rows']:
        sc, sub, tch = sections.get(r['section']), subjects.get(r['subject']), teachers.get(r['teacher'])
        if not (sc and sub and tch):
            warnings.append(f'{r["date"]}: class, subject or teacher no longer exists - removed.')
            continue
        if set(r['topic_ids']) - valid_topics:
            warnings.append(f'{r["date"]}: some topics no longer exist - removed.')
            r = {**r, 'topic_ids': [t for t in r['topic_ids'] if t in valid_topics]}
        clash = LessonPlan.objects.filter(
            school_id=ctx.school_id, class_obj_id=r['class_obj'], session_class_id=r['section'], subject_id=r['subject'],
            lesson_date=r['date'], is_active=True).exists()
        if clash and payload.get('on_conflict', 'skip') == 'skip':
            skipped.append({'date': r['date'], 'section': lc.section_label(sc), 'reason': 'a lesson plan already exists'})
            continue
        rows.append(r)
        preview_rows.append({
            'key': r['key'], 'date': r['date'], 'weekday': _wd(date.fromisoformat(r['date'])),
            'section': lc.section_label(sc), 'subject': sub.name, 'teacher': lc.staff_name(tch),
            'title': r['title'], 'content': r.get('label', ''), 'status': 'DRAFT',
            'has_existing': clash,
        })
    if not rows:
        raise ProposalError('Nothing to create: ' + ('every date already has a lesson plan.' if skipped else 'no valid rows.'))
    if len(rows) > MAX_ROWS:
        raise ProposalError(f'That is {len(rows)} lesson plans; please do at most {MAX_ROWS} at a time.')
    if skipped:
        warnings.append(f'{len(skipped)} date(s) skipped because a lesson plan already exists.')

    meta = payload.get('meta', {})
    new_payload = {**payload, 'rows': rows, 'warnings': payload.get('warnings', [])}
    sections_txt = ', '.join(sorted({p['section'] for p in preview_rows}))
    return {'payload': new_payload, 'preview': {
        'kind': 'lesson_plans',
        'title': 'Create lesson plans (drafts)',
        'summary': f'{len(rows)} lesson plan(s) for {sections_txt} - {preview_rows[0]["subject"]}',
        'columns': ['Date', 'Day', 'Class', 'Plan'],
        'rows': preview_rows,
        'skipped': skipped,
        'totals': {'count': len(rows)},
        'assumptions': meta,
        'warnings': warnings,
        'editable': {'remove_keys': True, 'titles': True, 'texts': list(TEXT_FIELDS), 'swap': True,
                     'on_conflict': ['skip', 'add']},
    }}


def _row(key, d, sc, tch, subject, title, label='', topic_ids=(), custom=(), **texts):
    return {'key': key, 'date': d.isoformat(), 'section': sc.id, 'class_obj': sc.class_obj_id, 'subject': subject.id,
            'teacher': tch.id, 'title': title[:200], 'label': label, 'topic_ids': list(topic_ids),
            'custom_topics': list(custom), **{f: texts.get(f, '') for f in TEXT_FIELDS}}


def plan_lessons_from_book(ctx, class_name=None, subject_name=None, date_from=None, date_to=None, chapters=None,
                           unit=None, page_from=None, page_to=None, custom_units=None, section=None, sections=None,
                           all_sections=False, teacher_name=None, teacher_id=None, book_id=None,
                           skip_saturday=False, on_conflict='skip', duration_minutes=45):
    if not (class_name and subject_name):
        raise ProposalError('Which class and which subject? Ask the user.')
    if not (date_from and date_to):
        raise ProposalError('Which dates (for example "next month")? Ask the user, or work them out from today\'s date.')
    d0, d1 = lc.parse_date(date_from, 'date_from'), lc.parse_date(date_to, 'date_to')
    subject = lc.find_subject(ctx, subject_name)
    teacher = lc.resolve_teacher(ctx, teacher_name, teacher_id) if (ctx.role == 'TEACHER' or teacher_name or teacher_id) else None
    targets = lc.resolve_sections_for_work(ctx, class_name, subject, section, sections, all_sections, teacher)

    units, book_title, kind = _book_units(ctx, targets[0][0], subject, book_id, chapters, unit, page_from, page_to, custom_units)
    rows, warnings = [], []
    for sc, tch in targets:
        days = lc.working_days(ctx.school_id, sc.class_obj_id, d0, d1, skip_saturday)
        if not days:
            raise ProposalError(f'There are no school days for {lc.section_label(sc)} between {d0} and {d1}.')
        if len(units) > len(days):
            warnings.append(f'{lc.section_label(sc)}: {len(units)} {kind}s over {len(days)} days - several are taught on the same day.')
        elif len(units) < len(days) and kind in ('topic', 'custom'):
            warnings.append(f'{lc.section_label(sc)}: only {len(units)} {kind}s for {len(days)} days - each runs over several days. '
                            'Tell the user if they want more content or a shorter range.')
        for slot in _allocate(units, days, kind):
            label = slot['label']
            rows.append(_row(f'{sc.id}:{slot["date"]}', slot['date'], sc, tch, subject, f'{subject.name}: {label}', label,
                             slot['topic_ids'], slot['custom_topics']))
    meta = {'class': class_name, 'sections': [lc.section_label(sc) for sc, _ in targets], 'subject': subject.name,
            'book': book_title or '(custom units)', 'spread_by': kind, 'from': d0.isoformat(), 'to': d1.isoformat(),
            'working_days': len({r['date'] for r in rows}), 'saturday': 'skipped' if skip_saturday else 'taught',
            'teachers': sorted({lc.staff_name(t) for _, t in targets})}
    return _build_plans(ctx, {'kind': 'lesson_plans', 'rows': rows, 'on_conflict': on_conflict, 'duration': duration_minutes,
                              'ai_generated': False, 'meta': meta, 'warnings': warnings})


def create_lesson_plan(ctx, class_name=None, subject_name=None, lesson_date=None, title=None, section=None,
                       objectives='', description='', teaching_methods='', materials_needed='', custom_topics=None,
                       teacher_name=None, teacher_id=None, duration_minutes=40):
    if not (class_name and subject_name and lesson_date and title):
        raise ProposalError('A class, subject, date and title are needed. Ask the user for what is missing.')
    d = lc.parse_date(lesson_date, 'lesson_date')
    subject = lc.find_subject(ctx, subject_name)
    teacher = lc.resolve_teacher(ctx, teacher_name, teacher_id) if (ctx.role == 'TEACHER' or teacher_name or teacher_id) else None
    ((sc, tch),) = lc.resolve_sections_for_work(ctx, class_name, subject, section, None, False, teacher)[:1]
    row = _row(f'{sc.id}:{d.isoformat()}', d, sc, tch, subject, title, title, (), custom_topics or [],
               objectives=objectives, description=description, teaching_methods=teaching_methods,
               materials_needed=materials_needed)
    return _build_plans(ctx, {'kind': 'lesson_plans', 'rows': [row], 'on_conflict': 'skip', 'duration': duration_minutes,
                              'ai_generated': True, 'meta': {'class': lc.section_label(sc), 'subject': subject.name,
                                                             'teacher': lc.staff_name(tch), 'written_by': 'AI draft - please review'},
                              'warnings': []})


def revise_plans(ctx, payload, edits):
    payload = {**payload, 'rows': [dict(r) for r in payload['rows']]}
    keys = {r['key'] for r in payload['rows']}
    by_key = {r['key']: r for r in payload['rows']}
    unknown = (set(edits.get('remove_keys') or []) | set(edits.get('titles') or {}) | set(edits.get('texts') or {})) - keys
    if unknown:
        raise ProposalError('Rows not on this card: ' + ', '.join(sorted(unknown)))
    if edits.get('on_conflict'):
        if edits['on_conflict'] not in ('skip', 'add'):
            raise ProposalError('on_conflict must be skip or add.')
        payload['on_conflict'] = edits['on_conflict']
    for k, t in (edits.get('titles') or {}).items():
        if not str(t).strip():
            raise ProposalError('A title cannot be empty.')
        by_key[k]['title'] = str(t).strip()[:200]
    for k, fields in (edits.get('texts') or {}).items():
        for f, v in fields.items():
            if f not in TEXT_FIELDS:
                raise ProposalError(f'Cannot edit "{f}". Editable: {", ".join(TEXT_FIELDS)}.')
            by_key[k][f] = str(v)
    for a, b in edits.get('swap') or []:
        if a not in by_key or b not in by_key:
            raise ProposalError('Both rows to swap must be on this card.')
        for f in ('label', 'topic_ids', 'custom_topics', 'title'):
            by_key[a][f], by_key[b][f] = by_key[b][f], by_key[a][f]
    remove = set(edits.get('remove_keys') or [])
    payload['rows'] = [r for r in payload['rows'] if r['key'] not in remove]
    return _build_plans(ctx, payload)


def apply_plans(ctx, payload):
    from lms.views import LessonPlanViewSet

    done, failed = [], []
    for r in payload['rows']:
        data = {'class_obj': r['class_obj'], 'session_class': r['section'], 'subject': r['subject'], 'teacher': r['teacher'],
                'title': r['title'], 'lesson_date': r['date'], 'duration_minutes': payload.get('duration', 45),
                'content_mode': 'TOPICS' if r['topic_ids'] else 'FREEFORM', 'ai_generated': bool(payload.get('ai_generated')),
                'planned_topic_ids': r['topic_ids'], 'custom_topics': r['custom_topics'], 'status': 'DRAFT', 'is_active': True,
                **{f: r.get(f, '') for f in TEXT_FIELDS}}
        status, body = call(ctx.user, ctx.school_id, LessonPlanViewSet, {'post': 'create'}, 'post', '/api/lms/lesson-plans/', data)
        if status == 201:
            done.append({'key': r['key'], 'id': body.get('id'), 'date': r['date']})
        else:
            failed.append({'key': r['key'], 'date': r['date'], 'error': str(body)[:200]})
    return {'ok': bool(done), 'created': len(done), 'failed': len(failed), 'rows': done, 'errors': failed,
            **({} if done else {'error': 'No lesson plan could be saved: ' + (failed[0]['error'] if failed else '')})}


# ── delete ────────────────────────────────────────────────────────────────────

def _delete_card(ctx, ids):
    from lms.models import LessonPlan

    qs = LessonPlan.objects.filter(school_id=ctx.school_id, id__in=ids, is_active=True).select_related(
        'teacher', 'subject', 'class_obj', 'session_class')
    if ctx.role == 'TEACHER':
        qs = qs.filter(teacher=lc.resolve_teacher(ctx))
    plans = list(qs.order_by('lesson_date'))
    if not plans:
        raise ProposalError('Nothing to delete: those lesson plans no longer exist (or are not yours).')
    published = sum(1 for p in plans if p.status == 'PUBLISHED')
    warnings = [f'{published} of these are PUBLISHED and visible to others.'] if published else []
    return {'payload': {'kind': 'delete_lesson_plans', 'ids': [p.id for p in plans]}, 'preview': {
        'kind': 'delete_lesson_plans', 'title': 'Delete lesson plans', 'summary': f'Delete {len(plans)} lesson plan(s) - cannot be undone',
        'columns': ['Date', 'Class', 'Subject', 'Title', 'Status'],
        'rows': [{'id': p.id, 'date': p.lesson_date.isoformat(), 'class': lc.section_label(p.session_class) if p.session_class_id else p.class_obj.name,
                  'subject': p.subject.name, 'title': p.title, 'status': p.status, 'teacher': lc.staff_name(p.teacher)} for p in plans],
        'totals': {'count': len(plans)}, 'warnings': warnings, 'editable': {'remove_ids': True},
    }}


def delete_lesson_plans(ctx, ids=None, teacher_name=None, teacher_id=None, status=None, date_from=None, date_to=None,
                        class_name=None, subject_name=None):
    from . import lms_reads

    if not ids and not (date_from or date_to):
        raise ProposalError('Which lesson plans? Give ids, or a date range. Ask the user - this is a delete.')
    if ids:
        return _delete_card(ctx, [int(i) for i in ids][:100])
    qs, _teacher = lms_reads._plans(ctx, teacher_name, teacher_id, status, date_from, date_to, False, class_name, subject_name)
    found = list(qs.values_list('id', flat=True)[:101])
    if not found:
        raise ProposalError('No lesson plans match that.')
    if len(found) > 100:
        raise ProposalError('More than 100 lesson plans match. Narrow it (teacher, class or dates).')
    return _delete_card(ctx, found)


def revise_delete(ctx, payload, edits):
    remove = {int(i) for i in edits.get('remove_ids') or []}
    if remove - set(payload['ids']):
        raise ProposalError('Some rows to remove are not on this card.')
    return _delete_card(ctx, [i for i in payload['ids'] if i not in remove])


def apply_delete(ctx, payload):
    from lms.views import LessonPlanViewSet

    status, body = call(ctx.user, ctx.school_id, LessonPlanViewSet, {'post': 'bulk_delete'}, 'post',
                        '/api/lms/lesson-plans/bulk_delete/', {'ids': payload['ids']})
    if status != 200:
        return {'ok': False, 'error': str((body or {}).get('error') or (body or {}).get('detail') or f'HTTP {status}')}
    return {'ok': body.get('deleted_count', 0) > 0, 'deleted': body.get('deleted_count', 0), 'requested': body.get('requested_count')}


# ── diary / homework ─────────────────────────────────────────────────────────

ENTRY_TYPES = ['DIARY', 'HOMEWORK', 'CLASSWORK', 'LAB']


def _diary_card(ctx, payload):
    from academic_sessions.models import SessionClass
    from academics.models import Subject
    from hr.models import StaffMember
    from lms.models import Assignment

    sections = {s.id: s for s in SessionClass.objects.filter(school_id=ctx.school_id, id__in={r['section'] for r in payload['rows']})}
    subject = Subject.objects.filter(school_id=ctx.school_id, id=payload['rows'][0]['subject']).first() if payload['rows'] else None
    teachers = {s.id: s for s in StaffMember.objects.filter(school_id=ctx.school_id, id__in={r['teacher'] for r in payload['rows']})}
    rows, preview_rows, warnings = [], [], []
    for r in payload['rows']:
        sc, tch = sections.get(r['section']), teachers.get(r['teacher'])
        if not (sc and tch and subject):
            warnings.append('A class, subject or teacher no longer exists - removed that row.')
            continue
        if not r['description'].strip():
            raise ProposalError('The entry text cannot be empty.')
        same_day = Assignment.objects.filter(
            school_id=ctx.school_id, session_class_id=r['section'], subject_id=r['subject'],
            assignment_type=r['assignment_type'], created_at__date=timezone.localdate(), is_active=True).exists()
        if same_day:
            warnings.append(f'{lc.section_label(sc)} already has a {r["assignment_type"].lower()} entry for {subject.name} today.')
        rows.append(r)
        preview_rows.append({'key': r['key'], 'section': lc.section_label(sc), 'subject': subject.name, 'type': r['assignment_type'],
                             'title': r['title'], 'text': r['description'], 'due': r['due_date'], 'status': r['status'],
                             'teacher': lc.staff_name(tch)})
    if not rows:
        raise ProposalError('Nothing left to create.')
    kind = rows[0]['assignment_type'].title()
    return {'payload': {**payload, 'rows': rows}, 'preview': {
        'kind': 'assignments', 'title': f'Add {kind.lower()} entries',
        'summary': f'{kind} for {", ".join(p["section"] for p in preview_rows)} - {subject.name}',
        'columns': ['Class', 'Subject', 'Type', 'Text'], 'rows': preview_rows, 'totals': {'count': len(rows)},
        'warnings': warnings, 'editable': {'remove_keys': True, 'texts': ['title', 'description'], 'status': ['DRAFT', 'PUBLISHED'], 'due_date': True},
    }}


def create_class_diary(ctx, class_name=None, subject_name=None, text=None, section=None, sections=None, all_sections=False,
                       entry_type='DIARY', title=None, due_date=None, status='PUBLISHED', teacher_name=None, teacher_id=None):
    if not (class_name and subject_name and text and text.strip()):
        raise ProposalError('A class, subject and the text of the entry are needed. Ask the user for what is missing.')
    subject = lc.find_subject(ctx, subject_name)
    teacher = lc.resolve_teacher(ctx, teacher_name, teacher_id) if (ctx.role == 'TEACHER' or teacher_name or teacher_id) else None
    targets = lc.resolve_sections_for_work(ctx, class_name, subject, section, sections, all_sections, teacher)
    today = timezone.localdate()
    due = None
    if due_date:
        d = lc.parse_date(due_date, 'due_date')
        due = timezone.make_aware(datetime.combine(d, datetime.min.time().replace(hour=23, minute=59))).isoformat()
    label = f'{subject.name} {entry_type.title()} - {today.isoformat()}'
    rows = [{'key': str(sc.id), 'section': sc.id, 'class_obj': sc.class_obj_id, 'subject': subject.id, 'teacher': tch.id,
             'title': (title or label)[:200], 'description': text.strip(), 'assignment_type': entry_type,
             'due_date': due, 'status': status} for sc, tch in targets]
    return _diary_card(ctx, {'kind': 'assignments', 'rows': rows})


def revise_diary(ctx, payload, edits):
    payload = {**payload, 'rows': [dict(r) for r in payload['rows']]}
    by_key = {r['key']: r for r in payload['rows']}
    unknown = (set(edits.get('remove_keys') or []) | set(edits.get('texts') or {})) - set(by_key)
    if unknown:
        raise ProposalError('Rows not on this card: ' + ', '.join(sorted(unknown)))
    for k, fields in (edits.get('texts') or {}).items():
        for f, v in fields.items():
            if f not in ('title', 'description'):
                raise ProposalError('Only title and description can be edited.')
            by_key[k][f] = str(v)
    for r in payload['rows']:
        if edits.get('status'):
            if edits['status'] not in ('DRAFT', 'PUBLISHED'):
                raise ProposalError('Status must be DRAFT or PUBLISHED.')
            r['status'] = edits['status']
        if 'due_date' in edits:
            d = edits['due_date']
            r['due_date'] = None if not d else timezone.make_aware(
                datetime.combine(lc.parse_date(d, 'due_date'), datetime.min.time().replace(hour=23, minute=59))).isoformat()
    payload['rows'] = [r for r in payload['rows'] if r['key'] not in set(edits.get('remove_keys') or [])]
    return _diary_card(ctx, payload)


def apply_diary(ctx, payload):
    from lms.views import AssignmentViewSet

    done, failed = [], []
    for r in payload['rows']:
        data = {'class_obj': r['class_obj'], 'session_class': r['section'], 'subject': r['subject'], 'teacher': r['teacher'],
                'title': r['title'], 'description': r['description'], 'assignment_type': r['assignment_type'],
                'requires_submission': False, 'due_date': r['due_date'], 'status': r['status'], 'is_active': True}
        status, body = call(ctx.user, ctx.school_id, AssignmentViewSet, {'post': 'create'}, 'post', '/api/lms/assignments/', data)
        (done if status == 201 else failed).append({'key': r['key'], **({'id': body.get('id')} if status == 201 else {'error': str(body)[:200]})})
    return {'ok': bool(done), 'created': len(done), 'failed': len(failed), 'rows': done, 'errors': failed,
            **({} if done else {'error': 'Nothing could be saved: ' + (failed[0]['error'] if failed else '')})}


# ── registration ─────────────────────────────────────────────────────────────

_O = {'additionalProperties': False}
_WHO = {
    'section': {'type': 'string', 'description': 'One section letter, e.g. "A"'},
    'sections': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Several section letters, e.g. ["A","B"]'},
    'all_sections': {'type': 'boolean', 'description': 'True only if the user said all sections / both'},
    'teacher_name': {'type': 'string', 'description': 'Admins only; teachers always mean themselves ("mere")'},
    'teacher_id': {'type': 'integer'},
}

register(Tool(
    name='plan_lessons_from_book',
    description=(
        'PREPARE lesson plans (drafts) from book chapters/topics/pages across a date range, e.g. "class 4 English '
        'chapters 3 and 4 next month". Spreading follows the depth the user gave: chapters -> equal days per chapter; '
        'unit="topic" -> topics spread over the days; page_from/page_to -> weighted by pages; custom_units when the book has '
        'no structure. Uses all school working days. Shows a card to approve; saves nothing until then. If a section, '
        'book or period is unclear, ask the user first. If the book has no chapters/pages, ask the user.'),
    parameters={'type': 'object', **_O, 'properties': {
        'class_name': {'type': 'string'}, 'subject_name': {'type': 'string'},
        'date_from': {'type': 'string', 'description': 'YYYY-MM-DD (first day of the range)'},
        'date_to': {'type': 'string', 'description': 'YYYY-MM-DD (last day of the range)'},
        'chapters': {'type': 'array', 'items': {'type': 'integer'}, 'description': 'Chapter numbers'},
        'unit': {'type': 'string', 'enum': ['chapter', 'topic']},
        'page_from': {'type': 'integer'}, 'page_to': {'type': 'integer'},
        'custom_units': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Labels given by the user when the book has no structure'},
        'book_id': {'type': 'integer'}, 'skip_saturday': {'type': 'boolean'},
        'on_conflict': {'type': 'string', 'enum': ['skip', 'add'], 'description': 'What to do on a date that already has a plan'},
        'duration_minutes': {'type': 'integer', 'minimum': 10, 'maximum': 180}, **_WHO}},
    handler=plan_lessons_from_book, sub_agent='academics', module='lms', roles=WRITE_ROLES, kind='write',
    revise=revise_plans, apply=apply_plans,
))
register(Tool(
    name='create_lesson_plan',
    description=('PREPARE one short lesson plan (draft) written by you: objectives, activities (description), teaching methods, '
                 'materials. Marked as an AI draft. The user reviews and can edit the text before approving.'),
    parameters={'type': 'object', **_O, 'properties': {
        'class_name': {'type': 'string'}, 'subject_name': {'type': 'string'}, 'lesson_date': {'type': 'string', 'description': 'YYYY-MM-DD'},
        'title': {'type': 'string'}, 'objectives': {'type': 'string'}, 'description': {'type': 'string', 'description': 'Activities / flow of the lesson'},
        'teaching_methods': {'type': 'string'}, 'materials_needed': {'type': 'string'},
        'custom_topics': {'type': 'array', 'items': {'type': 'string'}}, 'duration_minutes': {'type': 'integer', 'minimum': 10, 'maximum': 180},
        'section': _WHO['section'], 'teacher_name': _WHO['teacher_name'], 'teacher_id': _WHO['teacher_id']}},
    handler=create_lesson_plan, sub_agent='academics', module='lms', roles=WRITE_ROLES, kind='write',
    revise=revise_plans, apply=apply_plans,
))
register(Tool(
    name='delete_lesson_plans',
    description=('PREPARE deleting lesson plans (needs ids, or a date range with optional teacher/class/subject/status). '
                 'Shows the plans on a card; nothing is deleted until the user approves. Teachers can only delete their own.'),
    parameters={'type': 'object', **_O, 'properties': {
        'ids': {'type': 'array', 'items': {'type': 'integer'}}, 'teacher_name': _WHO['teacher_name'], 'teacher_id': _WHO['teacher_id'],
        'status': {'type': 'string', 'enum': ['DRAFT', 'PUBLISHED']}, 'date_from': {'type': 'string'}, 'date_to': {'type': 'string'},
        'class_name': {'type': 'string'}, 'subject_name': {'type': 'string'}}},
    handler=delete_lesson_plans, sub_agent='academics', module='lms', roles=WRITE_ROLES, kind='write',
    revise=revise_delete, apply=apply_delete,
))
register(Tool(
    name='create_class_diary',
    description=('PREPARE a diary / homework / classwork / lab entry for one or more sections of a class ("aaj class 5A aur 5B ki '
                 'diary: Math exercise 3.2"). Parents and students see it once published. Shows a card to approve; nothing is saved before that.'),
    parameters={'type': 'object', **_O, 'properties': {
        'class_name': {'type': 'string'}, 'subject_name': {'type': 'string'}, 'text': {'type': 'string', 'description': 'The entry itself'},
        'entry_type': {'type': 'string', 'enum': ENTRY_TYPES}, 'title': {'type': 'string'},
        'due_date': {'type': 'string', 'description': 'YYYY-MM-DD, for homework'}, 'status': {'type': 'string', 'enum': ['DRAFT', 'PUBLISHED']},
        **_WHO}},
    handler=create_class_diary, sub_agent='academics', module='lms', roles=WRITE_ROLES, kind='write',
    revise=revise_diary, apply=apply_diary,
))
