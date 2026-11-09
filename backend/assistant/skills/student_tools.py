"""Students and admissions through Aura: profile, counts, enquiries, and the writes agreed with the owner (2026-11-08).

Reads and writes go through StudentViewSet / AdmissionEnquiryViewSet / AdmissionNoteViewSet as the signed-in user, so the app's
own scope applies: a teacher only reaches students of their own classes, and only admins write enquiries or move a student.
Writes only PROPOSE; a person presses Approve on the card.

Left out on purpose: bulk promotion, batch conversion, exit / transfer / re-admission, deleting students, login accounts, role changes.
Class changes use the app's own Reclassify (audit trail and fee-impact check), never a plain edit of the class field.
Fee edits live in student_fee_tools.py.
"""
from django.utils import timezone

from ..internal_api import call
from ..registry import ADMINS, ProposalError, Tool, register
from . import directory
from . import lms_common as lc

READ_ROLES = ADMINS + ('TEACHER',)
LIST_LIMIT = 40
EDITABLE = {
    'name': 'Name', 'date_of_birth': 'Date of birth', 'gender': 'Gender', 'blood_group': 'Blood group', 'address': 'Address',
    'previous_school': 'Previous school', 'parent_name': 'Parent name', 'parent_phone': 'Parent phone',
    'guardian_name': 'Guardian name', 'guardian_relation': 'Guardian relation', 'guardian_phone': 'Guardian phone',
    'guardian_email': 'Guardian email', 'guardian_occupation': 'Guardian occupation', 'guardian_address': 'Guardian address',
    'emergency_contact': 'Emergency contact',
}


# ── plumbing ─────────────────────────────────────────────────────────────────

def _items(body):
    if isinstance(body, dict) and 'results' in body:
        return body['results']
    return body if isinstance(body, list) else []


def _fail(body, fallback):
    if isinstance(body, dict):
        for key in ('detail', 'error'):
            if body.get(key):
                return str(body[key])[:300]
        if body:
            return str(body)[:300]
    return fallback


def _year_id(ctx):
    from academic_sessions.utils import resolve_current_academic_year_id
    year = resolve_current_academic_year_id(ctx.school_id)
    if not year:
        raise ProposalError('No current academic year is set for this school.')
    return year


def resolve_student(ctx, student_id=None, student_name=None, class_name=None):
    """Exactly one student, or a ProposalError listing the candidates so the model asks."""
    from students.models import Student

    if student_id:
        st = Student.objects.filter(school_id=ctx.school_id, id=int(student_id)).first()
        if st is None:
            raise ProposalError(f'No student with id {student_id}.')
        return st
    if not student_name:
        raise ProposalError('Which student? Ask the user for a name.')
    found = directory.find_student(ctx, student_name, class_name)['matches']
    if not found:
        raise ProposalError(f'No student matching "{student_name}".')
    if len(found) > 1 and found[0]['name'].lower() != student_name.strip().lower():
        raise ProposalError('Several students match: ' + '; '.join(f"{m['name']} ({m['class']}, student_id {m['student_id']})" for m in found[:8])
                            + '. Ask the user which one, then pass student_id.')
    if len(found) > 1 and found[1]['name'].lower() == found[0]['name'].lower():
        raise ProposalError('Two students have exactly that name: ' + '; '.join(f"{m['name']} ({m['class']}, student_id {m['student_id']})" for m in found[:8])
                            + '. Ask which one.')
    return Student.objects.get(pk=found[0]['student_id'])


def _profile(ctx, student):
    """The student as the Students screen would show them to this role; 404 when out of scope."""
    from students.views import StudentViewSet

    status, body = call(ctx.user, ctx.school_id, StudentViewSet, {'get': 'retrieve'}, 'get', f'/api/students/{student.id}/',
                        {'academic_year': _year_id(ctx)}, pk=student.id)
    if status == 404:
        raise ProposalError('That student is not one you can see.')
    if status != 200:
        raise ProposalError(_fail(body, 'Could not read the student.'))
    return body


def _enquiry(ctx, enquiry_id=None, child_name=None, statuses=None):
    from admissions.models import AdmissionEnquiry

    qs = AdmissionEnquiry.objects.filter(school_id=ctx.school_id)
    if statuses:
        qs = qs.filter(status__in=statuses)
    if enquiry_id:
        e = qs.filter(id=int(enquiry_id)).first()
        if e is None:
            raise ProposalError(f'No matching enquiry with id {enquiry_id}.')
        return e
    if not child_name:
        raise ProposalError('Which enquiry? Ask the user for the child name or the enquiry id.')
    want = lc.tokens(child_name)
    hits = [e for e in qs if all(w in lc.tokens(f'{e.name} {e.father_name}') for w in want)]
    if not hits:
        raise ProposalError(f'No enquiry matching "{child_name}".')
    if len(hits) > 1:
        raise ProposalError('Several enquiries match: ' + '; '.join(
            f'{e.name} s/o {e.father_name}, {e.mobile}, {e.get_status_display()} (enquiry_id {e.id})' for e in hits[:8])
            + '. Ask which one, then pass enquiry_id.')
    return hits[0]


