"""
Tests for LoginEvent tracking (core.models.LoginEvent) and the SuperAdmin
demo_insights endpoint built on top of it. See CLAUDE.md's Public demo
section for what "the demo school" means.
"""
import pytest
from django.test import override_settings

from core.models import LoginEvent


@pytest.mark.django_db
class TestLoginEventRecording:
    def test_successful_login_creates_login_event(self, seed_data, api):
        # seed_data itself logs every seeded user in once (to populate its
        # `tokens` dict) — clear those out so this test only sees its own login.
        LoginEvent.objects.all().delete()

        token = api.login(seed_data['users']['admin'].username)
        assert token is not None

        events = list(LoginEvent.objects.all())
        assert len(events) == 1
        event = events[0]
        assert event.username == seed_data['users']['admin'].username
        assert event.school_id == seed_data['SID_A']
        assert event.role == 'SCHOOL_ADMIN'

    def test_failed_login_does_not_create_login_event(self, api_client):
        import json
        resp = api_client.post(
            '/api/auth/login/',
            data=json.dumps({'username': 'no-such-user', 'password': 'wrong'}),
            content_type='application/json',
        )
        assert resp.status_code == 401
        assert LoginEvent.objects.count() == 0

    @override_settings(DEMO_LOGIN_ALERT_EMAIL_ENABLED=True, DEMO_LOGIN_ALERT_EMAIL_RECIPIENT='ops@example.com')
    def test_demo_login_alert_sent_only_for_demo_school(self, seed_data, api, mailoutbox):
        with override_settings(DEMO_SCHOOL_ID=seed_data['SID_A']):
            api.login(seed_data['users']['admin'].username)
        assert len(mailoutbox) == 1
        assert mailoutbox[0].subject == 'Education AI - New Demo Login'

    def test_non_demo_school_login_does_not_send_alert(self, seed_data, api, mailoutbox):
        with override_settings(DEMO_LOGIN_ALERT_EMAIL_ENABLED=True, DEMO_SCHOOL_ID=999999):
            api.login(seed_data['users']['admin'].username)
        assert len(mailoutbox) == 0


@pytest.mark.django_db
class TestDemoInsightsEndpoint:
    URL = '/api/admin/schools/demo_insights/'

    def _make_super_admin(self):
        from users.models import User
        from conftest import PASSWORD

        user = User.objects.create_superuser(
            username='PYTEST_super_demo_insights', email='super_demo_insights@test.com', password=PASSWORD,
        )
        user.role = 'SUPER_ADMIN'
        user.save()
        return user

    def test_requires_super_admin(self, seed_data, api):
        resp = api.get(self.URL, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 403

    def test_aggregates_emails_and_logins_for_demo_school(self, seed_data, api):
        from core.cache_utils import bump_group
        from brochure.models import DemoRequest

        bump_group('demo_insights')
        self._make_super_admin()
        super_token = api.login('PYTEST_super_demo_insights')
        # seed_data's own setup logins (to populate its `tokens` dict) would
        # otherwise inflate the counts below once DEMO_SCHOOL_ID is overridden
        # to school_a's id.
        LoginEvent.objects.all().delete()

        DemoRequest.objects.create(
            name='Jane Visitor', school='Oakridge', email='jane@oakridge.test',
            visitor_credentials_email_sent=True,
        )
        DemoRequest.objects.create(
            name='No Email Sent', school='Other School', email='x@example.test',
            visitor_credentials_email_sent=False,
        )

        with override_settings(DEMO_SCHOOL_ID=seed_data['SID_A']):
            api.login(seed_data['users']['admin'].username)
            api.login(seed_data['users']['teacher'].username)

            resp = api.get(self.URL, super_token, seed_data['SID_A'])

        assert resp.status_code == 200
        data = resp.json()
        assert data['emails_sent_total'] == 1
        assert data['emails_sent_by_window']['today'] == 1
        assert data['logins_total'] == 2
        assert data['logins_by_window']['today'] == 2
        roles = {r['role']: r['count'] for r in data['logins_by_role']}
        assert roles == {'SCHOOL_ADMIN': 1, 'TEACHER': 1}
        assert data['recent_recipients'][0]['name'] == 'Jane Visitor'
