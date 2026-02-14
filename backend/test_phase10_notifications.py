"""
Phase 10 — Notifications Module Tests
=======================================
Covers: NotificationTemplate CRUD, NotificationLog read/filter,
        NotificationPreference CRUD, SchoolNotificationConfig GET/PUT,
        MyNotifications, UnreadCount, MarkRead, MarkAllRead,
        SendNotification, Analytics, AI Chat, permissions, isolation.

Run:
    cd backend
    python manage.py shell -c "exec(open('test_phase10_notifications.py', encoding='utf-8').read())"
"""

import json
from datetime import date, timedelta
from django.utils import timezone
from django.test import Client

# ── Seed data ────────────────────────────────────────────────────────────
exec(open('seed_test_data.py', encoding='utf-8').read())
seed = get_seed_data()
reset_counters()

org        = seed['org']
school_a   = seed['school_a']
school_b   = seed['school_b']
SID_A      = seed['SID_A']
SID_B      = seed['SID_B']
users      = seed['users']
tokens     = seed['tokens']
students   = seed['students']

token_admin     = tokens['admin']
token_principal = tokens['principal']
token_teacher   = tokens['teacher']
token_admin_b   = tokens['admin_b']

P10 = "P10NTF_"

print("\n" + "=" * 70)
print("  PHASE 10: NOTIFICATIONS MODULE TESTS")
print("=" * 70)

# ── Model imports ────────────────────────────────────────────────────────
from notifications.models import (
    NotificationTemplate, NotificationLog,
    NotificationPreference, SchoolNotificationConfig,
)
from users.models import User

student_1 = students[0]  # Ali Hassan
student_2 = students[1]  # Sara Khan

# ── Clean up leftover P10 data ──────────────────────────────────────────
NotificationLog.objects.filter(title__startswith=P10).delete()
NotificationLog.objects.filter(body__startswith=P10).delete()
NotificationPreference.objects.filter(school=school_a, event_type='CUSTOM').delete()
NotificationTemplate.objects.filter(name__startswith=P10).delete()
SchoolNotificationConfig.objects.filter(school=school_a).delete()

# ==================================================================
# LEVEL A: NOTIFICATION TEMPLATES API
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL A: NOTIFICATION TEMPLATES API")
print("=" * 70)

# A1: Create template (Admin)
resp = api_post('/api/notifications/templates/', {
    'name': f'{P10}Absence Alert',
    'event_type': 'ABSENCE',
    'channel': 'IN_APP',
    'subject_template': 'Absence: {{student_name}}',
    'body_template': 'Dear Parent, {{student_name}} of {{class_name}} was absent on {{date}}.',
}, token_admin, SID_A)
check("A1  Create template (Admin)", resp.status_code == 201,
      f"status={resp.status_code} body={resp.content[:200]}")
tpl_absence_id = resp.json().get('id') if resp.status_code == 201 else None

# A2: Create second template
resp = api_post('/api/notifications/templates/', {
    'name': f'{P10}Fee Reminder',
    'event_type': 'FEE_DUE',
    'channel': 'IN_APP',
    'subject_template': 'Fee Due: {{student_name}}',
    'body_template': 'Fee of {{amount}} is due for {{student_name}}.',
}, token_admin, SID_A)
check("A2  Create second template", resp.status_code == 201,
      f"status={resp.status_code}")
tpl_fee_id = resp.json().get('id') if resp.status_code == 201 else None

# A3: Create template (Principal)
resp = api_post('/api/notifications/templates/', {
    'name': f'{P10}General Notice',
    'event_type': 'GENERAL',
    'channel': 'IN_APP',
    'subject_template': '{{title}}',
    'body_template': '{{body}}',
}, token_principal, SID_A)
check("A3  Create template (Principal)", resp.status_code == 201,
      f"status={resp.status_code}")

# A4: Create template (Teacher) -> 403
resp = api_post('/api/notifications/templates/', {
    'name': f'{P10}Should Fail',
    'event_type': 'GENERAL',
    'channel': 'IN_APP',
    'body_template': 'test',
}, token_teacher, SID_A)
check("A4  Create template (Teacher) -> 403", resp.status_code == 403,
      f"status={resp.status_code}")

# A5: List templates
resp = api_get('/api/notifications/templates/', token_admin, SID_A)
data = resp.json() if resp.status_code == 200 else []
p10_templates = [t for t in data if t.get('name', '').startswith(P10)]
check("A5  List templates", resp.status_code == 200 and len(p10_templates) >= 3,
      f"status={resp.status_code} p10_count={len(p10_templates)}")

