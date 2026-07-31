"""
AI Admissions Conversion Likelihood Service.

Scores open enquiries (NEW/CONFIRMED) by likelihood of converting to
enrollment, using a transparent rule-based composite of source history,
response time, note activity, and followup adherence — same heuristic
philosophy as AttendanceRiskService, not a trained model.
"""

import logging
from datetime import date

from django.utils import timezone

logger = logging.getLogger(__name__)

# Composite weights (sum to 1.0)
WEIGHT_SOURCE = 0.25
WEIGHT_RESPONSE_TIME = 0.25
WEIGHT_NOTE_ACTIVITY = 0.30
WEIGHT_FOLLOWUP = 0.20

# Laplace smoothing pseudo-count for sparse per-source conversion history.
SOURCE_SMOOTHING_K = 10

ENGAGED_NOTE_TYPES = ('NOTE', 'CALL')


class ConversionLikelihoodService:
    """Scores open admission enquiries by likelihood of converting."""

    def __init__(self, school_id: int):
        self.school_id = school_id

    def get_scored_enquiries(self) -> dict:
        from .models import AdmissionEnquiry, AdmissionNote

        enquiries = list(
            AdmissionEnquiry.objects.filter(
                school_id=self.school_id,
                status__in=['NEW', 'CONFIRMED'],
            )
        )

        total_open = len(enquiries)
        if total_open == 0:
            return {
                'total_open': 0,
                'likelihood_levels': {'HIGH': 0, 'MEDIUM': 0, 'LOW': 0},
                'enquiries': [],
            }

        source_scores = self._build_source_scores()

        enquiry_ids = [e.id for e in enquiries]
        notes = AdmissionNote.objects.filter(
            enquiry_id__in=enquiry_ids,
        ).values_list('enquiry_id', 'note_type', 'created_at').order_by('created_at')

        notes_by_enquiry = {}
        for eid, note_type, created_at in notes:
            notes_by_enquiry.setdefault(eid, []).append((note_type, created_at))

        today = timezone.localdate()
        scored = []
        levels = {'HIGH': 0, 'MEDIUM': 0, 'LOW': 0}

        for enquiry in enquiries:
            enquiry_notes = notes_by_enquiry.get(enquiry.id, [])

            source_score = source_scores.get(enquiry.source, 50.0)
            response_score, response_detail = self._response_time_score(enquiry, enquiry_notes)
            activity_score, activity_detail = self._note_activity_score(enquiry_notes, today)
            followup_score, followup_detail = self._followup_score(enquiry, enquiry_notes, today)

            composite = (
                source_score * WEIGHT_SOURCE
                + response_score * WEIGHT_RESPONSE_TIME
                + activity_score * WEIGHT_NOTE_ACTIVITY
                + followup_score * WEIGHT_FOLLOWUP
            )
            composite = round(composite, 1)

            level = self._likelihood_level(composite)
            levels[level] += 1

            suggested_action = self._suggest_action(level, followup_detail, activity_detail)

            scored.append({
                'enquiry_id': enquiry.id,
                'student_name': enquiry.name,
                'source': enquiry.source,
                'status': enquiry.status,
                'score': composite,
                'likelihood': level,
                'factors': {
                    'source_score': round(source_score, 1),
                    'response_time_score': round(response_score, 1),
                    'note_activity_score': round(activity_score, 1),
                    'followup_score': round(followup_score, 1),
                },
                'response_detail': response_detail,
                'activity_detail': activity_detail,
                'followup_detail': followup_detail,
                'suggested_action': suggested_action,
            })

        scored.sort(key=lambda e: e['score'], reverse=True)

        return {
            'total_open': total_open,
            'likelihood_levels': levels,
            'enquiries': scored,
        }

    def _build_source_scores(self) -> dict:
        """
        Per-school historical conversion rate by source, Laplace-smoothed so a
        source with little/no history lands near a neutral 50 instead of 0/100.
        """
        from .models import AdmissionEnquiry

        resolved = AdmissionEnquiry.objects.filter(
            school_id=self.school_id,
            status__in=['CONVERTED', 'CANCELLED'],
        ).values_list('source', 'status')

        totals = {}
        conversions = {}
        for source, status_val in resolved:
            totals[source] = totals.get(source, 0) + 1
            if status_val == 'CONVERTED':
                conversions[source] = conversions.get(source, 0) + 1

        scores = {}
        all_sources = {choice[0] for choice in AdmissionEnquiry.SOURCE_CHOICES}
        for source in all_sources:
            total = totals.get(source, 0)
            converted = conversions.get(source, 0)
            smoothed_rate = (converted + SOURCE_SMOOTHING_K * 0.5) / (total + SOURCE_SMOOTHING_K)
            scores[source] = smoothed_rate * 100

        return scores

    def _response_time_score(self, enquiry, enquiry_notes: list) -> tuple:
        """Gap between enquiry creation and the first non-SYSTEM note."""
        first_response = next(
            (created_at for note_type, created_at in enquiry_notes if note_type != 'SYSTEM'),
            None,
        )

        if first_response is None:
            return 10.0, 'No response logged yet'

        gap = first_response - enquiry.created_at
        hours = gap.total_seconds() / 3600

        if hours < 24:
            return 100.0, 'Responded within 1 day'
        if hours < 72:
            return 70.0, 'Responded within 3 days'
        if hours < 168:
            return 40.0, 'Responded within a week'
        return 10.0, 'Responded after more than a week'

    def _note_activity_score(self, enquiry_notes: list, today: date) -> tuple:
        """Count of genuine follow-up notes, weighted by recency of the last one."""
        engaged = [created_at for note_type, created_at in enquiry_notes if note_type in ENGAGED_NOTE_TYPES]

        if not engaged:
            return 10.0, 'No follow-up activity logged'

        count = len(engaged)
        last_note_date = max(engaged).date()
        days_since_last = (today - last_note_date).days

        count_score = min(count * 15, 60)
        if days_since_last <= 3:
            recency_score = 40
        elif days_since_last <= 7:
            recency_score = 25
        elif days_since_last <= 14:
            recency_score = 10
        else:
            recency_score = 0

        score = min(count_score + recency_score, 100)
        return float(score), f'{count} follow-up note(s), last {days_since_last} day(s) ago'

    def _followup_score(self, enquiry, enquiry_notes: list, today: date) -> tuple:
        """Whether a next-followup date is set and being kept."""
        if not enquiry.next_followup_date:
            return 30.0, 'No followup date scheduled'

        if enquiry.next_followup_date >= today:
            return 80.0, f'Followup scheduled for {enquiry.next_followup_date}'

        # Overdue — check if there's been recent activity anyway.
        recent_activity = any(
            note_type in ENGAGED_NOTE_TYPES and (today - created_at.date()).days <= 3
            for note_type, created_at in enquiry_notes
        )
        if recent_activity:
            return 40.0, 'Followup overdue but recently contacted'
        return 5.0, f'Followup overdue since {enquiry.next_followup_date} - going cold'

    def _likelihood_level(self, score: float) -> str:
        if score >= 65:
            return 'HIGH'
        if score >= 40:
            return 'MEDIUM'
        return 'LOW'

    def _suggest_action(self, level: str, followup_detail: str, activity_detail: str) -> str:
        going_cold = 'going cold' in followup_detail
        if going_cold:
            return 'Re-engage before losing this lead - followup overdue and activity has stalled'

        if level == 'HIGH':
            return 'Prioritize - high conversion likelihood, push toward confirmation'
        if level == 'MEDIUM':
            return 'Keep nurturing - schedule a follow-up call to move this lead forward'
        return 'Low engagement - consider a fresh outreach attempt or deprioritize'
