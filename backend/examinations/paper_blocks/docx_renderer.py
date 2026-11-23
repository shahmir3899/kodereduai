"""Block list -> Word file. Headings, marks, the office table and oral questions are real Word text the
teacher can edit; each activity drawing goes in as one picture made from the same scene as the PDF."""
import io
import re
from typing import Any, Dict

from .layouts import SCENE_WIDTH, build_scene
from .registry import block_marks, format_marks, is_question, question_blocks, total_marks
from .text_blocks import DOCX_RENDERERS, attempt_note
from .html_renderer import is_compact_header, sign_label, subject_label_key
from .scene import to_png
from .urdu import document_has_urdu, is_rtl, labels_for

_ORDINAL = re.compile(r'\b(\d+)(st|nd|rd|th)\b')
SERIF = 'Georgia'
SANS = 'Trebuchet MS'
PAGE_MARGIN_MM = 18
CONTENT_WIDTH_MM = 210 - 2 * PAGE_MARGIN_MM
MARKS_BLUE = (0x1E, 0x3A, 0x8A)


def _run(paragraph, text, *, bold=False, size=None, font=None, underline=False, superscript=False, color=None):
    from docx.shared import Pt, RGBColor
    run = paragraph.add_run(text)
    run.bold = bold
    run.underline = underline
    run.font.superscript = superscript
    if size:
        run.font.size = Pt(size)
    if font:
        run.font.name = font
    if color:
        run.font.color.rgb = RGBColor(*color)
    return run


def _ordinal_runs(paragraph, text, **style):
    """"2nd Term" with the "nd" raised."""
    position = 0
    for match in _ORDINAL.finditer(text):
        _run(paragraph, text[position:match.start(2)], **style)
        _run(paragraph, match.group(2), superscript=True, **style)
        position = match.end()
    _run(paragraph, text[position:], **style)


def _field(paragraph, code, **style):
    """A live Word field (PAGE, NUMPAGES): Word fills in the number itself."""
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    for kind in ('begin', 'instr', 'end'):
        run = _run(paragraph, '', **style)
        if kind == 'instr':
            element = OxmlElement('w:instrText')
            element.set(qn('xml:space'), 'preserve')
            element.text = code
        else:
            element = OxmlElement('w:fldChar')
            element.set(qn('w:fldCharType'), kind)
        run._r.append(element)


def _right_tab(paragraph):
    from docx.enum.text import WD_TAB_ALIGNMENT
    from docx.shared import Mm
    paragraph.paragraph_format.tab_stops.add_tab_stop(Mm(CONTENT_WIDTH_MM), WD_TAB_ALIGNMENT.RIGHT)


def _title(doc, number, block, labels):
    from docx.shared import Pt
    paragraph = doc.add_paragraph()
    paragraph.paragraph_format.space_before = Pt(8)
    paragraph.paragraph_format.space_after = Pt(6)
    # Keeps the heading on the same page as its drawing.
    paragraph.paragraph_format.keep_with_next = True
    _right_tab(paragraph)
    _run(paragraph, f'{labels["question"].format(n=number)} {block.get("title") or ""}', bold=True, size=12)
    note = attempt_note(block, labels)
    if note:
        _run(paragraph, f'  {note}', size=10, color=(0x47, 0x55, 0x69))
    if block.get('marks') is not None:
        _run(paragraph, f'\t({format_marks(block_marks(block))})', bold=True, size=12, color=MARKS_BLUE)
    return paragraph


def _logo_bytes(logo) -> bytes:
    """PNG bytes of the header's inline logo (render_document puts it there), or b''."""
    import base64
    text = str(logo or '')
    if not text.startswith('data:image/') or ';base64,' not in text:
        return b''
    try:
        return base64.b64decode(text.split(';base64,', 1)[1])
    except ValueError:
        return b''


def _boxed(cell) -> None:
    """A plain single border round one table cell (Word has no rounded box; the HTML print has one)."""
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    borders = OxmlElement('w:tcBorders')
    for side in ('top', 'left', 'bottom', 'right'):
        edge = OxmlElement(f'w:{side}')
        edge.set(qn('w:val'), 'single')
        edge.set(qn('w:sz'), '12')
        edge.set(qn('w:color'), '1F2937')
        borders.append(edge)
    cell._tc.get_or_add_tcPr().append(borders)