# ── reads ────────────────────────────────────────────────────────────────────

def get_student_profile(ctx, student_id=None, student_name=None, student_class=None):
    from academic_sessions.models import StudentEnrollment
    from attendance.models import AttendanceRecord
    from finance.models import FeePayment, FeeStructure, StudentDiscount

    st = resolve_student(ctx, student_id, student_name, student_class)
    body = _profile(ctx, st)
    skip = {'school', 'school_name', 'photo_url', 'created_at', 'updated_at', 'user_username', 'has_user_account'}
    out = {k: v for k, v in body.items() if k not in skip and v not in (None, '', [])}
    out['student_id'] = st.id
    year = _year_id(ctx)
    enr = StudentEnrollment.objects.filter(student=st, academic_year_id=year, is_active=True).select_related('session_class', 'class_obj').first()
    if enr:
        out['class_this_year'] = lc.section_label(enr.session_class) if enr.session_class_id else enr.class_obj.name
    recs = AttendanceRecord.objects.filter(school_id=ctx.school_id, student=st, academic_year_id=year)
    counts = {s: recs.filter(status=s).count() for s in ('PRESENT', 'ABSENT', 'LEAVE')}
    out['attendance_this_year'] = counts
    if ctx.role in ADMINS:      # owner decision: fee figures for principal / admins (and parents later), not teachers
        pending = FeePayment.objects.filter(school_id=ctx.school_id, student=st).exclude(status='PAID').order_by('year', 'month')
        due = [{'fee': p.fee_type, 'month': p.month, 'year': p.year, 'due': float(p.amount_due), 'paid': float(p.amount_paid or 0)} for p in pending[:12]]
        out['fees'] = {'pending_records': pending.count(), 'pending_total': round(sum(max(x['due'] - x['paid'], 0) for x in due), 2) if pending.count() <= 12 else None,
                       'pending': due,
                       'monthly_override': next((float(f.monthly_amount) for f in FeeStructure.objects.filter(
                           school_id=ctx.school_id, student=st, fee_type='MONTHLY', is_active=True)[:1]), None),
                       'discounts': [d.discount.name if d.discount_id else d.scholarship.name
                                     for d in StudentDiscount.objects.filter(school_id=ctx.school_id, student=st, is_active=True)
                                     .select_related('discount', 'scholarship')]}
    return out


def list_students(ctx, class_name=None, section=None, search=None, status=None):
    from students.views import StudentViewSet

    base = {'page_size': 200, 'academic_year': _year_id(ctx)}
    if search:
        base['search'] = search
    if status:
        base['status'] = status
    section_ids = [None]
    if class_name:
        sections = lc.find_sections(ctx, class_name, section)
        if not sections:
            raise ProposalError(f'No class matching "{class_name}" in the current academic year.')
        if len({s.class_obj_id for s in sections}) > 1:
            raise ProposalError('That matches several classes: ' + ', '.join(lc.section_label(s) for s in sections[:8]) + '. Ask which.')
        section_ids = [s.id for s in sections]            # "Class 5" means every section of Class 5; "5A" is one
    rows, total = [], 0
    for sid in section_ids:
        st, body = call(ctx.user, ctx.school_id, StudentViewSet, {'get': 'list'}, 'get', '/api/students/', {**base, **({'session_class_id': sid} if sid else {})})
        if st != 200:
            raise ProposalError(_fail(body, 'Could not read the students.'))
        part = _items(body)
        rows += part
        total += body.get('count', len(part)) if isinstance(body, dict) else len(part)
    return {'count': total, 'students': [
        {'student_id': r['id'], 'name': r['name'], 'class': r.get('class_name'), 'roll': r.get('roll_number'), 'status': r.get('status'),
         'parent_phone': r.get('parent_phone') or r.get('guardian_phone')} for r in rows[:LIST_LIMIT]],
        **({'note': f'Showing the first {LIST_LIMIT}.'} if len(rows) > LIST_LIMIT else {})}


