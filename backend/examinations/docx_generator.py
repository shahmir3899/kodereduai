"""
DOCX generator for exam papers.
Generates formatted question papers with school metadata and snapshot-backed questions.

Legacy (empty-structure) papers render through the original flat, unstructured
layout unchanged. Structured papers (ExamPaper.structure non-empty) render through
the shared layout plan in paper_export_layout.py in the classic school-paper format
(header block, section headings with marks, per-type question rendering, answer
lines, deterministic matching-table shuffle) -- kept consistent with the PDF export.
"""

import io
import logging
import re
from datetime import datetime
from urllib.parse import urlparse

from django.utils.html import strip_tags
import requests

from .html_sanitize import sanitize_for_docx
from .paper_export_layout import build_export_layout, build_worksheet_export_layout, resolve_exam_paper_class_name

logger = logging.getLogger(__name__)


def _fetch_image_stream(url, timeout=8):
    """Fetch bytes for a Supabase-hosted image URL (a Diagram Mode question/option
    attachment) -- python-docx's add_picture() needs a file-like object or local
    path, not a URL, same as _append_school_logo already does for the school logo."""
    if not url:
        return None
    try:
        response = requests.get(url, timeout=timeout)
        response.raise_for_status()
        return io.BytesIO(response.content)
    except Exception as exc:
        logger.warning('Could not fetch image %s: %s', url, exc)
        return None


