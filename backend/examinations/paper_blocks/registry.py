"""The one list of block types. Web and mobile read this list from the server (``GET paper-blocks/``), so
a new block is added here and nowhere else (same idea as ``core/roles.py``).

Each block type lists its fields. The web editor builds its form from that list and the server checks
saved papers against it, so the two can never disagree about what a block holds.
"""
from typing import Any, Dict, Iterator, List, Optional, Set

DOCUMENT_VERSION = 1
MAX_GRID = 30
MAX_ITEMS = 60

# Field kinds: text (one line), richtext (question text with bold, maths, tables), int, number, bool,
# choice, picture (library name, {"upload": id} or {"make": ...}), text_list (list of short texts),
# letter_rows (rows of short texts), list (repeated items, each with its own fields).


def _f(name, label, kind, **extra):
    return {'name': name, 'label': label, 'kind': kind, **extra}


TEXT_ITEM = _f('text', 'Question', 'richtext')
# Same levels as examinations.models.BLOOM_LEVELS; feeds the paper's Bloom distribution chart.
BLOOM = _f('bloom_level', 'Thinking level (Bloom)', 'choice',
           choices=['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'], optional=True,
           labels={c: c.capitalize() for c in ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']})
ITEM_PICTURE = _f('picture', 'Picture', 'picture', optional=True)
ATTEMPT = _f('attempt', 'Attempt any', 'int', min=1, max=MAX_ITEMS, optional=True,
             help='Leave empty when every part must be answered.')
NUMBERING = _f('numbering', 'Number the parts', 'choice', choices=['roman', 'number', 'letter'],
               labels={'roman': 'i, ii, iii', 'number': '1, 2, 3', 'letter': 'a, b, c'},
               default='roman', optional=True)


# Friendly words for choice lists; ``choices`` stay the stored values (demo findings A7).
BOX_LABELS = {'none': 'No box', 'solid': 'Solid line', 'dashed': 'Dashed line'}


def _answer_lines(default):
    return _f('lines', 'Answer lines per part', 'int', min=0, max=30, default=default, optional=True)


BLOCK_TYPES: Dict[str, Dict[str, Any]] = {
    # --- activity blocks (Play Group to Grade 2, and any drawing-based question) ---
    'writing_grid': {'label': 'Writing grid', 'kind': 'activity', 'fields': [
        _f('rows', 'Rows', 'int', min=1, max=MAX_GRID, default=4),
        _f('cols', 'Columns', 'int', min=1, max=MAX_GRID, default=5),
    ]},
    'handwriting_lines': {'label': 'Handwriting lines', 'kind': 'activity', 'fields': [
        _f('rows', 'Rows', 'int', min=1, max=MAX_GRID, default=4),
        _f('cols', 'Boxes per row', 'int', min=1, max=MAX_GRID, default=4),
        # Schools print both: coloured copybook ruling, and plain black lines (2026-11-23 sample worksheet).
        _f('style', 'Lines', 'choice', choices=['four', 'one'], default='four', optional=True,
           labels={'four': 'Four lines (copybook)', 'one': 'One line'}),
        _f('colour', 'Colour', 'choice', choices=['colour', 'black'], default='colour', optional=True,
           labels={'colour': 'Red and blue', 'black': 'Black'}),
    ]},
    'missing_sequence': {'label': 'Missing numbers or letters', 'kind': 'activity', 'fields': [
        # counting: the editors offer "1 to N, every k-th left empty" for this list (demo findings, faster 1).
        _f('items', 'Sequence (leave a box empty for the child to fill)', 'text_list', max=MAX_ITEMS, counting=True),
        _f('shape', 'Shape', 'choice', choices=['cloud', 'train', 'box'], default='cloud', optional=True,
           labels={'cloud': 'Clouds', 'train': 'Train', 'box': 'Boxes'}),
        _f('per_row', 'Per row', 'int', min=1, max=8, default=4, optional=True),
    ]},
    'count_write': {'label': 'Count and write', 'kind': 'activity', 'fields': [
        _f('rows', 'Rows', 'list', max=12, fields=[
            _f('picture', 'Picture', 'picture'),
            _f('count', 'How many', 'int', min=1, max=7, default=3),
        ]),
    ]},
    'compare_objects': {'label': 'Compare objects (big/small, long/short)', 'kind': 'activity', 'fields': [
        _f('mode', 'Compare', 'choice', choices=['size', 'length'], default='size',
           labels={'size': 'Big and small', 'length': 'Long and short'}),
        _f('picture', 'Picture (for big and small)', 'picture', optional=True),
    ]},
    'find_colour': {'label': 'Find and colour', 'kind': 'activity', 'fields': [
        _f('target', 'Letter or number to find', 'text', max_length=2),
        _f('items', 'Letters or numbers in the circles', 'text_list', max=20),
    ]},
    'match_columns': {'label': 'Match the columns', 'kind': 'activity', 'fields': [
        _f('left', 'Left column', 'list', max=12, fields=[_f('text', 'Text', 'text', optional=True), ITEM_PICTURE]),
        _f('right', 'Right column', 'list', max=12, fields=[_f('text', 'Text', 'text', optional=True), ITEM_PICTURE]),
        _f('dots', 'Show dots to join', 'bool', default=False, optional=True),
        _f('left_box', 'Box around left items', 'choice', choices=['none', 'solid', 'dashed'], default='none', optional=True,
           labels=BOX_LABELS),
        _f('right_box', 'Box around right items', 'choice', choices=['none', 'solid', 'dashed'], default='none', optional=True,
           labels=BOX_LABELS),
    ]},
    'letter_grid': {'label': 'Letter grid', 'kind': 'activity', 'fields': [
        _f('rows', 'Rows of letters', 'letter_rows', max=10),
        _f('picture', 'Picture beside the grid', 'picture', optional=True),
    ]},
    'picture_choice': {'label': 'Picture with choices', 'kind': 'activity', 'fields': [
        _f('items', 'Cards', 'list', max=12, fields=[
            _f('picture', 'Picture', 'picture'),
            _f('options', 'Choices', 'text_list', max=4),
        ]),
        _f('per_row', 'Cards per row', 'int', min=1, max=4, default=3, optional=True),
    ]},
    'colour_picture': {'label': 'Colour the picture', 'kind': 'activity', 'fields': [
        _f('picture', 'Picture', 'picture'),
        _f('height', 'Height', 'int', min=120, max=760, default=380, optional=True),
        _f('frame', 'Frame', 'choice', choices=['solid', 'dashed', 'none'], default='solid', optional=True, labels=BOX_LABELS),
    ]},
    'picture_answer': {'label': 'Pictures with an answer space', 'kind': 'activity', 'fields': [
        _f('items', 'Pictures', 'list', max=20, fields=[_f('picture', 'Picture', 'picture')]),
        _f('answer', 'Answer space', 'choice', choices=['line', 'box', 'none'], default='line', optional=True,
           labels={'line': 'A line', 'box': 'A box', 'none': 'Nothing'}),
        _f('per_row', 'Per row', 'int', min=1, max=5, default=3, optional=True),
    ]},
    'oral': {'label': 'Oral', 'kind': 'activity', 'fields': [
        _f('items', 'Parts', 'list', max=MAX_ITEMS, fields=[
            _f('text', 'Part', 'text'),
            _f('marks', 'Marks', 'number', min=0, optional=True),
        ]),
    ]},
    # --- text blocks (any class): one heading, a list of parts, each part one bank question ---
    'mcq': {'label': 'Multiple choice', 'kind': 'text', 'question_type': 'MCQ', 'fields': [
        _f('items', 'Questions', 'list', max=MAX_ITEMS, fields=[
            TEXT_ITEM,
            _f('options', 'Options', 'list', min=2, max=6, fields=[
                _f('text', 'Option', 'richtext', optional=True), ITEM_PICTURE,
            ]),
            _f('answer', 'Correct option', 'choice', choices=['A', 'B', 'C', 'D', 'E', 'F'], optional=True),
            ITEM_PICTURE, BLOOM,
        ]),
        _f('columns', 'Options per row', 'choice', choices=['auto', '1', '2', '4'], default='auto', optional=True,
           labels={'auto': 'As they fit'}),
        NUMBERING, ATTEMPT,
    ]},
    'true_false': {'label': 'True or false', 'kind': 'text', 'question_type': 'TRUE_FALSE', 'fields': [
        _f('items', 'Statements', 'list', max=MAX_ITEMS, fields=[
            # The picture keeps an old paper's diagram (question_image_url) when it is converted (Phase 7).
            TEXT_ITEM, _f('answer', 'Answer', 'choice', choices=['TRUE', 'FALSE'], optional=True, labels={'TRUE': 'True', 'FALSE': 'False'}), ITEM_PICTURE, BLOOM,
        ]),
        NUMBERING, ATTEMPT,
    ]},
    'fill_blank': {'label': 'Fill in the blanks', 'kind': 'text', 'question_type': 'FILL_BLANK', 'fields': [
        _f('items', 'Sentences (type ___ where the blank goes)', 'list', max=MAX_ITEMS, fields=[
            TEXT_ITEM, _f('answers', 'Answers', 'text_list', max=10, optional=True), ITEM_PICTURE, BLOOM,
        ]),
        NUMBERING, ATTEMPT,
    ]},
    'short_answer': {'label': 'Short answers', 'kind': 'text', 'question_type': 'SHORT', 'fields': [
        _f('items', 'Questions', 'list', max=MAX_ITEMS, fields=[
            TEXT_ITEM, _f('answer', 'Model answer', 'richtext', optional=True), ITEM_PICTURE, BLOOM,
        ]),
        _answer_lines(2), NUMBERING, ATTEMPT,
    ]},
    'long_answer': {'label': 'Long answers', 'kind': 'text', 'question_type': 'LONG', 'fields': [
        _f('items', 'Questions', 'list', max=MAX_ITEMS, fields=[
            TEXT_ITEM, _f('answer', 'Model answer', 'richtext', optional=True), ITEM_PICTURE, BLOOM,
        ]),
        _answer_lines(8), NUMBERING, ATTEMPT,
    ]},
    'essay': {'label': 'Essay or letter', 'kind': 'text', 'question_type': 'ESSAY', 'fields': [
        _f('items', 'Topics', 'list', max=MAX_ITEMS, fields=[
            TEXT_ITEM, _f('answer', 'Points to look for', 'richtext', optional=True), BLOOM,
        ]),
        _answer_lines(15), NUMBERING, ATTEMPT,
    ]},
    'matching': {'label': 'Match column A with column B', 'kind': 'text', 'question_type': 'MATCHING', 'fields': [
        _f('items', 'Pairs', 'list', max=20, fields=[
            _f('left', 'Column A', 'text'), _f('right', 'Column B (correct match)', 'text'),
        ]),
    ]},
    # --- layout ---
    'section_heading': {'label': 'Section heading', 'kind': 'layout', 'fields': []},
}

TEXT_BLOCKS = {name for name, spec in BLOCK_TYPES.items() if spec['kind'] == 'text'}
LAYOUT_BLOCKS = {name for name, spec in BLOCK_TYPES.items() if spec['kind'] == 'layout'}


# How the editors group question types when a teacher picks one: by what the teacher wants to ask, since one flat
# list of about 20 types was slow to scan. ``early``: shown first for Play Group, Nursery and Prep (user decision
# 2026-11-22); the rest come first for every class above.
TYPE_GROUPS = [
    {'id': 'writing', 'label': 'Writing practice', 'early': True},
    {'id': 'numbers', 'label': 'Numbers and counting', 'early': True},
    {'id': 'pictures', 'label': 'Pictures', 'early': True},
    {'id': 'objective', 'label': 'Quick answers', 'early': False},
    {'id': 'written', 'label': 'Written answers', 'early': False},
    {'id': 'oral', 'label': 'Oral', 'early': True},
    {'id': 'layout', 'label': 'Layout', 'early': False},
]
TYPE_PICKING = {
    'writing_grid': ('writing', 'Boxes to write counting or letters in.'),
    'handwriting_lines': ('writing', 'Four-line rows to copy letters or words.'),
    'letter_grid': ('writing', 'A grid of letters; circle the one asked for.'),
    'missing_sequence': ('numbers', 'Clouds, a train or boxes with numbers to fill in.'),
    'count_write': ('numbers', 'Pictures to count, with a box for the number.'),
    'find_colour': ('numbers', 'Circles of numbers or letters; colour the one asked for.'),
    'compare_objects': ('pictures', 'Big and small, or long and short.'),
    'colour_picture': ('pictures', 'One big picture to colour.'),
    'picture_choice': ('pictures', 'A picture with choices to circle.'),
    'picture_answer': ('pictures', 'Pictures with a space to write their names.'),
    'match_columns': ('pictures', 'Join pictures or words on the left with the right.'),
    'mcq': ('objective', 'Choose the correct option.'),
    'true_false': ('objective', 'Write true or false.'),
    'fill_blank': ('objective', 'Sentences with a blank to fill.'),
    'matching': ('objective', 'Match column A with column B.'),
    'short_answer': ('written', 'A few lines for each answer.'),
    'long_answer': ('written', 'Many lines for each answer.'),
    'essay': ('written', 'An essay, letter or story.'),
    'oral': ('oral', 'Questions asked aloud, marked by the teacher.'),
    'section_heading': ('layout', 'A heading such as "Section A".'),
}


def registry_for_api() -> List[Dict[str, Any]]:
    rows = []
    for name, spec in BLOCK_TYPES.items():
        group, hint = TYPE_PICKING.get(name, ('layout' if spec['kind'] == 'layout' else 'written', ''))
        rows.append({'type': name, 'label': spec['label'], 'kind': spec['kind'], 'fields': spec['fields'],
                     'group': group, 'hint': hint})
    return rows


def structure_lists(block_type: str) -> List[str]:
    """The lists a Structure row's "parts" sets: each top-level list of the block (Count and write rows, the
    clouds of Missing numbers, both sides of Match the columns, the parts of a written question)."""
    spec = BLOCK_TYPES.get(block_type) or {}
    return [f['name'] for f in spec.get('fields', []) if f['kind'] in ('list', 'text_list')]


def structure_row(block: Dict[str, Any]) -> Dict[str, Any]:
    """One Structure row from a question: its type, marks, number of parts and its choice settings (Big and
    small or Long and short...). Never its content: a copied structure is a plan, not a copied paper."""
    spec = BLOCK_TYPES.get(block.get('type')) or {}
    data = block.get('data') or {}
    row: Dict[str, Any] = {'type': block.get('type'), 'marks': block.get('marks')}
    lists = structure_lists(block.get('type'))
    if lists and isinstance(data.get(lists[0]), list):
        row['parts'] = len(data[lists[0]])
    choices = {f['name']: data[f['name']] for f in spec.get('fields', []) if f['kind'] == 'choice' and f['name'] in data}
    if choices:
        row['data'] = choices
    return row


# Ready-made structures, taken from the sample papers so they stay real (types, marks, parts; no content).
_TEMPLATE_SAMPLES = [('play_group_math', 'Play Group: Mathematics'), ('play_group_english', 'Play Group: English')]


def structure_templates() -> List[Dict[str, Any]]:
    import json
    from pathlib import Path
    folder = Path(__file__).parent / 'samples'
    templates = []
    for name, label in _TEMPLATE_SAMPLES:
        document = json.loads((folder / f'{name}.json').read_text(encoding='utf-8'))
        rows = [structure_row(block) for block in document.get('blocks') or [] if is_question(block)]
        templates.append({'id': name, 'label': label, 'rows': rows})
    return templates


def is_question(block: Dict[str, Any]) -> bool:
    """Headings are not numbered and carry no marks."""
    return block.get('type') not in LAYOUT_BLOCKS


def question_blocks(document: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [b for b in (document.get('blocks') or []) if isinstance(b, dict) and is_question(b)]


def block_marks(block: Dict[str, Any]) -> float:
    if not is_question(block):
        return 0.0
    try:
        return float(block.get('marks') or 0)
    except (TypeError, ValueError):
        return 0.0


def total_marks(document: Dict[str, Any]) -> float:
    return sum(block_marks(block) for block in question_blocks(document))


def format_marks(value: float) -> str:
    """10.0 prints as "10", 2.5 stays "2.5"."""
    value = float(value)
    return str(int(value)) if value.is_integer() else f'{value:g}'


def picture_refs(value: Any) -> Iterator[Any]:
    """Every picture a paper (or any part of one) refers to: library names, ``{"upload": id}`` and
    ``{"make": ...}``, including pictures inside a made picture."""
    if isinstance(value, dict):
        for key, inner in value.items():
            if key == 'picture' and inner:
                yield inner
            yield from picture_refs(inner)
    elif isinstance(value, list):
        for inner in value:
            yield from picture_refs(inner)


def upload_ids(document: Any) -> Set[int]:
    """The school uploads a paper needs, so they can be fetched once before rendering."""
    return {
        ref['upload'] for ref in picture_refs(document)
        if isinstance(ref, dict) and isinstance(ref.get('upload'), int) and not isinstance(ref.get('upload'), bool)
    }


def _picture_problem(ref: Any) -> str:
    from .makers import MAKERS
    if isinstance(ref, str):
        return ''
    if isinstance(ref, dict) and 'make' in ref:
        return '' if ref['make'] in MAKERS else f"unknown picture kind '{ref['make']}'"
    if isinstance(ref, dict) and 'upload' in ref:
        ok = isinstance(ref['upload'], int) and not isinstance(ref['upload'], bool)
        return '' if ok else 'an uploaded picture must be given by its number'
    if isinstance(ref, dict) and 'url' in ref:
        # Old papers' diagrams, stored as file addresses. Which hosts are allowed is checked where the
        # settings are known (paper_document.check_document).
        ok = isinstance(ref['url'], str) and ref['url'].startswith('https://') and len(ref['url']) <= 500
        return '' if ok else 'a picture address must start with https://'
    return 'a picture must be a name, an upload or a made picture'


def _is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


def _check_field(field: Dict[str, Any], value: Any, path: str, errors: List[str],
                 to_fill: Optional[List[str]] = None) -> None:
    """``path`` is what the teacher sees on the form ("Rows 2, How many"), so messages name fields the
    way the editor labels them. With ``to_fill``, a required value that is still empty goes there instead of
    ``errors``: a paper being written has empty parts, and that is not a mistake until it is printed
    (Structure step, docs/PAPER_BUILDER_STRUCTURE_PLAN.md)."""
    kind = field['kind']
    empty = value is None or (kind in ('text', 'richtext', 'picture') and isinstance(value, str) and not value.strip())
    if empty:
        if field.get('optional'):
            return
        if to_fill is not None:
            to_fill.append(path)
        elif kind not in ('text', 'richtext'):
            errors.append(f'{path}: missing or the wrong kind of value.')
        return
    if kind in ('text', 'richtext'):
        if not isinstance(value, str):
            errors.append(f'{path}: must be text.')
        elif field.get('max_length') and len(value) > field['max_length']:
            errors.append(f"{path}: must be at most {field['max_length']} characters.")
    elif kind == 'int':
        if not _is_int(value):
            errors.append(f'{path}: missing or the wrong kind of value.')
        elif not field.get('min', value) <= value <= field.get('max', value):
            errors.append(f"{path}: must be between {field['min']} and {field['max']}.")
    elif kind == 'number':
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            errors.append(f'{path}: must be a number.')
        elif value < field.get('min', value):
            errors.append(f"{path}: must be {field['min']} or more.")
    elif kind == 'bool':
        if not isinstance(value, bool):
            errors.append(f'{path}: must be yes or no.')
    elif kind == 'choice':
        if value not in field['choices']:
            errors.append(f"{path}: must be one of {', '.join(field['choices'])}.")
    elif kind == 'picture':
        problem = _picture_problem(value)
        if problem:
            errors.append(f'{path}: {problem}.')
    elif kind == 'text_list':
        if not isinstance(value, list) or not all(isinstance(v, (str, int, float)) and not isinstance(v, bool) for v in value):
            errors.append(f'{path}: missing or the wrong kind of value.')
        elif len(value) > field.get('max', MAX_ITEMS):
            errors.append(f"{path}: can have at most {field.get('max', MAX_ITEMS)} entries.")
    elif kind == 'letter_rows':
        if not isinstance(value, list) or not all(isinstance(row, list) for row in value):
            errors.append(f'{path}: missing or the wrong kind of value.')
        elif len(value) > field.get('max', MAX_ITEMS):
            errors.append(f"{path}: can have at most {field.get('max', MAX_ITEMS)} rows.")
    elif kind == 'list':
        if not isinstance(value, list):
            errors.append(f'{path}: missing or the wrong kind of value.')
            return
        if len(value) > field.get('max', MAX_ITEMS):
            errors.append(f"{path}: can have at most {field.get('max', MAX_ITEMS)} entries.")
        if field.get('min') and len(value) < field['min']:
            errors.append(f"{path}: needs at least {field['min']} entries.")
        for index, item in enumerate(value[:MAX_ITEMS], start=1):
            if not isinstance(item, dict):
                errors.append(f'{path} {index}: must be an object.')
                continue
            for sub in field['fields']:
                _check_field(sub, item.get(sub['name']), f"{path} {index}, {sub['label']}", errors, to_fill)


def validate_block(block: Any, to_fill: Optional[List[str]] = None) -> List[str]:
    if not isinstance(block, dict):
        return ['must be an object.']
    spec = BLOCK_TYPES.get(block.get('type'))
    if spec is None:
        return [f"unknown block type '{block.get('type')}'."]
    if block.get('title') is not None and not isinstance(block.get('title'), str):
        return ['the title must be text.']
    if not is_question(block):
        return []
    data = block.get('data')
    if not isinstance(data, dict):
        return ['has no data.']
    errors: List[str] = []
    for field in spec['fields']:
        _check_field(field, data.get(field['name']), field['label'], errors, to_fill)
    marks = block.get('marks')
    if marks is not None and (isinstance(marks, bool) or not isinstance(marks, (int, float)) or marks < 0):
        errors.append('marks must be a number, zero or more.')
    attempt = data.get('attempt')
    items = data.get('items')
    if _is_int(attempt) and isinstance(items, list) and attempt > len(items):
        errors.append('Attempt any: cannot be more than the number of parts.')
    return errors


def validate_document(document: Any, to_fill: Optional[List[str]] = None) -> List[str]:
    """Problems that would stop the paper from rendering, as plain sentences. Empty list = fine.
    With ``to_fill``, empty required values are collected there ("Question 3: Rows 2, Picture") instead."""
    if not isinstance(document, dict):
        return ['The paper must be an object.']
    blocks = document.get('blocks')
    if not isinstance(blocks, list):
        return ['The paper has no list of blocks.']
    if len(blocks) > 100:
        return ['A paper can have at most 100 blocks.']
    errors: List[str] = []
    number = 0
    for block in blocks:
        if isinstance(block, dict) and is_question(block):
            number += 1
            where = f'Question {number}'
        else:
            where = 'Heading'
        block_fill: List[str] = []
        errors.extend(f'{where}: {problem}' for problem in validate_block(block, block_fill if to_fill is not None else None))
        if to_fill is not None:
            to_fill.extend(f'{where}: {path}' for path in block_fill)
    return errors


def document_to_fill(document: Any) -> List[str]:
    """What is still empty in a paper that is otherwise valid: printing waits for this list to be empty."""
    to_fill: List[str] = []
    validate_document(document, to_fill)
    return to_fill


def block_to_fill(block: Any) -> bool:
    """Whether a question still has an empty required value (drawn with a "still to fill" frame)."""
    to_fill: List[str] = []
    validate_block(block, to_fill)
    return bool(to_fill)


def item_to_fill(block_type: str, item: Any) -> bool:
    """Whether one part of a written question is still empty (not copied into the question bank yet)."""
    spec = BLOCK_TYPES.get(block_type) or {}
    items_field = next((f for f in spec.get('fields', []) if f['name'] == 'items' and f['kind'] == 'list'), None)
    if not items_field or not isinstance(item, dict):
        return False
    to_fill: List[str] = []
    errors: List[str] = []
    for sub in items_field['fields']:
        _check_field(sub, item.get(sub['name']), sub['label'], errors, to_fill)
    return bool(to_fill)


def per_item_marks(block: Dict[str, Any]) -> Optional[float]:
    """Marks for one part of a text block: the block's marks shared over the parts that count."""
    items = (block.get('data') or {}).get('items') or []
    if not items:
        return None
    counted = (block.get('data') or {}).get('attempt') or len(items)
    return round(block_marks(block) / counted, 2) if counted else 0.0
