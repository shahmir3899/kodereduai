"""Library through Aura (Operations agent): find books, who has what, overdue, stats; issue and return a book.

Admins and principal only (owner decision 2026-11-08). Everything runs through BookViewSet / BookIssueViewSet as the signed-in user, so the
app's rules apply: no copy left, one copy per borrower, borrower limits, and the fine computed on return. Writes only PROPOSE.
Left out: creating books / categories, marking a book lost, changing fine settings.
"""
from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from ..internal_api import call
from ..registry import ADMINS, ProposalError, Tool, register
from . import lms_common as lc
from .hr_tools import _one_staff
from .student_tools import _fail, _items, resolve_student

LIST_LIMIT = 40


def _books(ctx, **params):
    from library.views import BookViewSet

    st, body = call(ctx.user, ctx.school_id, BookViewSet, {'get': 'list'}, 'get', '/api/library/books/', {'page_size': 200, 'is_active': 'true', **params})
    if st != 200:
        raise ProposalError(_fail(body, 'Could not read the books.'))
    return _items(body)


def _book(ctx, book_id=None, title=None):
    """Exactly one active book, or a ProposalError listing the candidates."""
    if book_id:
        hit = [b for b in _books(ctx) if b['id'] == int(book_id)]
        if not hit:
            raise ProposalError(f'No book with id {book_id}.')
        return hit[0]
    if not title:
        raise ProposalError('Which book? Ask the user for the title.')
    pool = _books(ctx, search=title) or [b for b in _books(ctx) if all(w in lc.tokens(b['title']) for w in lc.tokens(title))]
    if not pool:
        raise ProposalError(f'No book matching "{title}".')
    exact = [b for b in pool if b['title'].lower() == title.strip().lower()]
    if len(exact) == 1:
        return exact[0]
    if len(pool) > 1:
        raise ProposalError('Several books match: ' + '; '.join(f"{b['title']} by {b['author']} ({b['available_copies']} available, book_id {b['id']})" for b in pool[:8])
                            + '. Ask which one, then pass book_id.')
    return pool[0]


def _issue_row(i):
    return {'issue_id': i['id'], 'book': i['book_title'], 'borrower': i['borrower_name'], 'type': i['borrower_type'], 'issued': i['issue_date'],
            'due': i['due_date'], 'returned': i.get('return_date'), 'status': i['status'],
            'days_overdue': i.get('days_overdue'), 'fine': float(i['estimated_fine']) if i.get('estimated_fine') is not None else None}


# ── reads ────────────────────────────────────────────────────────────────────

def search_books(ctx, search=None, available_only=False):
    rows = _books(ctx, **({'search': search} if search else {}))
    if available_only:
        rows = [b for b in rows if b['available_copies'] > 0]
    return {'count': len(rows), 'books': [{'book_id': b['id'], 'title': b['title'], 'author': b['author'], 'available': b['available_copies'],
                                           'total': b['total_copies'], 'shelf': b.get('shelf_location') or None} for b in rows[:LIST_LIMIT]],
            **({'note': f'Showing the first {LIST_LIMIT}.'} if len(rows) > LIST_LIMIT else {})}


def list_overdue_books(ctx):
    from library.views import BookIssueViewSet

    st, body = call(ctx.user, ctx.school_id, BookIssueViewSet, {'get': 'overdue'}, 'get', '/api/library/issues/overdue/')
    if st != 200:
        raise ProposalError(_fail(body, 'Could not read the overdue books.'))
    rows = _items(body)
    return {'count': len(rows), 'overdue': [_issue_row(i) for i in rows[:LIST_LIMIT]],
            **({'note': f'Showing the first {LIST_LIMIT}.'} if len(rows) > LIST_LIMIT else {})}


