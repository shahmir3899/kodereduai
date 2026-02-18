"""
Face attendance pipeline orchestrator.

Coordinates the full flow: detect → filter → embed → match → score → store.
Also provides enrollment pipeline for single-student face enrollment.
"""

import io
import logging
import uuid

from django.conf import settings
from django.utils import timezone

from core.task_utils import update_task_progress
from face_attendance.models import (
    FaceAttendanceSession,
    FaceDetectionResult,
    StudentFaceEmbedding,
)

from .face_detector import FaceDetector, load_image_from_url, encode_face_crop_to_jpeg
from .embedding_service import EmbeddingService
from .matcher import FaceMatcher, HIGH_THRESHOLD, MEDIUM_THRESHOLD

logger = logging.getLogger(__name__)

FR_SETTINGS = getattr(settings, 'FACE_RECOGNITION_SETTINGS', {})
FACE_CROPS_FOLDER = FR_SETTINGS.get('FACE_CROPS_FOLDER', 'face-crops')


class FaceAttendancePipeline:
    """
    Main pipeline for processing a face attendance session.

    Stages:
    1. Load image from URL
    2. Detect faces + quality filter
    3. Generate embeddings
    4. Class-scoped matching
    5. Store results
    """

    def __init__(self, session_id, task_id=None):
        self.session_id = session_id
        self.task_id = task_id
        self.session = FaceAttendanceSession.objects.select_related(
            'class_obj', 'school'
        ).get(id=session_id)
        self.detector = FaceDetector()
        self.embedding_service = EmbeddingService()
        self.matcher = FaceMatcher()

    def _update_progress(self, stage, total=5):
        if self.task_id:
            update_task_progress(self.task_id, stage, total)

    def run(self):
        """
        Execute the full face attendance pipeline.

        Returns:
            dict with processing results
        """
        session = self.session

        try:
            # Stage 1: Load image
            self._update_progress(1)
            logger.info(f'[{session.id}] Stage 1: Loading image from {session.image_url}')
            image_array = load_image_from_url(session.image_url)

            # Stage 2: Detect faces + quality filter
            self._update_progress(2)
            logger.info(f'[{session.id}] Stage 2: Detecting faces')
            faces = self.detector.detect_faces(image_array)
            faces = self.detector.filter_quality(image_array, faces)
            quality_faces = [f for f in faces if f.passed_quality]

            logger.info(
                f'[{session.id}] Detected {len(faces)} faces, '
                f'{len(quality_faces)} passed quality filter'
            )

            if not quality_faces:
                session.status = FaceAttendanceSession.Status.FAILED
                session.error_message = (
                    f'No usable faces found. {len(faces)} faces detected but '
                    'all failed quality checks (too small or too blurry).'
                )
                session.total_faces_detected = len(faces)
                session.save()
                return {'success': False, 'error': session.error_message}

            # Stage 3: Generate embeddings
            self._update_progress(3)
            logger.info(f'[{session.id}] Stage 3: Generating embeddings')
            face_locations = [f.location for f in quality_faces]
            embeddings = self.embedding_service.generate_embeddings(
                image_array, face_locations
            )

            # Stage 4: Class-scoped matching
            self._update_progress(4)
            logger.info(f'[{session.id}] Stage 4: Matching against class embeddings')

            class_embeddings = self.embedding_service.get_class_embeddings(
                session.class_obj_id, session.school_id
            )

            # Get student names for labeling
            from students.models import Student
            student_names = dict(
                Student.objects.filter(
                    class_obj=session.class_obj, is_active=True
                ).values_list('id', 'name')
            )

            # Pair face_index with embedding for matching
            face_embedding_pairs = [
                (face.index, emb)
                for face, emb in zip(quality_faces, embeddings)
            ]

            match_results = self.matcher.match_faces(
                face_embedding_pairs, class_embeddings, student_names
            )

            # Stage 5: Store results
            self._update_progress(5)
            logger.info(f'[{session.id}] Stage 5: Storing results')

            matched_count = 0
            flagged_count = 0
            ignored_count = 0

            for face, emb, match in zip(quality_faces, embeddings, match_results):
                # Upload face crop to storage
                face_crop_url = self._upload_face_crop(
                    image_array, face, session
                )

                # Create detection result record
                FaceDetectionResult.objects.create(
                    session=session,
                    face_index=face.index,
                    bounding_box={
                        'top': face.location[0],
                        'right': face.location[1],
                        'bottom': face.location[2],
                        'left': face.location[3],
                    },
                    face_crop_url=face_crop_url,
                    quality_score=face.quality_score,
                    embedding=EmbeddingService.embedding_to_bytes(emb),
                    matched_student_id=match.student_id,
                    confidence=match.confidence,
                    match_status=match.match_status,
                    match_distance=match.distance if match.distance != float('inf') else None,
                    alternative_matches=match.alternatives,
                )

                if match.match_status == 'AUTO_MATCHED':
                    matched_count += 1
                elif match.match_status == 'FLAGGED':
                    flagged_count += 1
                else:
                    ignored_count += 1

            # Also create records for faces that failed quality (as IGNORED)
            for face in faces:
                if face.passed_quality:
                    continue
                face_crop_url = self._upload_face_crop(
                    image_array, face, session
                )
                FaceDetectionResult.objects.create(
                    session=session,
                    face_index=face.index,
                    bounding_box={
                        'top': face.location[0],
                        'right': face.location[1],
                        'bottom': face.location[2],
                        'left': face.location[3],
                    },
                    face_crop_url=face_crop_url,
                    quality_score=face.quality_score,
                    match_status=FaceDetectionResult.MatchStatus.IGNORED,
                    confidence=0,
                )
                ignored_count += 1

            # Update session
            session.total_faces_detected = len(faces)
            session.faces_matched = matched_count
            session.faces_flagged = flagged_count
            session.faces_ignored = ignored_count
            session.thresholds_used = {
                'high': HIGH_THRESHOLD,
                'medium': MEDIUM_THRESHOLD,
            }
            session.status = FaceAttendanceSession.Status.NEEDS_REVIEW
            session.save()

            result = {
                'success': True,
                'session_id': str(session.id),
                'total_faces': len(faces),
                'quality_faces': len(quality_faces),
                'matched': matched_count,
                'flagged': flagged_count,
                'ignored': ignored_count,
                'enrolled_students': len(class_embeddings),
            }
            logger.info(f'[{session.id}] Pipeline complete: {result}')
            return result

        except ValueError as e:
            # Expected errors (no faces, too many faces)
            session.status = FaceAttendanceSession.Status.FAILED
            session.error_message = str(e)
            session.save()
            logger.warning(f'[{session.id}] Pipeline validation error: {e}')
            return {'success': False, 'error': str(e)}

        except Exception as e:
            session.status = FaceAttendanceSession.Status.FAILED
            session.error_message = f'Processing error: {str(e)}'
            session.save()
            logger.exception(f'[{session.id}] Pipeline failed')
            raise

    def _upload_face_crop(self, image_array, face, session):
        """Upload a cropped face to Supabase storage. Returns URL or empty string."""
        try:
            from core.storage import storage_service
            if not storage_service.is_configured():
                return ''

            crop = self.detector.crop_face(image_array, face)
            jpeg_bytes = encode_face_crop_to_jpeg(crop)

            filename = f'{FACE_CROPS_FOLDER}/{session.school_id}/{session.id}/{face.index}.jpg'

            # Use Supabase client directly for bytes upload
            client = storage_service._get_client()
            bucket = getattr(settings, 'SUPABASE_BUCKET', 'atten-reg')
            result = client.storage.from_(bucket).upload(
                filename,
                jpeg_bytes,
                {'content-type': 'image/jpeg'},
            )

            public_url = client.storage.from_(bucket).get_public_url(filename)
            return public_url
        except Exception as e:
            logger.warning(f'Failed to upload face crop: {e}')
            return ''


