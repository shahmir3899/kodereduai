"""Admissions notes belong to the active school's enquiries, and the conversion-likelihood
scores are an admin view (the web route is admin/principal only)."""
import pytest

from admissions.models import AdmissionEnquiry, AdmissionNote

pytestmark = pytest.mark.django_db

LIKELIHOOD = '/api/admissions/conversion-likelihood/'


def _enquiry(school, name='ZZ_Hardening'):
    return AdmissionEnquiry.objects.create(
        school=school, name=name, father_name='F', mobile='0300',
    )


def _notes_url(enquiry_id):
    return f'/api/admissions/enquiries/{enquiry_id}/notes/'


def test_a_note_is_filed_on_the_active_schools_enquiry(api, seed_data):
    enquiry = _enquiry(seed_data['school_a'])

    resp = api.post(_notes_url(enquiry.id), {'note': 'Called the father', 'note_type': 'CALL'},
                    seed_data['tokens']['admin'], seed_data['SID_A'])

    assert resp.status_code == 201, resp.content
    assert resp.json()['enquiry'] == enquiry.id
    assert AdmissionNote.objects.get(enquiry=enquiry).note_type == 'CALL'


def test_a_note_cannot_be_filed_on_another_schools_enquiry(api, seed_data):
    other = _enquiry(seed_data['school_b'])

    resp = api.post(_notes_url(other.id), {'note': 'sneaky'},
                    seed_data['tokens']['admin'], seed_data['SID_A'])

    assert resp.status_code == 404
    assert not AdmissionNote.objects.filter(enquiry=other).exists()


def test_a_body_enquiry_cannot_override_the_url(api, seed_data):
    mine = _enquiry(seed_data['school_a'])
    other = _enquiry(seed_data['school_b'])

    resp = api.post(_notes_url(mine.id), {'note': 'x', 'enquiry': other.id},
                    seed_data['tokens']['admin'], seed_data['SID_A'])

    assert resp.status_code == 201, resp.content
    assert AdmissionNote.objects.filter(enquiry=mine).count() == 1
    assert not AdmissionNote.objects.filter(enquiry=other).exists()


@pytest.mark.parametrize('token', ['admin', 'principal'])
def test_admin_and_principal_read_the_likelihood_scores(api, seed_data, token):
    resp = api.get(LIKELIHOOD, seed_data['tokens'][token], seed_data['SID_A'])

    assert resp.status_code == 200, resp.content
    assert 'enquiries' in resp.json()


@pytest.mark.parametrize('token', ['teacher', 'manager', 'accountant', 'staff'])
def test_other_staff_cannot_read_the_likelihood_scores(api, seed_data, token):
    _enquiry(seed_data['school_a'])

    resp = api.get(LIKELIHOOD, seed_data['tokens'][token], seed_data['SID_A'])

    assert resp.status_code == 403