# A6: Retrieve single template
if tpl_absence_id:
    resp = api_get(f'/api/notifications/templates/{tpl_absence_id}/', token_admin, SID_A)
    check("A6  Retrieve template", resp.status_code == 200,
          f"status={resp.status_code}")
    if resp.status_code == 200:
        d = resp.json()
        check("A6b Has school_name", d.get('school_name') is not None,
              f"school_name={d.get('school_name')}")
else:
    check("A6  Retrieve template", False, "no id")
    check("A6b Has school_name", False, "no id")

# A7: Update template
if tpl_absence_id:
    resp = api_patch(f'/api/notifications/templates/{tpl_absence_id}/', {
        'body_template': 'Updated: {{student_name}} was absent on {{date}} from {{class_name}}.',
    }, token_admin, SID_A)
    check("A7  Update template", resp.status_code == 200,
          f"status={resp.status_code}")
else:
    check("A7  Update template", False, "no id")

# A8: Delete template (soft or hard)
tpl_to_delete = NotificationTemplate.objects.create(
    school=school_a, name=f'{P10}ToDelete',
    event_type='CUSTOM', channel='IN_APP', body_template='temp',
)
resp = api_delete(f'/api/notifications/templates/{tpl_to_delete.id}/', token_admin, SID_A)
check("A8  Delete template", resp.status_code in (200, 204),
      f"status={resp.status_code}")

# A9: Teacher can't read templates -> 403 (IsSchoolAdmin, not ReadOnly)
resp = api_get('/api/notifications/templates/', token_teacher, SID_A)
check("A9  Teacher can't read templates -> 403", resp.status_code == 403,
      f"status={resp.status_code}")

# A10: School B isolation
resp = api_get('/api/notifications/templates/', token_admin_b, SID_B)
data = resp.json() if resp.status_code == 200 else []
p10_in_b = [t for t in data if t.get('name', '').startswith(P10)]
check("A10 School B isolation (templates)", resp.status_code == 200 and len(p10_in_b) == 0,
      f"status={resp.status_code} p10_count={len(p10_in_b)}")


# ==================================================================
# LEVEL B: SCHOOL NOTIFICATION CONFIG
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL B: SCHOOL NOTIFICATION CONFIG")
print("=" * 70)

# B1: Get config (auto-creates via get_or_create)
resp = api_get('/api/notifications/config/', token_admin, SID_A)
check("B1  Get notification config", resp.status_code == 200,
      f"status={resp.status_code} body={resp.content[:200]}")
if resp.status_code == 200:
    d = resp.json()
    check("B1b Default in_app_enabled=True", d.get('in_app_enabled') == True,
          f"in_app={d.get('in_app_enabled')}")
    check("B1c Default whatsapp_enabled=False", d.get('whatsapp_enabled') == False,
          f"whatsapp={d.get('whatsapp_enabled')}")
else:
    check("B1b Default in_app_enabled=True", False, "no response")
    check("B1c Default whatsapp_enabled=False", False, "no response")

# B2: Update config
resp = _client.put(
    '/api/notifications/config/',
    data=json.dumps({
        'in_app_enabled': True,
        'whatsapp_enabled': True,
        'sms_enabled': False,
        'email_enabled': False,
        'fee_reminder_day': 10,
    }),
    HTTP_AUTHORIZATION=f'Bearer {token_admin}',
    HTTP_X_SCHOOL_ID=str(SID_A),
    content_type='application/json',
)
check("B2  Update config (PUT)", resp.status_code == 200,
      f"status={resp.status_code}")
if resp.status_code == 200:
    d = resp.json()
    check("B2b whatsapp now enabled", d.get('whatsapp_enabled') == True,
          f"whatsapp={d.get('whatsapp_enabled')}")
    check("B2c fee_reminder_day=10", d.get('fee_reminder_day') == 10,
          f"day={d.get('fee_reminder_day')}")
else:
    check("B2b whatsapp now enabled", False, "no response")
    check("B2c fee_reminder_day=10", False, "no response")

# B3: Teacher can't access config -> 403
resp = api_get('/api/notifications/config/', token_teacher, SID_A)
check("B3  Teacher can't access config -> 403", resp.status_code == 403,
      f"status={resp.status_code}")


