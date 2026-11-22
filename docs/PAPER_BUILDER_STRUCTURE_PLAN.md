# Paper Builder: Structure step (approved 2026-11-22, all recommended choices)

Why: building a paper meant adding every question one by one ("+ Add question", pick the type, retype heading and
marks). A teacher already knows the paper's shape before writing it: how many questions, which kinds, how many marks.

## Wizard
1. Setup -> 2. Structure -> 3. Fill questions. A new paper goes to Structure after Setup; an existing paper opens on
Fill. "Skip" on Structure keeps the old add-one-at-a-time way. Worksheets keep their own page (no Structure yet).

## Structure (web and phone)
- One row per question: type, parts, marks (row total). "Total marks" target at the top with "38 of 50, 12 left"
  (a mismatch warns, does not block).
- Fast starts: "Copy from a paper" (an earlier paper of the same class and subject), templates (Play Group set, the
  B5 idea), or typed rows.
- Applying the rows makes the questions at once: type, generic heading, marks and empty parts. Rows stay editable:
  a new row adds a question, a removed row with a filled question asks first, more/fewer parts add empty parts or
  drop empty ones.
- Shared rules (web + phone): `structureFromBlocks`, `applyStructure` in blockDocument.js. Templates come from the
  server's block list (`GET paper-blocks/` -> `structure_templates`).

## Incomplete questions (decision 1: lenient save, strict print)
- A required value that is still empty (required picture, question text, ...) is "still to fill", not an error.
  Autosave and preview accept it; the preview draws the question with a dashed "still to fill" frame.
- Real problems (wrong kind of value, out of range, unknown type) are still errors everywhere.
- Print, Word, answer key and moving the paper off Draft refuse while anything is still to fill and list it.
- Question bank: a block or part still to fill is not copied into the bank (an already linked question stays as it
  was until the part is complete again).

## Fill questions (web)
- Outline: questions still to fill in grey with a dot; "Next to fill" jumps to the next one.
- The preview scrolls to the question being edited; clicking a question in the preview selects it. The server marks
  each question (`data-block`) and adds a small script to the preview page only (not print).

## Phone: write on the paper (decision 2: docked editor)
- One screen: the paper preview, filled questions above, still-to-fill ones below. Tap a question on the paper: an
  editor docks at the bottom with that question's toolbar (parts, picture, marks, type them all, count 1 to N) and
  Prev / Next. The paper scrolls to the question and redraws as you type.

## Copy from a paper (decision 3: included)
- Lists papers of the same class and subject; picking one copies its rows (types, parts, marks), not its questions.

## Order
1. Server: lenient check, still-to-fill list, placeholders, `data-block` + preview script, strict print/Word/status,
   templates in the block list. Tests in test_paper_blocks.py.
2. Web: Structure step, Fill step changes. Tests in blocks/__tests__.
3. Phone: Structure step, write-on-the-paper screen. Tests in blockPaper.test.ts, then a device checklist.

## Status (2026-11-22) - all three phases built, uncommitted, no migration
- Server: `registry.py` (`validate_document(.., to_fill)`, `document_to_fill`, `block_to_fill`, `item_to_fill`,
  `structure_row`, `structure_templates` from the two Play Group samples), `paper_document.py` (`check_document`
  lenient, `print_problems` drafts only, bank sync skips unfinished parts and keeps an existing link),
  `html_renderer.py` (`interactive` preview: `data-block`, `todo` frame, `.current`, PREVIEW_SCRIPT, `?show=`),
  `views.py` (print-html, answer key, Word refuse a draft with parts to fill: 400 `{document: ["Still to fill: ..."]}`),
  `serializers.py` (`check_leaving_draft` on the paper and worksheet serializers), `paper_pictures.py` (templates in
  `GET paper-blocks/`). Tests: new `test_paper_structure.py` 11 pass; test_paper_blocks / test_paper_document /
  test_paper_answer_key 78 pass.