class FaceEnrollmentPipeline:
    """
    Pipeline for enrolling a student's face.

    Takes a single-face photo, generates embedding, stores it.
    """

    def __init__(self, student_id, image_url, task_id=None):
        self.student_id = student_id
        self.image_url = image_url
        self.task_id = task_id
        self.detector = FaceDetector()
        self.embedding_service = EmbeddingService()

    def _update_progress(self, stage, total=3):
        if self.task_id:
            update_task_progress(self.task_id, stage, total)

    def run(self):
        """
        Execute face enrollment pipeline.

        Returns:
            dict with enrollment result
        """
        from students.models import Student

        student = Student.objects.select_related('school', 'class_obj').get(
            id=self.student_id
        )

        # Stage 1: Load image
        self._update_progress(1)
        logger.info(f'Enrolling face for student {student.name} (ID: {student.id})')
        image_array = load_image_from_url(self.image_url)

        # Stage 2: Detect single face + generate embedding
        self._update_progress(2)
        embedding, face_location = self.embedding_service.generate_single_embedding(
            image_array
        )

        # Calculate quality score
        top, right, bottom, left = face_location
        width = right - left
        height = bottom - top

        import cv2
        gray = cv2.cvtColor(image_array, cv2.COLOR_RGB2GRAY)
        face_region = gray[top:bottom, left:right]
        blur_score = cv2.Laplacian(face_region, cv2.CV_64F).var()

        size_score = min(1.0, (width * height) / (200 * 200))
        blur_norm = min(1.0, blur_score / 500.0)
        quality_score = round(0.4 * size_score + 0.6 * blur_norm, 3)

        # Stage 3: Store embedding
        self._update_progress(3)
        emb_record = self.embedding_service.store_embedding(
            student_id=student.id,
            school_id=student.school_id,
            embedding=embedding,
            source_image_url=self.image_url,
            quality_score=quality_score,
        )

        result = {
            'success': True,
            'student_id': student.id,
            'student_name': student.name,
            'embedding_id': emb_record.id,
            'quality_score': quality_score,
        }
        logger.info(f'Face enrolled for {student.name}: quality={quality_score}')
        return result
