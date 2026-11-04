# Paper Builder: mobile and web parity plan

Status: DRAFT, revised 2026-11-03 after the user's answers. Nothing in Part 2 is built yet.
Decisions (user): full rich-editor parity; several blanks per fill-in-the-blank question; matching and diagrams included on mobile.

## Goal
The same inputs on web and mobile produce the same saved paper (same structure, same questions in the same order, same HTML text, same `type_data`, same marks), so the server-made PDF is identical. Either app can open and edit a paper the other created.

## Facts that shape the plan
- Web is a 3-step wizard: Paper Setup (has **Total Marks**) -> Paper Structure -> Add Questions (per section, per slot).
- Web question text is **HTML** from a Tiptap editor: StarterKit, subscript, superscript, tables, KaTeX math (`$x^2$`), and a language wrapper `<div dir lang class>` for RTL (Urdu). Mobile sends plain text today.
- Diagrams: question body, options A-D and the answer can each carry an image. Upload is question-scoped (`POST /questions/{id}/diagram/`), so web first creates the bank question, then uploads.
- Fill in the blank: web stores `type_data.items` and `type_data.accepted_answers` (one entry per blank). Mobile sends one `correct` value.
- Matching: web stores `type_data.pairs`. Mobile cannot create it inside a paper.
- Sources on web: type manually, bank / lesson plans (per section), capture from image. Mobile has bank, new question, capture from photos, but no per-section filling.

## Part 2 phases (each phase ends with the shared-contract tests green)

### Phase 0: contract and tests first (no UI)
- Write `docs/paper-contract/` JSON fixtures: setup + structure + questions of every type (MCQ, short, long, essay, true/false, fill with 1 and 3 blanks, matching, HTML with sub/sup/table/math, Urdu RTL wrapper, diagram urls) -> expected `ensure` and `autosave` payloads.
- Run the same fixtures through the web builders (vitest) and the mobile builders (jest). Any difference fails CI.
- Output: the list of every field where the two apps differ today.

**Phase 0 DONE 2026-11-03.** Built: `frontend/src/pages/examinations/paperPayload.js` (web builders pulled out of the page, behaviour unchanged), `docs/paper-contract/fixtures.json` (6 papers: fill+MCQ, several blanks, matching, choice section + divider, rich HTML / Urdu, no structure), web test `paperPayload.contract.test.js` (7 pass) and mobile test `mobile/__tests__/paperContract.test.ts` (passes while `KNOWN_GAPS` lists exactly the differences below).
Differences found (mobile vs web), each owned by a phase:
- G1 `marks_override`: web always sends the question's marks; mobile sends null unless changed. (Phase 1)
- G2 fill in the blank: web sends `type_data.items` + `accepted_answers` and leaves `answer_text` empty; mobile mirrors the answer into `answer_text` and has no `items`; one blank only. (Phase 3)
- G3 true/false: web saves `true`/`false`, mobile `TRUE`/`FALSE`. Pick the server's canonical form. (Phase 1)
- G4 `total_marks`: web sends the typed Total Marks, mobile the computed sum. (Phase 1)
- **W1 web bug (not mobile):** the web paper composer builds matching as text pairs `{left, right}` with no `left_items` / `right_items`. The server rejects that (verified on the real serializer: "MATCHING requires type_data.left_items"), while mobile's index format is accepted. The fixture uses the server's format. Web needs a fix in Phase 3 (convert on save, or edit with the index format). Needs the user's go-ahead before touching web behaviour.
- Mobile sends only references (`question_id`) and creates each bank question first; web sends full question objects in `manual_questions`. Both are accepted by the server; Phase 2 moves mobile to the web's single payload so diagrams and slot order work the same.

### Phase 1: same flow (wizard)  -- DONE 2026-11-03
Built: mobile screen is Setup -> Structure -> Add Questions (step bar, Back / Next, a saved paper opens at step 3, Setup validated before Next); new Total Marks field (default 100) feeds Standard layout, the structure summary and the marks-mismatch confirm; payload now matches web for `total_marks` (typed), `instructions` (untrimmed) and `marks_override` (always a number). Contract gaps G1, G3, G4 closed (only G2 left). Verified in the recorder: a 3-step run saved a paper with Total Marks 7.
- W2 web inconsistency found: the web paper composer saves true/false as `true`/`false`, the question bank, mobile and the server's own message use `TRUE`/`FALSE`. Canonical = uppercase; the web composer should emit uppercase (web change, needs go-ahead).
- Mobile screen becomes 3 steps with Back / Next: Setup (add Total Marks, same default 100) -> Structure (existing `SectionsEditor`, now its own step; keep Standard layout) -> Add Questions.
- Resume a draft at step 3, as web does. Keep the marks-mismatch confirm.

