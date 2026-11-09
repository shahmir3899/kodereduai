"""Read tools for lesson plans, books and daily work (diary / homework).

Counting and listing are done by the database, never by the model. A teacher only ever
sees their own plans and assignments, whatever name they ask about.
"""
from datetime import timedelta

from django.utils import timezone

from ..registry import ADMINS, ProposalError, Tool, register
from . import lms_common as lc

READ_ROLES = ADMINS + ('MANAGER', 'TEACHER')
STATUSES = ['DRAFT', 'PUBLISHED']


def _teacher_filter(ctx, teacher_name, teacher_id):
    """Teacher (StaffMember) to filter by, or None for everyone. Teachers are pinned to themselves."""
    if ctx.role == 'TEACHER':
        if teacher_id or teacher_name:
            lc.resolve_teacher(ctx, teacher_name, teacher_id)    # raises if it is someone else
        return lc.resolve_teacher(ctx)
    if teacher_id or teacher_name:
        return lc.resolve_teacher(ctx, teacher_name, teacher_id)
    return None


def _plans(ctx, teacher_name, teacher_id, status, date_from, date_to, all_time, class_name, subject_name):
    from lms.models import LessonPlan

    if not (date_from or date_to or all_time):
        raise ProposalError('Which period? Ask the user: this week, this month, this term or all time '
                            '(then pass date_from/date_to, or all_time=true).')
    qs = LessonPlan.objects.filter(school_id=ctx.school_id, is_active=True).select_related(
        'teacher', 'subject', 'class_obj', 'session_class')
    teacher = _teacher_filter(ctx, teacher_name, teacher_id)
    if teacher:
        qs = qs.filter(teacher=teacher)
    if status:
        qs = qs.filter(status=status)
    if date_from:
        qs = qs.filter(lesson_date__gte=lc.parse_date(date_from, 'date_from'))
    if date_to:
        qs = qs.filter(lesson_date__lte=lc.parse_date(date_to, 'date_to'))
    if class_name:
        sections = lc.find_sections(ctx, class_name)
        if not sections:
            raise ProposalError(f'No class matching "{class_name}".')
        qs = qs.filter(class_obj_id__in={sc.class_obj_id for sc in sections})
    if subject_name:
        qs = qs.filter(subject=lc.find_subject(ctx, subject_name))
    return qs, teacher


_PLAN_FILTERS = {
    'teacher_name': {'type': 'string', 'description': 'Teacher as the user said it, e.g. "Miss Hasnat". Teachers see only themselves.'},
    'teacher_id': {'type': 'integer'},
    'status': {'type': 'string', 'enum': STATUSES},
    'date_from': {'type': 'string', 'description': 'YYYY-MM-DD'},
    'date_to': {'type': 'string', 'description': 'YYYY-MM-DD'},
    'all_time': {'type': 'boolean', 'description': 'Set true only if the user said all time / ever'},
    'class_name': {'type': 'string'},
    'subject_name': {'type': 'string'},
}


def count_lesson_plans(ctx, teacher_name=None, teacher_id=None, status=None, date_from=None, date_to=None,
                       all_time=False, class_name=None, subject_name=None):
    qs, teacher = _plans(ctx, teacher_name, teacher_id, status, date_from, date_to, all_time, class_name, subject_name)
    by_status = {s: qs.filter(status=s).count() for s in STATUSES}
    return {'teacher': lc.staff_name(teacher) if teacher else 'all teachers', 'total': sum(by_status.values()),
            'by_status': by_status, 'period': 'all time' if all_time else f'{date_from or "..."} to {date_to or "..."}'}


def list_lesson_plans(ctx, limit=30, **filters):
    qs, teacher = _plans(ctx, *[filters.get(k) for k in (
        'teacher_name', 'teacher_id', 'status', 'date_from', 'date_to', 'all_time', 'class_name', 'subject_name')])
    rows = [{'id': p.id, 'date': p.lesson_date, 'title': p.title, 'status': p.status, 'subject': p.subject.name,
             'class': (lc.section_label(p.session_class) if p.session_class_id else p.class_obj.name),
             'teacher': lc.staff_name(p.teacher)} for p in qs.order_by('lesson_date')[:min(int(limit), 60)]]
    # The exact period is returned because the model otherwise writes the year from memory (it said 2024 for 2026).
    period = 'all time' if filters.get('all_time') else f'{filters.get("date_from") or "..."} to {filters.get("date_to") or "..."}'
    return {'count': qs.count(), 'shown': len(rows), 'period': period, 'plans': rows}


def get_book_outline(ctx, class_name=None, subject_name=None, book_id=None, chapter_numbers=None):
    from lms.models import Book, Chapter, Topic

    books = Book.objects.filter(school_id=ctx.school_id, is_active=True).select_related('subject', 'class_obj')
    if book_id:
        books = books.filter(id=book_id)
    if class_name:
        sections = lc.find_sections(ctx, class_name)
        if not sections:
            raise ProposalError(f'No class matching "{class_name}".')
        books = books.filter(class_obj_id__in={sc.class_obj_id for sc in sections})
    if subject_name:
        books = books.filter(subject=lc.find_subject(ctx, subject_name))
    out = []
    for b in books[:8]:
        chapters = list(Chapter.objects.filter(book=b).order_by('chapter_number'))
        topics = Topic.objects.filter(chapter__book=b)
        info = {'book_id': b.id, 'title': b.title, 'subject': b.subject.name, 'class': b.class_obj.name,
                'chapter_count': len(chapters), 'topic_count': topics.count(),
                'has_page_numbers': topics.filter(page_start__isnull=False).exists() or any(c.page_start for c in chapters),
                'chapters': [{'number': c.chapter_number, 'title': c.title,
                              'topics': topics.filter(chapter=c).count(), 'pages': [c.page_start, c.page_end]}
                             for c in chapters[:40]]}
        if chapter_numbers:
            wanted = {int(n) for n in chapter_numbers}
            info['topics'] = [{'chapter': t.chapter.chapter_number, 'number': t.topic_number, 'title': t.title,
                               'pages': [t.page_start, t.page_end]}
                              for t in topics.filter(chapter__chapter_number__in=wanted).select_related('chapter')
                              .order_by('chapter__chapter_number', 'topic_number')[:80]]
        out.append(info)
    if not out:
        return {'books': [], 'note': 'No book is saved for that class and subject. Ask the user for the chapters or pages.'}
    return {'books': out}


