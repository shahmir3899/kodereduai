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
from decimal import Decimal, InvalidOperation

QUESTION_TYPES_WITH_ANSWER_LINES = {'SHORT', 'LONG', 'ESSAY'}
ANSWER_LINE_COUNTS = {'SHORT': 3, 'LONG': 6, 'ESSAY': 6}
BLANK_FILL = '__________'

# Shown next to a section's title when the section author left `instruction` blank,
# so a student always sees how to answer that question type (e.g. "Question # 2"
# alone doesn't say how True/False should be marked) without every paper author having
# to type the same boilerplate. A custom `instruction` on the section always wins.
DEFAULT_TYPE_INSTRUCTIONS = {
    'MCQ': 'Choose the correct option.',
    # Plain ASCII on purpose -- ReportLab's default Helvetica (WinAnsi encoding)
    # doesn't carry check/cross glyphs, so a literal tick/cross symbol here would
    # print as a missing-glyph box in the PDF export.
    'TRUE_FALSE': 'Tick True if the statement is correct, or False if it is incorrect.',
    'FILL_BLANK': 'Fill in the blanks with the correct word(s).',
    'MATCHING': 'Match the items in Column A with the correct items in Column B.',
    'SHORT': 'Answer the following questions briefly.',
    'LONG': 'Answer the following questions in detail.',
    'ESSAY': 'Write a detailed answer for the following.',
}


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


def resolve_exam_paper_class_name(exam_paper):
    """Session-year-aware class label for exports: prefers the linked exam's
    academic year, falling back to the school's current academic year, so a
    class renamed via SessionClass (e.g. "Nursery" -> "Junior 1") prints
    correctly on exported papers instead of the stale master Class name.
    """
    from academic_sessions.utils import resolve_class_display_name, resolve_current_academic_year_id

    academic_year_id = exam_paper.exam.academic_year_id if exam_paper.exam_id else None
    if not academic_year_id:
        academic_year_id = resolve_current_academic_year_id(exam_paper.school_id)

    return resolve_class_display_name(exam_paper.school_id, academic_year_id, exam_paper.class_obj)


