"""How text blocks look: multiple choice, true/false, fill in the blanks, short/long answers, essays,
matching, and section headings. Each has an HTML form (the printed page) and a Word form.

Question text is teacher HTML from the rich editor. It always goes through ``html_sanitize`` first:
``sanitize_for_html`` for the page, ``sanitize_for_docx`` (plain text) for Word.
"""
import hashlib
import random
import re
from html import escape
from typing import Any, Callable, Dict, List

from ..html_sanitize import sanitize_for_docx, sanitize_for_html
from .urdu import LABELS, URDU_LETTERS, urdu_letter

BLANK = re.compile(r'_{3,}')
ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv',
         'xvi', 'xvii', 'xviii', 'xix', 'xx']
OPTION_KEYS = 'ABCDEF'


EN = LABELS['en']


def _urdu(labels) -> bool:
    return labels is not None and labels.get('name') == LABELS['ur']['name']


def part_label(index: int, style: str, labels=None) -> str:
    """index counts from 1. Roman numerals run out at 20, after that parts are numbered. Urdu papers
    letter their parts الف، ب، ج for both the roman and the letter style."""
    if _urdu(labels) and style != 'number':
        return urdu_letter(index)
    if style == 'letter':
        return chr(ord('a') + (index - 1) % 26)
    if style == 'number' or index > len(ROMAN):
        return str(index)
    return ROMAN[index - 1]


