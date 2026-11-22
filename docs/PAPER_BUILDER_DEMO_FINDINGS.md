# Paper Builder demo: findings (2026-11-17)

Found while rebuilding the user's sample paper ("2nd Term Paper - Play Group Math", 9 questions, 50 marks) in the web
Paper Builder on scratch (web 3100, backend 8100, SQLite) and recording the demo video. Most items are fixed (see
"Fix plan" and "Status" at the end); what is still open is listed in `docs/PAPER_BUILDER_DEMO_NEXT_SESSION.md`.

## Bugs / problems

0. **Clearing the paper title mixes the typed title into the automatic one (most serious).** In Setup, choosing the class
   and subject fills an automatic title ("Play Group - Mathematics"). If the teacher empties the box (select all +
   Backspace) to type their own, the automatic title comes straight back, and the cursor stays in the middle of it, so
   what they type lands inside it. Two recorded takes saved "Play Group - Mathem2nd Term Examination 2026-27atics" and
   "Play Group - Mathe2nd Term Examination 2026-27matics", which printed in the paper header. Selecting all and typing
   over the text works. This explains the earlier F5 report ("a typed paper title once did not stick"), which was
   closed as not a bug.
1. **Number boxes cannot be emptied (count, rows, columns, per row).** Clearing a required number box sets it to its minimum
   at once (`BlockForm.jsx` FieldInput, `int` case: empty -> `field.min`). Select-all + type "2" in "How many" gives "12",
   which is over the maximum of 7, so the paper stops saving and the preview says "Fix the problems listed". Only the
   arrow keys or typing over a selected digit work. The block Marks box shows the same effect as "04" / "08".
2. **A new question's form opens hidden under the top bar.** When the page is scrolled down (any paper with 3+ questions)
   and you add a question, the window stays scrolled, so the new block's "Question heading" and "Marks" are behind the
   sticky app header. The teacher has to scroll up to type the heading.
3. **The live preview is only about 400 px wide on a 1920 px screen.** The page is held to `max-w-6xl` (1152 px), and the
   preview shares that with the outline (16rem) and the form (26rem). The paper reflows to that width (the school name
   wraps onto two lines), so the preview does not look like the printed A4 page, and there is no full-size view in the app
   except the browser's print dialog.
4. **Every new list row is an error until it is filled.** "+ Add row" in Count and write adds a row with no picture; the
   server rejects the whole paper (autosave and preview both answer 400) until a picture is chosen, the question gets a red
   dot and the preview freezes on the last good version. Same for empty match-column parts. Expected while editing, but
   it looks like something broke.

5. **"The paper could not be opened." is a dead end.** If loading the paper fails once (seen when the web server dropped
   during a take), Build Paper shows only that red line: no retry button and no hint; the teacher has to reload the page.
6. **Old page subtitle.** "Create exam papers by uploading handwritten questions or typing manually" still describes the
   old builder; the new one is blocks, pictures, scan and question bank.
7. **Choice lists show raw words.** Compare shows "size"/"length", Frame shows "solid"/"dashed"/"none", Shape shows
   "cloud"/"train"/"box" in lower case straight from the registry, not friendly labels.

## Could be faster (fewer clicks)

1. **Missing numbers:** 10 clouds = 10 clicks on "+ Add" plus 5 clicks into boxes. One text box ("1, , 3, , 5, , 7, , 9, ")
   or a "Fill 1 to N, hide every 2nd" helper would be one step.
2. **Find and colour:** same pattern, 10 "+ Add" clicks and 10 boxes for one row of numbers. A single "4 5 2 4 3 3 2 4 5 4"
   box would do it.
3. **"+ Add" does not focus the new box**, so each value needs an extra click.
4. **Pictures:** one search per picture: 5 for Count and write and 10 for Match the columns (15 picker openings in this
   paper). Ideas: Enter picks the first match; type a few names at once ("butterfly, flower, pencil") to fill rows.
5. **Setup:** the class has a single subject (Mathematics) but it is not chosen automatically.
6. **Every new question starts at 5 marks with a generic heading** ("Write counting.", "Count and write."), so heading and
   marks are retyped every time. A Play Group starter (all nine usual activities, ready to edit) would save most of this paper.

## Notes for the demo tooling (not app bugs)

- Scratch has no Supabase storage, so "Browse" uploads fail there; the seed stores the tree picture as an embedded image
  (`docs/media/_authoring/seed_paper_demo.py`).
- The preview in a 1920 px window also squeezes the office-use marks table (the "Total" column is cut).
- The web-demo-video skill has an `upload` action that its scenario reference does not list.

## Fix plan (approved 2026-11-18: A + B, not B5) - BUILT 2026-11-18, uncommitted

Batch A, bugs (web; check the phone editor for the same problem in each step):
- A1 Title: the autosave reply refills an emptied title (`paper.paper_title || prev.paper_title` in
  `QuestionPaperBuilderPage.jsx` autosave onSuccess). Never refill from the reply; show the automatic title as the
  placeholder while the box is empty; a paper keeps its last saved title until a new one is typed.
- A2 Number boxes: keep what is typed (even empty) while focused; apply min/max and the default on blur. Marks box too.
- A3 New/selected question: scroll the form panel to it and put the cursor in "Question heading".
- A4 Preview: widen the Build Paper step and show the A4 page scaled to fit, so it matches the print; add "Full size".
- A5 Count and write "+ Add row": open the picture picker first and add the row only when a picture is chosen.
- A6 "The paper could not be opened": add a Try again button.
- A7 Subtitle text; A8 friendly labels for choice lists (registry `choice_labels`, read by web and phone).