def _html_to_text(value):
    if not value:
        return ''
    text = re.sub(r'<br\s*/?>', '\n', str(value), flags=re.IGNORECASE)
    text = re.sub(r'</p\s*>', '\n\n', text, flags=re.IGNORECASE)
    text = strip_tags(text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


class ExamPaperDOCXGenerator:
    """Generate .docx exam papers with snapshot-first question rendering."""

    def __init__(self, exam_paper):
        self.exam_paper = exam_paper
        self.school = exam_paper.school

    def _exam_name(self):
        if self.exam_paper.exam:
            return self.exam_paper.exam.name
        if self.exam_paper.exam_subject and self.exam_paper.exam_subject.exam:
            return self.exam_paper.exam_subject.exam.name
        return None

    def _append_school_logo(self, document, width_inches):
        logo_url = getattr(self.school, 'logo_url', None)
        if not logo_url:
            return

        parsed = urlparse(str(logo_url))
        if not parsed.scheme or not parsed.netloc:
            return

        try:
            response = requests.get(logo_url, timeout=8)
            response.raise_for_status()
            logo_stream = io.BytesIO(response.content)

            from docx.enum.text import WD_ALIGN_PARAGRAPH
            logo_paragraph = document.add_paragraph()
            logo_paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
            logo_run = logo_paragraph.add_run()
            logo_run.add_picture(logo_stream, width=width_inches)
        except Exception as exc:
            logger.warning('Could not attach school logo to DOCX for paper %s: %s', self.exam_paper.id, exc)

    def generate(self):
        try:
            from docx import Document
            from docx.enum.text import WD_ALIGN_PARAGRAPH
            from docx.shared import Inches
        except ImportError:
            logger.error('python-docx not installed, cannot generate DOCX')
            raise ImportError('python-docx is required for DOCX generation')

        document = Document()

        self._append_school_logo(document, Inches(1.15))

        layout = build_export_layout(self.exam_paper)
        if layout is None:
            self._render_legacy(document, WD_ALIGN_PARAGRAPH)
        else:
            self._render_structured(document, layout, WD_ALIGN_PARAGRAPH, Inches)

        output = io.BytesIO()
        document.save(output)
        logger.info('Generated DOCX for ExamPaper %s', self.exam_paper.id)
        return output.getvalue()

    def _render_legacy(self, document, align):
        """Unchanged from the original flat-list rendering -- legacy (empty-structure)
        papers must keep exporting exactly as before."""
        school_heading = document.add_heading(self.school.name, level=1)
        school_heading.alignment = align.CENTER

        exam_name = self._exam_name()
        if exam_name:
            exam_heading = document.add_heading(f'Exam: {exam_name}', level=3)
            exam_heading.alignment = align.CENTER

        paper_heading = document.add_heading(self.exam_paper.paper_title, level=2)
        paper_heading.alignment = align.CENTER

        meta_lines = [
            f"Class: {resolve_exam_paper_class_name(self.exam_paper)}",
            f"Subject: {self.exam_paper.subject.name}",
            f"Total Marks: {self.exam_paper.total_marks}",
            f"Duration: {self.exam_paper.duration_minutes} minutes",
        ]
        if exam_name:
            meta_lines.append(f"Exam: {exam_name}")
        document.add_paragraph(' | '.join(meta_lines))

        if self.exam_paper.instructions:
            document.add_paragraph('Instructions:')
            instructions = _html_to_text(self.exam_paper.instructions)
            for line in [entry.strip() for entry in instructions.splitlines() if entry.strip()]:
                document.add_paragraph(line, style='List Bullet')

        paper_questions = self.exam_paper.paper_questions.select_related('question').order_by('question_order')
        for paper_question in paper_questions:
            question = paper_question.get_question_data()
            marks = paper_question.get_marks()

            heading_text = f"Q{paper_question.question_order}. ({marks} marks)"
            document.add_paragraph(heading_text)

            # question_text is TipTap HTML and can now carry KaTeX equations -- plain
            # strip_tags() duplicates/garbles those (see html_sanitize module docstring).
            question_text = sanitize_for_docx(question.get('question_text'))
            document.add_paragraph(question_text or '-')

            if question.get('question_type') == 'MCQ':
                for option_key in ('A', 'B', 'C', 'D'):
                    option_value = question.get(f'option_{option_key.lower()}')
                    if option_value:
                        document.add_paragraph(f"{option_key}. {_html_to_text(option_value)}")
            else:
                document.add_paragraph('')

        footer = document.add_paragraph(
            f"Generated on {datetime.now().strftime('%d %B %Y')} | {self.school.name}"
        )
        footer.alignment = align.CENTER

    def _render_structured(self, document, layout, align, inches):
        """Classic school-paper format for structured papers (non-empty ExamPaper.structure)."""
        from docx.enum.text import WD_TAB_ALIGNMENT
        from docx.shared import Pt

        # Word's default 'Normal' style adds ~8pt after every paragraph -- with one
        # question spanning several paragraphs (header, text, options/answer lines)
        # that compounds into the large gaps between questions users were seeing.
        # Structured papers only; legacy rendering is untouched.
        document.styles['Normal'].paragraph_format.space_after = Pt(2)

        header = layout['header']

        school_heading = document.add_heading(header['school_name'], level=1)
        school_heading.alignment = align.CENTER

        if header['exam_name']:
            exam_heading = document.add_heading(f"Exam: {header['exam_name']}", level=3)
            exam_heading.alignment = align.CENTER

        paper_heading = document.add_heading(header['paper_title'], level=2)
        paper_heading.alignment = align.CENTER

        subject_class_p = document.add_paragraph(
            f"Paper: {header['subject_name']}    Class: {header['class_name']}"
        )
        subject_class_p.alignment = align.CENTER

        self._render_candidate_info_table(document, header, inches)

        time_p = document.add_paragraph(f"Time Allowed: {header['duration_minutes']} minutes")
        time_p.alignment = align.CENTER

        self._render_examiner_marks_box(document, layout['blocks'], header['total_marks'], align)

        if header['instructions']:
            document.add_paragraph('Instructions:')
            instructions_text = _html_to_text(header['instructions'])
            for line in [entry.strip() for entry in instructions_text.splitlines() if entry.strip()]:
                document.add_paragraph(line, style='List Bullet')

        for block in layout['blocks']:
            if block['type'] == 'divider':
                self._render_divider_heading(document, block, align)
                continue
            if block['type'] == 'section':
                self._render_section_heading(document, block, inches, WD_TAB_ALIGNMENT)
            # A 'section' block's heading already states the total marks for every
            # question inside it -- only an 'unstructured' block (questions with no
            # section wrapper) has nowhere else to show marks, so those keep the
            # per-question marks suffix.
            show_marks = block['type'] != 'section'
            for item in block['items']:
                self._render_question_item(document, item, show_marks)
                # A deliberate gap between questions -- everything *within* one
                # question stays tight (Normal style's 2pt above). A question that
                # ends in a table (MCQ/matching) leaves no trailing paragraph to
                # attach space_after to, so add one explicitly rather than reaching
                # for document.paragraphs[-1], which a trailing table would skip past.
                gap_paragraph = document.add_paragraph()
                gap_paragraph.paragraph_format.space_after = Pt(10)

        # Internal audit info ("Generated on … | Prepared by …") no longer prints on
        # the student-facing paper -- it belongs on an internal/teacher copy. Word's
        # page-number field (added below) covers what a running footer needs to say.
        self._add_page_number_footer(document, align)

    @staticmethod
    def _set_cell_borders(cell, bottom=False):
        """No table style involved -- every cell gets explicit borders so a blank
        fill-in cell can carry just a ruled bottom line instead of a full grid box."""
        from docx.oxml.ns import qn
        from docx.oxml import OxmlElement

        tc_pr = cell._tc.get_or_add_tcPr()
        borders = OxmlElement('w:tcBorders')
        for edge in ('top', 'left', 'right'):
            el = OxmlElement(f'w:{edge}')
            el.set(qn('w:val'), 'nil')
            borders.append(el)
        bottom_el = OxmlElement('w:bottom')
        if bottom:
            bottom_el.set(qn('w:val'), 'single')
            bottom_el.set(qn('w:sz'), '6')
            bottom_el.set(qn('w:color'), '9CA3AF')
        else:
            bottom_el.set(qn('w:val'), 'nil')
        borders.append(bottom_el)
        tc_pr.append(borders)

    def _render_candidate_info_table(self, document, header, inches):
        """Ruled fill-in cells (bottom border only) instead of underscore strings --
        keeps handwriting aligned and reads as a proper candidate-info block rather
        than plain text, matching the PDF export's candidate table."""
        table = document.add_table(rows=2, cols=4)
        table.autofit = True
        rows = [
            [('Name:', ''), ('Roll No:', '')],
            [('Date:', ''), ('Total Marks:', str(header['total_marks']))],
        ]
        for row_index, row_pairs in enumerate(rows):
            cells = table.rows[row_index].cells
            for pair_index, (label, value) in enumerate(row_pairs):
                label_cell = cells[pair_index * 2]
                value_cell = cells[pair_index * 2 + 1]
                label_cell.text = label
                label_cell.paragraphs[0].runs[0].bold = True
                value_cell.text = value
                self._set_cell_borders(label_cell, bottom=False)
                self._set_cell_borders(value_cell, bottom=not value)

    def _render_examiner_marks_box(self, document, blocks, total_marks, align):
        """A 'For Examiner's Use' marks grid (one column per section + Total), matching
        the printed section marks -- common on Cambridge/CBSE-style papers so a teacher
        can score without hunting through the paper for each section's mark allocation."""
        section_blocks = [b for b in blocks if b['type'] == 'section']
        if not section_blocks:
            return

        caption = document.add_paragraph("For Examiner's Use")
        caption.alignment = align.RIGHT
        caption.runs[0].italic = True

        col_count = len(section_blocks) + 1
        table = document.add_table(rows=3, cols=col_count)
        table.style = 'Table Grid'
        for index, block in enumerate(section_blocks):
            table.rows[0].cells[index].text = block['title'] or f'Q{index + 1}'
            table.rows[1].cells[index].text = str(block['section_marks'])
        table.rows[0].cells[-1].text = 'Total'
        table.rows[1].cells[-1].text = str(total_marks)
        for cell in table.rows[0].cells:
            cell.paragraphs[0].runs[0].bold = True

    def _add_page_number_footer(self, document, align):
        """Word's PAGE/NUMPAGES fields render as a live 'Page N of M' in every viewer
        and when printed -- the DOCX equivalent of the PDF's per-page canvas stamp."""
        from docx.oxml.ns import qn
        from docx.oxml import OxmlElement

        section = document.sections[0]
        footer_paragraph = section.footer.paragraphs[0]
        footer_paragraph.alignment = align.CENTER

        def _add_field(paragraph, field_code):
            run = paragraph.add_run()
            fld_char_begin = OxmlElement('w:fldChar')
            fld_char_begin.set(qn('w:fldCharType'), 'begin')
            instr_text = OxmlElement('w:instrText')
            instr_text.set(qn('xml:space'), 'preserve')
            instr_text.text = field_code
            fld_char_end = OxmlElement('w:fldChar')
            fld_char_end.set(qn('w:fldCharType'), 'end')
            run._r.append(fld_char_begin)
            run._r.append(instr_text)
            run._r.append(fld_char_end)

        footer_paragraph.add_run('Page ')
        _add_field(footer_paragraph, 'PAGE')
        footer_paragraph.add_run(' of ')
        _add_field(footer_paragraph, 'NUMPAGES')

    def _render_divider_heading(self, document, block, align):
        """A plain print-layout separator (e.g. 'Section A') -- no marks, no questions."""
        heading = document.add_heading(block['title'], level=2)
        heading.alignment = align.CENTER

    def _render_section_heading(self, document, block, inches, tab_alignment):
        """Shaded single-cell 'table' band instead of a plain bold paragraph -- matches
        the PDF export's section-heading treatment (light fill + left accent bar) so
        section breaks read as a strong visual break rather than just bold text."""
        from docx.oxml.ns import qn
        from docx.oxml import OxmlElement

        heading_text = block['title']
        if block['instruction']:
            heading_text = f"{heading_text}. {block['instruction']}"

        table = document.add_table(rows=1, cols=2)
        table.autofit = True
        left_cell, right_cell = table.rows[0].cells
        left_cell.text = heading_text
        left_cell.paragraphs[0].runs[0].bold = True
        right_run = right_cell.paragraphs[0].add_run(f"({block['section_marks']})")
        right_run.bold = True
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        right_cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.RIGHT

        for cell in (left_cell, right_cell):
            tc_pr = cell._tc.get_or_add_tcPr()
            shading = OxmlElement('w:shd')
            shading.set(qn('w:fill'), 'EEF2FF')
            tc_pr.append(shading)
            borders = OxmlElement('w:tcBorders')
            for edge in ('top', 'bottom', 'right'):
                el = OxmlElement(f'w:{edge}')
                el.set(qn('w:val'), 'nil')
                borders.append(el)
            tc_pr.append(borders)
        # Left accent bar on the leading edge of the first cell only.
        left_borders = left_cell._tc.get_or_add_tcPr().find(qn('w:tcBorders'))
        left_edge = OxmlElement('w:left')
        left_edge.set(qn('w:val'), 'single')
        left_edge.set(qn('w:sz'), '24')
        left_edge.set(qn('w:color'), '4F46E5')
        left_borders.append(left_edge)
        right_borders = right_cell._tc.get_or_add_tcPr().find(qn('w:tcBorders'))
        right_no_left = OxmlElement('w:left')
        right_no_left.set(qn('w:val'), 'nil')
        right_borders.append(right_no_left)

    def _embed_option_image(self, cell, image_url):
        """Add an MCQ option's diagram (e.g. "which shape is a rhombus?") as a new
        paragraph inside its table cell, below the option's text/letter."""
        if not image_url:
            return
        from docx.shared import Inches
        image_stream = _fetch_image_stream(image_url)
        if not image_stream:
            return
        try:
            cell.add_paragraph().add_run().add_picture(image_stream, width=Inches(1.4))
        except Exception as exc:
            logger.warning('Could not embed option diagram in DOCX: %s', exc)

    def _render_question_item(self, document, item, show_marks=True):
        from docx.shared import Inches, Pt, RGBColor

        # Number, question text and the True/False marker sit in one paragraph.
        # Marks print once, at the section heading (e.g. "Question # 1 (5)") --
        # repeating them on every sub-question (Q1, Q2, Q3...) duplicated a total
        # that's already uniform per section, so per-question marks only appear
        # here when there's no section heading to carry them (show_marks=False otherwise).
        #
        # item['number'] is a lettered sub-part ("1(a)") under its question group for
        # a real section, or a plain group number ("4") for an unassigned question
        # with no section -- see build_export_layout's docstring. A lettered part
        # reads fine as "1(a) <text>"; a bare group number still wants its trailing
        # dot ("4. <text>") to read as a question number.
        question_text = sanitize_for_docx(item['question_text']) or '-'
        label = item['number']
        number_prefix = f"{label} " if '(' in label else f"{label}. "

        paragraph = document.add_paragraph()
        paragraph.add_run(number_prefix).bold = True
        paragraph.add_run(question_text)
        if item['question_type'] == 'TRUE_FALSE':
            paragraph.add_run('   [ True / False ]').bold = True
        if show_marks:
            marks_suffix = f"({item['marks']} mark{'s' if item['marks'] != 1 else ''})"
            marks_run = paragraph.add_run(f'   {marks_suffix}')
            marks_run.font.size = Pt(9)
            marks_run.font.color.rgb = RGBColor(0x6B, 0x72, 0x80)

        if item.get('question_image_url'):
            image_stream = _fetch_image_stream(item['question_image_url'])
            if image_stream:
                try:
                    document.add_picture(image_stream, width=Inches(3))
                except Exception as exc:
                    logger.warning('Could not embed question diagram in DOCX: %s', exc)

        rendered_extra = False

        if item['question_type'] == 'MCQ' and item['options']:
            # 2-column grid (A/B on one row, C/D on the next) instead of stacking all
            # four vertically -- matches the PDF export and halves the vertical space
            # MCQ options take on the page.
            option_images = item.get('option_images') or {}
            rows = []
            for left_key, right_key in (('A', 'B'), ('C', 'D')):
                left_value = item['options'].get(left_key)
                right_value = item['options'].get(right_key)
                if left_value or right_value:
                    rows.append((left_key, left_value, right_key, right_value))
            if rows:
                table = document.add_table(rows=len(rows), cols=2)
                for row_index, (left_key, left_value, right_key, right_value) in enumerate(rows):
                    cells = table.rows[row_index].cells
                    cells[0].text = f"{left_key}. {_html_to_text(left_value)}" if left_value else ''
                    cells[1].text = f"{right_key}. {_html_to_text(right_value)}" if right_value else ''
                    self._embed_option_image(cells[0], option_images.get(left_key))
                    self._embed_option_image(cells[1], option_images.get(right_key))
            rendered_extra = True

        elif item['question_type'] == 'FILL_BLANK' and item['fill_blank_items']:
            for blank_line in item['fill_blank_items']:
                document.add_paragraph(blank_line)
            rendered_extra = True

        elif item['question_type'] == 'MATCHING' and item['matching_pairs']:
            self._render_matching_table(document, item['matching_pairs'])
            rendered_extra = True

        elif item['question_type'] == 'TRUE_FALSE':
            # Marker is already inline in the question paragraph above -- nothing more
            # to render, just skip the blank-answer-space fallback below.
            rendered_extra = True

        if item['answer_lines']:
            for _ in range(item['answer_lines']):
                document.add_paragraph('_' * 60)
            rendered_extra = True

        # No blanket blank-answer-space filler here -- a question only gets extra
        # room when render_options.answer_lines actually asked for it (above). Every
        # other question type -- MCQ, Fill-blank, Matching, True/False, or a
        # SHORT/LONG/ESSAY question with the answer-lines toggle off -- now gets the
        # same tight gap True/False already had (the per-question gap paragraph in
        # _render_structured provides the spacing between questions).

    def _render_matching_table(self, document, pairs):
        table = document.add_table(rows=len(pairs) + 1, cols=2)
        table.style = 'Table Grid'
        header_cells = table.rows[0].cells
        header_cells[0].text = 'Column A'
        header_cells[1].text = 'Column B'
        for row_index, pair in enumerate(pairs, start=1):
            cells = table.rows[row_index].cells
            cells[0].text = pair['left']
            cells[1].text = pair['right']


class WorksheetDOCXGenerator(ExamPaperDOCXGenerator):
    """Generate branded .docx worksheets.

    Subclasses ExamPaperDOCXGenerator purely to reuse its section/question
    rendering helpers (_render_divider_heading, _render_section_heading,
    _render_question_item, _add_page_number_footer, _append_school_logo) --
    none of those touch self.exam_paper, so they render identically for a
    worksheet. No candidate total-marks cell, no examiner-marks box, and no
    legacy flat-list fallback (a worksheet's structure is never empty).
    """

    def __init__(self, worksheet):
        self.worksheet = worksheet
        self.school = worksheet.school

    def generate(self):
        from docx import Document
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        from docx.shared import Inches, Pt

        document = Document()
        document.styles['Normal'].paragraph_format.space_after = Pt(2)
        self._append_school_logo(document, Inches(1.15))

        layout = build_worksheet_export_layout(self.worksheet)
        header = layout['header']

        school_heading = document.add_heading(header['school_name'], level=1)
        school_heading.alignment = WD_ALIGN_PARAGRAPH.CENTER

        title_heading = document.add_heading(header['paper_title'], level=2)
        title_heading.alignment = WD_ALIGN_PARAGRAPH.CENTER

        subtitle_bits = [f"Class: {header['class_name']}"]
        if header['subject_name']:
            subtitle_bits.append(f"Subject: {header['subject_name']}")
        subtitle_p = document.add_paragraph('    '.join(subtitle_bits))
        subtitle_p.alignment = WD_ALIGN_PARAGRAPH.CENTER

        name_date_table = document.add_table(rows=1, cols=4)
        name_date_table.autofit = True
        cells = name_date_table.rows[0].cells
        cells[0].text = 'Name:'
        cells[0].paragraphs[0].runs[0].bold = True
        cells[2].text = 'Date:'
        cells[2].paragraphs[0].runs[0].bold = True
        for cell in cells:
            self._set_cell_borders(cell, bottom=False)

        if header['instructions']:
            document.add_paragraph('Instructions:')
            instructions_text = _html_to_text(header['instructions'])
            for line in [entry.strip() for entry in instructions_text.splitlines() if entry.strip()]:
                document.add_paragraph(line, style='List Bullet')

        from docx.enum.text import WD_TAB_ALIGNMENT

        for block in layout['blocks']:
            if block['type'] == 'divider':
                self._render_divider_heading(document, block, WD_ALIGN_PARAGRAPH)
                continue
            if block['type'] == 'section':
                self._render_section_heading(document, block, Inches, WD_TAB_ALIGNMENT)
            show_marks = block['type'] != 'section'
            for item in block['items']:
                self._render_question_item(document, item, show_marks)
                gap_paragraph = document.add_paragraph()
                gap_paragraph.paragraph_format.space_after = Pt(10)

        self._add_page_number_footer(document, WD_ALIGN_PARAGRAPH)

        output = io.BytesIO()
        document.save(output)
        logger.info('Generated DOCX for Worksheet %s', self.worksheet.id)
        return output.getvalue()
