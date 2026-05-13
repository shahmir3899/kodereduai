"""
Vision-based Attendance Extractor using LLM Vision APIs.

Replaces the OCR + Table Extraction pipeline with direct image understanding.
This approach works much better for handwritten attendance registers.

Supported backends:
- Groq (Llama 3.2 Vision)
- OpenAI (GPT-4 Vision) - future
- Google (Gemini Vision) - future
"""

import json
import logging
import base64
import requests
from io import BytesIO
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
from datetime import date

from django.conf import settings

logger = logging.getLogger(__name__)


@dataclass
class VisionExtractionResult:
    """Result from vision-based extraction."""
    success: bool
    students: List[Dict[str, Any]]  # List of {roll, name, status, mark}
    date_columns: List[int]  # Days found in header
    raw_response: str
    confidence: float
    error: Optional[str] = None
    warnings: List[str] = None

    def __post_init__(self):
        if self.warnings is None:
            self.warnings = []


class VisionExtractor:
    """
    Extracts attendance data directly from register images using Vision AI.

    Instead of OCR → Table → LLM, this sends the image directly to a vision model
    and asks it to extract structured data. Much better for handwritten registers.
    """

    EXTRACTION_PROMPT = """You are analyzing a handwritten school attendance register image.

## Context
School: {school_name}
Class: {class_name}
Target Date: {date} (Day {day} of the month)

## Enrolled Students (for reference)
{student_list}

## Mark Mappings (how this school marks attendance)
{mark_mappings}

## Your Task
1. Look at the attendance register image
2. Find the column for day {day}
3. For EACH row, extract:
   - Roll number (usually leftmost column, numbers like 1, 2, 3...)
   - Student name (the name written in that row)
   - Attendance mark for day {day} (P, A, /, -, etc.)
4. Determine if each student is PRESENT or ABSENT based on the mark

## IMPORTANT
- Focus on the specific day column ({day})
- Match the extracted names to the enrolled students list when possible
- If you can't read a name clearly, write what you can see
- Be thorough - extract ALL rows, not just a sample

## Output Format (JSON only, no other text)
{{
  "date_columns_found": [1, 2, 3, ...],  // All date columns visible in header
  "target_column_found": true/false,
  "students": [
    {{
      "row": 1,
      "roll_number": "1",
      "name_extracted": "Ahmad Khan",
      "matched_to": "Ahmed Khan",
      "matched_roll": "1",
      "mark_raw": "P",
      "status": "PRESENT",
      "confidence": "high"
    }},
    {{
      "row": 2,
      "roll_number": "2",
      "name_extracted": "Sara Bii",
      "matched_to": "Sara Bibi",
      "matched_roll": "2",
      "mark_raw": "A",
      "status": "ABSENT",
      "confidence": "high"
    }}
  ],
  "total_rows_found": 30,
  "notes": "Any observations about image quality, unclear entries, etc."
}}

Remember: Output ONLY the JSON, no markdown code blocks or other text."""

    def __init__(self, school, class_obj, target_date: date):
        """Initialize with context."""
        self.school = school
        self.class_obj = class_obj
        self.target_date = target_date

    def get_student_list(self) -> str:
        """Get formatted list of enrolled students."""
        from students.models import Student

        students = Student.objects.filter(
            school=self.school,
            class_obj=self.class_obj,
            is_active=True
        ).order_by('roll_number')

        lines = [f"Roll {s.roll_number}: {s.name}" for s in students]
        return "\n".join(lines) if lines else "No students enrolled"

    def format_mark_mappings(self) -> str:
        """Format mark mappings for the prompt."""
        mappings = self.school.mark_mappings
        lines = []
        for status, symbols in mappings.items():
            if status == "default":
                lines.append(f"- Blank/Unknown → {symbols}")
            elif isinstance(symbols, list):
                lines.append(f"- {', '.join(str(s) for s in symbols)} → {status}")
        return "\n".join(lines) if lines else "P = Present, A = Absent"

    def fetch_image_as_base64(self, image_url: str) -> Tuple[Optional[str], Optional[str]]:
        """Fetch image and convert to base64."""
        try:
            logger.info(f"Fetching image: {image_url}")
            response = requests.get(image_url, timeout=30)
            response.raise_for_status()

            # Determine content type
            content_type = response.headers.get('content-type', 'image/jpeg')
            if 'png' in content_type:
                media_type = 'image/png'
            elif 'gif' in content_type:
                media_type = 'image/gif'
            elif 'webp' in content_type:
                media_type = 'image/webp'
            else:
                media_type = 'image/jpeg'

            # Convert to base64
            base64_data = base64.standard_b64encode(response.content).decode('utf-8')
            return f"data:{media_type};base64,{base64_data}", None

        except Exception as e:
            logger.error(f"Failed to fetch image: {e}")
            return None, str(e)

    def extract_from_image(self, image_url: str) -> VisionExtractionResult:
        """
        Extract attendance data from a single image using vision AI.

        Args:
            image_url: URL of the attendance register image

        Returns:
            VisionExtractionResult with extracted student data
        """
        # Fetch and encode image
        image_data, error = self.fetch_image_as_base64(image_url)
        if error:
            return VisionExtractionResult(
                success=False,
                students=[],
                date_columns=[],
                raw_response="",
                confidence=0.0,
                error=f"Failed to fetch image: {error}"
            )

        # Build prompt
        prompt = self.EXTRACTION_PROMPT.format(
            school_name=self.school.name,
            class_name=self.class_obj.name,
            date=self.target_date,
            day=self.target_date.day,
            student_list=self.get_student_list(),
            mark_mappings=self.format_mark_mappings()
        )

        # Call vision API
        try:
            result = self._call_groq_vision(image_data, prompt)
            return result
        except Exception as e:
            logger.error(f"Vision extraction failed: {e}")
            return VisionExtractionResult(
                success=False,
                students=[],
                date_columns=[],
                raw_response="",
                confidence=0.0,
                error=str(e)
            )

    def _call_groq_vision(self, image_data: str, prompt: str) -> VisionExtractionResult:
        """Call Groq's vision API."""
        try:
            from groq import Groq
        except ImportError as e:
            logger.error(f"Groq library not installed: {e}")
            return VisionExtractionResult(
                success=False,
                students=[],
                date_columns=[],
                raw_response="",
                confidence=0.0,
                error="Groq library not installed. Run: pip install groq"
            )

        if not settings.GROQ_API_KEY:
            logger.error("GROQ_API_KEY not configured in settings")
            return VisionExtractionResult(
                success=False,
                students=[],
                date_columns=[],
                raw_response="",
                confidence=0.0,
                error="GROQ_API_KEY not configured"
            )

        try:
            client = Groq(api_key=settings.GROQ_API_KEY)

            # Get model from settings or use default
            # Groq vision models: llama-3.2-11b-vision-preview (as of 2024)
            # Check https://console.groq.com/docs/models for current models
            vision_model = getattr(settings, 'GROQ_VISION_MODEL', 'llama-3.2-11b-vision-preview')

            # Fallback models to try if the default fails
            fallback_models = ['meta-llama/llama-4-scout-17b-16e-instruct', 'llava-v1.5-7b-4096-preview']
            logger.info(f"Calling Groq Vision API with model: {vision_model}")
            logger.info(f"Image data size: {len(image_data)} chars")

            response = client.chat.completions.create(
                model=vision_model,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": image_data
                                }
                            },
                            {
                                "type": "text",
                                "text": prompt
                            }
                        ]
                    }
                ],
                temperature=0.1,
                max_tokens=4000,
            )

            raw_response = response.choices[0].message.content
            logger.info(f"Groq Vision response length: {len(raw_response)}")
            logger.info(f"Groq Vision response preview: {raw_response[:500]}...")

            # Parse JSON response
            return self._parse_response(raw_response)

        except Exception as e:
            error_msg = str(e)
            logger.error(f"Groq Vision API call failed: {error_msg}")

            # Check for common errors
            if "model" in error_msg.lower() and "not found" in error_msg.lower():
                error_msg = f"Vision model not available. Try setting GROQ_VISION_MODEL=llama-3.2-11b-vision-preview in .env"
            elif "rate" in error_msg.lower() and "limit" in error_msg.lower():
                error_msg = "Groq API rate limit exceeded. Please try again later."
            elif "invalid" in error_msg.lower() and "api" in error_msg.lower():
                error_msg = "Invalid Groq API key. Please check your GROQ_API_KEY in .env"

            return VisionExtractionResult(
                success=False,
                students=[],
                date_columns=[],
                raw_response="",
                confidence=0.0,
                error=error_msg
            )

    def _parse_response(self, raw_response: str) -> VisionExtractionResult:
        """Parse the JSON response from vision model."""
        try:
            # Try to extract JSON from response
            text = raw_response.strip()

            # Remove markdown code blocks if present
            if "```json" in text:
                text = text.split("```json")[1].split("```")[0]
            elif "```" in text:
                text = text.split("```")[1].split("```")[0]

            data = json.loads(text.strip())

            students = data.get('students', [])
            date_columns = data.get('date_columns_found', [])
            notes = data.get('notes', '')

            # Calculate confidence based on match quality
            high_conf_count = sum(1 for s in students if s.get('confidence') == 'high')
            confidence = high_conf_count / len(students) if students else 0.0

            warnings = []
            if not data.get('target_column_found', True):
                warnings.append(f"Target date column ({self.target_date.day}) not clearly visible")

            return VisionExtractionResult(
                success=True,
                students=students,
                date_columns=date_columns,
                raw_response=raw_response,
                confidence=confidence,
                warnings=warnings
            )

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse vision response: {e}")
            logger.error(f"Raw response: {raw_response[:500]}...")
            return VisionExtractionResult(
                success=False,
                students=[],
                date_columns=[],
                raw_response=raw_response,
                confidence=0.0,
                error=f"Failed to parse response: {e}"
            )

    def extract_multi_page(self, image_urls: List[str]) -> VisionExtractionResult:
        """
        Extract attendance from multiple page images.

        Args:
            image_urls: List of image URLs in page order

        Returns:
            Merged VisionExtractionResult
        """
        all_students = []
        all_date_columns = set()
        all_warnings = []
        total_confidence = 0

        for idx, url in enumerate(image_urls, start=1):
            logger.info(f"Processing page {idx}/{len(image_urls)}")

            result = self.extract_from_image(url)

            if not result.success:
                all_warnings.append(f"Page {idx} failed: {result.error}")
                continue

            # Add page number to each student
            for student in result.students:
                student['page'] = idx
                all_students.append(student)

            all_date_columns.update(result.date_columns)
            all_warnings.extend(result.warnings)
            total_confidence += result.confidence

        if not all_students:
            return VisionExtractionResult(
                success=False,
                students=[],
                date_columns=[],
                raw_response="",
                confidence=0.0,
                error="No students extracted from any page",
                warnings=all_warnings
            )

        # Deduplicate students by roll number (keep first occurrence)
        seen_rolls = {}
        unique_students = []
        for student in all_students:
            roll = student.get('roll_number') or student.get('matched_roll')
            if roll and roll not in seen_rolls:
                seen_rolls[roll] = student
                unique_students.append(student)
            elif not roll:
                unique_students.append(student)

        avg_confidence = total_confidence / len(image_urls) if image_urls else 0

        return VisionExtractionResult(
            success=True,
            students=unique_students,
            date_columns=sorted(all_date_columns),
            raw_response=f"Merged from {len(image_urls)} pages",
            confidence=avg_confidence,
            warnings=all_warnings
        )

    def to_structured_table_json(self, result: VisionExtractionResult) -> Dict[str, Any]:
        """
        Convert VisionExtractionResult to structured_table_json format
        for compatibility with existing frontend.
        """
        students_data = []
        for student in result.students:
            # Build attendance dict
            day = self.target_date.day
            status = student.get('status', 'UNKNOWN')
            raw_mark = student.get('mark_raw', '')
            confidence = 0.9 if student.get('confidence') == 'high' else 0.6

            students_data.append({
                'row_index': student.get('row', 0),
                'roll_number': student.get('roll_number') or student.get('matched_roll'),
                'name': student.get('matched_to') or student.get('name_extracted'),
                'page_number': student.get('page'),
                'attendance': {
                    str(day): {
                        'raw': raw_mark,
                        'status': status,
                        'confidence': confidence
                    }
                }
            })

        return {
            'students': students_data,
            'date_columns': {str(i): d for i, d in enumerate(result.date_columns)},
            'header_row': [str(d) for d in result.date_columns],
            'extraction_confidence': result.confidence,
            'warnings': result.warnings,
            'extraction_method': 'vision_ai'
        }

    def to_ai_output_json(self, result: VisionExtractionResult) -> Dict[str, Any]:
        """
        Convert to ai_output_json format for compatibility.

        Categorizes students into:
        - matched: ABSENT students matched to DB (pre-selected on review page)
        - present: PRESENT students matched to DB
        - uncertain: students with unclear marks or low confidence
        - unmatched: students not found in DB
        """
        from students.models import Student

        # Get enrolled students for matching
        enrolled = {
            str(s.roll_number): s
            for s in Student.objects.filter(
                school=self.school,
                class_obj=self.class_obj,
                is_active=True
            )
        }

        matched = []       # Absent students (matched to DB)
        present = []       # Present students (matched to DB)
        unmatched = []
        uncertain = []

        for student in result.students:
            roll = student.get('roll_number') or student.get('matched_roll')
            status = student.get('status', 'UNKNOWN')

            db_student = enrolled.get(roll) if roll else None

            if db_student:
                entry = {
                    'student_id': db_student.id,
                    'student_name': db_student.name,
                    'student_roll': db_student.roll_number,
                    'detected_name': student.get('name_extracted'),
                    'detected_roll': roll,
                    'match_type': 'vision_ai',
                    'confidence': student.get('confidence', 'medium'),
                    'raw_mark': student.get('mark_raw', ''),
                    'ocr_confidence': 0.9 if student.get('confidence') == 'high' else 0.6,
                    'page': student.get('page')
                }

                # Add uncertain if low confidence
                if student.get('confidence') not in ('high', 'medium'):
                    uncertain.append({
                        'roll': roll,
                        'name': student.get('name_extracted'),
                        'reason': 'Low confidence extraction',
                        'page': student.get('page')
                    })
                elif status == 'ABSENT':
                    matched.append(entry)
                elif status in ('PRESENT', 'LATE'):
                    present.append(entry)
                else:
                    uncertain.append({
                        'roll': roll,
                        'name': student.get('name_extracted'),
                        'reason': f'Unclear status: {status}',
                        'page': student.get('page')
                    })
            else:
                unmatched.append({
                    'detected_name': student.get('name_extracted'),
                    'detected_roll': roll,
                    'reason': 'No matching enrolled student' if roll else 'Roll number not detected',
                    'page': student.get('page')
                })

        return {
            'matched': matched,
            'present': present,
            'unmatched': unmatched,
            'matched_count': len(matched),
            'present_count': len(present),
            'unmatched_count': len(unmatched),
            'uncertain': uncertain,
            'corrections': [],
            'confidence': result.confidence,
            'notes': '; '.join(result.warnings) if result.warnings else 'Extracted using Vision AI',
            'pipeline_stages': {
                'vision_extraction': {
                    'status': 'completed' if result.success else 'failed',
                    'students_found': len(result.students),
                    'date_columns': result.date_columns,
                    'method': 'groq_vision'
                }
            },
            'success': result.success
        }