def count_students(ctx):
    from academic_sessions.models import SessionClass, StudentEnrollment
    from django.db.models import Count
    from students.models import Student

    year = _year_id(ctx)
    by_status = {r['status']: r['n'] for r in Student.objects.filter(school_id=ctx.school_id, is_active=True).values('status').annotate(n=Count('id'))}
    labels = {s.id: lc.section_label(s) for s in SessionClass.objects.filter(school_id=ctx.school_id, academic_year_id=year, is_active=True)}
    per = {labels.get(r['session_class'], 'Unplaced'): r['n'] for r in StudentEnrollment.objects.filter(
        school_id=ctx.school_id, academic_year_id=year, is_active=True).values('session_class').annotate(n=Count('id'))}
    return {'total_active': sum(by_status.values()), 'by_status': by_status, 'by_class_this_year': dict(sorted(per.items()))}


def count_enquiries(ctx):
    from admissions.views import AdmissionEnquiryViewSet

    st, body = call(ctx.user, ctx.school_id, AdmissionEnquiryViewSet, {'get': 'status_counts'}, 'get', '/api/admissions/enquiries/status-counts/')
    if st != 200:
        raise ProposalError(_fail(body, 'Could not read the enquiry counts.'))
    return {'new': body.get('NEW', 0), 'confirmed': body.get('CONFIRMED', 0), 'converted': body.get('CONVERTED', 0),
            'cancelled': body.get('CANCELLED', 0), 'total': body.get('total', 0),
            'open': body.get('NEW', 0) + body.get('CONFIRMED', 0)}


def list_enquiries(ctx, status=None, search=None, source=None, date_from=None, date_to=None):
    from admissions.views import AdmissionEnquiryViewSet

    params = {k: v for k, v in {'status': status, 'search': search, 'source': source, 'date_from': date_from, 'date_to': date_to}.items() if v}
    st, body = call(ctx.user, ctx.school_id, AdmissionEnquiryViewSet, {'get': 'list'}, 'get', '/api/admissions/enquiries/', {'page_size': 100, **params})
    if st != 200:
        raise ProposalError(_fail(body, 'Could not read the enquiries.'))
    rows = _items(body)
    return {'count': body.get('count', len(rows)) if isinstance(body, dict) else len(rows), 'enquiries': [
        {'enquiry_id': r['id'], 'child': r['name'], 'father': r['father_name'], 'mobile': r['mobile'], 'status': r['status_display'],
         'source': r['source_display'], 'next_followup': r.get('next_followup_date'), 'grade_level': r.get('applying_for_grade_level')}
        for r in rows[:LIST_LIMIT]]}


def get_enquiry(ctx, enquiry_id=None, child_name=None):
    from admissions.views import AdmissionEnquiryViewSet

    e = _enquiry(ctx, enquiry_id, child_name)
    st, body = call(ctx.user, ctx.school_id, AdmissionEnquiryViewSet, {'get': 'retrieve'}, 'get', f'/api/admissions/enquiries/{e.id}/', pk=e.id)
    if st != 200:
        raise ProposalError(_fail(body, 'Could not read the enquiry.'))
    return {'enquiry_id': body['id'], 'child': body['name'], 'father': body['father_name'], 'mobile': body['mobile'], 'status': body['status_display'],
            'source': body['source_display'], 'grade_level': body.get('applying_for_grade_level'), 'next_followup': body.get('next_followup_date'),
            'notes': body.get('notes') or None, 'converted_student': body.get('converted_student_name'),
            'history': [{'when': n['created_at'][:10], 'by': n.get('user_name'), 'type': n['note_type'], 'text': n['note'][:200]} for n in body.get('notes_list', [])[:15]]}


# ── enquiry writes ───────────────────────────────────────────────────────────

SOURCES = ['WALK_IN', 'PHONE', 'WEBSITE', 'WHATSAPP', 'REFERRAL', 'SOCIAL_MEDIA', 'AD_CAMPAIGN', 'OTHER']


def _build_add_enquiry(ctx, payload):
    from admissions.models import AdmissionEnquiry

    for key, label in (('name', 'child name'), ('father_name', 'father name'), ('mobile', 'mobile number')):
        if not (payload.get(key) or '').strip():
            raise ProposalError(f'The {label} is required. Ask the user.')
    warnings = []
    dup = AdmissionEnquiry.objects.filter(school_id=ctx.school_id, mobile=payload['mobile']).exclude(status='CANCELLED')
    if dup.filter(name__iexact=payload['name']).exists():
        warnings.append('An enquiry for this child and mobile number already exists.')
    elif dup.exists():
        warnings.append(f'{dup.count()} other enquiry(ies) already use this mobile number.')
    rows = [{'field': 'Child', 'value': payload['name']}, {'field': 'Father', 'value': payload['father_name']},
            {'field': 'Mobile', 'value': payload['mobile']}, {'field': 'Source', 'value': payload['source'].replace('_', ' ').title()},
            {'field': 'Applying for', 'value': payload.get('grade_label') or 'not given'},
            {'field': 'Follow-up', 'value': payload.get('next_followup_date') or 'not set'}]
    if payload.get('notes'):
        rows.append({'field': 'Notes', 'value': payload['notes']})
    return {'payload': payload, 'preview': {
        'kind': 'enquiry_form', 'title': 'Add admission enquiry', 'summary': f"{payload['name']} (father {payload['father_name']})",
        'columns': ['Field', 'Value'], 'rows': rows, 'totals': {'count': 1}, 'warnings': warnings, 'editable': {}}}


