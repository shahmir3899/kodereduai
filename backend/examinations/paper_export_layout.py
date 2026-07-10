"""
Shared layout-plan builder for exam paper exports (DOCX + PDF).

Both `ExamPaperDOCXGenerator` and `ExamPaperPDFGenerator` call
`build_export_layout(exam_paper)` so the "classic school paper" formatting (header
block, section headings with marks, per-type question rendering, answer lines,
deterministic matching-table shuffle) is defined exactly once and stays identical
between the two export formats.

Returns None for legacy papers (empty `structure`) -- callers must fall back to
their existing flat, unstructured rendering unchanged so those exports keep
looking exactly as they did before structure/render_options existed.
"""

import random
import re
from decimal import Decimal, InvalidOperation

QUESTION_TYPES_WITH_ANSWER_LINES = {'SHORT', 'LONG', 'ESSAY'}
ANSWER_LINE_COUNTS = {'SHORT': 3, 'LONG': 6, 'ESSAY': 6}
BLANK_MARKER_RE = re.compile(r'_{2,}')
BLANK_FILL = '__________'


def _to_decimal(value, default='0'):
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal(default)


def _exam_name(exam_paper):
    if exam_paper.exam:
        return exam_paper.exam.name
    if exam_paper.exam_subject and exam_paper.exam_subject.exam:
        return exam_paper.exam_subject.exam.name
    return None


def _build_header(exam_paper):
    return {
        'school_name': exam_paper.school.name,
        'exam_name': _exam_name(exam_paper),
        'paper_title': exam_paper.paper_title,
        'subject_name': exam_paper.subject.name,
        'class_name': exam_paper.class_obj.name,
        'total_marks': str(exam_paper.total_marks),
        'duration_minutes': exam_paper.duration_minutes,
        'instructions': exam_paper.instructions or None,
    }


def _build_matching_pairs(type_data, rng):
    """Left column stays in order; right column is deterministically shuffled
    (draws from the paper-seeded `rng`, so re-exports of the same paper match)."""
    pairs = type_data.get('pairs') if isinstance(type_data, dict) else None
    if not isinstance(pairs, list) or not pairs:
        return []
    cleaned = [pair for pair in pairs if isinstance(pair, dict)]
    lefts = [str(pair.get('left', '')) for pair in cleaned]
    shuffled_rights = [str(pair.get('right', '')) for pair in cleaned]
    rng.shuffle(shuffled_rights)
    return [{'left': left, 'right': right} for left, right in zip(lefts, shuffled_rights)]


def _format_fill_blank_line(raw_text):
    """Standardizes a fill-in-the-blank item's blank marker: replaces an existing
    underscore run with a uniform-length blank, or appends one if the item has none."""
    text = str(raw_text or '').strip()
    if BLANK_MARKER_RE.search(text):
        return BLANK_MARKER_RE.sub(BLANK_FILL, text)
    return f'{text} {BLANK_FILL}'.strip()


def _build_fill_blank_items(type_data):
    items = type_data.get('items') if isinstance(type_data, dict) else None
    if not isinstance(items, list):
        return []
    return [_format_fill_blank_line(item) for item in items]


def _build_render_item(paper_question, number, answer_lines_enabled, rng):
    data = paper_question.get_question_data()
    question_type = str(data.get('question_type') or 'SHORT').upper()
    type_data = data.get('type_data') if isinstance(data.get('type_data'), dict) else {}

    item = {
        'number': number,
        'question_type': question_type,
        'marks': paper_question.get_marks(),
        'question_text': data.get('question_text') or '',
        'options': None,
        'fill_blank_items': None,
        'matching_pairs': None,
        'answer_lines': 0,
    }

    if question_type == 'MCQ':
        item['options'] = {
            'A': data.get('option_a') or '',
            'B': data.get('option_b') or '',
            'C': data.get('option_c') or '',
            'D': data.get('option_d') or '',
        }
    elif question_type == 'FILL_BLANK':
        fill_items = _build_fill_blank_items(type_data)
        if fill_items:
            item['fill_blank_items'] = fill_items
    elif question_type == 'MATCHING':
        item['matching_pairs'] = _build_matching_pairs(type_data, rng)
    elif question_type in QUESTION_TYPES_WITH_ANSWER_LINES and answer_lines_enabled:
        item['answer_lines'] = ANSWER_LINE_COUNTS[question_type]
    # TRUE_FALSE and any other type: text-only render item. Generators append the
    # "True / False" line themselves when question_type == 'TRUE_FALSE'.

    return item


def build_export_layout(exam_paper):
    """
    Returns None for legacy (empty-structure) papers.

    Otherwise returns:
        {
            'header': {school_name, exam_name, paper_title, subject_name,
                       class_name, total_marks, duration_minutes, instructions},
            'blocks': [
                {'type': 'section', 'title': str, 'instruction': str|None,
                 'section_marks': Decimal, 'items': [render_item, ...]},
                ...
                {'type': 'unstructured', 'items': [render_item, ...]},  # only if present
            ],
        }

    Numbering is continuous across every block (sections in structure order, then
    the trailing unstructured block), independent of the stored question_order
    values, so it stays correct regardless of how the paper was authored.
    """
    structure = exam_paper.structure if isinstance(exam_paper.structure, list) else []
    if not structure:
        return None

    answer_lines_enabled = bool((exam_paper.render_options or {}).get('answer_lines'))
    rng = random.Random(exam_paper.id)

    paper_questions = list(
        exam_paper.paper_questions.select_related('question').order_by('question_order', 'id')
    )

    known_keys = {
        str(section.get('key')) for section in structure
        if isinstance(section, dict) and str(section.get('type', 'question_group')).lower() != 'divider'
    }
    by_section_key = {}
    for paper_question in paper_questions:
        by_section_key.setdefault(paper_question.section_key or '', []).append(paper_question)

    blocks = []
    counter = 0

    for section in structure:
        if not isinstance(section, dict):
            continue

        if str(section.get('type', 'question_group')).lower() == 'divider':
            # A plain print-layout separator -- no marks, no questions attach to it.
            blocks.append({'type': 'divider', 'title': section.get('title') or ''})
            continue

        key = str(section.get('key') or '')

        slots_counted_raw = section.get('slots_counted', section.get('slots_shown', 0))
        try:
            slots_counted = int(slots_counted_raw)
        except (TypeError, ValueError):
            slots_counted = 0
        marks_per_question = _to_decimal(section.get('marks_per_question', 0))

        items = []
        for paper_question in by_section_key.get(key, []):
            counter += 1
            items.append(_build_render_item(paper_question, counter, answer_lines_enabled, rng))

        blocks.append({
            'type': 'section',
            'title': section.get('title') or '',
            'instruction': section.get('instruction') or None,
            'section_marks': Decimal(slots_counted) * marks_per_question,
            'items': items,
        })

    unstructured_questions = [
        paper_question for paper_question in paper_questions
        if (paper_question.section_key or '') not in known_keys
    ]
    if unstructured_questions:
        items = []
        for paper_question in unstructured_questions:
            counter += 1
            items.append(_build_render_item(paper_question, counter, answer_lines_enabled, rng))
        blocks.append({'type': 'unstructured', 'items': items})

    return {
        'header': _build_header(exam_paper),
        'blocks': blocks,
    }
