"""Read gaps found by the coverage matrix (backlog item F, docs/handoff/08F_COVERAGE_MATRIX.md).

Every read goes through the app's own view as the signed-in user, so its role, tenant and module rules apply unchanged; these
tools only trim the answer and cap the rows. A 403 from the view is passed on as a plain sentence, never worked around."""
from ..internal_api import call
from ..registry import ADMINS, ProposalError, Tool, register
from . import lms_common as lc
from .student_tools import _fail, _items, resolve_student

LIMIT = 40
STAFFISH = ADMINS + ('MANAGER', 'TEACHER')
_O = {'additionalProperties': False}
_WHO = {'student_id': {'type': 'integer', 'description': 'Exact id when known (from find_student)'},
        'student_name': {'type': 'string'}, 'student_class': {'type': 'string', 'description': 'Class to tell two students of the same name apart'}}


def _cut(rows, what):
    out = {'count': len(rows), what: rows[:LIMIT]}
    if len(rows) > LIMIT:
        out['note'] = f'Showing the first {LIMIT}.'
    return out


def _read(name, desc, props, handler, roles, sub_agent, module):
    register(Tool(name=name, description=desc, parameters={'type': 'object', **_O, 'properties': props},
                  handler=handler, sub_agent=sub_agent, module=module, roles=roles))


# ── academic years and terms ─────────────────────────────────────────────────

def get_academic_years(ctx):
    from academic_sessions.views import AcademicYearViewSet, TermViewSet

    st, body = call(ctx.user, ctx.school_id, AcademicYearViewSet, {'get': 'list'}, 'get', '/api/sessions/academic-years/', {'page_size': 50})
    if st != 200:
        raise ProposalError(_fail(body, 'Could not read the academic years.'))
    years = [{'id': y['id'], 'name': y['name'], 'from': y['start_date'], 'to': y['end_date'], 'current': y['is_current'],
              'terms': y.get('terms_count'), 'enrolled_students': y.get('enrollment_count')} for y in _items(body)]
    st, body = call(ctx.user, ctx.school_id, TermViewSet, {'get': 'list'}, 'get', '/api/sessions/terms/', {'page_size': 100})
    terms = [{'year': t['academic_year_name'], 'name': t['name'], 'type': t['term_type'], 'from': t['start_date'], 'to': t['end_date'],
              'current': t['is_current']} for t in (_items(body) if st == 200 else [])]
    return {**_cut(years, 'years'), 'terms': terms[:LIMIT]}


# ── report card ──────────────────────────────────────────────────────────────

def get_report_card(ctx, student_id=None, student_name=None, student_class=None, exam_name=None):
    """The card the app would print, as numbers: subjects, totals, grade, rank. The app picks the main exam and the rules
    (weighting, announced-only for non-staff); this only trims it."""
    from academic_sessions.utils import resolve_current_academic_year_id
    from examinations.views import ReportCardView

    st = resolve_student(ctx, student_id, student_name, student_class)
    year = resolve_current_academic_year_id(ctx.school_id)
    if not year:
        raise ProposalError('No current academic year is set for this school.')
    params = {'student_id': st.id, 'academic_year_id': year}
    if exam_name:
        from examinations.models import Exam
        want = lc.tokens(exam_name)
        ids = [e.id for e in Exam.objects.filter(school_id=ctx.school_id, academic_year_id=year, is_active=True)
               if all(w in lc.tokens(e.name) for w in want)]
        if not ids:
            raise ProposalError(f'No exam matching "{exam_name}" this year.')
        params['exam_ids'] = ','.join(str(i) for i in ids)
    status, body = call(ctx.user, ctx.school_id, ReportCardView, None, 'get', '/api/examinations/report-card/', params)
    if status == 403:
        raise ProposalError("You are not allowed to see this student's report card.")
    if status != 200 or not isinstance(body, dict):
        raise ProposalError(_fail(body, 'No report card is available for this student yet.'))
    s = body.get('summary') or {}
    return {
        'student': body.get('student_name'), 'class': body.get('class_name'), 'roll_number': body.get('roll_number'),
        'year': body.get('academic_year_name'), 'exams': body.get('exam_names'), 'main_exam': (body.get('main_exam') or {}).get('name'),
        'draft_not_announced': body.get('is_draft'), 'weighted': body.get('weighted'),
        'subjects': [{'subject': x['subject_name'], 'obtained': x['marks_obtained'], 'total': x['total_marks'], 'percentage': x['percentage'],
                      'grade': x['grade'], 'passed': x['is_pass'], 'absent': x['is_absent'], 'class_average': x.get('class_avg')}
                     for x in (body.get('subjects') or [])[:LIMIT]],
        'total': {'obtained': s.get('total_obtained'), 'possible': s.get('total_possible'), 'percentage': s.get('percentage'),
                  'grade': s.get('grade'), 'rank': s.get('rank'), 'class_size': body.get('class_size'), 'overall_pass': s.get('overall_pass')},
        'attendance': body.get('attendance'), 'remark': body.get('overall_comment') or '',
    }


# ── parents' leave requests (admin view) ─────────────────────────────────────

