"""
Celery tasks for examinations app - async question paper processing.
"""

import logging
from celery import shared_task
from django.utils import timezone
from django.conf import settings

from .models import PaperUpload
from .paper_ocr_processor import PaperOCRProcessor

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=2)
def process_paper_upload_ocr(self, upload_id: int):
    """
    Process uploaded paper image with OCR to extract questions.
    
    Args:
        upload_id: ID of the PaperUpload instance
    
    Returns:
        dict: Processing result with success status and data
    """
    try:
        logger.info(f"Starting OCR processing for PaperUpload {upload_id}")
        
        # Fetch the upload
        try:
            upload = PaperUpload.objects.select_related('school').get(id=upload_id)
        except PaperUpload.DoesNotExist:
            logger.error(f"PaperUpload {upload_id} not found")
            return {'success': False, 'error': 'Upload not found'}
        
        # Update status to processing
        upload.status = PaperUpload.Status.PROCESSING
        upload.save(update_fields=['status'])
        
        # Initialize processor
        processor = PaperOCRProcessor()
        
        # Prepare context (if available)
        context = {
            'school_id': upload.school_id,
        }
        
        # Process the image
        result = processor.process_paper_image(upload.image_url, context)
        
        if result.success:
            # Update upload with extracted data
            upload.ai_extracted_json = result.to_json()
            upload.extraction_confidence = result.extraction_confidence
            upload.extraction_notes = result.notes
            upload.status = PaperUpload.Status.EXTRACTED
            upload.processed_at = timezone.now()
            upload.save()
            
            logger.info(
                f"Successfully processed PaperUpload {upload_id}: "
                f"{len(result.questions)} questions extracted"
            )
            
            return {
                'success': True,
                'upload_id': upload_id,
                'questions_count': len(result.questions),
                'confidence': result.extraction_confidence
            }
        else:
            # Update with error
            upload.status = PaperUpload.Status.FAILED
            upload.error_message = result.error or "Unknown processing error"
            upload.processed_at = timezone.now()
            upload.save()
            
            logger.error(f"Failed to process PaperUpload {upload_id}: {result.error}")
            
            return {
                'success': False,
                'upload_id': upload_id,
                'error': result.error
            }
    
    except Exception as e:
        logger.error(
            f"Unexpected error processing PaperUpload {upload_id}: {str(e)}",
            exc_info=True
        )
        
        # Try to update upload status
        try:
            upload = PaperUpload.objects.get(id=upload_id)
            upload.status = PaperUpload.Status.FAILED
            upload.error_message = f"Processing error: {str(e)}"
            upload.processed_at = timezone.now()
            upload.save()
        except Exception:
            pass
        
        # Retry if not exceeded max retries
        if self.request.retries < self.max_retries:
            logger.info(f"Retrying PaperUpload {upload_id} (attempt {self.request.retries + 1})")
            raise self.retry(exc=e, countdown=60)  # Retry after 60 seconds
        
        return {
            'success': False,
            'upload_id': upload_id,
            'error': str(e)
        }