def list_book_issues(ctx, status=None, search=None, student_name=None, student_id=None, staff_name=None, staff_id=None):
    from library.views import BookIssueViewSet

    params = {'page_size': 100}
    if status:
        params['status'] = status
    if search:
        params['search'] = search
    if student_name or student_id:
        params['student_id'] = resolve_student(ctx, student_id, student_name).id
    if staff_name or staff_id:
        params['staff_id'] = _one_staff(ctx, staff_id, staff_name).id
    st, body = call(ctx.user, ctx.school_id, BookIssueViewSet, {'get': 'list'}, 'get', '/api/library/issues/', params)
    if st != 200:
        raise ProposalError(_fail(body, 'Could not read the book issues.'))
    rows = _items(body)
    return {'count': body.get('count', len(rows)) if isinstance(body, dict) else len(rows), 'issues': [_issue_row(i) for i in rows[:LIST_LIMIT]]}


def get_library_stats(ctx):
    from library.views import LibraryStatsView

    st, body = call(ctx.user, ctx.school_id, LibraryStatsView, {'get': 'get'}, 'get', '/api/library/stats/')
    if st != 200:
        raise ProposalError(_fail(body, 'Could not read the library stats.'))
    return body


# ── issue ────────────────────────────────────────────────────────────────────

def _config(ctx):
    from library.models import LibraryConfiguration
    return LibraryConfiguration.objects.filter(school_id=ctx.school_id).first()


def _build_issue(ctx, payload):
    from library.models import Book
    from library.serializers import OPEN_STATUSES
    from library.models import BookIssue

    book = Book.objects.filter(school_id=ctx.school_id, id=payload['book_id'], is_active=True).first()
    if book is None:
        raise ProposalError('That book is no longer available.')
    if book.available_copies <= 0:
        raise ProposalError(f'No copies of "{book.title}" are available right now.')
    due = lc.parse_date(payload['due_date'], 'due_date')
    if due < timezone.localdate():
        raise ProposalError('The due date cannot be in the past.')
    if payload['borrower_type'] == 'STUDENT':
        from students.models import Student
        who = Student.objects.filter(school_id=ctx.school_id, id=payload['borrower_id']).first()
        if who is None:
            raise ProposalError('That student no longer exists.')
        name = who.name
        open_q = BookIssue.objects.filter(student=who, status__in=OPEN_STATUSES, book=book)
    else:
        from hr.models import StaffMember
        who = StaffMember.objects.filter(school_id=ctx.school_id, id=payload['borrower_id']).first()
        if who is None:
            raise ProposalError('That staff member no longer exists.')
        name = lc.staff_name(who)
        open_q = BookIssue.objects.filter(staff=who, status__in=OPEN_STATUSES, book=book)
    if open_q.exists():
        raise ProposalError(f'{name} already has a copy of "{book.title}".')
    warnings = []
    cfg = _config(ctx)
    limit = (cfg.max_books_student if payload['borrower_type'] == 'STUDENT' else cfg.max_books_staff) if cfg else None
    out_now = BookIssue.objects.filter(status__in=OPEN_STATUSES, **{('student' if payload['borrower_type'] == 'STUDENT' else 'staff'): who}).count()
    if limit is not None and out_now >= limit:
        raise ProposalError(f'{name} already has {out_now} book(s) out, which is the limit ({limit}).')
    if book.available_copies == 1:
        warnings.append('This is the last available copy.')
    rows = [{'field': 'Book', 'value': f'{book.title} ({book.author})'}, {'field': 'Borrower', 'value': name},
            {'field': 'Due date', 'value': due.isoformat()}, {'field': 'Copies left after', 'value': book.available_copies - 1}]
    return {'payload': {**payload, 'due_date': due.isoformat()}, 'preview': {
        'kind': 'library_issue', 'title': 'Issue a book', 'summary': f'"{book.title}" to {name}, due {due}',
        'columns': ['Field', 'Value'], 'rows': rows, 'totals': {'count': 1}, 'warnings': warnings, 'editable': {}}}