# ==================================================================
# LEVEL C: NOTIFICATION PREFERENCES
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL C: NOTIFICATION PREFERENCES")
print("=" * 70)

admin_user = users['admin']
teacher_user = users['teacher']

# C1: Create preference (opt-out for a user)
resp = api_post('/api/notifications/preferences/', {
    'school': SID_A,
    'user': admin_user.id,
    'channel': 'IN_APP',
    'event_type': 'CUSTOM',
    'is_enabled': False,
}, token_admin, SID_A)
check("C1  Create preference (user opt-out)", resp.status_code == 201,
      f"status={resp.status_code} body={resp.content[:200]}")
pref_1_id = resp.json().get('id') if resp.status_code == 201 else None

# C2: Create preference for student
resp = api_post('/api/notifications/preferences/', {
    'school': SID_A,
    'student': student_1.id,
    'channel': 'IN_APP',
    'event_type': 'CUSTOM',
    'is_enabled': True,
}, token_admin, SID_A)
check("C2  Create preference (student)", resp.status_code == 201,
      f"status={resp.status_code}")
pref_2_id = resp.json().get('id') if resp.status_code == 201 else None

# C3: List preferences
resp = api_get('/api/notifications/preferences/', token_admin, SID_A)
data = resp.json() if resp.status_code == 200 else []
check("C3  List preferences", resp.status_code == 200 and len(data) >= 2,
      f"status={resp.status_code} count={len(data)}")

# C4: Update preference
if pref_1_id:
    resp = api_patch(f'/api/notifications/preferences/{pref_1_id}/', {
        'is_enabled': True,
    }, token_admin, SID_A)
    check("C4  Update preference", resp.status_code == 200,
          f"status={resp.status_code}")
else:
    check("C4  Update preference", False, "no id")

# C5: Delete preference
if pref_2_id:
    resp = api_delete(f'/api/notifications/preferences/{pref_2_id}/', token_admin, SID_A)
    check("C5  Delete preference", resp.status_code in (200, 204),
          f"status={resp.status_code}")
else:
    check("C5  Delete preference", False, "no id")

# C6: Teacher can create own preferences (HasSchoolAccess, not IsSchoolAdmin)
resp = api_post('/api/notifications/preferences/', {
    'school': SID_A,
    'user': teacher_user.id,
    'channel': 'IN_APP',
    'event_type': 'CUSTOM',
    'is_enabled': False,
}, token_teacher, SID_A)
check("C6  Teacher can create preference", resp.status_code == 201,
      f"status={resp.status_code}")


# ==================================================================
# LEVEL D: SEND NOTIFICATION & NOTIFICATION LOGS
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL D: SEND NOTIFICATION & LOGS")
print("=" * 70)

# D1: Send IN_APP notification (Admin)
resp = api_post('/api/notifications/send/', {
    'event_type': 'GENERAL',
    'channel': 'IN_APP',
    'recipient_identifier': str(admin_user.id),
    'recipient_type': 'ADMIN',
    'title': f'{P10}Test General Notice',
    'body': f'{P10}This is a test notification body.',
}, token_admin, SID_A)
check("D1  Send IN_APP notification", resp.status_code in (200, 201),
      f"status={resp.status_code} body={resp.content[:200]}")
log_1_id = None
if resp.status_code == 201:
    log_1_id = resp.json().get('id')

# D2: Send notification with student context
resp = api_post('/api/notifications/send/', {
    'event_type': 'ABSENCE',
    'channel': 'IN_APP',
    'recipient_identifier': str(admin_user.id),
    'recipient_type': 'ADMIN',
    'title': f'{P10}Absence Alert',
    'body': f'{P10}Student {student_1.name} was absent today.',
    'student_id': student_1.id,
}, token_admin, SID_A)
check("D2  Send notification with student", resp.status_code in (200, 201),
      f"status={resp.status_code}")
log_2_id = None
if resp.status_code == 201:
    log_2_id = resp.json().get('id')
    d = resp.json()
    check("D2b Log has student_name", d.get('student_name') is not None,
          f"student_name={d.get('student_name')}")

# D3: Send notification (Teacher) -> 403
resp = api_post('/api/notifications/send/', {
    'event_type': 'GENERAL',
    'channel': 'IN_APP',
    'recipient_identifier': str(admin_user.id),
    'title': f'{P10}Should fail',
    'body': f'{P10}test',
}, token_teacher, SID_A)
check("D3  Send notification (Teacher) -> 403", resp.status_code == 403,
      f"status={resp.status_code}")

