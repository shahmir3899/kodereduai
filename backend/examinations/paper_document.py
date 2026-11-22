"""Where the block-based Paper Builder (``paper_blocks``) meets the database.

- ``render_document``: the saved block list plus a header filled from the paper itself (school, exam,
  class, subject, time), so the printed header can never go stale.
- ``sync_questions``: every block is also kept in the question bank, so marks entry, student responses,
  reuse next term and coverage keep working. Text blocks give one question per part; activity blocks
  and matching blocks give one question each.
- ``convert_old_paper``: a paper made with the old wizard (structure + paper questions) as blocks.

Worksheets (Phase 6b) use the same functions: ``_Owner`` hides the few differences (their header, their
``WorksheetItem`` links, optional marks, no stored total).
"""
import uuid
from copy import deepcopy
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from django.conf import settings

from .models import ExamPaper, PaperQuestion, Question, QuestionType, Worksheet, WorksheetItem
from .paper_blocks.registry import (
    BLOCK_TYPES, DOCUMENT_VERSION, LAYOUT_BLOCKS, block_to_fill, document_to_fill, item_to_fill, per_item_marks,
    picture_refs, total_marks, validate_document,
)

# Header settings a teacher can change per paper; everything else in the header comes from the paper.
HEADER_OPTIONS = {'marks_table', 'show_time_marks', 'sign_label', 'exam_title'}
BLOCK_KEYS = {'id', 'type', 'title', 'marks', 'data', 'question_id'}

TYPE_TO_BLOCK = {
    'MCQ': 'mcq', 'TRUE_FALSE': 'true_false', 'FILL_BLANK': 'fill_blank', 'SHORT': 'short_answer',
    'LONG': 'long_answer', 'ESSAY': 'essay', 'MATCHING': 'matching',
}
# Blocks whose whole content is one bank question (the rest: one question per part).
WHOLE_BLOCK_QUESTIONS = {name for name, spec in BLOCK_TYPES.items() if spec['kind'] == 'activity'} | {'matching'}


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _decimal(value: Any, default: str = '0') -> Decimal:
    try:
        return Decimal(str(value)).quantize(Decimal('0.01'))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal(default)


def _storage_host() -> str:
    return urlparse(getattr(settings, 'SUPABASE_URL', '') or '').hostname or ''


# The section instruction an old paper printed when its section had none (used by the converter).
DEFAULT_TYPE_INSTRUCTIONS = {
    'MCQ': 'Choose the correct option.',
    'TRUE_FALSE': 'Tick True if the statement is correct, or False if it is incorrect.',
    'FILL_BLANK': 'Fill in the blanks with the correct word(s).',
    'MATCHING': 'Match the items in Column A with the correct items in Column B.',
    'SHORT': 'Answer the following questions briefly.',
    'LONG': 'Answer the following questions in detail.',
    'ESSAY': 'Write a detailed answer for the following.',
}


def resolve_exam_paper_class_name(exam_paper) -> str:
    """Session-year-aware class label: prefers the linked exam's academic year, falling back to the school's
    current one, so a class renamed via SessionClass (e.g. "Nursery" -> "Junior 1") prints with its new name
    instead of the stale master Class name."""
    from academic_sessions.utils import resolve_class_display_name, resolve_current_academic_year_id

    academic_year_id = exam_paper.exam.academic_year_id if exam_paper.exam_id else None
    if not academic_year_id:
        academic_year_id = resolve_current_academic_year_id(exam_paper.school_id)
    return resolve_class_display_name(exam_paper.school_id, academic_year_id, exam_paper.class_obj)


def check_document(document: Any) -> List[str]:
    """``validate_document`` plus the checks that need settings: a picture given as an address must be
    one of our own stored files (old papers' diagrams), never an outside site. Values still empty are not
    problems here (autosave and preview take a half-written paper); ``print_problems`` asks for them."""
    errors = validate_document(document, to_fill=[])
    if errors:
        return errors
    host = _storage_host()
    for ref in picture_refs(document):
        if isinstance(ref, dict) and 'url' in ref:
            parsed = urlparse(str(ref['url']))
            if parsed.scheme != 'https' or not host or parsed.hostname != host:
                errors.append('A picture address must be a file stored by this app.')
                break
    return errors


