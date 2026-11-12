"""Glue between paper_layout (pure geometry) and the OCR pipeline: which languages to tell Vision about, which
way the paper reads, and turning the LLM's line references into photo boxes, "check digits" notes and
cropped figures.
"""
import io
import logging
import re
import uuid
from typing import Any, Dict, List, Optional

import requests

from . import paper_layout

logger = logging.getLogger(__name__)

# Subject name/code words -> language, for schools that have no curriculum book recorded for the subject.
_SUBJECT_LANGUAGE_WORDS = (
    ('urdu', 'ur'), ('arabic', 'ar'), ('sindhi', 'sd'), ('pashto', 'ps'), ('punjabi', 'pa'),
    ('islamiyat', 'ur'), ('islamic', 'ur'), ('quran', 'ar'), ('nazra', 'ar'), ('deeniyat', 'ur'),
)
_ARABIC_SCRIPT = re.compile(r'[؀-ۿݐ-ݿ]')
_LETTER = re.compile(r'[^\W\d_]', re.UNICODE)


def subject_language(context: Optional[Dict[str, Any]]) -> Optional[str]:
    """Language code of the paper's subject: the curriculum book recorded for that class and subject first,
    then words in the subject's name or code. None when nothing says (then English only)."""
    context = context or {}
    subject_id, school_id = context.get('subject_id'), context.get('school_id')
    if subject_id and school_id:
        try:
            from lms.models import Book
            books = Book.objects.filter(school_id=school_id, subject_id=subject_id, is_active=True)
            if context.get('class_id'):
                scoped = books.filter(class_obj_id=context['class_id'])
                books = scoped if scoped.exists() else books
            languages = [lang for lang in books.values_list('language', flat=True) if lang and lang != 'other']
            if languages:
                return max(set(languages), key=languages.count)
        except Exception:
            # Hints are an improvement, never a reason to fail a read.
            logger.warning('Could not look up the subject language', exc_info=True)
    name = f"{context.get('subject_name') or ''} {context.get('subject_code') or ''}".lower()
    for word, code in _SUBJECT_LANGUAGE_WORDS:
        if word in name:
            return code
    return None


def vision_language_hints(context: Optional[Dict[str, Any]]) -> List[str]:
    """Language hints for Vision; English is always included, as for TOC OCR."""
    from lms.toc_ocr import _build_language_hints
    return _build_language_hints(subject_language(context) or 'en')


def detect_direction(vision_response: Dict[str, Any]) -> str:
    """'rtl' when most of the letters Vision read are Arabic-script (Urdu, Arabic, Sindhi, Pashto), else 'ltr'.
    Judged from the page itself, so an Islamiyat paper written in English is not flipped."""
    text = (vision_response.get('fullTextAnnotation') or {}).get('text') or ''
    letters = _LETTER.findall(text)
    if not letters:
        return 'ltr'
    arabic = sum(1 for ch in letters if _ARABIC_SCRIPT.match(ch))
    return 'rtl' if arabic / len(letters) > 0.5 else 'ltr'


def _question_lines(question: Dict[str, Any]) -> Optional[tuple]:
    lines = question.get('lines')
    if (
        isinstance(lines, (list, tuple)) and len(lines) == 2
        and all(isinstance(n, int) and not isinstance(n, bool) for n in lines)
    ):
        first, last = sorted(lines)
        return first, last
    return None


def attach_layout(parsed: Dict[str, Any], layout: paper_layout.Layout, image_url: str, school_id: Optional[int]) -> None:
    """Adds ``box`` (where the question is on the photo), ``uncertain`` (digits Vision was unsure of) and, for
    drawings, ``figure_url``/``question_image_url`` to each question in ``parsed['sections']``, in place."""
    questions = [q for section in parsed.get('sections', []) for q in section.get('questions', [])]
    claimed_figures: Dict[str, Dict[str, Any]] = {}

    for question in questions:
        span = _question_lines(question)
        if span is None:
            continue
        first, last = span
        box = paper_layout.box_for_lines(layout, first, last)
        if box:
            question['box'] = box
        notes = paper_layout.uncertain_notes(layout, first, last)
        if notes:
            question['uncertain'] = notes
        wanted = question.get('figure')
        figure = next((f for f in layout.figures if f.id == wanted), None) if wanted else None
        if figure is None:
            figure = paper_layout.figure_after_line(layout, last)
        if figure is not None and figure.id not in claimed_figures:
            claimed_figures[figure.id] = question

    if not claimed_figures:
        return
    image = _download_image(image_url)
    if image is None:
        return
    for figure_id, question in claimed_figures.items():
        figure = next(f for f in layout.figures if f.id == figure_id)
        url = _crop_and_store(image, figure.box, school_id)
        if url:
            question['figure_url'] = url
            question['question_image_url'] = url


def _download_image(image_url: str):
    try:
        from PIL import Image
        response = requests.get(image_url, timeout=30)
        response.raise_for_status()
        image = Image.open(io.BytesIO(response.content))
        image.load()
        return image
    except Exception:
        logger.warning('Could not download the page photo to crop figures', exc_info=True)
        return None


class _UploadBuffer(io.BytesIO):
    content_type = 'image/jpeg'


def _crop_and_store(image, box: Dict[str, float], school_id: Optional[int]) -> Optional[str]:
    try:
        from core.storage import SupabaseStorageService
        width, height = image.size
        left, right = int(box['x0'] * width), int(box['x1'] * width)
        top, bottom = int(box['y0'] * height), int(box['y1'] * height)
        if right - left < 40 or bottom - top < 40:
            return None
        crop = image.crop((left, top, right, bottom)).convert('RGB')
        buffer = _UploadBuffer()
        crop.save(buffer, format='JPEG', quality=80, optimize=True)
        buffer.seek(0)
        return SupabaseStorageService().upload_file(
            file=buffer, folder=f'papers/{school_id or 0}/figures', filename=f'fig_{uuid.uuid4().hex}.jpg',
        )
    except Exception:
        logger.warning('Could not crop or store a figure', exc_info=True)
        return None