# D4: Send with invalid event_type -> 400
resp = api_post('/api/notifications/send/', {
    'event_type': 'INVALID_TYPE',
    'channel': 'IN_APP',
    'recipient_identifier': 'test',
    'body': 'test',
}, token_admin, SID_A)
check("D4  Invalid event_type -> 400", resp.status_code == 400,
      f"status={resp.status_code}")

# D5: Send more notifications for log/filter tests
for i in range(3):
    api_post('/api/notifications/send/', {
        'event_type': 'FEE_DUE',
        'channel': 'IN_APP',
        'recipient_identifier': str(admin_user.id),
        'recipient_type': 'ADMIN',
        'title': f'{P10}Fee Reminder #{i+1}',
        'body': f'{P10}Fee reminder body #{i+1}',
        'student_id': student_1.id,
    }, token_admin, SID_A)

# D6: List notification logs
resp = api_get('/api/notifications/logs/', token_admin, SID_A)
data = resp.json() if resp.status_code == 200 else {'results': []}
# logs might be paginated
results = data.get('results', data) if isinstance(data, dict) else data
p10_logs = [l for l in results if l.get('title', '').startswith(P10) or l.get('body', '').startswith(P10)]
check("D6  List notification logs", resp.status_code == 200 and len(p10_logs) >= 5,
      f"status={resp.status_code} p10_count={len(p10_logs)}")

# D7: Filter logs by channel
resp = api_get('/api/notifications/logs/?channel=IN_APP', token_admin, SID_A)
check("D7  Filter logs by channel", resp.status_code == 200,
      f"status={resp.status_code}")

# D8: Filter logs by event_type
resp = api_get('/api/notifications/logs/?event_type=FEE_DUE', token_admin, SID_A)
data = resp.json() if resp.status_code == 200 else {'results': []}
results = data.get('results', data) if isinstance(data, dict) else data
fee_logs = [l for l in results if l.get('title', '').startswith(P10)]
check("D8  Filter logs by event_type=FEE_DUE", resp.status_code == 200 and len(fee_logs) >= 3,
      f"status={resp.status_code} count={len(fee_logs)}")

# D9: Filter logs by student_id
resp = api_get(f'/api/notifications/logs/?student_id={student_1.id}', token_admin, SID_A)
data = resp.json() if resp.status_code == 200 else {'results': []}
results = data.get('results', data) if isinstance(data, dict) else data
check("D9  Filter logs by student_id", resp.status_code == 200 and len(results) >= 1,
      f"status={resp.status_code} count={len(results)}")

# D10: Retrieve single log
if log_1_id:
    resp = api_get(f'/api/notifications/logs/{log_1_id}/', token_admin, SID_A)
    check("D10 Retrieve single log", resp.status_code == 200,
          f"status={resp.status_code}")
    if resp.status_code == 200:
        d = resp.json()
        check("D10b Has display fields",
              d.get('channel_display') is not None and d.get('status_display') is not None,
              f"channel_display={d.get('channel_display')}")
else:
    check("D10 Retrieve single log", False, "no id")
    check("D10b Has display fields", False, "no id")

# D11: Logs are read-only (POST should fail)
resp = api_post('/api/notifications/logs/', {
    'channel': 'IN_APP',
    'event_type': 'GENERAL',
    'body': 'test',
}, token_admin, SID_A)
check("D11 Logs are read-only (POST -> 405)", resp.status_code == 405,
      f"status={resp.status_code}")

# D12: Teacher can READ logs (IsSchoolAdminOrReadOnly)
resp = api_get('/api/notifications/logs/', token_teacher, SID_A)
check("D12 Teacher can read logs", resp.status_code == 200,
      f"status={resp.status_code}")


# ==================================================================
# LEVEL E: MY NOTIFICATIONS, UNREAD COUNT, MARK READ
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL E: MY NOTIFICATIONS & READ STATUS")
print("=" * 70)

# First, create some IN_APP notifications for the admin user directly
# (the send endpoint already created some, but let's ensure recipient_user is set)
for i in range(3):
    NotificationLog.objects.create(
        school=school_a,
        channel='IN_APP',
        event_type='GENERAL',
        recipient_type='ADMIN',
        recipient_identifier=str(admin_user.id),
        recipient_user=admin_user,
        title=f'{P10}InApp #{i+1}',
        body=f'{P10}InApp body #{i+1}',
        status='SENT',
    )

