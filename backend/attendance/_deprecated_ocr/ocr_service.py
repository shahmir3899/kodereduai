"""
OCR Service using Tesseract for extracting text from attendance register images.
"""

import logging
import requests
from io import BytesIO
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass
from PIL import Image
import pytesseract
from django.conf import settings

logger = logging.getLogger(__name__)


@dataclass
class OCRCell:
    """Represents a single cell extracted from the register."""
    text: str
    confidence: float
    bbox: Tuple[int, int, int, int]  # (x, y, width, height)
    row: int
    col: int


@dataclass
class OCRResult:
    """Complete OCR result from a register image."""
    cells: List[OCRCell]
    raw_text: str
    image_width: int
    image_height: int
    avg_confidence: float
    success: bool
    error: Optional[str] = None


class OCRService:
    """
    Service for extracting text from attendance register images using Tesseract.

    Pipeline step 1: Image → OCR
    Outputs structured text data with confidence scores per cell.
    """

    def __init__(self):
        """Initialize OCR service with Tesseract configuration."""
        tesseract_cmd = getattr(settings, 'TESSERACT_CMD', None)
        if tesseract_cmd:
            pytesseract.pytesseract.tesseract_cmd = tesseract_cmd

        self.config = getattr(settings, 'ATTENDANCE_AI_SETTINGS', {})
        self.min_confidence = self.config.get('OCR_CONFIDENCE_THRESHOLD', 0.6)

    def fetch_image(self, image_url: str) -> Tuple[Optional[Image.Image], Optional[str]]:
        """
        Fetch image from URL and return as PIL Image.

        Args:
            image_url: URL of the image to fetch

        Returns:
            tuple: (PIL Image, error_message)
        """
        try:
            logger.info(f"Fetching image from: {image_url}")
            response = requests.get(image_url, timeout=30)
            response.raise_for_status()

            image = Image.open(BytesIO(response.content))

            # Convert to RGB if needed (handles RGBA, palette images)
            if image.mode != 'RGB':
                image = image.convert('RGB')

            logger.info(f"Image fetched: {image.width}x{image.height}")
            return image, None

        except requests.RequestException as e:
            logger.error(f"Failed to fetch image: {e}")
            return None, f"Could not fetch image: {str(e)}"
        except Exception as e:
            logger.error(f"Failed to process image: {e}")
            return None, f"Image processing error: {str(e)}"

    def preprocess_image(self, image: Image.Image) -> Image.Image:
        """
        Preprocess image for better OCR accuracy.

        Args:
            image: PIL Image

        Returns:
            Preprocessed PIL Image
        """
        import cv2
        import numpy as np

        # Convert PIL to OpenCV format
        img_array = np.array(image)

        # Convert to grayscale
        if len(img_array.shape) == 3:
            gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)
        else:
            gray = img_array

        # Apply adaptive thresholding for better text extraction
        binary = cv2.adaptiveThreshold(
            gray, 255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            11, 2
        )

        # Denoise
        denoised = cv2.fastNlMeansDenoising(binary, None, 10, 7, 21)

        # Convert back to PIL
        return Image.fromarray(denoised)

    def extract_text_with_boxes(self, image: Image.Image) -> Dict[str, Any]:
        """
        Extract text with bounding boxes using Tesseract.

        Args:
            image: PIL Image (preprocessed)

        Returns:
            dict: Tesseract output with word-level bounding boxes
        """
        # Use Tesseract with detailed output
        data = pytesseract.image_to_data(
            image,
            output_type=pytesseract.Output.DICT,
            config='--psm 6'  # Assume uniform block of text
        )
        return data

    def extract_raw_text(self, image: Image.Image) -> str:
        """
        Extract plain text from image.

        Args:
            image: PIL Image

        Returns:
            str: Extracted text
        """
        return pytesseract.image_to_string(image, config='--psm 6')

    def process_image(self, image_url: str) -> OCRResult:
        """
        Run full OCR pipeline on an image.

        Args:
            image_url: URL of the attendance register image

        Returns:
            OCRResult with extracted cells and confidence scores
        """
        # Step 1: Fetch image
        image, error = self.fetch_image(image_url)
        if error:
            return OCRResult(
                cells=[],
                raw_text="",
                image_width=0,
                image_height=0,
                avg_confidence=0.0,
                success=False,
                error=error
            )

        original_width, original_height = image.width, image.height

        # Step 2: Preprocess
        try:
            preprocessed = self.preprocess_image(image)
        except Exception as e:
            logger.warning(f"Preprocessing failed, using original: {e}")
            preprocessed = image

        # Step 3: Extract text with bounding boxes
        try:
            ocr_data = self.extract_text_with_boxes(preprocessed)
            raw_text = self.extract_raw_text(preprocessed)
        except Exception as e:
            logger.error(f"OCR extraction failed: {e}")
            return OCRResult(
                cells=[],
                raw_text="",
                image_width=original_width,
                image_height=original_height,
                avg_confidence=0.0,
                success=False,
                error=f"OCR failed: {str(e)}"
            )

        # Step 4: Build cell list
        cells = []
        confidences = []

        n_boxes = len(ocr_data['text'])
        for i in range(n_boxes):
            text = ocr_data['text'][i].strip()
            conf = float(ocr_data['conf'][i])

            # Skip empty or low-confidence results
            if not text or conf < 0:
                continue

            # Normalize confidence to 0-1
            conf_normalized = conf / 100.0

            cell = OCRCell(
                text=text,
                confidence=conf_normalized,
                bbox=(
                    ocr_data['left'][i],
                    ocr_data['top'][i],
                    ocr_data['width'][i],
                    ocr_data['height'][i]
                ),
                row=ocr_data['block_num'][i],  # Approximate row
                col=ocr_data['word_num'][i]    # Approximate column
            )
            cells.append(cell)
            confidences.append(conf_normalized)

        avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0

        logger.info(f"OCR extracted {len(cells)} cells, avg confidence: {avg_confidence:.2f}")

        return OCRResult(
            cells=cells,
            raw_text=raw_text,
            image_width=original_width,
            image_height=original_height,
            avg_confidence=avg_confidence,
            success=True
        )

    def get_cells_as_grid(self, ocr_result: OCRResult, tolerance: int = 20) -> List[List[OCRCell]]:
        """
        Organize OCR cells into a 2D grid based on their positions.

        Args:
            ocr_result: OCRResult from process_image
            tolerance: Pixel tolerance for grouping cells into rows

        Returns:
            2D list of cells organized by row and column
        """
        if not ocr_result.cells:
            return []

        # Group cells by y-position (rows)
        cells = sorted(ocr_result.cells, key=lambda c: c.bbox[1])

        rows = []
        current_row = [cells[0]]
        current_y = cells[0].bbox[1]

        for cell in cells[1:]:
            if abs(cell.bbox[1] - current_y) <= tolerance:
                current_row.append(cell)
            else:
                # Sort current row by x-position
                current_row.sort(key=lambda c: c.bbox[0])
                rows.append(current_row)
                current_row = [cell]
                current_y = cell.bbox[1]

        # Don't forget last row
        if current_row:
            current_row.sort(key=lambda c: c.bbox[0])
            rows.append(current_row)

        return rows
