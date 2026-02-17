# Attendance AI Pipeline

## Overview
The system processes photos of handwritten attendance registers to automatically mark student attendance. It uses OCR (Google Cloud Vision or Groq Vision) to extract text, a table extraction algorithm to structure the data, and an LLM (Groq llama-3.3-70b) to reason about matching students to attendance marks.

## Pipeline Steps

### Step 1: Image Upload
- Frontend: CaptureReviewPage.jsx uploads image via `POST /api/attendance/upload-image/`
- Backend: ImageUploadView receives the file
- File stored in Supabase Storage at: `attendance/{school_id}/{class_id}/{timestamp}_{uuid}.ext`
- Returns public URL
- SupabaseStorageService (core/storage.py) handles upload with 120s httpx timeout

### Step 2: Upload Creation
- Frontend calls `POST /api/attendance/uploads/` with `{class_obj, date, image_url, academic_year}`
- Backend creates AttendanceUpload with `status=PROCESSING`
- Triggers Celery task `process_attendance_upload` (or synchronous if Celery unavailable)

### Step 3: Vision/OCR Processing

**Option A: Google Cloud Vision (Recommended)**
- Class: `GoogleVisionExtractor` (attendance/services.py)
- Uses DOCUMENT_TEXT_DETECTION API (specialized for handwriting)
- Config: `GOOGLE_VISION_API_KEY` or `GOOGLE_APPLICATION_CREDENTIALS`
- Returns: raw text + word-level bounding boxes with confidence scores

**Option B: Groq Vision AI**
- Class: `VisionExtractor`
- Model: `llama-3.2-11b-vision-preview` (configurable via `GROQ_VISION_MODEL`)
- Config: `GROQ_API_KEY`
- Sends image with structured prompt to extract attendance data

**Option C: Tesseract OCR (Legacy)**
- Class: `OCRService`
- Preprocessing: OpenCV adaptive thresholding + denoising
- Config: `TESSERACT_CMD` (path to tesseract.exe)
- Used when `USE_VISION_PIPELINE=False`

### Step 4: Table Extraction
- Class: `TableExtractor` (attendance/services.py)
- Takes raw OCR output (text + bounding boxes)
- Organizes into grid structure: rows = students, columns = dates
- Uses spatial analysis of bounding box positions
- Outputs: `structured_table_json` with row/column data and confidence scores
- Handles both orientations based on school's `register_config`

### Step 5: LLM Reasoning
- Class: `LLMReasoner` (attendance/services.py)
- Model: Groq `llama-3.3-70b-versatile` (configurable via `GROQ_MODEL`)
- Input: structured table data + class student roster
- Tasks:
  1. Match extracted names/roll numbers to known students
  2. Interpret attendance marks using school's `mark_mappings`
  3. Handle ambiguous cases (smudged marks, alternate spellings)
  4. Apply fuzzy matching for names (FuzzyWuzzy, threshold=70)
- Output: `matched_students` list and `unmatched_entries` list

### Step 6: Review & Confirmation
- Upload status set to `REVIEW_REQUIRED`
- Frontend shows matched students with status indicators
- Admin can: confirm all, edit individual matches, reassign unmatched entries
- `POST /api/attendance/uploads/{id}/confirm/` creates AttendanceRecords
- Only SCHOOL_ADMIN/PRINCIPAL can confirm (`CanConfirmAttendance` permission)

### Step 7: Learning Loop (Feedback)
- When admin corrects AI matches, `AttendanceFeedback` records are created
- CorrectionTypes: false_positive, false_negative, roll_mismatch, mark_misread, name_mismatch
- `LearningService` calculates accuracy stats (precision, recall) per school
- Tracks common OCR errors and suggests mark mapping improvements
- `GET /api/attendance/records/accuracy_stats/`
- `GET /api/attendance/records/mapping_suggestions/`

## Mark Mappings (per school, configurable)
```json
{
  "PRESENT": ["P", "p", "✓", "✔", "/", "1"],
  "ABSENT": ["A", "a", "✗", "✘", "X", "x", "0", "-"],
  "LATE": ["L", "l"],
  "LEAVE": ["Le", "LE", "le"],
  "default": "ABSENT"
}
```
Stored in `School.mark_mappings`. Editable via `/api/schools/mark_mappings/`.

## Register Configuration (per school)
```json
{
  "orientation": "rows_are_students",
  "data_start_col": 2,
  "data_start_row": 1,
  "date_header_row": 0,
  "roll_number_col": 1,
  "student_name_col": 0
}
```

## Image Quality Requirements
- MIN_IMAGE_WIDTH: 300px
- MIN_IMAGE_HEIGHT: 300px
- OCR_CONFIDENCE_THRESHOLD: 0.7
- Supported formats: JPEG, PNG

## Error Handling
- Celery not running: status=FAILED, error="Celery worker was not running during upload"
- OCR fails: status=FAILED, error_message populated
- Reprocessing: `POST /api/attendance/uploads/{id}/reprocess/` re-triggers pipeline
- Image test: `GET /api/attendance/uploads/{id}/test_image/` verifies URL accessibility

## Frontend Flow
1. Navigate to /attendance
2. Select class and date
3. Upload photo (drag & drop or camera)
4. Image compressed via compressorjs, uploaded to Supabase
5. Upload created → processing begins
6. Status polling until REVIEW_REQUIRED
7. Review screen shows matched/unmatched students
8. Admin reviews, edits, confirms
9. Attendance records created

## Settings Reference
| Setting | Default | Purpose |
|---------|---------|---------|
| USE_VISION_PIPELINE | True | Use AI vision vs legacy Tesseract |
| VISION_PROVIDER | google | google, groq, or tesseract |
| GROQ_API_KEY | - | Groq API key for LLM reasoning |
| GROQ_MODEL | llama-3.3-70b-versatile | LLM model for reasoning |
| GROQ_VISION_MODEL | llama-3.2-11b-vision-preview | Vision model (if provider=groq) |
| GOOGLE_VISION_API_KEY | - | Google Cloud Vision API key |
| OCR_CONFIDENCE_THRESHOLD | 0.7 | Minimum OCR confidence |
| FUZZY_MATCH_THRESHOLD | 70 | FuzzyWuzzy name matching threshold |
| MIN_IMAGE_WIDTH | 300 | Minimum image width in pixels |
| MIN_IMAGE_HEIGHT | 300 | Minimum image height in pixels |
