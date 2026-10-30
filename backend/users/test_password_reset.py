"""Reset emails must link to the real web app. They used to fall back to http://localhost:3000
because FRONTEND_URL was never defined in settings (shared seed school)."""
import json

import pytest
from django.core import mail
from django.conf import settings

from users.models import User


@pytest.mark.django_db
def test_frontend_url_is_defined_in_settings():
    assert settings.FRONTEND_URL
    assert not settings.FRONTEND_URL.endswith('/')


@pytest.mark.django_db
def test_reset_email_links_to_the_configured_frontend(api_client, seed_data, settings):
    settings.FRONTEND_URL = 'https://www.educationai.pk'
    user = User.objects.create_user(
        username='reset_me', email='reset_me@test.com', password=seed_data['password'], role='STAFF',
        school=seed_data['school_a'], organization=seed_data['org'],
    )

    resp = api_client.post(
        '/api/auth/password-reset/', data=json.dumps({'email': user.email}), content_type='application/json',
    )

    assert resp.status_code == 200
    assert len(mail.outbox) == 1
    body = mail.outbox[0].body
    assert 'https://www.educationai.pk/reset-password?uid=' in body
    assert 'localhost' not in body


@pytest.mark.django_db
def test_reset_request_for_unknown_email_sends_nothing_and_looks_the_same(api_client):
    resp = api_client.post(
        '/api/auth/password-reset/', data=json.dumps({'email': 'nobody@test.com'}), content_type='application/json',
    )

    assert resp.status_code == 200
    assert mail.outbox == []