def add_enquiry(ctx, child_name=None, father_name=None, mobile=None, class_name=None, grade_level=None, source=None,
                next_followup_date=None, notes=None):
    grade_label = None
    if class_name:
        matches = directory.find_class(ctx, class_name)['matches']
        top = [m for m in matches if directory.class_key(m['label']) == directory.class_key(class_name)] or matches[:1]
        if len(top) != 1:
            raise ProposalError('Which class is the child applying for? Ask the user.')
        from students.models import Class
        grade_level = Class.objects.get(pk=top[0]['class_id']).grade_level
        grade_label = top[0]['label']
    elif grade_level is not None:
        grade_label = f'grade level {grade_level}'
    src = (source or 'WALK_IN').upper().replace(' ', '_').replace('-', '_')
    if src not in SOURCES:
        raise ProposalError('Source must be one of: ' + ', '.join(SOURCES))
    follow = lc.parse_date(next_followup_date, 'next_followup_date').isoformat() if next_followup_date else None
    return _build_add_enquiry(ctx, {'kind': 'enquiry_form', 'name': (child_name or '').strip(), 'father_name': (father_name or '').strip(),
                                    'mobile': (mobile or '').strip(), 'applying_for_grade_level': grade_level, 'grade_label': grade_label,
                                    'source': src, 'next_followup_date': follow, 'notes': (notes or '')[:500]})


def revise_add_enquiry(ctx, payload, edits):
    return _build_add_enquiry(ctx, payload)


def apply_add_enquiry(ctx, payload):
    from admissions.views import AdmissionEnquiryViewSet

    data = {k: payload[k] for k in ('name', 'father_name', 'mobile', 'source', 'notes') if payload.get(k)}
    for k in ('applying_for_grade_level', 'next_followup_date'):
        if payload.get(k) is not None:
            data[k] = payload[k]
    st, body = call(ctx.user, ctx.school_id, AdmissionEnquiryViewSet, {'post': 'create'}, 'post', '/api/admissions/enquiries/', data)
    if st not in (200, 201):
        return {'ok': False, 'error': _fail(body, 'The enquiry could not be saved.')}
    return {'ok': True, 'enquiry_id': (body or {}).get('id')}


def _build_note(ctx, payload):
    e = _enquiry(ctx, payload['enquiry_id'])
    return {'payload': payload, 'preview': {
        'kind': 'edit_entry', 'title': 'Add note to enquiry', 'summary': f'{e.name} (father {e.father_name})',
        'columns': ['Field', 'From', 'To'], 'rows': [{'field': 'Note', 'from': '', 'to': payload['note']},
                                                    {'field': 'Type', 'from': '', 'to': payload['note_type']}],
        'totals': {'count': 1}, 'warnings': [], 'editable': {}}}


def add_enquiry_note(ctx, note=None, enquiry_id=None, child_name=None, was_a_call=False):
    if not (note or '').strip():
        raise ProposalError('What should the note say? Ask the user.')
    e = _enquiry(ctx, enquiry_id, child_name)
    return _build_note(ctx, {'kind': 'edit_entry', 'enquiry_id': e.id, 'note': note.strip()[:1000], 'note_type': 'CALL' if was_a_call else 'NOTE'})


def revise_note(ctx, payload, edits):
    return _build_note(ctx, payload)


def apply_note(ctx, payload):
    from admissions.views import AdmissionNoteViewSet

    st, body = call(ctx.user, ctx.school_id, AdmissionNoteViewSet, {'post': 'create'}, 'post',
                    f"/api/admissions/enquiries/{payload['enquiry_id']}/notes/", {'note': payload['note'], 'note_type': payload['note_type']},
                    enquiry_pk=payload['enquiry_id'])
    if st not in (200, 201):
        return {'ok': False, 'error': _fail(body, 'The note could not be saved.')}
    return {'ok': True}


STATUS_NAMES = {'NEW': 'New', 'CONFIRMED': 'Confirmed', 'CANCELLED': 'Cancelled'}


