"""
Phase 10 -- Notifications Module Tests (pytest)
=================================================
Covers: NotificationTemplate CRUD, NotificationLog read/filter,
        NotificationPreference CRUD, SchoolNotificationConfig GET/PUT,
        MyNotifications, UnreadCount, MarkRead, MarkAllRead,
        SendNotification, Analytics, AI Chat, permissions, isolation.
"""

import json

import pytest

from notifications.models import (
    NotificationLog,
    NotificationPreference,
    NotificationTemplate,
    SchoolNotificationConfig,
)


# ======================================================================
# LEVEL A: NOTIFICATION TEMPLATES API
# ======================================================================


@pytest.mark.django_db
@pytest.mark.phase10
class TestNotificationTemplates:
    """CRUD and permission tests for the NotificationTemplate API."""

    def test_a1_create_template_admin(self, seed_data, api):
        """Admin can create a notification template."""
        prefix = seed_data['prefix']
        resp = api.post('/api/notifications/templates/', {
            'name': f'{prefix}Absence Alert',
            'event_type': 'ABSENCE',
            'channel': 'IN_APP',
            'subject_template': 'Absence: {{student_name}}',
            'body_template': 'Dear Parent, {{student_name}} of {{class_name}} was absent on {{date}}.',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, f"A1 Create template (Admin): status={resp.status_code}"

    def test_a2_create_second_template(self, seed_data, api):
        """Admin can create a second template with different event type."""
        prefix = seed_data['prefix']
        resp = api.post('/api/notifications/templates/', {
            'name': f'{prefix}Fee Reminder',
            'event_type': 'FEE_DUE',
            'channel': 'IN_APP',
            'subject_template': 'Fee Due: {{student_name}}',
            'body_template': 'Fee of {{amount}} is due for {{student_name}}.',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, f"A2 Create second template: status={resp.status_code}"

    def test_a3_create_template_principal(self, seed_data, api):
        """Principal can create a notification template."""
        prefix = seed_data['prefix']
        resp = api.post('/api/notifications/templates/', {
            'name': f'{prefix}General Notice',
            'event_type': 'GENERAL',
            'channel': 'IN_APP',
            'subject_template': '{{title}}',
            'body_template': '{{body}}',
        }, seed_data['tokens']['principal'], seed_data['SID_A'])
        assert resp.status_code == 201, f"A3 Create template (Principal): status={resp.status_code}"

    def test_a4_create_template_teacher_forbidden(self, seed_data, api):
        """Teacher cannot create templates (403)."""
        prefix = seed_data['prefix']
        resp = api.post('/api/notifications/templates/', {
            'name': f'{prefix}Should Fail',
            'event_type': 'GENERAL',
            'channel': 'IN_APP',
            'body_template': 'test',
        }, seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, f"A4 Create template (Teacher) -> 403: status={resp.status_code}"

    def test_a5_list_templates(self, seed_data, api):
        """Admin can list templates and sees all created P10 templates."""
        prefix = seed_data['prefix']
        # Create 3 templates first
        for name, event in [('Tpl1', 'ABSENCE'), ('Tpl2', 'FEE_DUE'), ('Tpl3', 'GENERAL')]:
            api.post('/api/notifications/templates/', {
                'name': f'{prefix}{name}',
                'event_type': event,
                'channel': 'IN_APP',
                'body_template': 'test',
            }, seed_data['tokens']['admin'], seed_data['SID_A'])

        resp = api.get('/api/notifications/templates/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"A5 List templates: status={resp.status_code}"
        data = resp.json()
        p10_templates = [t for t in data if t.get('name', '').startswith(prefix)]
        assert len(p10_templates) >= 3, f"A5 List templates: expected >= 3, got {len(p10_templates)}"

    def test_a6_retrieve_template(self, seed_data, api):
        """Admin can retrieve a single template with school_name."""
        prefix = seed_data['prefix']
        resp = api.post('/api/notifications/templates/', {
            'name': f'{prefix}Retrieve Test',
            'event_type': 'ABSENCE',
            'channel': 'IN_APP',
            'subject_template': 'Absence: {{student_name}}',
            'body_template': 'Dear Parent, {{student_name}} was absent.',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201
        tpl_id = resp.json()['id']

        resp = api.get(f'/api/notifications/templates/{tpl_id}/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"A6 Retrieve template: status={resp.status_code}"
        d = resp.json()
        assert d.get('school_name') is not None, f"A6b Has school_name: school_name={d.get('school_name')}"

    def test_a7_update_template(self, seed_data, api):
        """Admin can update a template."""
        prefix = seed_data['prefix']
        resp = api.post('/api/notifications/templates/', {
            'name': f'{prefix}Update Test',
            'event_type': 'ABSENCE',
            'channel': 'IN_APP',
            'body_template': 'Original body.',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201
        tpl_id = resp.json()['id']

        resp = api.patch(f'/api/notifications/templates/{tpl_id}/', {
            'body_template': 'Updated: {{student_name}} was absent on {{date}} from {{class_name}}.',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"A7 Update template: status={resp.status_code}"

    def test_a8_delete_template(self, seed_data, api):
        """Admin can delete a template."""
        tpl = NotificationTemplate.objects.create(
            school=seed_data['school_a'],
            name=f'{seed_data["prefix"]}ToDelete',
            event_type='CUSTOM',
            channel='IN_APP',
            body_template='temp',
        )
        resp = api.delete(f'/api/notifications/templates/{tpl.id}/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code in (200, 204), f"A8 Delete template: status={resp.status_code}"

    def test_a9_teacher_cannot_read_templates(self, seed_data, api):
        """Teacher cannot read templates (403)."""
        resp = api.get('/api/notifications/templates/', seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, f"A9 Teacher can't read templates -> 403: status={resp.status_code}"

    def test_a10_school_b_isolation(self, seed_data, api):
        """School B admin cannot see School A templates."""
        prefix = seed_data['prefix']
        # Ensure at least one template exists in school A
        api.post('/api/notifications/templates/', {
            'name': f'{prefix}Isolation Test',
            'event_type': 'GENERAL',
            'channel': 'IN_APP',
            'body_template': 'test',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])

        resp = api.get('/api/notifications/templates/', seed_data['tokens']['admin_b'], seed_data['SID_B'])
        assert resp.status_code == 200, f"A10 School B isolation: status={resp.status_code}"
        data = resp.json()
        p10_in_b = [t for t in data if t.get('name', '').startswith(prefix)]
        assert len(p10_in_b) == 0, f"A10 School B isolation (templates): found {len(p10_in_b)} in school B"


# ======================================================================
# LEVEL B: SCHOOL NOTIFICATION CONFIG
# ======================================================================


@pytest.mark.django_db
@pytest.mark.phase10
class TestSchoolNotificationConfig:
    """GET/PUT tests for the SchoolNotificationConfig API."""

    def test_b1_get_config(self, seed_data, api):
        """Admin can get notification config (auto-creates via get_or_create)."""
        resp = api.get('/api/notifications/config/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"B1 Get notification config: status={resp.status_code}"
        d = resp.json()
        assert d.get('in_app_enabled') is True, f"B1b Default in_app_enabled=True: in_app={d.get('in_app_enabled')}"
        assert d.get('whatsapp_enabled') is False, f"B1c Default whatsapp_enabled=False: whatsapp={d.get('whatsapp_enabled')}"

    def test_b2_update_config_put(self, seed_data, api):
        """Admin can update config via PUT."""
        client = api.client
        token_admin = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']

        # Ensure config exists first
        api.get('/api/notifications/config/', token_admin, SID_A)

        resp = client.put(
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
        assert resp.status_code == 200, f"B2 Update config (PUT): status={resp.status_code}"
        d = resp.json()
        assert d.get('whatsapp_enabled') is True, f"B2b whatsapp now enabled: whatsapp={d.get('whatsapp_enabled')}"
        assert d.get('fee_reminder_day') == 10, f"B2c fee_reminder_day=10: day={d.get('fee_reminder_day')}"

    def test_b3_teacher_cannot_access_config(self, seed_data, api):
        """Teacher cannot access notification config (403)."""
        resp = api.get('/api/notifications/config/', seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, f"B3 Teacher can't access config -> 403: status={resp.status_code}"


# ======================================================================
# LEVEL C: NOTIFICATION PREFERENCES
# ======================================================================


@pytest.mark.django_db
@pytest.mark.phase10
class TestNotificationPreferences:
    """CRUD tests for the NotificationPreference API."""

    def test_c1_create_preference_user_opt_out(self, seed_data, api):
        """Admin can create a preference (user opt-out)."""
        admin_user = seed_data['users']['admin']
        resp = api.post('/api/notifications/preferences/', {
            'school': seed_data['SID_A'],
            'user': admin_user.id,
            'channel': 'IN_APP',
            'event_type': 'CUSTOM',
            'is_enabled': False,
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, f"C1 Create preference (user opt-out): status={resp.status_code}"

    def test_c2_create_preference_student(self, seed_data, api):
        """Admin can create a preference for a student."""
        student_1 = seed_data['students'][0]
        resp = api.post('/api/notifications/preferences/', {
            'school': seed_data['SID_A'],
            'student': student_1.id,
            'channel': 'IN_APP',
            'event_type': 'CUSTOM',
            'is_enabled': True,
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, f"C2 Create preference (student): status={resp.status_code}"

    def test_c3_list_preferences(self, seed_data, api):
        """Admin can list preferences."""
        admin_user = seed_data['users']['admin']
        student_1 = seed_data['students'][0]
        token_admin = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']

        # Create two preferences first
        api.post('/api/notifications/preferences/', {
            'school': SID_A, 'user': admin_user.id,
            'channel': 'IN_APP', 'event_type': 'CUSTOM', 'is_enabled': False,
        }, token_admin, SID_A)
        api.post('/api/notifications/preferences/', {
            'school': SID_A, 'student': student_1.id,
            'channel': 'IN_APP', 'event_type': 'CUSTOM', 'is_enabled': True,
        }, token_admin, SID_A)

        resp = api.get('/api/notifications/preferences/', token_admin, SID_A)
        assert resp.status_code == 200, f"C3 List preferences: status={resp.status_code}"
        data = resp.json()
        assert len(data) >= 2, f"C3 List preferences: expected >= 2, got {len(data)}"

    def test_c4_update_preference(self, seed_data, api):
        """Admin can update a preference."""
        admin_user = seed_data['users']['admin']
        token_admin = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']

        resp = api.post('/api/notifications/preferences/', {
            'school': SID_A, 'user': admin_user.id,
            'channel': 'IN_APP', 'event_type': 'CUSTOM', 'is_enabled': False,
        }, token_admin, SID_A)
        assert resp.status_code == 201
        pref_id = resp.json()['id']

        resp = api.patch(f'/api/notifications/preferences/{pref_id}/', {
            'is_enabled': True,
        }, token_admin, SID_A)
        assert resp.status_code == 200, f"C4 Update preference: status={resp.status_code}"

    def test_c5_delete_preference(self, seed_data, api):
        """Admin can delete a preference."""
        student_1 = seed_data['students'][0]
        token_admin = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']

        resp = api.post('/api/notifications/preferences/', {
            'school': SID_A, 'student': student_1.id,
            'channel': 'IN_APP', 'event_type': 'CUSTOM', 'is_enabled': True,
        }, token_admin, SID_A)
        assert resp.status_code == 201
        pref_id = resp.json()['id']

        resp = api.delete(f'/api/notifications/preferences/{pref_id}/', token_admin, SID_A)
        assert resp.status_code in (200, 204), f"C5 Delete preference: status={resp.status_code}"

    def test_c6_teacher_can_create_own_preference(self, seed_data, api):
        """Teacher can create their own preference (HasSchoolAccess)."""
        teacher_user = seed_data['users']['teacher']
        resp = api.post('/api/notifications/preferences/', {
            'school': seed_data['SID_A'],
            'user': teacher_user.id,
            'channel': 'IN_APP',
            'event_type': 'CUSTOM',
            'is_enabled': False,
        }, seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 201, f"C6 Teacher can create preference: status={resp.status_code}"


# ======================================================================
# LEVEL D: SEND NOTIFICATION & NOTIFICATION LOGS
# ======================================================================


@pytest.mark.django_db
@pytest.mark.phase10
class TestSendNotificationAndLogs:
    """Tests for the send-notification endpoint and notification log queries."""

    def test_d1_send_in_app_notification(self, seed_data, api):
        """Admin can send an IN_APP notification."""
        prefix = seed_data['prefix']
        admin_user = seed_data['users']['admin']
        resp = api.post('/api/notifications/send/', {
            'event_type': 'GENERAL',
            'channel': 'IN_APP',
            'recipient_identifier': str(admin_user.id),
            'recipient_type': 'ADMIN',
            'title': f'{prefix}Test General Notice',
            'body': f'{prefix}This is a test notification body.',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code in (200, 201), f"D1 Send IN_APP notification: status={resp.status_code}"

    def test_d2_send_notification_with_student(self, seed_data, api):
        """Admin can send a notification with student context."""
        prefix = seed_data['prefix']
        admin_user = seed_data['users']['admin']
        student_1 = seed_data['students'][0]
        resp = api.post('/api/notifications/send/', {
            'event_type': 'ABSENCE',
            'channel': 'IN_APP',
            'recipient_identifier': str(admin_user.id),
            'recipient_type': 'ADMIN',
            'title': f'{prefix}Absence Alert',
            'body': f'{prefix}Student {student_1.name} was absent today.',
            'student_id': student_1.id,
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code in (200, 201), f"D2 Send notification with student: status={resp.status_code}"
        if resp.status_code == 201:
            d = resp.json()
            assert d.get('student_name') is not None, f"D2b Log has student_name: student_name={d.get('student_name')}"

    def test_d3_send_notification_teacher_forbidden(self, seed_data, api):
        """Teacher cannot send notifications (403)."""
        prefix = seed_data['prefix']
        admin_user = seed_data['users']['admin']
        resp = api.post('/api/notifications/send/', {
            'event_type': 'GENERAL',
            'channel': 'IN_APP',
            'recipient_identifier': str(admin_user.id),
            'title': f'{prefix}Should fail',
            'body': f'{prefix}test',
        }, seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, f"D3 Send notification (Teacher) -> 403: status={resp.status_code}"

    def test_d4_send_invalid_event_type(self, seed_data, api):
        """Invalid event_type returns 400."""
        resp = api.post('/api/notifications/send/', {
            'event_type': 'INVALID_TYPE',
            'channel': 'IN_APP',
            'recipient_identifier': 'test',
            'body': 'test',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 400, f"D4 Invalid event_type -> 400: status={resp.status_code}"

    def test_d6_list_notification_logs(self, seed_data, api):
        """Admin can list notification logs."""
        prefix = seed_data['prefix']
        admin_user = seed_data['users']['admin']
        token_admin = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        student_1 = seed_data['students'][0]

        # Send several notifications first
        for i in range(5):
            api.post('/api/notifications/send/', {
                'event_type': 'FEE_DUE',
                'channel': 'IN_APP',
                'recipient_identifier': str(admin_user.id),
                'recipient_type': 'ADMIN',
                'title': f'{prefix}Fee Reminder #{i+1}',
                'body': f'{prefix}Fee reminder body #{i+1}',
                'student_id': student_1.id,
            }, token_admin, SID_A)

        resp = api.get('/api/notifications/logs/', token_admin, SID_A)
        assert resp.status_code == 200, f"D6 List notification logs: status={resp.status_code}"
        data = resp.json()
        results = data.get('results', data) if isinstance(data, dict) else data
        p10_logs = [l for l in results if l.get('title', '').startswith(prefix) or l.get('body', '').startswith(prefix)]
        assert len(p10_logs) >= 5, f"D6 List notification logs: expected >= 5, got {len(p10_logs)}"

    def test_d7_filter_logs_by_channel(self, seed_data, api):
        """Admin can filter logs by channel."""
        resp = api.get('/api/notifications/logs/?channel=IN_APP', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"D7 Filter logs by channel: status={resp.status_code}"

    def test_d8_filter_logs_by_event_type(self, seed_data, api):
        """Admin can filter logs by event_type=FEE_DUE."""
        prefix = seed_data['prefix']
        admin_user = seed_data['users']['admin']
        token_admin = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        student_1 = seed_data['students'][0]

        # Send fee notifications
        for i in range(3):
            api.post('/api/notifications/send/', {
                'event_type': 'FEE_DUE',
                'channel': 'IN_APP',
                'recipient_identifier': str(admin_user.id),
                'recipient_type': 'ADMIN',
                'title': f'{prefix}Fee Filter #{i+1}',
                'body': f'{prefix}Fee filter body #{i+1}',
                'student_id': student_1.id,
            }, token_admin, SID_A)

        resp = api.get('/api/notifications/logs/?event_type=FEE_DUE', token_admin, SID_A)
        assert resp.status_code == 200, f"D8 Filter logs by event_type: status={resp.status_code}"
        data = resp.json()
        results = data.get('results', data) if isinstance(data, dict) else data
        fee_logs = [l for l in results if l.get('title', '').startswith(prefix)]
        assert len(fee_logs) >= 3, f"D8 Filter logs by event_type=FEE_DUE: count={len(fee_logs)}"

    def test_d9_filter_logs_by_student_id(self, seed_data, api):
        """Admin can filter logs by student_id."""
        prefix = seed_data['prefix']
        admin_user = seed_data['users']['admin']
        token_admin = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        student_1 = seed_data['students'][0]

        # Send a notification with student context
        api.post('/api/notifications/send/', {
            'event_type': 'ABSENCE',
            'channel': 'IN_APP',
            'recipient_identifier': str(admin_user.id),
            'recipient_type': 'ADMIN',
            'title': f'{prefix}Student Filter',
            'body': f'{prefix}Body for student filter',
            'student_id': student_1.id,
        }, token_admin, SID_A)

        resp = api.get(f'/api/notifications/logs/?student_id={student_1.id}', token_admin, SID_A)
        assert resp.status_code == 200, f"D9 Filter logs by student_id: status={resp.status_code}"
        data = resp.json()
        results = data.get('results', data) if isinstance(data, dict) else data
        assert len(results) >= 1, f"D9 Filter logs by student_id: count={len(results)}"

    def test_d10_retrieve_single_log(self, seed_data, api):
        """Admin can retrieve a single log with display fields."""
        prefix = seed_data['prefix']
        admin_user = seed_data['users']['admin']
        token_admin = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']

        resp = api.post('/api/notifications/send/', {
            'event_type': 'GENERAL',
            'channel': 'IN_APP',
            'recipient_identifier': str(admin_user.id),
            'recipient_type': 'ADMIN',
            'title': f'{prefix}Retrieve Log Test',
            'body': f'{prefix}Retrieve log body.',
        }, token_admin, SID_A)
        assert resp.status_code in (200, 201)
        log_id = resp.json().get('id')
        assert log_id is not None, "D10 could not create log"

        resp = api.get(f'/api/notifications/logs/{log_id}/', token_admin, SID_A)
        assert resp.status_code == 200, f"D10 Retrieve single log: status={resp.status_code}"
        d = resp.json()
        assert d.get('channel_display') is not None, f"D10b channel_display missing: {d.get('channel_display')}"
        assert d.get('status_display') is not None, f"D10b status_display missing: {d.get('status_display')}"

    def test_d11_logs_are_read_only(self, seed_data, api):
        """POST to logs endpoint returns 405."""
        resp = api.post('/api/notifications/logs/', {
            'channel': 'IN_APP',
            'event_type': 'GENERAL',
            'body': 'test',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 405, f"D11 Logs are read-only (POST -> 405): status={resp.status_code}"

    def test_d12_teacher_can_read_logs(self, seed_data, api):
        """Teacher can read logs (IsSchoolAdminOrReadOnly)."""
        resp = api.get('/api/notifications/logs/', seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 200, f"D12 Teacher can read logs: status={resp.status_code}"


# ======================================================================
# LEVEL E: MY NOTIFICATIONS, UNREAD COUNT, MARK READ
# ======================================================================


@pytest.mark.django_db
@pytest.mark.phase10
class TestMyNotificationsAndReadStatus:
    """Tests for my-notifications, unread count, mark-read, and mark-all-read."""

    def _create_in_app_notifications(self, seed_data, count=3):
        """Helper: create IN_APP notifications directly for the admin user."""
        prefix = seed_data['prefix']
        admin_user = seed_data['users']['admin']
        school_a = seed_data['school_a']
        for i in range(count):
            NotificationLog.objects.create(
                school=school_a,
                channel='IN_APP',
                event_type='GENERAL',
                recipient_type='ADMIN',
                recipient_identifier=str(admin_user.id),
                recipient_user=admin_user,
                title=f'{prefix}InApp #{i+1}',
                body=f'{prefix}InApp body #{i+1}',
                status='SENT',
            )

    def test_e1_my_notifications(self, seed_data, api):
        """Admin sees own IN_APP notifications."""
        self._create_in_app_notifications(seed_data, count=3)
        prefix = seed_data['prefix']

        resp = api.get('/api/notifications/my/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"E1 My notifications: status={resp.status_code}"
        data = resp.json()
        p10_my = [n for n in data if n.get('title', '').startswith(prefix)]
        assert len(p10_my) >= 3, f"E1 My notifications: expected >= 3, got {len(p10_my)}"

    def test_e2_unread_count(self, seed_data, api):
        """Unread count reflects unread notifications."""
        self._create_in_app_notifications(seed_data, count=3)

        resp = api.get('/api/notifications/unread-count/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"E2 Unread count: status={resp.status_code}"
        count = resp.json().get('unread_count', 0)
        assert count >= 3, f"E2b Unread count > 0: count={count}"

    def test_e3_mark_single_as_read(self, seed_data, api):
        """Admin can mark a single notification as read."""
        self._create_in_app_notifications(seed_data, count=1)
        prefix = seed_data['prefix']
        admin_user = seed_data['users']['admin']

        notif = NotificationLog.objects.filter(
            recipient_user=admin_user, channel='IN_APP',
            title__startswith=prefix, read_at__isnull=True,
        ).order_by('-created_at').first()
        assert notif is not None, "E3 no unread notification found"

        resp = api.post(f'/api/notifications/{notif.id}/mark-read/', {},
                        seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"E3 Mark single as read: status={resp.status_code}"

        notif.refresh_from_db()
        assert notif.read_at is not None, f"E3b read_at set: read_at={notif.read_at}"
        assert notif.status == 'READ', f"E3c status=READ: status={notif.status}"

    def test_e4_cannot_mark_other_users_notification(self, seed_data, api):
        """Admin cannot mark a teacher's notification as read (404)."""
        prefix = seed_data['prefix']
        teacher_user = seed_data['users']['teacher']
        school_a = seed_data['school_a']

        teacher_notif = NotificationLog.objects.create(
            school=school_a, channel='IN_APP', event_type='GENERAL',
            recipient_type='STAFF', recipient_identifier=str(teacher_user.id),
            recipient_user=teacher_user,
            title=f'{prefix}For Teacher', body=f'{prefix}Teacher body', status='SENT',
        )
        resp = api.post(f'/api/notifications/{teacher_notif.id}/mark-read/', {},
                        seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 404, f"E4 Can't mark other's notification -> 404: status={resp.status_code}"

    def test_e5_mark_all_read(self, seed_data, api):
        """Admin can mark all notifications as read."""
        self._create_in_app_notifications(seed_data, count=3)

        resp = api.post('/api/notifications/mark-all-read/', {}, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"E5 Mark all read: status={resp.status_code}"
        marked = resp.json().get('marked_read', 0)
        assert marked >= 1, f"E5b marked_read > 0: marked={marked}"

    def test_e6_unread_count_zero_after_mark_all(self, seed_data, api):
        """Unread count is 0 after marking all read."""
        self._create_in_app_notifications(seed_data, count=2)
        # Mark all read
        api.post('/api/notifications/mark-all-read/', {}, seed_data['tokens']['admin'], seed_data['SID_A'])

        resp = api.get('/api/notifications/unread-count/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"E6 Unread count: status={resp.status_code}"
        count = resp.json().get('unread_count', -1)
        assert count == 0, f"E6 Unread count now 0: count={count}"

    def test_e7_teacher_sees_own_notifications(self, seed_data, api):
        """Teacher sees only their own notifications."""
        prefix = seed_data['prefix']
        teacher_user = seed_data['users']['teacher']
        school_a = seed_data['school_a']

        NotificationLog.objects.create(
            school=school_a, channel='IN_APP', event_type='GENERAL',
            recipient_type='STAFF', recipient_identifier=str(teacher_user.id),
            recipient_user=teacher_user,
            title=f'{prefix}Teacher Only', body=f'{prefix}Teacher body', status='SENT',
        )

        resp = api.get('/api/notifications/my/', seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 200, f"E7 Teacher sees own: status={resp.status_code}"
        data = resp.json()
        teacher_p10 = [n for n in data if n.get('title', '').startswith(prefix)]
        assert len(teacher_p10) == 1, f"E7 Teacher sees own notifications: count={len(teacher_p10)}"


# ======================================================================
# LEVEL F: ANALYTICS & AI CHAT
# ======================================================================


@pytest.mark.django_db
@pytest.mark.phase10
class TestAnalyticsAndAIChat:
    """Tests for the analytics and AI chat endpoints."""

    def test_f1_analytics_endpoint(self, seed_data, api):
        """Admin can access analytics endpoint."""
        resp = api.get('/api/notifications/analytics/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"F1 Analytics endpoint: status={resp.status_code}"
        d = resp.json()
        assert 'channels' in d or 'optimal_send_time' in d, f"F1b Has channels data: keys={list(d.keys())}"

    def test_f2_analytics_teacher_forbidden(self, seed_data, api):
        """Teacher cannot access analytics (403)."""
        resp = api.get('/api/notifications/analytics/', seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, f"F2 Analytics (Teacher) -> 403: status={resp.status_code}"

    def test_f3_ai_chat_endpoint(self, seed_data, api):
        """Admin can use AI chat endpoint."""
        resp = api.post('/api/notifications/ai-chat/', {
            'message': 'How many students were absent today?',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"F3 AI chat endpoint: status={resp.status_code}"
        d = resp.json()
        assert 'response' in d, f"F3b Has response field: keys={list(d.keys())}"

    def test_f4_ai_chat_no_message_returns_400(self, seed_data, api):
        """AI chat without message returns 400."""
        resp = api.post('/api/notifications/ai-chat/', {}, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 400, f"F4 AI chat no message -> 400: status={resp.status_code}"

    def test_f5_ai_chat_teacher_forbidden(self, seed_data, api):
        """Teacher cannot access AI chat (403)."""
        resp = api.post('/api/notifications/ai-chat/', {
            'message': 'test',
        }, seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, f"F5 AI chat (Teacher) -> 403: status={resp.status_code}"


# ======================================================================
# LEVEL G: CROSS-CUTTING & SECURITY
# ======================================================================


@pytest.mark.django_db
@pytest.mark.phase10
class TestCrossCuttingAndSecurity:
    """Cross-cutting concerns: auth, isolation, and security tests."""

    def test_g1_unauthenticated_returns_401(self, seed_data, api):
        """Unauthenticated request returns 401."""
        resp = api.client.get('/api/notifications/my/')
        assert resp.status_code == 401, f"G1 Unauthenticated -> 401: status={resp.status_code}"

    def test_g2_invalid_token_returns_401(self, seed_data, api):
        """Invalid token returns 401."""
        resp = api.client.get(
            '/api/notifications/my/',
            HTTP_AUTHORIZATION='Bearer invalid_garbage_token',
        )
        assert resp.status_code == 401, f"G2 Invalid token -> 401: status={resp.status_code}"

    def test_g3_school_b_cannot_see_school_a_logs(self, seed_data, api):
        """School B admin cannot see School A notification logs."""
        prefix = seed_data['prefix']
        admin_user = seed_data['users']['admin']
        token_admin = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']
        student_1 = seed_data['students'][0]

        # Create some logs in school A
        api.post('/api/notifications/send/', {
            'event_type': 'GENERAL',
            'channel': 'IN_APP',
            'recipient_identifier': str(admin_user.id),
            'recipient_type': 'ADMIN',
            'title': f'{prefix}Isolation Log',
            'body': f'{prefix}Isolation body.',
        }, token_admin, SID_A)

        resp = api.get('/api/notifications/logs/', seed_data['tokens']['admin_b'], seed_data['SID_B'])
        assert resp.status_code == 200, f"G3 School B isolation: status={resp.status_code}"
        data = resp.json()
        results = data.get('results', data) if isinstance(data, dict) else data
        p10_in_b = [l for l in results if l.get('title', '').startswith(prefix)]
        assert len(p10_in_b) == 0, f"G3 School B isolation (logs): found {len(p10_in_b)} in school B"

    def test_g4_school_b_config_separate(self, seed_data, api):
        """School B has its own separate config with default values."""
        token_admin = seed_data['tokens']['admin']
        SID_A = seed_data['SID_A']

        # Ensure school A config has fee_reminder_day=10
        api.get('/api/notifications/config/', token_admin, SID_A)
        api.client.put(
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

        resp = api.get('/api/notifications/config/', seed_data['tokens']['admin_b'], seed_data['SID_B'])
        assert resp.status_code == 200, f"G4 School B config separate: status={resp.status_code}"
        d = resp.json()
        assert d.get('fee_reminder_day') == 5, f"G4b School B has default config: fee_day={d.get('fee_reminder_day')}"

    def test_g5_my_notifications_only_current_user(self, seed_data, api):
        """My notifications only returns current user's notifications."""
        prefix = seed_data['prefix']
        admin_user = seed_data['users']['admin']
        school_a = seed_data['school_a']

        # Create a notification for admin
        NotificationLog.objects.create(
            school=school_a, channel='IN_APP', event_type='GENERAL',
            recipient_type='ADMIN', recipient_identifier=str(admin_user.id),
            recipient_user=admin_user,
            title=f'{prefix}Admin Only G5', body=f'{prefix}body', status='SENT',
        )

        resp = api.get('/api/notifications/my/', seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 200
        data = resp.json()
        admin_notifs = [n for n in data if n.get('recipient_user') == admin_user.id]
        assert len(admin_notifs) == 0, f"G5 My notifications only current user's: admin_notif_count={len(admin_notifs)}"

    def test_g6_mark_read_only_works_for_recipient(self, seed_data, api):
        """Cannot mark-read another user's notification (404)."""
        prefix = seed_data['prefix']
        admin_user = seed_data['users']['admin']
        school_a = seed_data['school_a']

        notif = NotificationLog.objects.create(
            school=school_a, channel='IN_APP', event_type='GENERAL',
            recipient_type='ADMIN', recipient_identifier=str(admin_user.id),
            recipient_user=admin_user,
            title=f'{prefix}Admin G6', body=f'{prefix}body', status='SENT',
        )
        resp = api.post(f'/api/notifications/{notif.id}/mark-read/', {},
                        seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 404, f"G6 Can't mark-read other user's -> 404: status={resp.status_code}"

    def test_g7_send_requires_school_id(self, seed_data, api):
        """Send notification without school_id header returns 400."""
        token_admin = seed_data['tokens']['admin']
        resp = api.client.post(
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
        assert resp.status_code == 400, f"G7 Send without school_id -> 400: status={resp.status_code}"

    def test_g8_unread_count_works_for_teacher(self, seed_data, api):
        """Unread-count endpoint works for any authenticated user."""
        resp = api.get('/api/notifications/unread-count/', seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 200, f"G8 Unread-count works for teacher: status={resp.status_code}"