def issue_book(ctx, book_title=None, book_id=None, student_name=None, student_id=None, staff_name=None, staff_id=None, due_date=None):
    book = _book(ctx, book_id, book_title)
    if (student_name or student_id) and (staff_name or staff_id):
        raise ProposalError('Is the borrower a student or a staff member? Ask the user.')
    if student_name or student_id:
        kind, who = 'STUDENT', resolve_student(ctx, student_id, student_name)
    elif staff_name or staff_id:
        kind, who = 'STAFF', _one_staff(ctx, staff_id, staff_name)
    else:
        raise ProposalError('Who is borrowing the book? Ask the user.')
    cfg = _config(ctx)
    days = cfg.loan_period_days if cfg else 14
    due = due_date or (timezone.localdate() + timedelta(days=days)).isoformat()
    return _build_issue(ctx, {'kind': 'library_issue', 'book_id': book['id'], 'borrower_type': kind, 'borrower_id': who.id, 'due_date': due})


def revise_issue(ctx, payload, edits):
    return _build_issue(ctx, payload)


def apply_issue(ctx, payload):
    from library.views import BookIssueViewSet

    data = {'book': payload['book_id'], 'borrower_type': payload['borrower_type'], 'due_date': payload['due_date'],
            ('student' if payload['borrower_type'] == 'STUDENT' else 'staff'): payload['borrower_id']}
    st, body = call(ctx.user, ctx.school_id, BookIssueViewSet, {'post': 'create'}, 'post', '/api/library/issues/', data)
    if st not in (200, 201):
        return {'ok': False, 'error': _fail(body, 'The book could not be issued.')}
    return {'ok': True, 'issue_id': (body or {}).get('id')}


# ── return ───────────────────────────────────────────────────────────────────

def _build_return(ctx, payload):
    from library.models import BookIssue
    from library.serializers import get_fine_per_day

    rows, keep, warnings = [], [], []
    for iid in payload['issue_ids']:
        i = BookIssue.objects.filter(school_id=ctx.school_id, id=iid).select_related('book', 'student', 'staff').first()
        if i is None or i.status in ('RETURNED', 'LOST'):
            warnings.append(f'Issue {iid} is no longer out and was removed.')
            continue
        today = timezone.localdate()
        late = max(0, (today - i.due_date).days)
        fine = Decimal(late) * get_fine_per_day(i.school_id)
        who = i.student.name if i.student_id else lc.staff_name(i.staff)
        keep.append(i.id)
        rows.append({'id': i.id, 'book': i.book.title, 'borrower': who, 'due': i.due_date.isoformat(), 'days_late': late, 'fine': float(fine)})
    if not rows:
        raise ProposalError('There is nothing left to return.')
    total = round(sum(r['fine'] for r in rows), 2)
    if total:
        warnings.append(f'Fines add up to Rs {total:,.0f}. The fine is recorded on the return; collecting it is a separate step.')
    return {'payload': {**payload, 'issue_ids': keep}, 'preview': {
        'kind': 'library_return', 'title': 'Return books', 'summary': f'{len(rows)} book(s) returned' + (f', fines Rs {total:,.0f}' if total else ''),
        'columns': ['Book', 'Borrower', 'Due', 'Days late', 'Fine'], 'rows': rows, 'totals': {'count': len(rows), 'fine': total},
        'warnings': warnings, 'editable': {'remove': True}}}


def return_book(ctx, issue_id=None, book_title=None, student_name=None, student_id=None, staff_name=None, staff_id=None):
    from library.views import BookIssueViewSet

    params = {'status': 'ISSUED,OVERDUE', 'page_size': 100}
    if issue_id:
        ids = [int(issue_id)]
    else:
        if book_title:
            params['search'] = book_title
        if student_name or student_id:
            params['student_id'] = resolve_student(ctx, student_id, student_name).id
        elif staff_name or staff_id:
            params['staff_id'] = _one_staff(ctx, staff_id, staff_name).id
        elif not book_title:
            raise ProposalError('Which book, or whose books? Ask the user.')
        st, body = call(ctx.user, ctx.school_id, BookIssueViewSet, {'get': 'list'}, 'get', '/api/library/issues/', params)
        if st != 200:
            raise ProposalError(_fail(body, 'Could not look up the issues.'))
        found = _items(body)
        if not found:
            raise ProposalError('No book that is currently out matches that.')
        if len(found) > 1 and not (student_name or student_id or staff_name or staff_id):
            raise ProposalError('Several issued copies match: ' + '; '.join(f"{i['book_title']} to {i['borrower_name']} (issue_id {i['id']})" for i in found[:8])
                                + '. Ask which one.')
        ids = [i['id'] for i in found]
    return _build_return(ctx, {'kind': 'library_return', 'issue_ids': ids})


