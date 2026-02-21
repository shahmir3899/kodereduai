"""
Pipeline Voter - Cross-validates results from multiple AI providers.

When voting is enabled, runs multiple providers and uses majority vote
to determine each student's attendance status.
"""

import logging
from collections import Counter
from typing import List, Dict, Any

logger = logging.getLogger(__name__)


class PipelineVoter:
    """
    Aggregates results from multiple pipeline runs and produces
    a consensus result via majority vote.

    Each result is expected to have the standard ai_output_json format:
    {matched: [...], unmatched: [...], matched_count, unmatched_count, confidence, ...}
    """

    def __init__(self, results: List[Dict[str, Any]], threshold: int = 2):
        """
        Args:
            results: List of ai_output_json dicts from different providers
            threshold: Minimum number of providers that must agree (default: 2)
        """
        self.results = results
        self.threshold = threshold

    def vote(self) -> Dict[str, Any]:
        """
        Produce a consensus result from multiple pipeline outputs.

        For each student found across providers:
        - Collects all status votes (ABSENT / PRESENT)
        - Final status = majority vote (must agree in >= threshold providers)
        - Uses the highest-confidence entry for metadata

        Returns:
            Merged ai_output_json dict with vote metadata
        """
        if not self.results:
            return {'matched': [], 'unmatched': [], 'matched_count': 0,
                    'unmatched_count': 0, 'confidence': 0, 'notes': 'No results to vote on'}

        if len(self.results) == 1:
            return self.results[0]

        # Build vote map: student_id -> list of (status, entry, provider_idx)
        vote_map = {}
        for idx, result in enumerate(self.results):
            for entry in result.get('matched', []):
                sid = entry.get('student_id')
                if not sid:
                    continue
                if sid not in vote_map:
                    vote_map[sid] = []
                vote_map[sid].append({
                    'status': 'ABSENT',
                    'entry': entry,
                    'provider_idx': idx,
                    'confidence': entry.get('confidence', entry.get('ocr_confidence', 0)),
                })

            # Present students (if tracked)
            for entry in result.get('present', []):
                sid = entry.get('student_id')
                if not sid:
                    continue
                if sid not in vote_map:
                    vote_map[sid] = []
                vote_map[sid].append({
                    'status': 'PRESENT',
                    'entry': entry,
                    'provider_idx': idx,
                    'confidence': entry.get('confidence', 0),
                })

        # Resolve votes
        final_matched = []
        uncertain = []

        for student_id, votes in vote_map.items():
            status_counts = Counter(v['status'] for v in votes)
            majority_status, majority_count = status_counts.most_common(1)[0]

            # Pick the entry with highest confidence for metadata
            best_vote = max(votes, key=lambda v: v['confidence'])
            entry = dict(best_vote['entry'])
            entry['vote_count'] = len(votes)
            entry['vote_agreement'] = majority_count
            entry['vote_status'] = majority_status

            if majority_count >= self.threshold:
                if majority_status == 'ABSENT':
                    final_matched.append(entry)
            else:
                entry['vote_note'] = f'Split vote: {dict(status_counts)}'
                uncertain.append(entry)

        # Collect unmatched from all providers (union)
        all_unmatched = []
        seen_unmatched = set()
        for result in self.results:
            for entry in result.get('unmatched', []):
                key = entry.get('extracted_name', '') or entry.get('extracted_serial', '')
                if key and key not in seen_unmatched:
                    seen_unmatched.add(key)
                    all_unmatched.append(entry)

        # Average confidence across all results
        confidences = [r.get('confidence', 0) for r in self.results if r.get('confidence')]
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0

        return {
            'matched': final_matched,
            'unmatched': all_unmatched,
            'matched_count': len(final_matched),
            'unmatched_count': len(all_unmatched),
            'uncertain': uncertain,
            'confidence': avg_confidence,
            'notes': f'Multi-pipeline vote ({len(self.results)} providers, threshold={self.threshold})',
            'vote_metadata': {
                'providers_used': len(self.results),
                'threshold': self.threshold,
                'total_students_voted': len(vote_map),
                'unanimous': sum(1 for v in vote_map.values() if len(set(x['status'] for x in v)) == 1),
                'split_votes': len(uncertain),
            },
        }
