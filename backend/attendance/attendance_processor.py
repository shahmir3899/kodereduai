"""
Attendance Processor - Main Pipeline Orchestrator.

Supports three pipelines:
1. Legacy OCR Pipeline: Image → Tesseract OCR → Structured Table → LLM Reasoning → Human Review
2. Groq Vision Pipeline: Image → Groq Vision AI → Structured Data → Human Review
3. Google Vision Pipeline: Image → Google Cloud Vision → Structured Data → Human Review (recommended)

The Google Vision pipeline is best for handwritten registers - it has specialized
handwriting detection optimized for document OCR.
"""

import logging
from typing import Dict, Any, Optional
from datetime import date
from dataclasses import dataclass

from django.conf import settings

from .ocr_service import OCRService, OCRResult
from .table_extractor import TableExtractor, StructuredTable
from .llm_reasoner import LLMReasoner, ReasoningResult
from .vision_extractor import VisionExtractor, VisionExtractionResult
from .google_vision_extractor import GoogleVisionExtractor, GoogleVisionResult

logger = logging.getLogger(__name__)

# Default to vision pipeline - much better for handwritten text
USE_VISION_PIPELINE = getattr(settings, 'USE_VISION_PIPELINE', True)

# Vision provider: 'google' (recommended), 'groq', or 'tesseract' (legacy)
VISION_PROVIDER = getattr(settings, 'VISION_PROVIDER', 'google')


@dataclass
class ProcessingResult:
    """Complete result from the attendance processing pipeline."""
    success: bool

    # Pipeline stage outputs
    ocr_result: Optional[OCRResult] = None
    structured_table: Optional[StructuredTable] = None
    reasoning_result: Optional[ReasoningResult] = None

    # Final output (compatible with existing frontend)
    matched: list = None
    unmatched: list = None
    matched_count: int = 0
    unmatched_count: int = 0
    uncertain: list = None
    corrections: list = None
    confidence: float = 0.0
    notes: str = ""

    # Debugging/audit
    pipeline_stages: dict = None
    error: Optional[str] = None
    error_stage: Optional[str] = None

    def __post_init__(self):
        if self.matched is None:
            self.matched = []
        if self.unmatched is None:
            self.unmatched = []
        if self.uncertain is None:
            self.uncertain = []
        if self.corrections is None:
            self.corrections = []
        if self.pipeline_stages is None:
            self.pipeline_stages = {}

    def to_ai_output_json(self) -> Dict[str, Any]:
        """Convert to format expected by existing AttendanceUpload model."""
        return {
            'matched': self.matched,
            'unmatched': self.unmatched,
            'matched_count': self.matched_count,
            'unmatched_count': self.unmatched_count,
            'uncertain': self.uncertain,
            'corrections': self.corrections,
            'confidence': self.confidence,
            'notes': self.notes,
            'pipeline_stages': self.pipeline_stages
        }


