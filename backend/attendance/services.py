"""
AI and WhatsApp services for attendance processing.
"""

import base64
import logging
import requests
from io import BytesIO
from typing import Dict, List, Optional, Any
from django.conf import settings
from fuzzywuzzy import fuzz

logger = logging.getLogger(__name__)


class AttendanceAIService:
    """
    Service for AI-powered attendance extraction from register images.

    Uses Groq Vision API to directly analyze the image and extract absent students.
    """

    VISION_PROMPT = """You are analyzing a school attendance register image.

IMPORTANT: This is a MONTHLY attendance register with a grid format:
- ROWS = Students (with names and roll numbers on the left side)
- COLUMNS = Days of the month (numbered 1, 2, 3, ... up to 31 at the top)
- Each cell contains attendance mark for that student on that day

YOUR TASK:
1. Find the column for day {day_of_month} (the date column numbered "{day_of_month}" at the top)
2. Look at ONLY that specific column
3. For each student row, check their attendance mark in column {day_of_month}
4. Identify students marked as ABSENT in that column

ATTENDANCE MARKS:
- PRESENT: 'P', '✓', '/', 'p', or any checkmark = Student is PRESENT (do NOT include)
- ABSENT: 'A', 'X', '✗', 'a', blank/empty, or '-' = Student is ABSENT (include these)

The class being checked is: {class_name}
The full date is: {date}
CHECK ONLY COLUMN: {day_of_month}

Students enrolled in this class (use for name matching):
{student_list}

Output ONLY valid JSON:
{{
  "absent_students": [
    {{"roll": 3, "name": "Ali Hassan"}},
    {{"roll": 7, "name": "Sara Ahmed"}}
  ],
  "confidence": 0.85,
  "date_column_found": {day_of_month},
  "notes": "Found column {day_of_month}, checked attendance marks"
}}

If column {day_of_month} is not visible or image is unclear:
{{
  "absent_students": [],
  "confidence": 0.0,
  "date_column_found": null,
  "notes": "Could not find column {day_of_month} in the register"
}}"""

    def __init__(self, upload):
        """Initialize with an AttendanceUpload instance."""
        self.upload = upload
        self.school = upload.school
        self.class_obj = upload.class_obj
        self.settings = settings.ATTENDANCE_AI_SETTINGS

    def fetch_image_as_base64(self) -> tuple[Optional[str], Optional[str]]:
        """
        Fetch image from URL and convert to base64.

        Returns:
            tuple: (base64_string, error_message)
        """
        try:
            logger.info(f"Fetching image from: {self.upload.image_url}")

            response = requests.get(self.upload.image_url, timeout=30)
            response.raise_for_status()

            # Get content type
            content_type = response.headers.get('content-type', 'image/jpeg')

            # Convert to base64
            image_base64 = base64.b64encode(response.content).decode('utf-8')

            logger.info(f"Image fetched successfully, size: {len(response.content)} bytes")
            return image_base64, None

        except requests.RequestException as e:
            logger.error(f"Failed to fetch image: {e}")
            return None, f"Could not fetch image: {str(e)}"

    def get_student_list(self) -> str:
        """Get formatted list of students in the class."""
        from students.models import Student

        students = Student.objects.filter(
            school=self.school,
            class_obj=self.class_obj,
            is_active=True
        ).order_by('roll_number')

        lines = []
        for s in students:
            lines.append(f"Roll {s.roll_number}: {s.name}")

        return "\n".join(lines) if lines else "No students enrolled"

    def analyze_with_vision(self, image_base64: str) -> Dict[str, Any]:
        """
        Use Groq Vision to analyze the attendance register image.

        Args:
            image_base64: Base64 encoded image

        Returns:
            dict: Parsed attendance data
        """
        import json
        from groq import Groq

        if not settings.GROQ_API_KEY:
            raise Exception("GROQ_API_KEY not configured")

        client = Groq(api_key=settings.GROQ_API_KEY)

        # Build prompt with class context
        # Extract day of month from the date for column lookup
        day_of_month = self.upload.date.day

        prompt = self.VISION_PROMPT.format(
            class_name=self.class_obj.name,
            date=self.upload.date,
            day_of_month=day_of_month,
            student_list=self.get_student_list()
        )

        try:
            # Use vision model with image
            response = client.chat.completions.create(
                model="meta-llama/llama-4-scout-17b-16e-instruct",  # Groq's Llama 4 vision model
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": prompt
                            },
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{image_base64}"
                                }
                            }
                        ]
                    }
                ],
                temperature=0.1,
                max_tokens=1000,
            )

            result_text = response.choices[0].message.content
            logger.info(f"Vision API response: {result_text[:500]}...")

            # Try to parse JSON from response
            # Sometimes the model wraps JSON in markdown code blocks
            if "```json" in result_text:
                result_text = result_text.split("```json")[1].split("```")[0]
            elif "```" in result_text:
                result_text = result_text.split("```")[1].split("```")[0]

            result = json.loads(result_text.strip())

            # Ensure required fields exist
            result.setdefault('absent_students', [])
            result.setdefault('confidence', 0.0)
            result.setdefault('notes', '')

            return result

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Vision API response as JSON: {e}")
            logger.error(f"Raw response: {result_text}")
            return {
                'absent_students': [],
                'confidence': 0.0,
                'notes': f'Failed to parse AI response: {str(e)}'
            }
        except Exception as e:
            logger.error(f"Vision API call failed: {e}")
            raise Exception(f"Vision API failed: {str(e)}")

    def match_students(self, ai_result: Dict[str, Any]) -> Dict[str, Any]:
        """
        Match AI-detected students to database records.

        Matching strategy:
        1. Exact roll number match within class
        2. Fuzzy name match as fallback

        Args:
            ai_result: Output from Vision API

        Returns:
            dict: Matched and unmatched students
        """
        from students.models import Student

        absent_students = ai_result.get('absent_students', [])
        matched = []
        unmatched = []

        # Get all students in the class
        class_students = Student.objects.filter(
            school=self.school,
            class_obj=self.class_obj,
            is_active=True
        )

        for entry in absent_students:
            roll = entry.get('roll')
            name = entry.get('name', '')

            student = None
            match_type = None

            # Try exact roll number match
            if roll is not None:
                student = class_students.filter(
                    roll_number__iexact=str(roll)
                ).first()
                if student:
                    match_type = 'roll_exact'

            # Fallback: fuzzy name matching
            if not student and name:
                best_match = None
                best_score = 0
                threshold = self.settings.get('FUZZY_MATCH_THRESHOLD', 70)

                for candidate in class_students:
                    score = fuzz.ratio(name.lower(), candidate.name.lower())
                    if score > best_score and score >= threshold:
                        best_score = score
                        best_match = candidate

                if best_match:
                    student = best_match
                    match_type = f'name_fuzzy_{best_score}'

            if student:
                matched.append({
                    'student_id': student.id,
                    'student_name': student.name,
                    'student_roll': student.roll_number,
                    'detected_name': name,
                    'detected_roll': roll,
                    'match_type': match_type,
                    'confidence': 'high' if match_type == 'roll_exact' else 'medium'
                })
            else:
                unmatched.append({
                    'detected_name': name,
                    'detected_roll': roll,
                    'reason': 'No matching student found'
                })

        return {
            'matched': matched,
            'unmatched': unmatched,
            'matched_count': len(matched),
            'unmatched_count': len(unmatched),
            'confidence': ai_result.get('confidence', 0),
            'notes': ai_result.get('notes', '')
        }

    def process(self) -> Dict[str, Any]:
        """
        Run the full processing pipeline using Vision API.

        Returns:
            dict: Processing result with matched/unmatched students
        """
        # Step 1: Fetch image as base64
        image_base64, error = self.fetch_image_as_base64()
        if error:
            return {
                'success': False,
                'error': error,
                'step': 'image_fetch'
            }

        # Step 2: Analyze with Vision API
        try:
            ai_result = self.analyze_with_vision(image_base64)
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'step': 'vision_api'
            }

        # Step 3: Match students
        matched_result = self.match_students(ai_result)
        matched_result['success'] = True

        return matched_result