def revise_return(ctx, payload, edits):
    drop = {int(i) for i in edits.get('remove_ids') or []}
    return _build_return(ctx, {**payload, 'issue_ids': [i for i in payload['issue_ids'] if i not in drop]})


def apply_return(ctx, payload):
    from library.views import BookIssueViewSet

    done, errors = 0, []
    for iid in payload['issue_ids']:
        st, body = call(ctx.user, ctx.school_id, BookIssueViewSet, {'post': 'return_book'}, 'post', f'/api/library/issues/{iid}/return_book/', {}, pk=iid)
        if st == 200:
            done += 1
        else:
            errors.append(f'{iid}: {_fail(body, "failed")}')
    return {'ok': done > 0, 'returned': done, 'errors': errors, **({} if done else {'error': '; '.join(errors)[:300]})}


# ── registration ─────────────────────────────────────────────────────────────

_O = {'additionalProperties': False}
_BORROWER = {'student_name': {'type': 'string'}, 'student_id': {'type': 'integer'}, 'staff_name': {'type': 'string'}, 'staff_id': {'type': 'integer'}}


def _read(name, desc, props, handler):
    register(Tool(name=name, description=desc, parameters={'type': 'object', **_O, 'properties': props}, handler=handler,
                  sub_agent='operations', module='library', roles=ADMINS))


_read('search_books', 'Find books by title, author or ISBN with copies available and shelf. Use for "is Gulistan available?".',
      {'search': {'type': 'string'}, 'available_only': {'type': 'boolean'}}, search_books)
_read('list_overdue_books', 'Library books that are past their due date, with who has them, days late and the fine so far.', {}, list_overdue_books)
_read('list_book_issues', 'Book issues; filter by status (ISSUED, OVERDUE, RETURNED, LOST), a title / borrower search, or a named student or staff member.',
      {'status': {'type': 'string', 'description': 'One status or a comma list, e.g. ISSUED,OVERDUE'}, 'search': {'type': 'string'}, **_BORROWER}, list_book_issues)
_read('get_library_stats', 'Library totals: books, issued, overdue, categories, fines collected.', {}, get_library_stats)

register(Tool(
    name='issue_book',
    description=('PREPARE issuing a library book to a student or a staff member ("Ali ko Gulistan issue kar do"). The due date defaults to the library\'s loan period. '
                 'If several books or people match, ask which. Nothing is issued until the user approves the card.'),
    parameters={'type': 'object', **_O, 'properties': {'book_title': {'type': 'string'}, 'book_id': {'type': 'integer'}, **_BORROWER,
                                                       'due_date': {'type': 'string', 'description': 'YYYY-MM-DD'}}},
    handler=issue_book, sub_agent='operations', module='library', roles=ADMINS, kind='write', revise=revise_issue, apply=apply_issue,
))
register(Tool(
    name='return_book',
    description=('PREPARE returning library books that are out: by issue_id, a book title, or a named student / staff member (all of their books). '
                 'The card shows days late and the fine the app will record. Nothing is returned until the user approves.'),
    parameters={'type': 'object', **_O, 'properties': {'issue_id': {'type': 'integer'}, 'book_title': {'type': 'string'}, **_BORROWER}},
    handler=return_book, sub_agent='operations', module='library', roles=ADMINS, kind='write', revise=revise_return, apply=apply_return,
))
