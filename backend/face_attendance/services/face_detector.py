"""
Face detection and quality filtering service.

Detects faces in images, filters by quality (size, blur),
and returns face locations with quality scores.
"""

import io
import logging

import cv2
import numpy as np
import requests
from django.conf import settings

logger = logging.getLogger(__name__)

FR_SETTINGS = getattr(settings, 'FACE_RECOGNITION_SETTINGS', {})
MAX_FACES = FR_SETTINGS.get('MAX_FACES_PER_IMAGE', 15)
MIN_FACE_SIZE = FR_SETTINGS.get('MIN_FACE_SIZE', 60)
MIN_BLUR_SCORE = FR_SETTINGS.get('MIN_BLUR_SCORE', 50.0)


class DetectedFace:
    """Represents a single detected face with quality metrics."""

    __slots__ = ('index', 'location', 'quality_score', 'width', 'height',
                 'blur_score', 'passed_quality')

    def __init__(self, index, location, quality_score=0.0, width=0, height=0,
                 blur_score=0.0, passed_quality=True):
        self.index = index
        self.location = location  # (top, right, bottom, left)
        self.quality_score = quality_score
        self.width = width
        self.height = height
        self.blur_score = blur_score
        self.passed_quality = passed_quality


class FaceDetector:
    """Detects faces in images and filters by quality."""

    def __init__(self):
        import face_recognition
        self._fr = face_recognition

    def detect_faces(self, image_array):
        """
        Detect all faces in an image.

        Args:
            image_array: numpy array (RGB format) of the image

        Returns:
            list[DetectedFace]: Detected faces with locations

        Raises:
            ValueError: If too many or zero faces detected
        """
        # Detect face locations using HOG model (faster, CPU-friendly)
        face_locations = self._fr.face_locations(image_array, model='hog')

        if len(face_locations) == 0:
            raise ValueError('No faces detected in the image.')

        if len(face_locations) > MAX_FACES:
            raise ValueError(
                f'Too many faces detected ({len(face_locations)}). '
                f'Maximum allowed: {MAX_FACES}.'
            )

        faces = []
        for i, location in enumerate(face_locations):
            top, right, bottom, left = location
            width = right - left
            height = bottom - top
            faces.append(DetectedFace(
                index=i,
                location=location,
                width=width,
                height=height,
            ))

        return faces

    def filter_quality(self, image_array, faces):
        """
        Apply quality filters to detected faces.

        Checks:
        - Minimum face size (width and height >= MIN_FACE_SIZE)
        - Blur detection (Laplacian variance > MIN_BLUR_SCORE)

        Args:
            image_array: numpy array (RGB) of the image
            faces: list[DetectedFace] from detect_faces

        Returns:
            list[DetectedFace]: Faces with quality scores set
        """
        # Convert to grayscale for blur detection
        gray = cv2.cvtColor(image_array, cv2.COLOR_RGB2GRAY)

        for face in faces:
            top, right, bottom, left = face.location

            # Size check
            if face.width < MIN_FACE_SIZE or face.height < MIN_FACE_SIZE:
                face.passed_quality = False
                face.quality_score = 0.1
                continue

            # Extract face region for blur check
            face_region = gray[top:bottom, left:right]
            if face_region.size == 0:
                face.passed_quality = False
                face.quality_score = 0.0
                continue

            # Blur detection via Laplacian variance
            blur_score = cv2.Laplacian(face_region, cv2.CV_64F).var()
            face.blur_score = blur_score

            if blur_score < MIN_BLUR_SCORE:
                face.passed_quality = False
                face.quality_score = 0.2
                continue

            # Calculate quality score (0-1)
            # Based on: size (larger is better) + sharpness (higher is better)
            size_score = min(1.0, (face.width * face.height) / (200 * 200))
            blur_norm = min(1.0, blur_score / 500.0)
            face.quality_score = round(0.4 * size_score + 0.6 * blur_norm, 3)
            face.passed_quality = True

        return faces

    def crop_face(self, image_array, face, padding=0.2):
        """
        Crop a face from the image with padding.

        Args:
            image_array: numpy array (RGB)
            face: DetectedFace
            padding: Fraction of face size to add as padding

        Returns:
            numpy array of the cropped face (RGB)
        """
        top, right, bottom, left = face.location
        h, w = image_array.shape[:2]
        pad_h = int((bottom - top) * padding)
        pad_w = int((right - left) * padding)

        crop_top = max(0, top - pad_h)
        crop_bottom = min(h, bottom + pad_h)
        crop_left = max(0, left - pad_w)
        crop_right = min(w, right + pad_w)

        return image_array[crop_top:crop_bottom, crop_left:crop_right]


def load_image_from_url(url):
    """
    Download an image from URL and return as numpy array (RGB).

    Args:
        url: Public image URL (Supabase)

    Returns:
        numpy array in RGB format
    """
    response = requests.get(url, timeout=30)
    response.raise_for_status()

    image_bytes = np.frombuffer(response.content, dtype=np.uint8)
    image_bgr = cv2.imdecode(image_bytes, cv2.IMREAD_COLOR)

    if image_bgr is None:
        raise ValueError(f'Could not decode image from URL: {url}')

    # Convert BGR (OpenCV) to RGB (face_recognition)
    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    return image_rgb


def encode_face_crop_to_jpeg(face_crop_rgb):
    """
    Encode a face crop (RGB numpy array) to JPEG bytes.

    Args:
        face_crop_rgb: numpy array in RGB

    Returns:
        bytes: JPEG-encoded image
    """
    face_bgr = cv2.cvtColor(face_crop_rgb, cv2.COLOR_RGB2BGR)
    _, buffer = cv2.imencode('.jpg', face_bgr, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return buffer.tobytes()
