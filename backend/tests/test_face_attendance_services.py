"""
Face Attendance Services — Unit Tests
======================================
Covers: FaceMatcher (distance, confidence, conflict resolution),
        EmbeddingService (bytes roundtrip, class-scoped retrieval),
        FaceDetector (detection, quality filtering, cropping).

Run:
    cd backend
    pytest tests/test_face_attendance_services.py -v
"""

from unittest.mock import MagicMock

import numpy as np
import pytest

from face_attendance.services.matcher import (
    FaceMatcher, MatchResult, distance_to_confidence, classify_match,
)
from face_attendance.services.embedding_service import EmbeddingService
from face_attendance.services.face_detector import FaceDetector, DetectedFace
from face_attendance.models import StudentFaceEmbedding


# =====================================================================
# LEVEL B1: FaceMatcher — Confidence & Classification
# =====================================================================


@pytest.mark.face_attendance
class TestDistanceToConfidence:
    """B1a-c: Distance → confidence conversion."""

    def test_zero_distance_gives_100(self):
        """B1a: distance=0 → confidence=100%."""
        assert distance_to_confidence(0.0) == 100.0

    def test_threshold_distance_gives_zero(self):
        """B1b: distance=0.6 → confidence=0%."""
        assert distance_to_confidence(0.6) == 0.0

    def test_mid_distance(self):
        """B1c: distance=0.3 → confidence=50%."""
        assert distance_to_confidence(0.3) == 50.0

    def test_large_distance_clamps_to_zero(self):
        """B1c extra: distance > 0.6 → confidence=0% (no negatives)."""
        assert distance_to_confidence(1.0) == 0.0

    def test_small_distance_high_confidence(self):
        """B1c extra: distance=0.1 → ~83.3%."""
        result = distance_to_confidence(0.1)
        assert 83.0 <= result <= 84.0


@pytest.mark.face_attendance
class TestClassifyMatch:
    """B1d-f: Distance → match status classification."""

    def test_high_confidence(self):
        """B1d: distance < 0.40 → AUTO_MATCHED."""
        assert classify_match(0.30) == 'AUTO_MATCHED'
        assert classify_match(0.39) == 'AUTO_MATCHED'

    def test_medium_confidence(self):
        """B1e: 0.40 ≤ distance < 0.55 → FLAGGED."""
        assert classify_match(0.40) == 'FLAGGED'
        assert classify_match(0.50) == 'FLAGGED'
        assert classify_match(0.54) == 'FLAGGED'

    def test_low_confidence(self):
        """B1f: distance ≥ 0.55 → IGNORED."""
        assert classify_match(0.55) == 'IGNORED'
        assert classify_match(0.70) == 'IGNORED'
        assert classify_match(1.00) == 'IGNORED'


# =====================================================================
# LEVEL B1 (continued): FaceMatcher — Matching Logic (pgvector-backed)
# =====================================================================


