"""
Face embedding generation and storage service.

Generates 128-dimensional embeddings using face_recognition (dlib) and
stores them both as legacy binary (embedding) and as a pgvector column
(embedding_vector, used for matching) in the database.
"""

import logging

import numpy as np
from django.conf import settings

from face_attendance.models import StudentFaceEmbedding

logger = logging.getLogger(__name__)

FR_SETTINGS = getattr(settings, 'FACE_RECOGNITION_SETTINGS', {})
NUM_JITTERS = FR_SETTINGS.get('NUM_JITTERS', 1)
EMBEDDING_VERSION = FR_SETTINGS.get('EMBEDDING_MODEL', 'dlib_v1')


class EmbeddingService:
    """Generates and manages face embeddings."""

    def __init__(self):
        import face_recognition
        self._fr = face_recognition

    def generate_embeddings(self, image_array, face_locations):
        """
        Generate 128-d embeddings for detected faces.

        Args:
            image_array: numpy array (RGB) of the full image
            face_locations: list of (top, right, bottom, left) tuples

        Returns:
            list[numpy.ndarray]: 128-d float64 embeddings (one per face)
        """
        encodings = self._fr.face_encodings(
            image_array,
            known_face_locations=face_locations,
            num_jitters=NUM_JITTERS,
        )
        return encodings

    def generate_single_embedding(self, image_array):
        """
        Generate embedding for a single-face image (enrollment).

        Args:
            image_array: numpy array (RGB) with exactly one face

        Returns:
            numpy.ndarray: 128-d float64 embedding

        Raises:
            ValueError: If not exactly one face found
        """
        face_locations = self._fr.face_locations(image_array, model='hog')

        if len(face_locations) == 0:
            raise ValueError(
                'No face detected in the enrollment image. '
                'Please ensure the photo shows one clear front-facing face with good lighting, '
                'no blur, and retry with a clearer portrait photo.'
            )
        if len(face_locations) > 1:
            raise ValueError(
                f'Multiple faces detected ({len(face_locations)}). '
                'Enrollment requires exactly one face per photo. '
                'Please retry with a photo containing only the student.'
            )

        encodings = self._fr.face_encodings(
            image_array,
            known_face_locations=face_locations,
            num_jitters=NUM_JITTERS,
        )
        return encodings[0], face_locations[0]

    @staticmethod
    def embedding_to_bytes(embedding):
        """Convert numpy embedding to bytes for storage."""
        return embedding.astype(np.float64).tobytes()

    def store_embedding(self, student_id, school_id, embedding, source_image_url='',
                        quality_score=0.0):
        """
        Store a face embedding in the database.

        Args:
            student_id: Student PK
            school_id: School PK
            embedding: numpy.ndarray (128-d)
            source_image_url: URL of the source photo
            quality_score: Face quality score 0-1

        Returns:
            StudentFaceEmbedding instance
        """
        vector = embedding.astype(np.float32).tolist()
        return StudentFaceEmbedding.objects.create(
            student_id=student_id,
            school_id=school_id,
            embedding=self.embedding_to_bytes(embedding),
            embedding_vector=vector,
            embedding_version=EMBEDDING_VERSION,
            source_image_url=source_image_url,
            quality_score=quality_score,
        )

    @staticmethod
    def store_client_embedding(student_id, school_id, embedding, embedding_version,
                                quality_score=0.0, source_image_url=''):
        """
        Store an embedding that was already extracted client-side (Live
        Mobile guided enrollment — face-api.js runs in the browser, see
        design doc §5). Unlike store_embedding(), this never touches face_recognition,
        so it doesn't require dlib to be installed or an EmbeddingService
        instance (which imports it in __init__).
        """
        vector = np.asarray(embedding, dtype=np.float64)
        return StudentFaceEmbedding.objects.create(
            student_id=student_id,
            school_id=school_id,
            embedding=EmbeddingService.embedding_to_bytes(vector),
            embedding_vector=vector.astype(np.float32).tolist(),
            embedding_version=embedding_version,
            source_image_url=source_image_url,
            quality_score=quality_score,
        )

    @staticmethod
    def _active_embedded_student_ids(student_ids, school_id, embedding_version):
        """Of the given student IDs, return those with an active embedding for this version."""
        if not student_ids:
            return set()
        return set(
            StudentFaceEmbedding.objects.filter(
                student_id__in=student_ids,
                school_id=school_id,
                is_active=True,
                embedding_version=embedding_version,
            ).values_list('student_id', flat=True)
        )

    @staticmethod
    def get_class_student_ids(class_obj_id, school_id, embedding_version=None):
        """
        Return the set of student IDs in this class that have an active
        embedding for the given version, ready to hand to FaceMatcher.

        This is class-scoped — NEVER includes students from other classes.
        Used by Group Photo matching and CLASS-scoped Fixed Camera devices.
        Does not need face_recognition, so it's callable without
        instantiating EmbeddingService (e.g. from the lightweight Fixed
        Camera endpoint).
        """
        from students.models import Student

        version = embedding_version or EMBEDDING_VERSION
        class_student_ids = set(
            Student.objects.filter(
                class_obj_id=class_obj_id,
                school_id=school_id,
                is_active=True,
            ).values_list('id', flat=True)
        )
        return EmbeddingService._active_embedded_student_ids(class_student_ids, school_id, version)

    @staticmethod
    def get_school_student_ids(school_id, embedding_version=None):
        """
        Return the set of student IDs anywhere in the school that have an
        active embedding for the given version, ready to hand to
        FaceMatcher. Used by SCHOOL-scoped Fixed Camera devices (e.g. an
        entrance camera) — NOT class-scoped.
        """
        from students.models import Student

        version = embedding_version or EMBEDDING_VERSION
        school_student_ids = set(
            Student.objects.filter(
                school_id=school_id,
                is_active=True,
            ).values_list('id', flat=True)
        )
        return EmbeddingService._active_embedded_student_ids(school_student_ids, school_id, version)
