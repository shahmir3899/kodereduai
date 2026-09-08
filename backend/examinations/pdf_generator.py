"""
PDF Generator for Exam Papers.
Generates formatted question papers with school branding.

Legacy (empty-structure) papers render through the original flat, unstructured
layout unchanged. Structured papers (ExamPaper.structure non-empty) render through
the shared layout plan in paper_export_layout.py in the classic school-paper format
(header block, section headings with marks, per-type question rendering, answer
lines, deterministic matching-table shuffle) -- kept consistent with the DOCX export.
"""

import io
import logging
from datetime import datetime

import requests

from .html_sanitize import sanitize_for_pdf
from .paper_export_layout import build_export_layout, resolve_exam_paper_class_name

logger = logging.getLogger(__name__)


def _numbered_canvas_class():
    """Builds a Canvas subclass that stamps 'Page N of M' bottom-center on every
    page. Page count isn't known until save() -- by then every page's drawing
    state has been captured via the showPage() override, so the total can be
    stamped in. Standard ReportLab recipe for page totals; built lazily here
    (rather than as a module-level class) to keep reportlab an optional import.
    """
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas as canvas_module

    class NumberedCanvas(canvas_module.Canvas):
        def __init__(self, *args, **kwargs):
            canvas_module.Canvas.__init__(self, *args, **kwargs)
            self._saved_page_states = []

        def showPage(self):
            self._saved_page_states.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            total_pages = len(self._saved_page_states)
            for state in self._saved_page_states:
                self.__dict__.update(state)
                self.setFont('Helvetica', 8)
                self.setFillColor(colors.HexColor('#9CA3AF'))
                self.drawCentredString(A4[0] / 2, 0.4 * 72, f"Page {self._pageNumber} of {total_pages}")
                canvas_module.Canvas.showPage(self)
            canvas_module.Canvas.save(self)

    return NumberedCanvas


def _load_logo_stream(school):
    """Fetch a school's logo bytes ourselves before handing them to ReportLab.

    reportlab.platypus.Image is lazy by default: passing it a URL string just
    stores the string, and the actual load happens later inside doc.build()
    via ImageReader, which only does a local open()/PIL read -- it has no
    HTTP client and can't fetch http(s) URLs at all. School.logo is a Supabase
    Storage URL, so passing it straight to Image() reliably raises "Cannot
    open resource" during build(), outside any try/except wrapped around the
    Image() call itself, taking down the whole PDF. Fetching the bytes here
    means an unreachable/invalid logo just degrades to "no logo" instead of
    failing the export.
    """
    logo_url = getattr(school, 'logo', None) if school else None
    if not logo_url:
        return None
    try:
        resp = requests.get(logo_url, timeout=8)
        resp.raise_for_status()
        return io.BytesIO(resp.content)
    except Exception as e:
        logger.warning(f"Could not fetch school logo: {str(e)}")
        return None