def list_parent_leave_requests(ctx, status=None, student_id=None, student_name=None, student_class=None):
    from parents.views import AdminLeaveRequestListView

    params = {}
    if status:
        params['status'] = status
    if student_id or student_name:
        params['student_id'] = resolve_student(ctx, student_id, student_name, student_class).id
    code, body = call(ctx.user, ctx.school_id, AdminLeaveRequestListView, None, 'get', '/api/parents/admin/leave-requests/', params)
    if code != 200:
        raise ProposalError(_fail(body, "Could not read the parents' leave requests."))
    items = body if isinstance(body, list) else _items(body)
    rows = [{'request_id': r['id'], 'student': r.get('student_name'), 'parent': r.get('parent_name'), 'from': r.get('start_date'),
             'to': r.get('end_date'), 'reason': (r.get('reason') or '')[:200], 'status': r.get('status'),
             'reviewed_by': r.get('reviewed_by_name'), 'note': r.get('review_note') or ''} for r in items]
    return _cut(rows, 'requests')


# ── student documents ────────────────────────────────────────────────────────

def list_student_documents(ctx, student_id=None, student_name=None, student_class=None):
    from students.views import StudentViewSet

    st = resolve_student(ctx, student_id, student_name, student_class)
    code, body = call(ctx.user, ctx.school_id, StudentViewSet, {'get': 'documents'}, 'get', f'/api/students/{st.id}/documents/', {}, pk=st.id)
    if code != 200:
        raise ProposalError(_fail(body, 'Could not read the documents.'))
    items = body if isinstance(body, list) else _items(body)
    rows = [{'type': d.get('document_type'), 'title': d.get('title'), 'added': str(d.get('created_at') or '')[:10],
             'added_by': d.get('uploaded_by_name')} for d in items]      # the link itself stays in the app
    return {'student': st.name, **_cut(rows, 'documents')}


# ── HR departments and designations ──────────────────────────────────────────

def list_departments(ctx):
    from hr.views import StaffDepartmentViewSet, StaffDesignationViewSet

    code, body = call(ctx.user, ctx.school_id, StaffDepartmentViewSet, {'get': 'list'}, 'get', '/api/hr/departments/', {'page_size': 100})
    if code != 200:
        raise ProposalError(_fail(body, 'Could not read the departments.'))
    depts = [{'name': d['name'], 'staff': d.get('staff_count'), 'active': d.get('is_active', True)} for d in _items(body)]
    code, body = call(ctx.user, ctx.school_id, StaffDesignationViewSet, {'get': 'list'}, 'get', '/api/hr/designations/', {'page_size': 200})
    roles = [{'name': d['name'], 'department': d.get('department_name')} for d in (_items(body) if code == 200 else [])]
    return {**_cut(depts, 'departments'), 'designations': roles[:LIMIT * 2]}


# ── inventory vendors ────────────────────────────────────────────────────────

def _vendor_row(v):
    return {'name': v['name'], 'contact': v.get('contact_person'), 'phone': v.get('phone'), 'email': v.get('email'), 'active': v.get('is_active', True)}


def list_vendors(ctx, search=None):
    from inventory.views import VendorViewSet

    code, body = call(ctx.user, ctx.school_id, VendorViewSet, {'get': 'list'}, 'get', '/api/inventory/vendors/', {'page_size': 200})
    if code != 200:
        raise ProposalError(_fail(body, 'Could not read the vendors.'))
    rows = _items(body)
    if search:                      # same word matching as the other lookups, so "Ahmad" finds "Ahmed Traders" by words, not substrings
        want = lc.tokens(search)
        rows = [v for v in rows if all(any(t.startswith(w) for t in lc.tokens(v['name'])) for w in want)]
    return _cut([_vendor_row(v) for v in rows], 'vendors')


_read('get_academic_years', "The school's academic years (which one is current) and their terms with dates.", {}, get_academic_years, STAFFISH, 'academics', 'academics')
_read('get_report_card', "A student's report card as the app builds it: subjects with marks and grade, total, percentage, rank, attendance. "
      'Defaults to the latest exam this year; name an exam to see that one. Teachers only see students they may see.',
      {**_WHO, 'exam_name': {'type': 'string', 'description': 'e.g. "Mid Term"'}}, get_report_card, STAFFISH, 'exams', 'examinations')
_read('list_parent_leave_requests', 'Leave requests that parents sent for their children (status, dates, reason, who reviewed).',
      {'status': {'type': 'string', 'enum': ['PENDING', 'APPROVED', 'REJECTED']}, **_WHO}, list_parent_leave_requests, ADMINS, 'students', 'students')
_read('list_student_documents', "The documents on a student's file (type, title, date added). The files themselves are opened in the app.",
      dict(_WHO), list_student_documents, ADMINS + ('MANAGER',), 'students', 'students')
_read('list_departments', 'Staff departments with headcount, and the designations in them.', {}, list_departments, ADMINS + ('TEACHER', 'STAFF'), 'hr', 'hr')
_read('list_vendors', 'Inventory vendors / suppliers with contact details.', {'search': {'type': 'string', 'description': 'Part of a name'}},
      list_vendors, ADMINS + ('MANAGER',), 'operations', 'inventory')
