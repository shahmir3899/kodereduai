# Next session: Paper Builder demo findings, what is still open

Paste the prompt below into a new session.

---

Continue the Paper Builder demo findings work. Read `docs/PAPER_BUILDER_DEMO_FINDINGS.md` first (findings, the fix
plan A1-A7 / B1-B5, and the "Status" section). A1-A7 and B1-B4 are built (web + the phone parts), uncommitted, mixed
into the uncommitted Paper Builder v2 tree; do not redo them. This session covers only what is still open below.

Rules for this session:
- Plan first: show me a short plan and wait for my approval before any code change.
- Test only on the scratch servers (web 3100, backend 8100, SQLite; start them with
  `docs/media/_authoring/preflight.sh`). Never use ports 3000/8000 (they reach Supabase) and never run migrations.
- Run only the test files you touch (`frontend/src/pages/examinations/blocks/__tests__/`, `mobile/__tests__/blockPaper.test.ts`,
  `backend/examinations/test_paper_blocks.py`), not the full suites.
- No videos. Verify with tests and the browser pane (text readers, few screenshots).
- After changing `frontend/src/pages/examinations/blocks/blockDocument.js` or `pictureRefs.js`, run
  `node scripts/build-rich-editor.mjs` so the phone copy stays in step, and update `mobile/services/shared/*.d.ts`.
- Do not commit or push unless I ask. Never `git add .` (other unrelated work is uncommitted).
- Scratch login: SEED_TEST_staff_teacher1 (dev password in CLAUDE.md), `?subdomain=seed-test-alpha`. For a Play Group class
  with one subject and the tree picture, run `docs/media/_authoring/seed_paper_demo.py` with
  `DEMO_SCHOOL_NAME=SEED_TEST_School_Alpha` so the school is not renamed.

## Open items

Bugs / loose ends
1. **A6 "Try again" never seen working.** Prove it: a vitest test where the document load fails once and then succeeds
   (`blocks/BlockPaperEditor.jsx`), plus one browser check (stop the 8100 backend for a moment, open a paper, start it,
   press Try again).
2. **Full size window has a grey strip.** The "Full size" modal (`size="5xl"`, 1024 px) is wider than the A4 page (794 px).
   Size the window to the page (or centre the page) on web; keep phone untouched.
3. **Rehearsal freezes when "Count and write" is added.** Seen 4+ times, always right after adding Count and write (or
   its "+ Add row") in `demo rehearse`; full recordings pass. The page stops answering (no error, the tool waits for
   ever). Find out whether the app freezes (render loop, an effect without deps that sets state, `TextList`/`ListField`
   focus effects in `BlockForm.jsx`, the A3 scroll effect, the A4Preview ResizeObserver) or only the tool: reproduce by
   adding Count and write quickly several times in the browser pane and watch the CPU / console; fix if it is the app.
4. **Phone not tried on a device.** List what changed on the phone (A5, A7, B1, B2, B3, early-Enter) in a short checklist
   for me to test in the APK; no code unless the check finds a problem.
5. **Empty match-column parts.** Finding 4 also mentioned them; their text and picture are optional, so check they no
   longer flag the paper red. If they do, apply the A5 idea there too.

Could be faster (still open)
6. **"Fill 1 to N" helper for Missing numbers.** Next to "Type them all": numbers 1..N with every 2nd (or every k-th)
   left empty, in one step.
7. **Several pictures at once.** In Count and write and Match the columns, type a few names ("butterfly 3, flower 2,
   pencil 4") to fill the rows in one go, using the library's exact-name match (same rule as B3). Unknown names are
   listed, not guessed.
8. **Smarter defaults for a new question.** Every new block starts at 5 marks with a generic heading. Proposal to discuss:
   reuse the marks of the last question of the same type in this paper, and keep the generic heading selected so typing
   replaces it.
9. **B5 Play Group starter (my decision first).** Ask me before building: one click adds the nine usual Play Group
   activities (writing grid, missing numbers, count and write, big/small, find and colour, long/short, colour the
   picture, match, oral) ready to edit.

Finish by updating the "Status" section of `docs/PAPER_BUILDER_DEMO_FINDINGS.md` and the memory note
`paper-builder-demo-video`.
