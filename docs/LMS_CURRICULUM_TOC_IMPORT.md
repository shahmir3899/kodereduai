# LMS Curriculum: Table of Contents (TOC) Import Workflow

**Framework**: React 18.3 + Django REST 3.16  
**AI Engine**: Groq LLM (llama-3.3-70b-versatile) + Google Cloud Vision OCR  
**Build Status**: Frontend ✅ 9.01s + Backend ✅ 3/3 tests  
**Phases**: Phase 1 (AI Suggest), Phase 2 (OCR Mapping), Phase 3 (Undo/Redo & Editing)

---

## Overview

The TOC Import workflow enables schools to quickly build curriculum structures by uploading textbook table-of-contents images or pasting text. The AI-powered system extracts pages, suggests chapter/topic hierarchies, and provides interactive line-level editing with undo/redo support.

**3-Step Flow**:
1. **Capture** — Upload TOC image or paste extracted text
2. **Process** — Parse structure, get AI suggestions
3. **Confirm** — Review, edit with live line mapping, apply to book

---

## Phase 1: Staged AI Suggestions

**Release**: Initial  
**Goal**: Reduce manual TOC entry from hours to minutes  
**UI**: CurriculumPage.jsx TOC Modal, step="suggest"

### Features

- **AI Suggestion Engine**:
  - Groq LLM (llama-3.3-70b-versatile) with Confidence ≥ 0.0–1.0
  - Fallback to rule-based parser if API fails:
    - Detects hierarchy by indentation (2–4 spaces = nested levels)
    - Splits on numbering (I. A. 1. a. etc.)
  - Returns: `{suggestions: [{text, type ('chapter'|'topic'), confidence, reason}]}`

- **Backend Endpoints**:
  - `POST /api/lms/books/{id}/parse_toc/` — Parse + preview structure
  - `POST /api/lms/books/{id}/suggest_toc/` — AI suggestions with confidence scores
  - `POST /api/lms/books/{id}/apply_toc/` — Apply final structure (create chapters/topics)

- **Frontend State**:
  - `tocSuggestionItems: [{id, text, type, confidence, status: 'pending'|'used'|'ignored'}]`
  - `tocSuggestionMeta: {total_suggestions, high_confidence_count}`

- **User Controls**:
  - **Use** — Apply single suggestion (moves to "used" state, adds to tocChapters)
  - **Ignore** — Skip suggestion (moves to "ignored" state, hidden from view)
  - **Use High-Confidence** — Bulk-apply all suggestions with confidence ≥ 0.8
  - **AI Suggest** button — Re-run LLM on current tocText

### Workflow

```
1. Upload image or paste text
2. Extract/OCR text
3. Click "AI Suggest"
4. Backend runs `suggest_toc()` → returns suggestions with confidence
5. Frontend renders per-item Use/Ignore buttons
6. User bulk-applies high-confidence or cherry-picks
7. Applied suggestions populate tocChapters structure
```

### Example Response

```json
{
  "suggestions": [
    {
      "id": "sugg-1",
      "text": "Chapter 1: Photosynthesis",
      "type": "chapter",
      "confidence": 0.95,
      "reason": "All-caps heading + numbered"
    },
    {
      "id": "sugg-2",
      "text": "1.1 Light Reactions",
      "type": "topic",
      "confidence": 0.87,
      "reason": "Double indent + decimal pattern"
    }
  ],
  "total_suggestions": 24,
  "high_confidence_count": 18
}
```

---

## Phase 2: OCR Line-Level Mapping

**Release**: Phase 2  
**Goal**: Enable users to map individual extracted lines directly to chapters/topics  
**UI**: CurriculumPage.jsx TOC Modal, "OCR Lines" panel with clickable line list

### Features

- **Enhanced OCR Response**:
  - Backend now returns structured line metadata alongside text
  - `POST /api/lms/books/{id}/ocr_toc/` response:
    ```json
    {
      "text": "Chapter 1: Introduction\n1.1 Overview\n...",
      "lines": [
        {"id": "line-1", "line_number": 1, "text": "Chapter 1: Introduction", "confidence": 0.96, "mappedAs": null},
        {"id": "line-2", "line_number": 2, "text": "1.1 Overview", "confidence": 0.89, "mappedAs": null}
      ],
      "language": "en"
    }
    ```