# E1: My notifications
resp = api_get('/api/notifications/my/', token_admin, SID_A)
data = resp.json() if resp.status_code == 200 else []
p10_my = [n for n in data if n.get('title', '').startswith(P10)]
check("E1  My notifications", resp.status_code == 200 and len(p10_my) >= 3,
      f"status={resp.status_code} p10_count={len(p10_my)}")

# E2: Unread count
resp = api_get('/api/notifications/unread-count/', token_admin, SID_A)
check("E2  Unread count", resp.status_code == 200,
      f"status={resp.status_code}")
if resp.status_code == 200:
    count = resp.json().get('unread_count', 0)
    check("E2b Unread count > 0", count >= 3, f"count={count}")
else:
    check("E2b Unread count > 0", False, "no response")

# E3: Mark single notification as read
# Get first unread notification
my_notifs = NotificationLog.objects.filter(
    recipient_user=admin_user, channel='IN_APP',
    title__startswith=P10, read_at__isnull=True,
).order_by('-created_at')
mark_read_id = my_notifs.first().id if my_notifs.exists() else None

if mark_read_id:
    resp = api_post(f'/api/notifications/{mark_read_id}/mark-read/', {},
                    token_admin, SID_A)
    check("E3  Mark single as read", resp.status_code == 200,
          f"status={resp.status_code}")
    log = NotificationLog.objects.get(id=mark_read_id)
    check("E3b read_at set", log.read_at is not None, f"read_at={log.read_at}")
    check("E3c status=READ", log.status == 'READ', f"status={log.status}")
else:
    check("E3  Mark single as read", False, "no unread notification")
    check("E3b read_at set", False, "no id")
    check("E3c status=READ", False, "no id")

# E4: Can't mark another user's notification
teacher_notif = NotificationLog.objects.create(
    school=school_a, channel='IN_APP', event_type='GENERAL',
    recipient_type='STAFF', recipient_identifier=str(teacher_user.id),
    recipient_user=teacher_user,
    title=f'{P10}For Teacher', body=f'{P10}Teacher body', status='SENT',
)
resp = api_post(f'/api/notifications/{teacher_notif.id}/mark-read/', {},
                token_admin, SID_A)
check("E4  Can't mark other's notification -> 404", resp.status_code == 404,
      f"status={resp.status_code}")

# E5: Mark all read
resp = api_post('/api/notifications/mark-all-read/', {}, token_admin, SID_A)
check("E5  Mark all read", resp.status_code == 200,
      f"status={resp.status_code}")
if resp.status_code == 200:
    marked = resp.json().get('marked_read', 0)
    check("E5b marked_read > 0", marked >= 1, f"marked={marked}")
else:
    check("E5b marked_read > 0", False, "no response")

# E6: Unread count should be 0 now
resp = api_get('/api/notifications/unread-count/', token_admin, SID_A)
if resp.status_code == 200:
    count = resp.json().get('unread_count', -1)
    check("E6  Unread count now 0", count == 0, f"count={count}")
else:
    check("E6  Unread count now 0", False, f"status={resp.status_code}")

# E7: Teacher sees own notifications (not admin's)
resp = api_get('/api/notifications/my/', token_teacher, SID_A)
data = resp.json() if resp.status_code == 200 else []
teacher_p10 = [n for n in data if n.get('title', '').startswith(P10)]
check("E7  Teacher sees own notifications", resp.status_code == 200 and len(teacher_p10) == 1,
      f"status={resp.status_code} count={len(teacher_p10)}")


# ==================================================================
# LEVEL F: ANALYTICS & AI CHAT
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL F: ANALYTICS & AI CHAT")
print("=" * 70)

# F1: Analytics endpoint
resp = api_get('/api/notifications/analytics/', token_admin, SID_A)
check("F1  Analytics endpoint", resp.status_code == 200,
      f"status={resp.status_code} body={resp.content[:200]}")
if resp.status_code == 200:
    d = resp.json()
    check("F1b Has channels data", 'channels' in d or 'optimal_send_time' in d,
          f"keys={list(d.keys())}")
else:
    check("F1b Has channels data", False, "no response")

# F2: Analytics (Teacher) -> 403
resp = api_get('/api/notifications/analytics/', token_teacher, SID_A)
check("F2  Analytics (Teacher) -> 403", resp.status_code == 403,
      f"status={resp.status_code}")