- Web: `StructureEditor.jsx` (new), `BlockPaperEditor.jsx` (`mode`, still-to-fill outline, Next to fill, Change the
  structure, preview follows the question, click on the preview selects, "Not printed yet" list),
  `A4Preview.jsx` (`show` / `onPick` messages), `QuestionPaperBuilderPage.jsx` (3 steps), `blockDocument.js`
  (`structureFromBlocks`, `applyStructure`, `stillToFill`, `blockHasContent`, `defaultTitle`...), api.js (`show`).
  Tests: blocks/__tests__ 70 pass + BloomChart/SLOCoverage 14 pass.
- Browser-checked on scratch (3100/8100, teacher, Play Group): new paper -> Structure -> "Play Group: Mathematics"
  (9 rows, 50 of 50) -> Make the questions -> Fill with 4 still to fill, preview opened at Q3 with dashed frames;
  picture names filled Q3 (3 left); Next to fill went to Q5; Print said "Not printed yet" with the 5 parts left;
  Change the structure and back kept everything. Not checked by hand: a click inside the preview (the tool cannot
  click in a scaled frame; covered by a unit test).
- Phone: `StructureEditor.tsx` (new), `BlockPaperEditor.tsx` (Paper tab = preview on top + docked editor with
  Previous / Next / Next to fill; Questions tab; structure mode), `PaperPreview.tsx` (tap and scroll messages),
  `PaperBuilderScreen.tsx` (Setup / Structure / Fill), `services/blockPaper.ts` (`stillToFillFromError`,
  `pickedBlock`), api.ts (`show`). Tests: blockPaper 33 pass; tsc clean for touched files. Not run on a device.
- Worksheets: lenient save and strict print apply to them too; their page has no Structure step yet.

- Follow-up 2026-11-22 (user: clicking the list scrolled to the preview, clicking the preview jumped the editor):
  the preview script used scrollIntoView, which also scrolled the editor page (checked: +301 px); it now scrolls only
  its own page. Choosing an existing question no longer moves the window (only a new question brings its form on
  screen), and the preview and form columns are sticky on wide screens. Browser-checked: list clicks and a preview
  pick leave the window still; preview and form stay in view while the page scrolls.

- Question type picker 2026-11-22 (user: the flat list is not enough): types grouped by what is asked (Writing
  practice, Numbers and counting, Pictures, Quick answers, Written answers, Oral, Layout), each with a hint; server
  `TYPE_GROUPS` / `TYPE_PICKING` in registry.py, sent with `GET paper-blocks/`. Play Group, Nursery and Prep (user
  decision) see the activity groups first, every other class Quick/Written answers first (`isEarlyClass` on the
  paper's class name from the document header). "Used in this paper" on top; search over names and hints. Structure
  picks several at once (tap = one more, "Add N rows"); Fill's "+ Add question" picks one. Web `TypePicker.jsx`,
  phone `TypePickerSheet.tsx`, shared `pickerGroups`. Browser-checked on Play Group (activities first) and Class 1
  (written first) papers; the add button stays pinned at the top of the picker.

### Phone checklist (APK)
1. New paper: Setup -> Next: Structure. Tap "Play Group: Mathematics": 9 cards, "50 of 50". Change a Parts and a Marks
   box (the number stays while typing), Remove a card, add one with "+ Add row".
2. "Make the questions": the Fill step opens on the Paper tab, the preview scrolled to the first question to fill.
3. Tap another question on the paper: the docked form below switches to it and the paper highlights it.
4. Type in the docked form: the paper redraws in place (stays on that question). "Next to fill (N left)" jumps on.
5. Share PDF / Print / Word before everything is filled: "Not printed yet" lists what is left; no crash.
6. Questions tab: unfinished questions grey with an amber dot and "(still to fill)"; "Change the structure" opens the
   rows with "in the paper"; removing a written question asks first.
7. Setup -> Status Ready on a half-written paper: refused with "Some questions are still to fill."
8. Structure "+ Add questions" on a Play Group paper: Writing / Numbers / Pictures / Oral come first; tap Count and
   write twice (×2), "−" takes one back, "Add N rows" adds them. On a Class 1 paper Quick answers come first.
9. Fill "+ Add question": one tap adds the question and closes the sheet; search "match" shows both match types.