- **Frontend State**:
  - `tocOcrLines: [{id, line_number, text, confidence, mappedAs}]`
  - `selectedOcrLineId: string` — Currently highlighted line
  - `targetChapterIndex: number` — Destination chapter for topic mapping

- **User Interactions**:
  - **Click line** — Highlight and select
  - **"Use Selected as Chapter"** — Adds selected line text as new chapter
  - **Chapter dropdown + "Use Selected as Topic"** — Maps selected line as topic to user-chosen chapter
  - **Visual feedback** — Selected line shows blue highlight, mapped lines show "Mapped: Chapter/Topic" green badge

### Keyboard Shortcuts (Phase 2+)

| Key | Action |
|-----|--------|
| C | Map selected line as Chapter |
| T | Map selected line as Topic |
| ↑ | Select previous line |
| ↓ | Select next line |
| Esc | Clear selection |

---

## Phase 3: Undo/Redo & Line Editing

**Release**: Phase 3  
**Goal**: Enable fast line-level text cleanup and mapping refinement  
**UI**: OCR Lines panel with inline edit mode, undo/redo buttons, merge button

### Features

- **Undo/Redo Stack**:
  - Separate stacks for OCR lines and chapters
  - Tracks full state snapshots (not diffs)
  - Max depth: unlimited (grows linearly)
  - Clears redo stack on any new edit

- **Text Normalization**:
  - Built-in `normalizeText(text)` function:
    - Trim whitespace from start/end
    - Collapse multiple spaces → single space
    - Remove most punctuation (except . , : ; - /)
    - Preserve unicode for Urdu (ع–ی), Arabic (ا–ي), Hindi (अ–ह)
  - Applied automatically on line save

- **Frontend State**:
  - `editingLineId: string | null` — Currently editing line ID
  - `editingLineText: string` — Raw input text
  - `undoStackLines: [ ]` — OCR line state snapshots
  - `redoStackLines: [ ]` — Redo snapshots
  - `undoStackChapters: [ ]` — Chapter state snapshots
  - `redoStackChapters: [ ]` — Redo snapshots

- **User Controls**:
  - **↶ Undo / ↷ Redo buttons** — Top-right of OCR Lines panel, disabled when stack empty
  - **E key or "✎ Edit" button** — Enter inline edit mode on selected line
  - **"⤵ Merge" button** — Combine selected line with next (only if not last line)
  - **Save (Enter) / Cancel (Esc)** — Commit or discard edits

### Extended Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Ctrl+Z | Undo OCR/chapter changes |
| Ctrl+Y | Redo (Ctrl+Shift+Z also works) |
| C | Map as Chapter (if not editing) |
| T | Map as Topic (if not editing) |
| E | Enter edit mode on selected line |
| ↑ | Previous line (if not editing) |
| ↓ | Next line (if not editing) |
| Esc | Clear selection or exit edit mode |

### Edit Mode Workflow

```
1. Select line by clicking or arrow keys
2. Press E or click "✎ Edit"
3. Inline input field appears with current text
4. User edits text (supports unicode)
5. Press Enter to save (auto-normalizes)
   OR Press Esc to cancel
6. Updated line appears in list with new text
7. Line state tracked in undo stack
```

### Merge Workflow

```
1. Select line (not last line)
2. Click "⤵ Merge" or press M
3. Current line + next line → merged with normalized text
4. Undo stack records this state
5. Can undo via Ctrl+Z
```

---

## Complete TOC Modal State Machine

