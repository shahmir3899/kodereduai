"""
Class-scoped face matching service.

Matches detected face embeddings against enrolled student embeddings via a
pgvector nearest-neighbor query (one query per detected face), scoped to the
requesting class/school/embedding version. Enforces strict class-scoping,
conflict resolution, and per-embedding-version confidence thresholds.
"""

import logging
from dataclasses import dataclass, field

from django.conf import settings
from pgvector.django import L2Distance

from face_attendance.models import StudentFaceEmbedding

logger = logging.getLogger(__name__)

FR_SETTINGS = getattr(settings, 'FACE_RECOGNITION_SETTINGS', {})
DEFAULT_EMBEDDING_VERSION = FR_SETTINGS.get('DEFAULT_EMBEDDING_VERSION', 'dlib_v1')

# Rows pulled per face before de-duplicating by student. Class rosters are
# small (tens of students), so this comfortably covers every enrolled
# student even with a few embeddings each.
CANDIDATE_FETCH_LIMIT = 20


def get_thresholds(embedding_version=None):
    """Return {'high': float, 'medium': float} thresholds for an embedding version."""
    version = embedding_version or DEFAULT_EMBEDDING_VERSION
    all_thresholds = FR_SETTINGS.get('THRESHOLDS', {})
    thresholds = all_thresholds.get(version) or next(iter(all_thresholds.values()), {})
    return {
        'high': thresholds.get('HIGH_CONFIDENCE_THRESHOLD', 0.40),
        'medium': thresholds.get('MEDIUM_CONFIDENCE_THRESHOLD', 0.55),
    }


def distance_to_confidence(distance):
    """
    Convert L2 distance to confidence percentage.

    Uses: confidence = max(0, (1 - distance/0.6)) * 100
    Lower distance = higher confidence.
    """
    return round(max(0.0, (1.0 - distance / 0.6)) * 100, 1)


def _classify_from_thresholds(distance, thresholds):
    if distance < thresholds['high']:
        return 'AUTO_MATCHED'
    elif distance < thresholds['medium']:
        return 'FLAGGED'
    else:
        return 'IGNORED'


def classify_match(distance, embedding_version=None):
    """Classify match confidence level based on distance for an embedding version."""
    return _classify_from_thresholds(distance, get_thresholds(embedding_version))


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


class FaceMatcher:
    """
    Matches detected face embeddings against an enrolled candidate set.

    Rules (non-negotiable):
    - Match ONLY within the candidate set the caller supplies (a class
      roster for Tier C / CLASS-scoped Tier B devices, or a whole school's
      roster for SCHOOL-scoped Tier B devices — the caller decides scope,
      this class never widens or narrows it)
    - Each detected face maps to at most one student
    - If two faces map to the same student, keep higher confidence
    - Prefer false negatives over false positives
    """

    def match_faces(self, face_embeddings, class_student_ids, school_id,
                     student_names=None, embedding_version=None):
        """
        Match detected face embeddings against a candidate student roster.

        Args:
            face_embeddings: list of (face_index, numpy.ndarray) tuples
            class_student_ids: iterable of student IDs eligible for matching
                (already scoped by the caller — class or whole-school)
            school_id: School PK (tenant scope)
            student_names: dict {student_id: name} for result labeling
            embedding_version: embedding space to match against (defaults to
                FACE_RECOGNITION_SETTINGS['DEFAULT_EMBEDDING_VERSION'])

        Returns:
            list[MatchResult]: One result per detected face
        """
        student_names = student_names or {}
        version = embedding_version or DEFAULT_EMBEDDING_VERSION
        thresholds = get_thresholds(version)
        student_ids = list(class_student_ids)

        if not student_ids:
            logger.warning('No enrolled embeddings found for class')
            return [
                MatchResult(face_index=idx, match_status='IGNORED')
                for idx, _ in face_embeddings
            ]

        raw_matches = [
            self._match_single_face(
                face_index, face_emb, student_ids, school_id, version,
                student_names, thresholds,
            )
            for face_index, face_emb in face_embeddings
        ]

        # Conflict resolution: if two faces match the same student,
        # keep the one with the lower distance (higher confidence)
        return self._resolve_conflicts(raw_matches, thresholds)

    def _match_single_face(self, face_index, face_emb, student_ids, school_id,
                            version, student_names, thresholds):
        rows = list(
            StudentFaceEmbedding.objects.filter(
                school_id=school_id,
                student_id__in=student_ids,
                is_active=True,
                embedding_version=version,
            )
            .annotate(distance=L2Distance('embedding_vector', face_emb.tolist()))
            .order_by('distance')
            .values_list('student_id', 'distance')[:CANDIDATE_FETCH_LIMIT]
        )

        if not rows:
            return MatchResult(face_index=face_index, match_status='IGNORED')

        best_student_id, best_distance = rows[0]
        best_distance = float(best_distance)

        # Build alternatives (top 3 unique students, excluding best)
        alternatives = []
        seen_students = {best_student_id}
        for student_id, distance in rows[1:]:
            if student_id in seen_students:
                continue
            seen_students.add(student_id)
            distance = float(distance)
            if distance < thresholds['medium'] and len(alternatives) < 3:
                alternatives.append({
                    'student_id': student_id,
                    'name': student_names.get(student_id, ''),
                    'confidence': distance_to_confidence(distance),
                    'distance': round(distance, 4),
                })

        return MatchResult(
            face_index=face_index,
            student_id=best_student_id,
            student_name=student_names.get(best_student_id, ''),
            distance=best_distance,
            confidence=distance_to_confidence(best_distance),
            match_status=self._classify(best_distance, thresholds),
            alternatives=alternatives,
        )

    @staticmethod
    def _classify(distance, thresholds):
        """Classify match confidence level based on distance."""
        return _classify_from_thresholds(distance, thresholds)

    def _resolve_conflicts(self, matches, thresholds):
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
            student_claims.setdefault(match.student_id, []).append(match)

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
                        loser.match_status = self._classify(alt['distance'], thresholds)
                        reassigned = True
                        break

                if not reassigned:
                    loser.student_id = None
                    loser.student_name = ''
                    loser.distance = float('inf')
                    loser.confidence = 0.0
                    loser.match_status = 'IGNORED'

        return matches
