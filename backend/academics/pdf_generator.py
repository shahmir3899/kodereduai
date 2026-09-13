"""PDF export for the class Timetable grid.

Mirrors the layout approach used by examinations.pdf_generator.DateSheetPDFGenerator
(same page setup, header styling, and school-logo loading) so timetable exports look
consistent with the rest of the exam/report PDFs rather than introducing a new style.
"""
import io
import logging

from examinations.pdf_generator import _load_logo_stream

logger = logging.getLogger(__name__)

DAY_LABELS = {
    'MON': 'Monday', 'TUE': 'Tuesday', 'WED': 'Wednesday',
    'THU': 'Thursday', 'FRI': 'Friday', 'SAT': 'Saturday',
}
DAY_ORDER = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']


class TimetablePDFGenerator:
    """Renders a class's weekly timetable as a printable grid: one row per
    time slot, one column per day. Break/lunch/assembly slots are shown as a
    merged label rather than per-day cells since they don't vary by class."""

    def __init__(self, school, class_name, slots, entries):
        self.school = school
        self.class_name = class_name
        self.slots = slots  # list of TimetableSlot, already ordered
        # entries: list of dicts with day, slot, subject_name/code, teacher_name, room
        self.entries_by_key = {(e['day'], e['slot']): e for e in entries}

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
            'TimetableSchoolName', parent=styles['Heading1'], fontSize=16, alignment=TA_CENTER,
            spaceAfter=2, textColor=colors.HexColor('#1F2937'), fontName='Helvetica-Bold',
        )
        title_style = ParagraphStyle(
            'TimetableTitle', parent=styles['Heading1'], fontSize=14, alignment=TA_CENTER,
            spaceAfter=14, textColor=colors.HexColor('#374151'), fontName='Helvetica-Bold',
        )
        header_cell_style = ParagraphStyle(
            'TimetableHeaderCell', parent=styles['Normal'], fontSize=9, alignment=TA_CENTER,
            leading=11, textColor=colors.white, fontName='Helvetica-Bold',
        )
        time_cell_style = ParagraphStyle(
            'TimetableTimeCell', parent=styles['Normal'], fontSize=8.5, alignment=TA_CENTER,
            leading=11, fontName='Helvetica-Bold', textColor=colors.HexColor('#1F2937'),
        )
        entry_cell_style = ParagraphStyle(
            'TimetableEntryCell', parent=styles['Normal'], fontSize=8.5, alignment=TA_CENTER,
            leading=10.5, textColor=colors.HexColor('#111827'),
        )
        break_cell_style = ParagraphStyle(
            'TimetableBreakCell', parent=styles['Normal'], fontSize=8.5, alignment=TA_CENTER,
            leading=10.5, textColor=colors.HexColor('#6B7280'), fontName='Helvetica-Oblique',
        )

        elements = []

        logo_stream = _load_logo_stream(self.school)
        if logo_stream:
            try:
                logo = Image(logo_stream, width=0.7 * inch, height=0.7 * inch)
                logo.hAlign = 'CENTER'
                elements.append(logo)
                elements.append(Spacer(1, 4))
            except Exception as e:
                logger.warning(f"Could not render school logo: {str(e)}")
        if self.school and getattr(self.school, 'name', None):
            elements.append(Paragraph(self.school.name, school_name_style))

        elements.append(Paragraph(f'Timetable — {self.class_name}', title_style))

        days = [d for d in DAY_ORDER]
        header = [Paragraph('Time', header_cell_style)] + [
            Paragraph(DAY_LABELS[d], header_cell_style) for d in days
        ]
        table_data = [header]

        for slot in self.slots:
            time_label = f"{slot.name}<br/>{slot.start_time.strftime('%H:%M')}-{slot.end_time.strftime('%H:%M')}"
            row = [Paragraph(time_label, time_cell_style)]
            is_break = slot.slot_type != 'PERIOD'
            for day in days:
                if day not in (slot.applicable_days or []):
                    row.append(Paragraph('—', break_cell_style))
                    continue
                if is_break:
                    row.append(Paragraph(slot.get_slot_type_display(), break_cell_style))
                    continue
                entry = self.entries_by_key.get((day, slot.id))
                if not entry or not entry.get('subject_name'):
                    row.append(Paragraph('-', entry_cell_style))
                    continue
                label = entry.get('subject_code') or entry['subject_name']
                if entry.get('teacher_name'):
                    label += f"<br/>{entry['teacher_name']}"
                row.append(Paragraph(label, entry_cell_style))
            table_data.append(row)

        if len(table_data) == 1:
            table_data.append([Paragraph('No time slots configured.', entry_cell_style)] + ['' for _ in days])

        available_width = landscape(A4)[0] - 1 * inch
        time_col_width = 1.3 * inch
        remaining = available_width - time_col_width
        day_col_width = remaining / len(days)
        col_widths = [time_col_width] + [day_col_width] * len(days)

        table = Table(table_data, colWidths=col_widths, repeatRows=1)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#2563EB')),
            ('FONTSIZE', (0, 0), (-1, -1), 8.5),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#D1D5DB')),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F9FAFB')]),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ]))
        elements.append(table)

        doc.build(elements)
        logger.info(f"Generated timetable PDF for class {self.class_name}")
        return buffer.getvalue()