class WhatsAppService:
    """
    Service for sending WhatsApp notifications to parents.
    """

    MESSAGE_TEMPLATE = """Dear Parent,

Your child {student_name} (Class {class_name}) was marked absent on {date}.

If this is incorrect or there was a valid reason, please contact the school.

Regards,
{school_name}"""

    def __init__(self, school):
        """Initialize with a School instance."""
        self.school = school
        self.api_url = settings.WHATSAPP_API_URL
        self.api_key = settings.WHATSAPP_API_KEY
        self.sender_id = school.whatsapp_sender_id

    def is_configured(self) -> bool:
        """Check if WhatsApp is properly configured for this school."""
        return bool(
            self.api_url and
            self.api_key and
            self.sender_id and
            self.school.get_enabled_module('whatsapp')
        )

    def send_absence_notification(
        self,
        phone: str,
        student_name: str,
        class_name: str,
        date
    ) -> bool:
        """
        Send absence notification via WhatsApp API.

        Args:
            phone: Parent's phone number
            student_name: Student's name
            class_name: Class name
            date: Absence date

        Returns:
            bool: True if sent successfully
        """
        if not self.is_configured():
            logger.warning(f"WhatsApp not configured for school {self.school.name}")
            return False

        message = self.MESSAGE_TEMPLATE.format(
            student_name=student_name,
            class_name=class_name,
            date=date.strftime('%d %B %Y') if hasattr(date, 'strftime') else str(date),
            school_name=self.school.name
        )

        try:
            response = requests.post(
                self.api_url,
                json={
                    'sender_id': self.sender_id,
                    'phone': phone,
                    'message': message
                },
                headers={
                    'Authorization': f'Bearer {self.api_key}',
                    'Content-Type': 'application/json'
                },
                timeout=30
            )

            if response.status_code == 200:
                logger.info(f"WhatsApp notification sent to {phone}")
                return True
            else:
                logger.error(f"WhatsApp API error: {response.status_code} - {response.text}")
                return False

        except Exception as e:
            logger.error(f"WhatsApp notification failed: {e}")
            return False

    def send_bulk_notifications(
        self,
        absent_records: List[Any]
    ) -> Dict[str, int]:
        """
        Send notifications to multiple parents.

        Args:
            absent_records: List of AttendanceRecord objects

        Returns:
            dict: Count of sent and failed notifications
        """
        from django.utils import timezone

        sent = 0
        failed = 0

        for record in absent_records:
            if record.student.parent_phone:
                success = self.send_absence_notification(
                    phone=record.student.parent_phone,
                    student_name=record.student.name,
                    class_name=record.student.class_obj.name,
                    date=record.date
                )
                if success:
                    sent += 1
                    # Mark notification as sent
                    record.notification_sent = True
                    record.notification_sent_at = timezone.now()
                    record.save(update_fields=['notification_sent', 'notification_sent_at'])
                else:
                    failed += 1
            else:
                failed += 1
                logger.warning(f"No parent phone for student {record.student.name}")

        return {'sent': sent, 'failed': failed}
