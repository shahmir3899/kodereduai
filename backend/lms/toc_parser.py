"""
Utility to parse pasted table-of-contents text into chapters and topics.

Handles common TOC formats:
  - "1. Chapter title" or "Chapter 1: Title" for chapters
  - "  1.1 Topic title" or "    - Topic title" for topics

Also handles RTL text (Urdu/Arabic) — no special parsing needed,
just stores the Unicode strings as-is.
"""

import re

from .models import Chapter, Topic

# Topic.content_kind values accepted from TOC / apply_toc payloads (matches curriculum UI).
_APPLY_TOC_CONTENT_KINDS = frozenset({'general', 'exercise'})


def _coerce_page_int(value):
    """
    Return a positive integer suitable for page_start/page_end, or None.

    Ignores zero, negatives, and non-numeric values.
    """
    if value is None or value == '':
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        n = value
    elif isinstance(value, float) and value == int(value):
        n = int(value)
    else:
        try:
            n = int(str(value).strip())
        except (TypeError, ValueError):
            return None
    if n < 1:
        return None
    return n


def _normalize_page_range(page_start, page_end):
    """
    Return (page_start, page_end) with invalid pairs corrected.

    If both are set and start > end, values are swapped so data matches
    the same rule as ChapterCreateSerializer / TopicSerializer validation.
    """
    a = _coerce_page_int(page_start)
    b = _coerce_page_int(page_end)
    if a is not None and b is not None and a > b:
        return b, a
    return a, b


def _normalize_content_kind(value):
    """Map payload content_kind to a safe stored value (default general)."""
    if value is None or value == '':
        return 'general'
    key = str(value).strip().lower()
    if key in _APPLY_TOC_CONTENT_KINDS:
        return key
    return 'general'


# Patterns for chapter detection (non-indented lines with a leading number)
CHAPTER_PATTERN = re.compile(
    r'^(?:chapter\s+)?(\d+)[\.\:\)\-\s]+(.+)',
    re.IGNORECASE,
)

# Pattern for sub-numbered topics (e.g., "1.1 Topic title")
TOPIC_SUBNUMBER_PATTERN = re.compile(
    r'^\s+(\d+\.\d+)[\.\:\)\-\s]+(.+)',
)


def parse_toc_preview(toc_text):
    """
    Parse TOC text and return a structured preview without DB writes.

    Returns:
        dict: {
            chapters: [
                {
                    chapter_number: int,
                    title: str,
                    topics: [{topic_number: int, title: str}],
                }
            ],
            warnings: [str],
        }
    """
    lines = [line.rstrip() for line in toc_text.strip().split('\n') if line.strip()]

    chapters = []
    warnings = []
    current_chapter = None

    for line in lines:
        stripped = line.strip()
        is_indented = line != line.lstrip()
        ch_match = CHAPTER_PATTERN.match(stripped)

        if ch_match and not is_indented:
            title = ch_match.group(2).strip()
            if not title:
                warnings.append('Skipped an empty chapter title line.')
                current_chapter = None
                continue

            current_chapter = {
                'chapter_number': len(chapters) + 1,
                'title': title,
                'topics': [],
            }
            chapters.append(current_chapter)
            continue

        if current_chapter and is_indented:
            sub_match = TOPIC_SUBNUMBER_PATTERN.match(line)
            if sub_match:
                title = sub_match.group(2).strip()
            else:
                title = re.sub(r'^[-\*\u2022\u25CF\u25CB\u2023\u2043]\s*', '', stripped)

            if not title:
                warnings.append('Skipped an empty topic line.')
                continue

            current_chapter['topics'].append({
                'topic_number': len(current_chapter['topics']) + 1,
                'title': title,
            })
            continue

        if not is_indented and not ch_match:
            # Fallback: treat unknown top-level lines as chapter titles.
            current_chapter = {
                'chapter_number': len(chapters) + 1,
                'title': stripped,
                'topics': [],
            }
            chapters.append(current_chapter)
            warnings.append(
                f"Interpreted as chapter title: '{stripped[:60]}'"
            )
            continue

        warnings.append(
            f"Could not classify line: '{stripped[:60]}'"
        )

    return {
        'chapters': chapters,
        'warnings': warnings,
    }


def apply_toc_structure(book, chapters):
    """
    Create Chapter + Topic rows from a reviewed structured payload.

    Chapter/topic numbers are normalized sequentially to avoid collisions and
    keep ordering deterministic.

    For each chapter, optional ``page_start`` / ``page_end`` are persisted.
    For each topic, optional page range and ``content_kind`` (``general`` or
    ``exercise``) are persisted. Invalid page values are ignored; if both
    pages are set but ``page_start`` > ``page_end``, the pair is swapped.
    """
    chapters_created = 0
    topics_created = 0
    errors = []

    chapter_number = Chapter.objects.filter(book=book).count()

    for chapter_payload in chapters or []:
        title = (chapter_payload.get('title') or '').strip()
        if not title:
            errors.append('Skipped chapter with empty title.')
            continue

        chapter_number += 1
        ch_page_start, ch_page_end = _normalize_page_range(
            chapter_payload.get('page_start'),
            chapter_payload.get('page_end'),
        )
        try:
            chapter = Chapter.objects.create(
                book=book,
                chapter_number=chapter_number,
                title=title,
                page_start=ch_page_start,
                page_end=ch_page_end,
            )
            chapters_created += 1
        except Exception as e:
            errors.append(f"Chapter '{title}': {str(e)}")
            continue

        topic_number = 0
        for topic_payload in chapter_payload.get('topics', []):
            topic_title = (topic_payload.get('title') or '').strip()
            if not topic_title:
                continue
            topic_number += 1
            tp_page_start, tp_page_end = _normalize_page_range(
                topic_payload.get('page_start'),
                topic_payload.get('page_end'),
            )
            content_kind = _normalize_content_kind(topic_payload.get('content_kind'))
            try:
                Topic.objects.create(
                    chapter=chapter,
                    topic_number=topic_number,
                    title=topic_title,
                    page_start=tp_page_start,
                    page_end=tp_page_end,
                    content_kind=content_kind,
                )
                topics_created += 1
            except Exception as e:
                errors.append(f"Topic '{topic_title}': {str(e)}")

    return {
        'chapters_created': chapters_created,
        'topics_created': topics_created,
        'errors': errors,
    }


def parse_toc_text(toc_text, book):
    """
    Parse TOC text and create Chapter + Topic records for the given book.

    Accepts formats like:
        1. Introduction to Algebra
          1.1 Variables and Constants
          1.2 Algebraic Expressions
        2. Linear Equations
          2.1 One Variable
          2.2 Two Variables

    Or with bullets/dashes:
        1. Introduction
          - Variables
          - Constants

    Returns:
        dict: { chapters_created, topics_created, errors }
    """
    preview = parse_toc_preview(toc_text)
    result = apply_toc_structure(book, preview['chapters'])
    if preview['warnings']:
        result['warnings'] = preview['warnings']
    return result