def print_problems(owner, document: Any) -> List[str]:
    """What stops a draft from being printed, downloaded or moved off Draft: parts still to fill. A paper
    already past Draft prints as it is (an old paper converted to blocks may have an empty part)."""
    if getattr(owner, 'status', 'DRAFT') != 'DRAFT':
        return []
    return [f'Still to fill: {path}' for path in document_to_fill(document)]


def normalize_document(document: Dict[str, Any]) -> Dict[str, Any]:
    """A clean copy: known keys only, every block with an id (the editor and the question bank both
    find blocks by it)."""
    header = {k: v for k, v in (document.get('header') or {}).items() if k in HEADER_OPTIONS}
    blocks = []
    seen = set()
    for raw in document.get('blocks') or []:
        block = {k: deepcopy(v) for k, v in raw.items() if k in BLOCK_KEYS}
        if not isinstance(block.get('id'), str) or not block['id'] or block['id'] in seen or len(block['id']) > 40:
            block['id'] = _new_id()
        seen.add(block['id'])
        if block['type'] in LAYOUT_BLOCKS:
            block.pop('marks', None)
            block.pop('data', None)
            block.pop('question_id', None)
        blocks.append(block)
    return {
        'version': DOCUMENT_VERSION,
        'direction': 'rtl' if document.get('direction') == 'rtl' else 'ltr',
        'header': header,
        'blocks': blocks,
    }


def _time_label(minutes: Optional[int], urdu: bool = False) -> str:
    if not minutes:
        return ''
    hours, rest = divmod(int(minutes), 60)
    if urdu:
        parts = ([f'{hours} گھنٹے' if hours > 1 else '1 گھنٹہ'] if hours else []) + ([f'{rest} منٹ'] if rest else [])
        return ' '.join(parts)
    if hours and not rest:
        return f'{hours} hour' + ('s' if hours > 1 else '')
    if hours:
        return f'{hours} h {rest} min'
    return f'{rest} minutes'


def paper_header(paper: ExamPaper) -> Dict[str, Any]:
    exam = paper.exam or (paper.exam_subject.exam if paper.exam_subject_id else None)
    return {
        'school_name': paper.school.name,
        'exam_title': exam.name if exam else paper.paper_title,
        'subject': paper.subject.name,
        'class_name': resolve_exam_paper_class_name(paper),
        'time_label': _time_label(paper.duration_minutes),
        'instructions': paper.instructions or '',
        'marks_table': True,
        'show_time_marks': True,
        'sign_label': 'Teacher’s Sign',
    }


def worksheet_header(worksheet: Worksheet) -> Dict[str, Any]:
    """A worksheet is practice, not an exam: its own title, no time, and no "for office use" table or
    total unless the teacher turns them on."""
    from academic_sessions.utils import resolve_class_display_name, resolve_current_academic_year_id
    year_id = resolve_current_academic_year_id(worksheet.school_id)
    return {
        'kind': 'worksheet',
        'school_name': worksheet.school.name,
        'exam_title': worksheet.title,
        'subject': worksheet.subject.name if worksheet.subject_id else '',
        'class_name': resolve_class_display_name(worksheet.school_id, year_id, worksheet.class_obj),
        'time_label': '',
        'instructions': worksheet.instructions or '',
        'marks_table': False,
        'show_time_marks': False,
        'sign_label': 'Teacher’s Sign',
    }


