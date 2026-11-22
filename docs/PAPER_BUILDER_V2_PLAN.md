# Paper Builder v2: scan to paper, Play Group to Grade 12

Status (2026-11-17): Phases 1 to 7 (with 6b) and the answer key (7b) are built, all uncommitted. Next: the user's phone
test, then commit and deploy (server and the new APK together).

## Goal
A teacher photographs a paper (or starts empty), sees the finished paper, fixes what is wrong, and prints.
The target look is the two Play Group papers (Math, English) the user supplied, originally made with Gemini.

## User decisions (2026-11-15)
- Covers Play Group to Grade 12, in one builder. The current wizard is merged into it, not kept beside it.
- Pictures: a library, a Browse button for the school's own uploads, and "smart creation" done by our own
  code (repeat a picture N times, big/small, long/short, shapes, number clouds, letter train). No paid image service.
- The scan keeps using an AI service, as today.
- Urdu papers are required. The user will supply an Urdu sample before Phase 5.
- Word export is required. The paper in the app is the master copy; edits made later in Word do not come back.
- No Word editor inside the app. Text is edited inside blocks with the existing rich editor.

## Design
A paper is an ordered list of **blocks**. One block is one question with its own layout.
The scan, the editor, the PDF and the Word file all read and write this same list.

1. **Block library (server).** One registry defines every block type and its fields
   (`backend/examinations/paper_blocks/registry.py`). Web and mobile read it; nothing is hand-copied.
   - Activity blocks: writing grid, handwriting lines, missing sequence (cloud / train / box), count and write,
     compare objects, find and colour, match columns, letter grid, picture choice, colour picture, oral.
   - Text blocks (Phase 3): MCQ, short, long, essay, true/false, fill in the blank, matching.
2. **Scenes.** Every activity block is laid out once as a scene (rectangles, circles, lines, text, pictures).
   The same scene is written as SVG for the HTML page and drawn as a PNG for Word, so both outputs match.
3. **Two exports from one block list.**
   - HTML page: preview, and PDF by printing on the device (browser on web, `expo-print` on the phone).
     The browser does Urdu shaping and right-to-left.
   - Word: headings, marks and tables are real Word text; each activity drawing is one picture.
4. **Pictures.** A library folder of line art (SVG plus a PNG copy), school uploads, and smart creation in the
   scene builders. A picture that is not found prints as an empty dashed box with its name.
5. **Scan (Phase 4).** The photo and the Google Vision text go to a vision model that returns blocks.
   Pictures it cannot match stay as a crop of the photo.
6. **Editor (Phase 3).** Short setup, then one preview screen. Tap a block to edit it.

## What stays safe
- Each block is still saved as a question in the question bank, so reuse, marks entry and the answer key keep working.
- Old papers open through a converter; they are not rewritten.
- Database: new fields only (block list on the paper, a picture table). Nothing is dropped or altered.
  Every migration is shown to the user before it runs anywhere.

