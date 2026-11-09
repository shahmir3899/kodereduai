"""Sending messages to parents through Aura (Parent Communication agent).

Admins and principal only, in-app and push only (owner decisions 2026-11-08; WhatsApp is deprecated). The model drafts, then
`send_message_to_parents` builds a card that shows who will get it (count and sample names) and the exact text. Nothing is sent until a person
presses Approve; voice never approves. Sending goes through the app's own send / broadcast views, so opt-outs, templates and logging apply.
Safety: a daily cap per user, and a warning for large audiences.
"""
from datetime import timedelta

from django.utils import timezone

from ..internal_api import call
from ..registry import ADMINS, ProposalError, Tool, register
from . import lms_common as lc
from .student_tools import _fail, _items, resolve_student

CHANNELS = ('IN_APP', 'PUSH')
EVENTS = ('GENERAL', 'CUSTOM', 'FEE_DUE', 'FEE_OVERDUE', 'EXAM_SCHEDULE', 'EXAM_RESULT', 'ABSENCE', 'TRANSPORT_UPDATE')
DAILY_SENDS = 10
BIG_AUDIENCE = 50


def _sent_today(ctx):
    from ..models import AgentAction
    since = timezone.now() - timedelta(days=1)
    return AgentAction.objects.filter(user=ctx.user, school_id=ctx.school_id, tool_name='send_message_to_parents',
                                      status__in=['executed', 'approved', 'edited'], created_at__gte=since).count()


def _audience(ctx, payload):
    """(label, users) for the audience in the payload, resolved the same way the broadcast view does."""
    from notifications.views import _resolve_recipients_for_broadcast
    from parents.models import ParentChild
    from students.models import Student

    if payload['audience'] == 'student':
        st = Student.objects.filter(school_id=ctx.school_id, id=payload['student_id']).first()
        if st is None:
            raise ProposalError('That student no longer exists.')
        users = {}
        for link in ParentChild.objects.filter(school_id=ctx.school_id, student=st).select_related('parent__user'):
            u = getattr(link.parent, 'user', None)
            if u and u.id:
                users[u.id] = u
        return f"{st.name}'s parents", list(users.values())
    if payload['audience'] == 'fee_pending':
        links = _fee_pending_links(ctx, payload)
        users = {u.id: u for u in (getattr(l.parent, 'user', None) for l in links) if u and u.id}
        where = f" in {payload['class_label']}" if payload.get('class_label') else ''
        return f"parents of {len({l.student_id for l in links})} student(s) with unpaid fees{where}", list(users.values())
    if payload['audience'] == 'absent':
        links = _absent_links(ctx, payload)
        users = {}
        for link in links:
            u = getattr(link.parent, 'user', None)
            if u and u.id:
                users[u.id] = u
        return f"parents of {len({l.student_id for l in links})} student(s) absent on {payload['absent_date']}", list(users.values())
    if payload['audience'] == 'class':
        from academic_sessions.models import SessionClass
        first = SessionClass.objects.filter(school_id=ctx.school_id, class_obj_id=payload['class_obj'], academic_year_id=payload['academic_year'], is_active=True).first()
        if first is None:
            raise ProposalError('That class no longer exists.')
        return (f'parents of {first.display_name} (all sections)',
                _resolve_recipients_for_broadcast(ctx.school, 'PARENT', {'class_obj_id': payload['class_obj'], 'academic_year_id': payload['academic_year']}))
    if payload['audience'] == 'section':
        from academic_sessions.models import SessionClass
        sc = SessionClass.objects.filter(school_id=ctx.school_id, id=payload['section'], is_active=True).first()
        if sc is None:
            raise ProposalError('That class section no longer exists.')
        return f'parents of {lc.section_label(sc)}', _resolve_recipients_for_broadcast(ctx.school, 'PARENT', {'session_class_id': sc.id, 'academic_year_id': sc.academic_year_id})
    return 'ALL parents of the school', _resolve_recipients_for_broadcast(ctx.school, 'PARENT', {})