def list_assignments(ctx, class_name=None, section=None, subject_name=None, assignment_type=None,
                     date_from=None, date_to=None, limit=30):
    from lms.models import Assignment

    today = timezone.localdate()
    d0 = lc.parse_date(date_from, 'date_from') if date_from else today
    d1 = lc.parse_date(date_to, 'date_to') if date_to else today
    qs = Assignment.objects.filter(school_id=ctx.school_id, is_active=True, created_at__date__gte=d0,
                                   created_at__date__lte=d1).select_related('teacher', 'subject', 'class_obj', 'session_class')
    if ctx.role == 'TEACHER':
        qs = qs.filter(teacher=lc.resolve_teacher(ctx))
    if class_name:
        sections = lc.find_sections(ctx, class_name, section)
        qs = qs.filter(class_obj_id__in={sc.class_obj_id for sc in sections})
        if section:
            qs = qs.filter(session_class__in=sections)
    if subject_name:
        qs = qs.filter(subject=lc.find_subject(ctx, subject_name))
    if assignment_type:
        qs = qs.filter(assignment_type=assignment_type)
    rows = [{'id': a.id, 'type': a.assignment_type, 'class': (lc.section_label(a.session_class) if a.session_class_id else a.class_obj.name),
             'subject': a.subject.name, 'title': a.title, 'text': (a.description or '')[:300], 'status': a.status,
             'due': a.due_date, 'teacher': lc.staff_name(a.teacher)} for a in qs.order_by('-created_at')[:min(int(limit), 60)]]
    return {'count': qs.count(), 'shown': len(rows), 'period': f'{d0} to {d1}', 'entries': rows}


def find_teacher(ctx, query):
    rows = [{'teacher_id': s.id, 'name': lc.staff_name(s), 'employee_id': s.employee_id} for s in lc.find_staff(ctx, query)[:8]]
    return {'matches': rows, 'count': len(rows),
            'note': 'Several matches: ask the user which one.' if len(rows) > 1 else ''}


_ANY = {'type': 'object', 'additionalProperties': False}

register(Tool(
    name='count_lesson_plans',
    description=('Count lesson plans, split by Draft/Published, for a teacher / class / subject over a period. '
                 'The period is required: if the user did not say one, ask (this week / this month / this term / all time).'),
    parameters={**_ANY, 'properties': _PLAN_FILTERS},
    handler=count_lesson_plans, sub_agent='academics', module='lms', roles=READ_ROLES,
))
register(Tool(
    name='list_lesson_plans',
    description='List lesson plans (date, title, status, class, subject) for a teacher / class / subject over a period (same period rule as count_lesson_plans).',
    parameters={**_ANY, 'properties': {**_PLAN_FILTERS, 'limit': {'type': 'integer', 'minimum': 1, 'maximum': 60}}},
    handler=list_lesson_plans, sub_agent='academics', module='lms', roles=READ_ROLES,
))
register(Tool(
    name='get_book_outline',
    description=('Books saved for a class and subject, with chapter and topic counts, whether page numbers exist, and '
                 '(when chapter_numbers are given) the topics of those chapters. Use before planning lessons from a book.'),
    parameters={**_ANY, 'properties': {
        'class_name': {'type': 'string'}, 'subject_name': {'type': 'string'}, 'book_id': {'type': 'integer'},
        'chapter_numbers': {'type': 'array', 'items': {'type': 'integer'}}}},
    handler=get_book_outline, sub_agent='academics', module='lms', roles=READ_ROLES,
))
register(Tool(
    name='list_assignments',
    description=('Diary, homework, classwork and lab entries given to a class on a date or date range (default today). '
                 'Set assignment_type to DIARY when the user asks for the diary, HOMEWORK for homework. A teacher asking about their own class needs no name.'),
    parameters={**_ANY, 'properties': {
        'class_name': {'type': 'string'}, 'section': {'type': 'string', 'description': 'Section letter, e.g. "A"'},
        'subject_name': {'type': 'string'},
        'assignment_type': {'type': 'string', 'enum': ['DIARY', 'HOMEWORK', 'CLASSWORK', 'LAB', 'PROJECT']},
        'date_from': {'type': 'string'}, 'date_to': {'type': 'string'}, 'limit': {'type': 'integer', 'minimum': 1, 'maximum': 60}}},
    handler=list_assignments, sub_agent='academics', module='lms', roles=READ_ROLES,
))
register(Tool(
    name='find_teacher',
    description='Find a teacher by name ("Miss Hasnat", partial or misspelled is fine). Returns teacher_id. If several match, ask the user which one.',
    parameters={**_ANY, 'properties': {'query': {'type': 'string'}}, 'required': ['query']},
    handler=find_teacher, sub_agent='directory', module=None, roles=ADMINS + ('MANAGER',), shared=True,
))