### Phase 2: slot-based Add Questions  -- DONE 2026-11-03
Built: step 3 shows one block per section ("Question # 1 - Fill in the blank", "1 mark each - 3 of 5 - attempt any N") with its questions, "+ Write" and "+ From bank"; dividers print as headings; questions outside any section sit under "Not in a section"; with no structure the old free-add buttons remain. The question sheet opens with the section's type and marks fixed (no type chips, no Marks field), "Add and write another" keeps filling the section and the sheet closes on the last slot; the bank picker is pre-filtered to the section's type and topics and shows slots left. A question takes the section's marks (as web slots do); a full section hides the add buttons; move up/down works within a section. Verified by a recorder rehearsal (no video): two sections, 5 fill + 5 MCQ written slot by slot, saved as 10 marks with every question in its section.
Deviation from the draft: mobile still creates each bank question when it is added and sends references, not the web's single payload with full question objects. That move is needed for diagrams (Phase 5), so it waits for Phase 4/5. Matching sections show "+ From bank" only until Phase 3 adds the matching composer.
- Each section shows its slots ("Q1 - MCQ - 1 mark - 3 of 10"). Each slot has "+ Write" and "+ From bank" (bank pre-filtered to the section type and topics, like web `BankFillSource`).
- The question sheet opens with the section's type and marks fixed from the structure (no type picker needed there). "Add and write another" (already built) moves to the next free slot.
- Unassigned questions stay possible when the paper has no structure (web: "add questions freely").

### Phase 3: fill-in-the-blank with several blanks, matching  -- DONE 2026-11-03
Built: `BlankFields` (one input per blank, "+ Add blank", remove) and `MatchingFields` (the matching editor that lived inside the question bank screen, now shared) used by both the question bank sheet and the paper's question sheet; matching sections now have "+ Write" too. Fill saves as web does: `type_data.items` + `accepted_answers`, `correct_answer` and `answer_text` empty. Contract gap G2 closed: `KNOWN_GAPS` is empty, so mobile and web now send identical payloads for all six fixtures. Verified by a rehearsal (no video): a 3-blank fill question and a 2-pair matching question written into sections and saved (6 marks).
- **Bug fixed on the way:** the mobile paper sheet and the question bank screen bound the fill-in answer box to `correct`, but the payload read `answer`, so fill-in-the-blank answers were silently saved empty (`accepted_answers: []`). Questions already saved that way have no answers and need re-entering.
- Fill semantics changed from "alternative accepted answers in one comma-separated box" to the web's "one entry per blank". Old questions that only have `accepted_answers` open as blanks.
- Matching keeps the server's stricter rule (two or more left, right and pairs); web's composer is still W1 (text pairs the server rejects).
- Matching partner pickers have no visible label (screen readers hear "Select: No partner"); worth labelling in Phase 6.

### Phase 3 (original text)
- Fill: one input per blank, "Add blank" / remove, saved as `items` + `accepted_answers`, same as web.
- Matching: pair rows (left, right), at least one complete pair, saved as `pairs`.
- Validation messages copied from web so both reject the same input.

