"""
A phone stays signed in for MOBILE_REFRESH_DAYS of inactivity; the web keeps the short default.

Run:
    cd backend
    pytest tests/test_mobile_session.py -v
"""
import json
from datetime import timedelta

import pytest
from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken

from schools.models import School

LOGIN = '/api/auth/login/'
REFRESH = '/api/auth/refresh/'
PASSWORD = 'PhoneTest123!'


@pytest.fixture
def person(db):
    school = School.objects.create(name='PYTEST Phone School', subdomain='pytest-phone')
    return get_user_model().objects.create_user(username='pytest_phone', email='phone@pytest.test', password=PASSWORD, role='STAFF', school=school)


def _post(client, url, body, **headers):
    return client.post(url, data=json.dumps(body), content_type='application/json', **headers)


def _days_left(token):
    t = RefreshToken(token)
    return (t.payload['exp'] - t.payload['iat']) / 86400


@pytest.mark.django_db
class TestMobileSession:
    def test_phone_sign_in_gets_the_long_window(self, client, person):
        resp = _post(client, LOGIN, {'username': person.username, 'password': PASSWORD}, HTTP_X_CLIENT='mobile')
        assert resp.status_code == 200
        body = resp.json()
        assert _days_left(body['refresh']) == pytest.approx(settings.MOBILE_REFRESH_DAYS, abs=0.01)
        assert RefreshToken(body['refresh']).payload['client'] == 'mobile'
        assert body['user']['username'] == person.username

    def test_web_sign_in_keeps_the_short_window(self, client, person):
        body = _post(client, LOGIN, {'username': person.username, 'password': PASSWORD}).json()
        assert _days_left(body['refresh']) == pytest.approx(settings.SIMPLE_JWT['REFRESH_TOKEN_LIFETIME'] / timedelta(days=1), abs=0.01)
        assert 'client' not in RefreshToken(body['refresh']).payload

    def test_phone_access_token_still_works(self, client, person):
        body = _post(client, LOGIN, {'username': person.username, 'password': PASSWORD}, HTTP_X_CLIENT='mobile').json()
        me = client.get('/api/auth/me/', HTTP_AUTHORIZATION=f"Bearer {body['access']}")
        assert me.status_code == 200
        assert me.json()['username'] == person.username

    def test_refreshing_slides_the_phone_window_forward(self, client, person):
        first = _post(client, LOGIN, {'username': person.username, 'password': PASSWORD}, HTTP_X_CLIENT='mobile').json()
        resp = _post(client, REFRESH, {'refresh': first['refresh']})
        assert resp.status_code == 200
        again = resp.json()
        # A new refresh token comes back (the app must store it), still on the long window.
        assert again['refresh'] != first['refresh']
        assert _days_left(again['refresh']) == pytest.approx(settings.MOBILE_REFRESH_DAYS, abs=0.01)
        assert RefreshToken(again['refresh']).payload['client'] == 'mobile'

    def test_refreshing_a_web_session_stays_short(self, client, person):
        first = _post(client, LOGIN, {'username': person.username, 'password': PASSWORD}).json()
        again = _post(client, REFRESH, {'refresh': first['refresh']}).json()
        assert _days_left(again['refresh']) == pytest.approx(settings.SIMPLE_JWT['REFRESH_TOKEN_LIFETIME'] / timedelta(days=1), abs=0.01)

    def test_a_deactivated_user_cannot_refresh(self, client, person):
        first = _post(client, LOGIN, {'username': person.username, 'password': PASSWORD}, HTTP_X_CLIENT='mobile').json()
        person.is_active = False
        person.save(update_fields=['is_active'])
        assert _post(client, REFRESH, {'refresh': first['refresh']}).status_code in (401, 403)

    def test_a_wrong_password_is_still_refused_on_the_phone(self, client, person):
        resp = _post(client, LOGIN, {'username': person.username, 'password': 'nope'}, HTTP_X_CLIENT='mobile')
        assert resp.status_code == 401
