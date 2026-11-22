"""The answer key of a block paper or worksheet (Paper Builder v2, step 7b): a short sheet for the teacher,
not a copy of the paper. Same header as the paper plus "Answer key, not for students", then each question
number with its answers. One list of answers (``key_questions``) feeds both the page and the Word file.

What each block type gives:
- text blocks: the answers the teacher saved (MCQ correct option, true/false, the blanks, model answers or
  points to look for, matching pairs with the letters Column B is printed with);
- count and write: each row's count; find and colour: how many circles hold the target;
- every other activity block: "Marked by the teacher".
An item whose answer was never saved prints "No answer saved", and the sheet says how many there are.
"""
from dataclasses import dataclass, field
from html import escape
from typing import Any, Dict, List

from ..html_sanitize import sanitize_for_docx, sanitize_for_html
from .registry import block_marks, format_marks, is_question
from .text_blocks import BLANK, OPTION_KEYS, _right_key, items_of, option_key, part_label, shuffled_right
from .urdu import is_rtl, labels_for

KEY_LABELS = {
    'en': {
        'title': 'Answer key', 'not_for_students': 'Not for students', 'no_answer': 'No answer saved',
        'missing': '{n} part(s) have no answer saved. Add them in the editor to complete this key.',
        'teacher': 'Marked by the teacher', 'true': 'True', 'false': 'False', 'row': 'Row {n}',
        'colour': 'Colour {n} circle(s) with {t}', 'colour_none': 'No circle holds {t}',
    },
    'ur': {
        'title': 'جوابات', 'not_for_students': 'طلبہ کے لیے نہیں', 'no_answer': 'جواب محفوظ نہیں',
        'missing': '{n} حصوں کا جواب محفوظ نہیں۔ یہ جوابات مکمل کرنے کے لیے ایڈیٹر میں شامل کریں۔',
        'teacher': 'استاد خود جانچیں', 'true': 'درست', 'false': 'غلط', 'row': 'قطار {n}',
        'colour': '{t} والے {n} دائرے رنگ کریں', 'colour_none': 'کسی دائرے میں {t} نہیں',
    },
}


@dataclass
class KeyLine:
    label: str          # part label ("ii", "ب") or '' for a line that belongs to the whole question
    html: str           # cleaned HTML for the page
    text: str           # plain text for Word
    missing: bool = False


@dataclass
class KeyQuestion:
    number: int
    title: str
    marks: Any
    lines: List[KeyLine] = field(default_factory=list)


def key_labels(document: Dict[str, Any]) -> Dict[str, str]:
    return KEY_LABELS['ur' if is_rtl(document) else 'en']


def _rich(value: Any) -> KeyLine:
    return KeyLine('', sanitize_for_html(str(value or '')), sanitize_for_docx(str(value or '')))


def _plain(text: str) -> KeyLine:
    return KeyLine('', escape(text), text)


def _missing(label: str, words: Dict[str, str]) -> KeyLine:
    return KeyLine(label, f'<i class="nokey">{escape(words["no_answer"])}</i>', words['no_answer'], missing=True)


def _labelled(line: KeyLine, label: str) -> KeyLine:
    line.label = label
    return line


def _mcq(block, labels, words) -> List[KeyLine]:
    style = (block.get('data') or {}).get('numbering') or 'roman'
    lines = []
    for index, item in enumerate(items_of(block), start=1):
        label = part_label(index, style, labels)
        answer = str(item.get('answer') or '').strip().upper()
        options = [o if isinstance(o, dict) else {'text': o} for o in (item.get('options') or [])]
        position = OPTION_KEYS.find(answer) if answer else -1
        if position < 0 or position >= len(options):
            lines.append(_missing(label, words))
            continue
        letter = option_key(position, labels)
        option = _rich(options[position].get('text'))
        lines.append(KeyLine(label, f'<b>{escape(letter)}.</b> {option.html}', f'{letter}. {option.text}'.strip()))
    return lines


def _true_false(block, labels, words) -> List[KeyLine]:
    style = (block.get('data') or {}).get('numbering') or 'roman'
    lines = []
    for index, item in enumerate(items_of(block), start=1):
        label = part_label(index, style, labels)
        answer = str(item.get('answer') or '').strip().upper()
        if answer not in ('TRUE', 'FALSE'):
            lines.append(_missing(label, words))
            continue
        word = words['true' if answer == 'TRUE' else 'false']
        lines.append(KeyLine(label, f'<b>{escape(word)}</b>', word))
    return lines


def _filled(text: str, answers: List[str], wrap) -> str:
    """Each blank (three or more underscores) takes the next answer; answers left over go at the end."""
    queue = list(answers)

    def take(_match):
        return wrap(queue.pop(0)) if queue else _match.group(0)
    filled = BLANK.sub(take, text)
    if queue:
        filled = f'{filled} ' + ', '.join(wrap(a) for a in queue)
    return filled


