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


# Patterns for chapter detection (non-indented lines with a leading number)
CHAPTER_PATTERN = re.compile(
    r'^(?:chapter\s+)?(\d+)[\.\:\)\-\s]+(.+)',
    re.IGNORECASE,
)

# Pattern for sub-numbered topics (e.g., "1.1 Topic title")
TOPIC_SUBNUMBER_PATTERN = re.compile(
    r'^\s+(\d+\.\d+)[\.\:\)\-\s]+(.+)',
)


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
    lines = [line.rstrip() for line in toc_text.strip().split('\n') if line.strip()]

    chapters_created = 0
    topics_created = 0
    errors = []
    current_chapter = None

    # Start chapter numbering after existing chapters in this book
    max_chapter = Chapter.objects.filter(book=book).count()
    chapter_number = max_chapter
    topic_number = 0

    for line in lines:
        stripped = line.strip()
        is_indented = line != line.lstrip()

        # Try matching as a chapter (non-indented, starts with a number)
        ch_match = CHAPTER_PATTERN.match(stripped)

        if ch_match and not is_indented:
            # It's a chapter line
            chapter_number += 1
            title = ch_match.group(2).strip()
            try:
                current_chapter = Chapter.objects.create(
                    book=book,
                    chapter_number=chapter_number,
                    title=title,
                )
                chapters_created += 1
                topic_number = 0
            except Exception as e:
                errors.append(f"Chapter '{title}': {str(e)}")

        elif current_chapter and is_indented:
            # It's a topic line (indented under current chapter)
            topic_number += 1

            # Try to extract title from sub-number format
            sub_match = TOPIC_SUBNUMBER_PATTERN.match(line)
            if sub_match:
                title = sub_match.group(2).strip()
            else:
                title = stripped
                # Remove leading bullets/dashes
                title = re.sub(r'^[-\*\u2022\u25CF\u25CB\u2023\u2043]\s*', '', title)

            if not title:
                continue

            try:
                Topic.objects.create(
                    chapter=current_chapter,
                    topic_number=topic_number,
                    title=title,
                )
                topics_created += 1
            except Exception as e:
                errors.append(f"Topic '{title}': {str(e)}")

        elif not is_indented and not ch_match:
            # Non-indented line that doesn't match chapter pattern —
            # treat as a chapter with no number prefix
            chapter_number += 1
            try:
                current_chapter = Chapter.objects.create(
                    book=book,
                    chapter_number=chapter_number,
                    title=stripped,
                )
                chapters_created += 1
                topic_number = 0
            except Exception as e:
                errors.append(f"Line '{stripped}': {str(e)}")

    return {
        'chapters_created': chapters_created,
        'topics_created': topics_created,
        'errors': errors,
    }
