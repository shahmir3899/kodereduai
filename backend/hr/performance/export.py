"""
PDF / Excel export of a teacher performance report, on the shared reports generator base.
"""

import io

from reports.generators.base import BaseReportGenerator

from .scoring import MEASURE_LABELS

SHORT_LABELS = {
    'attendance_marking': 'Class att.',
    'lesson_plans': 'Lesson plans',
    'marks_entry': 'Marks',
    'own_attendance': 'Own att.',
    'homework': 'HW & diary',
    'grading': 'Grading',
    'messages_answered': 'Messages',
    'question_papers': 'Papers',
    'book_content': 'Book content',
    'login_days': 'Login days',
}


def _score(v):
    return '—' if v is None else f'{float(v):.1f}'


class TeacherPerformanceReportGenerator(BaseReportGenerator):
    """parameters: {'report': the dict from snapshots.report_for()}."""

    def get_data(self):
        report = self.parameters['report']
        period = report['period']
        teachers = report['teachers']
        scored = [t['overall_score'] for t in teachers if t['overall_score'] is not None]
        subtitle = f"{period['start']} to {period['end']}"
        if report.get('snapshot'):
            subtitle += ' (frozen month)'
        elif period.get('counted_until') and period['counted_until'] != period['end']:
            subtitle += f" (counted until {period['counted_until']})"
        return {
            'title': f'{self.school.name} – Teacher Performance',
            'subtitle': subtitle,
            'summary': {
                'Teachers ranked': report['out_of'],
                'Average score': _score(sum(scored) / len(scored)) if scored else '—',
            },
            'table_headers': ['Rank', 'Teacher', 'Score', 'Band', *[SHORT_LABELS[k] for k in MEASURE_LABELS], 'Quickest wins'],
            'table_rows': [
                [
                    t['rank'] or '—',
                    t['name'],
                    _score(t['overall_score']),
                    (t.get('band') or {}).get('label', '—'),
                    *[
                        _score(t['measures'][k]['score']) if t['measures'][k]['applicable'] else 'n/a'
                        for k in MEASURE_LABELS
                    ],
                    ', '.join(w['label'] for w in t.get('quickest_wins', [])) or '—',
                ]
                for t in teachers
            ],
            # Excel only (the PDF has no room): information figures, never part of the score.
            'info_headers': [
                'Topics planned', 'Taught on schedule', 'Questions added', 'Class result average %', 'Leave days',
            ],
            'info_rows': [_info_row(t.get('info') or {}) for t in teachers],
        }

    def render_excel(self, data):
        """Own writer: the base renderer sizes columns from row 1, which is a merged title cell, and
        openpyxl's MergedCell has no column_letter (AttributeError)."""
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill
        from openpyxl.utils import get_column_letter

        wb = Workbook()
        ws = wb.active
        ws.title = 'Teacher performance'
        ws.append([data['title']])
        ws['A1'].font = Font(bold=True, size=14)
        ws.append([data['subtitle']])
        for k, v in data['summary'].items():
            ws.append([k, v])
        ws.append([])
        ws.append([*data['table_headers'], *data.get('info_headers', [])])
        header_row = ws.max_row
        for c in ws[header_row]:
            c.font = Font(bold=True)
            c.fill = PatternFill('solid', fgColor='F3F4F6')
        info_rows = data.get('info_rows') or [[] for _ in data['table_rows']]
        for row, info in zip(data['table_rows'], info_rows):
            # Numbers as numbers so the sheet can be sorted and averaged.
            ws.append([*(_number_or_text(v) for v in row), *info])
        widths = [6, 26, 8, 16] + [12] * len(SHORT_LABELS) + [48] + [14] * len(data.get('info_headers', []))
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(i)].width = w
        ws.freeze_panes = ws.cell(row=header_row + 1, column=3)
        out = io.BytesIO()
        wb.save(out)
        return out.getvalue()

    def render_pdf(self, data):
        """Landscape: fourteen columns do not fit portrait A4 (the base renderer's page)."""
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib.units import inch
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=landscape(A4), topMargin=0.4 * inch, bottomMargin=0.4 * inch,
                                leftMargin=0.35 * inch, rightMargin=0.35 * inch)
        styles = getSampleStyleSheet()
        cell = styles['BodyText'].clone('cell', fontSize=7, leading=8.5)
        head = styles['BodyText'].clone('head', fontSize=7, leading=8.5, fontName='Helvetica-Bold')
        elements = [
            Paragraph(data['title'], styles['Heading2']),
            Paragraph(data['subtitle'], styles['Normal']),
            Paragraph(' · '.join(f'{k}: {v}' for k, v in data['summary'].items()), styles['Normal']),
            Spacer(1, 8),
        ]
        rows = [[Paragraph(str(h), head) for h in data['table_headers']]]
        rows += [[Paragraph(str(c), cell) for c in r] for r in data['table_rows']]
        # Inches; totals 10.95 of the 10.99 usable on landscape A4 with 0.35in side margins.
        widths = [0.45, 1.3, 0.5, 0.8] + [0.65] * 10 + [1.4]
        table = Table(rows, colWidths=[w * inch for w in widths], repeatRows=1)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f3f4f6')),
            ('GRID', (0, 0), (-1, -1), 0.25, colors.HexColor('#d1d5db')),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ]))
        elements.append(table)
        doc.build(elements)
        return buffer.getvalue()


def _number_or_text(value):
    try:
        return float(value) if isinstance(value, str) and value.replace('.', '', 1).isdigit() else value
    except ValueError:
        return value


def _info_row(info):
    syllabus = info.get('syllabus_on_schedule') or {}
    return [
        syllabus.get('planned', ''),
        syllabus.get('taught_on_time', ''),
        info.get('questions_added', ''),
        info.get('class_result_average') if info.get('class_result_average') is not None else '',
        info.get('leave_days', ''),
    ]

