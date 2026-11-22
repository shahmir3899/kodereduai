# Paper Builder demo video: how it was made, and how to re-record it the new way

## How the earlier video was made (2026-11-17/18)

**Goal.** Rebuild the user's sample paper "2nd Term Paper - Play Group Math" (9 questions, 50 marks) in the web
Paper Builder from an empty page, on camera, and note bugs and slow steps on the way.

**Tool.** The `web-demo-video` skill (`~/.claude/skills/web-demo-video`): a scenario JSON file lists the steps; the
skill drives a real Chrome page with a moving cursor, real typing, captions, a heading slide, voice-over (Microsoft
"Aria" online voice, approved by the user each time the text changed) and calm music, then makes the MP4, captions
(.srt/.vtt), a poster and a quality report.

**Safe data.** Only the scratch servers: web on 3100, backend on 8100 with SQLite (started by
`docs/media/_authoring/preflight.sh`; services like Supabase and Groq are blanked). The seed
`docs/media/_authoring/seed_paper_demo.py` (run before every take) makes a "Play Group" class with one subject
(Mathematics) for the teacher `SEED_TEST_staff_teacher1`, deletes earlier Play Group papers, stores the colouring
picture (tree with two children, `backend/examinations/paper_blocks/samples/pictures/tree_scene.png`) as one of the
school's own pictures, and renames scratch school 1 to "THE FOCUS MONTESSORI & SCHOOL" for the paper header (put back
to `SEED_TEST_School_Alpha` afterwards).