def _absent_links(ctx, payload):
    """Parent-child links of the students marked ABSENT on the day (optionally only one section)."""
    from attendance.models import AttendanceRecord
    from parents.models import ParentChild

    qs = AttendanceRecord.objects.filter(school_id=ctx.school_id, date=payload['absent_date'], status='ABSENT')
    if payload.get('section'):       # a record has no section of its own: use where the student is enrolled
        qs = qs.filter(student__enrollments__session_class_id=payload['section'], student__enrollments__is_active=True)
    ids = list(qs.values_list('student_id', flat=True).distinct())
    return list(ParentChild.objects.filter(school_id=ctx.school_id, student_id__in=ids).select_related('parent__user'))


def _fee_pending_links(ctx, payload):
    """Parent-child links of students with an UNPAID / PARTIAL fee record in any month (arrears count), optionally within some sections."""
    from finance.models import FeePayment
    from parents.models import ParentChild

    qs = FeePayment.objects.filter(school_id=ctx.school_id, status__in=['UNPAID', 'PARTIAL'], student__is_active=True)
    if payload.get('sections'):
        qs = qs.filter(student__enrollments__session_class_id__in=payload['sections'], student__enrollments__is_active=True)
    ids = list(qs.values_list('student_id', flat=True).distinct())
    return list(ParentChild.objects.filter(school_id=ctx.school_id, student_id__in=ids).select_related('parent__user'))


def _name(u):
    return u.get_full_name() or u.username or u.email or f'User {u.id}'


def _build_send(ctx, payload):
    title, body = (payload.get('title') or '').strip(), (payload.get('body') or '').strip()
    if not title or not body:
        raise ProposalError('A message needs a title and text. Ask the user, or draft them first.')
    if payload['channel'] not in CHANNELS:
        raise ProposalError('Messages go by in-app or push only.')
    label, users = _audience(ctx, payload)
    if not users:
        raise ProposalError(f'There are no parent accounts to send to for {label}. Parents may not be linked yet.')
    names = [_name(u) for u in users[:6]]
    warnings = []
    if len(users) >= BIG_AUDIENCE:
        warnings.append(f'This goes to {len(users)} people.')
    if payload['audience'] == 'all':
        warnings.append('This is a school-wide message to every parent.')
    warnings.append('Parents who turned this kind of message off are skipped by the app and are not counted as sent.')
    used = _sent_today(ctx)
    if used >= DAILY_SENDS:
        raise ProposalError(f'The daily limit of {DAILY_SENDS} sent messages per person has been reached.')
    rows = [{'field': 'To', 'value': f'{label} ({len(users)})'}, {'field': 'Example recipients', 'value': ', '.join(names) + (' ...' if len(users) > 6 else '')},
            {'field': 'Channel', 'value': 'In-app' if payload['channel'] == 'IN_APP' else 'Push notification'},
            {'field': 'Title', 'value': title}, {'field': 'Message', 'value': body}]
    return {'payload': {**payload, 'title': title, 'body': body}, 'preview': {
        'kind': 'parent_message', 'title': 'Send message to parents', 'summary': f'"{title}" to {label} ({len(users)})',
        'columns': ['Field', 'Value'], 'rows': rows, 'totals': {'count': len(users)}, 'warnings': warnings,
        'assumptions': {'event type': payload['event_type'].replace('_', ' ').title()}, 'editable': {}}}


