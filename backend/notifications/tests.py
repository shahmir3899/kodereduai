import pytest

from notifications.models import NotificationLog


@pytest.mark.django_db
class TestMyNotificationsSchoolScoping:
    """
    Regression coverage for the cross-school notification leak: a user must
    never see, count, or bulk-mark-read a NotificationLog row for a school
    they don't currently have an active membership at, even though the row
    is addressed to them (e.g. a stale membership or a bad recipient match).
    """

    def _make_log(self, school, recipient_user, **overrides):
        defaults = dict(
            school=school,
            event_type='GENERAL',
            channel='IN_APP',
            recipient_type='ADMIN',
            recipient_identifier=str(recipient_user.id),
            recipient_user=recipient_user,
            title='Test notification',
            body='Test body',
            status='SENT',
        )
        defaults.update(overrides)
        return NotificationLog.objects.create(**defaults)

    def test_inbox_excludes_notifications_for_schools_user_cant_access(self, seed_data, api):
        principal = seed_data['users']['principal']  # School A only
        school_a = seed_data['school_a']
        school_b = seed_data['school_b']

        own_log = self._make_log(school_a, principal)
        # Addressed to the same user id but for a school they have no membership at.
        leaked_log = self._make_log(school_b, principal)

        token = api.login(principal.username)
        resp = api.get('/api/notifications/my/', token, school_a.id)

        assert resp.status_code == 200
        ids = {row['id'] for row in resp.json().get('results', resp.json())}
        assert own_log.id in ids
        assert leaked_log.id not in ids

    def test_unread_count_excludes_inaccessible_school(self, seed_data, api):
        principal = seed_data['users']['principal']
        school_a = seed_data['school_a']
        school_b = seed_data['school_b']

        self._make_log(school_a, principal)
        self._make_log(school_b, principal)

        token = api.login(principal.username)
        resp = api.get('/api/notifications/unread-count/', token, school_a.id)

        assert resp.status_code == 200
        assert resp.json()['unread_count'] == 1

    def test_mark_all_read_does_not_touch_inaccessible_school(self, seed_data, api):
        principal = seed_data['users']['principal']
        school_a = seed_data['school_a']
        school_b = seed_data['school_b']

        own_log = self._make_log(school_a, principal)
        leaked_log = self._make_log(school_b, principal)

        token = api.login(principal.username)
        resp = api.post('/api/notifications/mark-all-read/', {}, token, school_a.id)

        assert resp.status_code == 200
        own_log.refresh_from_db()
        leaked_log.refresh_from_db()
        assert own_log.read_at is not None
        assert leaked_log.read_at is None
