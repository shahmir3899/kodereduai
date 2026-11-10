"""
Background tasks for students.
"""

import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(bind=True, time_limit=180)
def scan_student_document(self, document_id):
    """Read one uploaded student document and fill in its record."""
    from core import document_scan
    from students.document_intake import apply_scan
    from students.models import StudentDocument

    doc = StudentDocument.objects.filter(id=document_id).first()
    if doc is None:
        return
    try:
        apply_scan(doc)
    except Exception:
        # Never leave a record stuck on "Reading": hand it to the user instead.
        logger.exception('Student document scan failed for %s', document_id)
        StudentDocument.objects.filter(id=document_id).update(
            scan_status=StudentDocument.ScanStatus.NEEDS_REVIEW, scan_note=document_scan.FAILED_NOTE,
        )