def _build_status(ctx, payload):
    e = _enquiry(ctx, payload['enquiry_id'])
    if e.status == 'CONVERTED':
        raise ProposalError(f'{e.name} is already converted to a student; the status cannot change.')
    if e.status == payload['status']:
        raise ProposalError(f'{e.name} is already {e.get_status_display()}.')
    rows = [{'field': 'Status', 'from': e.get_status_display(), 'to': STATUS_NAMES[payload['status']]}]
    if payload.get('note'):
        rows.append({'field': 'Note', 'from': '', 'to': payload['note']})
    return {'payload': payload, 'preview': {
        'kind': 'edit_entry', 'title': 'Change enquiry status', 'summary': f'{e.name}: {e.get_status_display()} to {STATUS_NAMES[payload["status"]]}',
        'columns': ['Field', 'From', 'To'], 'rows': rows, 'totals': {'count': 1},
        'warnings': (['A confirmed enquiry can then be converted to a student.'] if payload['status'] == 'CONFIRMED' else []), 'editable': {}}}


def change_enquiry_status(ctx, status=None, enquiry_id=None, child_name=None, note=None):
    status = (status or '').upper()
    if status not in STATUS_NAMES:
        raise ProposalError('Status must be NEW, CONFIRMED or CANCELLED. (Converting is a separate step.)')
    e = _enquiry(ctx, enquiry_id, child_name)
    return _build_status(ctx, {'kind': 'edit_entry', 'enquiry_id': e.id, 'status': status, 'note': (note or '')[:300]})


def revise_status(ctx, payload, edits):
    return _build_status(ctx, payload)


def apply_status(ctx, payload):
    from admissions.views import AdmissionEnquiryViewSet

    st, body = call(ctx.user, ctx.school_id, AdmissionEnquiryViewSet, {'patch': 'update_status'}, 'patch',
                    f"/api/admissions/enquiries/{payload['enquiry_id']}/update-status/",
                    {'status': payload['status'], 'note': payload.get('note', '')}, pk=payload['enquiry_id'])
    if st != 200:
        return {'ok': False, 'error': _fail(body, 'The status could not be changed.')}
    return {'ok': True}


def _build_convert(ctx, payload):
    from academic_sessions.models import SessionClass
    from academic_sessions.roll_allocator_service import RollAllocatorService
    from admissions.models import AdmissionEnquiry

    e = AdmissionEnquiry.objects.filter(school_id=ctx.school_id, id=payload['enquiry_id']).first()
    if e is None:
        raise ProposalError('That enquiry no longer exists.')
    if e.status == 'CONVERTED':
        raise ProposalError(f'{e.name} has already been converted to a student.')
    if e.status != 'CONFIRMED':
        raise ProposalError(f'{e.name} is {e.get_status_display()}. An enquiry must be Confirmed before it can be converted; '
                            'offer to change the status to Confirmed first.')
    sc = SessionClass.objects.filter(school_id=ctx.school_id, id=payload['section'], is_active=True).select_related('class_obj').first()
    if sc is None or not sc.class_obj_id:
        raise ProposalError('That class section is not available.')
    roll = RollAllocatorService(school_id=ctx.school_id, academic_year_id=sc.academic_year_id, class_obj_id=sc.class_obj_id,
                                session_class_id=sc.id).lowest_free_roll()
    warnings = ['A student record and enrolment are created. No fee records are created from here; set up fees on the Fees screen or ask Aura afterwards.']
    from students.models import Student
    if Student.objects.filter(school_id=ctx.school_id, name__iexact=e.name, parent_phone=e.mobile, is_active=True).exists():
        warnings.append('A student with the same name and parent phone already exists.')
    rows = [{'field': 'Child', 'value': e.name}, {'field': 'Father', 'value': e.father_name}, {'field': 'Mobile', 'value': e.mobile},
            {'field': 'Class', 'value': lc.section_label(sc)}, {'field': 'Roll number', 'value': roll or 'auto'}]
    return {'payload': payload, 'preview': {
        'kind': 'enquiry_convert', 'title': 'Convert enquiry to student', 'summary': f'{e.name} into {lc.section_label(sc)}',
        'columns': ['Field', 'Value'], 'rows': rows, 'totals': {'count': 1}, 'warnings': warnings, 'editable': {}}}


def convert_enquiry(ctx, class_name=None, section=None, enquiry_id=None, child_name=None):
    e = _enquiry(ctx, enquiry_id, child_name)
    if not class_name:
        raise ProposalError('Which class and section should the student join? Ask the user.')
    sections = lc.find_sections(ctx, class_name, section)
    if not sections:
        raise ProposalError(f'No class matching "{class_name}" in the current academic year.')
    if len(sections) > 1:
        raise ProposalError('That matches several sections: ' + ', '.join(lc.section_label(s) for s in sections[:8]) + '. Ask which.')
    return _build_convert(ctx, {'kind': 'enquiry_convert', 'enquiry_id': e.id, 'section': sections[0].id})


def revise_convert(ctx, payload, edits):
    return _build_convert(ctx, payload)