**Scenario.** `docs/media/_authoring/paper-builder-pg-math.json` (the first, slower version is kept as
`paper-builder-pg-math.v1.json`). 17 steps: open Paper Builder, Setup (class Play Group, title "2nd Term Examination
2026-27"), Build Paper, then each question added with "+ Add question" and filled in its form, pictures chosen by
typing a name and pressing Enter, the tree from "My pictures", then "Full size" preview and the Print / Answer key /
Word buttons.

**Recording.** 1920x1080 (`--preset hd`), English only, `--voice edge --allow-online-tts`, `--music calm`. Each take
took about 25 minutes. Before the take, a short test of the risky steps ran and the saved paper was checked in the
scratch database (title, 50 marks, the five count-and-write rows, match dots on); the take only started if that check
passed. Afterwards the saved paper was checked again and two or three frames were looked at.

**Result.** `docs/media/paper-demo/paper-builder-pg-math.en.mp4` (9:22 after the fixes; the first takes were 11:21
and showed bugs). Findings and fixes: `docs/PAPER_BUILDER_DEMO_FINDINGS.md`.

**Traps learned.**
- `demo rehearse` of the whole scenario can freeze right after "Count and write" is added (the tool, not the app);
  full recordings pass. Test with `--only <step ids>` instead, then check the database.
- The scratch web server dies between turns: run preflight, test, check and record in ONE background command.
- Scratch has no file storage, so "Browse" uploads fail; that is why the seed stores the tree picture itself.
- Any narration change needs the user's approval again before it is sent to the Microsoft voice.

## The paper (what must be on screen and saved at the end)

Header: school name, "2nd Term Examination 2026-27", Paper: Mathematics, Class: Play Group, Name / Roll No / Date,
"For office use" marks table, Teacher's Sign. Time and total marks line OFF.

| Q | Kind | Heading (as typed in the last video) | Content | Marks |
|---|---|---|---|---|
| 1 | Writing grid | Write counting from 1 to 20? | 4 rows x 5 | 10 |
| 2 | Missing numbers (clouds, 4 per row) | Write missing numbers? | 1, _, 3, _, 5, _, 7, _, 9, _ | 5 |
| 3 | Count and write | Count and write? | butterfly 3, flower 2, pencil 4, apple 1, star 5 | 5 |
| 4 | Compare: big and small | Circle the small object? | fish | 4 |
| 5 | Find and colour | Search the number ‘4’ & colour it? | find 4 in: 4 5 2 4 3 3 2 4 5 4 | 4 |
| 6 | Compare: long and short | Colour the long object? | (pencils, drawn by the app) | 4 |
| 7 | Colour the picture | Colour the pictures? | "Tree with children" from My pictures, dashed frame | 5 |
| 8 | Match the columns, dots on | Match the shapes? | round sign, window, party hat, door, star -> square, triangle, circle, star, rectangle | 5 |
| 9 | Oral | Oral | Counting 1 to 20 (4), Shapes names (2), Colours names (2) | 8 |

Total 50. The Structure template "Play Group: Mathematics" is made from this same paper (backend
`paper_blocks/samples/play_group_math.json`), so it already gives these 9 kinds in this order with these marks, the
parts (10 clouds, 5 count rows, 10 circles, 5 match rows, 3 oral parts), Long and short on Q6 and the dashed frame on
Q7: "50 of 50" with no row changes. The original PDF is `C:\Users\hp\Downloads\2nd Term Paper - Play Group Math (9)_261113_104316.pdf`.

---

## Prompt for the new session (paste everything below)

Re-record the Paper Builder demo video of the Play Group Math paper, using the NEW way of building a paper.

Read first, in this order, and nothing else in full:
1. `docs/PAPER_BUILDER_DEMO_RERECORD_PROMPT.md` (how the last video was made, the paper table, the traps).
2. `docs/PAPER_BUILDER_STRUCTURE_PLAN.md` (the new Setup -> Structure -> Fill questions wizard, templates,
   "still to fill", the preview that scrolls to and selects questions, the grouped question type picker; read its
   Status section, not the whole history).
3. The "Status" sections of `docs/PAPER_BUILDER_DEMO_FINDINGS.md` (count 1 to N helper, typed picture names, last
   marks reused).
4. The `web-demo-video` skill, especially its "Keep it cheap" section and the `--only` option.

What the video should show (the new way). The wizard steps are "1. Paper Setup", "2. Structure", "3. Fill questions".
1. Paper Setup: choose class Play Group (Mathematics fills itself in), type the title "2nd Term Examination 2026-27",
   press "Next: Structure". The paper is created at this point, so the seed must have deleted earlier Play Group
   papers (otherwise "Copy from a paper…" also shows up; it is fine to leave it unused).
2. Structure: press the "Play Group: Mathematics" template. The table fills with the 9 rows, "Total marks" becomes 50
   by itself and the status reads "50 of 50". Pause on it so the viewer can read the rows (kinds, parts, Long and short on Q6,
   marks). Do not open "+ Add questions" here unless a row is wrong. Press "Make the questions".
3. Fill questions opens with all 9 questions made, the outline showing "4 still to fill" (Q3 Count and write, Q5 Find
   and colour, Q7 Colour the picture and Q9 Oral have empty required parts), dashed "still to fill" frames on the
   preview, and the preview scrolled to the selected question. The other five questions are complete as made (only
   their headings and contents still need the paper's text), so "Next to fill" alone does NOT visit every question:
   go Q1 to Q9 in order by clicking each one in the Questions outline, and use "Next to fill" once or twice where it
   is the next question anyway (it is good to show it, and the "N still to fill" count dropping).
   For each question: replace the generic heading with the one in the table (select all in "Question heading" and
   type; the heading is not pre-selected after "Make the questions"), marks are already right, then:
   - Q1 Writing grid: heading only (4 x 5 is the default).
   - Q2 Missing numbers: "Or count 1 to [10], leave a box empty every [2]" + Fill (replaces the 10 empty clouds).
   - Q3 Count and write: the 5 rows exist but have no pictures. Type "butterfly 3, flower 2, pencil 4, apple 1,
     star 5" in "Or type pictures" + Add: it replaces the 5 empty rows.
   - Q4 Compare big and small: choose the picture: type "fish" in the picker search and press Enter.
   - Q5 Find and colour: "Letter or number to find" 4, then "Or type them all" with "4 5 2 4 3 3 2 4 5 4" + Fill.
   - Q6 Long and short: heading only (the pencils are drawn by the app; the template set Long and short).
   - Q7 Colour the picture: Choose -> "My pictures" -> the tree. Frame is already Dashed.
   - Q8 Match the columns: left side "Or type pictures" with the five left names, right side with the five shapes
     (both replace the 5 empty rows), tick "Show dots to join". Use exact library names; check them in the
     browser first (unknown names stay in the box with "Not in the library").
   - Q9 Oral: type the three parts and their marks (4, 2, 2).
   Show once that clicking a question on the preview selects it in the outline and the form (the page itself does not
   jump). The outline should end with no "still to fill" bar.
4. Header switches in the Questions column: "For office use" marks table on, "Time and total marks line" off.
5. End on "Full size", then Print / Save as PDF, Answer key and Download Word (do not open the print dialog). These
   only work once nothing is still to fill; if one is left, the page shows "Not printed yet: fill these first" with
   the list, which must not happen in the take.

How to work:
1. Plan first: show me the new scenario's step list (ids, captions, narration) and wait for my approval. The
   narration goes to the Microsoft voice (en-US-AriaNeural); I must approve that exact text.
2. Learn the new labels by grepping the source (`frontend/src/pages/examinations/` and `blocks/`) and confirming a few in
   the browser pane on scratch; do not dump whole pages.
3. Write the new scenario as `docs/media/_authoring/paper-builder-pg-math-v3.json` (keep the old files). Reuse the
   seed `docs/media/_authoring/seed_paper_demo.py` in `setup.reset`; check first that the seed still works with the
   Structure step (after "Next: Structure" the new paper opens on Structure with an empty table and both Play Group
   templates; earlier Play Group papers deleted). The backend runs without auto-reload: restart 8100 (preflight) if
   server code changed since it started, or the templates and groups will be missing.
   Labels to target (check in the browser, do not guess): "Next: Structure", "Total marks" (Structure),
   "Play Group: Mathematics", "Make the questions", "Next to fill", "Question heading", "Marks",
   "Sequence ...: count up to" / "...: leave a box empty every" + "Fill", "Rows: picture names" + "Add",
   "Left column: picture names" / "Right column: picture names", "Show dots to join", "Full size".
   The preview is a scaled frame: the recording tool may not be able to click inside it (the browser pane tool could
   not). If a real click fails, show selection from the outline and say in the narration that a click on the paper
   does the same.
4. Write a one-command check of the saved paper in the scratch database that must match the table: title, 9 blocks in
   order, the 9 headings, marks 10/5/5/4/4/4/5/5/8 = 50, the missing-number and find-and-colour lists, the five count
   rows, Q4 fish, Q6 mode length, match pictures and dots, frame dashed, and nothing still to fill
   (`examinations.paper_blocks.registry.document_to_fill(paper.document) == []`). Because empty parts now save, a
   paper can be saved half-written: "saved" alone proves nothing, this last check does.
5. Test with `demo rehearse ... --only <new or changed step ids>`, run the check, and only if it passes start
   `demo record ... --lang en --preset hd --music calm --voice edge --allow-online-tts`. Run preflight + test + check +
   record + check again in ONE background command and wait for it to report; do not poll.
6. After the take: read the QA verdict, open the contact sheet once, look at 2-3 frames at most (the Structure
   step, a Fill moment, the Full size end). Fix and re-record only if something is wrong.
7. Put the scratch school name back to `SEED_TEST_School_Alpha`, send me the MP4 and say its length compared with the
   9:22 video. Write any new bug or slow step you notice into `docs/PAPER_BUILDER_DEMO_FINDINGS.md` (new dated section).

Rules: scratch servers only (3100/8100, SQLite); never ports 3000/8000, never migrations, never Supabase. English
only. No commits or pushes. Keep the scratch servers running at the end. Keep output short: print verdict lines from
logs, never whole files.
