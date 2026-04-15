"""
OCR utility for extracting Table of Contents text from book images.
Uses Google Cloud Vision DOCUMENT_TEXT_DETECTION with language hints.
"""

import logging
import base64
import json
import requests
from typing import Tuple, Optional

from django.conf import settings

logger = logging.getLogger(__name__)

# Map Book.language choices to Google Vision BCP-47 language hint codes
LANGUAGE_HINT_MAP = {
    'en': ['en'],
    'ur': ['ur'],
    'ar': ['ar'],
    'sd': ['sd'],
    'ps': ['ps'],
    'pa': ['pa'],
    'other': [],
}


def extract_toc_payload(image_bytes: bytes, language: str = 'en') -> Tuple[Optional[dict], Optional[str]]:
    """
    Run Google Vision OCR and return text with line metadata.

    Returns:
        (payload, error_message)
        payload shape: {
            "text": str,
            "lines": [{"id": str, "text": str, "line_number": int, "confidence": float}],
        }
    """
    api_key = getattr(settings, 'GOOGLE_VISION_API_KEY', None)
    credentials_path = getattr(settings, 'GOOGLE_APPLICATION_CREDENTIALS', None)

    if api_key:
        return _call_with_api_key(api_key, image_bytes, language)
    if credentials_path:
        return _call_with_service_account(image_bytes, language)

    return None, "Google Vision not configured. Set GOOGLE_VISION_API_KEY or GOOGLE_APPLICATION_CREDENTIALS in .env"


def extract_toc_text(image_bytes: bytes, language: str = 'en') -> Tuple[Optional[str], Optional[str]]:
    """
    Run Google Vision DOCUMENT_TEXT_DETECTION on an image and return the full text.

    Args:
        image_bytes: Raw image bytes (JPEG/PNG/WebP)
        language: Book language code from Book.language choices

    Returns:
        (extracted_text, error_message) — one will be None
    """
    payload, error = extract_toc_payload(image_bytes, language)
    if error:
        return None, error
    return payload.get('text', '') if payload else '', None


def _build_language_hints(language: str) -> list:
    """Build language hints list, always including English as fallback."""
    hints = list(LANGUAGE_HINT_MAP.get(language, []))
    if 'en' not in hints:
        hints.append('en')
    return hints


def _extract_text_from_response(result: dict) -> Tuple[Optional[str], Optional[str]]:
    """Extract full text from a Vision API response dict."""
    responses = result.get('responses', [])
    if not responses:
        return None, "No OCR response received."

    annotation = responses[0]
    if 'error' in annotation:
        return None, f"OCR error: {annotation['error'].get('message', 'Unknown')}"

    full_text = annotation.get('fullTextAnnotation', {}).get('text', '')
    if not full_text.strip():
        text_annotations = annotation.get('textAnnotations', [])
        if text_annotations:
            full_text = text_annotations[0].get('description', '')

    if not full_text.strip():
        return None, "No text detected in the image. Please ensure the image is clear and well-lit."

    return full_text.strip(), None


def _build_lines_from_text(full_text: str, confidence: float = 0.0) -> list:
    """Build a normalized line list from OCR text for line-level UI mapping."""
    lines = []
    for idx, raw_line in enumerate((full_text or '').splitlines(), start=1):
        line_text = (raw_line or '').strip()
        if not line_text:
            continue
        lines.append({
            'id': f'line-{idx}',
            'line_number': idx,
            'text': line_text,
            'confidence': confidence,
        })
    return lines


def _call_with_api_key(api_key: str, image_bytes: bytes, language: str) -> Tuple[Optional[dict], Optional[str]]:
    """Call Vision API using API key."""
    url = f"https://vision.googleapis.com/v1/images:annotate?key={api_key}"
    image_base64 = base64.b64encode(image_bytes).decode('utf-8')

    payload = {
        "requests": [{
            "image": {"content": image_base64},
            "features": [{"type": "DOCUMENT_TEXT_DETECTION"}],
            "imageContext": {
                "languageHints": _build_language_hints(language),
            },
        }]
    }

    try:
        logger.info(f"[TOC-OCR] Calling Google Vision API (language={language})...")
        response = requests.post(url, json=payload, timeout=60)

        try:
            result = response.json()
        except Exception:
            return None, "Failed to parse Vision API response."

        if response.status_code != 200:
            error_info = result.get('error', {})
            error_message = error_info.get('message', response.text[:500])
            logger.error(f"[TOC-OCR] Vision API error: {error_message}")
            return None, f"OCR failed: {error_message}"

        full_text, error = _extract_text_from_response(result)
        if error:
            return None, error

        payload = {
            'text': full_text,
            'lines': _build_lines_from_text(full_text, confidence=0.0),
        }
        return payload, None

    except requests.Timeout:
        logger.error("[TOC-OCR] Vision API timed out")
        return None, "OCR request timed out. Please try again."
    except requests.RequestException as e:
        logger.error(f"[TOC-OCR] Vision API request failed: {e}")
        return None, f"OCR request failed: {str(e)}"


def _call_with_service_account(image_bytes: bytes, language: str) -> Tuple[Optional[dict], Optional[str]]:
    """Call Vision API using service account credentials."""
    try:
        from google.cloud import vision
        from google.oauth2 import service_account

        credentials = service_account.Credentials.from_service_account_file(
            settings.GOOGLE_APPLICATION_CREDENTIALS
        )
        client = vision.ImageAnnotatorClient(credentials=credentials)
        image = vision.Image(content=image_bytes)

        hints = _build_language_hints(language)
        context = vision.ImageContext(language_hints=hints)

        logger.info(f"[TOC-OCR] Calling Vision API via service account (language={language})...")
        response = client.document_text_detection(image=image, image_context=context)

        if response.error.message:
            return None, f"OCR error: {response.error.message}"

        full_text = response.full_text_annotation.text if response.full_text_annotation else ''
        if not full_text.strip():
            return None, "No text detected in the image. Please ensure the image is clear and well-lit."

        confidence = 0.0
        try:
            pages = response.full_text_annotation.pages if response.full_text_annotation else []
            page_confidences = [float(getattr(page, 'confidence', 0.0)) for page in pages]
            if page_confidences:
                confidence = sum(page_confidences) / len(page_confidences)
        except Exception:
            confidence = 0.0

        payload = {
            'text': full_text.strip(),
            'lines': _build_lines_from_text(full_text.strip(), confidence=confidence),
        }
        return payload, None

    except ImportError:
        return None, "google-cloud-vision package not installed for service account auth."
    except Exception as e:
        logger.error(f"[TOC-OCR] Service account call failed: {e}")
        return None, f"OCR failed: {str(e)}"
