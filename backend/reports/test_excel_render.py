"""XLSX export from the shared report renderer. render_excel merges A1:F1 for the title, and the
column sizing read the letter from row 1, where B-F are MergedCells with no column_letter, so
every table report crashed as XLSX. Uses the shared seed school; rows made here roll back."""
import datetime
import io

import pytest
from openpyxl import load_workbook

from reports.generators.attendance import MonthlyAttendanceReportGenerator
from reports.generators.base import BaseReportGenerator


def _rows(xlsx_bytes):
    ws = load_workbook(io.BytesIO(xlsx_bytes)).active
    return ws, [[c.value for c in row] for row in ws.iter_rows()]


@pytest.mark.django_db
def test_a_table_report_exports_as_xlsx(seed_data):
    class TwoColumns(BaseReportGenerator):
        def get_data(self):
            return {'title': 'T', 'table_headers': ['a', 'b'], 'table_rows': [[1, 2]]}

    ws, rows = _rows(TwoColumns(seed_data['school_a']).generate('XLSX'))
    assert ['a', 'b'] in [r[:2] for r in rows]
    assert ws.column_dimensions['B'].width > 0


@pytest.mark.django_db
def test_monthly_attendance_exports_as_xlsx(seed_data):
    from attendance.models import AttendanceRecord

    day = datetime.date(2026, 3, 2)
    for student, status in zip(seed_data['students'][:3], ['PRESENT', 'ABSENT', 'PRESENT']):
        AttendanceRecord.objects.create(
            school=seed_data['school_a'], academic_year=seed_data['academic_year'],
            student=student, date=day, status=status,
        )

    generator = MonthlyAttendanceReportGenerator(seed_data['school_a'], {'month': 3, 'year': 2026})
    headers = generator.get_data()['table_headers']
    ws, rows = _rows(generator.generate('XLSX'))

    header_row = next(i for i, r in enumerate(rows) if r[:len(headers)] == headers)
    names = {r[headers.index('Name')] for r in rows[header_row + 1:]}
    assert {s.name for s in seed_data['students'][:3]} <= names
    assert rows[0][0] == seed_data['school_a'].name