Batch B, fewer clicks:
- B1 List boxes (missing numbers, find and colour, letters): "Type them all" box, e.g. `1, , 3, , 5`.
- B2 "+ Add" puts the cursor in the new box; Enter in a box adds the next one.
- B3 Picture picker: Enter picks the first match.
- B4 Setup: choose the subject automatically when the class has only one.
- B5 (needs the user's decision) A "Play Group starter": nine usual activities added in one click, ready to edit.

### Status (2026-11-18)
- Built: A1-A7, B1-B4 on the web; on the phone A5, A7, B1, B2, B3 (A2 was already fine there; A3/A4 are web layout).
- Tests: web blocks/__tests__ + SLOCoverage 55 pass (new: numberFromText, NumberBox, picker-first row, type them all,
  Enter adds next, A4Preview); backend test_paper_blocks 23 pass; mobile blockPaper 28 pass; mobile tsc clean for the
  touched files.
- Browser-checked on scratch (3100/8100, teacher, 1920 px): title clear + retype keeps the typed title (saved
  '2nd Term Examination 2026-27'); single subject picked by itself; preview column 847 px at full A4 width; new
  question gets the cursor in its heading; "type them all" filled 10 clouds; Enter picked "Flower" (not Flower pot);
  "+ Add row" opened the picker and added the row only after the pick, no 400; "Big and small / Long and short".
- Not checked: A6 Try again (needs a failed load), anything on a real phone.
- Follow-up 2026-11-18: Enter pressed in the picture search before the results caught up was lost; it is now
  remembered and done when they arrive (web + phone). Small cosmetic: the "Full size" window (5xl) is wider than the
  A4 page, so a grey strip shows on its right.
- New demo video recorded with the fixed builder (9:22, was 11:21): docs/media/paper-demo/paper-builder-pg-math.en.mp4.
  The old scenario is kept as docs/media/_authoring/paper-builder-pg-math.v1.json.

### Status (2026-11-22) - open items from the 2026-11-18 list, uncommitted
- A6 Try again: proved. Vitest `blocks/__tests__/BlockPaperEditor.test.jsx` (load fails once, then works). Browser
  check on scratch (backend 8100 stopped, uncached paper opened, backend started, Try again) found a gap: the block
  types list failed with the paper, Try again reloaded only the paper, and the editor stayed on "Opening the paper…"
  for ever. Fixed: the error box covers both and Try again reloads both (second test); a failed background reload no
  longer hides an open editor (`!doc`). Rechecked in the browser: Try again opens the paper.
- Full size window: now `4xl` and the page is centred in `A4Preview` (27 px grey each side, was one strip on the
  right). Phone untouched.
- Rehearsal freeze with Count and write: not the app. In the browser pane, 5 quick adds of Count and write, 4 quick
  "+ Add row" + picker picks and real-mouse adds: no long task over 150 ms, event-loop lag under 30 ms, all rows
  added. Opening the picker loads 71 thumbnails in about 250 ms. Most likely the rehearse tool waits on something
  (network quiet or a stable element) while the picker modal opens; worth a look in the web-demo-video skill if it
  happens again.
- Empty match-column parts: never flagged (text and picture are optional). Backend test
  `test_empty_match_column_parts_do_not_flag_the_paper`.
- Fill 1 to N (faster 1): "Or count 1 to [10], leave a box empty every [2]" + Fill under Missing numbers, web and
  phone. Shown only for fields with the registry flag `counting` (missing_sequence items). Rule `countingList` in
  blockDocument.js.
- Several pictures at once (faster 4): "Or type pictures: butterfly 3, flower 2" + Add under Count and write rows and
  each Match the columns side (web only). Exact names only (`picturesFromNames` in pictureRefs.js); unknown names stay
  in the box with "Not in the library: ..."; blank rows are replaced; a count is kept to 1-7; extra rows over the
  maximum are reported. Phone has the shared rules but no box yet.
- Smarter defaults (faster 6): a new question on a paper takes the marks of the last question of the same type (else
  5; worksheets still none). The generic heading is selected when the question is added from the menu on the web
  (typing replaces it) and selected on tap on the phone (`isDefaultTitle`).
- B5 Play Group starter: not built (user's decision 2026-11-22: skip).
- Tests: web blocks/__tests__ 61 pass; backend test_paper_blocks 24 pass; mobile blockPaper 30 pass; mobile tsc clean
  for touched files. Shared copy rebuilt (`node scripts/build-rich-editor.mjs`), `.d.ts` updated.
- New open finding: if the paper's details fail to load (server away), Paper Setup shows an empty form with no message
  (QuestionPaperBuilderPage, not the block editor). Not fixed.

#### Phone checklist (APK, not yet tried on a device)
1. A5 Count and write "+ Add row": the picture sheet opens first; the row is added only after a pick; closing the
   sheet adds nothing.
2. A7 subtitle / friendly labels: Compare shows "Big and small / Long and short"; Frame, Shape and Box show words, not
   raw values.
3. B1 Missing numbers / Find and colour: "Or type them all" + Fill turns `1, , 3, , 5` into five boxes (two empty).
4. B2 "+ Add" puts the cursor in the new box; the keyboard's next key moves to the next box and adds one at the end.
5. B3 picture sheet: type "flower" and press the keyboard's search/enter key: Flower is picked (not Flower pot).
6. Early Enter: type a name and press enter at once, before the results show: the picture is still picked.
7. New: Missing numbers "Count 1 to 10, a box empty every 2" + Fill gives 1, _, 3, _, ... 9, _.
8. New: add a question of a type already in the paper: its marks match the last one of that type; tapping the generic
   heading selects it so typing replaces it.
9. Load error: with the server away, opening a paper shows an error with Retry; after the server is back Retry opens
   it (if the block list also failed, a second Retry may be needed).