def _enroll(student, school_id, vector, version='dlib_v1'):
    """Create a StudentFaceEmbedding row with both legacy bytes and the pgvector column."""
    return StudentFaceEmbedding.objects.create(
        student=student,
        school_id=school_id,
        embedding=np.asarray(vector, dtype=np.float64).tobytes(),
        embedding_vector=np.asarray(vector, dtype=np.float32).tolist(),
        embedding_version=version,
        quality_score=0.9,
        is_active=True,
    )


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestFaceMatcherMatching:
    """B1g-k: Face matching logic against real pgvector-backed rows."""

    @pytest.fixture(autouse=True)
    def _require_postgres(self):
        # match_faces() runs pgvector L2Distance queries, which don't exist
        # on SQLite. Same skip convention as lms/tests/test_embeddings.py.
        from django.db import connection
        if connection.vendor != 'postgresql':
            pytest.skip('FaceMatcher matching requires PostgreSQL (pgvector L2Distance)')

    def test_empty_class_returns_all_ignored(self, seed_data):
        """B1j: No enrolled students → all IGNORED (no DB query needed)."""
        matcher = FaceMatcher()
        face_embs = [(0, np.zeros(128)), (1, np.ones(128))]
        results = matcher.match_faces(face_embs, [], seed_data['SID_A'])

        assert len(results) == 2
        assert all(r.match_status == 'IGNORED' for r in results)

    def test_single_face_single_student(self, seed_data):
        """B1k: 1 face, 1 enrolled → correct match."""
        student = seed_data['students'][4]  # Hamza Raza (class 2, no seeded embedding)
        rng = np.random.default_rng(42)
        student_emb = rng.standard_normal(128)
        # Face is very close to the student (noise * 0.02 → distance ≈ 0.23)
        face_emb = student_emb + rng.standard_normal(128) * 0.02
        _enroll(student, seed_data['SID_A'], student_emb)

        matcher = FaceMatcher()
        results = matcher.match_faces(
            [(0, face_emb)], [student.id], seed_data['SID_A'],
            student_names={student.id: student.name},
        )

        assert len(results) == 1
        assert results[0].student_id == student.id
        assert results[0].confidence > 0

    def test_match_faces_returns_sorted_by_distance(self, seed_data):
        """B1g: Results preserve face_index order."""
        student_a = seed_data['students'][4]
        student_b = seed_data['students'][5]
        rng = np.random.default_rng(42)
        student_emb = rng.standard_normal(128)
        face_0 = student_emb + rng.standard_normal(128) * 0.01  # very close
        face_1 = student_emb + rng.standard_normal(128) * 0.5   # far
        _enroll(student_a, seed_data['SID_A'], student_emb)
        _enroll(student_b, seed_data['SID_A'], rng.standard_normal(128))

        matcher = FaceMatcher()
        results = matcher.match_faces(
            [(0, face_0), (1, face_1)],
            [student_a.id, student_b.id],
            seed_data['SID_A'],
        )

        assert len(results) == 2
        assert results[0].face_index == 0
        assert results[1].face_index == 1

    def test_conflict_resolution_keeps_best_match(self, seed_data):
        """B1h: Two faces → same student → lower distance wins."""
        student = seed_data['students'][4]
        student_emb = np.zeros(128)
        face_close = student_emb + np.ones(128) * 0.01   # distance ≈ 0.11 → AUTO_MATCHED
        face_far = student_emb + np.ones(128) * 0.03     # distance ≈ 0.34 → AUTO_MATCHED
        _enroll(student, seed_data['SID_A'], student_emb)

        matcher = FaceMatcher()
        results = matcher.match_faces(
            [(0, face_close), (1, face_far)],
            [student.id],
            seed_data['SID_A'],
        )

        # Both initially match the student, conflict resolution keeps the closer one
        active = [r for r in results if r.student_id == student.id and r.match_status != 'IGNORED']
        assert len(active) == 1
        assert active[0].face_index == 0  # closer face wins

    def test_conflict_resolution_demotes_loser_to_ignored(self, seed_data):
        """B1i: Loser with no alternatives → IGNORED."""
        student = seed_data['students'][4]
        student_emb = np.zeros(128)
        face_close = student_emb + np.ones(128) * 0.01   # distance ≈ 0.11
        face_far = student_emb + np.ones(128) * 0.03     # distance ≈ 0.34
        _enroll(student, seed_data['SID_A'], student_emb)  # only one student enrolled

        matcher = FaceMatcher()
        results = matcher.match_faces(
            [(0, face_close), (1, face_far)],
            [student.id],
            seed_data['SID_A'],
        )

        # The loser should be IGNORED (no alternatives)
        loser = [r for r in results if r.face_index == 1][0]
        assert loser.match_status == 'IGNORED'


# =====================================================================
# LEVEL B2: EmbeddingService
# =====================================================================


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestEmbeddingBytesRoundtrip:
    """B2a: numpy ↔ bytes conversion is lossless (legacy embedding column)."""

    def test_roundtrip(self):
        """B2a: embedding_to_bytes → np.frombuffer is identity."""
        original = np.random.default_rng(42).standard_normal(128).astype(np.float64)
        as_bytes = EmbeddingService.embedding_to_bytes(original)
        recovered = np.frombuffer(as_bytes, dtype=np.float64)
        np.testing.assert_array_equal(original, recovered)


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestEmbeddingStorage:
    """B2b-e: Embedding storage and class-scoped retrieval."""

    def test_store_embedding_creates_record(self, seed_data):
        """B2b: store_embedding creates a StudentFaceEmbedding with both columns set."""
        student = seed_data['students'][4]  # Hamza Raza (class 2)
        emb = np.random.default_rng(99).standard_normal(128).astype(np.float64)

        svc = EmbeddingService.__new__(EmbeddingService)
        svc._fr = MagicMock()

        result = svc.store_embedding(
            student_id=student.id,
            school_id=seed_data['SID_A'],
            embedding=emb,
            source_image_url='https://example.com/test.jpg',
            quality_score=0.9,
        )

        assert result.id is not None
        assert result.student_id == student.id
        assert result.embedding_vector is not None
        assert len(result.embedding_vector) == 128
        assert StudentFaceEmbedding.objects.filter(id=result.id).exists()

    def test_get_class_student_ids_scoped(self, seed_data):
        """B2c: Only returns student IDs for students in the specified class."""
        svc = EmbeddingService.__new__(EmbeddingService)
        svc._fr = MagicMock()

        class_1 = seed_data['classes'][0]
        result = svc.get_class_student_ids(class_1.id, seed_data['SID_A'])

        # Should have IDs for class 1 students only (first 4, seeded with embeddings)
        class_1_student_ids = {s.id for s in seed_data['students'][:4]}
        assert result.issubset(class_1_student_ids)
        assert len(result) > 0

    def test_get_class_student_ids_excludes_inactive(self, seed_data):
        """B2d: Students with only an inactive embedding are excluded."""
        svc = EmbeddingService.__new__(EmbeddingService)
        svc._fr = MagicMock()

        # Deactivate one embedding
        emb = seed_data['face_embeddings'][0]
        emb.is_active = False
        emb.save()

        class_1 = seed_data['classes'][0]
        result = svc.get_class_student_ids(class_1.id, seed_data['SID_A'])

        deactivated_student = seed_data['students'][0]
        assert deactivated_student.id not in result

        # Restore
        emb.is_active = True
        emb.save()

    def test_get_class_student_ids_empty_class(self, seed_data):
        """B2e: Class with no enrollments → empty set."""
        # Class 3 has no face embeddings seeded
        svc = EmbeddingService.__new__(EmbeddingService)
        svc._fr = MagicMock()

        class_3 = seed_data['classes'][2]
        result = svc.get_class_student_ids(class_3.id, seed_data['SID_A'])
        assert result == set()