def apply_convert(ctx, payload):
    from academic_sessions.models import SessionClass
    from admissions.views import AdmissionEnquiryViewSet

    sc = SessionClass.objects.get(pk=payload['section'])
    st, body = call(ctx.user, ctx.school_id, AdmissionEnquiryViewSet, {'post': 'batch_convert'}, 'post', '/api/admissions/enquiries/batch-convert/',
                    {'enquiry_ids': [payload['enquiry_id']], 'academic_year_id': sc.academic_year_id, 'session_class_id': sc.id})
    if st not in (200, 201):
        errs = (body or {}).get('errors') if isinstance(body, dict) else None
        return {'ok': False, 'error': _fail(body, 'The enquiry could not be converted.') + (f' {errs}' if errs else '')}
    done = (body or {}).get('converted', [])
    return {'ok': bool(done), 'student_id': done[0]['student_id'] if done else None, 'roll_number': done[0]['roll_number'] if done else None}


# ── editing a student ────────────────────────────────────────────────────────

def _build_edit(ctx, payload):
    from students.models import Student

    st = Student.objects.filter(school_id=ctx.school_id, id=payload['student_id']).first()
    if st is None:
        raise ProposalError('That student no longer exists.')
    _profile(ctx, st)            # a teacher is stopped here for students outside their classes
    rows = []
    for key, value in payload['changes'].items():
        old = getattr(st, key, '')
        old = old.isoformat() if hasattr(old, 'isoformat') else (old or '')
        if str(old) != str(value):
            rows.append({'field': EDITABLE[key], 'from': old or 'not set', 'to': value or 'cleared'})
    if not rows:
        raise ProposalError(f'{st.name} already has those details. Nothing to change.')
    warnings = []
    if 'name' in payload['changes']:
        if not (payload['changes']['name'] or '').strip():
            raise ProposalError('The name cannot be empty.')
        warnings.append('The new name shows on report cards, receipts and parent screens from now on.')
    return {'payload': payload, 'preview': {
        'kind': 'edit_entry', 'title': 'Update student', 'summary': f'{st.name}: {len(rows)} detail(s)',
        'columns': ['Field', 'From', 'To'], 'rows': rows, 'totals': {'count': len(rows)}, 'warnings': warnings, 'editable': {}}}


def update_student(ctx, student_id=None, student_name=None, student_class=None, **fields):
    st = resolve_student(ctx, student_id, student_name, student_class)
    changes = {k: str(v).strip() for k, v in fields.items() if k in EDITABLE and v is not None}
    if not changes:
        raise ProposalError('Which detail should change? Ask the user.')
    if 'date_of_birth' in changes:
        changes['date_of_birth'] = lc.parse_date(changes['date_of_birth'], 'date_of_birth').isoformat()
    return _build_edit(ctx, {'kind': 'edit_entry', 'student_id': st.id, 'changes': changes})


def revise_edit(ctx, payload, edits):
    return _build_edit(ctx, payload)


def apply_edit(ctx, payload):
    from students.views import StudentViewSet

    st, body = call(ctx.user, ctx.school_id, StudentViewSet, {'patch': 'partial_update'}, 'patch', f"/api/students/{payload['student_id']}/",
                    payload['changes'], pk=payload['student_id'])
    if st != 200:
        return {'ok': False, 'error': _fail(body, 'The student could not be updated.')}
    return {'ok': True, 'changed': list(payload['changes'])}


# ── changing class (Reclassify) ──────────────────────────────────────────────

