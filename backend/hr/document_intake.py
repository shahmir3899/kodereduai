"""
Staff documents that fill themselves in: the user sends only an image, the record is
created at once as "Reading", and the scan (core.document_scan) fills the fields.

Duplicates are dropped twice: before storing, when the very same file is already on
this staff member; and after reading, when this staff member already has a document of
the same type and number. The one already on file is the one kept.
"""

import logging
import uuid

from core import document_scan
from core.task_utils import call_task

from .models import StaffDocument, StaffQualification

logger = logging.getLogger(__name__)

# Document types that are also a qualification (same values on both models).
QUALIFICATION_TYPES = set(StaffQualification.QualificationType.values)

Status = StaffDocument.ScanStatus


def remove_stored_file(doc):
    """Best effort: a storage failure must not keep the record alive."""
    try:
        from core.storage import storage_service
        path = storage_service._extract_storage_path(doc.file_url)
        if path and path.startswith('hr-documents/'):
            storage_service.delete_file(path)
    except Exception:
        logger.warning('Could not remove stored file for staff document %s', doc.id)


def delete_document(doc):
    """The record, its file, and the qualification that was read from it."""
    doc.qualifications.all().delete()
    remove_stored_file(doc)
    doc.delete()


def _number_duplicate(doc):
    number = document_scan.normalise_number(doc.document_number)
    if not number:
        return None
    others = StaffDocument.objects.filter(
        staff_member_id=doc.staff_member_id, document_type=doc.document_type,
    ).exclude(id=doc.id).exclude(scan_status=Status.PENDING)
    return next((o for o in others if document_scan.normalise_number(o.document_number) == number), None)


def sync_qualification(doc, fill_blanks_only=False, **details):
    """Keep the linked qualification in step with the document. `details` may carry
    institution / year_of_completion / grade_or_percentage."""
    qual = doc.qualifications.first()
    if doc.document_type not in QUALIFICATION_TYPES:
        if qual:
            qual.delete()
        return None
    if qual is None:
        qual = StaffQualification(staff_member_id=doc.staff_member_id, school_id=doc.school_id, document=doc)
    if not fill_blanks_only or not qual.qualification_name:
        qual.qualification_name = doc.title
        qual.qualification_type = doc.document_type
    for name in ('institution', 'year_of_completion', 'grade_or_percentage'):
        if name not in details:
            continue
        if fill_blanks_only and getattr(qual, name):
            continue
        value = details[name]
        if name == 'year_of_completion':
            try:
                value = int(value) if value not in (None, '') else None
            except (TypeError, ValueError):
                value = None
        setattr(qual, name, value or ('' if name != 'year_of_completion' else None))
    qual.save()
    return qual


def apply_scan(doc):
    """Read the document and fill its record. Returns the document, or None when it
    turned out to be a duplicate and was dropped."""
    result = document_scan.scan(doc.file_url, dict(StaffDocument.DocumentType.choices))
    doc.extracted_text = result.text
    if not result.ok:
        doc.scan_status, doc.scan_note = Status.NEEDS_REVIEW, result.note
        doc.save()
        return doc

    fields = result.fields
    # A file attached to a qualification the user typed earlier keeps their wording.
    attached = doc.qualifications.exists()
    if not attached:
        doc.document_type = fields['document_type']
        doc.title = fields['title'] or doc.title
    doc.document_number = fields['document_number']
    doc.issue_date = fields['issue_date']
    doc.expiry_date = fields['expiry_date'] or doc.expiry_date
    doc.extracted_data = fields

    if _number_duplicate(doc):
        delete_document(doc)
        return None

    review = document_scan.needs_review(fields) and not attached
    doc.scan_status = Status.NEEDS_REVIEW if review else Status.DONE
    doc.scan_note = document_scan.CHECK_NOTE if review else ''
    doc.save()
    sync_qualification(
        doc, fill_blanks_only=attached,
        institution=fields['institution'],
        year_of_completion=fields['year_of_completion'],
        grade_or_percentage=fields['grade_or_percentage'],
    )
    return doc


def intake(staff_member, file, user, qualification=None):
    """Store one uploaded file and start reading it.

    Returns (document, duplicate). duplicate=True means nothing new was kept; document
    is then the one already on file (None when it was only found after reading)."""
    from core.storage import storage_service
    from .tasks import scan_staff_document

    content = file.read()
    file.seek(0)
    file_hash = document_scan.fingerprint(content)
    existing = StaffDocument.objects.filter(staff_member=staff_member, file_hash=file_hash).first()
    if existing:
        return existing, True

    name = getattr(file, 'name', '') or 'document'
    ext = name.rsplit('.', 1)[-1].lower() if '.' in name else 'bin'
    url = storage_service.upload_file(
        file, folder=f'hr-documents/{staff_member.school_id}/{staff_member.id}',
        filename=f'{uuid.uuid4().hex}.{ext}',
    )
    doc = StaffDocument.objects.create(
        staff_member=staff_member, school_id=staff_member.school_id,
        document_type=StaffDocument.DocumentType.OTHER,
        title=(name.rsplit('.', 1)[0] or 'Document')[:200],
        file_url=url, file_hash=file_hash, uploaded_by=user,
        scan_status=Status.PENDING,
    )
    if qualification is not None:
        doc.document_type = qualification.qualification_type
        doc.title = qualification.qualification_name
        doc.save(update_fields=['document_type', 'title'])
        qualification.document = doc
        qualification.save(update_fields=['document', 'updated_at'])

    call_task(scan_staff_document, doc.id)
    doc = StaffDocument.objects.filter(id=doc.id).first()
    return doc, doc is None


def rescan(doc):
    from .tasks import scan_staff_document

    doc.scan_status, doc.scan_note = Status.PENDING, ''
    doc.save(update_fields=['scan_status', 'scan_note'])
    call_task(scan_staff_document, doc.id)
    return StaffDocument.objects.filter(id=doc.id).first()