class _Owner:
    """What differs between a paper and a worksheet when the block list meets the database."""

    def __init__(self, obj):
        self.obj = obj
        self.is_worksheet = isinstance(obj, Worksheet)

    @property
    def school_id(self):
        return self.obj.school_id

    @property
    def subject_id(self):
        return self.obj.subject_id

    def links(self):
        if self.is_worksheet:
            return self.obj.items.select_related('question')
        return self.obj.paper_questions.select_related('question')

    def ordered_links(self):
        field = 'item_order' if self.is_worksheet else 'question_order'
        return list(self.links().order_by(field, 'id'))

    def new_link(self, question: Question):
        if self.is_worksheet:
            return WorksheetItem(worksheet=self.obj, question=question)
        return PaperQuestion(exam_paper=self.obj, question=question)

    @staticmethod
    def order_name(link) -> str:
        return 'item_order' if isinstance(link, WorksheetItem) else 'question_order'

    @staticmethod
    def snapshot_name(link) -> str:
        return 'item_snapshot' if isinstance(link, WorksheetItem) else 'question_snapshot'

    @staticmethod
    def build_snapshot(link) -> Dict[str, Any]:
        return link.build_item_snapshot() if isinstance(link, WorksheetItem) else link.build_question_snapshot()

    def shared_question_ids(self, question_ids) -> set:
        """Questions also used by another paper or worksheet: copied, never edited in place, so a
        question never changes under someone else's paper."""
        papers = PaperQuestion.objects.filter(question_id__in=question_ids)
        sheets = WorksheetItem.objects.filter(question_id__in=question_ids)
        if self.is_worksheet:
            sheets = sheets.exclude(worksheet=self.obj)
        else:
            papers = papers.exclude(exam_paper=self.obj)
        return set(papers.values_list('question_id', flat=True)) | set(sheets.values_list('question_id', flat=True))

    def header(self) -> Dict[str, Any]:
        return worksheet_header(self.obj) if self.is_worksheet else paper_header(self.obj)

    def duration(self):
        return None if self.is_worksheet else self.obj.duration_minutes


def owner_problems(obj, document: Any) -> List[str]:
    """Checks that need the paper or worksheet itself (after ``check_document``)."""
    if not isinstance(obj, Worksheet) or obj.subject_id:
        return []
    if any(isinstance(b, dict) and b.get('type') not in LAYOUT_BLOCKS for b in (document or {}).get('blocks') or []):
        return ['Choose a subject for this worksheet before adding questions (every question is kept in the question bank under a subject).']
    return []


