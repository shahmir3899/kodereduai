"""
Face embedding generation and storage service.

Generates 128-dimensional embeddings using face_recognition (dlib)
and stores/retrieves them as binary in the database.
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
            raise ValueError('No face detected in the enrollment image.')
        if len(face_locations) > 1:
            raise ValueError(
                f'Multiple faces detected ({len(face_locations)}). '
                'Enrollment requires exactly one face.'
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

    @staticmethod
    def bytes_to_embedding(data):
        """Convert stored bytes back to numpy embedding."""
        return np.frombuffer(data, dtype=np.float64)

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
        return StudentFaceEmbedding.objects.create(
            student_id=student_id,
            school_id=school_id,
            embedding=self.embedding_to_bytes(embedding),
            embedding_version=EMBEDDING_VERSION,
            source_image_url=source_image_url,
            quality_score=quality_score,
        )

    def get_class_embeddings(self, class_obj_id, school_id):
        """
        Load all active face embeddings for a class.

        Returns a dict: {student_id: [numpy embeddings]}
        This is class-scoped — NEVER loads embeddings from other classes.
        """
        from students.models import Student

        # Get student IDs in this class
        class_student_ids = set(
            Student.objects.filter(
                class_obj_id=class_obj_id,
                school_id=school_id,
                is_active=True,
            ).values_list('id', flat=True)
        )

        if not class_student_ids:
            return {}

        # Load embeddings only for these students
        embeddings_qs = StudentFaceEmbedding.objects.filter(
            student_id__in=class_student_ids,
            school_id=school_id,
            is_active=True,
        ).values_list('student_id', 'embedding')

        # Group by student
        student_embeddings = {}
        for student_id, emb_bytes in embeddings_qs:
            emb = self.bytes_to_embedding(bytes(emb_bytes))
            if student_id not in student_embeddings:
                student_embeddings[student_id] = []
            student_embeddings[student_id].append(emb)

        return student_embeddings