```
STEP: input
├─ tocMode: 'paste' | 'upload' | (edit chapter/topic tree)
├─ tocText: extracted/pasted text
├─ ocrLoading: boolean
└─ Actions: Extract (via API), AI Suggest (next), paste input

    ↓

STEP: process
├─ tocSuggestionItems: [{text, type, confidence, status}]
├─ AI Suggest panel: Use/Ignore per item, bulk Use High-Conf
├─ tocChapters: gradually populated from suggestions
└─ Actions: Use/Ignore suggestions, AI Suggest again, Next

    ↓

STEP: review
├─ tocChapters: semi-final structure
├─ tocOcrLines: phase 2+ only; clickable line list
├─ selectedOcrLineId: currently highlighted line via click/arrows
├─ editingLineId: phase 3+; edit mode (inline input)
├─ undoStackLines/Chapters: phase 3+; undo/redo history
├─ targetChapterIndex: destination for topic mapping
├─ Actions:
│  ├─ Click line → select
│  ├─ Use/Merge lines → update tocChapters
│  ├─ Edit line → inline text edit + normalize + save
│  ├─ Undo/Redo → restore from stacks
│  ├─ Manual chapter/topic add/remove
│  └─ Apply → POST to apply_toc endpoint

    ↓

APPLY
├─ POST /api/lms/books/{id}/apply_toc/ with final tocChapters
├─ Returns: {created_chapters, updated_chapters, created_topics, status}
└─ Modal closes, book tree refreshes
```

---

## Backend Implementation

### Key Files

- **backend/lms/toc_ocr.py**
  - `extract_toc_payload(image_bytes, language)` → `{text, lines, error}` (Phase 2)
  - `_build_lines_from_text(full_text, confidence)` → structured line items
  - Supports: Google Cloud Vision API + Service Account auth

- **backend/lms/toc_parser.py**
  - `parse_toc_text(text, book)` → preview structure validation
  - `parse_toc_preview(text)` → lightweight parse without DB commit
  - Handles indentation-based hierarchy detection

- **backend/lms/toc_ai_suggester.py**
  - `suggest_toc_structure(raw_text, language)` → Groq LLM suggestions
  - `_call_groq_llm(prompt, language)` → LLM integration
  - Fallback to rule-based parser (handles Urdu/Arabic via unicode)

- **backend/lms/views.py** — BookViewSet actions
  - `parse_toc()` — POST /books/{id}/parse_toc/
  - `suggest_toc()` — POST /books/{id}/suggest_toc/
  - `apply_toc()` — POST /books/{id}/apply_toc/
  - `ocr_toc()` — POST /books/{id}/ocr_toc/ (Phase 2+ returns lines)

### API Response Flow

```
POST /api/lms/books/{id}/ocr_toc/
├─ Input: FormData { image }
├─ Google Vision OCR
├─ extract_toc_payload() → {text, lines}
└─ Response: {text, lines: [{id, line_number, text, confidence, mappedAs: null}], language}

POST /api/lms/books/{id}/suggest_toc/
├─ Input: {raw_text}
├─ Groq LLM or fallback parser
├─ suggest_toc_structure() → confidence scores
└─ Response: {suggestions: [{text, type, confidence, reason}]}

POST /api/lms/books/{id}/apply_toc/
├─ Input: {chapters: [{title, topics: [{title}]}]}
├─ apply_toc_structure() — creates/updates DB entries
└─ Response: {created_chapters, updated_chapters, status}
```

---

## Frontend Implementation

### Key Components & Hooks

- **CurriculumPage.jsx** — Main page component
  - State: Books, subjects, selected book, chapters/topics, TOC modals
  - Phase 1: `tocSuggestionItems`, bulk suggestions
  - Phase 2: `tocOcrLines`, `selectedOcrLineId`, line mapping
  - Phase 3: `editingLineId`, undo/redo stacks, `normalizeText()`

- **TOC Modal** — Multi-step workflow
  - Step "input": File/text upload
  - Step "process": Suggestions + staging
  - Step "review": Final review + line editing + undo/redo
  - Step "confirm": Apply dialog

- **Helper Functions**:
  - `parseOcrLinesFromText(text)` — Fallback line parser
  - `handleMapSelectedLineAsChapter()` — Add chapter
  - `handleMapSelectedLineAsTopic()` — Add topic to chapter
  - `startEditingLine()`, `saveLine()` — Edit workflow
  - `mergeWithNext()` — Line merge
  - `handleUndo()`, `handleRedo()` — Stack traversal

### Keyboard Shortcut Handler