# =====================================================================
# LEVEL B3: FaceDetector (mocked face_recognition)
# =====================================================================


@pytest.mark.face_attendance
class TestFaceDetector:
    """B3a-g: Face detection and quality filtering."""

    def test_detect_faces_returns_detected_faces(self):
        """B3a: Returns DetectedFace objects with correct locations."""
        mock_fr = MagicMock()
        mock_fr.face_locations.return_value = [
            (50, 150, 130, 20),
            (200, 350, 280, 220),
        ]

        detector = FaceDetector.__new__(FaceDetector)
        detector._fr = mock_fr
        image = np.zeros((400, 400, 3), dtype=np.uint8)

        faces = detector.detect_faces(image)

        assert len(faces) == 2
        assert faces[0].location == (50, 150, 130, 20)
        assert faces[0].width == 130  # right - left
        assert faces[0].height == 80  # bottom - top

    def test_detect_faces_zero_raises(self):
        """B3b: ValueError on 0 faces detected."""
        mock_fr = MagicMock()
        mock_fr.face_locations.return_value = []

        detector = FaceDetector.__new__(FaceDetector)
        detector._fr = mock_fr
        image = np.zeros((400, 400, 3), dtype=np.uint8)

        with pytest.raises(ValueError, match='No faces detected'):
            detector.detect_faces(image)

    def test_detect_faces_too_many_raises(self):
        """B3c: ValueError on > MAX_FACES."""
        mock_fr = MagicMock()
        mock_fr.face_locations.return_value = [(i, i+80, i+60, i) for i in range(20)]

        detector = FaceDetector.__new__(FaceDetector)
        detector._fr = mock_fr
        image = np.zeros((1000, 1000, 3), dtype=np.uint8)

        with pytest.raises(ValueError, match='Too many faces'):
            detector.detect_faces(image)

    def test_filter_quality_small_face_fails(self):
        """B3d: Face < MIN_FACE_SIZE → passed_quality=False."""
        detector = FaceDetector.__new__(FaceDetector)
        detector._fr = MagicMock()

        image = np.random.randint(0, 255, (200, 200, 3), dtype=np.uint8)
        face = DetectedFace(
            index=0, location=(10, 40, 40, 10),  # 30x30 — too small
            width=30, height=30,
        )

        result = detector.filter_quality(image, [face])
        assert result[0].passed_quality is False

    def test_filter_quality_blurry_face_fails(self):
        """B3e: Low Laplacian variance → passed_quality=False."""
        detector = FaceDetector.__new__(FaceDetector)
        detector._fr = MagicMock()

        # Uniform image = max blur (zero variance)
        image = np.full((200, 200, 3), 128, dtype=np.uint8)
        face = DetectedFace(
            index=0, location=(10, 110, 110, 10),  # 100x100 — big enough
            width=100, height=100,
        )

        result = detector.filter_quality(image, [face])
        assert result[0].passed_quality is False

    def test_filter_quality_good_face_passes(self):
        """B3f: Good quality face → passed_quality=True with score."""
        detector = FaceDetector.__new__(FaceDetector)
        detector._fr = MagicMock()

        # High-variance random noise image → high Laplacian variance
        image = np.random.randint(0, 255, (300, 300, 3), dtype=np.uint8)
        face = DetectedFace(
            index=0, location=(10, 210, 210, 10),  # 200x200 — big
            width=200, height=200,
        )

        result = detector.filter_quality(image, [face])
        assert result[0].passed_quality is True
        assert result[0].quality_score > 0

    def test_crop_face_with_padding(self):
        """B3g: Crop includes padding, respects image bounds."""
        detector = FaceDetector.__new__(FaceDetector)
        detector._fr = MagicMock()

        image = np.zeros((300, 300, 3), dtype=np.uint8)
        face = DetectedFace(
            index=0, location=(50, 150, 130, 50),  # 100x80 face
            width=100, height=80,
        )

        crop = detector.crop_face(image, face, padding=0.2)

        # Crop should be larger than original face due to padding
        assert crop.shape[0] >= 80  # height
        assert crop.shape[1] >= 100  # width