def _compact_header(doc, header, labels):
    """Worksheet compact header: logo, then one box with Name / Date and Class / Subject (as the HTML print)."""
    from docx.shared import Mm
    logo = _logo_bytes(header.get('logo'))
    table = doc.add_table(rows=1, cols=2 if logo else 1)
    table.autofit = False
    cells = table.rows[0].cells
    box = cells[-1]
    if logo:
        cells[0].width, box.width = Mm(30), Mm(CONTENT_WIDTH_MM - 30)
        cells[0].paragraphs[0].add_run().add_picture(io.BytesIO(logo), height=Mm(18))
    else:
        box.width = Mm(CONTENT_WIDTH_MM)
    _boxed(box)
    _run(box.paragraphs[0], f'{labels["name"]}: ' + '_' * 30 + f'   {labels["date"]}: ' + '_' * 14, bold=True, size=11, font=SERIF)
    details = [f'{labels[label]}: {header[key]}' for label, key in (('class', 'class_name'), (subject_label_key(header), 'subject'))
               if header.get(key)]
    if details:
        _run(box.add_paragraph(), '        '.join(details), bold=True, size=11, font=SERIF)
    doc.add_paragraph()


def _header(doc, document, labels):
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Pt

    header = document.get('header') or {}
    blocks = question_blocks(document)

    if is_compact_header(header):
        _compact_header(doc, header, labels)
    else:
        # With a logo the title lines sit in the middle cell of a borderless 3-cell row, the logo in the outer cell
        # (left, or right on an Urdu paper), so the school name stays centred on the page as in the HTML print.
        logo = _logo_bytes(header.get('logo'))
        target, fresh = doc, False
        if logo:
            from docx.shared import Mm
            table = doc.add_table(rows=1, cols=3)
            table.alignment = WD_TABLE_ALIGNMENT.CENTER
            table.autofit = False
            for cell, width in zip(table.rows[0].cells, (30, CONTENT_WIDTH_MM - 60, 30)):
                cell.width = Mm(width)
            side = table.rows[0].cells[2 if is_rtl(document) else 0]
            side.paragraphs[0].add_run().add_picture(io.BytesIO(logo), height=Mm(20))
            target, fresh = table.rows[0].cells[1], True

        def line():
            nonlocal fresh
            paragraph = target.paragraphs[0] if fresh else target.add_paragraph()
            fresh = False
            paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
            return paragraph

        paragraph = line()
        _run(paragraph, str(header.get('school_name') or ''), bold=True, size=19, font=SERIF, underline=True)
        if header.get('exam_title'):
            paragraph = line()
            _ordinal_runs(paragraph, str(header['exam_title']), bold=True, size=12, font=SERIF)
        meta = [f'{labels[label]}: {header[key]}' for label, key in ((subject_label_key(header), 'subject'), ('class', 'class_name'))
                if header.get(key)]
        if meta:
            paragraph = line()
            _run(paragraph, '      '.join(meta), bold=True, size=12, font=SERIF)

        for line in (f'{labels["name"]}: ' + '_' * 52, f'{labels["roll"]}: ' + '_' * 22 + f'      {labels["date"]}: ' + '_' * 24):
            paragraph = doc.add_paragraph()
            paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
            _run(paragraph, line, bold=True, size=11, font=SERIF)

    if header.get('show_time_marks'):
        paragraph = doc.add_paragraph()
        _right_tab(paragraph)
        if header.get('time_label'):
            _run(paragraph, f'{labels["time"]}: {header["time_label"]}', bold=True, size=11, font=SERIF)
        _run(paragraph, f'\t{labels["total_marks"]}: {format_marks(total_marks(document))}', bold=True, size=11, font=SERIF)
    if header.get('marks_table', True) and blocks:
        _office_table(doc, header, blocks, document, labels)
    instructions = [line.strip() for line in str(header.get('instructions') or '').splitlines() if line.strip()]
    if instructions:
        paragraph = doc.add_paragraph()
        paragraph.paragraph_format.space_before = Pt(6)
        _run(paragraph, labels['instructions'], bold=True)
        for line in instructions:
            doc.add_paragraph(line, style='List Bullet')


