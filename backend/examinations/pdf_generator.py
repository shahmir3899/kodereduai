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

from .paper_export_layout import build_export_layout, resolve_exam_paper_class_name

logger = logging.getLogger(__name__)


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
            else:
                elements = self._build_structured_elements(layout)

            doc.build(elements)

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
        if hasattr(self.school, 'logo_url') and self.school.logo_url:
            try:
                logo = Image(self.school.logo_url, width=1*inch, height=1*inch)
                logo.hAlign = 'CENTER'
                elements.append(logo)
                elements.append(Spacer(1, 8))
            except Exception as e:
                logger.warning(f"Could not load school logo: {str(e)}")

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

            question_text = question.get('question_text') or ''
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

        if hasattr(self.school, 'logo_url') and self.school.logo_url:
            try:
                logo = Image(self.school.logo_url, width=1*inch, height=1*inch)
                logo.hAlign = 'CENTER'
                elements.append(logo)
                elements.append(Spacer(1, 8))
            except Exception as e:
                logger.warning(f"Could not load school logo: {str(e)}")

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
            'Question', parent=styles['Normal'], fontSize=11, spaceAfter=10,
            textColor=colors.HexColor('#111827'), leading=14
        )
        option_style = ParagraphStyle(
            'Option', parent=styles['Normal'], fontSize=10, spaceAfter=4,
            leftIndent=30, textColor=colors.HexColor('#374151')
        )
        answer_line_style = ParagraphStyle(
            'AnswerLine', parent=styles['Normal'], fontSize=11, spaceAfter=10,
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
        elements.append(Paragraph(f"Name: {'_' * 40}", meta_line_style))
        elements.append(Paragraph(f"Roll No: {'_' * 20}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Date: {'_' * 15}", meta_line_style))
        elements.append(Paragraph(
            f"Total Marks: {header['total_marks']}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Time: {header['duration_minutes']} minutes",
            meta_line_style,
        ))
        elements.append(Spacer(1, 12))

        divider_table = Table([['']], colWidths=[6.5*inch])
        divider_table.setStyle(TableStyle([
            ('LINEABOVE', (0, 0), (-1, 0), 1, colors.HexColor('#D1D5DB')),
        ]))
        elements.append(divider_table)
        elements.append(Spacer(1, 16))

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
                elements.append(Spacer(1, 8))

            for item in block['items']:
                elements.extend(self._build_question_elements(
                    item, question_style, option_style, answer_line_style, true_false_style,
                    Paragraph, Spacer, Table, TableStyle, colors, inch,
                ))

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
        footer_text = f"Generated on {datetime.now().strftime('%d %B %Y')} | {header['school_name']}"
        if self.exam_paper.generated_by:
            footer_text += f" | Prepared by: {self.exam_paper.generated_by.get_full_name() or self.exam_paper.generated_by.username}"
        elements.append(Paragraph(footer_text, footer_style))

        return elements

    def _build_section_heading_table(self, block, left_style, right_style, Table, TableStyle, inch):
        heading_text = block['title']
        if block['instruction']:
            heading_text = f"{heading_text}. {block['instruction']}"

        row = [[
            self._paragraph(heading_text, left_style),
            self._paragraph(f"({block['section_marks']})", right_style),
        ]]
        table = Table(row, colWidths=[5*inch, 1.5*inch])
        table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ]))
        return table

    @staticmethod
    def _paragraph(text, style):
        from reportlab.platypus import Paragraph
        return Paragraph(text, style)

    def _build_question_elements(
        self, item, question_style, option_style, answer_line_style, true_false_style,
        Paragraph, Spacer, Table, TableStyle, colors, inch,
    ):
        elements = []
        q_header = f"<b>Q{item['number']}.</b> [{item['marks']} mark{'s' if item['marks'] != 1 else ''}]"
        elements.append(Paragraph(q_header, question_style))
        elements.append(Paragraph(item['question_text'] or '', question_style))

        rendered_extra = False

        if item['question_type'] == 'MCQ' and item['options']:
            for option_key in ('A', 'B', 'C', 'D'):
                option_value = item['options'].get(option_key)
                if option_value:
                    elements.append(Paragraph(f"<b>{option_key}.</b> {option_value}", option_style))
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
            elements.append(Paragraph('True / False', true_false_style))
            rendered_extra = True

        if item['answer_lines']:
            for _ in range(item['answer_lines']):
                elements.append(Paragraph('_' * 70, answer_line_style))
            rendered_extra = True

        if not rendered_extra:
            elements.append(Spacer(1, 0.5*inch))

        elements.append(Spacer(1, 16))
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
        if school and getattr(school, 'logo', None):
            try:
                logo = Image(school.logo, width=0.8 * inch, height=0.8 * inch)
                logo.hAlign = 'CENTER'
                elements.append(logo)
                elements.append(Spacer(1, 6))
            except Exception as e:
                logger.warning(f"Could not load school logo: {str(e)}")
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
