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


@pytest.mark.django_db
class TestCarouselEndpoints:
    """Unread-first ordering, is_read flag, and the counts-only daily digest."""

    def _make_log(self, school, user, **overrides):
        defaults = dict(
            school=school, event_type='GENERAL', channel='IN_APP',
            recipient_type='ADMIN', recipient_identifier=str(user.id),
            recipient_user=user, title='T', body='B', status='SENT',
        )
        defaults.update(overrides)
        return NotificationLog.objects.create(**defaults)

    def test_unread_first_ordering_and_is_read_flag(self, seed_data, api):
        from django.utils import timezone

        principal = seed_data['users']['principal']
        school = seed_data['school_a']
        read = self._make_log(school, principal, status='READ', read_at=timezone.now())
        unread = self._make_log(school, principal)

        token = api.login(principal.username)
        resp = api.get('/api/notifications/my/?ordering=unread_first', token, school.id)

        rows = resp.json().get('results', resp.json())
        assert [r['id'] for r in rows[:2]] == [unread.id, read.id]
        assert rows[0]['is_read'] is False
        assert rows[1]['is_read'] is True

    def test_unread_filter(self, seed_data, api):
        from django.utils import timezone

        principal = seed_data['users']['principal']
        school = seed_data['school_a']
        self._make_log(school, principal, status='READ', read_at=timezone.now())
        unread = self._make_log(school, principal)

        token = api.login(principal.username)
        resp = api.get('/api/notifications/my/?unread=1', token, school.id)

        rows = resp.json().get('results', resp.json())
        assert [r['id'] for r in rows] == [unread.id]

    def test_digest_counts_only_and_falls_back_without_llm(self, seed_data, api, settings):
        settings.GROQ_API_KEY = ''
        principal = seed_data['users']['principal']
        school = seed_data['school_a']
        for _ in range(3):
            self._make_log(school, principal, event_type='ABSENCE')
        self._make_log(school, principal, event_type='FEE_OVERDUE')
        # Other school must not leak into the digest.
        self._make_log(seed_data['school_b'], principal, event_type='ABSENCE')

        token = api.login(principal.username)
        resp = api.get('/api/notifications/digest/', token, school.id)

        body = resp.json()
        assert resp.status_code == 200
        assert body['total'] == 4
        assert body['source'] == 'rules'
        assert body['stats'][0]['event_type'] == 'FEE_OVERDUE'
        assert '3 absence alerts' in body['text']

    def test_digest_empty_when_all_read(self, seed_data, api):
        principal = seed_data['users']['principal']
        token = api.login(principal.username)
        resp = api.get('/api/notifications/digest/', token, seed_data['school_a'].id)

        assert resp.json() == {'text': '', 'stats': [], 'total': 0, 'source': 'none'}

    def test_bulk_mark_read_only_touches_own_accessible_rows(self, seed_data, api):
        principal = seed_data['users']['principal']
        school_a = seed_data['school_a']
        mine = self._make_log(school_a, principal)
        other_school = self._make_log(seed_data['school_b'], principal)

        token = api.login(principal.username)
        resp = api.post(
            '/api/notifications/mark-read-bulk/',
            {'ids': [mine.id, other_school.id]}, token, school_a.id,
        )

        assert resp.status_code == 200
        assert resp.json()['marked_read'] == 1
        mine.refresh_from_db()
        other_school.refresh_from_db()
        assert mine.read_at is not None and mine.status == 'READ'
        assert other_school.read_at is None

    def test_bulk_mark_read_rejects_bad_payload(self, seed_data, api):
        principal = seed_data['users']['principal']
        token = api.login(principal.username)
        resp = api.post('/api/notifications/mark-read-bulk/', {'ids': 'nope'}, token, seed_data['school_a'].id)
        assert resp.status_code == 400
