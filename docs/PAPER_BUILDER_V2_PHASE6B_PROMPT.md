# Session prompt: Paper Builder v2, Phase 6b (worksheets in the block editor)

Run this after the Phase 6 follow-up fixes (`PAPER_BUILDER_V2_NEXT_SESSION.md`) and before Phase 7
(`PAPER_BUILDER_V2_PHASE7_PROMPT.md`), which removes code worksheets use today.

Paste this into a new session:

---

Continue Paper Builder v2 with Phase 6b: worksheets move to the block editor (user decision 2026-11-15), on the web and
the phone. Read `docs/PAPER_BUILDER_V2_PLAN.md` first, especially "User decisions", "Design", "What stays safe",
"Open items carried forward", and the progress notes of Phases 3a, 3b, 4, 5, 6 and "Phase 6 follow-up fixes". Also read
the memory notes `paper-builder-v2`, `mobile-audit-workflow` and `mobile-finalisation-progress`, and `docs/MOBILE.md`
(the Worksheets and Block paper builder sections).

First check the precondition and stop if it fails (tell me): the Phase 6 follow-up fixes F1 to F5 are marked done in
the plan (F1 changes the shared bank-to-block converter that worksheets will use too).

Where things stand: Phases 1-6 are built and uncommitted. Papers are a block list (`ExamPaper.document`), saved through
`paper_document.py` (header from the paper, question bank sync, old-paper converter, `check_document`), rendered by
`paper_blocks/html_renderer.py` (page, printed on the device) and `docx_renderer.py` (Word), edited by the web
`frontend/src/pages/examinations/blocks/` editor and the phone `mobile/components/content/blocks/` editor (shared pure
helpers copied to `mobile/services/shared/` by `node scripts/build-rich-editor.mjs`). Migrations `examinations/0040` and
`0041` are not applied to Supabase. The working tree also has unrelated uncommitted work, so never use `git add .`.

Worksheets today (verify, the list may be incomplete): model `Worksheet` (class, subject, title, instructions,
`structure`, `render_options`, status, source, questions, tested topics) with `WorksheetItem` rows (question, order,
section, marks override) and `WorksheetUpload`; no `document` field. Endpoints under `worksheets/`: `ensure-draft`,
`autosave`, `duplicate`, `generate-pdf` (ReportLab `WorksheetPDFGenerator`), `generate-docx` (old Word export),
`upload-image` (old scan) and confirm. Web `WorksheetBuilderPage.jsx` (sections via `PaperStructureBuilder`, inline
items, bank picker, old photo scan). Phone `WorksheetBuilderScreen.tsx` (sections via `SectionsEditor`, plain-text
items, bank picker, Scan tab via the old `PaperCaptureSheet`), Worksheets list with Share PDF / Share Word, Duplicate,
Delete. Roles: admin, principal, teacher, manager (check `navigationConfig.js` and the server permissions).

Task: a teacher builds a worksheet with the same blocks as a paper (activity and text blocks, pictures from the
library / uploads / code-drawn, English or Urdu), from empty, from the question bank or from a photo (`mode=blocks`),
previews it, prints it from the block page (browser on the web, `expo-print` on the phone) and gets the Word file, on
the web and the phone. Old worksheets open converted and keep working until saved. Reuse the paper code rather than
copying it: one save/render path for both kinds where possible.

Before writing code:
1. Read the worksheet model, serializers, views, the web and phone worksheet screens and their tests, and anything
   else that uses worksheets (LMS assignments, student portal, reports: grep). Say what a worksheet needs that a paper
   does not and the reverse (header: name/date line but no exam or "for office use" table? marks optional? answer
   lines? status flow).
2. Give me a short plan: the database change (new `Worksheet.document` field only, shown before it runs; nothing
   dropped), how `paper_document.py` and the renderers take a worksheet (header differences), the endpoints
   (`document/`, `preview/`, `print-html/`, `autosave` with `document`, `generate-docx`, and what `generate-pdf` does
   for a block worksheet: 409 like papers?), question bank sync for worksheet items, the old-worksheet converter, the
   web page (reuse `BlockPaperEditor` with a kind prop?), the phone screen (reuse `components/content/blocks/`), the
   photo scan, what happens to the old worksheet code (it stays until Phase 7 removes it), the deploy order (server,
   web, APK), and the tests you will add. Wait for my approval.
3. Ask before sending any image to a real AI service (Gemini key and Groq Qwen are in `.env`).

Rules: test only against the scratch SQLite backend (8100; web 3100; start with
`bash docs/media/_authoring/preflight.sh`; never 8000/3000). For the phone screens in a browser: restart the scratch
backend with `CORS_ALLOWED_ORIGINS=http://localhost:8181` exported (after sourcing `scratch_env.sh`) and start Metro
web with the "mobile-scratch" entry in `.claude/launch.json` (port 8181); on-device testing is mine. Log in as
`SEED_TEST_admin`, `SEED_TEST_manager` or `SEED_TEST_teacher`. Writes to the scratch database are fine; say what you
wrote. Run only the paper builder, worksheet and touched tests while building, plus `npx tsc --noEmit` (mobile) and
`node scripts/build-rich-editor.mjs --check`. No videos. Show any migration before it runs, and never apply one to
Supabase (check the database engine first). No commits unless I ask. Update the plan doc (a "Phase 6b progress"
section and the Phases table), `docs/MOBILE.md` and the memory note as you go.
