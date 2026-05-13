"""
Google Cloud Vision Extractor for attendance register images.

Uses Google's DOCUMENT_TEXT_DETECTION with:
1. Spatial table reconstruction - uses word positions to rebuild the table grid
2. Fuzzy name matching - matches OCR names to database using string similarity
3. Serial number reconstruction - infers missing serial numbers from neighbors
"""

import logging
import re
import json
import base64
import requests
from difflib import SequenceMatcher
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, field
from datetime import date

from django.conf import settings

from students.models import Student

logger = logging.getLogger(__name__)


@dataclass
class ExtractedStudent:
    """A student row extracted from the register."""
    roll_number: str           # Serial number from register (may differ from DB roll)
    name: str                  # Name extracted from register
    attendance: Dict[str, Dict[str, str]] = field(default_factory=dict)
    page_number: int = 1
    confidence: float = 0.0
    # Database matching (populated by _match_students_to_database)
    matched_db_id: Optional[int] = None
    matched_db_name: Optional[str] = None
    matched_db_roll: Optional[str] = None
    match_method: str = ''     # 'name_fuzzy', 'roll_exact', 'serial_order'
    match_score: float = 0.0


@dataclass
class GoogleVisionResult:
    """Result from Google Vision extraction."""
    success: bool
    students: List[ExtractedStudent]
    date_columns: List[int]
    raw_text: str
    confidence: float
    error: Optional[str] = None
    full_response: Optional[Dict] = None


