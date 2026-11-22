"""Login days: working days with an active-day marker or a sign-in."""
import json

import pytest
from django.core.cache import cache

from core.models import LoginEvent, UserActiveDay

from .conftest import MON, TUE, WED, at, measure, stamp

pytestmark = pytest.mark.django_db


def test_markers_and_sign_ins_count_once_per_day(perf):
    t = perf['staff'][0]
    UserActiveDay.objects.filter(user=t.user).delete()
    UserActiveDay.objects.create(user=t.user, school_id=perf['SID_A'], date=MON)
    UserActiveDay.objects.create(user=t.user, school_id=perf['SID_A'], date=TUE)
    for when in (at(TUE, 8), at(WED, 8), at(WED, 15)):
        event = LoginEvent.objects.create(user=t.user, username=t.user.username, school_id=perf['SID_A'])
        stamp(event, created_at=when)
    m = measure(perf, 'login_days')[t.id]
    assert (m['due'], m['done'], m['score']) == (6, 3, 50)


def test_sign_in_and_refresh_write_the_marker(perf, api_client):
    user = perf['staff'][0].user
    UserActiveDay.objects.all().delete()
    cache.clear()
    resp = api_client.post(
        '/api/auth/login/', data=json.dumps({'username': user.username, 'password': perf['password']}),
        content_type='application/json',
    )
    assert resp.status_code == 200, resp.content
    assert UserActiveDay.objects.filter(user=user).count() == 1

    UserActiveDay.objects.all().delete()
    cache.clear()
    resp = api_client.post(
        '/api/auth/refresh/', data=json.dumps({'refresh': resp.json()['refresh']}),
        content_type='application/json',
    )
    assert resp.status_code == 200, resp.content
    assert UserActiveDay.objects.filter(user=user).count() == 1