def send_message_to_parents(ctx, title=None, body=None, student_id=None, student_name=None, student_class=None, class_name=None, section=None,
                            all_parents=False, absent_today=False, fee_pending=False, channel=None, event_type=None):
    if fee_pending:
        if absent_today or student_id or student_name or all_parents:
            raise ProposalError('For the parents of fee-pending students, do not also name a student, choose all parents or absent_today.')
        payload = {'kind': 'parent_message', 'title': title, 'body': body, 'channel': (channel or 'IN_APP').upper(),
                   'event_type': (event_type or 'FEE_DUE').upper(), 'audience': 'fee_pending'}
        if payload['event_type'] not in EVENTS:
            raise ProposalError('Event type must be one of: ' + ', '.join(EVENTS))
        if class_name:
            sections = lc.find_sections(ctx, class_name, section)
            if not sections:
                raise ProposalError(f'No class matching "{class_name}" in the current academic year.')
            payload['sections'] = [sc.id for sc in sections]
            payload['class_label'] = sections[0].display_name if len({s.class_obj_id for s in sections}) == 1 and not section else lc.section_label(sections[0])
        return _build_send(ctx, payload)
    if absent_today:
        if student_id or student_name or all_parents:
            raise ProposalError('For the parents of absent students, do not also name a student or choose all parents.')
        absent = {'kind': 'parent_message', 'title': title, 'body': body, 'channel': (channel or 'IN_APP').upper(),
                  'event_type': (event_type or 'ABSENCE').upper(), 'audience': 'absent', 'absent_date': timezone.localdate().isoformat()}
        if absent['event_type'] not in EVENTS:
            raise ProposalError('Event type must be one of: ' + ', '.join(EVENTS))
        if class_name:
            sections = lc.find_sections(ctx, class_name, section)
            if len(sections) != 1:
                raise ProposalError('Which class section? Ask the user.')
            absent['section'] = sections[0].id
        return _build_send(ctx, absent)
    audiences = [bool(student_id or student_name), bool(class_name), bool(all_parents)]
    if sum(audiences) != 1:
        raise ProposalError("Who is the message for: one student's parents, a class, all parents, or the parents of students absent today? Ask the user (exactly one).")
    base = {'kind': 'parent_message', 'title': title, 'body': body, 'channel': (channel or 'IN_APP').upper(),
            'event_type': (event_type or 'GENERAL').upper()}
    if base['event_type'] not in EVENTS:
        raise ProposalError('Event type must be one of: ' + ', '.join(EVENTS))
    if student_id or student_name:
        st = resolve_student(ctx, student_id, student_name, student_class)
        return _build_send(ctx, {**base, 'audience': 'student', 'student_id': st.id})
    if class_name:
        sections = lc.find_sections(ctx, class_name, section)
        if not sections:
            raise ProposalError(f'No class matching "{class_name}" in the current academic year.')
        if len(sections) > 1:
            if len({s.class_obj_id for s in sections}) == 1:            # "Class 5" with sections A and B: the whole class
                return _build_send(ctx, {**base, 'audience': 'class', 'class_obj': sections[0].class_obj_id, 'academic_year': sections[0].academic_year_id})
            raise ProposalError('That matches several classes: ' + ', '.join(lc.section_label(s) for s in sections[:8]) + '. Ask which.')
        return _build_send(ctx, {**base, 'audience': 'section', 'section': sections[0].id})
    return _build_send(ctx, {**base, 'audience': 'all'})


def revise_send(ctx, payload, edits):
    payload = dict(payload)
    for key in ('title', 'body'):
        if edits.get(key):
            payload[key] = str(edits[key])
    return _build_send(ctx, payload)


def apply_send(ctx, payload):
    from notifications.views import BroadcastNotificationView, SendNotificationView

    if payload['audience'] in ('absent', 'fee_pending'):
        sent = skipped = failed = 0
        seen = set()
        links = _absent_links(ctx, payload) if payload['audience'] == 'absent' else _fee_pending_links(ctx, payload)
        for link in links:
            u = getattr(link.parent, 'user', None)
            if not u or u.id in seen:
                continue
            seen.add(u.id)
            st, body = call(ctx.user, ctx.school_id, SendNotificationView, None, 'post', '/api/notifications/send/', {
                'event_type': payload['event_type'], 'channel': payload['channel'], 'recipient_identifier': str(u.id), 'recipient_type': 'PARENT',
                'title': payload['title'], 'body': payload['body'], 'student_id': link.student_id})
            sent += st == 201
            skipped += st == 200
            failed += st not in (200, 201)
        return {'ok': sent > 0, 'sent': sent, 'skipped': skipped, 'failed': failed, **({} if sent else {'error': 'Nobody received the message.'})}
    if payload['audience'] == 'student':
        _, users = _audience(ctx, payload)
        sent = skipped = failed = 0
        for u in users:
            st, body = call(ctx.user, ctx.school_id, SendNotificationView, None, 'post', '/api/notifications/send/', {
                'event_type': payload['event_type'], 'channel': payload['channel'], 'recipient_identifier': str(u.id), 'recipient_type': 'PARENT',
                'title': payload['title'], 'body': payload['body'], 'student_id': payload['student_id']})
            if st == 201:
                sent += 1
            elif st == 200:
                skipped += 1
            else:
                failed += 1
        return {'ok': sent > 0, 'sent': sent, 'skipped': skipped, 'failed': failed,
                **({} if sent else {'error': 'Nobody received the message (' + (f'{skipped} opted out' if skipped else f'{failed} failed') + ').'})}
    data = {'event_type': payload['event_type'], 'channel': payload['channel'], 'recipient_type': 'PARENT', 'title': payload['title'], 'body': payload['body']}
    if payload['audience'] == 'class':
        data.update({'class_obj_id': payload['class_obj'], 'academic_year_id': payload['academic_year']})
    if payload['audience'] == 'section':
        from academic_sessions.models import SessionClass
        sc = SessionClass.objects.get(pk=payload['section'])
        data.update({'session_class_id': sc.id, 'academic_year_id': sc.academic_year_id})
    st, body = call(ctx.user, ctx.school_id, BroadcastNotificationView, None, 'post', '/api/notifications/broadcast/', data)
    if st not in (200, 201):
        return {'ok': False, 'error': _fail(body, 'The message could not be sent.')}
    return {'ok': (body or {}).get('sent', 0) > 0, 'sent': body.get('sent'), 'skipped': body.get('skipped'), 'failed': body.get('failed'),
            **({} if body.get('sent') else {'error': 'Nobody received the message.'})}


