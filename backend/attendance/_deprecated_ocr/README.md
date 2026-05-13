# Deprecated: Attendance Register OCR Pipeline

Parked on: 2026-05-13
Reason: Feature not used in production. Learning loop did not improve accuracy as intended.
        Replaced by manual attendance entry as primary workflow.

## Files
- `google_vision_extractor.py` — Google Cloud Vision API extractor + fuzzy name matching
- `ocr_service.py` — Legacy Tesseract OCR service
- `table_extractor.py` — TableExtractor class that builds structured grids from OCR output
- `llm_reasoner.py` — Groq LLM reasoning layer that interprets mark ambiguity
- `vision_extractor.py` — Groq Vision unified extractor (alternative to Google Vision)
- `attendance_processor.py` — Orchestrator: runs the full pipeline (OCR → Table → LLM → Matching)

## How to Re-enable
1. Move all files back to `backend/attendance/`
2. Set `OCR_ENABLED=true` in environment / `.env`
3. Re-register `process_attendance_upload` Celery task in `attendance/tasks.py`
4. Restore `AttendanceUploadViewSet.create()` in `attendance/views.py` (remove 410 response)
5. Restore `_process_upload_sync()` to use `AttendanceProcessor` (currently stubbed)
6. Ensure `GOOGLE_VISION_API_KEY` and `GROQ_API_KEY` are set in environment

## Known Issues (why it was parked)
- Learning loop only adjusted confidence thresholds, not the underlying models
- Google Vision + Groq pipeline fragile on non-standard register layouts
- `register_config` per school needed precise calibration per register format
- Auto-tune required 50+ uploads before providing useful signal