class ExamPaperPDFGenerator:
    """
    Generate formatted PDF exam papers with school branding.
    """

    def __init__(self, exam_paper):
        """
        Initialize generator with an ExamPaper instance.

        Args:
            exam_paper: ExamPaper model instance
        """
        self.exam_paper = exam_paper
        self.school = exam_paper.school

    def _exam_name(self):
        if self.exam_paper.exam:
            return self.exam_paper.exam.name
        if self.exam_paper.exam_subject and self.exam_paper.exam_subject.exam:
            return self.exam_paper.exam_subject.exam.name
        return None

    def generate(self) -> bytes:
        """
        Generate the PDF file and return bytes.

        Returns:
            bytes: PDF file content
        """
        try:
            from reportlab.lib.pagesizes import A4
            from reportlab.lib.units import inch
            from reportlab.platypus import SimpleDocTemplate

            buffer = io.BytesIO()
            doc = SimpleDocTemplate(
                buffer,
                pagesize=A4,
                topMargin=0.75*inch,
                bottomMargin=0.75*inch,
                leftMargin=1*inch,
                rightMargin=1*inch
            )

            layout = build_export_layout(self.exam_paper)
            if layout is None:
                elements = self._build_legacy_elements()
                doc.build(elements)
            else:
                elements = self._build_structured_elements(layout)
                # Structured (modern) papers get a running "Page N of M" footer via a
                # canvas subclass (the standard ReportLab pattern -- total page count
                # isn't known until save(), so it can't be drawn from a flowable).
                # Legacy papers keep their original single-pass build() untouched.
                doc.build(elements, canvasmaker=_numbered_canvas_class())

            logger.info(f"Generated PDF for ExamPaper {self.exam_paper.id}")
            return buffer.getvalue()

        except ImportError:
            logger.error("reportlab not installed, cannot generate PDF")
            raise ImportError("reportlab is required for PDF generation")

        except Exception as e:
            logger.error(f"Error generating PDF: {str(e)}", exc_info=True)
            raise

    def _build_legacy_elements(self):
        """Unchanged from the original flat-list rendering -- legacy (empty-structure)
        papers must keep exporting exactly as before."""
        from reportlab.lib import colors
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import inch
        from reportlab.platypus import Paragraph, Spacer, Table, TableStyle, Image
        from reportlab.lib.enums import TA_CENTER

        elements = []
        styles = getSampleStyleSheet()

        title_style = ParagraphStyle(
            'ExamTitle', parent=styles['Heading1'], fontSize=18, alignment=TA_CENTER,
            spaceAfter=6, textColor=colors.HexColor('#1F2937'), fontName='Helvetica-Bold'
        )
        instruction_style = ParagraphStyle(
            'Instructions', parent=styles['Normal'], fontSize=10, spaceAfter=12,
            textColor=colors.HexColor('#374151'), leftIndent=20, rightIndent=20
        )
        question_style = ParagraphStyle(
            'Question', parent=styles['Normal'], fontSize=11, spaceAfter=10,
            textColor=colors.HexColor('#111827'), leading=14
        )
        option_style = ParagraphStyle(
            'Option', parent=styles['Normal'], fontSize=10, spaceAfter=4,
            leftIndent=30, textColor=colors.HexColor('#374151')
        )

        # Header with school logo (if available)
        logo_stream = _load_logo_stream(self.school)
        if logo_stream:
            try:
                logo = Image(logo_stream, width=1*inch, height=1*inch)
                logo.hAlign = 'CENTER'
                elements.append(logo)
                elements.append(Spacer(1, 8))
            except Exception as e:
                logger.warning(f"Could not render school logo: {str(e)}")

        school_name_style = ParagraphStyle(
            'SchoolName', parent=styles['Heading1'], fontSize=16, alignment=TA_CENTER,
            spaceAfter=4, textColor=colors.HexColor('#1F2937'), fontName='Helvetica-Bold'
        )
        elements.append(Paragraph(self.school.name, school_name_style))

        if hasattr(self.school, 'address') and self.school.address:
            address_style = ParagraphStyle(
                'Address', parent=styles['Normal'], fontSize=9, alignment=TA_CENTER,
                spaceAfter=12, textColor=colors.HexColor('#6B7280')
            )
            elements.append(Paragraph(self.school.address, address_style))

        elements.append(Spacer(1, 16))

        line_table = Table([['']], colWidths=[6.5*inch])
        line_table.setStyle(TableStyle([
            ('LINEABOVE', (0, 0), (-1, 0), 2, colors.HexColor('#2563EB')),
        ]))
        elements.append(line_table)
        elements.append(Spacer(1, 16))

        elements.append(Paragraph(self.exam_paper.paper_title, title_style))

        metadata = [
            ['Class:', resolve_exam_paper_class_name(self.exam_paper), 'Total Marks:', str(self.exam_paper.total_marks)],
            ['Subject:', self.exam_paper.subject.name, 'Duration:', f"{self.exam_paper.duration_minutes} minutes"],
        ]

        exam_name = self._exam_name()
        if exam_name:
            metadata.append(['Exam:', exam_name, '', ''])

        metadata_table = Table(metadata, colWidths=[1.5*inch, 2*inch, 1.5*inch, 1.5*inch])
        metadata_table.setStyle(TableStyle([
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('ALIGN', (0, 0), (0, -1), 'RIGHT'),
            ('ALIGN', (2, 0), (2, -1), 'RIGHT'),
            ('TEXTCOLOR', (0, 0), (0, -1), colors.HexColor('#6B7280')),
            ('TEXTCOLOR', (2, 0), (2, -1), colors.HexColor('#6B7280')),
            ('FONTNAME', (1, 0), (1, -1), 'Helvetica-Bold'),
            ('FONTNAME', (3, 0), (3, -1), 'Helvetica-Bold'),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ]))
        elements.append(metadata_table)
        elements.append(Spacer(1, 16))

        if self.exam_paper.instructions:
            instructions_title = Paragraph('<b>Instructions:</b>', instruction_style)
            elements.append(instructions_title)

            instruction_lines = self.exam_paper.instructions.split('\n')
            for line in instruction_lines:
                if line.strip():
                    elements.append(Paragraph(f"• {line.strip()}", instruction_style))

            elements.append(Spacer(1, 20))

        divider_table = Table([['']], colWidths=[6.5*inch])
        divider_table.setStyle(TableStyle([
            ('LINEABOVE', (0, 0), (-1, 0), 1, colors.HexColor('#D1D5DB')),
        ]))
        elements.append(divider_table)
        elements.append(Spacer(1, 20))

        paper_questions = self.exam_paper.paper_questions.select_related('question').order_by('question_order')

        for pq in paper_questions:
            question = pq.get_question_data()
            marks = pq.get_marks()

            q_header = f"<b>Q{pq.question_order}.</b> [{marks} mark{'s' if marks != 1 else ''}]"
            elements.append(Paragraph(q_header, question_style))

            # question_text is TipTap HTML and can now carry KaTeX equations / an RTL
            # wrapper (RichTextEditor.jsx) -- sanitize_for_pdf reduces it to the tiny inline
            # markup ReportLab's Paragraph parser accepts, or it raises `paraparser: syntax
            # error` and aborts the whole paper's PDF generation.
            question_text = sanitize_for_pdf(question.get('question_text'))
            elements.append(Paragraph(question_text, question_style))

            if question.get('question_image_url'):
                try:
                    q_image = Image(question['question_image_url'], width=4*inch, height=3*inch)
                    q_image.hAlign = 'LEFT'
                    elements.append(Spacer(1, 6))
                    elements.append(q_image)
                    elements.append(Spacer(1, 6))
                except Exception as e:
                    logger.warning(f"Could not load question image: {str(e)}")

            if question.get('question_type') == 'MCQ':
                if question.get('option_a'):
                    elements.append(Paragraph(f"<b>A.</b> {question['option_a']}", option_style))
                if question.get('option_b'):
                    elements.append(Paragraph(f"<b>B.</b> {question['option_b']}", option_style))
                if question.get('option_c'):
                    elements.append(Paragraph(f"<b>C.</b> {question['option_c']}", option_style))
                if question.get('option_d'):
                    elements.append(Paragraph(f"<b>D.</b> {question['option_d']}", option_style))
                elements.append(Spacer(1, 10))
            else:
                if question.get('question_type') == 'ESSAY':
                    elements.append(Spacer(1, 1.5*inch))
                else:
                    elements.append(Spacer(1, 0.75*inch))

            elements.append(Spacer(1, 16))

        footer_line_table = Table([['']], colWidths=[6.5*inch])
        footer_line_table.setStyle(TableStyle([
            ('LINEABOVE', (0, 0), (-1, 0), 1, colors.HexColor('#D1D5DB')),
        ]))
        elements.append(footer_line_table)
        elements.append(Spacer(1, 8))

        footer_style = ParagraphStyle(
            'Footer', parent=styles['Normal'], fontSize=8, alignment=TA_CENTER,
            textColor=colors.HexColor('#9CA3AF')
        )

        footer_text = f"Generated on {datetime.now().strftime('%d %B %Y')} | {self.school.name}"
        if self.exam_paper.generated_by:
            footer_text += f" | Prepared by: {self.exam_paper.generated_by.get_full_name() or self.exam_paper.generated_by.username}"

        elements.append(Paragraph(footer_text, footer_style))

        return elements

    def _build_structured_elements(self, layout):
        """Classic school-paper format for structured papers (non-empty ExamPaper.structure)."""
        from reportlab.lib import colors
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import inch
        from reportlab.platypus import Paragraph, Spacer, Table, TableStyle, Image
        from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT

        header = layout['header']
        elements = []
        styles = getSampleStyleSheet()

        logo_stream = _load_logo_stream(self.school)
        if logo_stream:
            try:
                logo = Image(logo_stream, width=1*inch, height=1*inch)
                logo.hAlign = 'CENTER'
                elements.append(logo)
                elements.append(Spacer(1, 8))
            except Exception as e:
                logger.warning(f"Could not render school logo: {str(e)}")

        school_name_style = ParagraphStyle(
            'SchoolName', parent=styles['Heading1'], fontSize=16, alignment=TA_CENTER,
            spaceAfter=4, textColor=colors.HexColor('#1F2937'), fontName='Helvetica-Bold'
        )
        subtitle_style = ParagraphStyle(
            'ExamSubtitle', parent=styles['Normal'], fontSize=12, alignment=TA_CENTER,
            spaceAfter=8, textColor=colors.HexColor('#4B5563')
        )
        title_style = ParagraphStyle(
            'ExamTitle', parent=styles['Heading1'], fontSize=18, alignment=TA_CENTER,
            spaceAfter=6, textColor=colors.HexColor('#1F2937'), fontName='Helvetica-Bold'
        )
        meta_line_style = ParagraphStyle(
            'MetaLine', parent=styles['Normal'], fontSize=11, alignment=TA_CENTER, spaceAfter=6,
        )
        candidate_label_style = ParagraphStyle(
            'CandidateLabel', parent=styles['Normal'], fontSize=10, fontName='Helvetica-Bold',
            textColor=colors.HexColor('#374151'),
        )
        examiner_label_style = ParagraphStyle(
            'ExaminerLabel', parent=styles['Normal'], fontSize=8, fontName='Helvetica-Bold',
            alignment=TA_CENTER, textColor=colors.white,
        )
        examiner_cell_style = ParagraphStyle(
            'ExaminerCell', parent=styles['Normal'], fontSize=9, alignment=TA_CENTER,
            textColor=colors.HexColor('#111827'),
        )
        instruction_style = ParagraphStyle(
            'Instructions', parent=styles['Normal'], fontSize=10, spaceAfter=12,
            textColor=colors.HexColor('#374151'), leftIndent=20, rightIndent=20
        )
        section_left_style = ParagraphStyle(
            'SectionHeadingLeft', parent=styles['Normal'], fontSize=12, fontName='Helvetica-Bold',
            textColor=colors.HexColor('#111827'),
        )
        section_right_style = ParagraphStyle(
            'SectionHeadingRight', parent=styles['Normal'], fontSize=12, fontName='Helvetica-Bold',
            alignment=TA_RIGHT, textColor=colors.HexColor('#111827'),
        )
        question_style = ParagraphStyle(
            'Question', parent=styles['Normal'], fontSize=11, spaceAfter=4,
            textColor=colors.HexColor('#111827'), leading=14
        )
        option_style = ParagraphStyle(
            'Option', parent=styles['Normal'], fontSize=10, spaceAfter=4,
            leftIndent=30, textColor=colors.HexColor('#374151')
        )
        answer_line_style = ParagraphStyle(
            'AnswerLine', parent=styles['Normal'], fontSize=11, spaceAfter=6,
            textColor=colors.HexColor('#9CA3AF'),
        )
        true_false_style = ParagraphStyle(
            'TrueFalse', parent=styles['Normal'], fontSize=11, spaceAfter=10,
            textColor=colors.HexColor('#111827'),
        )
        divider_style = ParagraphStyle(
            'SectionDivider', parent=styles['Heading2'], fontSize=14, alignment=TA_CENTER,
            spaceBefore=10, spaceAfter=10, textColor=colors.HexColor('#1F2937'), fontName='Helvetica-Bold',
        )

        elements.append(Paragraph(header['school_name'], school_name_style))
        if header['exam_name']:
            elements.append(Paragraph(f"Exam: {header['exam_name']}", subtitle_style))
        elements.append(Paragraph(header['paper_title'], title_style))
        elements.append(Paragraph(f"Paper: {header['subject_name']}    Class: {header['class_name']}", subtitle_style))
        elements.append(Spacer(1, 8))

        # Ruled fill-in cells (bottom border only) instead of underscore strings --
        # keeps handwriting aligned and reads as a proper candidate-info block rather
        # than plain text.
        candidate_table = Table(
            [
                [self._paragraph('Name:', candidate_label_style), '', self._paragraph('Roll No:', candidate_label_style), ''],
                [self._paragraph('Date:', candidate_label_style), '', self._paragraph('Total Marks:', candidate_label_style), self._paragraph(header['total_marks'], candidate_label_style)],
            ],
            colWidths=[0.75*inch, 2.5*inch, 0.9*inch, 2.35*inch],
        )
        candidate_table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'BOTTOM'),
            ('LINEBELOW', (1, 0), (1, 0), 0.75, colors.HexColor('#9CA3AF')),
            ('LINEBELOW', (3, 0), (3, 0), 0.75, colors.HexColor('#9CA3AF')),
            ('LINEBELOW', (1, 1), (1, 1), 0.75, colors.HexColor('#9CA3AF')),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ]))
        elements.append(candidate_table)
        elements.append(Spacer(1, 4))
        elements.append(Paragraph(f"Time Allowed: {header['duration_minutes']} minutes", meta_line_style))
        elements.append(Spacer(1, 10))

        examiner_box = self._build_examiner_marks_box(
            layout['blocks'], header['total_marks'], examiner_label_style, examiner_cell_style,
            Table, TableStyle, colors, inch,
        )
        if examiner_box:
            examiner_caption_style = ParagraphStyle(
                'ExaminerCaption', parent=styles['Normal'], fontSize=8, alignment=TA_RIGHT,
                textColor=colors.HexColor('#6B7280'),
            )
            elements.append(Paragraph("For Examiner's Use", examiner_caption_style))
            elements.append(examiner_box)
            elements.append(Spacer(1, 10))

        divider_table = Table([['']], colWidths=[6.5*inch])
        divider_table.setStyle(TableStyle([
            ('LINEABOVE', (0, 0), (-1, 0), 1, colors.HexColor('#D1D5DB')),
        ]))
        elements.append(divider_table)
        elements.append(Spacer(1, 12))

        if header['instructions']:
            elements.append(Paragraph('<b>Instructions:</b>', instruction_style))
            for line in header['instructions'].split('\n'):
                if line.strip():
                    elements.append(Paragraph(f"• {line.strip()}", instruction_style))
            elements.append(Spacer(1, 12))

        for block in layout['blocks']:
            if block['type'] == 'divider':
                elements.append(Paragraph(block['title'], divider_style))
                continue

            if block['type'] == 'section':
                elements.append(self._build_section_heading_table(
                    block, section_left_style, section_right_style, Table, TableStyle, inch,
                ))
                elements.append(Spacer(1, 6))

            # A 'section' block's heading already states the total marks for every
            # question inside it -- only an 'unstructured' block (questions with no
            # section wrapper) has nowhere else to show marks, so those keep the
            # per-question marks suffix.
            show_marks = block['type'] != 'section'
            for item in block['items']:
                elements.extend(self._build_question_elements(
                    item, question_style, option_style, answer_line_style, true_false_style,
                    Paragraph, Spacer, Table, TableStyle, colors, inch, show_marks,
                ))

        # Internal audit info ("Generated on … | Prepared by …") no longer prints on
        # the student-facing paper -- it belongs on an internal/teacher copy, not
        # the exam itself. The running "Page N of M" is stamped by _NumberedCanvas
        # instead (see generate()), so there's nothing left to draw here.
        return elements

    def _build_examiner_marks_box(
        self, blocks, total_marks, label_style, cell_style, Table, TableStyle, colors, inch,
    ):
        """A 'For Examiner's Use' marks grid (one column per section + Total), matching
        the printed section marks -- common on Cambridge/CBSE-style papers so a teacher
        can score without hunting through the paper for each section's mark allocation."""
        section_blocks = [b for b in blocks if b['type'] == 'section']
        if not section_blocks:
            return None

        headers = [self._paragraph(b['title'] or f'Q{i+1}', label_style) for i, b in enumerate(section_blocks)]
        headers.append(self._paragraph('Total', label_style))
        marks_row = [self._paragraph(str(b['section_marks']), cell_style) for b in section_blocks]
        marks_row.append(self._paragraph(str(total_marks), cell_style))
        obtained_row = [self._paragraph('', cell_style) for _ in section_blocks]
        obtained_row.append(self._paragraph('', cell_style))

        col_count = len(section_blocks) + 1
        col_width = (5.5 * inch) / col_count
        table = Table(
            [headers, marks_row, obtained_row],
            colWidths=[col_width] * col_count,
        )
        table.setStyle(TableStyle([
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#D1D5DB')),
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#4B5563')),
            ('BACKGROUND', (-1, 0), (-1, 0), colors.HexColor('#374151')),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('MINIMUMHEIGHT', (0, 2), (-1, 2), 18),
        ]))
        table.hAlign = 'RIGHT'
        return table

    def _build_section_heading_table(self, block, left_style, right_style, Table, TableStyle, inch):
        heading_text = block['title']
        if block['instruction']:
            heading_text = f"{heading_text}. {block['instruction']}"

        row = [[
            self._paragraph(heading_text, left_style),
            self._paragraph(f"({block['section_marks']})", right_style),
        ]]
        from reportlab.lib import colors
        table = Table(row, colWidths=[5*inch, 1.5*inch])
        table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#EEF2FF')),
            ('LINEBEFORE', (0, 0), (0, -1), 3, colors.HexColor('#4F46E5')),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('LEFTPADDING', (0, 0), (0, -1), 10),
        ]))
        return table

    @staticmethod
    def _paragraph(text, style):
        from reportlab.platypus import Paragraph
        return Paragraph(text, style)

    def _build_question_elements(
        self, item, question_style, option_style, answer_line_style, true_false_style,
        Paragraph, Spacer, Table, TableStyle, colors, inch, show_marks=True,
    ):
        elements = []
        # Number, question text and the True/False marker all flow as one paragraph.
        # Marks print once, at the section heading (e.g. "Question # 1 (5)") --
        # repeating them on every sub-question (Q1, Q2, Q3...) duplicated a total
        # that's already uniform per section, so per-question marks are only shown
        # here when there's no section heading to carry them (show_marks=False otherwise).
        #
        # item['number'] is a lettered sub-part ("1(a)") under its question group
        # for a real section, or a plain group number ("4") for an unassigned
        # question with no section -- see build_export_layout's docstring. A lettered
        # part reads fine as "1(a) <text>"; a bare group number still wants its
        # trailing dot ("4. <text>") to read as a question number, not a page number.
        label = item['number']
        number_prefix = f"<b>{label}</b> " if '(' in label else f"<b>{label}.</b> "
        question_parts = [
            number_prefix,
            sanitize_for_pdf(item['question_text']),
        ]
        if item['question_type'] == 'TRUE_FALSE':
            question_parts.append(" &nbsp;&nbsp;<b>[ True / False ]</b>")
        if show_marks:
            marks_suffix = f"({item['marks']} mark{'s' if item['marks'] != 1 else ''})"
            question_parts.append(f" &nbsp;&nbsp;<font color='#6B7280' size='9'>{marks_suffix}</font>")
        elements.append(Paragraph(''.join(question_parts), question_style))

        rendered_extra = False

        if item['question_type'] == 'MCQ' and item['options']:
            # 2-column grid (A/B on one row, C/D on the next) instead of stacking all
            # four vertically -- halves the vertical space MCQ options take on the page.
            pairs = [('A', 'B'), ('C', 'D')]
            rows = []
            for left_key, right_key in pairs:
                left_value = item['options'].get(left_key)
                right_value = item['options'].get(right_key)
                if not left_value and not right_value:
                    continue
                left_cell = Paragraph(f"<b>{left_key}.</b> {left_value}", option_style) if left_value else ''
                right_cell = Paragraph(f"<b>{right_key}.</b> {right_value}", option_style) if right_value else ''
                rows.append([left_cell, right_cell])
            if rows:
                mcq_table = Table(rows, colWidths=[3.25*inch, 3.25*inch])
                mcq_table.setStyle(TableStyle([
                    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                    ('TOPPADDING', (0, 0), (-1, -1), 2),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
                    ('LEFTPADDING', (0, 0), (-1, -1), 0),
                ]))
                elements.append(mcq_table)
            rendered_extra = True

        elif item['question_type'] == 'FILL_BLANK' and item['fill_blank_items']:
            for blank_line in item['fill_blank_items']:
                elements.append(Paragraph(blank_line, option_style))
            rendered_extra = True

        elif item['question_type'] == 'MATCHING' and item['matching_pairs']:
            data = [['Column A', 'Column B']] + [
                [pair['left'], pair['right']] for pair in item['matching_pairs']
            ]
            table = Table(data, colWidths=[3.25*inch, 3.25*inch])
            table.setStyle(TableStyle([
                ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#D1D5DB')),
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#F3F4F6')),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, -1), 10),
                ('TOPPADDING', (0, 0), (-1, -1), 4),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ]))
            elements.append(table)
            rendered_extra = True

        elif item['question_type'] == 'TRUE_FALSE':
            # Marker is already inline in the question paragraph above -- nothing more
            # to render, just skip the "blank space for an answer" fallback below.
            rendered_extra = True

        if item['answer_lines']:
            for _ in range(item['answer_lines']):
                elements.append(Paragraph('_' * 70, answer_line_style))
            rendered_extra = True

        # No blanket "blank space for an answer" filler here -- a question only gets
        # extra room when render_options.answer_lines actually asked for it (above).
        # Every other question type -- MCQ, Fill-blank, Matching, True/False, or a
        # SHORT/LONG/ESSAY question with the answer-lines toggle off -- now gets the
        # same tight gap True/False already had.
        elements.append(Spacer(1, 8))
        return elements

    def generate_answer_key(self) -> bytes:
        """
        Generate a separate answer key PDF (for teachers).

        Returns:
            bytes: PDF file content with answers
        """
        # Similar to generate() but includes correct_answer fields
        # Implementation can be added later if needed
        raise NotImplementedError("Answer key generation not yet implemented")