def _build_reclassify(ctx, payload):
    from academic_sessions.models import SessionClass, StudentEnrollment
    from students.models import Student
    from students.views import StudentViewSet

    st = Student.objects.filter(school_id=ctx.school_id, id=payload['student_id']).first()
    target = SessionClass.objects.filter(school_id=ctx.school_id, id=payload['target'], is_active=True).first()
    if st is None or target is None:
        raise ProposalError('The student or the class no longer exists.')
    year = _year_id(ctx)
    enr = StudentEnrollment.objects.filter(student=st, academic_year_id=year, is_active=True).select_related('session_class', 'class_obj').first()
    if enr is None:
        raise ProposalError(f'{st.name} has no active enrolment in the current academic year, so the class cannot be changed here.')
    if enr.session_class_id == target.id:
        raise ProposalError(f'{st.name} is already in {lc.section_label(target)}.')
    day = payload.get('effective_date') or timezone.localdate().isoformat()
    s, body = call(ctx.user, ctx.school_id, StudentViewSet, {'get': 'reclassify_preview'}, 'get', f'/api/students/{st.id}/reclassify-preview/',
                   {'academic_year_id': year, 'target_session_class_id': target.id, 'effective_date': day}, pk=st.id)
    if s != 200:
        raise ProposalError(_fail(body, 'Could not check the move.'))
    fees = body.get('fees') or {}
    option = payload.get('fee_option', 'keep')
    if option == 'reprice' and fees.get('applies') and not fees.get('can_reprice'):
        raise ProposalError('The fees cannot be re-priced: ' + ' '.join(fees.get('blockers') or []) + ' Offer to keep the fees as they are.')
    old_label = lc.section_label(enr.session_class) if enr.session_class_id else enr.class_obj.name
    rows = [{'field': 'Student', 'value': st.name}, {'field': 'From', 'value': old_label}, {'field': 'To', 'value': lc.section_label(target)},
            {'field': 'Effective from', 'value': body['effective_date']}, {'field': 'New roll number', 'value': body.get('suggested_roll') or 'auto'},
            {'field': 'Reason', 'value': payload['reason']}]
    warnings = []
    w = body.get('warnings') or {}
    if w.get('attendance_since'):
        warnings.append(f"{w['attendance_since']} attendance record(s) dated on or after this day stay with the old class.")
    if w.get('marks_in_year'):
        warnings.append(f"{w['marks_in_year']} mark(s) this year are linked to the old enrolment.")
    if fees.get('applies'):
        for c in fees.get('categories', []):
            rows.append({'field': f"Monthly fee ({c['name']})", 'value': f"{c.get('old_fee')} to {c.get('new_fee')}"})
        rows.append({'field': 'Fees', 'value': 'Re-price unpaid months from the move' if option == 'reprice' else 'Keep months already generated as they are'})
        if option == 'keep' and any(c.get('old_fee') != c.get('new_fee') for c in fees.get('categories', [])):
            warnings.append('The fee differs in the new class. Ask Aura to re-price if the unpaid months should follow it.')
        if fees.get('annual_note'):
            warnings.append(fees['annual_note'])
    return {'payload': {**payload, 'effective_date': body['effective_date']}, 'preview': {
        'kind': 'reclassify', 'title': 'Change class', 'summary': f'{st.name}: {old_label} to {lc.section_label(target)}',
        'columns': ['Field', 'Value'], 'rows': rows, 'totals': {'count': 1}, 'warnings': warnings, 'editable': {}}}


def reclassify_student(ctx, class_name=None, section=None, reason=None, student_id=None, student_name=None, student_class=None,
                       effective_date=None, reprice_fees=False):
    st = resolve_student(ctx, student_id, student_name, student_class)
    if not (reason or '').strip():
        raise ProposalError('The app needs a reason for a class change. Ask the user.')
    if not class_name:
        raise ProposalError('Which class should the student move to? Ask the user.')
    sections = lc.find_sections(ctx, class_name, section)
    if not sections:
        raise ProposalError(f'No class matching "{class_name}" in the current academic year.')
    if len(sections) > 1:
        raise ProposalError('That matches several sections: ' + ', '.join(lc.section_label(s) for s in sections[:8]) + '. Ask which.')
    return _build_reclassify(ctx, {'kind': 'reclassify', 'student_id': st.id, 'target': sections[0].id, 'reason': reason.strip()[:300],
                                   'effective_date': lc.parse_date(effective_date, 'effective_date').isoformat() if effective_date else None,
                                   'fee_option': 'reprice' if reprice_fees else 'keep'})


def revise_reclassify(ctx, payload, edits):
    return _build_reclassify(ctx, payload)


def apply_reclassify(ctx, payload):
    from students.views import StudentViewSet

    data = {'academic_year_id': _year_id(ctx), 'target_session_class_id': payload['target'], 'reason': payload['reason'],
            'effective_date': payload['effective_date'], 'fee_option': payload['fee_option']}
    st, body = call(ctx.user, ctx.school_id, StudentViewSet, {'post': 'reclassify'}, 'post', f"/api/students/{payload['student_id']}/reclassify/",
                    data, pk=payload['student_id'])
    if st != 200:
        return {'ok': False, 'error': _fail(body, 'The class could not be changed.')}
    return {'ok': True, 'new_roll_number': body.get('new_roll_number'), 'fee_changes': body.get('fee_changes')}


# ── registration ─────────────────────────────────────────────────────────────

_O = {'additionalProperties': False}
_WHO = {'student_id': {'type': 'integer', 'description': 'Exact id when known (from find_student)'},
        'student_name': {'type': 'string'}, 'student_class': {'type': 'string', 'description': 'Class to tell two students of the same name apart'}}
_ENQ = {'enquiry_id': {'type': 'integer'}, 'child_name': {'type': 'string', 'description': "Child's or father's name"}}
_DATE = {'type': 'string', 'description': 'YYYY-MM-DD'}


def _read(name, desc, props, handler, roles):
    register(Tool(name=name, description=desc, parameters={'type': 'object', **_O, 'properties': props},
                  handler=handler, sub_agent='students', module='students', roles=roles))


