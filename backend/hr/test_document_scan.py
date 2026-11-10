"""Staff documents that fill themselves in: the user sends only a file, the record is read
from the image, and a duplicate is not kept. Storage and the reader are faked (shared seed
school, no network)."""
from unittest.mock import patch

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from core import document_scan
from core.document_scan import ScanResult
from hr.models import StaffDocument, StaffQualification

BASE = 'https://x.supabase.co/storage/v1/object/public/atten-reg/hr-documents/1/2/'


def _fields(**over):
    fields = {
        'document_type': 'ID_DOCUMENT', 'title': 'CNIC', 'document_number': '35202-1234567-1',
        'issue_date': '2020-01-05', 'expiry_date': '2030-01-05', 'person_name': 'Ali Khan',
        'institution': '', 'year_of_completion': None, 'grade_or_percentage': '', 'confidence': 0.9,
    }
    fields.update(over)
    return fields


def _auth(seed_data, who='admin'):
    return {'HTTP_AUTHORIZATION': f"Bearer {seed_data['tokens'][who]}", 'HTTP_X_SCHOOL_ID': str(seed_data['SID_A'])}


def _scan(api, seed_data, staff, content=b'image-one', name='photo.jpg', who='admin', fields=None, ok=True, **extra):
    upload = SimpleUploadedFile(name, content, content_type='application/pdf' if name.endswith('.pdf') else 'image/jpeg')
    result = ScanResult(ok=ok, text='raw text', fields=fields or _fields(), note='' if ok else document_scan.FAILED_NOTE)
    with patch('core.storage.storage_service.upload_file', return_value=BASE + name) as stored, \
            patch('core.document_scan.read_text', return_value='raw text'), \
            patch('core.document_scan.extract_fields', return_value=result.fields) as reader:
        if not ok:
            reader.side_effect = document_scan.ScanError('down')
        resp = api.client.post(
            '/api/hr/documents/scan/', data={'staff_member': staff.id, 'file': upload, **extra}, **_auth(seed_data, who),
        )
    return resp, stored


@pytest.mark.django_db
def test_upload_fills_the_record_from_the_image(api, seed_data):
    staff = seed_data['staff'][0]
    resp, stored = _scan(api, seed_data, staff)
    assert resp.status_code == 201, resp.content
    body = resp.json()
    assert body['duplicate'] is False
    doc = StaffDocument.objects.get(id=body['document']['id'])
    assert (doc.document_type, doc.title, doc.document_number) == ('ID_DOCUMENT', 'CNIC', '35202-1234567-1')
    assert (str(doc.issue_date), str(doc.expiry_date)) == ('2020-01-05', '2030-01-05')
    assert doc.scan_status == 'DONE' and doc.file_hash and doc.uploaded_by_id
    assert body['document']['name_on_document'] == 'Ali Khan'
    assert stored.call_args.kwargs['folder'] == f'hr-documents/{staff.school_id}/{staff.id}'


@pytest.mark.django_db
def test_a_degree_also_becomes_a_qualification(api, seed_data):
    staff = seed_data['staff'][0]
    resp, _ = _scan(api, seed_data, staff, fields=_fields(
        document_type='DEGREE', title='B.Ed', document_number='', institution='AIOU', year_of_completion=2015,
        grade_or_percentage='A',
    ))
    doc = resp.json()['document']
    qual = StaffQualification.objects.get(document_id=doc['id'])
    assert (qual.qualification_type, qual.qualification_name, qual.institution, qual.year_of_completion) == (
        'DEGREE', 'B.Ed', 'AIOU', 2015)
    assert (doc['institution'], doc['year_of_completion'], doc['qualification_id']) == ('AIOU', 2015, qual.id)


@pytest.mark.django_db
def test_the_same_file_twice_is_kept_once(api, seed_data):
    staff = seed_data['staff'][0]
    first, _ = _scan(api, seed_data, staff)
    second, stored = _scan(api, seed_data, staff)
    assert second.status_code == 200 and second.json()['duplicate'] is True
    assert second.json()['document']['id'] == first.json()['document']['id']
    stored.assert_not_called()
    assert StaffDocument.objects.filter(staff_member=staff).count() == 1


@pytest.mark.django_db
def test_a_second_photo_of_the_same_document_is_dropped_with_its_file(api, seed_data):
    staff = seed_data['staff'][0]
    _scan(api, seed_data, staff)
    with patch('core.storage.storage_service.delete_file', return_value=True) as deleted, \
            patch('core.storage.storage_service._extract_storage_path', return_value='hr-documents/1/2/b.jpg'):
        resp, _ = _scan(api, seed_data, staff, content=b'image-two', name='b.jpg',
                        fields=_fields(document_number='35202 1234567 1'))
    assert resp.status_code == 200 and resp.json() == {'duplicate': True, 'document': None}
    deleted.assert_called_once_with('hr-documents/1/2/b.jpg')
    assert StaffDocument.objects.filter(staff_member=staff).count() == 1


@pytest.mark.django_db
def test_the_same_number_on_another_staff_member_is_not_a_duplicate(api, seed_data):
    one, two = seed_data['staff'][0], seed_data['staff'][1]
    _scan(api, seed_data, one)
    resp, _ = _scan(api, seed_data, two, content=b'image-two')
    assert resp.status_code == 201