def _fill_blank(block, labels, words) -> List[KeyLine]:
    style = (block.get('data') or {}).get('numbering') or 'roman'
    lines = []
    for index, item in enumerate(items_of(block), start=1):
        label = part_label(index, style, labels)
        answers = [str(a).strip() for a in (item.get('answers') or []) if str(a).strip()]
        if not answers:
            lines.append(_missing(label, words))
            continue
        html = _filled(sanitize_for_html(str(item.get('text') or '')), answers, lambda a: f'<b class="ans">{escape(a)}</b>')
        text = _filled(sanitize_for_docx(str(item.get('text') or '')), answers, lambda a: f'[{a}]')
        lines.append(KeyLine(label, html, text))
    return lines


def _written(block, labels, words) -> List[KeyLine]:
    style = (block.get('data') or {}).get('numbering') or 'roman'
    lines = []
    for index, item in enumerate(items_of(block), start=1):
        label = part_label(index, style, labels)
        if not sanitize_for_docx(str(item.get('answer') or '')).strip():
            lines.append(_missing(label, words))
            continue
        lines.append(_labelled(_rich(item.get('answer')), label))
    return lines


def _matching(block, labels, words) -> List[KeyLine]:
    """Column B is printed shuffled (text_blocks.shuffled_right); the key gives each left item the letter its
    match is printed with. A repeated right-hand text takes the next free letter, so no letter is used twice."""
    items = items_of(block)
    printed = shuffled_right(block)
    free = list(range(len(printed)))
    lines = []
    for index, item in enumerate(items, start=1):
        right = str(item.get('right') or '')
        position = next((p for p in free if printed[p] == right), None)
        if position is None:
            lines.append(_missing(str(index), words))
            continue
        free.remove(position)
        letter = _right_key(position + 1, labels)
        left = str(item.get('left') or '')
        lines.append(KeyLine(str(index), f'{escape(left)} → <b>{escape(letter)}.</b> {escape(right)}',
                             f'{left} → {letter}. {right}'))
    return lines


def _count_write(block, labels, words) -> List[KeyLine]:
    rows = [row for row in ((block.get('data') or {}).get('rows') or []) if isinstance(row, dict)]
    return [_plain(f'{words["row"].format(n=i)}: {row.get("count")}') for i, row in enumerate(rows, start=1)]


def _find_colour(block, labels, words) -> List[KeyLine]:
    data = block.get('data') or {}
    target = str(data.get('target') or '').strip()
    if not target:
        return [_missing('', words)]
    # The page draws at most 20 circles (layouts.FIND_COLOUR_MAX); count only what is printed.
    from .layouts import FIND_COLOUR_MAX
    count = sum(1 for item in (data.get('items') or [])[:FIND_COLOUR_MAX] if str(item).strip().lower() == target.lower())
    return [_plain(words['colour'].format(n=count, t=target) if count else words['colour_none'].format(t=target))]


KEY_BUILDERS = {
    'mcq': _mcq, 'true_false': _true_false, 'fill_blank': _fill_blank,
    'short_answer': _written, 'long_answer': _written, 'essay': _written,
    'matching': _matching, 'count_write': _count_write, 'find_colour': _find_colour,
}


def key_questions(document: Dict[str, Any]) -> List[Any]:
    """Questions in paper order (numbered like the paper), with section headings kept as plain strings."""
    labels, words = labels_for(document), key_labels(document)
    out: List[Any] = []
    number = 0
    for block in document.get('blocks') or []:
        if not isinstance(block, dict):
            continue
        if not is_question(block):
            out.append(str(block.get('title') or ''))
            continue
        number += 1
        builder = KEY_BUILDERS.get(block.get('type'))
        lines = builder(block, labels, words) if builder else [_plain(words['teacher'])]
        marks = format_marks(block_marks(block)) if block.get('marks') is not None else None
        out.append(KeyQuestion(number, str(block.get('title') or ''), marks, lines))
    return out


def missing_count(questions: List[Any]) -> int:
    return sum(1 for q in questions if isinstance(q, KeyQuestion) for line in q.lines if line.missing)


KEY_CSS = """
.keyban { text-align: center; margin: 1mm 0 5mm; font: 700 12pt Georgia, "Times New Roman", serif; color: #b91c1c;
          letter-spacing: .3px; }
.keynote { margin: 0 0 4mm; padding: 2mm 3mm; border: 1px solid #f59e0b; background: #fffbeb; font-size: 10pt; }
.nokey { color: #b45309; }
.ans { text-decoration: underline; }
.keyq .part { margin-bottom: 1.6mm; }
.keyq .solo { margin: 0 0 1.6mm; }
"""