def render_document(paper, document: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """The document ready for the renderers: blocks as saved, header from the paper (or worksheet) +
    the teacher's header options."""
    owner = _Owner(paper)
    document = document if document is not None else (paper.document or {})
    from .paper_blocks.urdu import labels_for
    direction = 'rtl' if document.get('direction') == 'rtl' else 'ltr'
    header = owner.header()
    if direction == 'rtl':
        header['time_label'] = _time_label(owner.duration(), urdu=True)
    header.update({k: v for k, v in (document.get('header') or {}).items() if k in HEADER_OPTIONS})
    class_word = labels_for({'direction': direction})['class']
    where = f"{header['class_name']} ({header['subject']})" if header.get('subject') else header['class_name']
    return {
        'version': DOCUMENT_VERSION,
        'direction': direction,
        'footer': f"{header['exam_title']} — {class_word}: {where}",
        'header': header,
        'blocks': document.get('blocks') or [],
    }


# ------------------------------------------------------------------ question bank sync

def _text_question_fields(block_type: str, item: Dict[str, Any]) -> Dict[str, Any]:
    question_type = BLOCK_TYPES[block_type]['question_type']
    fields: Dict[str, Any] = {
        'question_type': question_type,
        'question_text': str(item.get('text') or ''),
        'option_a': '', 'option_b': '', 'option_c': '', 'option_d': '',
        'correct_answer': '',
        'answer_text': '',
        'type_data': {},
        'bloom_level': item.get('bloom_level') or None,
    }
    if question_type == 'MCQ':
        options = [o if isinstance(o, dict) else {'text': o} for o in (item.get('options') or [])]
        for letter, option in zip('abcd', options):
            fields[f'option_{letter}'] = str(option.get('text') or '')
        fields['correct_answer'] = str(item.get('answer') or '')
        fields['type_data'] = {'options': options}
    elif question_type == 'TRUE_FALSE':
        fields['correct_answer'] = str(item.get('answer') or '')
    elif question_type == 'FILL_BLANK':
        answers = [str(a) for a in (item.get('answers') or [])]
        fields['type_data'] = {'items': answers, 'accepted_answers': answers}
    else:
        fields['answer_text'] = str(item.get('answer') or '')
    if item.get('picture'):
        fields['type_data'] = {**fields['type_data'], 'picture': item['picture']}
    return fields


def _block_question_fields(block: Dict[str, Any]) -> Dict[str, Any]:
    fields = {
        'question_text': str(block.get('title') or BLOCK_TYPES[block['type']]['label']),
        'option_a': '', 'option_b': '', 'option_c': '', 'option_d': '',
        'correct_answer': '', 'answer_text': '',
    }
    if block['type'] == 'matching':
        items = [item for item in (block.get('data') or {}).get('items') or [] if isinstance(item, dict)]
        # The question bank's own shape (two lists linked by index), the one its form and serializer use, so a
        # matching question made here opens there with its pairs. matching_pairs reads either shape back.
        fields.update(question_type=QuestionType.MATCHING, type_data={
            'left_items': [str(item.get('left') or '') for item in items],
            'right_items': [str(item.get('right') or '') for item in items],
            'pairs': [{'left': index, 'right': index} for index in range(len(items))],
        })
    else:
        fields.update(
            question_type=QuestionType.ACTIVITY,
            type_data={'block': {k: deepcopy(block.get(k)) for k in ('type', 'title', 'marks', 'data')}},
        )
    return fields


def _same_content(question: Question, name: str, value: Any, fields: Dict[str, Any]) -> bool:
    """Whether a bank question already holds this field. Matching pairs are compared as pairs, not as stored, so a
    question kept in the block editor's older text-pair shape is still recognised as unchanged (no needless copy)."""
    current = getattr(question, name)
    if name == 'type_data' and fields.get('question_type') == QuestionType.MATCHING:
        return (isinstance(current, dict) and isinstance(value, dict)
                and matching_pairs(current) == matching_pairs(value))
    return _without_block_marks(current) == _without_block_marks(value)


def _without_block_marks(value: Any) -> Any:
    """An activity question keeps its whole block, marks included, in ``type_data``; those marks are
    left out when deciding whether a bank question was edited."""
    if isinstance(value, dict) and isinstance(value.get('block'), dict):
        return {**value, 'block': {k: v for k, v in value['block'].items() if k != 'marks'}}
    return value


def _save_question(owner: '_Owner', user, question_id: Any, fields: Dict[str, Any], marks: Decimal,
                   reusable: Dict[int, Question], others: Dict[int, Question]) -> Question:
    """Which bank question a block or part ends up linked to:
    - linked to this paper only: updated in place;
    - from the bank or another paper (``others``): reused as it is when unchanged, copied when edited,
      so a question another paper uses never changes under it;
    - none: a new bank question."""
    fields = {**fields, 'marks': marks, 'subject_id': owner.subject_id}
    question = reusable.get(question_id) if isinstance(question_id, int) else None
    if question is None:
        other = others.get(question_id) if isinstance(question_id, int) else None
        # Marks belong to the paper (marks_override), so a different mark is not an edit.
        content = {k: v for k, v in fields.items() if k != 'marks'}
        if other is not None and all(_same_content(other, k, v, fields) for k, v in content.items()):
            return other
        question = Question(school_id=owner.school_id, created_by=user, **fields)
        question.save()
        return question
    changed = [name for name, value in fields.items() if getattr(question, name) != value]
    if changed:
        for name in changed:
            setattr(question, name, fields[name])
        question.save()
    return question


def _referenced_question_ids(document: Dict[str, Any]) -> List[int]:
    ids = []
    for block in document.get('blocks') or []:
        candidates = [block] + [i for i in ((block.get('data') or {}).get('items') or []) if isinstance(i, dict)]
        ids.extend(c['question_id'] for c in candidates
                   if isinstance(c.get('question_id'), int) and not isinstance(c.get('question_id'), bool))
    return ids


def _block_marks_or_none(owner: '_Owner', value: Any) -> Optional[Decimal]:
    """A worksheet block may have no marks (ungraded practice); a paper block always counts."""
    if owner.is_worksheet and value is None:
        return None
    return _decimal(value)


def sync_questions(paper, document: Dict[str, Any], user) -> Dict[str, Any]:
    """Make the paper's (or worksheet's) bank questions match ``document`` (already normalised). Returns
    the document with every block or part carrying its ``question_id``. Call inside a transaction."""
    owner = _Owner(paper)
    document = deepcopy(document)
    existing = {link.question_id: link for link in owner.links()}
    linked_ids = set(existing)
    shared = owner.shared_question_ids(linked_ids)
    reusable = {qid: link.question for qid, link in existing.items() if qid not in shared}
    referenced = {qid for qid in _referenced_question_ids(document) if qid not in reusable}
    others = {q.id: q for q in Question.objects.filter(id__in=referenced, school_id=owner.school_id)}

    kept: List[int] = []
    order = 0

    def attach(question: Question, section_key: str, marks: Optional[Decimal]) -> None:
        nonlocal order
        order += 1
        link = existing.get(question.id) or owner.new_link(question)
        order_name = owner.order_name(link)
        changed = (not link.pk or getattr(link, order_name) != order
                   or link.section_key != section_key[:50] or link.marks_override != marks)
        setattr(link, order_name, order)
        link.section_key, link.marks_override = section_key[:50], marks
        if changed:
            link.save()
        snapshot_name = owner.snapshot_name(link)
        snapshot = owner.build_snapshot(link)
        if snapshot != getattr(link, snapshot_name):
            setattr(link, snapshot_name, snapshot)
            link.save(update_fields=[snapshot_name])
        kept.append(link.id)

    used: set = set()

    def first_use(question_id: Any) -> Any:
        # A paper links a bank question once (PaperQuestion / WorksheetItem are unique per owner and
        # question), so a second use of the same question is saved as its own copy.
        return None if question_id in used else question_id

    def keep_unfinished(holder: Dict[str, Any], section_key: str, marks: Optional[Decimal]) -> None:
        # A question still being written is not copied into the bank: empty bank questions helped nobody.
        # One already linked keeps its link (and its last complete text) until the part is complete again.
        question_id = first_use(holder.get('question_id'))
        question = reusable.get(question_id) or others.get(question_id) if isinstance(question_id, int) else None
        if question is None:
            holder.pop('question_id', None)
            return
        used.add(question.id)
        attach(question, section_key, marks)

    for block in document['blocks']:
        block_type = block['type']
        if block_type in LAYOUT_BLOCKS:
            continue
        if block_type in WHOLE_BLOCK_QUESTIONS:
            marks = _block_marks_or_none(owner, block.get('marks'))
            if block_to_fill(block):
                keep_unfinished(block, block['id'], marks)
                continue
            question = _save_question(owner, user, first_use(block.get('question_id')), _block_question_fields(block),
                                      marks or Decimal('0'), reusable, others)
            block['question_id'] = question.id
            used.add(question.id)
            reusable.setdefault(question.id, question)
            attach(question, block['id'], marks)
            continue
        item_marks = (None if owner.is_worksheet and block.get('marks') is None
                      else _decimal(per_item_marks(block) or 0))
        for item in (block.get('data') or {}).get('items') or []:
            if not isinstance(item, dict):
                continue
            if item_to_fill(block_type, item):
                keep_unfinished(item, block['id'], item_marks)
                continue
            question = _save_question(owner, user, first_use(item.get('question_id')),
                                      _text_question_fields(block_type, item), item_marks or Decimal('0'),
                                      reusable, others)
            item['question_id'] = question.id
            used.add(question.id)
            reusable.setdefault(question.id, question)
            attach(question, block['id'], item_marks)

    owner.links().exclude(id__in=kept).delete()
    return document


def save_document(paper, document: Dict[str, Any], user) -> Dict[str, Any]:
    """Normalise, sync the question bank, and store the document (and, for a paper, its total). Call
    inside a transaction, after ``check_document`` and ``owner_problems``."""
    document = sync_questions(paper, normalize_document(document), user)
    paper.document = document
    if isinstance(paper, Worksheet):
        paper.save(update_fields=['document', 'updated_at'])
        return document
    paper.total_marks = _decimal(total_marks(document))
    paper.save(update_fields=['document', 'total_marks', 'updated_at'])
    return document


# ------------------------------------------------------------------ old papers

def _picture_from_url(url: Optional[str]) -> Optional[Dict[str, str]]:
    return {'url': url} if url else None


def _item_from_snapshot(data: Dict[str, Any], question_id: int) -> Tuple[str, Dict[str, Any]]:
    question_type = str(data.get('question_type') or 'SHORT').upper()
    type_data = data.get('type_data') if isinstance(data.get('type_data'), dict) else {}
    item: Dict[str, Any] = {'question_id': question_id, 'text': data.get('question_text') or ''}
    picture = _picture_from_url(data.get('question_image_url'))
    if question_type == 'MCQ':
        options = []
        for letter in 'abcd':
            text = data.get(f'option_{letter}') or ''
            option_picture = _picture_from_url(data.get(f'option_{letter}_image_url'))
            if text or option_picture:
                options.append({'text': text, **({'picture': option_picture} if option_picture else {})})
        item['options'] = options
        if data.get('correct_answer') in ('A', 'B', 'C', 'D'):
            item['answer'] = data['correct_answer']
    elif question_type == 'TRUE_FALSE':
        answer = str(data.get('correct_answer') or '').upper()
        if answer in ('TRUE', 'FALSE'):
            item['answer'] = answer
    elif question_type == 'FILL_BLANK':
        item['answers'] = [str(a) for a in (type_data.get('accepted_answers') or type_data.get('items') or [])]
    elif question_type in ('SHORT', 'LONG', 'ESSAY'):
        if data.get('answer_text'):
            item['answer'] = data['answer_text']
    if picture and question_type != 'MATCHING':
        item['picture'] = picture
    return question_type, item


def _blocks_for_run(question_type: str, rows: List[Tuple[Dict[str, Any], Decimal]], title: str,
                    attempt: Optional[int], section_marks: Optional[Decimal]) -> List[Dict[str, Any]]:
    block_type = TYPE_TO_BLOCK.get(question_type, 'short_answer')
    if block_type == 'matching':
        # One matching question = one block (its pairs are the block's parts).
        blocks = []
        for item, marks in rows:
            pairs = item.get('pairs') or []
            blocks.append({
                'id': _new_id(), 'type': 'matching', 'title': item.get('text') or title, 'marks': float(marks),
                'question_id': item['question_id'], 'data': {'items': pairs},
            })
        return blocks
    marks = section_marks if section_marks is not None else sum((m for _, m in rows), Decimal('0'))
    data: Dict[str, Any] = {'items': [item for item, _ in rows]}
    if attempt and attempt < len(rows):
        data['attempt'] = attempt
    if block_type in ('short_answer', 'long_answer', 'essay'):
        data['lines'] = {'short_answer': 2, 'long_answer': 8, 'essay': 15}[block_type]
    return [{'id': _new_id(), 'type': block_type, 'title': title, 'marks': float(marks), 'data': data}]


def _rows_for(questions) -> List[Tuple[str, Dict[str, Any], Decimal]]:
    rows = []
    for pq in questions:
        data = pq.get_question_data()
        question_type, item = _item_from_snapshot(data, pq.question_id)
        if pq.question.bloom_level and question_type != 'MATCHING':
            # Not in the snapshot; the bank question has it.
            item['bloom_level'] = pq.question.bloom_level
        if question_type == 'MATCHING':
            type_data = data.get('type_data') if isinstance(data.get('type_data'), dict) else {}
            item['pairs'] = matching_pairs(type_data)
        rows.append((question_type, item, _decimal(pq.get_marks())))
    return rows


def matching_pairs(type_data: Dict[str, Any]) -> List[Dict[str, str]]:
    """A matching question's pairs as text. Two shapes exist: the question bank form's (``left_items``,
    ``right_items`` and ``pairs`` linking their indexes) and the block editor's (``pairs`` of texts).
    Found in step 7b: old papers read only the second, so their matching questions printed empty.
    A left item with no link gets an empty right side; extra right items (distractors) have no place in a block."""
    pairs = [p for p in (type_data.get('pairs') or []) if isinstance(p, dict)]
    lefts, rights = type_data.get('left_items'), type_data.get('right_items')
    if isinstance(lefts, list) and isinstance(rights, list):
        linked = {p.get('left'): p.get('right') for p in pairs
                  if isinstance(p.get('left'), int) and not isinstance(p.get('left'), bool)}
        out = []
        for index, left in enumerate(lefts):
            right = linked.get(index)
            valid = isinstance(right, int) and not isinstance(right, bool) and 0 <= right < len(rights)
            out.append({'left': str(left or ''), 'right': str(rights[right] or '') if valid else ''})
        return out
    return [{'left': str(p.get('left') or ''), 'right': str(p.get('right') or '')} for p in pairs]


def _runs(rows):
    """Consecutive questions of the same type, so a mixed section becomes one block per type."""
    runs: List[Tuple[str, List[Tuple[Dict[str, Any], Decimal]]]] = []
    for question_type, item, marks in rows:
        if runs and runs[-1][0] == question_type and question_type != 'MATCHING':
            runs[-1][1].append((item, marks))
        else:
            runs.append((question_type, [(item, marks)]))
    return runs


def _ungraded(blocks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """An old worksheet item without marks gives 0; a worksheet block prints no marks instead."""
    for block in blocks:
        if 'marks' in block and not block['marks']:
            block.pop('marks')
    return blocks


def convert_old_paper(paper) -> Dict[str, Any]:
    """The old wizard's paper (or old worksheet: same structure and link shape) as blocks. Nothing is
    saved here: it only changes when the teacher saves it in the new editor."""
    owner = _Owner(paper)
    questions = owner.ordered_links()
    structure = paper.structure if isinstance(paper.structure, list) else []
    blocks: List[Dict[str, Any]] = []
    by_key: Dict[str, List[PaperQuestion]] = {}
    for pq in questions:
        by_key.setdefault(pq.section_key or '', []).append(pq)
    used_keys = set()

    for section in structure:
        if not isinstance(section, dict):
            continue
        if str(section.get('type', 'question_group')).lower() == 'divider':
            blocks.append({'id': _new_id(), 'type': 'section_heading', 'title': section.get('title') or ''})
            continue
        key = str(section.get('key') or '')
        used_keys.add(key)
        rows = _rows_for(by_key.get(key, []))
        if not rows:
            continue
        section_type = str(section.get('question_type') or rows[0][0]).upper()
        title = section.get('instruction') or DEFAULT_TYPE_INSTRUCTIONS.get(section_type) or section.get('title') or ''
        runs = _runs(rows)
        single = len(runs) == 1
        try:
            counted = int(section.get('slots_counted', section.get('slots_shown', 0)) or 0)
        except (TypeError, ValueError):
            counted = 0
        section_marks = _decimal(counted) * _decimal(section.get('marks_per_question', 0)) if single and counted else None
        for question_type, run in runs:
            blocks.extend(_blocks_for_run(question_type, run, title, counted if single else None, section_marks))

    leftover = [pq for pq in questions if (pq.section_key or '') not in used_keys]
    for question_type, run in _runs(_rows_for(leftover)):
        blocks.extend(_blocks_for_run(question_type, run, DEFAULT_TYPE_INSTRUCTIONS.get(question_type, ''), None, None))

    if owner.is_worksheet:
        return {'version': DOCUMENT_VERSION, 'direction': 'ltr', 'header': {}, 'blocks': _ungraded(blocks)}
    return {
        'version': DOCUMENT_VERSION,
        'direction': 'ltr',
        'header': {'show_time_marks': True},
        'blocks': blocks,
    }


def document_for_editor(paper) -> Tuple[Dict[str, Any], bool]:
    """(document, converted). ``converted`` is True when it was made from an old-style paper."""
    if paper.document and paper.document.get('blocks') is not None:
        return paper.document, False
    if not paper.structure and not _Owner(paper).links().exists():
        # A new, empty paper: nothing to convert.
        return {'version': DOCUMENT_VERSION, 'direction': 'ltr', 'header': {}, 'blocks': []}, False
    return convert_old_paper(paper), True
