"""Joins the per-page OCR results of one multi-page paper into a single structure.

Pages are read independently (and at the same time), so nothing a page returns knows what
the neighbouring pages hold. This module is where the pieces are put back together:

1. page order, never upload order;
2. a section that runs across a page break is merged into one;
3. a section whose questions are of different types is split by type, so every section
   ends up with one question type (what the paper structure needs);
4. checks the user should see before saving: marks versus the detected total, questions
   whose type the model was unsure of, header fields that were not found.
"""
from copy import deepcopy
from typing import Any, Dict, List, Optional, Tuple

# Below this the model said it was guessing the question's type.
LOW_CONFIDENCE = 0.7

HEADER_FIELDS = ('exam_title', 'class_label', 'subject_label', 'detected_total_marks', 'duration_label')

TYPE_LABELS = {
    'MCQ': 'Multiple Choice',
    'SHORT': 'Short Answer',
    'LONG': 'Long Answer',
    'ESSAY': 'Essay',
    'TRUE_FALSE': 'True/False',
    'MATCHING': 'Matching',
    'FILL_BLANK': 'Fill in the Blanks',
}


def _norm_title(title: Optional[str]) -> str:
    return ' '.join(str(title or '').lower().split())


def _merge_header(headers: List[Dict[str, Any]]) -> Dict[str, Any]:
    """First non-empty value of each field wins, so page 1's header is never overwritten
    by a later page that happens to print a footer or a different looking line."""
    merged: Dict[str, Any] = {}
    for field in HEADER_FIELDS + ('school_name',):
        merged[field] = next(
            (h.get(field) for h in headers if h.get(field) not in (None, '')),
            None,
        )
    return merged


def _continues(section: Dict[str, Any], previous: Dict[str, Any], is_first_on_page: bool) -> bool:
    if not is_first_on_page:
        return False
    if section.get('continues_previous'):
        return True
    # The model reuses the heading of a section that carries over to the next page.
    return (
        bool(_norm_title(section.get('title')))
        and _norm_title(section.get('title')) == _norm_title(previous.get('title'))
        and section.get('question_type_guess') == previous.get('question_type_guess')
    )


def _merge_into(previous: Dict[str, Any], section: Dict[str, Any]) -> None:
    attempt_any = (previous.get('counted_count') or 0) < (previous.get('shown_count') or 0)
    previous['questions'].extend(section['questions'])
    previous['shown_count'] = (previous.get('shown_count') or 0) + (section.get('shown_count') or 0)
    # "Attempt any N" printed once applies to the whole section; otherwise every shown
    # item counts.
    previous['counted_count'] = (
        previous.get('counted_count')
        if attempt_any
        else (previous.get('counted_count') or 0) + (section.get('counted_count') or 0)
    )
    if not previous.get('marks_per_question'):
        previous['marks_per_question'] = section.get('marks_per_question')
    if not previous.get('instruction'):
        previous['instruction'] = section.get('instruction')
    previous.setdefault('pages', [])
    for page in section.get('pages', []):
        if page not in previous['pages']:
            previous['pages'].append(page)
    previous['merged_across_pages'] = True


def _split_mixed_types(section: Dict[str, Any]) -> List[Dict[str, Any]]:
    """One section per run of the same question type. Left alone when the paper says
    'attempt any N' (the choice spans the whole section) or when it is already uniform."""
    questions = section['questions']
    attempt_any = (section.get('counted_count') or 0) < (section.get('shown_count') or 0)
    if attempt_any or len({q['question_type'] for q in questions}) <= 1:
        return [section]

    runs: List[List[Dict[str, Any]]] = []
    for question in questions:
        if runs and runs[-1][-1]['question_type'] == question['question_type']:
            runs[-1].append(question)
        else:
            runs.append([question])

    pieces = []
    for index, run in enumerate(runs):
        marks = {q.get('marks') for q in run}
        piece = deepcopy(section)
        qtype = run[0]['question_type']
        piece.update({
            'title': section['title'] if index == 0 else f"{section['title']} ({TYPE_LABELS.get(qtype, qtype)})",
            'question_type_guess': qtype,
            'questions': run,
            'shown_count': len(run),
            'counted_count': len(run),
            'marks_per_question': run[0].get('marks') if len(marks) == 1 else section.get('marks_per_question'),
            'derived_from_mixed': True,
            'instruction': section.get('instruction') if index == 0 else None,
        })
        pieces.append(piece)
    return pieces


def _total_marks(sections: List[Dict[str, Any]]) -> float:
    return round(sum(
        (s.get('counted_count') or 0) * (s.get('marks_per_question') or 0) for s in sections
    ), 2)


def reconcile_pages(pages: List[Tuple[int, Dict[str, Any]]]) -> Dict[str, Any]:
    """pages: [(page_number, ai_extracted_json), ...] in any order."""
    ordered = sorted(pages, key=lambda item: item[0])

    sections: List[Dict[str, Any]] = []
    for page_number, extracted in ordered:
        for position, raw in enumerate(extracted.get('sections') or []):
            section = deepcopy(raw)
            section['pages'] = [page_number]
            section.setdefault('questions', [])
            if sections and _continues(section, sections[-1], position == 0):
                _merge_into(sections[-1], section)
            else:
                sections.append(section)

    split: List[Dict[str, Any]] = []
    for section in sections:
        split.extend(_split_mixed_types(section))
    sections = split

    low_confidence = 0
    for section in sections:
        for question in section['questions']:
            confidence = question.get('type_confidence')
            question['needs_review'] = confidence is not None and confidence < LOW_CONFIDENCE
            low_confidence += int(question['needs_review'])

    header = _merge_header([(extracted.get('header') or {}) for _, extracted in ordered])
    computed = _total_marks(sections)
    detected = header.get('detected_total_marks')

    return {
        'header': header,
        'sections': sections,
        'questions': [q for s in sections for q in s['questions']],
        'computed_total_marks': computed,
        'low_confidence_count': low_confidence,
        'marks_check': {
            'detected': detected,
            'computed': computed,
            # None = nothing printed to compare against.
            'matches': None if detected is None else abs(float(detected) - computed) < 0.01,
        },
        # What the user must fill in themselves before saving.
        'missing_fields': [
            field for field in ('class_label', 'subject_label', 'detected_total_marks')
            if header.get(field) in (None, '')
        ],
    }