## Phases
| Phase | What is built | How it is checked | Status |
|---|---|---|---|
| 1 | Block registry, scenes, HTML/PDF and Word export, header | The two target papers rebuilt from hand-written block data, compared with the Gemini PDFs | Built 2026-11-15 |
| 2 | Picture library (525), smart creation, Browse upload | Swap and create pictures in those two papers | Built 2026-11-15 |
| 3 | Web editor merged with the wizard, text blocks, converter for old papers | Build a paper from empty and from the bank | Built 2026-11-15 (3a server, 3b web) |
| 4 | Scan to blocks | Photograph real papers; count the fixes needed | **Next** |
| 5 | Urdu | The user's Urdu sample, rebuilt and scanned | Built 2026-11-16 (sample + real scan still waiting for the user's file) |
| 6 | Mobile | Same flow on the phone | Built 2026-11-17 (browser-checked; phone test is the user's) |
| 6b | Worksheets move to the block editor (user decision 2026-11-15) | A worksheet built and printed in the new editor | Built 2026-11-17 (browser-checked; phone test is the user's) |
| 7 | Remove the old export and review screens | Old papers still open and print | Built 2026-11-17 (browser-checked on scratch; phone test is the user's) |

## Phase 1 scope
- No database change and no API endpoint. The package is plain Python, with no Django imports.
- `backend/examinations/paper_blocks/`: `registry.py`, `scene.py`, `layouts.py`, `pictures.py`,
  `html_renderer.py`, `docx_renderer.py`, `render_sample.py`.
- `samples/`: block data for the two target papers and the pictures taken from them.
- `pictures/`: the first library pictures (SVG plus PNG). `scripts/paper_pictures_to_png.py` makes the PNG copies.
- Tests: `backend/examinations/test_paper_blocks.py`.

## Phase 2 as built (2026-11-15)
- **Picture references.** Anywhere a paper names a picture it may be a library name (`"star"`), a school
  upload (`{"upload": 12}`) or a picture drawn by code (`{"make": "clock", "time": "3:30"}`).
- **Smart creation** (`makers.py`): shape, repeat, clock, fraction, number line, ten frame, dice, tally marks,
  squared paper. `MAKERS` lists each kind and its fields for the editor's "Create" tab.
- **New block** `picture_answer`: pictures in a row with a line or box to write under each.
- **Library catalog** (`pictures/catalog.json`): English name, Urdu name and search words per picture.
- **Uploads** (`uploads.py`): PNG, JPG or WebP up to 8 MB. Evens out the light of a phone photo, makes the
  paper white, trims empty edges, shrinks to 1200 px, stores a PNG. SVG uploads are refused.
- **Table** `PaperPicture` (migration `examinations/0040_paperpicture.py`, new table only). NOT applied to
  Supabase. It depends on `schools/0022`, which is also not applied there yet.
- **Endpoints** (`paper_pictures.py`), under `/api/examinations/paper-pictures/`:
  `GET` list (`?search=`), `POST` upload (`file`, optional `label`, `clean=false`), `DELETE /{id}/`
  (a teacher only their own), `GET catalog/` (`?search=`) for the library and the code-drawn kinds.
- A paper only ever gets its own school's uploads (`build_picture_store`).
- Tests: `backend/examinations/test_paper_pictures.py`.

Known limits: the clean-up cannot remove a dark page edge caught in the photo, so the editor needs a crop
tool (Phase 3).

### Picture library (added 2026-11-15, user chose Openclipart)
- 525 pictures: 510 from Openclipart (CC0, no credit needed) plus the 15 drawn for the app.
  22 categories, including actions (verbs) and feelings for language papers. English and Urdu names.
- 12.9 MB in the repository. 393 pictures have an SVG (sharp in the PDF); 132 large drawings are PNG only.
- Sources and how they were cleaned: `backend/examinations/paper_blocks/pictures/SOURCES.md`.
- Printable catalogue: `docs/paper-builder-v2-samples/picture_library.pdf`.
- `GET catalog/` now returns each picture's address instead of the drawing itself; files are served by
  `GET /api/examinations/paper-picture-library/<name>/` (no login: public-domain pictures, and an `<img>`
  tag cannot send a token; strict Content-Security-Policy on the response).
- A paper's own picture folder now wins over the library when names match.
- Quality is mixed: many are old engravings or detailed drawings, not one consistent style. Weak or
  duplicate pictures can be replaced later; an admin "promote upload to library" tool would help.

## Phase 3 plan (approved 2026-11-15)
Split in two, with a check-in between them.
User decisions: do the database change; the phone keeps the old flow until Phase 6 (block papers answer
`generate-pdf` with 409 "open it on the website"); worksheets move to this editor in a later step;
maths drawn by KaTeX from the internet at print time.

**3a built 2026-11-15** (uncommitted):
- Migration `examinations/0041` adds `ExamPaper.document` and the `ACTIVITY` question type. Not applied
  to Supabase (it depends on 0040, also not applied).
- `paper_blocks/registry.py`: 19 block types with field lists (11 activity, 7 text, 1 section heading).
- `paper_blocks/text_blocks.py`: text blocks for the page and for Word; `html_sanitize.sanitize_for_html`.
- `paper_document.py`: header from the paper, question bank sync, old-paper converter.
- Endpoints: `GET paper-blocks/`; `GET exam-papers/{id}/document/`; `POST exam-papers/{id}/preview/`;
  `GET exam-papers/{id}/print-html/`; `autosave` takes `document`; `generate-docx` uses the new Word
  export for block papers; `generate-pdf` answers 409 for them.
- A bank question used by another paper is copied, never edited in place.
- Tests: `test_paper_document.py` (15). Sample: `samples/grade8_science_text_blocks.json`.
- Not done in 3a: answer key for block papers.

**3b built 2026-11-15** (uncommitted):
- Wizard is two steps: Paper Setup, then Build Paper (`frontend/src/pages/examinations/blocks/`).
  `BlockPaperEditor.jsx` (outline, live preview in a sandboxed frame, form), `BlockForm.jsx` (form built
  from the server's field list), `PicturePicker.jsx` (Library, My pictures with Browse and crop, Create),
  `blockDocument.js` (pure helpers), `printPaper.js` (print on the device, Word download).
- The page autosaves only paper details; the editor autosaves the block list. `manual_questions` is no
  longer sent from the page. Total marks are shown, not typed.
- Papers list: "PDF" for a block paper prints on the device.
- Bloom chart kept: written parts have an optional "Thinking level (Bloom)", saved on the bank question;
  the chart leaves drawing activities out. `PaperQuestionSerializer` now sends `bloom_level`.
- Server changes made during 3b: an unchanged bank question is reused, not copied; a new empty paper
  is not reported as "old"; validation messages use the form's labels ("Rows 1, How many: ...").
- Removed from the page: the Structure step, the slot board, "answer lines" option (lines are per
  written block now), the Setup "upload paper image" shortcut (photo capture is "From a photo of a
  paper" inside the editor, after class and subject are chosen).
- Tests: web `blocks/__tests__` (17) and updated `SLOCoverage`/`BloomChart`; 177 examinations web tests
  pass. Server: 80 paper builder tests pass.
- Browser-checked on the scratch SQLite servers (8100/3100): add blocks, picture search in Urdu,
  autosave, preview, Word download, validation message and recovery, Bloom chart.
  Not clicked: Print (opens the system print dialog); the print page itself is covered by server tests.
- Known: the bank picker lists only questions linked by curriculum topics to the chosen class (old
  behaviour, unchanged). `ManualEntryPaperTab`, `PaperStructureBuilder`, `QuestionSlotEditor` are no
  longer used by this page (still used elsewhere or removable in Phase 7).

**3a: server**
- New field `ExamPaper.document` (the block list). New field only, migration 0041; shown before it runs.
- Text blocks join the block library: MCQ, short, long, essay, true/false, fill in the blank, matching.
  Each block type gets a field list (label, kind, limits) so the web form is built from the server's list.
- Saving a paper keeps the question bank in step: every block is saved as a Question plus a PaperQuestion,
  so marks entry, student responses, the answer key and reuse keep working. Activity blocks use a new
  question type `ACTIVITY` (a new choice on an existing column, no change to the table).
- Converter: an old paper (structure + questions) opens as blocks. Old papers are not rewritten until
  someone saves them in the new editor.
- Endpoints: block list and fields; preview (HTML of an unsaved document); print HTML; Word.
  `generate-pdf` and `generate-docx` use the new renderers when a paper has a document.
- Text in the HTML is cleaned (tags allowed: bold, italic, sub/superscript, lists, tables). Maths ($x^2$)
  is drawn by KaTeX in the page.

**3b: web editor (replaces steps 2 and 3 of the wizard)**
- Step 1 Setup stays (class, subject, exam, title, duration). Then one editor screen:
  outline of blocks on the left (move, copy, delete), live preview in the middle, the selected block's
  form on the right. "Add block" lists activity and text blocks; "From question bank" and the current
  photo capture still work and become blocks.
- Picture field: Library (search in English or Urdu), My uploads (Browse, with a crop step before upload),
  Create (the code-drawn pictures).
- Autosave as today. Total marks are the sum of the blocks.
- Tests: server tests for each piece; web tests for the editor state and the form builder.
- Vision model for the scan: test Gemini and a Groq vision model on real pages in Phase 4, choose by result.
- Source of library pictures: an openly licensed line-art set, listed for the user's approval before it is added.
- Page numbers in the PDF footer rely on a browser feature that iPhone printing may not have; check in Phase 6.
- Word drawings use a system font on the server; bundle one font file before go-live so Render and Windows match.


## Open items carried forward (not done yet)
- Migrations on Supabase: 0040 and 0041 were applied 2026-11-17 with the user's approval (memory note; not re-checked in
  Phase 7). `examinations/0043_worksheet_document` (after 0042) is NOT applied there: the 2026-11-17 read-only check found no
  `document` column on the worksheet table. Applying it is the user's call; show the plan and check the database first.
- Nothing from Paper Builder v2 is committed. The working tree also has unrelated uncommitted work
  (student bulk import / bulk delete, `Toast.jsx`, `SelectionBar.jsx`, `students/views.py`): never
  commit with `git add .`.
- Answer key for block papers: built 2026-11-17 as step 7b (the old `generate_answer_key` was a stub that raised
  `NotImplementedError`; removed in Phase 7 with the user's OK).
- Matching questions in the bank: fixed 2026-11-17 (see "Matching format fix" below). Extra right-hand items (distractors)
  still have no place in a matching block; a question used only on that paper loses them if its pairs are edited there.
- Phone: done. Since Phase 7 every paper prints on the phone; `generate-pdf` answers 409 only to apps from before Phase 6.
- The rich text editor's text boxes have no accessible name (existing shared component).
- Bank picker lists only questions linked by curriculum topics to the chosen class (old behaviour).
- `DiagramModeExportRenderingTests`: gone with the old exporters in Phase 7.
- Picture library quality is mixed (old engravings, some faint); replace weak ones over time.
- Word drawings use a system font on the server; bundle one font file before go-live.
- Page numbers in the printed PDF rely on CSS `@page` margin boxes (Android WebView >= Chrome 131); part of the phone test.
- Before go-live: the user's phone test; commit (file by file, never `git add .`); deploy the server and the new APK
  together, then the web; on Render set `GEMINI_API_KEY` (and allow Qwen in that Groq project) and check
  `PIL.features.check('raqm')`.

## History: the Phase 4 session start notes (2026-11-15, done; kept for reference)
Goal: a teacher photographs a paper (any class, including Play Group activity papers) and gets blocks in
the editor, with pictures matched to the library or cropped from the photo.

What exists to build on:
- Current scan: `backend/examinations/paper_ocr_processor.py` (Google Vision text -> Groq LLM; or Groq
  vision), `paper_layout.py` (word boxes, figure regions), `paper_layout_apply.py` (crops figures),
  `paper_reconcile.py` (multi-page), task `tasks.process_paper_upload_ocr`, endpoints under
  `paper-uploads/` (`upload-image`, `group-status`). Web review UI: `ImageCapturePaperTab.jsx`, now opened
  from the editor's "From a photo of a paper"; its result is converted by `capturedPaperToBlocks` in
  `frontend/src/pages/examinations/blocks/blockDocument.js` (text blocks only today).
- Block list and fields: `backend/examinations/paper_blocks/registry.py` (`registry_for_api()` is a ready
  description of every block for an AI prompt). Validation: `paper_document.check_document`.
- Picture library catalog with English and Urdu names: `paper_blocks/pictures/catalog.json`.

Suggested steps (get the user's approval on the plan first; memory rule "always plan before code"):
1. Read the files above and the settings for the vision model (`VISION_PROVIDER`, `GROQ_VISION_MODEL`).
2. Design: the vision model returns blocks (registry types and fields) directly, picture names chosen
   from the catalog; unknown pictures become `{"url": ...}` crops of the photo (only our storage host is
   allowed by `check_document`). Validate with `check_document`; drop or repair invalid blocks.
3. Decide with the user which vision model to test (Gemini needs a new API key from the user; Groq vision
   is configured). Test on the user's two Play Group PDFs (pages rendered to images) and a real photo.
4. Wire it so the editor's "From a photo" adds blocks (activity and text), and the review step shows
   what was read next to the photo.
5. Tests: server tests with the AI call mocked; web tests for the new conversion.

How to test locally without touching Supabase:
- Never use ports 8000/3000 (the user's real servers on Supabase). Scratch servers: backend 8100 on
  SQLite, web 3100. Start with `bash docs/media/_authoring/preflight.sh` (checks it is on SQLite with live
  services blanked, migrates the scratch db, starts both). Restart only the backend after Python changes
  (it runs with --noreload). Login at `http://localhost:3100/login?subdomain=seed-test-alpha` as
  `SEED_TEST_admin` / `Abcd1234`. Test paper: id 15.
- Scratch settings blank the AI keys, so real scan calls cannot run there; mock them, or ask the user
  before calling a real AI service with test images.
- Backend tests: `cd backend && python -m pytest examinations/test_paper_blocks.py
  examinations/test_paper_pictures.py examinations/test_paper_document.py` (80 pass).
  Web tests: `cd frontend && npx vitest run src/pages/examinations/` (177 pass).
- Sample papers: `python -m examinations.paper_blocks.render_sample <json> <out dir>` from `backend/`;
  samples in `backend/examinations/paper_blocks/samples/`, outputs in `docs/paper-builder-v2-samples/`.

## Phase 4 progress (2026-11-15, uncommitted)
User chose: test Groq first, then Gemini (Gemini needs a key from the user). Ask before sending any test image to a real AI service.
Server built and tested (no migration):
- `backend/examinations/paper_scan_blocks.py`: prompt built from the registry + library names (+ Google Vision text when set up);
  Groq (`PAPER_SCAN_GROQ_MODEL`, default llama-4-scout) or Gemini (`GEMINI_API_KEY`, `PAPER_SCAN_GEMINI_MODEL`), chosen by
  `PAPER_SCAN_PROVIDER` (new settings in `config/settings.py`). Every field coerced to the registry, pictures matched to the
  library (plurals, Urdu) or cut from the photo (`{"crop":[ymin,xmin,ymax,xmax]}` 0-1000), bad blocks dropped with notes,
  `check_document` last. `merge_pages` joins a text question that runs over a page break.
- `upload-image` takes `mode=blocks` (seeds `ai_extracted_json={'scan_mode':'blocks'}`); the task then calls `scan_page`;
  `group-status` returns the merged block result. No mode = old scan (phone).
- Tests: `examinations/test_paper_scan_blocks.py` (35 pass).
Web built 2026-11-16 (uncommitted):
- `api.uploadPaperImage(..., mode)`; `ImageCapturePaperTab` takes `mode` ("blocks" from the editor; the recovery key
  includes the mode) and shows `blocks/BlockScanReview.jsx` for a block result: photo beside one card per block
  (kind, title, marks, picture thumbnails, dashed box for a missing picture), notes, marks check, untick to leave out.
- `capturedPaperToBlocks` uses `prefill.blocks` (`scannedBlocksToBlocks`: fresh ids, item keys, no page_number);
  `blockPictures` helper. The page's confirm call sends `{blocks}`; the server counts them for feedback.
- Tests: web `BlockScanReview.test.jsx` (4) + 2 in `blockDocument.test.js`; 183 examinations web tests pass.
- Browser-checked on scratch (8100/3100) with a seeded scan result (Play Group Math through `clean_result`): review,
  untick, add 8 blocks, autosave/preview/confirm all 200, no console errors.
Left: real Groq test on the two Play Group pages (user approval needed before sending images), then Gemini (needs key).
Scratch note: SUPABASE_URL is blank there, so cropped `{url}` pictures would fail `check_document` on scratch only.
Real-model test 2026-11-16 (user approved sending the PG pages; originals in the user's Downloads, rendered at 150 dpi):
- Groq: `meta-llama/llama-4-scout-17b-16e-instruct` is retired (404). The key's only other candidate,
  `qwen/qwen3.8-27b`, is "blocked at the project level" (Groq console > project limits); unknown whether it reads images.
- Gemini with the Google Vision key: 403 PERMISSION_DENIED on generativelanguage.googleapis.com (API not enabled
  on that Cloud project, or the key is restricted to Vision). A free AI Studio key would avoid both.
- No page was scanned. Runner: a script in the session scratchpad (crops saved locally, no DB/Supabase/Redis).
Real-model test, continued (2026-11-16):
- Gemini (`gemini-3.8-flash`, free AI Studio key in `GEMINI_API_KEY`; 2.5-flash is closed to new users) on the user's
  original PG Math + English PDFs (6 pages): 18/18 questions found, all 18 block kinds right, all marks right,
  7-16 s per page. 26 pictures matched to the library, 5 cut from the page (igloo, mango, jelly, tree scene, sign), all
  correct. Differences: defaults filled in, "puppy" for "dog", find-and-colour circles in another order.
  Fixed after the test: printed "Q1:" / "1." numbers stripped from titles and parts (decimals kept), crop margin 0.5%.
- Groq `qwen/qwen3.8-27b` (vision per Groq's model card) still "blocked at the project level" for the key in
  `EDU_GROQ_API_KEY` after the user enabled it: probably a different Groq project than the key's.
- Next: Qwen run once Groq allows it; a real phone photo (not a PDF render); choose the default provider.
- Groq Qwen 3.8 27B (after the user allowed it in Groq > Project > Allowed Models), same 6 pages:
  Math as good as Gemini (9/9 kinds, marks, pictures; 3 crops). English weaker: 8/9 kinds (letter grid read as
  find-and-colour), handwriting columns 2 not 4, missing-letters sequence shifted by one box, jelly -> "cake",
  mango -> "pear", oral marks moved to the wrong part. About 6 fixes on English vs none needing a fix for Gemini.
  Free-plan limits: 8,000 tokens and 1,000 OUTPUT tokens a minute, so about one page a minute and
  `max_completion_tokens` must be <= 1000 (now `PAPER_SCAN_GROQ_MAX_TOKENS`, default 1000). Groq also answered
  503 "over capacity" once; busy answers (429/5xx) now retry once after 8 s and tell the teacher to wait.
- Recommendation: Gemini as the default provider, Qwen as a fallback. Not switched yet (user's call).
- User decision 2026-11-16: Gemini is the default scan service, Groq Qwen the fallback. Built: `scan_providers()`
  (`PAPER_SCAN_PROVIDER=gemini`, `PAPER_SCAN_FALLBACK=groq`); only service failures (busy, quota, not set up,
  unreadable reply) move to the fallback, an empty page does not; the result says `fallback_from`. Photo downloaded
  once. Keys listed in `backend/.env.example`. 51 scan tests pass. Render needs `GEMINI_API_KEY` set in the
  dashboard before go-live (and Qwen allowed in that Groq project).
- Next: a real phone photo of a paper (any class); then Phase 4 is done.
- Real phone photo (handwritten Class 5 Maths MCQ, 10 questions, 2026-11-16), Gemini: header, instruction (struck-out
  words dropped), 10/10 questions and 40/40 options right in 15 s. Found and fixed (user approved all three):
  1. Equations typed in the rich editor (span[data-type=inlineMath], data-latex) printed as "$x^2$" on block
     papers and in Word: `html_sanitize` now turns them into `<span class="math">` for KaTeX (page) and plain LaTeX
     (Word, old PDF); `has_math` sees them. Phase 3 bug, not caught because the samples had no equations.
  2. Scan: `$...$` in rich-text fields becomes the editor's equation node (`rich_text`), plain numbers lose the
     dollars, text is HTML-escaped; plain-text fields and titles keep the inside of the dollars.
  3. Scan prompt: answers only when the paper shows them, never worked out by the model.
  Rescan after the fixes: no dollars, no invented answers. 142 paper builder server tests pass.
- Phase 4 is done apart from committing. Not browser-checked after the equation fix (server tests cover it; the
  scratch backend runs with --noreload and needs a restart to pick it up).

## Phase 5 progress (2026-11-16, uncommitted)
User decisions: Word embeds the font; Western digits 1 2 3; direction is per paper (per-block override later
if needed); font = Noto Nastaliq Urdu (OFL), static Regular + Bold from the notofonts project, 250 KB each.
Built (no migration; `direction` already lived in the document JSON):
- `paper_blocks/fonts/` (2 TTF + OFL.txt). `paper_blocks/urdu.py`: Urdu detection, Urdu labels (سوال 1, نام,
  کل نمبر, درست / غلط, کالم (الف) ...), part/option letters الف، ب، ج (number style stays numbers), the
  font as @font-face inside the page (only when the paper has Urdu; ~680 KB) so it prints offline.
- Drawings: `Scene.mirrored()` flips positions, not pictures or text; `build_scene(block, rtl)`. Urdu scene
  text uses Nastaliq (SVG font-family; PNG via the bundled TTF and Pillow raqm, size x1.15, raised a little).
- Page: lang="ur" dir="rtl", Nastaliq first then Latin fonts, line-height 2, footer/page number swap sides,
  marks/maths/blanks isolated. Sign label "Teacher’s Sign" (the default) becomes دستخط استاد.
- Word (`paper_blocks/docx_urdu.py`): one pass after building: w:bidi paragraphs, w:bidiVisual tables, runs
  split so Latin words and signs the font lacks (" # $ % & ' * ; < > ? @ ^ _ ` ~) stay LTR; Urdu runs get
  w:rtl, cs font, bCs/szCs. Settings are inserted in schema order (Word ignored the font when they were
  appended). Font embedded as obfuscated .odttf + w:embedTrueTypeFonts. Checked by converting with Word
  on Windows (this PC has no Noto Nastaliq installed, so the embedded copy was used). Urdu part labels get a
  13 mm indent ("(الف)" is wider than 9 mm).
- `paper_document.render_document`: Urdu time label (1 گھنٹہ, 45 منٹ) and footer wording on RTL papers.
- Scan: prompt rules (keep Urdu script, reading order from the right, match column "left" = first read),
  Urdu question/part markers stripped (سوال نمبر 2۔, (الف), ب), ج۔), result `direction` judged from the
  letters read (picture names and HTML tags ignored), merged pages keep it. The editor gives an EMPTY paper
  the scanned direction.
- Web: "Paper language" (English / اردو Urdu) in the editor's Paper header panel; text inputs dir="auto";
  rich text boxes open in Urdu on an Urdu paper or when the text is Urdu (`openLanguage` in richEditorCore).
- Tests: `examinations/test_paper_urdu.py` (32); server paper builder total 174 pass; web examinations 186 +
  editor core/bundle 35 pass.
- Browser-checked on scratch (8100/3100): Urdu blocks in paper 15, language select, RTL preview in Nastaliq,
  Word download carries the font.
Known / open:
- The user has no Urdu paper of their own. Sample used instead (2026-11-16): Tamil Nadu HSC Urdu Paper I, March
  2019 (dge.tn.gov.in, 8 pages, Urdu printed as images). Sections I, II (to Q12), IV and VI rebuilt by hand in
  `samples/urdu_board_paper1.json`; outputs `docs/paper-builder-v2-samples/urdu_board_paper1.{html,pdf,docx}`
  (PDF printed by Edge headless). A few words were hard to read (Q12 options). The user's own link was a small
  photo of handwritten Urdu notes (questions with answers): kept for a handwriting scan test.
- Fixed after printing the board paper: English inside Urdu lost its order (".Supervisor", scrambled
  "(ii), (iii)") -> `urdu.isolate_latin` wraps English stretches in <bdi> on RTL pages, and Word splits runs by
  the same rule (`latin_stretches`). Word flattened tables in question text and doubled line breaks (old bug,
  English too) -> `text_blocks._rich_part` writes real Word tables and single breaks.
- Real Gemini scan (user approved, 2026-11-16; runner in the session scratchpad, no DB/storage, crops off):
  - Board paper page 1 (150 dpi render): header (title, class, total 90, 150 min), section heading, 4/4 MCQs
    and 16/16 options right, Urdu spelling right, direction rtl, 19-22 s.
  - The user's handwritten notes photo (380 px): 3/3 questions and their written answers (into "answer", as
    the paper shows them) read correctly, 8 s.
  - Fixed after the first run: the model's line breaks were lost (`rich_text` now writes <br>); the parts'
    numbering was left at roman (prompt now asks for the paper's own style); an untitled section heading is
    dropped with a note. Second run: all three right.
  - Also fixed (old bug, all papers): `html_sanitize` dropped the editor's bare `<br>` (Shift+Enter), so typed
    line breaks printed as one run-on line; now kept as <br/> (page and old ReportLab PDF), newline in Word.
  - Tests: test_paper_urdu.py now 43; paper builder + examinations/tests.py 311 pass (2 known offline
    DiagramMode failures).
- Render: Pillow needs FriBiDi at run time to join Urdu in Word drawings (`scene._can_shape` logs a warning
  if not); check once on Render (`python -c "from PIL import features; print(features.check('raqm'))"`).
- Scratch only: the sandboxed preview frame cannot load library pictures from localhost:8100 (shows broken
  images; the same URL loads in the page). Not seen as a production problem; worth a look in Phase 6.
- Latin text in Word drawings still uses a system font (the old TODO).

## Phase 6 progress (2026-11-17, uncommitted)
Phone block paper builder for teacher, admin/principal and manager (the same screen files they already had).
Built (no migration):
- Server: `print-html?embed=1` puts library pictures inside the page (the phone prints with it, so Android's
  expo-print never makes the PDF before linked pictures load); `paper-picture-library/<name>/?format=png` serves the
  PNG copy (the phone cannot draw SVG thumbnails); the `generate-pdf` 409 now says "Update the app, or open it on the
  website" (only an older app build lands there). Tests in `test_paper_pictures.py` / `test_paper_document.py`.
- Shared code: `scripts/build-rich-editor.mjs` also copies `blocks/blockDocument.js` and the new `blocks/pictureRefs.js`
  (describePicture, makerDefaults, setMakerValue, moved out of PicturePicker.jsx) to `mobile/services/shared/`
  unchanged, with hand-written `.d.ts` files; `--check` (and the web richEditorBundle test, and a jest test) fail when
  a copy is stale. Both files must stay import-free (web test `pictureRefs.test.js`).
- Phone (`mobile/`): `PaperBuilderScreen` is now Setup (class, subject, exam, title, duration, instructions, lesson
  plans, coverage, status) then Build paper; `components/content/blocks/`: `BlockPaperEditor` (tabs Questions / Edit /
  Preview, autosave 1.2 s + on leaving, header panel with language, Share PDF / Print / Word), `BlockForm` (form from
  the server field list; rich text opens one editor at a time in a sheet), `PicturePickerSheet` (library, my pictures
  with the phone's crop, create), `BlockScanReview`, `PaperPreview`; `PaperPagesSheet` got `mode="blocks"`;
  `PapersScreen` prints block papers on the phone (`uses_blocks`) and falls back on a 409. Pure logic in
  `services/blockPaper.ts`, native print/share in `services/paperPrint.ts`. File names keep Urdu letters.
- The old builder's sections/questions UI is gone from the phone; old papers open converted, as on the web.
- Bank picker on the phone leaves ACTIVITY questions out (their drawings live on the paper's block list; the shared
  converter would make a short-answer block with only the heading). The web picker has the same gap but hides it
  because it filters by class topics; not changed on the web.
- Tests: jest `blockPaper.test.ts` (24) + touched suites 159 pass, tsc clean; server 61 pass; web examinations 204 +
  blocks 30 pass.
- Browser-checked on scratch (backend 8100 with `CORS_ALLOWED_ORIGINS=http://localhost:8181`, Metro web 8181 via
  `.claude/launch.json` "mobile-scratch") as SEED_TEST_admin and SEED_TEST_manager: open paper 15 (Urdu), edit,
  autosave, validation message on a block, add block, library search in Urdu, Create tab, rich text sheet, preview
  (Urdu RTL), new paper via ensure-draft, bank questions, details save keeps blocks and total, photo scan review with a
  seeded block result (file input and upload reply stubbed in the browser, group-status and confirm real).
  SEED_TEST_teacher has no class/subject assignments on scratch, so the teacher's class list is empty (seed gap).
Found:
- Scratch broken pictures in the preview frame: the sandboxed frame has an opaque origin and Chrome blocks it from
  loading `http://localhost` (private address); the same frame with allow-same-origin loads them. Production uses a
  public https API host, so this is scratch-only; phone printing embeds the pictures anyway.
Not verified (phone test): expo-print PDF (page numbers need Android WebView >= Chrome 131 for @page margin boxes;
iPhone has none, iOS is out of v1), KaTeX from the CDN in the printed PDF (fallback if maths is missing: render in a
hidden WebView and print the snapshot), Word share, camera/crop upload, the preview WebView at 720 px width.
Deploy: server and the new APK together (no new native module).

## Phase 6 follow-up fixes (DONE 2026-11-16, uncommitted; see "Fixes as built" at the end of this section)
Issues found while browser-testing Phase 6, with what is already known and the planned correction.

**F1. Activity questions from the question bank lose their drawing (web and phone).**
- Known: the server already saves an activity block's bank question as `ACTIVITY` with
  `type_data.block = {type, title, marks, data}` (`paper_document.py`, around line 186). The shared converter
  `questionToItem` / `bankQuestionsToBlocks` in `frontend/src/pages/examinations/blocks/blockDocument.js` does not know
  `ACTIVITY`, so it makes a short-answer block with only the heading. The web hides this because its picker filters by
  class topics; the phone (subject only) showed it, and Phase 6 hides ACTIVITY there (`bankPickable`).
- Debug first: confirm the bank list endpoint returns `type_data` for ACTIVITY rows, and what a saved activity
  question holds today (scratch paper 15's questions); check old rows saved before `type_data.block` existed.
- Fix: in `blockDocument.js`, an ACTIVITY question becomes its own block rebuilt from `type_data.block` (fresh block id,
  `question_id` kept so the server reuses the bank question, marks from the picker); an ACTIVITY row without
  `type_data.block` is skipped and counted, with a note in the picker ("1 activity could not be added"). Rebuild the
  phone copy (`node scripts/build-rich-editor.mjs`), then remove `bankPickable` from the phone picker (or keep it only
  for rows without a block). Check the server keeps an unchanged reused activity question (not copied).
- Tests: web `blockDocument.test.js` (activity restored, legacy row skipped, mixed list keeps order), jest copy check,
  server test that the block round-trips paper -> bank -> new paper with the same drawing.

**F2. Opening a screen by link loses its query (`/paper-builder?id=16` opened an empty new paper).**
- Known: `mobile/components/nav/RoleGuard.tsx` redirects to `/` with `next: pathname`, and `usePathname()` has no
  query, so `?id=16` is dropped whenever the URL first resolves to another persona's group (e.g. `/paper-builder`
  matches the admin group first for a teacher). Affects every deep link with params (push taps with `screen`, shared
  links, the browser), not only papers.
- Debug first: reproduce as teacher and manager on scratch; read how `app/index.tsx` uses `next`
  (`services/notificationRoute.ts` and `ownRoute` rules) and whether it keeps params.
- Fix: carry the search params with `next` (`useGlobalSearchParams`, serialised into `next` or passed as extra params),
  and have the index route open the user's own group with them; keep the existing "own group only" safety rule.
- Tests: jest for the pure next-path builder and the index's own-route resolution with a query.

**F3. Library pictures broken in the editor preview on scratch (web and phone browser preview).**
- Known: the preview frame is `sandbox="allow-scripts"` (opaque origin). Chrome blocks such a frame from loading
  `http://localhost:8100` (private address); the same `<img>` loads in an unsandboxed frame or with allow-same-origin.
  Production (public https API) should not hit this, but it is not proven, and a broken preview makes scratch testing
  and demos misleading.
- Debug first: confirm the console reason (Private Network Access) on web 3100 and Metro 8181; check one production-like
  case (an https public image in the same sandboxed frame); measure `preview` size with pictures embedded for paper 15
  and the two Play Group samples.
- Fix (choose after measuring): (a) `preview` accepts `embed=1` like `print-html`, and the web and phone editors ask
  for it, with the server caching each library picture's data URI so a keystroke does not re-read files; or (b) keep
  links in production and embed only when the request comes from a local host (`settings.DEBUG`-style switch). Prefer
  (a) if the size stays small (only pictures the paper uses are embedded). Never add allow-same-origin to the frame.
- Tests: server preview with `embed=1` has no library links; size check on a sample paper.

**F4. Teacher flow could not be tested (scratch teacher has no classes).**
- Known: `SEED_TEST_teacher` has 0 class-subject assignments on scratch, so `classes/` returns none and the Setup class
  picker is empty. The phone shows an empty picker with no explanation.
- Fix: (1) on scratch only, give `SEED_TEST_teacher` one class-subject (Class 1A Mathematics) with a seed step or the
  admin screens, then run the full teacher flow (new paper, blocks, photo review, bank, preview); (2) phone Setup shows
  "No classes are assigned to you. Ask the school admin." when a teacher's class list is empty (check the web's wording
  and mirror it).

**F5. Check: a typed paper title once did not stick.**
- In the browser test the title typed after choosing class and subject was not in the box afterwards (the automatic
  title stayed). Probably the test click missed the box, but reproduce once: type a title, pick class/subject in either
  order, go to Build paper and back, save details; the typed title must win.

### Debug results (2026-11-16, scratch only)
- **F1 confirmed.** The bank list returns `type_data.block` for ACTIVITY rows (15 of 15 on scratch have it; the type only
  exists since migration 0041, so rows without a block should not exist). The server reuses an unchanged activity
  question (checked for all 15, rolled back). Two more server findings in `paper_document.py`:
  (1) the block's marks are stored inside `type_data.block`, so the same activity with different marks counts as edited
  and is copied, against the "marks belong to the paper" rule in `_save_question`;
  (2) the same bank question used twice in one paper (any type) fails with `IntegrityError` on
  `PaperQuestion (exam_paper, question)`: `attach` tries to add a second row, which `unique_together` forbids. Neither
  picker stops a second pick.
- **F2 confirmed.** As manager, `/paper-builder?id=16` ends on `/paper-builder` with an empty new paper. `RoleGuard`
  sends only `usePathname()`; `app/index.tsx` replaces to the own route as a plain string. `ownRouteForPath` also knows
  only fixed paths, so a link like `/admissions/12` falls back to Home.
- **F3 confirmed.** In Chrome 156 the `sandbox="allow-scripts"` frame (origin `null`) fails to load
  `http://localhost:8100` and `http://127.0.0.1:8100` pictures, and loads a public https picture; with
  allow-same-origin or no sandbox all three load. So production (public https) is not affected. Sizes: embedding adds
  about 10 to 15 KB (paper 15: 698 -> 707 KB; Play Group Math: 145 -> 160 KB, 15 pictures); an Urdu page is already
  about 680 KB because of the two fonts. The data-URI cache already exists (`pictures._encode`, `lru_cache`).
  Extra finding: `core/cache_middleware.py` overwrites the library picture's `Cache-Control: public, max-age=604800`
  with `no-cache` (no ETag), so linked pictures are downloaded again on every preview refresh and in the picker grid.
- **F4.** `SEED_TEST_teacher` has no staff row at all (not only no class-subject). `SEED_TEST_staff_teacher1`
  (staff 1) already teaches Class 1A Mathematics, English and Urdu and logs in with the dev password. The web has no
  wording for an empty class list; the phone's `TeacherClassGate` says "No classes assigned".
- **F5 not a bug.** Typed title kept in both orders, through Build paper and back, and after Save details (scratch
  paper 17 "My typed title F5" was created by this check). Clearing the title brings the automatic one back, as
  designed. The first report was most likely F2 (the id was dropped, so a new empty paper opened).

### Fixes as built (2026-11-16, uncommitted; user approved the recommended choices)
- **F1.** `blocks/blockDocument.js`: an ACTIVITY bank question comes back as the block saved in `type_data.block`
  (fresh id, `question_id` kept, data copied, marks from the picker); one per block, picked order kept. A row without
  a block is left out (`isLostActivity`) and `bankAddedMessage` says "1 activity could not be added because its
  drawing was not saved." (web warning toast, phone info toast). Phone copy regenerated, `bankPickable` removed, the
  phone list labels them "Activity" (`questionBank.typeLabel`; not added to the editable type list).
  Server `paper_document.py`: the block's own marks are ignored when deciding if a bank activity was edited
  (`_without_block_marks`), so a different mark reuses it; a second use of the same bank question in one paper is
  saved as its own copy (`first_use`) instead of failing on `PaperQuestion` uniqueness.
- **F2.** `navigation/routes.ts` `nextWithQuery` / `ownTargetForNext`; `RoleGuard` sends the query with `next`
  (`useGlobalSearchParams`), `app/index.tsx` opens the own route with the params. Own-group-only rule unchanged.
- **F3.** Option (a): `preview` takes `?embed=1` like `print-html`; web `questionPaperApi.previewDocument` and phone
  `previewPaperDocument` ask for it. No new cache needed (`pictures._encode` already caches). The frame stays
  `sandbox="allow-scripts"`. `core/cache_middleware.py` leaves the library picture's `public, max-age=604800`
  (`LONG_CACHE_PREFIXES`, 200 answers only).
- **F4.** Phone Setup shows `emptyClassMessage` under an empty class list (teacher: "No classes are assigned to
  you. Ask your school admin to assign you a class and subject."; others: no classes set up yet). No database write.
- **F5.** No change (not a bug).
- Tests: server `test_paper_document.py` + `test_paper_pictures.py` 65 pass (new: activity paper -> bank -> new paper
  with a different mark is reused, same question twice saves a copy, preview embed, cache header); web blocks +
  shared-copy suites 34 pass (3 new converter tests); jest 92 pass across the touched suites (new: activity restore,
  setup message, next with query); `tsc` clean; `build-rich-editor.mjs --check` up to date.
- Browser re-run on scratch (backend 8100 restarted with the new code and the 8181 CORS origin; web 3100; Metro
  8181): manager and teacher `?id=` links open the paper; the phone bank adds three activities as count-and-write /
  oral blocks with bank ids 127/126/125 kept; adding 127 again saved as copy 128; preview frames (web and phone,
  paper 17 and Urdu paper 15) carry their pictures as data with no library links; SEED_TEST_teacher sees the empty
  class message; SEED_TEST_staff_teacher1 made a new paper (18), added a block and saw the preview; admin opened 15.
  The browser pane was hidden, so its screenshots of the preview frame were stale; the pictures were checked from
  inside a copy of the same sandboxed frame instead.
- Scratch rows added by these checks: papers 17 and 18, question 128 (copy). Not done: the phone test itself.

Not issues (test harness only): the `removeChild` error overlay came from the browser file-input stub; the shifted
clicks came from the browser pane's viewport emulation.

## Phase 6b progress (2026-11-17, uncommitted)
Worksheets use the paper's block editor on the web and the phone, through the same server path. Plan approved 2026-11-17.
- **Database:** `Worksheet.document` (JSON, default `{}`), migration `examinations/0043_worksheet_document` (depends on
  0042 `studentmark_entered_by` from the teacher-performance work, which waits on 0040/0041). New column only. Applied to
  the scratch SQLite database only; NOT applied to Supabase.
- **`paper_document.py`:** `_Owner` hides the differences (links `paper_questions`/`PaperQuestion`/`question_order` or
  `items`/`WorksheetItem`/`item_order`, snapshots, header, no stored total for a worksheet). `render_document`,
  `sync_questions`, `save_document`, `convert_old_paper`, `document_for_editor` take either. `worksheet_header`: the
  worksheet title, "Subject:" (new `subject` label, Urdu مضمون), the Name/Roll/Date row, no time, office table and total
  off unless the teacher turns `show_time_marks` on. `owner_problems`: a worksheet without a subject cannot have
  question blocks (every bank question needs a subject).
- **Marks:** optional on a worksheet. A block without marks prints none, its items get `marks_override=None` and the bank
  question 0. The editor starts worksheet blocks without marks (`newBlockFor`), an empty marks box means none
  (`withMarks`). Old worksheets convert with the marks their old PDF printed (the bank default, 1 per item); 0 is dropped.
- **Shared questions (also changes papers):** a question used by any other paper OR worksheet is copied when edited,
  never changed in place (`_Owner.shared_question_ids`). Before, only other papers counted.
- **Endpoints:** `BlockDocumentActionsMixin` (views.py) gives both view sets `document/`, `preview/` (`?embed=1`),
  `print-html/` (`?embed=1`); `_block_docx_bytes` for Word. Worksheet `autosave` takes `document` (not with
  `manual_items`), checks it after the details so a subject sent in the same call counts; `manual_items` on a block
  worksheet answers 409 (an older app); `generate-pdf` answers 409 for a block worksheet; `duplicate` copies `document`;
  the serializer sends `document` (read only) and `uses_blocks`.
- **Scan:** the editor uses `paper-uploads/upload-image` with `mode=blocks` as for papers. `paper-uploads/{id}/confirm/`
  takes `worksheet_id` (scope-checked, before the legacy branch that would create a paper): feedback row, upload
  CONFIRMED, no new column. `worksheet-uploads/` stays for the old screens.
- **Web:** `blocks/documentApi.js` (endpoints, noun, header defaults per kind), `BlockPaperEditor kind="worksheet"`
  (worksheet wording; header panel shows only language and "Total marks line"), `printPaper.js` takes `kind`.
  `WorksheetBuilderPage.jsx` is now the details (title, instructions, subject when an old worksheet has none) plus the
  editor; new worksheets need a subject. `WorksheetsPage` prints a block worksheet on the device.
- **Phone:** the same `kind` on `components/content/blocks/BlockPaperEditor.tsx` and `BlockForm.tsx`
  (`optionalMarks`), `usePaperDocument(id, kind)`, `paperPrint.ts` with `kind`, `blockPaper.ts`
  `DocKind`/`kindNoun`/`headerSwitchOn`, `worksheets.ts` `detailsFromWorksheet`/`detailsPayload` (subject required for a
  new worksheet). `WorksheetBuilderScreen` is Details then Build worksheet; `WorksheetsScreen` Share PDF prints on the
  phone for `uses_blocks` (and on a 409).
- **Old code kept until Phase 7:** `WorksheetPDFGenerator`, `WorksheetDOCXGenerator`, `worksheet-uploads/`, the
  `manual_items` autosave, `process_worksheet_upload_ocr`. No screen uses phone `SectionsEditor` / `PaperCaptureSheet`
  any more; the web `PaperStructureBuilder` lost this user too.
- **Tests:** server `examinations/test_worksheet_document.py` (23); paper builder suites 189 + old worksheet tests 8 pass;
  web `blocks/__tests__/documentApi.test.js` (4) + `__tests__/WorksheetBuilderPage.test.jsx` (5), examinations web 220
  pass; jest blockPaper/worksheets/paperBuilder/paperContract 64 pass; `tsc` clean; `build-rich-editor.mjs --check` up
  to date.
- **Browser-checked on scratch** (8100 SQLite, web 3100 as SEED_TEST_admin, Metro 8181 as SEED_TEST_manager): new
  worksheet (subject required), count-and-write + short-answer blocks, autosave/preview 200, preview header (title,
  Subject, Name/Roll/Date, no office table/time/marks), Word 200, an old-style worksheet opened converted without being
  saved; phone: list, editor, bank activity added (bank question 128 reused, 5 marks), phone preview. No console errors.
  Scratch rows made by these checks: worksheets 1 and 2 and their bank questions (ids from 129 up).
- **Found and fixed after the check (user approved 2026-11-17):** (1) phone links to screens opened from a list
  (`/worksheet-builder?id=1`) fell back to Home, because `ownRouteForPath` knew only screens in the route maps: new
  `LINKED_SCREENS` per persona in `navigation/routes.ts` (worksheet builder, curriculum book/topic, message thread,
  transport route, and a few admin screens), jest checks every entry's file exists; re-checked in Metro as manager.
  (2) Paper `autosave` now answers 409 to an older app's `manual_questions` on a block paper (as worksheets do); old
  papers still take it. Tests: `ownRoute.test.ts` + `navConfig.test.ts` 75, `test_paper_document.py` +
  `test_worksheet_document.py` 51, `examinations/tests.py` autosave/draft 22 pass. The scratch backend runs with
  --noreload, so it still has the code from before fix (2) until it is restarted.
- **Deploy order:** server first (needs `examinations/0043` on Supabase, after 0042; the memory index says 0040/0041 were
  applied 2026-11-17 by another session, not checked here; applying is the user's call), then
  the web, then one APK (no new native module). An older APK gets 409 on a block worksheet's PDF and on its old autosave.
- Not verified (phone test): expo-print of a worksheet, Word share, the photo scan on a worksheet with a real camera.

Session prompts: follow-up fixes `docs/PAPER_BUILDER_V2_NEXT_SESSION.md`; Phase 6b `docs/PAPER_BUILDER_V2_PHASE6B_PROMPT.md`; Phase 7 `docs/PAPER_BUILDER_V2_PHASE7_PROMPT.md`. Order: fixes, 6b, 7.

## Phase 7 progress (2026-11-17, uncommitted)
User decisions (2026-11-17): variant B, remove everything now (no server shims kept for app builds from before Phase 6);
the answer key waits for its own step (7b); the old answer-key stub may go.
Preconditions checked: F1-F5 done, 6b built. Note: the memory index says 0040/0041 were applied to Supabase on
2026-11-17 (with the user's approval); this plan's open items said not applied. Not re-checked here (no Supabase access in
this phase). Phase 7 needs no migration (`makemigrations --check`: no changes).
**Server**
- `generate-pdf` (papers and worksheets) answers 409 "Update the app, or open it on the website" for every paper; the
  Phase 6+ app prints on the phone on a 409 anyway. `generate-docx` always uses the block Word renderer; `_block_docx_bytes`
  now converts an old paper or worksheet first (`document_for_editor`, nothing saved).
- `autosave` with `manual_questions` / `manual_items` answers 409 for every paper and worksheet; `_save_manual_draft_*` gone.
- `upload-image` without `mode=blocks` answers 409; every upload is a block scan. `group-status` returns merged blocks only
  (a group read by the old scanner is complete with `result: null`; web and phone say "scan again").
- `paper-uploads/{id}/confirm/` needs `exam_paper_id` or `worksheet_id` (400 otherwise); the one-shot branch that created
  the paper itself is gone. `worksheet-uploads/` is gone (404), with its serializers and `process_worksheet_upload_ocr`.
  The `WorksheetUpload` table stays (no column or table dropped).
- Deleted modules: `docx_generator.py`, `paper_export_layout.py`, `paper_reconcile.py`, `paper_layout.py`,
  `paper_layout_apply.py`, `fixtures_paper_layout/`. Moved into `paper_document.py`: `DEFAULT_TYPE_INSTRUCTIONS`,
  `resolve_exam_paper_class_name`. Moved into `paper_scan_blocks.py`: `subject_language`, `vision_language_hints`,
  `_crop_and_store`. `pdf_generator.py` keeps only `_load_logo_stream` and `DateSheetPDFGenerator` (timetable PDF untouched).
  `paper_ocr_processor.py` keeps only the safe error text helpers and `QuestionReviewAI` (`review-questions`).
  `html_sanitize.sanitize_for_pdf` gone. `tasks.process_paper_upload_ocr` is block-only.
- **Found on scratch and fixed:** `fill_blank` and `true_false` blocks had no picture field, so an old question's diagram
  (`question_image_url`, kept by the converter) was silently dropped from the page and from Word. Both now take the same
  optional item picture as MCQ and short answer (registry + HTML + Word). The web/phone forms show a Picture field there.
**Web:** `ManualEntryPaperTab`, `QuestionSlotEditor`, `PaperStructureBuilder` deleted; `ImageCapturePaperTab` is block-scan
only (old questions/sections review gone; recovery key unchanged so a running capture resumes); `paperCaptureLogic.js`
and `paperPayload.js` trimmed; `QuestionBankPicker` lost `toDraftQuestionFromBank`; `questionPaperApi.generatePDF`,
`worksheetApi.generatePDF` and the worksheet-upload calls removed; the Papers and Worksheets lists print every paper and
worksheet on the device (`printPaper`).
**Phone:** see `docs/MOBILE.md` "Old flow removed (Phase 7)".
**Tests:** server: old-code test classes removed (list in `docs/PHASE5_KNOWN_FAILURES.md`, which also closes the 2
offline `DiagramModeExportRenderingTests` failures); new `TestOldPapersAfterPhase7` (old paper with a diagram prints and gives
Word; saving it as blocks keeps its bank questions and student answers; fill-blank/true-false diagrams), 409 tests for the
old app's calls, worksheet-uploads 404, stale scan result. Web: new `ExamPapersPagePrint.test.jsx`, capture tests rewritten
for the block scan. Phone: `paperCapture.test.ts` removed, four suites cut down. Results at the end of this section.
**Scratch proof (8100/3100, Metro 8181):**
- Old papers 4, 12, 13, 14 (made with the old builder on 2026-11-03): `document/` converts, `print-html` 200, Word 200,
  `generate-pdf` 409. Paper 14 was given an old diagram (`question_image_url`, https) and student answers: the diagram prints
  (after the fill-blank fix). An old-style worksheet (3, made for this check) converts, prints, gives Word.
- Web: paper 14 opens converted; paper 13 opens converted with a live preview, an edit autosaved it as blocks; the server then
  had the same 10 bank questions and all 20 student answers linked; its Responses page shows 2 of 4 students entered.
- Phone (Metro web, SEED_TEST_admin): Papers list "Share PDF" on old paper 12 calls only `print-html?embed=1` (200); paper 4
  opens converted with the old-builder notice; Preview 200; no console errors.
- Scratch only: the editor preview of paper 14 says "A picture address must be a file stored by this app", because scratch
  blanks `SUPABASE_URL`, so no host passes `check_document`. In production old diagrams are on our Supabase storage and pass
  (server test with the storage host set). **Risk to check before deploy:** an old question whose `question_image_url` is on
  another host would print, but the editor would refuse to preview or save that paper until the picture is replaced.
  **Checked 2026-11-17 (read-only, user approved; a READ ONLY transaction, rolled back):** Supabase has 16 active old
  papers, 3 worksheets (no `document` column there yet, 0043 not applied, so all are old-style) and 127 bank questions;
  none has any picture link (question or option images): 0 links, so 0 on another host. No risk today. A picture added
  later goes through the editor, which only accepts our storage.
**Deploy order (variant B):** server, then the web, and the new APK released at the same time as the server. Any APK from
before Phase 6 gets 409 "Update the app" when it prints a paper or worksheet, scans a page, or saves an old-style paper,
and must be updated (there is no forced-update check in the app). Phase 6/6b APKs already print on the phone after a 409.
**Results (2026-11-17):** server `pytest examinations` 253 + `examinations/tests.py` 65 = 318 pass, 0 fail
(`makemigrations --check` clean); web examinations + components vitest 265 pass, `vite build` clean; phone jest (touched
suites) 142 pass, `tsc --noEmit` clean; `build-rich-editor.mjs --check` up to date; `scripts/mobile_api_gap.py` rerun
(appendix also picks up other batches since 2026-11-03).
**Answer key:** built as step 7b (see "Step 7b progress" below).

## Step 7b progress: answer key (2026-11-17, uncommitted)
User decisions (2026-11-17, approved as recommended): a compact answer sheet (not a marked copy of the paper); answers for
text blocks plus count-and-write and find-and-colour, "Marked by the teacher" for the other activities; a phone button too.
**Server (no migration):**
- `paper_blocks/answer_key.py`: `key_questions` builds the answers once (MCQ letter and option, true/false, blanks filled
  in, model answers / points to look for, matching pairs with the letter Column B is printed with via `shuffled_right`,
  count-and-write rows, find-and-colour count of the printed circles, "Marked by the teacher"); `render_key_html` and
  `render_key_docx` draw it. Same header as the paper plus "Answer key — Not for students"; no name/roll boxes, office
  table or answer lines; "N part(s) have no answer saved" when items lack answers; Urdu labels and right to left; the
  footer reads "Answer key — ...". Teacher text goes through `html_sanitize` as on the paper.
- Small refactors so the key reuses the paper's page: `html_renderer.page_html` (styles, footer, Urdu font, KaTeX) and
  `docx_renderer.new_document` / `finish_document` (A4 setup; Urdu pass and embedded font).
- Endpoints: `print-html?answer_key=1` and `generate-docx?answer_key=1` on papers and worksheets
  (`BlockDocumentActionsMixin._check_answer_key_access`): only users who may edit that paper or worksheet
  (`_can_manage_exam_scope`); anyone else gets 403. Old papers are converted first, nothing saved.
- **Found and fixed:** old matching questions printed empty. The question bank form saves `left_items` / `right_items`
  with index `pairs`; the converter read only text pairs. `paper_document.matching_pairs` (server) and `matchingPairs`
  (shared `blockDocument.js`, so the web and phone bank pickers too) read both shapes. Unlinked left items get an empty
  right side; extra right items (distractors) have no place in a block.
**Web:** "Answer key" button beside "Print / Save as PDF" in the editor (saves first) and an "Answer key" action on each row
of the Papers and Worksheets lists (`printAnswerKey` in `blocks/printPaper.js`, `getAnswerKeyHtml` per kind in
`documentApi.js`); a 403 shows "Only the school admin, the principal and this class's teachers can see the answer key."
**Phone:** "Answer key (PDF)" under Share PDF / Print / Word in the block editor (`paperPrint.shareAnswerKey`, PDF made on the
phone and shared; `blockPaper.answerKeyFileName`, `answerKeyErrorMessage`). Not on the phone lists.
**Tests:** server `examinations/test_paper_answer_key.py` (17: every rule, Urdu page and Word with the embedded font, cleaned
text, permission 403 for staff and 200 for the principal, old paper, worksheet, old matching shapes); web
`ExamPapersPagePrint.test.jsx` (+1), `documentApi.test.js`, `blockDocument.test.js` (+2 matchingPairs); phone
`blockPaper.test.ts` (+2). Web examinations + components 268 pass, `vite build` clean; phone `tsc` clean and jest 28 in
blockPaper (shared copy check included); `build-rich-editor.mjs --check` up to date. Server: `pytest examinations` 269 + `examinations/tests.py` 65 = 334 pass, 0 fail.
**Scratch check (8100/3100, Metro 8181):** keys for old papers 13 and 14, Urdu paper 15 (RTL, Urdu labels, matching
letters), papers 16/17 (count-and-write rows), worksheet 1: all 200 as page and Word. Paper 13's five fill-in-the-blank
parts say "No answer saved": correct, the scratch seed has no answers for them. Paper 14's matching question printed empty
before the fix and now prints Fish/Bird and Water/Nest; its key gives "Fish → b. Water, Bird → a. Nest". Web editor
"Answer key" on paper 15 printed the Urdu key (print stubbed in the frame); phone "Answer key (PDF)" on paper 14 called
`print-html?answer_key=1` (200) and printed the key.
**Not verified:** expo-print of the key on a real phone (the phone test), the 403 message in a browser (server and unit tests
cover it), the list-row "Answer key" in a browser (unit test covers it).

## Matching format fix (2026-11-17, uncommitted; user approved the plan)
Matching questions were kept in two shapes: the question bank form's `left_items` / `right_items` / index `pairs`, and the
block editor's `pairs` of texts. The bank forms (web and phone) opened editor-made ones with empty pairs, and picking an
unchanged bank matching question into a paper made a copy every time (the editor wrote it back in the other shape).
- **Server** (`paper_document.py`): `_block_question_fields` writes the bank shape; `_save_question` decides "edited?" with
  `_same_content`, which compares matching pairs as pairs (`matching_pairs`), so either stored shape, and a bank question with
  a distractor, is reused when unchanged. Edited pairs on a shared question still make a copy.
- **Web:** `matchingData.matchingToBank` (either shape -> bank shape); `QuestionsPage.formFromQuestion` uses it (now exported
  for tests). **Phone:** `questionBank.bankMatching`, used by `questionToForm`.
- No migration and no data change: questions already stored as text pairs are read as they are and are saved in the bank
  shape the next time the form or the editor saves them.
- Tests: server `TestMatchingBankShape` (6) in `test_paper_document.py` (+1 updated); web `matchingData.test.js` (+2),
  `QuestionsPageMatching.test.js` (2); phone `questionBank.test.ts` (+2). Touched suites: server 77, web examinations 193,
  phone 43 pass; `tsc` clean.
- Scratch (8100, Metro 8181): a new matching block on paper 18 was saved as question 136 in the bank shape; picking old
  question 102 into paper 17 twice reused 102 with no new bank question; on the phone question bank both 136 (bank shape)
  and 121 (Urdu, old text pairs) open with their pairs. Not checked in the web question bank: it lists only questions
  linked to the class's curriculum topics, and these block-made questions have none (old behaviour); the unit test covers it.