def _office_table(doc, header, blocks, document, labels):
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Pt

    paragraph = doc.add_paragraph()
    paragraph.paragraph_format.space_before = Pt(6)
    _run(paragraph, labels['office'], bold=True, size=11, font=SERIF, underline=True)
    table = doc.add_table(rows=3, cols=len(blocks) + 2)
    table.style = 'Table Grid'
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    rows = [
        [labels['office_question'], *[str(i) for i in range(1, len(blocks) + 1)], labels['office_total']],
        [labels['office_total'], *[format_marks(block_marks(block)) for block in blocks], format_marks(total_marks(document))],
        [labels['office_obtained'], *([''] * (len(blocks) + 1))],
    ]
    for row_index, values in enumerate(rows):
        for col_index, value in enumerate(values):
            cell_paragraph = table.cell(row_index, col_index).paragraphs[0]
            cell_paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
            _run(cell_paragraph, value, bold=True, size=10, font=SERIF)
    paragraph = doc.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    paragraph.paragraph_format.space_before = Pt(6)
    _run(paragraph, f'{sign_label(header, labels)}: ' + '_' * 18, bold=True, size=11, font=SERIF)


def _footer(doc, document, labels):
    paragraph = doc.sections[0].footer.paragraphs[0]
    # Word's own Footer style has a centre tab stop, which would catch the page number halfway
    # across the page; Normal has none, so the right tab below is the only one.
    paragraph.style = doc.styles['Normal']
    _right_tab(paragraph)
    grey = (0x64, 0x74, 0x8B)
    _run(paragraph, str(document.get('footer') or ''), size=8, color=grey)
    _run(paragraph, f'\t{labels["page"]} ', size=8, color=grey)
    _field(paragraph, 'PAGE', size=8, color=grey)
    _run(paragraph, f' {labels["of"]} ', size=8, color=grey)
    _field(paragraph, 'NUMPAGES', size=8, color=grey)


def new_document():
    """An empty A4 Word file with the paper's margins and body font. Shared with answer_key.py."""
    from docx import Document
    from docx.shared import Mm, Pt

    doc = Document()
    section = doc.sections[0]
    section.page_width, section.page_height = Mm(210), Mm(297)
    section.left_margin = section.right_margin = Mm(PAGE_MARGIN_MM)
    section.top_margin, section.bottom_margin = Mm(15), Mm(18)
    normal = doc.styles['Normal']
    normal.font.name = SANS
    normal.font.size = Pt(11)
    normal.paragraph_format.space_after = Pt(4)
    return doc


def finish_document(doc, document: Dict[str, Any]) -> bytes:
    """Urdu (right to left, embedded font) when the paper has it, then the file's bytes."""
    urdu = document_has_urdu(document)
    if urdu:
        from .docx_urdu import apply_urdu
        apply_urdu(doc, is_rtl(document))
    buffer = io.BytesIO()
    doc.save(buffer)
    if urdu:
        from .docx_urdu import embed_urdu_font
        return embed_urdu_font(buffer.getvalue())
    return buffer.getvalue()


def render_docx(document: Dict[str, Any], store) -> bytes:
    from docx.shared import Mm, Pt

    doc = new_document()
    rtl = is_rtl(document)
    labels = labels_for(document)
    _header(doc, document, labels)
    _footer(doc, document, labels)

    number = 0
    for block in document.get('blocks') or []:
        if not isinstance(block, dict):
            continue
        if not is_question(block):
            from docx.enum.text import WD_ALIGN_PARAGRAPH
            paragraph = doc.add_paragraph()
            paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
            paragraph.paragraph_format.space_before = Pt(10)
            paragraph.paragraph_format.keep_with_next = True
            _run(paragraph, str(block.get('title') or ''), bold=True, size=13, font=SERIF, underline=True)
            continue
        number += 1
        _title(doc, number, block, labels)
        text_renderer = DOCX_RENDERERS.get(block.get('type'))
        if text_renderer is not None:
            text_renderer(doc, block, store, labels)
            continue
        scene = build_scene(block, rtl)
        if scene is None:
            items: Any = (block.get('data') or {}).get('items') or []
            for index, item in enumerate(items, start=1):
                item = item if isinstance(item, dict) else {'text': item}
                paragraph = doc.add_paragraph()
                _right_tab(paragraph)
                _run(paragraph, f'{index}. {item.get("text") or ""}')
                if isinstance(item.get('marks'), (int, float)):
                    _run(paragraph, f'\t({format_marks(float(item["marks"]))})', bold=True, color=MARKS_BLUE)
            continue
        doc.add_picture(io.BytesIO(to_png(scene, store)), width=Mm(CONTENT_WIDTH_MM * scene.width / SCENE_WIDTH))
    return finish_document(doc, document)