class DateSheetPDFGenerator:
    """
    Render an ExamGroup's date sheet as a printable calendar grid: one row per
    exam date, one column per class. Takes the already-pivoted grid dict from
    examinations.views._build_date_sheet_grid rather than raw queryset data,
    so the PDF and Excel exports can never disagree on layout/ordering.
    """

    def __init__(self, group, grid):
        self.group = group
        self.grid = grid

    @staticmethod
    def _format_date(value):
        """Format a date object or an ISO 'YYYY-MM-DD' string as '02-Dec-2026'."""
        if not value:
            return ''
        if isinstance(value, str):
            try:
                value = datetime.strptime(value, '%Y-%m-%d').date()
            except ValueError:
                return value
        return value.strftime('%d-%b-%Y')

    def generate(self) -> bytes:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import inch
        from reportlab.lib.enums import TA_CENTER
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image

        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=landscape(A4),
            topMargin=0.5 * inch,
            bottomMargin=0.5 * inch,
            leftMargin=0.5 * inch,
            rightMargin=0.5 * inch,
        )
        styles = getSampleStyleSheet()

        school_name_style = ParagraphStyle(
            'DateSheetSchoolName', parent=styles['Heading1'], fontSize=16, alignment=TA_CENTER,
            spaceAfter=2, textColor=colors.HexColor('#1F2937'), fontName='Helvetica-Bold',
        )
        title_style = ParagraphStyle(
            'DateSheetTitle', parent=styles['Heading1'], fontSize=14, alignment=TA_CENTER,
            spaceAfter=4, textColor=colors.HexColor('#374151'), fontName='Helvetica-Bold',
        )
        subtitle_style = ParagraphStyle(
            'DateSheetSubtitle', parent=styles['Normal'], fontSize=10, alignment=TA_CENTER,
            spaceAfter=14, textColor=colors.HexColor('#6B7280'),
        )
        note_style = ParagraphStyle(
            'DateSheetNote', parent=styles['Normal'], fontSize=9,
            textColor=colors.HexColor('#374151'), spaceBefore=12,
        )
        header_cell_style = ParagraphStyle(
            'DateSheetHeaderCell', parent=styles['Normal'], fontSize=9, alignment=TA_CENTER,
            leading=11, textColor=colors.white, fontName='Helvetica-Bold',
        )
        date_cell_style = ParagraphStyle(
            'DateSheetDateCell', parent=styles['Normal'], fontSize=9, alignment=TA_CENTER,
            leading=12, fontName='Helvetica-Bold', textColor=colors.HexColor('#1F2937'),
        )
        subject_cell_style = ParagraphStyle(
            'DateSheetSubjectCell', parent=styles['Normal'], fontSize=9, alignment=TA_CENTER,
            leading=11, textColor=colors.HexColor('#111827'),
        )

        elements = []

        school = self.group.school
        logo_stream = _load_logo_stream(school)
        if logo_stream:
            try:
                logo = Image(logo_stream, width=0.8 * inch, height=0.8 * inch)
                logo.hAlign = 'CENTER'
                elements.append(logo)
                elements.append(Spacer(1, 6))
            except Exception as e:
                logger.warning(f"Could not render school logo: {str(e)}")
        if school and getattr(school, 'name', None):
            elements.append(Paragraph(school.name, school_name_style))

        elements.append(Paragraph(f'Date Sheet — {self.group.name}', title_style))

        period = ''
        if self.group.start_date and self.group.end_date:
            period = f'{self._format_date(self.group.start_date)} to {self._format_date(self.group.end_date)}'
        if period:
            elements.append(Paragraph(period, subtitle_style))

        columns = self.grid['columns']
        header = [
            Paragraph('Date', header_cell_style),
        ] + [Paragraph(col['label'], header_cell_style) for col in columns]
        table_data = [header]
        for row in self.grid['rows']:
            date_cell = Paragraph(
                f"{self._format_date(row['date'])}<br/>{row['day_name']}", date_cell_style,
            )
            subject_cells = []
            for col in columns:
                value = row['cells'].get(col['class_id'], '') or '-'
                subject_cells.append(Paragraph(value.replace(' / ', '<br/>'), subject_cell_style))
            table_data.append([date_cell] + subject_cells)

        if len(table_data) == 1:
            table_data.append(
                [Paragraph('—', date_cell_style)]
                + [Paragraph('—', subject_cell_style) for _ in columns]
            )

        available_width = landscape(A4)[0] - 1 * inch
        date_col_width = 1.3 * inch
        remaining = available_width - date_col_width
        class_col_width = remaining / len(columns) if columns else remaining
        col_widths = [date_col_width] + [class_col_width] * len(columns)

        table = Table(table_data, colWidths=col_widths, repeatRows=1)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#2563EB')),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#D1D5DB')),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F9FAFB')]),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ]))
        elements.append(table)

        if self.grid['unscheduled']:
            elements.append(Spacer(1, 6))
            elements.append(Paragraph('<b>Not yet scheduled:</b>', note_style))
            for item in self.grid['unscheduled']:
                elements.append(Paragraph(
                    f"&bull; {item['subject_name']} ({item['class_name']})", note_style,
                ))

        doc.build(elements)
        logger.info(f"Generated date sheet PDF for ExamGroup {self.group.id}")
        return buffer.getvalue()
