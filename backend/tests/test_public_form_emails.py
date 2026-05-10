from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
import pytest

from brochure.models import career_cv_upload_path


@pytest.mark.django_db
@override_settings(
    EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
    LANDING_FORMS_EMAIL_RECIPIENT='forms@example.com',
    LANDING_FORMS_EMAIL_SENDER='noreply@example.com',
    CAREERS_EMAIL_RECIPIENT='forms@example.com',
    CAREERS_EMAIL_SENDER='noreply@example.com',
    CAREERS_SAVE_TO_DB=False,
)
def test_public_demo_request_sends_branded_email(client):
    response = client.post(
        '/api/public/forms/demo-request/',
        data={
            'name': 'Sarah Mitchell',
            'school': 'Oakridge Academy',
            'email': 'sarah@oakridge.edu',
            'preferred_date': '2026-05-05',
        },
        content_type='application/json',
    )

    assert response.status_code == 201
    assert len(mail.outbox) == 1
    assert mail.outbox[0].subject == 'Education AI - Form Demo Request'
    assert 'Education AI - Form Demo Request' in mail.outbox[0].alternatives[0][0]
    assert 'Oakridge Academy' in mail.outbox[0].alternatives[0][0]
    assert response.json().get('visitor_credentials_email_sent') is False


@pytest.mark.django_db
@override_settings(
    EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
    LANDING_FORMS_EMAIL_RECIPIENT='forms@example.com',
    LANDING_FORMS_EMAIL_SENDER='noreply@example.com',
    CAREERS_EMAIL_RECIPIENT='forms@example.com',
    CAREERS_EMAIL_SENDER='noreply@example.com',
    CAREERS_SAVE_TO_DB=False,
    DEMO_ACCESS_EMAIL_ENABLED=True,
    DEMO_ACCESS_LOGIN_URL='https://demo.example.test/login',
    DEMO_ACCESS_USERNAME='demo_user',
    DEMO_ACCESS_PASSWORD='demo_pass',
    DEMO_ACCESS_EMAIL_SUBJECT='Your demo login',
    DEMO_ACCESS_EMAIL_SENDER='noreply@example.com',
)
def test_public_demo_request_sends_visitor_credentials_when_enabled(client):
    response = client.post(
        '/api/public/forms/demo-request/',
        data={
            'name': 'Sarah Mitchell',
            'school': 'Oakridge Academy',
            'email': 'sarah@oakridge.edu',
            'preferred_date': '2026-05-05',
        },
        content_type='application/json',
    )

    assert response.status_code == 201
    assert len(mail.outbox) == 2
    assert mail.outbox[0].subject == 'Education AI - Form Demo Request'
    assert mail.outbox[0].to == ['forms@example.com']
    assert mail.outbox[1].to == ['sarah@oakridge.edu']
    assert mail.outbox[1].subject == 'Your demo login'
    body = mail.outbox[1].alternatives[0][0]
    assert 'demo_user' in body
    assert 'demo_pass' in body
    assert 'https://demo.example.test/login' in body
    assert response.json().get('visitor_credentials_email_sent') is True


@pytest.mark.django_db
@override_settings(
    EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
    LANDING_FORMS_EMAIL_RECIPIENT='forms@example.com',
    LANDING_FORMS_EMAIL_SENDER='noreply@example.com',
)
def test_public_contact_enquiry_sends_branded_email(client):
    response = client.post(
        '/api/public/forms/contact-enquiry/',
        data={
            'name': 'Sarah Mitchell',
            'school': 'Oakridge Academy',
            'email': 'sarah@oakridge.edu',
            'phone': '+92 300 0000000',
            'message': 'We need a branch-wise demo for two campuses.',
        },
        content_type='application/json',
    )

    assert response.status_code == 201
    assert len(mail.outbox) == 1
    assert mail.outbox[0].subject == 'Education AI - Form Contact Enquiry'
    assert 'Education AI - Form Contact Enquiry' in mail.outbox[0].alternatives[0][0]
    assert 'We need a branch-wise demo for two campuses.' in mail.outbox[0].alternatives[0][0]


@pytest.mark.django_db
@override_settings(
    EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
    LANDING_FORMS_EMAIL_RECIPIENT='forms@example.com',
    LANDING_FORMS_EMAIL_SENDER='noreply@example.com',
    CAREERS_EMAIL_RECIPIENT='forms@example.com',
    CAREERS_EMAIL_SENDER='noreply@example.com',
    CAREERS_SAVE_TO_DB=False,
)
def test_public_career_application_sends_branded_email(client):
    cv_file = SimpleUploadedFile('cv.pdf', b'%PDF-1.4 test pdf', content_type='application/pdf')

    response = client.post(
        '/api/public/careers/apply/',
        data={
            'full_name': 'Ali Hassan',
            'email': 'ali@example.com',
            'phone': '+92 301 1234567',
            'role_applied': 'Frontend Engineer',
            'cover_letter': 'I build landing pages and product UI.',
            'cv_file': cv_file,
        },
    )

    assert response.status_code == 201
    assert len(mail.outbox) == 1
    assert mail.outbox[0].subject == 'Education AI - Form Career Application'
    assert 'Education AI - Form Career Application' in mail.outbox[0].alternatives[0][0]
    assert 'Frontend Engineer' in mail.outbox[0].alternatives[0][0]
    assert len(mail.outbox[0].attachments) == 1


def test_career_cv_upload_path_uses_now_when_created_at_missing():
    instance = type('Obj', (), {'created_at': None})()
    path = career_cv_upload_path(instance, 'resume.pdf')
    assert path.startswith(f"files/careers/cv/{timezone.now():%Y/%m}/")
    assert path.endswith('_resume.pdf')


def test_career_cv_upload_path_uses_instance_created_at_when_available():
    dt = timezone.datetime(2026, 4, 1, tzinfo=timezone.get_current_timezone())
    instance = type('Obj', (), {'created_at': dt})()
    path = career_cv_upload_path(instance, 'resume.pdf')
    assert path.startswith('files/careers/cv/2026/04/')
    assert path.endswith('_resume.pdf')