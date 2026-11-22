"""
ReportLab PDFs that are still made on the server: the exam date sheet (and, via ``_load_logo_stream``,
the timetable PDF in academics). Exam papers and worksheets no longer print here: since Paper Builder v2
Phase 7 they are printed on the device from ``print-html``.
"""

import io
import logging
from datetime import datetime

import requests

from core.url_safety import assert_safe_external_url, UnsafeUrlError

logger = logging.getLogger(__name__)


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
        assert_safe_external_url(logo_url)
    except UnsafeUrlError as e:
        logger.warning(f"Rejected unsafe school logo URL: {e}")
        return None
    try:
        resp = requests.get(logo_url, timeout=8)
        resp.raise_for_status()
        return io.BytesIO(resp.content)
    except Exception as e:
        logger.warning(f"Could not fetch school logo: {str(e)}")
        return None


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