# F3: AI chat endpoint
resp = api_post('/api/notifications/ai-chat/', {
    'message': 'How many students were absent today?',
}, token_admin, SID_A)
check("F3  AI chat endpoint", resp.status_code == 200,
      f"status={resp.status_code} body={resp.content[:200]}")
if resp.status_code == 200:
    d = resp.json()
    check("F3b Has response field", 'response' in d, f"keys={list(d.keys())}")
else:
    check("F3b Has response field", False, "no response")

# F4: AI chat without message -> 400
resp = api_post('/api/notifications/ai-chat/', {}, token_admin, SID_A)
check("F4  AI chat no message -> 400", resp.status_code == 400,
      f"status={resp.status_code}")

# F5: AI chat (Teacher) -> 403
resp = api_post('/api/notifications/ai-chat/', {
    'message': 'test',
}, token_teacher, SID_A)
check("F5  AI chat (Teacher) -> 403", resp.status_code == 403,
      f"status={resp.status_code}")


# ==================================================================
# LEVEL G: CROSS-CUTTING & SECURITY
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL G: CROSS-CUTTING & SECURITY")
print("=" * 70)

# G1: Unauthenticated -> 401
resp = _client.get('/api/notifications/my/')
check("G1  Unauthenticated -> 401", resp.status_code == 401,
      f"status={resp.status_code}")

# G2: Invalid token -> 401
resp = _client.get(
    '/api/notifications/my/',
    HTTP_AUTHORIZATION='Bearer invalid_garbage_token',
)
check("G2  Invalid token -> 401", resp.status_code == 401,
      f"status={resp.status_code}")

# G3: School B admin can't see School A logs
resp = api_get('/api/notifications/logs/', token_admin_b, SID_B)
data = resp.json() if resp.status_code == 200 else {'results': []}
results = data.get('results', data) if isinstance(data, dict) else data
p10_in_b = [l for l in results if l.get('title', '').startswith(P10)]
check("G3  School B isolation (logs)", resp.status_code == 200 and len(p10_in_b) == 0,
      f"status={resp.status_code} p10_count={len(p10_in_b)}")

# G4: School B config is separate
resp = api_get('/api/notifications/config/', token_admin_b, SID_B)
check("G4  School B config separate", resp.status_code == 200,
      f"status={resp.status_code}")
if resp.status_code == 200:
    d = resp.json()
    # School B config should NOT have fee_reminder_day=10 (that was School A)
    check("G4b School B has default config", d.get('fee_reminder_day') == 5,
          f"fee_day={d.get('fee_reminder_day')}")
else:
    check("G4b School B has default config", False, "no response")

# G5: My notifications only shows current user's
resp = api_get('/api/notifications/my/', token_teacher, SID_A)
data = resp.json() if resp.status_code == 200 else []
admin_notifs = [n for n in data if n.get('recipient_user') == admin_user.id]
check("G5  My notifications only current user's", len(admin_notifs) == 0,
      f"admin_notif_count={len(admin_notifs)}")

# G6: Mark-read only works for recipient
if mark_read_id:
    resp = api_post(f'/api/notifications/{mark_read_id}/mark-read/', {},
                    token_teacher, SID_A)
    check("G6  Can't mark-read other user's -> 404", resp.status_code == 404,
          f"status={resp.status_code}")
else:
    check("G6  Can't mark-read other user's -> 404", False, "no id")

# G7: Send requires school_id
resp = _client.post(
    '/api/notifications/send/',
    data=json.dumps({
        'event_type': 'GENERAL',
        'channel': 'IN_APP',
        'recipient_identifier': 'test',
        'body': 'test',
    }),
    HTTP_AUTHORIZATION=f'Bearer {token_admin}',
    content_type='application/json',
)
check("G7  Send without school_id -> 400", resp.status_code == 400,
      f"status={resp.status_code}")

# G8: Unread-count endpoint works for any authenticated user
resp = api_get('/api/notifications/unread-count/', token_teacher, SID_A)
check("G8  Unread-count works for teacher", resp.status_code == 200,
      f"status={resp.status_code}")


# ==================================================================
# SUMMARY
# ==================================================================
print("\n" + "=" * 70)
total = passed + failed
print(f"  PHASE 10 RESULTS: {passed}/{total} passed, {failed} failed")
print("=" * 70)

if failed == 0:
    print("  ALL TESTS PASSED!")
else:
    print(f"  {failed} TESTS FAILED - review output above.")
print()