def _read_adm(name, desc, props, handler):
    register(Tool(name=name, description=desc, parameters={'type': 'object', **_O, 'properties': props},
                  handler=handler, sub_agent='students', module='admissions', roles=ADMINS))


def _write(name, desc, props, propose, revise, apply, module, roles=ADMINS):
    register(Tool(name=name, description=desc, parameters={'type': 'object', **_O, 'properties': props}, handler=propose,
                  sub_agent='students', module=module, roles=roles, kind='write', revise=revise, apply=apply))


_read('get_student_profile', 'Everything the Students screen shows about one student (class, guardian details, status, attendance this year); admins and '
      'principal also get fee status, the monthly fee override and discounts. A teacher only reaches students of their own classes.',
      dict(_WHO), get_student_profile, READ_ROLES)
_read('list_students', 'Students of a class section (or search by name) with roll number, status and parent phone.',
      {'class_name': {'type': 'string'}, 'section': {'type': 'string'}, 'search': {'type': 'string'},
       'status': {'type': 'string', 'description': 'e.g. ACTIVE, WITHDRAWN, GRADUATED'}}, list_students, READ_ROLES)
_read('count_students', 'How many students the school has: total active, by status, and by class section this year.', {}, count_students, ADMINS)
_read_adm('count_enquiries', 'Admission enquiry counts by status (new, confirmed, converted, cancelled) and how many are still open.', {}, count_enquiries)
_read_adm('list_enquiries', 'Admission enquiries, newest first; filter by status, source, dates or a name / mobile search.',
          {'status': {'type': 'string', 'enum': ['NEW', 'CONFIRMED', 'CONVERTED', 'CANCELLED']}, 'search': {'type': 'string'},
           'source': {'type': 'string', 'enum': SOURCES}, 'date_from': _DATE, 'date_to': _DATE}, list_enquiries)
_read_adm('get_enquiry', 'One enquiry with its notes and history.', dict(_ENQ), get_enquiry)

_write('add_enquiry', 'PREPARE a new admission enquiry. Needs the child name, father name and mobile number (ask if missing). Nothing is saved until the user approves.',
       {'child_name': {'type': 'string'}, 'father_name': {'type': 'string'}, 'mobile': {'type': 'string'}, 'class_name': {'type': 'string', 'description': 'Class applied for'},
        'grade_level': {'type': 'integer'}, 'source': {'type': 'string', 'enum': SOURCES}, 'next_followup_date': _DATE, 'notes': {'type': 'string'}},
       add_enquiry, revise_add_enquiry, apply_add_enquiry, 'admissions')
_write('add_enquiry_note', 'PREPARE a note on an enquiry ("Ali ke walid se baat hui, kal aayenge"). Set was_a_call for a phone call. Nothing is saved until the user approves.',
       {**_ENQ, 'note': {'type': 'string'}, 'was_a_call': {'type': 'boolean'}}, add_enquiry_note, revise_note, apply_note, 'admissions')
_write('change_enquiry_status', 'PREPARE changing an enquiry to NEW, CONFIRMED or CANCELLED (a converted one cannot change). Nothing changes until the user approves.',
       {**_ENQ, 'status': {'type': 'string', 'enum': list(STATUS_NAMES)}, 'note': {'type': 'string'}}, change_enquiry_status, revise_status, apply_status, 'admissions')
_write('convert_enquiry', 'PREPARE turning ONE confirmed enquiry into a student in a class section (not several at once). Ask which class and section if not given. '
       'If the enquiry is not Confirmed yet, say so and offer to confirm it first. Nothing is created until the user approves.',
       {**_ENQ, 'class_name': {'type': 'string'}, 'section': {'type': 'string'}}, convert_enquiry, revise_convert, apply_convert, 'admissions')
_write('update_student', 'PREPARE changes to one student: name, date of birth, gender, address, parent / guardian details, emergency contact. '
       'Class changes and fees are separate tools. Nothing is saved until the user approves.',
       {**_WHO, **{k: {'type': 'string'} for k in EDITABLE}}, update_student, revise_edit, apply_edit, 'students', READ_ROLES)
_write('reclassify_student', 'PREPARE moving ONE student to another class section for the current year, using the app\'s Reclassify (needs a reason; '
       'optional effective date; reprice_fees=true re-prices unpaid months at the new class fee). The card shows the new roll number and the fee impact. '
       'Nothing moves until the user approves. This is not for promotion of a whole class.',
       {**_WHO, 'class_name': {'type': 'string', 'description': 'Class to move TO'}, 'section': {'type': 'string'}, 'reason': {'type': 'string'},
        'effective_date': _DATE, 'reprice_fees': {'type': 'boolean'}}, reclassify_student, revise_reclassify, apply_reclassify, 'students')