def list_recent_messages(ctx, student_name=None, student_id=None, student_class=None, event_type=None, limit=15):
    from notifications.views import NotificationLogViewSet

    params = {'page_size': min(int(limit or 15), 40), **({'event_type': event_type} if event_type else {})}
    if student_name or student_id:
        params['student_id'] = resolve_student(ctx, student_id, student_name, student_class).id
    st, body = call(ctx.user, ctx.school_id, NotificationLogViewSet, {'get': 'list'}, 'get', '/api/notifications/logs/', params)
    if st != 200:
        raise ProposalError(_fail(body, 'Could not read the sent messages.'))
    rows = _items(body)
    return {'count': len(rows), 'messages': [{'when': (r.get('sent_at') or r['created_at'])[:16].replace('T', ' '), 'type': r['event_type_display'],
                                              'channel': r['channel_display'], 'student': r.get('student_name'), 'title': r.get('title'),
                                              'status': r['status_display'], 'read': r['is_read']} for r in rows]}


register(Tool(
    name='send_message_to_parents',
    description=('PREPARE a message to parents for review: one student\'s parents, one class section, or all parents (exactly one audience). '
                 'Write the title and body yourself from the request; do not ask the user for wording, and do not ask "shall I" - the preview card IS the confirmation. In-app by default, or PUSH. '
                 'Nothing is sent until the user presses Approve on the card, which shows who gets it and the exact text. Admin / principal only.'),
    parameters={'type': 'object', 'additionalProperties': False, 'properties': {
        'title': {'type': 'string'}, 'body': {'type': 'string'},
        'student_id': {'type': 'integer'}, 'student_name': {'type': 'string'}, 'student_class': {'type': 'string'},
        'class_name': {'type': 'string'}, 'section': {'type': 'string'}, 'all_parents': {'type': 'boolean'},
        'absent_today': {'type': 'boolean', 'description': 'The parents of students marked absent today. Whole school if no class is given; do not ask which class.'},
        'fee_pending': {'type': 'boolean', 'description': 'The parents of students with unpaid or partly paid fees (event type FEE_DUE). Whole school if no class is given; optionally one class / section.'},
        'channel': {'type': 'string', 'enum': list(CHANNELS)}, 'event_type': {'type': 'string', 'enum': list(EVENTS)}}},
    handler=send_message_to_parents, sub_agent='communication', module='notifications', roles=ADMINS, kind='write', revise=revise_send, apply=apply_send,
))
register(Tool(
    name='list_recent_messages',
    description='Notifications already sent, newest first; for one student or by type. Use to answer "did we already remind them?".',
    parameters={'type': 'object', 'additionalProperties': False, 'properties': {
        'student_id': {'type': 'integer'}, 'student_name': {'type': 'string'}, 'student_class': {'type': 'string'},
        'event_type': {'type': 'string', 'enum': list(EVENTS)}, 'limit': {'type': 'integer'}}},
    handler=list_recent_messages, sub_agent='communication', module='notifications', roles=ADMINS,
))