class AttendanceProcessor:
    """
    Main orchestrator for the attendance processing pipeline.

    Pipeline Steps:
    1. Image → OCR (Tesseract)
    2. OCR → Structured Table (TableExtractor)
    3. Structured Table → LLM Reasoning (LLMReasoner)
    4. Output for Human Review
    5. After confirmation → Learning Loop (LearningService)
    """

    def __init__(self, upload, use_vision: Optional[bool] = None, vision_provider: Optional[str] = None):
        """
        Initialize processor with an AttendanceUpload instance.

        Args:
            upload: AttendanceUpload model instance
            use_vision: Override to force vision or OCR pipeline (None = use default)
            vision_provider: Override vision provider ('google', 'groq', or 'tesseract')
        """
        self.upload = upload
        self.school = upload.school
        self.class_obj = upload.class_obj
        self.target_date = upload.date

        # Determine which pipeline to use
        self.use_vision = use_vision if use_vision is not None else USE_VISION_PIPELINE
        self.vision_provider = vision_provider or VISION_PROVIDER

        # Initialize pipeline components based on mode
        if self.use_vision:
            if self.vision_provider == 'google':
                logger.info(f"Initializing Google Vision extractor for upload {upload.id}")
                self.vision_extractor = GoogleVisionExtractor(self.school, self.class_obj, self.target_date)
            else:
                logger.info(f"Initializing Groq Vision extractor for upload {upload.id}")
                self.vision_extractor = VisionExtractor(self.school, self.class_obj, self.target_date)
        else:
            self.ocr_service = OCRService()
            self.table_extractor = TableExtractor(self.school, self.target_date)
            self.llm_reasoner = LLMReasoner(self.school, self.class_obj, self.target_date)

    def process(self) -> ProcessingResult:
        """
        Run the complete processing pipeline.

        Supports both single-image (legacy) and multi-image uploads.
        For multi-image, processes each page separately and merges results.

        Returns:
            ProcessingResult with all stage outputs
        """
        # Use vision pipeline if enabled
        if self.use_vision:
            provider_name = "Google Vision" if self.vision_provider == 'google' else "Groq Vision"
            logger.info(f"[Pipeline] Using {provider_name} pipeline for upload {self.upload.id}")
            return self._process_with_vision()

        # Legacy OCR pipeline
        logger.info(f"[Pipeline] Using legacy Tesseract OCR pipeline for upload {self.upload.id}")

        # Check if we have multiple images
        multi_page_images = list(self.upload.images.all().order_by('page_number'))

        if multi_page_images:
            return self._process_multi_page(multi_page_images)
        else:
            return self._process_single_image()

    def _process_with_vision(self) -> ProcessingResult:
        """
        Process using Vision AI pipeline (recommended for handwritten registers).

        This sends images directly to a vision-capable AI model which can
        understand handwritten text much better than OCR.
        """
        result = ProcessingResult(success=False)
        provider_name = 'google_vision' if self.vision_provider == 'google' else 'groq_vision'
        result.pipeline_stages = {
            provider_name: {'status': 'pending', 'provider': self.vision_provider}
        }
        stage_key = provider_name

        # Gather all image URLs
        image_urls = []
        multi_page_images = list(self.upload.images.all().order_by('page_number'))

        if multi_page_images:
            image_urls = [img.image_url for img in multi_page_images]
        elif self.upload.image_url:
            image_urls = [self.upload.image_url]

        if not image_urls:
            result.error = "No images to process"
            result.error_stage = stage_key
            result.pipeline_stages[stage_key]['status'] = 'failed'
            return result

        # Run vision extraction
        result.pipeline_stages[stage_key]['status'] = 'running'
        result.pipeline_stages[stage_key]['pages'] = len(image_urls)

        try:
            if len(image_urls) == 1:
                vision_result = self.vision_extractor.extract_from_image(image_urls[0])
            else:
                vision_result = self.vision_extractor.extract_multi_page(image_urls)
        except Exception as e:
            logger.error(f"Vision extraction failed ({self.vision_provider}): {e}")
            result.error = str(e)
            result.error_stage = stage_key
            result.pipeline_stages[stage_key]['status'] = 'failed'
            result.pipeline_stages[stage_key]['error'] = str(e)
            return result

        if not vision_result.success:
            result.error = vision_result.error
            result.error_stage = stage_key
            result.pipeline_stages[stage_key]['status'] = 'failed'
            result.pipeline_stages[stage_key]['error'] = vision_result.error
            return result

        # Store results
        result.pipeline_stages[stage_key]['status'] = 'completed'
        result.pipeline_stages[stage_key]['students_found'] = len(vision_result.students)
        result.pipeline_stages[stage_key]['date_columns'] = vision_result.date_columns

        # Save structured table (for debug comparison view)
        self.upload.structured_table_json = self.vision_extractor.to_structured_table_json(vision_result)
        self.upload.save(update_fields=['structured_table_json'])

        # Update multi-page image statuses
        for img in multi_page_images:
            img.processing_status = 'COMPLETED'
            img.save(update_fields=['processing_status'])

        # Convert to ai_output_json format
        ai_output = self.vision_extractor.to_ai_output_json(vision_result)

        # Populate result
        result.matched = ai_output['matched']
        result.unmatched = ai_output['unmatched']
        result.matched_count = ai_output['matched_count']
        result.unmatched_count = ai_output['unmatched_count']
        result.uncertain = ai_output.get('uncertain', [])
        result.corrections = ai_output.get('corrections', [])
        result.confidence = ai_output.get('confidence', 0.0)
        result.notes = ai_output.get('notes', '')
        result.pipeline_stages = ai_output.get('pipeline_stages', result.pipeline_stages)
        result.success = True

        provider_display = "Google Vision" if self.vision_provider == 'google' else "Groq Vision"
        logger.info(
            f"[{provider_display}] Complete: {result.matched_count} matched absent, "
            f"{result.unmatched_count} unmatched, {len(result.uncertain)} uncertain"
        )

        return result

    def _process_single_image(self) -> ProcessingResult:
        """Process a single-image upload (legacy mode)."""
        result = ProcessingResult(success=False)
        result.pipeline_stages = {
            'ocr': {'status': 'pending'},
            'table_extraction': {'status': 'pending'},
            'llm_reasoning': {'status': 'pending'}
        }

        if not self.upload.image_url:
            result.error = "No image URL provided"
            result.error_stage = 'ocr'
            return result

        # Stage 1: OCR
        logger.info(f"[Pipeline] Stage 1: OCR for upload {self.upload.id}")
        result.pipeline_stages['ocr']['status'] = 'running'

        ocr_result = self.ocr_service.process_image(self.upload.image_url)
        result.ocr_result = ocr_result

        if not ocr_result.success:
            result.error = ocr_result.error
            result.error_stage = 'ocr'
            result.pipeline_stages['ocr']['status'] = 'failed'
            result.pipeline_stages['ocr']['error'] = ocr_result.error
            return result

        result.pipeline_stages['ocr']['status'] = 'completed'
        result.pipeline_stages['ocr']['cells_found'] = len(ocr_result.cells)
        result.pipeline_stages['ocr']['avg_confidence'] = ocr_result.avg_confidence

        # Store raw OCR text
        self.upload.ocr_raw_text = ocr_result.raw_text
        self.upload.save(update_fields=['ocr_raw_text'])

        # Stage 2: Table Extraction
        logger.info(f"[Pipeline] Stage 2: Table Extraction")
        result.pipeline_stages['table_extraction']['status'] = 'running'

        structured_table = self.table_extractor.extract_table(ocr_result)
        result.structured_table = structured_table

        if not structured_table.students:
            result.error = "No students found in table"
            result.error_stage = 'table_extraction'
            result.pipeline_stages['table_extraction']['status'] = 'failed'
            result.pipeline_stages['table_extraction']['error'] = "No students extracted"
        else:
            result.pipeline_stages['table_extraction']['status'] = 'completed'

        result.pipeline_stages['table_extraction']['students_found'] = len(structured_table.students)
        result.pipeline_stages['table_extraction']['date_columns'] = list(structured_table.date_columns.values())
        result.pipeline_stages['table_extraction']['warnings'] = structured_table.warnings

        # Store structured table in upload
        self.upload.structured_table_json = self.table_extractor.to_json(structured_table)
        self.upload.save(update_fields=['structured_table_json'])

        # Stage 3: LLM Reasoning
        return self._run_llm_reasoning(result, structured_table)

    def _process_multi_page(self, images) -> ProcessingResult:
        """
        Process multiple images and merge results.

        Args:
            images: List of AttendanceUploadImage instances

        Returns:
            ProcessingResult with merged data from all pages
        """
        from .table_extractor import StudentRow, StructuredTable

        result = ProcessingResult(success=False)
        result.pipeline_stages = {
            'ocr': {'status': 'pending', 'pages': []},
            'table_extraction': {'status': 'pending', 'pages': []},
            'llm_reasoning': {'status': 'pending'}
        }

        logger.info(f"[Pipeline] Processing {len(images)} pages for upload {self.upload.id}")

        all_students = []
        all_raw_text = []
        all_date_columns = {}
        total_cells = 0
        total_confidence = 0
        pages_processed = 0

        for img in images:
            page_num = img.page_number
            logger.info(f"[Pipeline] Processing page {page_num}")

            # Update image status
            img.processing_status = 'PROCESSING'
            img.save(update_fields=['processing_status'])

            # Stage 1: OCR for this page
            ocr_result = self.ocr_service.process_image(img.image_url)

            page_ocr_status = {
                'page': page_num,
                'status': 'completed' if ocr_result.success else 'failed',
                'cells_found': len(ocr_result.cells) if ocr_result.success else 0,
                'confidence': ocr_result.avg_confidence if ocr_result.success else 0
            }
            result.pipeline_stages['ocr']['pages'].append(page_ocr_status)

            if not ocr_result.success:
                img.processing_status = 'FAILED'
                img.error_message = ocr_result.error
                img.save(update_fields=['processing_status', 'error_message'])
                continue

            # Store OCR text for this page
            img.ocr_raw_text = ocr_result.raw_text
            all_raw_text.append(f"=== Page {page_num} ===\n{ocr_result.raw_text}")

            total_cells += len(ocr_result.cells)
            total_confidence += ocr_result.avg_confidence

            # Stage 2: Table extraction for this page
            structured_table = self.table_extractor.extract_table(ocr_result)

            page_table_status = {
                'page': page_num,
                'status': 'completed' if structured_table.students else 'failed',
                'students_found': len(structured_table.students)
            }
            result.pipeline_stages['table_extraction']['pages'].append(page_table_status)

            # Store structured table for this page
            img.structured_table_json = self.table_extractor.to_json(structured_table)
            img.processing_status = 'COMPLETED'
            img.save(update_fields=['ocr_raw_text', 'structured_table_json', 'processing_status'])

            # Collect students with page info
            for student in structured_table.students:
                # Add page number to student data for tracking
                student_with_page = StudentRow(
                    row_index=student.row_index,
                    roll_number=student.roll_number,
                    name=student.name,
                    attendance_marks=student.attendance_marks,
                    page_number=page_num
                )
                all_students.append((page_num, student_with_page))

            # Merge date columns
            for col_idx, day in structured_table.date_columns.items():
                if day not in all_date_columns.values():
                    all_date_columns[col_idx] = day

            pages_processed += 1

        if pages_processed == 0:
            result.error = "All pages failed to process"
            result.error_stage = 'ocr'
            result.pipeline_stages['ocr']['status'] = 'failed'
            return result

        result.pipeline_stages['ocr']['status'] = 'completed'
        result.pipeline_stages['ocr']['total_cells'] = total_cells
        result.pipeline_stages['ocr']['avg_confidence'] = total_confidence / pages_processed

        # Merge students - dedupe by roll number
        merged_students = self._merge_students(all_students)

        result.pipeline_stages['table_extraction']['status'] = 'completed'
        result.pipeline_stages['table_extraction']['total_students'] = len(merged_students)
        result.pipeline_stages['table_extraction']['pages_processed'] = pages_processed

        # Store combined raw text
        self.upload.ocr_raw_text = "\n\n".join(all_raw_text)
        self.upload.save(update_fields=['ocr_raw_text'])

        # Create merged structured table
        merged_table = StructuredTable(
            students=merged_students,
            date_columns=all_date_columns,
            extraction_confidence=total_confidence / pages_processed if pages_processed else 0,
            warnings=[f"Merged from {len(images)} pages"]
        )
        result.structured_table = merged_table

        # Store merged table
        self.upload.structured_table_json = self.table_extractor.to_json(merged_table)
        self.upload.save(update_fields=['structured_table_json'])

        # Stage 3: LLM Reasoning on merged data
        return self._run_llm_reasoning(result, merged_table)

    def _merge_students(self, students_with_pages):
        """
        Merge students from multiple pages, deduplicating by roll number.

        Args:
            students_with_pages: List of (page_number, StudentRow) tuples

        Returns:
            List of unique StudentRow objects
        """
        from .table_extractor import StudentRow

        seen_rolls = {}  # roll_number -> (page, StudentRow)

        for page_num, student in students_with_pages:
            roll = student.roll_number

            if roll and roll in seen_rolls:
                # Duplicate - keep the one with more attendance marks or higher confidence
                existing_page, existing = seen_rolls[roll]
                if len(student.attendance_marks) > len(existing.attendance_marks):
                    seen_rolls[roll] = (page_num, student)
                    logger.debug(f"Roll {roll}: keeping page {page_num} over page {existing_page}")
            elif roll:
                seen_rolls[roll] = (page_num, student)
            else:
                # No roll number - try to match by name or just add
                # For now, add all students without roll numbers
                key = f"no_roll_{page_num}_{student.row_index}"
                seen_rolls[key] = (page_num, student)

        # Return just the students (without page info)
        return [student for page, student in seen_rolls.values()]

    def _run_llm_reasoning(self, result: ProcessingResult, structured_table: StructuredTable) -> ProcessingResult:
        """Run LLM reasoning stage and complete the result."""
        logger.info(f"[Pipeline] Stage 3: LLM Reasoning")
        result.pipeline_stages['llm_reasoning']['status'] = 'running'

        reasoning_result = self.llm_reasoner.reason(structured_table)
        result.reasoning_result = reasoning_result

        if not reasoning_result.success:
            result.error = reasoning_result.error
            result.error_stage = 'llm_reasoning'
            result.pipeline_stages['llm_reasoning']['status'] = 'failed'
            result.pipeline_stages['llm_reasoning']['error'] = reasoning_result.error
        else:
            result.pipeline_stages['llm_reasoning']['status'] = 'completed'

        result.pipeline_stages['llm_reasoning']['absent_count'] = len(reasoning_result.absent_students)
        result.pipeline_stages['llm_reasoning']['uncertain_count'] = len(reasoning_result.uncertain_students)

        # Stage 4: Match to enrolled students
        logger.info(f"[Pipeline] Stage 4: Matching to enrolled students")
        matched_result = self.llm_reasoner.match_to_enrolled_students(reasoning_result)

        # Populate final result
        result.matched = matched_result['matched']
        result.unmatched = matched_result['unmatched']
        result.matched_count = matched_result['matched_count']
        result.unmatched_count = matched_result['unmatched_count']
        result.uncertain = matched_result.get('uncertain', [])
        result.corrections = matched_result.get('corrections', [])
        result.confidence = matched_result.get('confidence', 0.0)
        result.notes = matched_result.get('notes', '')
        result.success = True

        logger.info(
            f"[Pipeline] Complete: {result.matched_count} matched, "
            f"{result.unmatched_count} unmatched, {len(result.uncertain)} uncertain"
        )

        return result


def process_upload(upload_id: int) -> Dict[str, Any]:
    """
    Process an attendance upload through the full pipeline.

    This is the main entry point for Celery tasks.

    Args:
        upload_id: ID of AttendanceUpload to process

    Returns:
        Dict with processing result
    """
    from .models import AttendanceUpload

    try:
        upload = AttendanceUpload.objects.get(id=upload_id)
    except AttendanceUpload.DoesNotExist:
        return {'success': False, 'error': f'Upload {upload_id} not found'}

    processor = AttendanceProcessor(upload)
    result = processor.process()

    # Update upload with results
    upload.ai_output_json = result.to_ai_output_json()
    upload.confidence_score = result.confidence

    if result.success:
        upload.status = 'REVIEW_REQUIRED'
    else:
        upload.status = 'FAILED'
        upload.error_message = f"[{result.error_stage}] {result.error}"

    upload.save()

    return result.to_ai_output_json()