### Phase 4: rich editor -- BUILT 2026-11-03 (Option A); device pass still owed
Built:
- `frontend/src/components/richEditorCore.js`: the one definition of the question-text editor (extensions, language wrapper, toolbar commands). Web `RichTextEditor.jsx` and `RTLWrapper.jsx` now import it (behaviour unchanged; web component tests 170 pass).
- `frontend/src/components/richEditorEntry.js` + `scripts/build-rich-editor.mjs` -> generated `mobile/assets/richEditorHtml.ts` (633 KB page: editor + KaTeX styles, no KaTeX fonts). Rebuild with `node scripts/build-rich-editor.mjs` after editing richEditorCore.js; `--check` fails when it is stale, and the web test `richEditorBundle.test.js` runs that check.
- Mobile: `services/richText.ts` (wrapper, plain-text and blank helpers, message protocol) and `components/content/RichTextField.tsx` (WebView on device, iframe on Expo web, scrollable toolbar: undo, redo, B, I, S, sub, sup, H1, H2, lists, table (+col, +row, delete), equation, clear; language picker; auto-height 140-360). Used for the Question field in the paper's question sheet and the question bank sheet.
- Question lists (paper builder, bank, worksheet picker, manager summary) now show `plainText(...)`: web-written questions already carry HTML and mobile used to show the tags.
Verified: web `richEditorCore.test.js` (12 HTML cases + wrapper), `richEditorBundle.test.js` (the built page, run in jsdom with the app's messages, writes web's HTML for all 12 cases, switches language, runs toolbar commands, reports blank), mobile `richText.test.ts`, and live on Expo web: typed text, subscript/superscript from the toolbar, switched to Urdu, added the question; the saved text is `<div dir="rtl" lang="ur" class="font-rtl"><p>Water is H<sub>2</sub>O and area is x<sup>2</sup></p></div>`. Mobile 1399 tests, web components 170 tests pass.
Not verified (needs a phone): Android/iOS keyboard and IME composition, Urdu typing, caret and scrolling inside the sheet, keyboard covering the editor, paste, WebView load time of a 633 KB page, toolbar focus behaviour. Do a device pass before relying on it.
Left for later: KaTeX fonts (+260 KB) if equations should look exact; web toolbar still has its own button code (only the editor definition is shared); diagrams in the editor body (Phase 5); options and answer stay plain fields, as on web.

#### Phase 4 spike result (2026-11-03): recommend Option A
Spike files: `docs/paper-contract/editor-spike/` (12 HTML cases, the bundle entry, headless runners). Measured in jsdom, no device.
| | A: Tiptap in a WebView/iframe, built from web's own packages | B: `@10play/tentap-editor` 1.1.0 |
|---|---|---|
| Engine version | web's Tiptap 2.27.2 + math ext 1.3.6 | Tiptap **3.11** (web is on 2.27) |
| HTML vs web on 12 cases | **12 / 12 identical** (minified bundle run in a plain page) | default set: **5 of 12 differ**: sub/sup, table and math are stripped (`H2O`, `AB12`), links gain `target`/`rel`, underline is kept where web drops it |
| After adding sub/sup/table | n/a | those two match web again; math needs `tiptap-math-extension` 1.4 (v3) and web is on 1.3.6; underline/link still differ |
| Size | bundle 625 KB (185 KB gzip); KaTeX preview CSS 24 KB + fonts 260 KB optional | package 5 MB unpacked, plus a custom editor build for the extra extensions |
| Extra moving parts | one build script | its bridge, its custom-editor build step, and a v2/v3 version split with web |
Why A: B ends up as A (custom bundle) plus a version split. The web editor is thin (StarterKit, sub, sup, table, math, and a plain-string language wrapper), so sharing one extension list gives identical HTML by construction.
Findings: (1) web's editor already drops underline and links on load (no extension), so a v3 editor would change stored content; (2) the language wrapper `unwrapLanguage`/`wrapLanguage` is pure and portable; (3) Expo web (our test path) cannot host a WebView, but the bundle is one HTML page, so an `<iframe srcDoc>` with the same message protocol covers it.
Not testable here (needs a phone): Android keyboard and IME composition, Urdu typing in a WebView, caret and scroll behaviour inside a ScrollView, keyboard covering the editor, paste. Budget a device pass before calling the editor done.
Implementation plan: (1) move web's extension list and the wrap/unwrap functions into one shared module imported by web `RichTextEditor` and the bundle entry (drift becomes impossible); (2) build script -> `mobile/assets/richEditor.html` with a sync check in CI; (3) `RichTextField` component: WebView on device, iframe on web, native toolbar (bold, italic, strike, lists, heading, quote, sub, sup, table, equation, language/direction) sending commands, auto-height, value in/out as wrapped HTML; (4) use it for question text, options and answer; (5) HTML fixtures added to the contract (web vitest and a jsdom run of the bundle); (6) decide math preview: raw `$x^2$` (free) or KaTeX CSS and fonts (+284 KB); (7) later, upgrade web and mobile together to Tiptap 3 + math 1.4 if wanted. Estimate 3-4 days plus the device pass.
- Target: byte-compatible HTML with web, including the language wrapper, so a paper edited on either app prints the same.
- Approach to decide in a 2-day spike: (A) Tiptap running in a WebView (`react-native-webview` is already a dependency) with the same extensions as web, ideally the same bundle; (B) `@10play/tentap-editor`. Judge on: output HTML identical to web for the Phase 0 fixtures, Urdu RTL typing, Android keyboard behaviour, bundle size.
- Toolbar parity: bold, italic, lists, sub/sup, table, equation, language/direction toggle.
- Expo web (our test path) cannot host a WebView, so the web build needs an iframe fallback. Recording videos of this editor needs that fallback.

