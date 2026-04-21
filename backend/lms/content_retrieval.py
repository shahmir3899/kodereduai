"""
Phase 6 — AI Retrieval Pipeline
================================
Utilities for:
  1. Flat-text extraction from content_blocks (any block type → plain string)
  2. Topic retrieval with content_kind / page-range filters
  3. Prompt contracts for lesson-plan and exam modes
"""

import logging

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 1. Flat-text extractor
# ---------------------------------------------------------------------------

# Block types that carry renderable text
_TEXT_FIELDS_BY_TYPE = {
    'paragraph': ['text'],
    'heading':   ['text'],
    'exercise':  ['question', 'text', 'answer'],
    'code':      ['code', 'text'],
    'list':      ['items'],        # items is a list of strings
    'table':     ['caption', 'rows'],  # rows is list-of-lists
    'image':     ['caption', 'alt'],
    'note':      ['text'],
    'quote':     ['text', 'attribution'],
}


def extract_text_from_blocks(content_blocks):
    """
    Flatten a list of content_blocks into a single plain-text string.

    Each block is a dict with at minimum a 'type' key.  Handles all known
    block types; unknown types fall back to dumping every string value found
    in the block dict.

    Returns:
        str — newline-separated text, empty string when blocks is empty/None.
    """
    if not content_blocks:
        return ''

    parts = []

    for block in content_blocks:
        if not isinstance(block, dict):
            continue
        block_type = block.get('type', 'unknown')
        fields = _TEXT_FIELDS_BY_TYPE.get(block_type)

        if fields:
            for field in fields:
                value = block.get(field)
                if value is None:
                    continue
                if isinstance(value, str):
                    text = value.strip()
                    if text:
                        parts.append(text)
                elif isinstance(value, list):
                    # list items or table rows
                    for item in value:
                        if isinstance(item, str) and item.strip():
                            parts.append(item.strip())
                        elif isinstance(item, list):
                            # table row (list of cell strings)
                            row_text = ' | '.join(
                                str(cell).strip() for cell in item if str(cell).strip()
                            )
                            if row_text:
                                parts.append(row_text)
        else:
            # Unknown block type: emit any string values found
            for v in block.values():
                if isinstance(v, str) and v.strip():
                    parts.append(v.strip())

    return '\n'.join(parts)


# ---------------------------------------------------------------------------
# 2. Topic retrieval with filtering
# ---------------------------------------------------------------------------

def retrieve_topics_for_ai(book, content_kind=None, page_start=None, page_end=None):
    """
    Return a list of structured dicts for topics in *book*, optionally
    filtered by content_kind and page overlap.

    Each dict:
    {
        'chapter_number': int,
        'chapter_title':  str,
        'topic_number':   int,
        'topic_title':    str,
        'content_kind':   str,
        'page_start':     int | None,
        'page_end':       int | None,
        'flat_text':      str,   # from content_blocks or description fallback
    }

    Filter semantics:
      - content_kind: exact match on topic.content_kind
      - page_start / page_end: keep topics whose page range overlaps with the
        requested range (inclusive); topics with no page data are always kept.
    """
    qs = (
        book.chapters
        .filter(is_active=True)
        .prefetch_related('topics')
        .order_by('chapter_number')
    )

    results = []

    for chapter in qs:
        topic_qs = chapter.topics.filter(is_active=True).order_by('topic_number')

        if content_kind:
            topic_qs = topic_qs.filter(content_kind=content_kind)

        for topic in topic_qs:
            # Page-range overlap filter (skip if no page data on topic)
            if page_start is not None or page_end is not None:
                t_start = topic.page_start
                t_end = topic.page_end
                if t_start is not None and t_end is not None:
                    req_start = page_start or 1
                    req_end = page_end or 999999
                    # No overlap → skip
                    if t_end < req_start or t_start > req_end:
                        continue

            # Flat text: prefer content_blocks, fall back to description
            if topic.content_blocks:
                flat = extract_text_from_blocks(topic.content_blocks)
            else:
                flat = topic.description or ''

            results.append({
                'chapter_number': chapter.chapter_number,
                'chapter_title': chapter.title,
                'topic_number': topic.topic_number,
                'topic_title': topic.title,
                'content_kind': topic.content_kind,
                'page_start': topic.page_start,
                'page_end': topic.page_end,
                'flat_text': flat,
            })

    return results


