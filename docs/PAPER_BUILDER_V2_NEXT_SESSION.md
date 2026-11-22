# Next session prompt: Paper Builder v2, Phase 6 follow-up fixes

Paste this into a new session:

---

Continue Paper Builder v2: fix the issues found while testing Phase 6 (the block paper builder on the phone). Read
`docs/PAPER_BUILDER_V2_PLAN.md` first, especially "User decisions", "Open items carried forward", "Phase 6 progress"
and "Phase 6 follow-up fixes" (F1 to F5, each with what is known, what to debug first, the planned fix and the tests).
Also read the memory notes `paper-builder-v2`, `mobile-audit-workflow` and `mobile-finalisation-progress`, and the
Block paper builder section at the end of `docs/MOBILE.md`.

Where things stand: Phases 1-6 are built and uncommitted (block registry and renderers, 525-picture library, web block
editor, scan to blocks with Gemini + Groq Qwen fallback, Urdu papers, and since Phase 6 the phone editor in
`mobile/components/content/blocks/` with `services/blockPaper.ts`, `services/paperPrint.ts` and the shared copies in
`mobile/services/shared/` made by `node scripts/build-rich-editor.mjs`). Migrations `examinations/0040` and `0041` are
not applied to Supabase. The working tree also has unrelated uncommitted work, so never use `git add .`. Nothing in
Phase 6 has run on a real phone yet (that test is mine).

The issues, in short:
- F1: activity questions taken from the question bank come back as short-answer blocks with only the heading, on the
  web and the phone. The server already stores the block in `type_data.block`; the shared converter in
  `frontend/src/pages/examinations/blocks/blockDocument.js` ignores it. The phone currently hides ACTIVITY rows
  (`bankPickable`).
- F2: a link with a query (`/paper-builder?id=16`) loses the query when `mobile/components/nav/RoleGuard.tsx` bounces it
  to `/` with `next: pathname`; affects every deep link with params.
- F3: library pictures are broken in the editor preview on scratch (sandboxed frame, opaque origin, Chrome blocks
  `http://localhost`); decide between `preview?embed=1` (with a server cache) and a local-only switch after measuring.
- F4: the scratch teacher has no classes, so the teacher flow was not tested, and the phone Setup gives no message
  for an empty class list.
- F5: check once that a typed paper title is never replaced by the automatic title.

Task: debug each issue first (confirm the cause, not just the symptom), then fix it properly in the right place (shared
web file plus the regenerated phone copy for F1; the guard and index route for F2; the server and both editors for F3),
with tests, and re-run the teacher, admin and manager flows in the browser.

Before writing code:
1. Do the "debug first" steps of F1 to F5 and report what you found (including anything that changes the plan).
2. Give me a short plan per issue: the fix, the files, the tests, and any choice I need to make (F3 option a or b,
   F1 wording for activities that cannot be restored).
3. Ask before any write outside the scratch database, and before sending anything to a real AI service.

Rules: test only against the scratch SQLite backend (8100; web 3100; start with
`bash docs/media/_authoring/preflight.sh`; never 8000/3000). For the phone screens in a browser: restart the scratch
backend with `CORS_ALLOWED_ORIGINS=http://localhost:8181` exported (after sourcing `scratch_env.sh`) and start Metro web
with the "mobile-scratch" entry in `.claude/launch.json` (port 8181). Log in as `SEED_TEST_admin`, `SEED_TEST_manager`
or `SEED_TEST_teacher` (password from CLAUDE.md test accounts); scratch paper 15 is the Urdu test paper, 16 a small
English one. Writes to the scratch database (for example giving the scratch teacher a class) are fine; say what you
wrote. Run only the paper builder and the touched tests while building (`npx jest __tests__/blockPaper.test.ts` and the
suites you touch, `npx vitest run src/pages/examinations/blocks`, `python -m pytest examinations/test_paper_document.py
examinations/test_paper_pictures.py`), plus `npx tsc --noEmit` and `node scripts/build-rich-editor.mjs --check`.
No videos. Show any migration before it runs. No commits unless I ask. Update "Phase 6 follow-up fixes" in the plan
doc and the memory note as items finish.