### Phase 5: diagrams -- BUILT 2026-11-03; upload to real storage and the device pass still owed
Built:
- Web: `frontend/src/components/diagramDraw.js` now holds the canvas primitives (size 860x540, colours, weights, tool ids, `drawAction`, `redraw`) and `DiagramCanvas.jsx` imports them (behaviour unchanged). `diagramEntry.js` is the drawing page for the phone; `scripts/build-rich-editor.mjs` now builds both pages (`richEditorHtml.ts`, `diagramPadHtml.ts`, 4 KB) and `--check` covers both.
- Mobile: `DiagramPad` (full-screen sheet: nine tools as on web, 4 colours, 3 weights, undo/redo/clear, text label, "Use drawing"), `QuestionPictures` (question, options A-D on multiple choice, model answer; thumbnail preview, Gallery, Camera on devices, Draw, Remove), `services/diagrams.ts` (helpers, picture file for upload, tool constants pinned to web). Used in the paper's question sheet and in the question bank sheet (replacing its older picture block).
- Create-on-first-attach, as web: attaching a picture to a question that is still being written first saves it to the bank (it must pass the normal checks), uploads to `POST /questions/{id}/diagram/`; "Add to paper" then updates that same question instead of creating a second one. A question abandoned after a picture stays in the bank, as on web.
Verified: web `diagramPad.test.js` (8: tools, colours, undo/redo/clear, text label, PNG export, ignores bad input), bundle sync test, mobile `diagrams.test.ts`, mobile 1408 tests. Live on Expo web: wrote a question, drew a triangle on the pad, "Use drawing" saved the question (id 104), exported the PNG and posted the multipart upload; "Add to paper" updated the same row (one question, no duplicate).
Not verified: the file actually landing in storage (the scratch backend has no Supabase, so the server answered 500 "Supabase storage not configured", which the app shows as the error), and everything that needs a phone: Camera, gallery on iOS/Android, saving the drawing as a temporary PNG (expo-file-system), pointer drawing with a finger or stylus on the WebView canvas, the pad's layout on small screens. Do both before relying on it.
Left: the web composer's own "Import" tab (paste or drop an image) has no phone equivalent beyond Gallery and Camera; question lists show a thumbnail only inside the editor sheets.

### Phase 5 (original text)
- Body, options A-D and answer: pick from gallery or camera, upload through the same question-scoped endpoint (create-on-first-attach, as web does), remove, preview.
- Drawing a figure (web `DiagramCanvas`): same spike as Phase 4 (WebView canvas vs a native canvas library).