def render_key_html(document: Dict[str, Any]) -> str:
    """The key as one A4 page, printed on the device like the paper."""
    from .html_renderer import _text, _with_ordinals, page_html, subject_label_key
    labels, words = labels_for(document), key_labels(document)
    header = document.get('header') or {}
    questions = key_questions(document)
    parts = ['<header class="head">', f'<h1>{_text(header.get("school_name"))}</h1>']
    if header.get('exam_title'):
        parts.append(f'<p>{_with_ordinals(header["exam_title"])}</p>')
    meta = []
    if header.get('subject'):
        meta.append(f'<span>{labels[subject_label_key(header)]}: {_text(header["subject"])}</span>')
    if header.get('class_name'):
        meta.append(f'<span>{labels["class"]}: {_text(header["class_name"])}</span>')
    if meta:
        parts.append(f'<p class="meta">{"".join(meta)}</p>')
    parts.append(f'</header><div class="keyban">{escape(words["title"])} — {escape(words["not_for_students"])}</div>')
    missing = missing_count(questions)
    if missing:
        parts.append(f'<div class="keynote">{escape(words["missing"].format(n=missing))}</div>')
    for entry in questions:
        if isinstance(entry, str):
            parts.append(f'<h2 class="section">{_text(entry)}</h2>')
            continue
        marks = f'<span class="marks">({entry.marks})</span>' if entry.marks is not None else ''
        title = f'<div class="q-title"><span>{labels["question"].format(n=entry.number)} {_text(entry.title)}</span>{marks}</div>'
        body = []
        for line in entry.lines:
            if line.label:
                body.append(f'<li class="part"><span class="pn">({escape(line.label)})</span><div class="pt">{line.html}</div></li>')
            else:
                body.append(f'<p class="solo">{line.html}</p>')
        items = ''.join(body)
        listed = f'<ol class="parts">{items}</ol>' if any(line.label for line in entry.lines) else items
        parts.append(f'<section class="q text keyq">{title}{listed}</section>')
    footer = document.get('footer') or ''
    keyed = dict(document, footer=f'{words["title"]} — {footer}' if footer else words['title'])
    return page_html(keyed, ''.join(parts), KEY_CSS)


def render_key_docx(document: Dict[str, Any]) -> bytes:
    """The key as a Word file, for teachers who keep their keys in Word."""
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Pt

    from .docx_renderer import SERIF, _footer, _ordinal_runs, _right_tab, _run, finish_document, new_document
    from .html_renderer import subject_label_key
    from .text_blocks import _part_paragraph

    labels, words = labels_for(document), key_labels(document)
    header = document.get('header') or {}
    questions = key_questions(document)
    doc = new_document()

    def centred(text, **style):
        paragraph = doc.add_paragraph()
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _run(paragraph, text, **style)
        return paragraph

    centred(str(header.get('school_name') or ''), bold=True, size=19, font=SERIF, underline=True)
    if header.get('exam_title'):
        paragraph = doc.add_paragraph()
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _ordinal_runs(paragraph, str(header['exam_title']), bold=True, size=12, font=SERIF)
    meta = [f'{labels[label]}: {header[key]}' for label, key in ((subject_label_key(header), 'subject'), ('class', 'class_name'))
            if header.get(key)]
    if meta:
        centred('      '.join(meta), bold=True, size=12, font=SERIF)
    centred(f'{words["title"]} — {words["not_for_students"]}', bold=True, size=12, font=SERIF, color=(0xB9, 0x1C, 0x1C))
    missing = missing_count(questions)
    if missing:
        paragraph = doc.add_paragraph()
        _run(paragraph, words['missing'].format(n=missing), size=10, color=(0xB4, 0x53, 0x09))

    for entry in questions:
        if isinstance(entry, str):
            paragraph = centred(entry, bold=True, size=13, font=SERIF, underline=True)
            paragraph.paragraph_format.space_before = Pt(10)
            continue
        paragraph = doc.add_paragraph()
        paragraph.paragraph_format.space_before = Pt(8)
        paragraph.paragraph_format.keep_with_next = True
        _right_tab(paragraph)
        _run(paragraph, f'{labels["question"].format(n=entry.number)} {entry.title}', bold=True, size=12)
        if entry.marks is not None:
            _run(paragraph, f'\t({entry.marks})', bold=True, size=12)
        for line in entry.lines:
            if line.label:
                _part_paragraph(doc, line.label, line.text)
            else:
                doc.add_paragraph(line.text)
    footer = document.get('footer') or ''
    _footer(doc, dict(document, footer=f'{words["title"]} — {footer}' if footer else words['title']), labels)
    return finish_document(doc, document)

