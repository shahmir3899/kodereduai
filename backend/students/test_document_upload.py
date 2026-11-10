"""A student document is a real stored file: the documents endpoint takes a multipart "file",
stores it and saves its link; a wrong type is refused; deleting removes the stored file too.
The storage service is faked (shared seed school, no network)."""
from unittest.mock import patch

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from students.models import StudentDocument

STORED = 'https://x.supabase.co/storage/v1/object/public/atten-reg/student-documents/1/2/abc.pdf'


def _post_file(api, seed_data, student, upload, **fields):
    return api.client.post(
        f'/api/students/{student.id}/documents/', data={'file': upload, **fields},
        HTTP_AUTHORIZATION=f"Bearer {seed_data['tokens']['admin']}", HTTP_X_SCHOOL_ID=str(seed_data['SID_A']),
    )


@pytest.mark.django_db
def test_upload_stores_the_file_and_saves_its_link(api, seed_data):
    student = seed_data['students'][0]
    pdf = SimpleUploadedFile('birth.pdf', b'%PDF-1.4 test', content_type='application/pdf')
    with patch('core.storage.storage_service.upload_file', return_value=STORED) as upload:
        resp = _post_file(api, seed_data, student, pdf, title='Birth certificate', document_type='BIRTH_CERT')
    assert resp.status_code == 201, resp.content
    doc = StudentDocument.objects.get(id=resp.json()['id'])
    assert (doc.file_url, doc.title, doc.document_type) == (STORED, 'Birth certificate', 'BIRTH_CERT')
    assert doc.student_id == student.id and doc.school_id == student.school_id
    kwargs = upload.call_args.kwargs
    assert kwargs['folder'] == f'student-documents/{student.school_id}/{student.id}'
    assert kwargs['filename'].endswith('.pdf') and 'birth' not in kwargs['filename']


@pytest.mark.django_db
def test_title_and_type_default_from_the_file(api, seed_data):
    student = seed_data['students'][0]
    image = SimpleUploadedFile('scan.png', b'\x89PNG', content_type='image/png')
    with patch('core.storage.storage_service.upload_file', return_value=STORED):
        resp = _post_file(api, seed_data, student, image)
    assert resp.status_code == 201, resp.content
    assert (resp.json()['title'], resp.json()['document_type']) == ('scan.png', 'OTHER')


@pytest.mark.django_db
def test_a_file_of_the_wrong_type_is_refused_and_nothing_is_stored(api, seed_data):
    student = seed_data['students'][0]
    bad = SimpleUploadedFile('run.exe', b'MZ', content_type='application/x-msdownload')
    with patch('core.storage.storage_service.upload_file') as upload:
        resp = _post_file(api, seed_data, student, bad, title='x')
    assert resp.status_code == 400
    upload.assert_not_called()
    assert not StudentDocument.objects.filter(student=student).exists()


@pytest.mark.django_db
def test_delete_removes_the_stored_file(api, seed_data):
    student = seed_data['students'][0]
    doc = StudentDocument.objects.create(
        school_id=student.school_id, student=student, document_type='OTHER', title='t', file_url=STORED,
    )
    with patch('core.storage.storage_service.delete_file', return_value=True) as delete, \
            patch('core.storage.storage_service._extract_storage_path', return_value='student-documents/1/2/abc.pdf'):
        resp = api.client.delete(
            f'/api/students/{student.id}/documents/{doc.id}/',
            HTTP_AUTHORIZATION=f"Bearer {seed_data['tokens']['admin']}", HTTP_X_SCHOOL_ID=str(seed_data['SID_A']),
        )
    assert resp.status_code == 204
    delete.assert_called_once_with('student-documents/1/2/abc.pdf')
    assert not StudentDocument.objects.filter(id=doc.id).exists()


# ── Image-only upload: the record is read from the image ──────────────────────

from core import document_scan  # noqa: E402

FIELDS = {
    'document_type': 'BIRTH_CERT', 'title': 'Birth Certificate', 'document_number': 'BC-991',
    'issue_date': '2015-03-02', 'expiry_date': None, 'person_name': 'Sara', 'institution': '',
    'year_of_completion': None, 'grade_or_percentage': '', 'confidence': 0.9,
}
AUTH = lambda seed_data: {  # noqa: E731
    'HTTP_AUTHORIZATION': f"Bearer {seed_data['tokens']['admin']}", 'HTTP_X_SCHOOL_ID': str(seed_data['SID_A']),
}


def _scan(api, seed_data, student, content=b'img-1', name='photo.jpg', fields=None, fail=False):
    upload = SimpleUploadedFile(name, content, content_type='image/jpeg')
    with patch('core.storage.storage_service.upload_file', return_value=STORED.replace('abc.pdf', name)) as stored, \
            patch('core.document_scan.read_text', return_value='raw'), \
            patch('core.document_scan.extract_fields', return_value=fields or FIELDS) as reader:
        if fail:
            reader.side_effect = document_scan.ScanError('down')
        resp = api.client.post(f'/api/students/{student.id}/documents/scan/', data={'file': upload}, **AUTH(seed_data))
    return resp, stored


@pytest.mark.django_db
def test_scan_upload_fills_the_record_from_the_image(api, seed_data):
    student = seed_data['students'][0]
    resp, _ = _scan(api, seed_data, student)
    assert resp.status_code == 201, resp.content
    doc = StudentDocument.objects.get(id=resp.json()['document']['id'])
    assert (doc.document_type, doc.title, doc.document_number, str(doc.issue_date)) == (
        'BIRTH_CERT', 'Birth Certificate', 'BC-991', '2015-03-02')
    assert doc.scan_status == 'DONE' and doc.file_hash and doc.uploaded_by_id
    assert resp.json()['document']['name_on_document'] == 'Sara'


@pytest.mark.django_db
def test_scan_keeps_one_of_a_duplicate(api, seed_data):
    student = seed_data['students'][0]
    first, _ = _scan(api, seed_data, student)
    same_file, stored = _scan(api, seed_data, student)
    assert same_file.status_code == 200 and same_file.json()['document']['id'] == first.json()['document']['id']
    stored.assert_not_called()
    with patch('core.storage.storage_service.delete_file', return_value=True) as deleted, \
            patch('core.storage.storage_service._extract_storage_path', return_value='student-documents/1/2/b.jpg'):
        same_number, _ = _scan(api, seed_data, student, content=b'img-2', name='b.jpg',
                               fields={**FIELDS, 'document_number': 'bc 991'})
    assert same_number.json() == {'duplicate': True, 'document': None}
    deleted.assert_called_once_with('student-documents/1/2/b.jpg')
    assert StudentDocument.objects.filter(student=student).count() == 1


@pytest.mark.django_db
def test_a_failed_read_needs_review_until_someone_edits_it(api, seed_data):
    student = seed_data['students'][0]
    resp, _ = _scan(api, seed_data, student, fail=True)
    doc = resp.json()['document']
    assert (doc['scan_status'], doc['title'], doc['document_type']) == ('NEEDS_REVIEW', 'photo', 'OTHER')
    edit = api.client.patch(
        f"/api/students/{student.id}/documents/{doc['id']}/",
        data={'title': 'Transfer certificate', 'document_type': 'TC', 'expiry_date': None, 'file_url': 'https://evil.example/x.jpg'},
        content_type='application/json', **AUTH(seed_data),
    )
    assert edit.status_code == 200, edit.content
    saved = StudentDocument.objects.get(id=doc['id'])
    assert (saved.scan_status, saved.title, saved.document_type) == ('DONE', 'Transfer certificate', 'TC')
    assert saved.file_url == doc['file_url']  # an edit can never repoint the file
