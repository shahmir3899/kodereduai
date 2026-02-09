"""
Table Extractor for parsing attendance register structure.

Pipeline step 2: OCR → Structured Table
"""

import logging
import re
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from datetime import date

from .ocr_service import OCRResult, OCRCell

logger = logging.getLogger(__name__)


@dataclass
class AttendanceCell:
    """A single attendance mark in the table."""
    raw_text: str
    normalized_status: str  # PRESENT, ABSENT, LATE, LEAVE, UNKNOWN
    confidence: float
    row_index: int
    col_index: int
    student_roll: Optional[str] = None
    student_name: Optional[str] = None
    date_column: Optional[int] = None  # Day of month this column represents


@dataclass
class StudentRow:
    """A row representing one student's attendance."""
    row_index: int
    roll_number: Optional[str]
    name: Optional[str]
    attendance_marks: Dict[int, AttendanceCell] = field(default_factory=dict)  # day -> mark
    page_number: Optional[int] = None  # For multi-page registers


@dataclass
class StructuredTable:
    """Complete structured representation of an attendance register."""
    students: List[StudentRow]
    date_columns: Dict[int, int]  # column_index -> day_of_month
    header_row: Optional[List[str]] = None
    extraction_confidence: float = 0.0
    warnings: List[str] = field(default_factory=list)