def items_of(block: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [item for item in ((block.get('data') or {}).get('items') or []) if isinstance(item, dict)]


def option_key(index: int, labels=None) -> str:
    """index counts from 0: A, B, C or الف، ب، ج."""
    return URDU_LETTERS[index] if _urdu(labels) else OPTION_KEYS[index]


def attempt_note(block: Dict[str, Any], labels=None) -> str:
    attempt = (block.get('data') or {}).get('attempt')
    count = len(items_of(block))
    if isinstance(attempt, int) and not isinstance(attempt, bool) and 0 < attempt < count:
        return (labels or EN)['attempt'].format(n=attempt)
    return ''


def shuffled_right(block: Dict[str, Any]) -> List[str]:
    """Column B in a fixed shuffled order: the same paper always prints the same way, but the answer
    is not simply next to its question. Seeded from the block's id (or its content)."""
    rights = [str(item.get('right') or '') for item in items_of(block)]
    seed_text = str(block.get('id') or '') or '|'.join(rights)
    rng = random.Random(int(hashlib.sha1(seed_text.encode('utf-8')).hexdigest()[:12], 16))
    order = list(range(len(rights)))
    for _ in range(5):
        rng.shuffle(order)
        if len(order) < 2 or any(i != j for i, j in enumerate(order)):
            break
    return [rights[i] for i in order]


def _option_columns(block: Dict[str, Any], options: List[Dict[str, Any]]) -> int:
    setting = str((block.get('data') or {}).get('columns') or 'auto')
    if setting in ('1', '2', '4'):
        return int(setting)
    if any(o.get('picture') for o in options):
        return 4 if len(options) <= 4 else 2
    longest = max((len(sanitize_for_docx(o.get('text') or '')) for o in options), default=0)
    if longest <= 14 and len(options) <= 4:
        return 4
    return 2 if longest <= 34 else 1


# ---------------------------------------------------------------- HTML

TEXT_CSS = """
.parts { list-style: none; margin: 0; padding: 0; }
.part { display: flex; gap: 2.5mm; margin: 0 0 2.6mm; break-inside: avoid; }
.part .pn { min-width: 8mm; font-weight: 700; }
.part .pt { flex: 1; min-width: 0; }
.part .pt p { margin: 0 0 1mm; }
.part .pt table { border-collapse: collapse; margin: 1mm 0; }
.part .pt td, .part .pt th { border: 1px solid #94a3b8; padding: 1mm 2mm; }
.part img.qpic { float: inline-end; max-width: 45mm; max-height: 35mm; margin-block: 0 1mm; margin-inline: 3mm 0; }
.opts { display: grid; gap: 1mm 4mm; margin-top: 1.2mm; }
.opts.c1 { grid-template-columns: 1fr; } .opts.c2 { grid-template-columns: 1fr 1fr; }
.opts.c4 { grid-template-columns: repeat(4, 1fr); }
.missing { display: inline-flex; align-items: center; justify-content: center; width: 30mm; height: 20mm;
           border: 1.2px dashed #cbd5e1; color: #94a3b8; font-size: 8pt; }
/* The rich editor wraps every option in a paragraph; keep option text on the line of its letter. */
.opt > div, .opt > p, .opt > div > p { display: inline; margin: 0; }
.opt img { display: block; max-width: 30mm; max-height: 22mm; margin-top: .8mm; }
.tf { white-space: nowrap; font-weight: 700; margin-inline-start: 4mm; }
.blank { display: inline-block; min-width: 28mm; border-bottom: 1.2px solid #1f2937; height: 1em; vertical-align: baseline; }
.lines { clear: both; padding-top: 1mm; }
.lines div { height: 8mm; border-bottom: 1px solid #94a3b8; }
.matching { width: 100%; border-collapse: collapse; }
.matching th { text-align: start; border-bottom: 1.5px solid #1f2937; padding: 1.2mm 2mm; }
.matching td { padding: 1.8mm 2mm; border-bottom: 1px solid #e2e8f0; vertical-align: top; width: 50%; }
.matching td b { display: inline-block; min-width: 6mm; }
.note { font-weight: 400; font-style: italic; color: #475569; font-size: 10pt; margin-inline-start: 2mm; }
h2.section { text-align: center; font: 700 13pt Georgia, "Times New Roman", serif; margin: 2mm 0 4mm;
             text-decoration: underline; break-after: avoid; }
"""


def _rich(value: Any) -> str:
    return sanitize_for_html(str(value or ''))


def _picture_img(store, ref, css_class='qpic') -> str:
    if not ref:
        return ''
    from .scene import Scene
    holder = Scene(1, 1)
    holder.picture(ref, 0, 0, 1, 1)
    kind, p = holder.items[0] if holder.items else (None, None)
    if kind != 'picture':
        # A picture drawn by code: inline SVG keeps it sharp.
        from .scene import to_svg
        from .makers import make
        drawn = make(ref) if isinstance(ref, dict) else None
        return f'<span class="{css_class}">{to_svg(drawn, store)}</span>' if drawn else ''
    uri = store.data_uri(p['name'])
    if not uri:
        # Same as a missing picture in an activity block: an empty named box, so the teacher sees it.
        return f'<span class="{css_class} missing">{escape(str(p["name"]))}</span>'
    return f'<img class="{css_class}" src="{escape(uri, quote=True)}" alt="">'


def _part(label: str, inner: str, extra: str = '') -> str:
    return f'<li class="part"><span class="pn">({escape(label)})</span><div class="pt">{inner}</div>{extra}</li>'


def _lines_html(count: int) -> str:
    return f'<div class="lines">{"<div></div>" * count}</div>' if count > 0 else ''


def _mcq_html(block, store, labels=None) -> str:
    style = (block.get('data') or {}).get('numbering') or 'roman'
    parts = []
    for index, item in enumerate(items_of(block), start=1):
        options = [o if isinstance(o, dict) else {'text': o} for o in (item.get('options') or [])][:6]
        columns = _option_columns(block, options)
        cells = ''.join(
            f'<span class="opt"><b>{option_key(i, labels)}.</b> {_rich(o.get("text"))}{_picture_img(store, o.get("picture"), "")}</span>'
            for i, o in enumerate(options)
        )
        inner = f'{_picture_img(store, item.get("picture"))}{_rich(item.get("text"))}<div class="opts c{columns}">{cells}</div>'
        parts.append(_part(part_label(index, style, labels), inner))
    return f'<ol class="parts">{"".join(parts)}</ol>'


def _true_false_html(block, store, labels=None) -> str:
    style = (block.get('data') or {}).get('numbering') or 'roman'
    return '<ol class="parts">' + ''.join(
        _part(part_label(i, style, labels), f'{_picture_img(store, item.get("picture"))}{_rich(item.get("text"))}',
              f'<span class="tf">{(labels or EN)["true_false"]}</span>')
        for i, item in enumerate(items_of(block), start=1)
    ) + '</ol>'


def _fill_blank_html(block, store, labels=None) -> str:
    style = (block.get('data') or {}).get('numbering') or 'roman'
    parts = []
    for index, item in enumerate(items_of(block), start=1):
        text = _rich(item.get('text'))
        text, found = BLANK.subn('<span class="blank"></span>', text)
        if not found:
            text += ' <span class="blank"></span>'
        parts.append(_part(part_label(index, style, labels), f'{_picture_img(store, item.get("picture"))}{text}'))
    return f'<ol class="parts">{"".join(parts)}</ol>'


def _written_html(default_lines: int) -> Callable:
    def render(block, store, labels=None) -> str:
        data = block.get('data') or {}
        style = data.get('numbering') or 'roman'
        lines = data.get('lines') if isinstance(data.get('lines'), int) else default_lines
        return '<ol class="parts">' + ''.join(
            _part(part_label(i, style, labels),
                  f'{_picture_img(store, item.get("picture"))}{_rich(item.get("text"))}{_lines_html(lines)}')
            for i, item in enumerate(items_of(block), start=1)
        ) + '</ol>'
    return render


def _matching_html(block, store, labels=None) -> str:
    labels = labels or EN
    lefts = [str(item.get('left') or '') for item in items_of(block)]
    rights = shuffled_right(block)
    rows = ''.join(
        f'<tr><td><b>{i}.</b> {escape(left)}</td><td><b>{_right_key(i, labels)}.</b> {escape(right)}</td></tr>'
        for i, (left, right) in enumerate(zip(lefts, rights), start=1)
    )
    return (f'<table class="matching"><tr><th>{labels["column_a"]}</th><th>{labels["column_b"]}</th></tr>'
            f'{rows}</table>')


def _right_key(index: int, labels) -> str:
    """Column B is lettered a, b, c (الف، ب، ج on Urdu papers)."""
    return urdu_letter(index) if _urdu(labels) else chr(96 + index)


HTML_RENDERERS: Dict[str, Callable] = {
    'mcq': _mcq_html,
    'true_false': _true_false_html,
    'fill_blank': _fill_blank_html,
    'short_answer': _written_html(2),
    'long_answer': _written_html(8),
    'essay': _written_html(15),
    'matching': _matching_html,
}


# ---------------------------------------------------------------- Word

def _plain(value: Any) -> str:
    return sanitize_for_docx(str(value or ''))


def _bottom_rule(paragraph) -> None:
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    p_pr = paragraph._p.get_or_add_pPr()
    borders = OxmlElement('w:pBdr')
    # Word joins paragraphs with the same borders into one box and draws only its outer edge, so a
    # run of answer lines needs the "between" line too, or only the last line shows.
    for side in ('bottom', 'between'):
        edge = OxmlElement(f'w:{side}')
        for key, value in (('w:val', 'single'), ('w:sz', '4'), ('w:space', '1'), ('w:color', '94A3B8')):
            edge.set(qn(key), value)
        borders.append(edge)
    p_pr.append(borders)


def _no_borders(table) -> None:
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    tbl_pr = table._tbl.tblPr
    borders = OxmlElement('w:tblBorders')
    for side in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        element = OxmlElement(f'w:{side}')
        element.set(qn('w:val'), 'nil')
        borders.append(element)
    tbl_pr.append(borders)


def _part_paragraph(doc, label: str, text: str, right: str = ''):
    from docx.shared import Mm, Pt
    from .docx_renderer import CONTENT_WIDTH_MM, _right_tab
    paragraph = doc.add_paragraph()
    fmt = paragraph.paragraph_format
    # "(الف)" in Nastaliq is wider than "(iv)"; a label past the tab stop would push the text to the next one.
    indent = 13 if label in URDU_LETTERS else 9
    fmt.left_indent, fmt.first_line_indent = Mm(indent), Mm(-indent)
    fmt.space_after = Pt(3)
    fmt.tab_stops.add_tab_stop(Mm(indent))
    if right:
        _right_tab(paragraph)
    run = paragraph.add_run(f'({label})\t')
    run.bold = True
    _add_lines(paragraph, text)
    if right:
        paragraph.add_run(f'\t{right}').bold = True
    return paragraph


def _add_lines(paragraph, text: str) -> None:
    """Each line of ``text`` as its own run, with a line break between. A paragraph break in the teacher's
    text is one break here, not a blank line (Nastaliq lines are tall already). Separate runs also let the
    Urdu pass mark each line's English on its own (docx_urdu keeps a run holding a break whole)."""
    lines = [line for line in re.sub(r'\n{2,}', '\n', text).split('\n')]
    for index, line in enumerate(lines):
        if index:
            paragraph.add_run().add_break()
        if line:
            paragraph.add_run(line)


_TABLE = re.compile(r'(<table>.*?</table>)', re.S)


def _rich_pieces(value: Any) -> List[tuple]:
    """Teacher HTML -> ('text', plain text) and ('table', rows of cell texts) in order, so a table in a
    question (a couplet set, a data table) becomes a real Word table instead of one run-on line."""
    pieces = []
    for part in _TABLE.split(sanitize_for_html(str(value or ''))):
        if part.startswith('<table>'):
            rows = [[sanitize_for_docx(cell) for cell in re.findall(r'<t[dh]>(.*?)</t[dh]>', row, re.S)]
                    for row in re.findall(r'<tr>(.*?)</tr>', part, re.S)]
            rows = [row for row in rows if row]
            if rows:
                pieces.append(('table', rows))
        else:
            text = sanitize_for_docx(part)
            if text:
                pieces.append(('text', text))
    return pieces


def _rich_part(doc, label: str, value: Any, right: str = '') -> None:
    """A numbered part whose text may hold paragraphs and tables."""
    from docx.shared import Mm, Pt
    pieces = _rich_pieces(value)
    first = pieces.pop(0)[1] if pieces and pieces[0][0] == 'text' else ''
    _part_paragraph(doc, label, first, right)
    indent = 13 if label in URDU_LETTERS else 9
    for kind, content in pieces:
        if kind == 'text':
            paragraph = doc.add_paragraph()
            paragraph.paragraph_format.left_indent = Mm(indent)
            paragraph.paragraph_format.space_after = Pt(3)
            _add_lines(paragraph, content)
            continue
        table = doc.add_table(rows=len(content), cols=max(len(row) for row in content))
        table.style = 'Table Grid'
        for r, row in enumerate(content):
            for c, cell_text in enumerate(row):
                _add_lines(table.cell(r, c).paragraphs[0], cell_text)


def _picture_png(store, ref):
    """PNG bytes for a picture reference, for Word."""
    import io
    from .scene import Scene, to_png
    if not ref:
        return None
    holder = Scene(100, 100)
    holder.picture(ref, 0, 0, 100, 100)
    if not holder.items:
        return None
    if holder.items[0][0] == 'picture' and store.png_image(holder.items[0][1]['name']) is None:
        return None
    return io.BytesIO(to_png(holder, store, scale=3))


def _mcq_docx(doc, block, store, labels=None) -> None:
    from docx.shared import Mm, Pt
    style = (block.get('data') or {}).get('numbering') or 'roman'
    for index, item in enumerate(items_of(block), start=1):
        _rich_part(doc, part_label(index, style, labels), item.get('text'))
        picture = _picture_png(store, item.get('picture'))
        if picture:
            doc.add_picture(picture, width=Mm(35))
        options = [o if isinstance(o, dict) else {'text': o} for o in (item.get('options') or [])][:6]
        if not options:
            continue
        columns = _option_columns(block, options)
        rows = (len(options) + columns - 1) // columns
        table = doc.add_table(rows=rows, cols=columns)
        _no_borders(table)
        for i, option in enumerate(options):
            cell = table.cell(i // columns, i % columns)
            cell_paragraph = cell.paragraphs[0]
            cell_paragraph.paragraph_format.left_indent = Mm(9) if i % columns == 0 else Mm(0)
            cell_paragraph.paragraph_format.space_after = Pt(1)
            cell_paragraph.add_run(f'{option_key(i, labels)}. ').bold = True
            cell_paragraph.add_run(_plain(option.get('text')))
            option_picture = _picture_png(store, option.get('picture'))
            if option_picture:
                cell_paragraph.add_run().add_picture(option_picture, width=Mm(22))


def _true_false_docx(doc, block, store, labels=None) -> None:
    from docx.shared import Mm
    style = (block.get('data') or {}).get('numbering') or 'roman'
    for index, item in enumerate(items_of(block), start=1):
        _rich_part(doc, part_label(index, style, labels), item.get('text'), right=(labels or EN)['true_false'])
        picture = _picture_png(store, item.get('picture'))
        if picture:
            doc.add_picture(picture, width=Mm(35))


def _fill_blank_docx(doc, block, store, labels=None) -> None:
    from docx.shared import Mm
    style = (block.get('data') or {}).get('numbering') or 'roman'
    for index, item in enumerate(items_of(block), start=1):
        text, found = BLANK.subn('____________', _plain(item.get('text')))
        _part_paragraph(doc, part_label(index, style, labels), text if found else f'{text} ____________')
        picture = _picture_png(store, item.get('picture'))
        if picture:
            doc.add_picture(picture, width=Mm(35))


def _written_docx(default_lines: int) -> Callable:
    def render(doc, block, store, labels=None) -> None:
        from docx.shared import Mm, Pt
        data = block.get('data') or {}
        style = data.get('numbering') or 'roman'
        lines = data.get('lines') if isinstance(data.get('lines'), int) else default_lines
        for index, item in enumerate(items_of(block), start=1):
            _rich_part(doc, part_label(index, style, labels), item.get('text'))
            picture = _picture_png(store, item.get('picture'))
            if picture:
                doc.add_picture(picture, width=Mm(45))
            for _ in range(lines):
                line = doc.add_paragraph()
                line.paragraph_format.left_indent = Mm(9)
                line.paragraph_format.space_before = Pt(10)
                line.paragraph_format.space_after = Pt(0)
                _bottom_rule(line)
    return render


def _matching_docx(doc, block, store, labels=None) -> None:
    labels = labels or EN
    lefts = [str(item.get('left') or '') for item in items_of(block)]
    rights = shuffled_right(block)
    table = doc.add_table(rows=len(lefts) + 1, cols=2)
    table.style = 'Table Grid'
    for col, heading in enumerate((labels['column_a'], labels['column_b'])):
        table.cell(0, col).paragraphs[0].add_run(heading).bold = True
    for i, (left, right) in enumerate(zip(lefts, rights), start=1):
        table.cell(i, 0).paragraphs[0].add_run(f'{i}. {left}')
        table.cell(i, 1).paragraphs[0].add_run(f'{_right_key(i, labels)}. {right}')


DOCX_RENDERERS: Dict[str, Callable] = {
    'mcq': _mcq_docx,
    'true_false': _true_false_docx,
    'fill_blank': _fill_blank_docx,
    'short_answer': _written_docx(2),
    'long_answer': _written_docx(8),
    'essay': _written_docx(15),
    'matching': _matching_docx,
}


def has_math(document: Dict[str, Any]) -> bool:
    """Whether any question text holds an equation, so the page only loads KaTeX when it needs it."""
    for block in document.get('blocks') or []:
        data = str(block.get('data') or '') if isinstance(block, dict) else ''
        if 'katex' in data or 'inlineMath' in data:
            return True
    return False