### Phase 6: remaining gaps -- DONE 2026-11-03 (audit + the real gaps)
Audit of web step 3 and the paper actions against mobile. Already equal: per-section bank filling (type + topics from the chosen lesson plans, Phase 2), difficulty and thinking level per question (question sheet), capture from photos, coverage panel, PDF share, status values.
Built:
- Marks mismatch prompt when moving Structure -> Add Questions ("Allocated marks (X) don't match the paper's total marks (Y). Continue to Add Questions anyway?", advisory, same wording as web). Deviation: with no sections nothing is compared (web would warn "0 of Y"). Also asked when jumping to step 3 from the step bar.
- "Used in N papers already" warning from the third paper on, on bank picker rows and on questions in the paper (bank counts for new picks, the paper's `overused_questions` for a saved paper), matching web's `paper_use_count` rule.
- Screen-reader labels for unlabelled pickers: matching partner ("Partner of left item 2: Water") and the section picker on each question.
- `confirm()` now falls back to the page's confirm box on Expo web: react-native-web's `Alert.alert` does nothing, so every confirm-guarded step (marks mismatch, delete, save anyway) stalled in the browser preview. Phones were never affected.
Not built on purpose: web's "Change source" chooser (Type manually / bank / image). Mobile shows Write, From bank and Capture as buttons on every section, same function with one fewer step.
**Open policy difference (needs a decision):** web opens any paper that is not a DRAFT read-only and has no status control in the builder at all; mobile's builder has a Status picker (Draft, Ready, Published) and lets a published paper be edited by silently putting it back to draft and restoring the status on save. Options: (a) keep mobile as is (a superset), (b) match web: lock non-drafts, with an explicit "Reopen as draft" button, and move the Status picker out of the builder.
**Still open from earlier phases:** W1 web matching sends text pairs the server rejects; W2 web composer saves true/false in lowercase.

### Phase 6 (original text)
- Per-section bank filling and lesson-plan narrowing, difficulty and thinking level per question, "Change source" parity, status / publish / PDF share, coverage panel (already on both).

### Phase 7: verification
- Round trip: build a paper on web, open and edit on mobile, and the reverse; compare the saved JSON and the generated PDF text.
- Update the web and mobile guide videos and guide text for the new flow.

## Risks and decisions still open
- Phase 4 is the schedule risk; the spike result decides whether full parity is one phase or a project.
- Drawing diagrams natively may need a new APK (native dependency); WebView-only keeps it within current builds.
- No schema changes are planned. If the contract fixtures show the server needs one, it comes back for sign-off first.
- Old APKs keep working: new fields are additive and the server already accepts them.


## Web fixes and quirks corrected (2026-11-03, after Phase 6)
- **W1 fixed (web matching):** the paper composer still edits matching as text pairs but saves, and promotes to the bank, in the server's shape (`left_items`, `right_items`, index `pairs`). Reopening a saved question converts it back to text pairs and keeps unmatched items (a distractor on the right) so saving never drops them. The composer now asks for two complete pairs, the server's rule. Code: `matchingData.js` (+5 tests) and `QuestionSlotEditor.jsx` (+5 component tests that drive the real composer).
- **W2 fixed (web true/false):** the composer shows True / False but saves `TRUE` / `FALSE`; older lowercase drafts are read and saved uppercase.
- **Quirk: marks warning with no sections (web):** the "Marks mismatch" prompt no longer fires on free-form papers (`marksMismatch()` in `paperPayload.js`, 3 tests).
- **Quirk: paper status policy (mobile):** matches web: only a draft can be edited. A ready or published paper opens locked (banner, editing disabled, Share PDF still works) with an explicit "Reopen as draft" button, instead of being silently put back to draft and restored on save. The Status picker stays for drafts (set Ready or Published when saving), as a superset of web.
- **Quirk: editor drops underline and links (web, shared with mobile):** the editor now has Underline and Link extensions (links are not created while typing or pasting and a click does not follow them), so they survive loading. Web and mobile toolbars gained an Underline button. Packages added: `@tiptap/extension-underline`, `@tiptap/extension-link` (2.27.x). Editor page rebuilt (660 KB); rich-html fixtures now have 13 cases.
- **Quirk: old failing web tests:** 37 tests failed in `src/pages/examinations`. The shared test helper now mounts the Toast provider (falls back for tests that mock the Toast module): AIBadge, BloomChart, BloomLevel pass again. ExamWizard's 19 failures were a stale test, not a bug: the wizard lists session classes in a year with sections (labels `<display_name> - <section>`, payload keyed by `session_class_id`); the mocks and assertions now follow that.
- **Still failing, not part of this work:** across the 62 web test files that use the shared helper, 42 tests fail in 15 files (StudentsPage.crud, the three face-attendance pages, FeeCollectionPage, DiscountsPage, LeaveManagementPage and others). Checked A/B against the original helper: the helper change fixes 22 tests (64 failed before, 42 after) and breaks none. These need their own pass.