class TableExtractor:
    """
    Extracts structured table data from OCR results.

    Uses school-specific configuration to interpret the register layout.
    """

    def __init__(self, school, target_date: date):
        """
        Initialize extractor with school configuration.

        Args:
            school: School model instance with register_config and mark_mappings
            target_date: The date we're extracting attendance for
        """
        self.school = school
        self.target_date = target_date
        self.config = school.register_config
        self.mark_mappings = school.mark_mappings

    def extract_table(self, ocr_result: OCRResult) -> StructuredTable:
        """
        Extract structured table from OCR result.

        Args:
            ocr_result: Output from OCRService

        Returns:
            StructuredTable with parsed student attendance
        """
        if not ocr_result.success:
            return StructuredTable(
                students=[],
                date_columns={},
                extraction_confidence=0.0,
                warnings=[f"OCR failed: {ocr_result.error}"]
            )

        # Step 1: Organize cells into grid
        grid = self._build_grid_from_cells(ocr_result.cells)
        if not grid:
            return StructuredTable(
                students=[],
                date_columns={},
                extraction_confidence=0.0,
                warnings=["Could not build grid from OCR output"]
            )

        # Step 2: Identify date columns (header row)
        date_columns = self._find_date_columns(grid)

        # Step 3: Extract student rows
        students = self._extract_student_rows(grid, date_columns)

        # Step 4: Calculate overall confidence
        all_confidences = [
            cell.confidence
            for student in students
            for cell in student.attendance_marks.values()
        ]
        avg_confidence = sum(all_confidences) / len(all_confidences) if all_confidences else 0.0

        warnings = []
        if self.target_date.day not in date_columns.values():
            warnings.append(f"Target date column ({self.target_date.day}) not found in header")

        return StructuredTable(
            students=students,
            date_columns=date_columns,
            header_row=self._get_header_texts(grid),
            extraction_confidence=avg_confidence,
            warnings=warnings
        )

    def _build_grid_from_cells(
        self,
        cells: List[OCRCell],
        row_tolerance: int = 15,
        col_tolerance: int = 10
    ) -> List[List[OCRCell]]:
        """
        Build a 2D grid from OCR cells based on their positions.

        Args:
            cells: List of OCR cells
            row_tolerance: Y-position tolerance for same row
            col_tolerance: X-position tolerance for same column

        Returns:
            2D grid of cells
        """
        if not cells:
            return []

        # Sort by y, then x
        sorted_cells = sorted(cells, key=lambda c: (c.bbox[1], c.bbox[0]))

        # Group into rows
        rows = []
        current_row = [sorted_cells[0]]
        current_y = sorted_cells[0].bbox[1]

        for cell in sorted_cells[1:]:
            if abs(cell.bbox[1] - current_y) <= row_tolerance:
                current_row.append(cell)
            else:
                current_row.sort(key=lambda c: c.bbox[0])
                rows.append(current_row)
                current_row = [cell]
                current_y = cell.bbox[1]

        if current_row:
            current_row.sort(key=lambda c: c.bbox[0])
            rows.append(current_row)

        return rows

    def _find_date_columns(self, grid: List[List[OCRCell]]) -> Dict[int, int]:
        """
        Find which columns correspond to which days of the month.

        Args:
            grid: 2D grid of cells

        Returns:
            Dict mapping column index to day of month
        """
        date_columns = {}
        header_row_idx = self.config.get('date_header_row', 0)

        if header_row_idx >= len(grid):
            logger.warning("Header row index out of bounds")
            return date_columns

        header_row = grid[header_row_idx]
        data_start_col = self.config.get('data_start_col', 2)

        for col_idx, cell in enumerate(header_row):
            if col_idx < data_start_col:
                continue

            # Try to parse as day number
            text = cell.text.strip()
            day_match = re.match(r'^(\d{1,2})$', text)
            if day_match:
                day = int(day_match.group(1))
                if 1 <= day <= 31:
                    date_columns[col_idx] = day
                    logger.debug(f"Column {col_idx} = Day {day}")

        logger.info(f"Found {len(date_columns)} date columns")
        return date_columns

    def _extract_student_rows(
        self,
        grid: List[List[OCRCell]],
        date_columns: Dict[int, int]
    ) -> List[StudentRow]:
        """
        Extract student attendance rows from the grid.

        Args:
            grid: 2D grid of cells
            date_columns: Mapping of column index to day

        Returns:
            List of StudentRow objects
        """
        students = []
        data_start_row = self.config.get('data_start_row', 1)
        name_col = self.config.get('student_name_col', 0)
        roll_col = self.config.get('roll_number_col', 1)

        for row_idx, row in enumerate(grid):
            if row_idx < data_start_row:
                continue

            # Skip if row is too short
            if len(row) < 2:
                continue

            # Extract student info
            roll_number = None
            student_name = None

            if roll_col >= 0 and roll_col < len(row):
                roll_text = row[roll_col].text.strip()
                if roll_text and re.match(r'^\d+$', roll_text):
                    roll_number = roll_text

            if name_col >= 0 and name_col < len(row):
                name_text = row[name_col].text.strip()
                # Filter out non-name entries (pure numbers, single chars)
                if name_text and len(name_text) > 1 and not name_text.isdigit():
                    student_name = name_text

            # Skip rows that don't look like student rows
            if not roll_number and not student_name:
                continue

            # Extract attendance marks
            attendance_marks = {}
            for col_idx, day in date_columns.items():
                if col_idx < len(row):
                    cell = row[col_idx]
                    status = self.school.get_status_for_mark(cell.text)

                    attendance_marks[day] = AttendanceCell(
                        raw_text=cell.text,
                        normalized_status=status,
                        confidence=cell.confidence,
                        row_index=row_idx,
                        col_index=col_idx,
                        student_roll=roll_number,
                        student_name=student_name,
                        date_column=day
                    )

            student_row = StudentRow(
                row_index=row_idx,
                roll_number=roll_number,
                name=student_name,
                attendance_marks=attendance_marks
            )
            students.append(student_row)

        logger.info(f"Extracted {len(students)} student rows")
        return students

    def _get_header_texts(self, grid: List[List[OCRCell]]) -> Optional[List[str]]:
        """Extract header row texts."""
        header_row_idx = self.config.get('date_header_row', 0)
        if header_row_idx < len(grid):
            return [cell.text for cell in grid[header_row_idx]]
        return None

    def get_attendance_for_date(
        self,
        table: StructuredTable,
        target_day: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        Get attendance records for a specific date.

        Args:
            table: StructuredTable from extract_table
            target_day: Day of month (defaults to target_date.day)

        Returns:
            List of dicts with student info and attendance status
        """
        if target_day is None:
            target_day = self.target_date.day

        results = []

        for student in table.students:
            if target_day in student.attendance_marks:
                mark = student.attendance_marks[target_day]
                results.append({
                    'roll_number': student.roll_number,
                    'name': student.name,
                    'raw_mark': mark.raw_text,
                    'status': mark.normalized_status,
                    'confidence': mark.confidence,
                    'row_index': student.row_index
                })

        return results

    def to_json(self, table: StructuredTable) -> Dict[str, Any]:
        """
        Convert StructuredTable to JSON-serializable dict.

        Args:
            table: StructuredTable object

        Returns:
            Dict representation for storage/API
        """
        return {
            'students': [
                {
                    'row_index': s.row_index,
                    'roll_number': s.roll_number,
                    'name': s.name,
                    'page_number': s.page_number,
                    'attendance': {
                        str(day): {
                            'raw': mark.raw_text,
                            'status': mark.normalized_status,
                            'confidence': mark.confidence
                        }
                        for day, mark in s.attendance_marks.items()
                    }
                }
                for s in table.students
            ],
            'date_columns': {str(k): v for k, v in table.date_columns.items()},
            'header_row': table.header_row,
            'extraction_confidence': table.extraction_confidence,
            'warnings': table.warnings
        }
