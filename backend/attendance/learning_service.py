"""
Learning Service - Captures human corrections to improve AI accuracy.

Pipeline step 5: Human Review → Learning Loop
"""

import logging
from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta
from collections import defaultdict

from django.db import models
from django.db.models import Count, Avg, F, Q
from django.utils import timezone

logger = logging.getLogger(__name__)


class CorrectionType(models.TextChoices):
    """Types of corrections humans make."""
    FALSE_POSITIVE = 'false_positive', 'AI marked absent but human marked present'
    FALSE_NEGATIVE = 'false_negative', 'AI marked present but human marked absent'
    ROLL_MISMATCH = 'roll_mismatch', 'AI matched wrong student'
    MARK_MISREAD = 'mark_misread', 'OCR read mark incorrectly'
    NAME_MISMATCH = 'name_mismatch', 'AI matched wrong student by name'


class LearningService:
    """
    Service for learning from human corrections.

    Tracks:
    - AI predictions vs human confirmations
    - Common OCR errors per school
    - Mark interpretation accuracy
    - Matching accuracy (roll/name)

    Uses this data to:
    - Calculate accuracy metrics per school
    - Suggest mark mapping improvements
    - Identify problematic register formats
    """

    def __init__(self, school):
        """Initialize with a school."""
        self.school = school

    def record_corrections(
        self,
        upload,
        confirmed_absent_ids: List[int],
        name_corrections: Optional[List[Dict]] = None,
        roll_corrections: Optional[List[Dict]] = None,
        user_changed_marks: Optional[List[Dict]] = None,
    ) -> Dict[str, Any]:
        """
        Record the difference between AI predictions and human confirmation.

        Args:
            upload: AttendanceUpload with AI predictions
            confirmed_absent_ids: Student IDs confirmed absent by human
            name_corrections: List of {student_id, confirmed} for name match feedback
            roll_corrections: List of {student_id, confirmed} for roll match feedback
            user_changed_marks: List of {student_id, ai_suggested, user_confirmed, confidence}
                               for implicit feedback from simplified UI

        Returns:
            Dict with correction statistics
        """
        from .models import AttendanceFeedback

        ai_output = upload.ai_output_json or {}
        ai_matched = ai_output.get('matched', [])
        ai_present = ai_output.get('present', [])
        all_ai_entries = ai_matched + ai_present

        # Get AI-predicted absent student IDs
        ai_absent_ids = {m['student_id'] for m in ai_matched if m.get('student_id')}
        confirmed_set = set(confirmed_absent_ids)

        # Calculate differences
        false_positives = ai_absent_ids - confirmed_set  # AI said absent, human said present
        false_negatives = confirmed_set - ai_absent_ids  # AI said present, human said absent
        true_positives = ai_absent_ids & confirmed_set   # Both agreed absent

        corrections = []

        # Record user changed marks (implicit feedback from simplified UI)
        if user_changed_marks:
            for change in user_changed_marks:
                student_id = change.get('student_id')
                ai_suggested = change.get('ai_suggested')
                user_confirmed = change.get('user_confirmed')
                confidence = change.get('confidence', 0)
                
                # Determine correction type based on AI suggestion vs user action
                if ai_suggested == 'ABSENT' and user_confirmed == 'PRESENT':
                    correction_type = CorrectionType.FALSE_POSITIVE
                elif ai_suggested == 'PRESENT' and user_confirmed == 'ABSENT':
                    correction_type = CorrectionType.FALSE_NEGATIVE
                else:
                    # Other cases (LATE vs PRESENT, etc.)
                    correction_type = CorrectionType.MARK_MISREAD
                
                ai_entry = next((e for e in all_ai_entries if e.get('student_id') == student_id), {})
                corrections.append({
                    'student_id': student_id,
                    'correction_type': correction_type,
                    'ai_prediction': ai_suggested,
                    'human_correction': user_confirmed,
                    'raw_mark': ai_entry.get('raw_mark', ''),
                    'ocr_confidence': confidence,
                    'match_type': ai_entry.get('match_type', ''),
                    'feedback_source': 'implicit_ui_change'
                })

        # Record false positives (not already captured by user_changed_marks)
        for student_id in false_positives:
            ai_entry = next((m for m in ai_matched if m.get('student_id') == student_id), {})
            corrections.append({
                'student_id': student_id,
                'correction_type': CorrectionType.FALSE_POSITIVE,
                'ai_prediction': 'ABSENT',
                'human_correction': 'PRESENT',
                'raw_mark': ai_entry.get('raw_mark', ''),
                'ocr_confidence': ai_entry.get('ocr_confidence', 0),
                'match_type': ai_entry.get('match_type', '')
            })

        # Record false negatives
        for student_id in false_negatives:
            corrections.append({
                'student_id': student_id,
                'correction_type': CorrectionType.FALSE_NEGATIVE,
                'ai_prediction': 'PRESENT',
                'human_correction': 'ABSENT',
                'raw_mark': '',
                'ocr_confidence': 0,
                'match_type': 'human_added'
            })

        # Record name match corrections (only rejections - confirmed matches are implicit)
        name_rejection_count = 0
        for nc in (name_corrections or []):
            if not nc.get('confirmed', True):
                ai_entry = next(
                    (e for e in all_ai_entries if e.get('student_id') == nc['student_id']),
                    {}
                )
                corrections.append({
                    'student_id': nc['student_id'],
                    'correction_type': CorrectionType.NAME_MISMATCH,
                    'ai_prediction': ai_entry.get('extracted_name', ''),
                    'human_correction': 'REJECTED',
                    'raw_mark': '',
                    'ocr_confidence': ai_entry.get('match_score', 0),
                    'match_type': ai_entry.get('match_method', '')
                })
                name_rejection_count += 1

        # Record roll match corrections (only rejections)
        roll_rejection_count = 0
        for rc in (roll_corrections or []):
            if not rc.get('confirmed', True):
                ai_entry = next(
                    (e for e in all_ai_entries if e.get('student_id') == rc['student_id']),
                    {}
                )
                corrections.append({
                    'student_id': rc['student_id'],
                    'correction_type': CorrectionType.ROLL_MISMATCH,
                    'ai_prediction': ai_entry.get('extracted_serial', ''),
                    'human_correction': 'REJECTED',
                    'raw_mark': '',
                    'ocr_confidence': ai_entry.get('match_score', 0),
                    'match_type': ai_entry.get('match_method', '')
                })
                roll_rejection_count += 1

        # Store feedback records
        for corr in corrections:
            AttendanceFeedback.objects.create(
                school=self.school,
                upload=upload,
                student_id=corr['student_id'],
                correction_type=corr['correction_type'],
                ai_prediction=corr['ai_prediction'],
                human_correction=corr['human_correction'],
                raw_mark=corr['raw_mark'],
                ocr_confidence=corr['ocr_confidence'],
                match_type=corr['match_type']
            )

        # Calculate metrics
        total_predictions = len(ai_absent_ids)
        total_confirmed = len(confirmed_set)

        precision = len(true_positives) / total_predictions if total_predictions else 1.0
        recall = len(true_positives) / total_confirmed if total_confirmed else 1.0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0

        logger.info(
            f"[Learning] Upload {upload.id}: "
            f"FP={len(false_positives)}, FN={len(false_negatives)}, "
            f"TP={len(true_positives)}, Precision={precision:.2f}, Recall={recall:.2f}, "
            f"NameRej={name_rejection_count}, RollRej={roll_rejection_count}"
        )

        return {
            'false_positives': len(false_positives),
            'false_negatives': len(false_negatives),
            'true_positives': len(true_positives),
            'precision': precision,
            'recall': recall,
            'f1_score': f1,
            'corrections_recorded': len(corrections),
            'name_rejections': name_rejection_count,
            'roll_rejections': roll_rejection_count,
        }

    def get_school_accuracy_stats(self, days: int = 30) -> Dict[str, Any]:
        """
        Get accuracy statistics for this school over the past N days.

        Args:
            days: Number of days to look back

        Returns:
            Dict with accuracy metrics
        """
        from .models import AttendanceFeedback

        since = timezone.now() - timedelta(days=days)

        feedbacks = AttendanceFeedback.objects.filter(
            school=self.school,
            created_at__gte=since
        )

        total = feedbacks.count()
        if not total:
            return {
                'period_days': days,
                'total_corrections': 0,
                'accuracy': None,
                'message': 'No feedback data yet'
            }

        fp_count = feedbacks.filter(correction_type=CorrectionType.FALSE_POSITIVE).count()
        fn_count = feedbacks.filter(correction_type=CorrectionType.FALSE_NEGATIVE).count()
        name_mismatch_count = feedbacks.filter(correction_type=CorrectionType.NAME_MISMATCH).count()
        roll_mismatch_count = feedbacks.filter(correction_type=CorrectionType.ROLL_MISMATCH).count()

        # Attendance corrections only (not name/roll matching issues)
        attendance_corrections = fp_count + fn_count

        # Get total predictions for the period
        from .models import AttendanceUpload
        uploads = AttendanceUpload.objects.filter(
            school=self.school,
            created_at__gte=since,
            status='CONFIRMED'
        )

        # Count ALL AI-processed students (absent + present), not just absent
        total_predictions = 0
        for u in uploads:
            if u.ai_output_json:
                total_predictions += len(u.ai_output_json.get('matched', []))
                total_predictions += len(u.ai_output_json.get('present', []))

        # Attendance accuracy: how often AI's present/absent call was correct
        accuracy = 1 - (attendance_corrections / total_predictions) if total_predictions else None

        return {
            'period_days': days,
            'total_corrections': total,
            'attendance_corrections': attendance_corrections,
            'false_positives': fp_count,
            'false_negatives': fn_count,
            'name_mismatches': name_mismatch_count,
            'roll_mismatches': roll_mismatch_count,
            'total_predictions': total_predictions,
            'uploads_confirmed': uploads.count(),
            'accuracy': accuracy,
            'accuracy_pct': f"{accuracy * 100:.1f}%" if accuracy else 'N/A'
        }

    def get_common_ocr_errors(self, limit: int = 10) -> List[Dict[str, Any]]:
        """
        Find the most common OCR misreads for this school.

        Returns:
            List of common error patterns
        """
        from .models import AttendanceFeedback

        errors = AttendanceFeedback.objects.filter(
            school=self.school,
            correction_type=CorrectionType.FALSE_POSITIVE
        ).exclude(
            raw_mark=''
        ).values('raw_mark').annotate(
            count=Count('id'),
            avg_confidence=Avg('ocr_confidence')
        ).order_by('-count')[:limit]

        return [
            {
                'raw_mark': e['raw_mark'],
                'misread_count': e['count'],
                'avg_ocr_confidence': e['avg_confidence'],
                'suggestion': self._suggest_mapping_fix(e['raw_mark'])
            }
            for e in errors
        ]

    def _suggest_mapping_fix(self, raw_mark: str) -> Optional[str]:
        """Suggest a mapping fix for a commonly misread mark."""
        mark = raw_mark.strip().upper()

        # Common OCR confusions
        confusions = {
            'P': "Consider adding 'P' to PRESENT if not already",
            'A': "Consider adding 'A' to ABSENT if not already",
            '0': "Zero often confused with O - add to appropriate mapping",
            'O': "O often confused with 0 - add to appropriate mapping",
            '1': "1 might be confused with I or l",
            '/': "Slash sometimes means present (checkmark)",
            '-': "Dash might indicate absent or leave",
            '.': "Dot might be a checkmark or absent indicator",
        }

        return confusions.get(mark)

    def suggest_mark_mapping_updates(self) -> Dict[str, Any]:
        """
        Analyze feedback and suggest mark mapping updates.

        Returns:
            Dict with suggested mapping changes
        """
        errors = self.get_common_ocr_errors(20)
        current_mappings = self.school.mark_mappings

        suggestions = []
        for error in errors:
            mark = error['raw_mark']
            count = error['misread_count']

            # Check if this mark is already in mappings
            found_in = None
            for status, symbols in current_mappings.items():
                if status == 'default':
                    continue
                if isinstance(symbols, list) and mark in symbols:
                    found_in = status
                    break

            if not found_in:
                suggestions.append({
                    'mark': mark,
                    'misread_count': count,
                    'current_mapping': 'Not mapped (using default)',
                    'suggestion': f"Add '{mark}' to appropriate status mapping",
                    'priority': 'high' if count > 5 else 'medium'
                })
            else:
                # Mark is mapped but still causing errors
                suggestions.append({
                    'mark': mark,
                    'misread_count': count,
                    'current_mapping': found_in,
                    'suggestion': f"Verify '{mark}' should map to {found_in}",
                    'priority': 'low'
                })

        return {
            'current_mappings': current_mappings,
            'suggestions': suggestions,
            'last_updated': self.school.updated_at
        }

    def get_accuracy_trend(self, weeks: int = 4) -> List[Dict[str, Any]]:
        """
        Get weekly accuracy trend for this school.

        Args:
            weeks: Number of weeks to analyze

        Returns:
            List of weekly accuracy stats
        """
        from .models import AttendanceFeedback, AttendanceUpload

        trend = []
        now = timezone.now()

        for week in range(weeks):
            week_end = now - timedelta(weeks=week)
            week_start = week_end - timedelta(weeks=1)

            feedbacks = AttendanceFeedback.objects.filter(
                school=self.school,
                created_at__gte=week_start,
                created_at__lt=week_end
            )

            uploads = AttendanceUpload.objects.filter(
                school=self.school,
                created_at__gte=week_start,
                created_at__lt=week_end,
                status='CONFIRMED'
            )

            corrections = feedbacks.count()
            total_predictions = sum(
                len(u.ai_output_json.get('matched', []))
                for u in uploads
                if u.ai_output_json
            )

            accuracy = 1 - (corrections / total_predictions) if total_predictions else None

            trend.append({
                'week_start': week_start.date(),
                'week_end': week_end.date(),
                'uploads_processed': uploads.count(),
                'total_predictions': total_predictions,
                'corrections': corrections,
                'accuracy': accuracy,
                'accuracy_pct': f"{accuracy * 100:.1f}%" if accuracy else 'N/A'
            })

        return list(reversed(trend))  # Oldest first
