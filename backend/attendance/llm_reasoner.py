"""
LLM Reasoner for attendance data validation and correction.

Pipeline step 3: Structured Table → LLM Reasoning
The LLM receives structured data (not raw images) and validates/corrects the extraction.
"""

import json
import logging
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
from datetime import date

from django.conf import settings

from .table_extractor import StructuredTable, AttendanceCell

logger = logging.getLogger(__name__)


@dataclass
class ReasoningResult:
    """Result from LLM reasoning on structured table."""
    absent_students: List[Dict[str, Any]]
    present_students: List[Dict[str, Any]]
    uncertain_students: List[Dict[str, Any]]  # Low confidence, needs review
    corrections: List[Dict[str, Any]]  # LLM suggested corrections
    confidence: float
    reasoning_notes: str
    success: bool
    error: Optional[str] = None


class LLMReasoner:
    """
    Uses LLM to reason about structured attendance data.

    Instead of interpreting raw images, this service:
    1. Receives pre-extracted structured table data
    2. Validates the extraction
    3. Applies logical rules
    4. Identifies uncertain entries needing human review
    """

    REASONING_PROMPT = """You are analyzing pre-extracted attendance data from a school register.

## Context
School: {school_name}
Class: {class_name}
Date: {date}
Target day column: {target_day}

## Mark Mappings for this School
{mark_mappings}

## Extracted Table Data
The OCR system has already extracted the following structured data:

{table_data}

## Enrolled Students (for matching)
{student_list}

## Your Task
1. Review the extracted attendance data for the target day ({target_day})
2. Match extracted names/rolls to enrolled students
3. Identify students marked ABSENT
4. Flag any uncertain entries (low confidence or unclear marks)
5. Suggest corrections if OCR seems to have made errors

## Output Format (JSON only)
{{
  "absent_students": [
    {{"roll": "3", "name": "Ali Hassan", "confidence": "high", "raw_mark": "A"}}
  ],
  "present_students": [
    {{"roll": "1", "name": "Ahmed Khan", "confidence": "high", "raw_mark": "P"}}
  ],
  "uncertain": [
    {{"roll": "5", "name": "Sara", "reason": "OCR confidence low (45%)", "raw_mark": "?"}}
  ],
  "corrections": [
    {{"roll": "7", "original": "8", "corrected": "A", "reason": "8 looks like A in handwriting"}}
  ],
  "reasoning": "Brief explanation of your analysis",
  "overall_confidence": 0.85
}}"""

    def __init__(self, school, class_obj, target_date: date, threshold_service=None):
        """
        Initialize reasoner.

        Args:
            school: School model instance
            class_obj: Class model instance
            target_date: Date being processed
            threshold_service: ThresholdService for per-school threshold config
        """
        self.school = school
        self.class_obj = class_obj
        self.target_date = target_date

        if threshold_service is None:
            from .threshold_service import ThresholdService
            threshold_service = ThresholdService(school)
        self.threshold_service = threshold_service

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
                lines.append(f"- {', '.join(symbols)} → {status}")
        return "\n".join(lines)

    def format_table_data(self, table: StructuredTable) -> str:
        """Format structured table for the prompt."""
        target_day = self.target_date.day
        lines = []
        lines.append(f"Rows extracted: {len(table.students)}")
        lines.append(f"Date columns found: {list(table.date_columns.values())}")
        lines.append(f"\nAttendance for day {target_day}:")
        lines.append("-" * 50)

        for student in table.students:
            if target_day in student.attendance_marks:
                mark = student.attendance_marks[target_day]
                conf_pct = int(mark.confidence * 100)
                lines.append(
                    f"Roll: {student.roll_number or '?'}, "
                    f"Name: {student.name or '?'}, "
                    f"Mark: '{mark.raw_text}' → {mark.normalized_status}, "
                    f"OCR Conf: {conf_pct}%"
                )

        if table.warnings:
            lines.append(f"\nWarnings: {', '.join(table.warnings)}")

        return "\n".join(lines)

    def reason(self, table: StructuredTable) -> ReasoningResult:
        """
        Apply LLM reasoning to structured table data.

        Args:
            table: StructuredTable from TableExtractor

        Returns:
            ReasoningResult with categorized students
        """
        # For low-complexity cases, skip LLM and use rule-based logic
        if self._can_use_rules_only(table):
            return self._apply_rules(table)

        # Use LLM for complex/uncertain cases
        return self._apply_llm_reasoning(table)

    def _can_use_rules_only(self, table: StructuredTable) -> bool:
        """Check if we can skip LLM and use rule-based processing."""
        target_day = self.target_date.day

        # Use rules if all marks have high confidence
        rule_confidence = self.threshold_service.get('rule_confidence')
        for student in table.students:
            if target_day in student.attendance_marks:
                mark = student.attendance_marks[target_day]
                if mark.confidence < rule_confidence:
                    return False

        return True

    def _apply_rules(self, table: StructuredTable) -> ReasoningResult:
        """
        Apply rule-based reasoning without LLM.

        Used when OCR confidence is high.
        """
        target_day = self.target_date.day
        absent = []
        present = []
        uncertain = []

        from students.models import Student
        enrolled = {
            str(s.roll_number): s
            for s in Student.objects.filter(
                school=self.school,
                class_obj=self.class_obj,
                is_active=True
            )
        }

        for student in table.students:
            if target_day not in student.attendance_marks:
                continue

            mark = student.attendance_marks[target_day]

            # Match to enrolled student
            matched_student = None
            if student.roll_number and student.roll_number in enrolled:
                matched_student = enrolled[student.roll_number]

            high_conf = self.threshold_service.get('high_confidence')
            uncertain_thresh = self.threshold_service.get('uncertain_threshold')

            student_info = {
                'roll': student.roll_number,
                'name': matched_student.name if matched_student else student.name,
                'student_id': matched_student.id if matched_student else None,
                'raw_mark': mark.raw_text,
                'confidence': 'high' if mark.confidence >= high_conf else 'medium',
                'ocr_confidence': mark.confidence,
                'page': student.page_number
            }

            if mark.confidence < uncertain_thresh:
                student_info['reason'] = f"Low OCR confidence ({int(mark.confidence * 100)}%)"
                uncertain.append(student_info)
            elif mark.normalized_status == 'ABSENT':
                absent.append(student_info)
            elif mark.normalized_status in ('PRESENT', 'LATE'):
                present.append(student_info)
            else:
                uncertain.append(student_info)

        avg_conf = table.extraction_confidence

        return ReasoningResult(
            absent_students=absent,
            present_students=present,
            uncertain_students=uncertain,
            corrections=[],
            confidence=avg_conf,
            reasoning_notes="Rule-based processing (high OCR confidence)",
            success=True
        )

    def _apply_llm_reasoning(self, table: StructuredTable) -> ReasoningResult:
        """
        Use LLM for complex reasoning on uncertain data.
        """
        try:
            from groq import Groq

            if not settings.GROQ_API_KEY:
                logger.warning("GROQ_API_KEY not configured, falling back to rules")
                return self._apply_rules(table)

            client = Groq(api_key=settings.GROQ_API_KEY)

            prompt = self.REASONING_PROMPT.format(
                school_name=self.school.name,
                class_name=self.class_obj.name,
                date=self.target_date,
                target_day=self.target_date.day,
                mark_mappings=self.format_mark_mappings(),
                table_data=self.format_table_data(table),
                student_list=self.get_student_list()
            )

            response = client.chat.completions.create(
                model="llama-3.3-70b-versatile",  # Text-only model is fine now
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=2000,
            )

            result_text = response.choices[0].message.content

            # Parse JSON response
            if "```json" in result_text:
                result_text = result_text.split("```json")[1].split("```")[0]
            elif "```" in result_text:
                result_text = result_text.split("```")[1].split("```")[0]

            result = json.loads(result_text.strip())

            return ReasoningResult(
                absent_students=result.get('absent_students', []),
                present_students=result.get('present_students', []),
                uncertain_students=result.get('uncertain', []),
                corrections=result.get('corrections', []),
                confidence=result.get('overall_confidence', 0.0),
                reasoning_notes=result.get('reasoning', ''),
                success=True
            )

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse LLM response: {e}")
            return self._apply_rules(table)  # Fallback to rules
        except Exception as e:
            logger.error(f"LLM reasoning failed: {e}")
            return ReasoningResult(
                absent_students=[],
                present_students=[],
                uncertain_students=[],
                corrections=[],
                confidence=0.0,
                reasoning_notes="",
                success=False,
                error=str(e)
            )

    def match_to_enrolled_students(
        self,
        result: ReasoningResult
    ) -> Dict[str, Any]:
        """
        Match reasoning result students to enrolled database records.

        Returns format compatible with existing frontend.
        """
        from students.models import Student
        from fuzzywuzzy import fuzz

        enrolled = list(Student.objects.filter(
            school=self.school,
            class_obj=self.class_obj,
            is_active=True
        ))

        matched = []
        unmatched = []

        for entry in result.absent_students:
            roll = str(entry.get('roll', ''))
            name = entry.get('name', '')

            student = None
            match_type = None

            # Try roll number match
            for s in enrolled:
                if str(s.roll_number) == roll:
                    student = s
                    match_type = 'roll_exact'
                    break

            # Fallback to name match
            student_match_score = self.threshold_service.get('student_match_score')
            if not student and name:
                best_match = None
                best_score = 0
                for s in enrolled:
                    score = fuzz.ratio(name.lower(), s.name.lower())
                    if score > best_score and score >= student_match_score:
                        best_score = score
                        best_match = s

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
                    'confidence': entry.get('confidence', 'medium'),
                    'raw_mark': entry.get('raw_mark', ''),
                    'ocr_confidence': entry.get('ocr_confidence', 0),
                    'page': entry.get('page')
                })
            else:
                unmatched.append({
                    'detected_name': name,
                    'detected_roll': roll,
                    'reason': 'No matching enrolled student',
                    'page': entry.get('page')
                })

        return {
            'matched': matched,
            'unmatched': unmatched,
            'matched_count': len(matched),
            'unmatched_count': len(unmatched),
            'uncertain': result.uncertain_students,
            'corrections': result.corrections,
            'confidence': result.confidence,
            'notes': result.reasoning_notes,
            'success': result.success
        }
