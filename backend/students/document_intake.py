"""
Student documents that fill themselves in. Same flow as hr.document_intake: the user
sends only a file, the record is created as "Reading", and core.document_scan fills it.
A duplicate (the same file, or the same type and number, for this student) is not kept.
"""

import logging
import uuid

from core import document_scan
from core.task_utils import call_task

from .models import StudentDocument

logger = logging.getLogger(__name__)

Status = StudentDocument.ScanStatus


def remove_stored_file(doc):
    """Best effort: a storage failure must not keep the record alive."""
    try:
        from core.storage import storage_service
        path = storage_service._extract_storage_path(doc.file_url)
        if path and path.startswith('student-documents/'):
            storage_service.delete_file(path)
    except Exception:
        logger.warning('Could not remove stored file for student document %s', doc.id)


def delete_document(doc):
    remove_stored_file(doc)
    doc.delete()


def _number_duplicate(doc):
    number = document_scan.normalise_number(doc.document_number)
    if not number:
        return None
    others = StudentDocument.objects.filter(
        student_id=doc.student_id, document_type=doc.document_type,
    ).exclude(id=doc.id).exclude(scan_status=Status.PENDING)
    return next((o for o in others if document_scan.normalise_number(o.document_number) == number), None)


def apply_scan(doc):
    """Read the document and fill its record. Returns the document, or None when it
    turned out to be a duplicate and was dropped."""
    result = document_scan.scan(doc.file_url, dict(StudentDocument.DOCUMENT_TYPE_CHOICES))
    doc.extracted_text = result.text
    if not result.ok:
        doc.scan_status, doc.scan_note = Status.NEEDS_REVIEW, result.note
        doc.save()
        return doc

    fields = result.fields
    doc.document_type = fields['document_type']
    doc.title = fields['title'] or doc.title
    doc.document_number = fields['document_number']
    doc.issue_date = fields['issue_date']
    doc.expiry_date = fields['expiry_date']
    doc.extracted_data = fields

    if _number_duplicate(doc):
        delete_document(doc)
        return None

    review = document_scan.needs_review(fields)
    doc.scan_status = Status.NEEDS_REVIEW if review else Status.DONE
    doc.scan_note = document_scan.CHECK_NOTE if review else ''
    doc.save()
    return doc


def intake(student, file, user):
    """Store one uploaded file and start reading it.

    Returns (document, duplicate). duplicate=True means nothing new was kept; document
    is then the one already on file (None when it was only found after reading)."""
    from core.storage import storage_service
    from .tasks import scan_student_document

    content = file.read()
    file.seek(0)
    file_hash = document_scan.fingerprint(content)
    existing = StudentDocument.objects.filter(student=student, file_hash=file_hash).first()
    if existing:
        return existing, True

    name = getattr(file, 'name', '') or 'document'
    ext = name.rsplit('.', 1)[-1].lower() if '.' in name else 'bin'
    url = storage_service.upload_file(
        file, folder=f'student-documents/{student.school_id}/{student.id}',
        filename=f'{uuid.uuid4().hex}.{ext}',
    )
    doc = StudentDocument.objects.create(
        student=student, school_id=student.school_id, document_type='OTHER',
        title=(name.rsplit('.', 1)[0] or 'Document')[:200],
        file_url=url, file_hash=file_hash, uploaded_by=user,
        scan_status=Status.PENDING,
    )
    call_task(scan_student_document, doc.id)
    doc = StudentDocument.objects.filter(id=doc.id).first()
    return doc, doc is None


def rescan(doc):
    from .tasks import scan_student_document

    doc.scan_status, doc.scan_note = Status.PENDING, ''
    doc.save(update_fields=['scan_status', 'scan_note'])
    call_task(scan_student_document, doc.id)
    return StudentDocument.objects.filter(id=doc.id).first()