@pytest.mark.django_db
def test_a_failed_read_keeps_the_record_for_review_and_an_edit_clears_it(api, seed_data):
    staff = seed_data['staff'][0]
    resp, _ = _scan(api, seed_data, staff, ok=False)
    doc = resp.json()['document']
    assert resp.status_code == 201 and doc['scan_status'] == 'NEEDS_REVIEW' and doc['title'] == 'photo'
    edit = api.client.patch(
        f"/api/hr/documents/{doc['id']}/",
        data={'title': 'Contract 2026', 'document_type': 'CONTRACT'}, content_type='application/json', **_auth(seed_data),
    )
    assert edit.status_code == 200, edit.content
    assert (edit.json()['scan_status'], edit.json()['title']) == ('DONE', 'Contract 2026')


@pytest.mark.django_db
def test_a_pdf_is_stored_but_not_read(api, seed_data):
    staff = seed_data['staff'][0]
    with patch('core.document_scan.read_text') as reader:
        upload = SimpleUploadedFile('contract.pdf', b'%PDF-1.4', content_type='application/pdf')
        with patch('core.storage.storage_service.upload_file', return_value=BASE + 'contract.pdf'):
            resp = api.client.post('/api/hr/documents/scan/', data={'staff_member': staff.id, 'file': upload}, **_auth(seed_data))
    reader.assert_not_called()
    doc = resp.json()['document']
    assert (doc['scan_status'], doc['title'], doc['scan_note']) == ('NEEDS_REVIEW', 'contract', document_scan.NOT_READABLE_NOTE)


@pytest.mark.django_db
def test_a_file_attached_to_a_typed_qualification_keeps_its_wording(api, seed_data):
    staff = seed_data['staff'][0]
    qual = StaffQualification.objects.create(
        staff_member=staff, school_id=staff.school_id, qualification_type='DEGREE', qualification_name='M.A. English',
    )
    resp, _ = _scan(api, seed_data, staff, qualification=qual.id, fields=_fields(
        document_type='OTHER', title='Transcript', document_number='R-77', institution='PU', confidence=0.3,
    ))
    doc = resp.json()['document']
    qual.refresh_from_db()
    assert (doc['document_type'], doc['title'], doc['scan_status']) == ('DEGREE', 'M.A. English', 'DONE')
    assert (qual.document_id, qual.qualification_name, qual.institution) == (doc['id'], 'M.A. English', 'PU')
    assert StaffQualification.objects.filter(staff_member=staff).count() == 1


@pytest.mark.django_db
def test_editing_the_type_away_from_a_qualification_removes_it(api, seed_data):
    staff = seed_data['staff'][0]
    resp, _ = _scan(api, seed_data, staff, fields=_fields(document_type='DIPLOMA', title='DAE', document_number=''))
    doc_id = resp.json()['document']['id']
    assert StaffQualification.objects.filter(document_id=doc_id).exists()
    api.client.patch(f'/api/hr/documents/{doc_id}/', data={'document_type': 'OTHER'},
                     content_type='application/json', **_auth(seed_data))
    assert not StaffQualification.objects.filter(staff_member=staff, qualification_name='DAE').exists()


@pytest.mark.django_db
def test_delete_removes_the_file_and_the_linked_qualification(api, seed_data):
    staff = seed_data['staff'][0]
    resp, _ = _scan(api, seed_data, staff, fields=_fields(document_type='DEGREE', title='B.Sc', document_number=''))
    doc_id = resp.json()['document']['id']
    with patch('core.storage.storage_service.delete_file', return_value=True) as deleted, \
            patch('core.storage.storage_service._extract_storage_path', return_value='hr-documents/1/2/photo.jpg'):
        gone = api.client.delete(f'/api/hr/documents/{doc_id}/', **_auth(seed_data))
    assert gone.status_code == 204
    deleted.assert_called_once_with('hr-documents/1/2/photo.jpg')
    assert not StaffDocument.objects.filter(id=doc_id).exists()
    assert not StaffQualification.objects.filter(staff_member=staff, qualification_name='B.Sc').exists()


@pytest.mark.django_db
def test_a_teacher_cannot_upload_and_another_schools_staff_is_refused(api, seed_data):
    staff = seed_data['staff'][0]
    resp, stored = _scan(api, seed_data, staff, who='teacher')
    assert resp.status_code == 403
    upload = SimpleUploadedFile('a.jpg', b'x', content_type='image/jpeg')
    with patch('core.storage.storage_service.upload_file') as stored:
        other = api.client.post(
            '/api/hr/documents/scan/', data={'staff_member': staff.id, 'file': upload},
            HTTP_AUTHORIZATION=f"Bearer {seed_data['tokens']['admin_b']}", HTTP_X_SCHOOL_ID=str(seed_data['SID_B']),
        )
    assert other.status_code == 400
    stored.assert_not_called()


def test_reader_output_is_forced_into_known_fields():
    cleaned = document_scan.clean_fields({
        'document_type': 'passport', 'title': 'x' * 300, 'issue_date': '05/01/2020', 'expiry_date': '2030-01-05',
        'year_of_completion': '1800', 'confidence': 7, 'extra': 'ignored',
    }, {'OTHER': 'Other', 'ID_DOCUMENT': 'ID'})
    assert cleaned['document_type'] == 'OTHER' and len(cleaned['title']) == 200
    assert (cleaned['issue_date'], cleaned['expiry_date']) == (None, '2030-01-05')
    assert cleaned['year_of_completion'] is None and cleaned['confidence'] == 1.0 and 'extra' not in cleaned
    assert document_scan.normalise_number('35202-1234567-1') == document_scan.normalise_number('35202 1234567 1')