class GoogleVisionExtractor:
    """
    Extract attendance data from register images using Google Cloud Vision API.

    Uses DOCUMENT_TEXT_DETECTION with spatial awareness for:
    - Handwritten text in tabular layouts
    - Fuzzy name matching to handle OCR errors
    - Serial number reconstruction for missing entries
    """

    def __init__(self, school, class_obj, target_date: date, threshold_service=None):
        self.school = school
        self.class_obj = class_obj
        self.target_date = target_date
        self.target_day = target_date.day

        # Threshold service for configurable per-school thresholds
        if threshold_service is None:
            from .threshold_service import ThresholdService
            threshold_service = ThresholdService(school)
        self.threshold_service = threshold_service

        # Get enrolled students for matching
        self.enrolled_students = list(
            Student.objects.filter(
                school=school,
                class_obj=class_obj,
                is_active=True
            ).values('id', 'roll_number', 'name')
        )

        # Build roll number lookup
        self.roll_to_student = {
            str(s['roll_number']): s for s in self.enrolled_students
        }

        # Get school's mark mappings
        self.mark_mappings = self._get_mark_mappings()
        logger.info(f"[GoogleVision] School {school.id}: mark_mappings = {self.mark_mappings}")

        # Google Vision API credentials
        self.api_key = getattr(settings, 'GOOGLE_VISION_API_KEY', None)
        self.credentials_path = getattr(settings, 'GOOGLE_APPLICATION_CREDENTIALS', None)

    def _get_mark_mappings(self) -> Dict[str, str]:
        """
        Get the school's configured mark mappings.

        School stores mappings as {status: [marks]} e.g.:
            {"PRESENT": ["P", "✓", "/"], "ABSENT": ["A", "X", "-"]}
        We convert to flat {mark: status} for fast lookup e.g.:
            {"P": "PRESENT", "✓": "PRESENT", "/": "PRESENT", ...}
        """
        # Hardcoded defaults (flat: mark -> status)
        default_mappings = {
            'P': 'PRESENT', '✓': 'PRESENT', '√': 'PRESENT', 'V': 'PRESENT',
            '✔': 'PRESENT', '/': 'PRESENT', '1': 'PRESENT',
            'A': 'ABSENT', '✗': 'ABSENT', 'X': 'ABSENT', 'AB': 'ABSENT',
            '-': 'ABSENT', '0': 'ABSENT',
            'L': 'LATE', 'T': 'LATE',
            '': 'UNMARKED',
        }

        # Merge school's {status: [marks]} mappings into flat {mark: status}
        if hasattr(self.school, 'mark_mappings') and self.school.mark_mappings:
            for status, symbols in self.school.mark_mappings.items():
                if status == 'default':
                    continue
                if isinstance(symbols, list):
                    for symbol in symbols:
                        default_mappings[symbol] = status
                        # Also add uppercase variant for case-insensitive lookup
                        if isinstance(symbol, str) and symbol.upper() != symbol:
                            default_mappings[symbol.upper()] = status

        return default_mappings

    # ==========================================================
    # API CALLS
    # ==========================================================

    def _fetch_image_as_base64(self, image_url: str) -> Tuple[Optional[str], Optional[str]]:
        """Fetch image and convert to base64."""
        try:
            logger.info(f"Fetching image: {image_url}")
            response = requests.get(image_url, timeout=30)
            response.raise_for_status()

            image_data = base64.b64encode(response.content).decode('utf-8')
            logger.info(f"Image fetched, size: {len(response.content)} bytes")
            return image_data, None

        except requests.RequestException as e:
            logger.error(f"Failed to fetch image: {e}")
            return None, f"Could not fetch image: {str(e)}"

    def _call_vision_api(self, image_base64: str) -> Tuple[Optional[Dict], Optional[str]]:
        """Call Google Cloud Vision API."""
        if self.api_key:
            return self._call_with_api_key(image_base64)
        if self.credentials_path:
            return self._call_with_service_account(image_base64)
        return None, "Google Vision not configured. Set GOOGLE_VISION_API_KEY or GOOGLE_APPLICATION_CREDENTIALS in .env"

    def _call_with_api_key(self, image_base64: str) -> Tuple[Optional[Dict], Optional[str]]:
        """Call Vision API using API key."""
        url = f"https://vision.googleapis.com/v1/images:annotate?key={self.api_key}"

        payload = {
            "requests": [{
                "image": {"content": image_base64},
                "features": [
                    {"type": "DOCUMENT_TEXT_DETECTION"},
                ],
                "imageContext": {
                    "languageHints": ["en", "hi"]
                }
            }]
        }

        try:
            logger.info("Calling Google Vision API with API key...")
            response = requests.post(url, json=payload, timeout=60)

            try:
                result = response.json()
            except Exception:
                result = {}

            if response.status_code != 200:
                error_info = result.get('error', {})
                error_message = error_info.get('message', response.text[:500])
                error_status = error_info.get('status', 'UNKNOWN')
                error_code = error_info.get('code', response.status_code)

                full_error = f"HTTP {error_code} ({error_status}): {error_message}"
                logger.error(f"Vision API error response: {full_error}")
                logger.error(f"Full error details: {json.dumps(error_info, indent=2)}")
                return None, full_error

            if 'error' in result:
                return None, f"API Error: {result['error'].get('message', 'Unknown error')}"

            return result, None

        except requests.RequestException as e:
            logger.error(f"Vision API call failed: {e}")
            return None, f"Vision API error: {str(e)}"

    def _call_with_service_account(self, image_base64: str) -> Tuple[Optional[Dict], Optional[str]]:
        """Call Vision API using service account credentials."""
        try:
            from google.cloud import vision
            from google.oauth2 import service_account

            credentials = service_account.Credentials.from_service_account_file(
                self.credentials_path
            )
            client = vision.ImageAnnotatorClient(credentials=credentials)

            image = vision.Image(content=base64.b64decode(image_base64))

            response = client.document_text_detection(
                image=image,
                image_context={"language_hints": ["en", "hi"]}
            )

            if response.error.message:
                return None, f"Vision API error: {response.error.message}"

            result = {
                "responses": [{
                    "fullTextAnnotation": {
                        "text": response.full_text_annotation.text if response.full_text_annotation else ""
                    },
                    "textAnnotations": [
                        {
                            "description": ann.description,
                            "boundingPoly": {
                                "vertices": [
                                    {"x": v.x, "y": v.y} for v in ann.bounding_poly.vertices
                                ]
                            }
                        }
                        for ann in response.text_annotations
                    ]
                }]
            }

            return result, None

        except ImportError:
            return None, "google-cloud-vision library not installed. Run: pip install google-cloud-vision"
        except Exception as e:
            logger.error(f"Service account Vision API call failed: {e}")
            return None, f"Vision API error: {str(e)}"

    # ==========================================================
    # RESPONSE PARSING
    # ==========================================================

    def _parse_vision_response(self, response: Dict) -> GoogleVisionResult:
        """Parse Vision API response using spatial word positions."""
        try:
            responses = response.get('responses', [])
            if not responses:
                return GoogleVisionResult(
                    success=False, students=[], date_columns=[],
                    raw_text="", confidence=0.0, error="No response from Vision API"
                )

            first_response = responses[0]

            # Get full text for logging/storage
            full_text = ""
            if 'fullTextAnnotation' in first_response:
                full_text = first_response['fullTextAnnotation'].get('text', '')
            elif 'textAnnotations' in first_response and first_response['textAnnotations']:
                full_text = first_response['textAnnotations'][0].get('description', '')

            logger.info(f"Extracted text length: {len(full_text)}")
            logger.info(f"Raw text preview:\n{full_text[:1000]}...")

            # Extract word positions from textAnnotations
            text_annotations = first_response.get('textAnnotations', [])
            words = self._extract_words_with_positions(text_annotations)

            # Use spatial parsing if we have positioned words
            if len(words) > 5:
                logger.info(f"Using spatial parsing with {len(words)} positioned words")
                students, date_columns = self._parse_spatial_table(words)
            else:
                logger.info("Falling back to text-only parsing")
                students, date_columns = self._parse_register_text(full_text)

            # Match extracted students to database using fuzzy name matching
            self._match_students_to_database(students)

            # Calculate confidence based on matched students
            matched_count = sum(1 for s in students if s.matched_db_id)
            confidence = matched_count / len(self.enrolled_students) if self.enrolled_students else 0.0

            return GoogleVisionResult(
                success=True,
                students=students,
                date_columns=date_columns,
                raw_text=full_text,
                confidence=confidence,
                full_response=response
            )

        except Exception as e:
            logger.error(f"Failed to parse Vision response: {e}", exc_info=True)
            return GoogleVisionResult(
                success=False, students=[], date_columns=[],
                raw_text="", confidence=0.0, error=f"Parse error: {str(e)}"
            )

    # ==========================================================
    # SPATIAL TABLE RECONSTRUCTION
    # ==========================================================

    def _extract_words_with_positions(self, text_annotations: List[Dict]) -> List[Dict]:
        """Extract individual words with their bounding box positions."""
        words = []
        # Skip first annotation (it's the full combined text)
        for ann in text_annotations[1:]:
            text = ann.get('description', '').strip()
            if not text:
                continue

            vertices = ann.get('boundingPoly', {}).get('vertices', [])
            if len(vertices) < 4:
                continue

            xs = [v.get('x', 0) for v in vertices]
            ys = [v.get('y', 0) for v in vertices]

            words.append({
                'text': text,
                'min_x': min(xs),
                'max_x': max(xs),
                'min_y': min(ys),
                'max_y': max(ys),
                'center_x': sum(xs) / 4,
                'center_y': sum(ys) / 4,
                'height': max(ys) - min(ys),
                'width': max(xs) - min(xs),
            })

        return words

    def _cluster_into_rows(self, words: List[Dict]) -> List[Dict]:
        """
        Group words into rows based on y-coordinate proximity.
        Words with similar center_y are on the same row.
        """
        if not words:
            return []

        # Calculate tolerance based on median word height
        heights = sorted([w['height'] for w in words if w['height'] > 0])
        if heights:
            median_height = heights[len(heights) // 2]
        else:
            median_height = 20
        tolerance = median_height * 0.6

        # Sort by center_y
        sorted_words = sorted(words, key=lambda w: w['center_y'])

        rows = []
        current_row = [sorted_words[0]]
        current_y = sorted_words[0]['center_y']

        for word in sorted_words[1:]:
            if abs(word['center_y'] - current_y) <= tolerance:
                current_row.append(word)
                # Update running average y for the row
                current_y = sum(w['center_y'] for w in current_row) / len(current_row)
            else:
                current_row.sort(key=lambda w: w['min_x'])
                rows.append({
                    'words': current_row,
                    'y': current_y,
                    'text': ' '.join(w['text'] for w in current_row)
                })
                current_row = [word]
                current_y = word['center_y']

        # Last row
        if current_row:
            current_row.sort(key=lambda w: w['min_x'])
            rows.append({
                'words': current_row,
                'y': current_y,
                'text': ' '.join(w['text'] for w in current_row)
            })

        rows.sort(key=lambda r: r['y'])
        return rows

    def _find_header_row(self, rows: List[Dict]) -> Optional[int]:
        """
        Find the header row containing date numbers (1, 2, 3, ..., 31).
        The header row has many small numbers representing days of the month.
        """
        best_idx = None
        best_count = 0

        for i, row in enumerate(rows):
            day_numbers = set()
            for word in row['words']:
                try:
                    num = int(word['text'])
                    if 1 <= num <= 31:
                        day_numbers.add(num)
                except ValueError:
                    pass

            # A header row should have at least 5 consecutive day numbers
            if len(day_numbers) >= 5:
                # Check for some consecutiveness
                sorted_days = sorted(day_numbers)
                consecutive = sum(1 for a, b in zip(sorted_days, sorted_days[1:]) if b - a <= 2)
                if consecutive >= 3 and len(day_numbers) > best_count:
                    best_count = len(day_numbers)
                    best_idx = i

        if best_idx is not None:
            logger.info(f"Found header row at index {best_idx} with {best_count} date numbers")

        return best_idx

    def _get_date_column_positions(self, header_row: Dict) -> Dict[int, Dict]:
        """
        From the header row, map each day number to its x-position.
        Returns: {day_number: {'x': center_x, 'min_x': min_x, 'max_x': max_x}}
        """
        date_positions = {}
        for word in header_row['words']:
            try:
                num = int(word['text'])
                if 1 <= num <= 31:
                    date_positions[num] = {
                        'x': word['center_x'],
                        'min_x': word['min_x'],
                        'max_x': word['max_x'],
                    }
            except ValueError:
                pass
        return date_positions

    def _parse_spatial_table(self, words: List[Dict]) -> Tuple[List[ExtractedStudent], List[int]]:
        """
        Main spatial table parser. Reconstructs table from word positions.

        1. Cluster words into rows by y-coordinate
        2. Find header row with date numbers
        3. Merge student rows (name row + attendance mark rows)
        4. Determine column boundaries
        5. Extract student data from each row group
        6. Reconstruct missing serial numbers
        """
        # 1. Cluster words into rows
        rows = self._cluster_into_rows(words)
        logger.info(f"Clustered {len(words)} words into {len(rows)} rows")

        # 2. Find header row
        header_idx = self._find_header_row(rows)

        date_columns = []
        date_positions = {}
        name_col_end = None

        if header_idx is not None:
            date_positions = self._get_date_column_positions(rows[header_idx])
            date_columns = sorted(date_positions.keys())

            # Name column ends where date columns begin
            if date_positions:
                first_date_x = min(pos['min_x'] for pos in date_positions.values())
                name_col_end = first_date_x - 10

            logger.info(f"Date columns: {date_columns}, name column ends at x={name_col_end}")

        # 2b. Merge rows: If a row starts with a number (serial), it's a student row.
        # Any following rows with mostly marks should be merged into it.
        merged_rows = []
        start_idx = (header_idx + 1) if header_idx is not None else 0
        i = start_idx

        while i < len(rows):
            current_row = rows[i]
            
            # Check if this row starts with a serial number
            has_serial = False
            if current_row['words']:
                first_text = current_row['words'][0]['text'].strip()
                if re.match(r'^\d{1,3}\.?$', first_text):
                    has_serial = True
            
            if has_serial:
                # This is a student row. Merge with following rows that are mostly marks
                merged_words = list(current_row['words'])
                merged_y_min = current_row['y_min']
                merged_y_max = current_row['y_max']
                
                # Look ahead: merge next rows if they're mostly P/A/L etc
                j = i + 1
                while j < len(rows):
                    next_row = rows[j]
                    # Check if this row is mostly attendance marks
                    mark_count = sum(1 for w in next_row['words'] 
                                   if re.match(r'^[PALVXpavlx✓✗√✘→➤]+$', w['text'].strip()))
                    
                    # If >50% of words are marks, merge it
                    if len(next_row['words']) > 0 and mark_count / len(next_row['words']) > 0.5:
                        merged_words.extend(next_row['words'])
                        merged_y_max = next_row['y_max']
                        j += 1
                    else:
                        break
                
                merged_rows.append({
                    'words': merged_words,
                    'y_min': merged_y_min,
                    'y_max': merged_y_max,
                })
                i = j
            else:
                i += 1
        
        logger.info(f"After merging: {len(merged_rows)} student rows")

        # 3. Parse student rows (merged rows)
        students = []
        for merged_row in merged_rows:
            student = self._parse_student_row(merged_row, name_col_end, date_positions)
            if student:
                students.append(student)

        # 4. Reconstruct missing serial numbers
        if students:
            students = self._reconstruct_missing_serials(students)

        logger.info(f"Spatial parsing: {len(students)} students, {len(date_columns)} date columns")
        return students, date_columns

    def _parse_student_row(self, row: Dict, name_col_end: Optional[float],
                           date_positions: Dict[int, Dict]) -> Optional[ExtractedStudent]:
        """
        Parse a single row to extract serial number, name, and attendance marks.

        Uses column positions to correctly separate:
        - Serial number (leftmost number)
        - Name (text before date columns)
        - Attendance marks (aligned with date column positions)
        """
        serial = None
        name_parts = []
        attendance = {}

        # Debug: log all words in the row
        if row['words']:
            all_words = [w['text'] for w in row['words']]
            logger.debug(f"Row words: {all_words}")

        # First pass: identify the serial number (first pure number in the row)
        serial_max_x = 0
        for word in row['words']:
            text = word['text'].strip()
            if serial is None and re.match(r'^\d{1,3}\.?$', text):
                serial = text.rstrip('.')
                serial_max_x = word['max_x']
                break

        # Second pass: classify each word
        for word in row['words']:
            text = word['text'].strip()
            if not text:
                continue

            word_center_x = word['center_x']

            # Skip the serial number word itself
            if serial and text.rstrip('.') == serial and word['max_x'] <= serial_max_x + 5:
                continue

            # Check if this word aligns with a date column
            matched_day = None
            if date_positions and name_col_end and word_center_x > name_col_end:
                best_dist = float('inf')
                best_match_day = None
                for day, pos in date_positions.items():
                    dist = abs(word_center_x - pos['x'])
                    col_width = max(pos['max_x'] - pos['min_x'], 15)
                    # Increase tolerance to 3.5x column width (was 2.5x) to handle highlighted cells
                    tolerance = col_width * 3.5
                    if dist < tolerance and dist < best_dist:
                        best_dist = dist
                        best_match_day = day
                
                if best_match_day is not None:
                    matched_day = best_match_day
                    logger.debug(f"Matched mark '{text}' at x={word_center_x} to day {matched_day} (col x={date_positions[matched_day]['x']}, dist={best_dist})")
            elif name_col_end is None:
                logger.debug(f"name_col_end is None, cannot classify word '{text}' at x={word_center_x}")
            elif word_center_x < name_col_end:
                logger.debug(f"Word '{text}' at x={word_center_x} is in name column (name_col_end={name_col_end})")
            else:
                logger.debug(f"Word '{text}' at x={word_center_x} is past column but didn't match any date column (name_col_end={name_col_end})")

            if matched_day is not None:
                # This is an attendance mark
                mark = text.upper()
                
                # Skip visual decorators (arrows, bullets, etc.)
                if mark in ['➤', '→', '•', '◦', '○', '◉', '■', '□', '▪', '▫']:
                    logger.debug(f"Skipping visual decorator at day {matched_day}: '{text}'")
                    continue
                
                status = self._interpret_mark(mark)
                logger.debug(f"Detected mark at day {matched_day}: raw='{text}' (len={len(mark)}) -> status='{status}'")
                
                # Always include marks that map to a known status, or single characters
                if status != 'UNMARKED' or len(mark) <= 2:
                    attendance[str(matched_day)] = {
                        'raw': text,
                        'status': status,
                    }
                else:
                    logger.debug(f"Filtered out mark '{mark}' at day {matched_day} (status={status}, len={len(mark)})")
            elif name_col_end is None or word_center_x < name_col_end:
                # This is part of the name column
                # Filter out pure numbers (these are likely stray serial/date numbers)
                if not re.match(r'^\d+\.?$', text):
                    # Filter out isolated attendance marks
                    if len(text) > 1 or text.upper() not in ['P', 'A', 'L', 'V', 'X']:
                        name_parts.append(text)

        name = ' '.join(name_parts).strip()

        # Clean up name: remove trailing marks/numbers
        name = re.sub(r'\s+[PAXVLTpaxvlt✓✗√]+\s*$', '', name).strip()
        name = re.sub(r'\s+\d+\s*$', '', name).strip()

        # Require at least 2 chars for a valid name
        if not name or len(name) < 2:
            return None

        student = ExtractedStudent(
            roll_number=serial or '',
            name=name,
            attendance=attendance,
            confidence=0.7 if serial else 0.5,
        )
        
        # Debug log for the student's attendance data
        att_summary = {k: v['status'] for k, v in attendance.items()}
        logger.debug(f"Parsed student: serial={serial}, name='{name}', attendance_by_day={att_summary}")
        
        return student

    def _reconstruct_missing_serials(self, students: List[ExtractedStudent]) -> List[ExtractedStudent]:
        """
        Fill in missing serial numbers by looking at neighbors.

        If top neighbor has serial 10 and bottom has serial 12,
        the student in between must be serial 11.
        """
        serials = []
        for s in students:
            try:
                serials.append(int(s.roll_number) if s.roll_number else None)
            except ValueError:
                serials.append(None)

        for i in range(len(serials)):
            if serials[i] is not None:
                continue

            # Find previous known serial
            prev_serial = None
            prev_dist = 0
            for j in range(i - 1, -1, -1):
                if serials[j] is not None:
                    prev_serial = serials[j]
                    prev_dist = i - j
                    break

            # Find next known serial
            next_serial = None
            next_dist = 0
            for j in range(i + 1, len(serials)):
                if serials[j] is not None:
                    next_serial = serials[j]
                    next_dist = j - i
                    break

            # Infer the serial number
            inferred = None
            if prev_serial is not None and next_serial is not None:
                # Both neighbors known: verify they're consistent
                expected = prev_serial + prev_dist
                if expected == next_serial - next_dist:
                    inferred = expected
            elif prev_serial is not None:
                inferred = prev_serial + prev_dist
            elif next_serial is not None:
                inferred = next_serial - next_dist

            if inferred is not None and inferred >= 1:
                serials[i] = inferred
                students[i].roll_number = str(inferred)
                students[i].confidence = max(students[i].confidence - 0.1, 0.3)
                logger.info(f"Reconstructed serial {inferred} for '{students[i].name}' "
                            f"(prev={prev_serial}, next={next_serial})")

        return students

    # ==========================================================
    # FUZZY NAME MATCHING
    # ==========================================================

    def _fuzzy_match_name(self, extracted_name: str, threshold: float = None) -> Tuple[Optional[Dict], float]:
        """
        Find the best matching database student by name similarity.

        Uses SequenceMatcher for fuzzy string comparison, plus
        partial word matching for handling OCR truncation/errors.
        """
        if threshold is None:
            threshold = self.threshold_service.get('fuzzy_name_match')

        if not extracted_name or len(extracted_name) < 2:
            return None, 0.0

        extracted_lower = extracted_name.lower().strip()
        best_match = None
        best_score = 0.0

        for student in self.enrolled_students:
            db_name_lower = student['name'].lower().strip()

            # Full name similarity
            score = SequenceMatcher(None, extracted_lower, db_name_lower).ratio()

            # Substring check (OCR might read partial name)
            if extracted_lower in db_name_lower or db_name_lower in extracted_lower:
                score = max(score, 0.7)

            # Check individual word matches (first name, last name)
            extracted_parts = [p for p in extracted_lower.split() if len(p) > 1]
            db_parts = [p for p in db_name_lower.split() if len(p) > 1]

            if extracted_parts and db_parts:
                matched_parts = 0
                for ep in extracted_parts:
                    for dp in db_parts:
                        part_score = SequenceMatcher(None, ep, dp).ratio()
                        if part_score >= 0.7:
                            matched_parts += 1
                            break

                part_ratio = matched_parts / max(len(extracted_parts), len(db_parts))
                score = max(score, part_ratio * 0.85)

            if score > best_score:
                best_score = score
                best_match = student

        if best_score >= threshold:
            return best_match, best_score
        return None, 0.0

    def _match_students_to_database(self, students: List[ExtractedStudent]):
        """
        Match extracted students to database students.

        Strategy (in priority order):
        1. Fuzzy name match (primary - handles OCR errors)
        2. Roll number match (secondary - if register roll = DB roll)
        3. Serial order match (fallback - Nth serial = Nth student by roll)
        """
        used_db_ids = set()

        # Pass 1: Fuzzy name matching (most reliable for handwritten registers)
        for student in students:
            match, score = self._fuzzy_match_name(student.name)
            if match and match['id'] not in used_db_ids:
                student.matched_db_id = match['id']
                student.matched_db_name = match['name']
                student.matched_db_roll = str(match['roll_number'])
                student.match_method = 'name_fuzzy'
                student.match_score = score
                student.confidence = min(score, 0.95)
                used_db_ids.add(match['id'])
                logger.info(f"Name match: '{student.name}' -> '{match['name']}' "
                            f"(score={score:.2f})")

        # Pass 2: Roll number matching for unmatched students
        for student in students:
            if student.matched_db_id:
                continue

            if student.roll_number:
                db_student = self.roll_to_student.get(student.roll_number)
                if db_student and db_student['id'] not in used_db_ids:
                    student.matched_db_id = db_student['id']
                    student.matched_db_name = db_student['name']
                    student.matched_db_roll = str(db_student['roll_number'])
                    student.match_method = 'roll_exact'
                    student.match_score = 0.6
                    student.confidence = 0.6
                    used_db_ids.add(db_student['id'])
                    logger.info(f"Roll match: serial {student.roll_number} -> "
                                f"'{db_student['name']}'")

        # Pass 3: Serial order matching
        # If serial numbers are sequential (1,2,3,...), the Nth serial
        # corresponds to the Nth student when sorted by roll number
        sorted_db = sorted(
            self.enrolled_students,
            key=lambda s: int(s['roll_number']) if str(s['roll_number']).isdigit() else 999
        )

        for student in students:
            if student.matched_db_id:
                continue

            if student.roll_number and student.roll_number.isdigit():
                serial = int(student.roll_number)
                idx = serial - 1  # 1-indexed serial -> 0-indexed
                if 0 <= idx < len(sorted_db):
                    db_student = sorted_db[idx]
                    if db_student['id'] not in used_db_ids:
                        student.matched_db_id = db_student['id']
                        student.matched_db_name = db_student['name']
                        student.matched_db_roll = str(db_student['roll_number'])
                        student.match_method = 'serial_order'
                        student.match_score = 0.4
                        student.confidence = 0.4
                        used_db_ids.add(db_student['id'])
                        logger.info(f"Serial order match: serial {student.roll_number} -> "
                                    f"'{db_student['name']}'")

    # ==========================================================
    # LEGACY TEXT-ONLY PARSING (fallback)
    # ==========================================================

    def _parse_register_text(self, text: str) -> Tuple[List[ExtractedStudent], List[int]]:
        """
        Fallback: Parse OCR text when spatial data is unavailable.
        """
        lines = text.strip().split('\n')
        students = []
        date_columns = []

        roll_pattern = re.compile(r'^(\d{1,3})\.?\s*(.+)')
        date_header_pattern = re.compile(r'\b(\d{1,2})\b')

        for line in lines[:10]:
            dates_in_line = date_header_pattern.findall(line)
            date_nums = [int(d) for d in dates_in_line if 1 <= int(d) <= 31]
            if len(date_nums) >= 5:
                date_columns = sorted(set(date_nums))
                logger.info(f"[Fallback] Found date columns: {date_columns}")
                break

        for line in lines:
            line = line.strip()
            if not line:
                continue

            match = roll_pattern.match(line)
            if match:
                roll_num = match.group(1).lstrip('0') or '0'
                rest = match.group(2).strip()
                parts = re.split(r'\s{2,}|\t+|\|', rest)
                name = parts[0] if parts else ""
                name = re.sub(r'[PAXV✓✗√\d]+$', '', name).strip()

                attendance = {}
                marks_text = ' '.join(parts[1:]) if len(parts) > 1 else ""
                mark_pattern_re = re.compile(r'[PAXVLT✓✗√-]', re.IGNORECASE)
                marks = mark_pattern_re.findall(marks_text)

                for i, mark in enumerate(marks):
                    if i < len(date_columns):
                        day = date_columns[i]
                        status = self._interpret_mark(mark.upper())
                        attendance[str(day)] = {'raw': mark, 'status': status}

                if name:
                    students.append(ExtractedStudent(
                        roll_number=roll_num, name=name,
                        attendance=attendance, confidence=0.5
                    ))

        logger.info(f"[Fallback] Parsed {len(students)} students from text")
        return students, date_columns

    def _interpret_mark(self, mark: str) -> str:
        """Convert raw mark to status using school mappings.

        Handles compound marks like "PP" (morning+afternoon), "PA", "AA" etc.
        by checking each character individually and using majority logic.
        """
        mark = mark.upper().strip()
        if not mark:
            return 'UNMARKED'

        # Direct lookup first (handles "P", "A", "AB", etc.)
        result = self.mark_mappings.get(mark)
        if result:
            logger.debug(f"Mark '{mark}' -> status '{result}' (direct lookup)")
            return result

        # Compound mark: split into individual characters, interpret each
        # e.g. "PP" -> [PRESENT, PRESENT] -> PRESENT
        # e.g. "PA" -> [PRESENT, ABSENT] -> ABSENT (defensive: any absence counts)
        # e.g. "AA" -> [ABSENT, ABSENT] -> ABSENT
        statuses = []
        for ch in mark:
            s = self.mark_mappings.get(ch)
            if s and s != 'UNMARKED':
                statuses.append(s)

        if not statuses:
            logger.warning(f"Mark '{mark}' could not be interpreted. Mappings: {self.mark_mappings}")
            return 'UNMARKED'

        # Defensive logic: ABSENT takes priority (catch absences first)
        if 'ABSENT' in statuses:
            logger.debug(f"Mark '{mark}' -> status 'ABSENT' (compound, defensive)")
            return 'ABSENT'
        if 'LATE' in statuses:
            logger.debug(f"Mark '{mark}' -> status 'LATE' (compound)")
            return 'LATE'
        if 'PRESENT' in statuses:
            logger.debug(f"Mark '{mark}' -> status 'PRESENT' (compound)")
            return 'PRESENT'

        logger.warning(f"Mark '{mark}' has no recognized status in compound: {statuses}")
        return 'UNMARKED'

    # ==========================================================
    # PUBLIC API
    # ==========================================================

    def extract_from_image(self, image_url: str, page_number: int = 1) -> GoogleVisionResult:
        """Extract attendance data from a single image."""
        logger.info(f"[GoogleVision] Processing image: {image_url}")

        image_base64, error = self._fetch_image_as_base64(image_url)
        if error:
            return GoogleVisionResult(
                success=False, students=[], date_columns=[],
                raw_text="", confidence=0.0, error=error
            )

        response, error = self._call_vision_api(image_base64)
        if error:
            return GoogleVisionResult(
                success=False, students=[], date_columns=[],
                raw_text="", confidence=0.0, error=error
            )

        result = self._parse_vision_response(response)

        for student in result.students:
            student.page_number = page_number

        return result

    def extract_multi_page(self, image_urls: List[str]) -> GoogleVisionResult:
        """Extract attendance from multiple pages."""
        all_students = []
        all_date_columns = set()
        all_raw_text = []
        total_confidence = 0.0

        for i, url in enumerate(image_urls, 1):
            logger.info(f"[GoogleVision] Processing page {i}/{len(image_urls)}")
            result = self.extract_from_image(url, page_number=i)

            if result.success:
                all_students.extend(result.students)
                all_date_columns.update(result.date_columns)
                all_raw_text.append(f"=== Page {i} ===\n{result.raw_text}")
                total_confidence += result.confidence
            else:
                logger.warning(f"Page {i} failed: {result.error}")
                all_raw_text.append(f"=== Page {i} (FAILED) ===\n{result.error}")

        # Deduplicate by matched DB id (prefer first occurrence)
        seen_db_ids = set()
        seen_serials = set()
        unique_students = []
        for student in all_students:
            key = student.matched_db_id or f"serial_{student.roll_number}"
            if key not in seen_db_ids and student.roll_number not in seen_serials:
                seen_db_ids.add(key)
                if student.roll_number:
                    seen_serials.add(student.roll_number)
                unique_students.append(student)

        avg_confidence = total_confidence / len(image_urls) if image_urls else 0.0

        return GoogleVisionResult(
            success=len(unique_students) > 0,
            students=unique_students,
            date_columns=sorted(all_date_columns),
            raw_text='\n\n'.join(all_raw_text),
            confidence=avg_confidence,
        )

    # ==========================================================
    # OUTPUT FORMATTING
    # ==========================================================

    def to_structured_table_json(self, result: GoogleVisionResult) -> Dict:
        """Convert result to structured_table_json format for debug view."""
        return {
            'students': [
                {
                    'roll_number': s.roll_number,
                    'name': s.name,
                    'attendance': s.attendance,
                    'page_number': s.page_number,
                    'confidence': s.confidence,
                    'matched_db_name': s.matched_db_name,
                    'matched_db_roll': s.matched_db_roll,
                    'match_method': s.match_method,
                    'match_score': s.match_score,
                }
                for s in result.students
            ],
            'date_columns': {str(d): d for d in result.date_columns},
            'raw_text': result.raw_text[:5000],
            'extraction_method': 'google_vision_spatial',
            'confidence': result.confidence,
        }

    def to_ai_output_json(self, result: GoogleVisionResult) -> Dict:
        """
        Convert to ai_output_json format for the review page.

        Uses database-matched students (via fuzzy name matching) to identify:
        - matched: students detected as ABSENT (pre-selected on review page)
        - present: students detected as PRESENT
        - uncertain: students with unclear marks or not found in OCR
        - unmatched: OCR students that couldn't be matched to any DB student
        """
        matched = []       # Absent students (matched to DB)
        present = []       # Present students (matched to DB)
        unmatched = []     # OCR students not matched to DB
        uncertain = []     # Unclear marks or not found in OCR

        target_day_str = str(self.target_day)
        matched_db_ids = set()

        for student in result.students:
            day_attendance = student.attendance.get(target_day_str, {})
            status = day_attendance.get('status', 'UNMARKED')
            raw_mark = day_attendance.get('raw', '')

            if student.matched_db_id:
                matched_db_ids.add(student.matched_db_id)

                entry = {
                    'student_id': student.matched_db_id,
                    'student_name': student.matched_db_name,
                    'roll_number': student.matched_db_roll,
                    'extracted_name': student.name,
                    'extracted_serial': student.roll_number,
                    'raw_mark': raw_mark,
                    'status': status,
                    'confidence': student.confidence,
                    'match_method': student.match_method,
                    'match_score': round(student.match_score, 2),
                    'page': student.page_number,
                }

                if status == 'ABSENT':
                    matched.append(entry)
                elif status in ('PRESENT', 'LATE'):
                    present.append(entry)
                else:
                    uncertain.append({
                        **entry,
                        'reason': 'No clear mark for target date',
                    })
            else:
                unmatched.append({
                    'roll_number': student.roll_number,
                    'extracted_name': student.name,
                    'raw_mark': raw_mark,
                    'status': status,
                    'reason': 'Could not match to any enrolled student',
                    'page': student.page_number,
                })

        # Note: Enrolled students not found in OCR are handled by the frontend
        # (it has allStudents and shows them as unmatched in the unified table)

        return {
            'matched': matched,
            'present': present,
            'unmatched': unmatched,
            'uncertain': uncertain,
            'matched_count': len(matched),
            'present_count': len(present),
            'unmatched_count': len(unmatched),
            'confidence': result.confidence,
            'target_date': self.target_date.isoformat(),
            'target_day': self.target_day,
            'date_columns_found': result.date_columns,
            'extraction_method': 'google_vision_spatial',
            'notes': f"Google Vision extracted {len(result.students)} students "
                     f"(spatial + fuzzy name matching). "
                     f"Day {self.target_day}: {len(present)} present, "
                     f"{len(matched)} absent, {len(uncertain)} uncertain.",
            'pipeline_stages': {
                'google_vision': {
                    'status': 'completed' if result.success else 'failed',
                    'students_found': len(result.students),
                    'db_matched': len(matched_db_ids),
                    'present_count': len(present),
                    'absent_count': len(matched),
                    'uncertain_count': len(uncertain),
                    'date_columns': result.date_columns,
                    'error': result.error,
                }
            },
        }
