"""
Class-scoped face matching service.

Matches detected face embeddings against enrolled student embeddings.
Enforces strict class-scoping, conflict resolution, and confidence thresholds.
"""

import logging
from dataclasses import dataclass, field

import numpy as np
from django.conf import settings

logger = logging.getLogger(__name__)

FR_SETTINGS = getattr(settings, 'FACE_RECOGNITION_SETTINGS', {})
HIGH_THRESHOLD = FR_SETTINGS.get('HIGH_CONFIDENCE_THRESHOLD', 0.40)
MEDIUM_THRESHOLD = FR_SETTINGS.get('MEDIUM_CONFIDENCE_THRESHOLD', 0.55)


@dataclass
class MatchResult:
    """Result of matching a single detected face."""
    face_index: int
    student_id: int = None
    student_name: str = ''
    distance: float = float('inf')
    confidence: float = 0.0
    match_status: str = 'IGNORED'  # AUTO_MATCHED, FLAGGED, IGNORED
    alternatives: list = field(default_factory=list)


def distance_to_confidence(distance):
    """
    Convert L2 distance to confidence percentage.

    Uses: confidence = max(0, (1 - distance/0.6)) * 100
    Lower distance = higher confidence.
    """
    return round(max(0.0, (1.0 - distance / 0.6)) * 100, 1)


def classify_match(distance):
    """
    Classify match confidence level based on distance.

    Returns match_status string.
    """
    if distance < HIGH_THRESHOLD:
        return 'AUTO_MATCHED'
    elif distance < MEDIUM_THRESHOLD:
        return 'FLAGGED'
    else:
        return 'IGNORED'


class FaceMatcher:
    """
    Matches detected face embeddings against enrolled class embeddings.

    Rules (non-negotiable):
    - Match ONLY within the selected class/section
    - Each detected face maps to at most one student
    - If two faces map to the same student, keep higher confidence
    - Prefer false negatives over false positives
    """

    def __init__(self):
        import face_recognition
        self._fr = face_recognition

    def match_faces(self, face_embeddings, class_embeddings, student_names=None):
        """
        Match detected face embeddings against class student embeddings.

        Args:
            face_embeddings: list of (face_index, numpy.ndarray) tuples
            class_embeddings: dict {student_id: [numpy.ndarray, ...]}
            student_names: dict {student_id: name} for result labeling

        Returns:
            list[MatchResult]: One result per detected face
        """
        if not class_embeddings:
            logger.warning('No enrolled embeddings found for class')
            return [
                MatchResult(face_index=idx, match_status='IGNORED')
                for idx, _ in face_embeddings
            ]

        student_names = student_names or {}

        # Build flat arrays for vectorized comparison
        enrolled_student_ids = []
        enrolled_embeddings = []
        for sid, embs in class_embeddings.items():
            for emb in embs:
                enrolled_student_ids.append(sid)
                enrolled_embeddings.append(emb)

        enrolled_array = np.array(enrolled_embeddings)

        # Match each detected face
        raw_matches = []
        for face_index, face_emb in face_embeddings:
            distances = self._fr.face_distance(enrolled_array, face_emb)

            # Sort by distance (best matches first)
            sorted_indices = np.argsort(distances)

            best_idx = sorted_indices[0]
            best_distance = float(distances[best_idx])
            best_student_id = enrolled_student_ids[best_idx]

            # Build alternatives (top 3 unique students, excluding best)
            alternatives = []
            seen_students = {best_student_id}
            for idx in sorted_indices[1:]:
                alt_sid = enrolled_student_ids[idx]
                if alt_sid in seen_students:
                    continue
                seen_students.add(alt_sid)
                alt_dist = float(distances[idx])
                if alt_dist < MEDIUM_THRESHOLD and len(alternatives) < 3:
                    alternatives.append({
                        'student_id': alt_sid,
                        'name': student_names.get(alt_sid, ''),
                        'confidence': distance_to_confidence(alt_dist),
                        'distance': round(alt_dist, 4),
                    })

            result = MatchResult(
                face_index=face_index,
                student_id=best_student_id,
                student_name=student_names.get(best_student_id, ''),
                distance=best_distance,
                confidence=distance_to_confidence(best_distance),
                match_status=classify_match(best_distance),
                alternatives=alternatives,
            )
            raw_matches.append(result)

        # Conflict resolution: if two faces match the same student,
        # keep the one with the lower distance (higher confidence)
        resolved = self._resolve_conflicts(raw_matches, student_names)
        return resolved

    def _resolve_conflicts(self, matches, student_names):
        """
        Resolve cases where multiple faces match the same student.

        Strategy:
        - Group matches by student_id
        - For each conflicting group, keep the match with lowest distance
        - Demoted matches try their next-best alternative, or become IGNORED
        """
        # Group by student_id (only for non-IGNORED matches)
        student_claims = {}  # student_id -> list of MatchResult
        for match in matches:
            if match.match_status == 'IGNORED' or match.student_id is None:
                continue
            if match.student_id not in student_claims:
                student_claims[match.student_id] = []
            student_claims[match.student_id].append(match)

        # Resolve conflicts
        for student_id, claimants in student_claims.items():
            if len(claimants) <= 1:
                continue

            # Sort by distance: keep the best
            claimants.sort(key=lambda m: m.distance)
            winner = claimants[0]

            # Demote all others
            for loser in claimants[1:]:
                logger.info(
                    f'Conflict: face #{loser.face_index} and #{winner.face_index} '
                    f'both matched student {student_id}. Keeping #{winner.face_index}.'
                )
                # Try to assign loser to their best alternative
                reassigned = False
                for alt in loser.alternatives:
                    alt_sid = alt['student_id']
                    # Check this student isn't already claimed by a better match
                    already_claimed = any(
                        m.student_id == alt_sid and m.match_status != 'IGNORED'
                        for m in matches if m is not loser
                    )
                    if not already_claimed:
                        loser.student_id = alt_sid
                        loser.student_name = alt.get('name', '')
                        loser.distance = alt['distance']
                        loser.confidence = alt['confidence']
                        loser.match_status = classify_match(alt['distance'])
                        reassigned = True
                        break

                if not reassigned:
                    loser.student_id = None
                    loser.student_name = ''
                    loser.distance = float('inf')
                    loser.confidence = 0.0
                    loser.match_status = 'IGNORED'

        return matches