# ---------------------------------------------------------------------------
# 3. Prompt contracts
# ---------------------------------------------------------------------------

LESSON_PLAN_RETRIEVAL_PROMPT = """\
You are an expert school teacher creating a detailed lesson plan.

## Context
School: {school_name}
Class: {class_name}
Subject: {subject_name}
Book: {book_title}
Language: {language}
Date: {lesson_date}
Duration: {duration} minutes

## Topics to Cover
{topics_section}

## Instructions
Generate a detailed lesson plan with the following sections:
1. **Title**: A clear, descriptive title for this lesson
2. **Objectives**: 3-5 specific learning objectives (what students will be able to do)
3. **Description**: A brief overview of the lesson (2-3 sentences)
4. **Teaching Methods**: Step-by-step teaching approach with time allocations
5. **Materials Needed**: Required materials and resources

{language_instruction}

## Output Format (JSON only, no markdown fences)
{{
  "title": "Lesson title",
  "objectives": "Bullet-pointed learning objectives",
  "description": "Brief lesson overview",
  "teaching_methods": "Step-by-step teaching approach with time breakdown",
  "materials_needed": "List of materials and resources"
}}"""


EXAM_QUESTIONS_PROMPT = """\
You are an expert examiner creating exam questions from curriculum content.

## Context
School: {school_name}
Class: {class_name}
Subject: {subject_name}
Book: {book_title}
Language: {language}

## Exercise Topics and Content
{topics_section}

## Instructions
Based on the exercise topics above, generate a set of exam questions.
For each question provide:
- A clear question statement
- The mark allocation
- A model answer / marking scheme

{language_instruction}

## Output Format (JSON only, no markdown fences)
{{
  "title": "Exam / Test title",
  "total_marks": <integer>,
  "questions": [
    {{
      "number": 1,
      "question": "Question text",
      "marks": <integer>,
      "answer": "Model answer / marking scheme"
    }}
  ]
}}"""


def build_topics_section(topic_dicts):
    """
    Format a list of topic dicts (from retrieve_topics_for_ai) into a
    prompt-friendly text block.
    """
    if not topic_dicts:
        return 'No specific topics selected.'

    lines = []
    for t in topic_dicts:
        page_info = ''
        if t['page_start'] and t['page_end']:
            page_info = f" (pp. {t['page_start']}–{t['page_end']})"
        elif t['page_start']:
            page_info = f" (from p. {t['page_start']})"

        header = (
            f"Ch {t['chapter_number']} – {t['chapter_title']} / "
            f"Topic {t['topic_number']}: {t['topic_title']}{page_info}"
        )
        lines.append(header)
        if t['flat_text']:
            # Indent content under header, cap at 800 chars to keep prompt size manageable
            content = t['flat_text'][:800]
            if len(t['flat_text']) > 800:
                content += ' ...[truncated]'
            for content_line in content.split('\n'):
                if content_line.strip():
                    lines.append(f"  {content_line.strip()}")
        lines.append('')  # blank line between topics

    return '\n'.join(lines).strip()


def build_prompt(mode, school, class_obj, subject, book, topic_dicts,
                 lesson_date=None, duration_minutes=45, language_instruction=''):
    """
    Render the correct prompt template for *mode* ('lesson_plan' or 'exam').

    Returns the prompt string.
    """
    topics_section = build_topics_section(topic_dicts)
    lang_display = book.get_language_display() if book else 'English'

    common = dict(
        school_name=school.name,
        class_name=class_obj.name,
        subject_name=subject.name,
        book_title=book.title if book else 'N/A',
        language=lang_display,
        topics_section=topics_section,
        language_instruction=language_instruction,
    )

    if mode == 'exam':
        return EXAM_QUESTIONS_PROMPT.format(**common)
    else:
        return LESSON_PLAN_RETRIEVAL_PROMPT.format(
            lesson_date=lesson_date or 'N/A',
            duration=duration_minutes,
            **common,
        )