```javascript
useEffect(() => {
  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') handleUndo()
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') handleRedo()
    if (key === 'c' && !editingLineId) handleMapSelectedLineAsChapter()
    if (key === 't' && !editingLineId) handleMapSelectedLineAsTopic()
    if (key === 'e' && !editingLineId) startEditingLine()
    if (e.key === 'ArrowUp') selectPreviousLine()
    if (e.key === 'ArrowDown') selectNextLine()
    if (e.key === 'Escape') clearSelection() || exitEditMode()
  }
  window.addEventListener('keydown', handleKeyDown, true)
}, [showTocModal, tocOcrLines, selectedOcrLineId, editingLineId])
```

---

## Testing

### Backend Tests

- **test_phase16_lms_curriculum.py**:
  - `test_parse_toc_preview_endpoint` ✅ Preview parsing without commit
  - `test_apply_toc_endpoint` ✅ Apply final structure to book
  - `test_suggest_toc_endpoint_fallback` ✅ LLM fallback to rule-based

### Manual Testing Checklist

- [ ] Phase 1: Upload image → OCR extracts text → AI suggests chapters/topics → Apply
- [ ] Phase 2: Selected OCR line highlights blue → Map as chapter → Green badge → Undo works
- [ ] Phase 3: E-key enters edit mode → Type → Esc/Enter to save/cancel → Ctrl+Z undoes
- [ ] Merge: Select non-last line → Merge button → Combines with next → Undo restores
- [ ] Keyboard: All shortcuts (C, T, E, arrows, Ctrl+Z/Y) work without modal focus issues
- [ ] RTL: Urdu/Arabic text displays RTL, keyboard shortcuts still work
- [ ] Unicode: Normalized text preserves Urdu (ع–ی), Arabic (ا–ي), Hindi (अ–ह)

---

## Performance

| Metric | Value |
|--------|-------|
| Frontend Build | 9.01s (1708 modules) |
| OCR Extract (image → text) | ~2–5s (Google Vision API) |
| AI Suggest (text → suggestions) | ~3–8s (Groq LLM or fallback) |
| Apply TOC (chapters → DB) | ~1–2s (bulk create) |
| Edit/Undo/Redo | <100ms (state operations) |
| Max suggestions per TOC | ~50 (configurable) |
| Max lines per OCR | ~100 (configurable) |

---

## Backward Compatibility

✅ Phase 1–3 all additive — no breaking changes  
✅ Phase 2 OCR endpoint still supports Phase 1 fallback (renders text if backend returns plain text)  
✅ Undo/Redo optional — user can ignore and use manual edits  
✅ Existing `bulk_toc/` endpoint unchanged  

---

## Known Limitations & Future Enhancements

### Current Limitations

- Undo/redo stacks stored in React state (cleared on page reload)
- No multi-selection for bulk line editing
- OCR confidence scores depend on image quality (poor scans may have low conf)
- AI suggestions depend on LLM availability (fallback less accurate for complex hierarchies)

### Future Enhancements

- Phase 4: Confidence score visualization + low-conf line filtering
- Phase 5: Bulk-select lines (Shift+Click) + batch operations
- Phase 6: Undo/redo persistence (IndexedDB)
- Phase 7: Multi-language LLM prompts for non-English TOCs
- Phase 8: Conflict detection (duplicate chapters) + auto-merge suggestions

---

## Language Support

| Language | Support | Notes |
|----------|---------|-------|
| English | ✅ Full | LLM suggestions, parsing, OCR |
| Urdu | ✅ Full | Unicode preservation (ع–ی), RTL direction |
| Arabic | ✅ Full | Unicode preservation (ا–ي), RTL direction |
| Sindhi | ✅ Full | Character preservation |
| Pashto | ✅ Full | Character preservation |
| Others | ⚠️ Partial | OCR works, LLM suggestions limited |

---

## References

- [API Endpoints](API_ENDPOINTS.md#lms)
- [Frontend Pages](FRONTEND_PAGES.md#academics)
- [LMS Backend App](BACKEND_APPS.md#lms)
- [Attendance Pipeline](ATTENDANCE_PIPELINE.md) — Similar OCR + AI workflow