def _build_header(exam_paper):
    return {
        'school_name': exam_paper.school.name,
        'exam_name': _exam_name(exam_paper),
        'paper_title': exam_paper.paper_title,
        'subject_name': exam_paper.subject.name,
        'class_name': resolve_exam_paper_class_name(exam_paper),
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


def _build_fill_blank_items(type_data):
    """Each `type_data.items[i]` is the *answer* for blank i, typed into the composer's
    "Answer for blank N" field (QuestionSlotEditor.jsx) and mirrored into
    `type_data.accepted_answers` for grading -- it is never a printable prompt. Printing it
    used to put the answer directly next to the blank meant to test it (e.g. "Photosynthesis
    __________"), so the paper only gets a generic numbered blank line; the question stem
    (question_text) is what carries the actual prompt/context."""
    items = type_data.get('items') if isinstance(type_data, dict) else None
    if not isinstance(items, list):
        return []
    blank_count = len([item for item in items if str(item or '').strip()])
    return [f'Blank {i}: {BLANK_FILL}' for i in range(1, blank_count + 1)]


def _part_letter(n):
    """1 -> 'a', 2 -> 'b', ..., 26 -> 'z', 27 -> 'aa', ... (spreadsheet-column style).
    A question group is never expected to have anywhere near 26 parts, but this
    doesn't break if one somehow does."""
    letters = []
    while n > 0:
        n, remainder = divmod(n - 1, 26)
        letters.append(chr(ord('a') + remainder))
    return ''.join(reversed(letters))


def _build_render_item(paper_question, number, answer_lines_enabled, rng):
    data = paper_question.get_question_data()
    question_type = str(data.get('question_type') or 'SHORT').upper()
    type_data = data.get('type_data') if isinstance(data.get('type_data'), dict) else {}

    item = {
        'number': number,
        'question_type': question_type,
        'marks': paper_question.get_marks(),
        'question_text': data.get('question_text') or '',
        'question_image_url': data.get('question_image_url') or None,
        'options': None,
        'option_images': None,
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
        # Diagram Mode (e.g. "which of these is a rhombus?") -- a dict rather than a
        # flat per-letter field so a generator can skip the whole block with one
        # `if item['option_images']:` when no option on this question has one.
        option_images = {
            'A': data.get('option_a_image_url') or None,
            'B': data.get('option_b_image_url') or None,
            'C': data.get('option_c_image_url') or None,
            'D': data.get('option_d_image_url') or None,
        }
        if any(option_images.values()):
            item['option_images'] = option_images
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

    Each question group ("Question # N" section) numbers its own parts as
    "N(a)", "N(b)", "N(c)"... (Cambridge/GCSE-style lettered sub-parts) instead of
    a single counter running through the whole paper -- that used to put e.g. "Q6"
    as the first item under a heading literally labelled "Question # 2", which read
    as mismatched. A trailing question with no section at all (the 'unstructured'
    block) isn't part of any lettered group, so it just gets the next plain group
    number ("N+1", "N+2"...) with no letter. Numbering is independent of the stored
    question_order values, so it stays correct regardless of how the paper was authored.
    """
    structure = exam_paper.structure if isinstance(exam_paper.structure, list) else []
    if not structure:
        return None

    blocks = _build_blocks(
        structure,
        list(exam_paper.paper_questions.select_related('question').order_by('question_order', 'id')),
        exam_paper.render_options,
        exam_paper.id,
    )

    return {
        'header': _build_header(exam_paper),
        'blocks': blocks,
    }


def _build_blocks(structure, items, render_options, seed):
    """Shared section/numbering body for both build_export_layout and
    build_worksheet_export_layout -- `items` is any list of objects exposing
    `.section_key`, `.get_marks()`, `.get_question_data()` (PaperQuestion and
    WorksheetItem both do, by design)."""
    answer_lines_enabled = bool((render_options or {}).get('answer_lines'))
    rng = random.Random(seed)

    known_keys = {
        str(section.get('key')) for section in structure
        if isinstance(section, dict) and str(section.get('type', 'question_group')).lower() != 'divider'
    }
    by_section_key = {}
    for item in items:
        by_section_key.setdefault(item.section_key or '', []).append(item)

    blocks = []
    group_index = 0  # counts question groups (sections), not individual items

    for section in structure:
        if not isinstance(section, dict):
            continue

        if str(section.get('type', 'question_group')).lower() == 'divider':
            # A plain print-layout separator -- no marks, no questions attach to it.
            blocks.append({'type': 'divider', 'title': section.get('title') or ''})
            continue

        group_index += 1
        key = str(section.get('key') or '')

        slots_counted_raw = section.get('slots_counted', section.get('slots_shown', 0))
        try:
            slots_counted = int(slots_counted_raw)
        except (TypeError, ValueError):
            slots_counted = 0
        marks_per_question = _to_decimal(section.get('marks_per_question', 0))

        render_items = []
        for part_index, item in enumerate(by_section_key.get(key, []), start=1):
            number = f"{group_index}({_part_letter(part_index)})"
            render_items.append(_build_render_item(item, number, answer_lines_enabled, rng))

        section_question_type = str(section.get('question_type') or '').upper()
        instruction = section.get('instruction') or DEFAULT_TYPE_INSTRUCTIONS.get(section_question_type)

        blocks.append({
            'type': 'section',
            'title': section.get('title') or '',
            'instruction': instruction,
            'section_marks': Decimal(slots_counted) * marks_per_question,
            'items': render_items,
        })

    unstructured_items = [
        item for item in items
        if (item.section_key or '') not in known_keys
    ]
    if unstructured_items:
        render_items = []
        for item in unstructured_items:
            group_index += 1
            render_items.append(_build_render_item(item, str(group_index), answer_lines_enabled, rng))
        blocks.append({'type': 'unstructured', 'items': render_items})

    return blocks


def _build_worksheet_header(worksheet):
    from academic_sessions.utils import resolve_class_display_name, resolve_current_academic_year_id

    academic_year_id = resolve_current_academic_year_id(worksheet.school_id)
    class_name = resolve_class_display_name(worksheet.school_id, academic_year_id, worksheet.class_obj)

    return {
        'school_name': worksheet.school.name,
        'paper_title': worksheet.title,
        'subject_name': worksheet.subject.name if worksheet.subject_id else None,
        'class_name': class_name,
        'instructions': worksheet.instructions or None,
    }


def build_worksheet_export_layout(worksheet):
    """Worksheet counterpart of build_export_layout -- same block/numbering
    logic via _build_blocks, but the header carries no exam_name/total_marks/
    duration_minutes (worksheets have none of those). Unlike exam papers,
    worksheets are always structure-based (the builder never leaves structure
    empty), so there is no legacy flat-list fallback to support here.
    """
    structure = worksheet.structure if isinstance(worksheet.structure, list) else []

    blocks = _build_blocks(
        structure,
        list(worksheet.items.select_related('question').order_by('item_order', 'id')),
        worksheet.render_options,
        worksheet.id,
    )

    return {
        'header': _build_worksheet_header(worksheet),
        'blocks': blocks,
    }
