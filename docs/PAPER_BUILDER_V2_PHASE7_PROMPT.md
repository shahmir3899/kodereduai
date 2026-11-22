# Session prompt: Paper Builder v2, Phase 7 (remove the old export and review screens)

Run this after the Phase 6 follow-up fixes (`PAPER_BUILDER_V2_NEXT_SESSION.md`) and Phase 6b (worksheets moved to
the block editor). Phase 7 removes code that worksheets still use today, so it must not start before 6b is done.

Paste this into a new session:

---

Continue Paper Builder v2 with Phase 7, the last phase: remove the old export and review screens, so that every paper
(old or new) opens in the block editor and prints from the block page, on the web and the phone. Read
`docs/PAPER_BUILDER_V2_PLAN.md` first, especially "User decisions", "Phases", "What stays safe", "Open items carried
forward", and the progress notes of Phases 3b, 4, 5, 6, "Phase 6 follow-up fixes" and 6b. Also read the memory notes
`paper-builder-v2`, `mobile-audit-workflow` and `mobile-finalisation-progress`, and `docs/MOBILE.md`.

First check the preconditions and stop if one fails (tell me which): Phase 6 follow-up fixes F1 to F5 are marked done
in the plan, and Phase 6b (worksheets in the block editor) is built. If 6b is not done, do not remove anything that
worksheets still use.

Where things stand: Phases 1-6 are built and uncommitted. Old papers (no `document`) open in the editor through the
converter (`paper_document.document_for_editor`) and are only rewritten as blocks when someone saves them. Migrations
`examinations/0040` and `0041` are not applied to Supabase. The working tree also has unrelated uncommitted work, so
never use `git add .`. What the old flow still has, as far as known (verify every item, the list may be incomplete):
- Server: `exam-papers/{id}/generate-pdf/` uses the ReportLab `ExamPaperPDFGenerator` for old papers (block papers get
  409); `worksheets/{id}/generate-pdf/` uses `WorksheetPDFGenerator`; the old answer key (`generate_answer_key`,
  ReportLab, old papers only); `paper_export_layout.py`; the old Word export for old papers; the old scan path
  (`upload-image` without `mode`, `paper_reconcile.py`, `paper_layout*.py`). `examinations/pdf_generator.py` also holds
  `DateSheetPDFGenerator` and `_load_logo_stream`, and `academics/pdf_generator.py` the timetable PDF: those stay.
- Web: `ManualEntryPaperTab`, `PaperStructureBuilder`, `QuestionSlotEditor` (no longer used by the paper page; check
  `QuestionBankPicker`, `WorksheetBuilderPage`, `paperPayload.js`, `paperCaptureLogic.js`), the old review inside
  `ImageCapturePaperTab` (non-block mode), `questionPaperApi.generatePDF`.
- Phone: the old capture (`PaperCaptureSheet`), the non-block review steps in `PaperPagesSheet`, `QuickQuestionSheet`,
  `SectionsEditor`, old helpers in `services/paperBuilder.ts`, `paperCapture.ts`, `paperPages.ts`, and the
  `generatePaperPdf` fallback in `PapersScreen`.

Task:
- Every paper prints from the block page: `generate-pdf` for an old paper either goes away (clients use `print-html`,
  which already converts old papers) or keeps answering for older app builds; propose which, with the deploy order.
- Old papers still open, preview, print (web and phone), give a Word file, and keep their marks entry, student
  responses and question bank links. Prove it on scratch with real old papers (made with the old builder before Phase 3,
  and a paper with an old diagram picture `{url}`).
- Answer key for block papers (open item since Phase 3a): plan it here, or say why it waits; the old ReportLab key
  must not be removed without a replacement or my OK.
- Then remove the dead code and its tests, and anything no longer reachable, on the server, web and phone. Check
  nothing else imports it (`grep`), and keep the API gap appendix in step (`python scripts/mobile_api_gap.py`).
- Update the plan doc (Phase 7 status, open items), `docs/MOBILE.md`, `docs/PHASE5_KNOWN_FAILURES.md` (tests that go
  away with the code) and the memory note.

Before writing code:
1. List everything the old flow still has (server endpoints, Python modules, web components, phone screens and
   services, tests), who still calls each one, and whether 6b removed the worksheet callers.
2. Give me a short plan: what is removed, what stays (and why), what replaces each removed path, the deploy order for
   server, web and the phone APK (an old APK may still call removed endpoints), the answer key, and the tests you will
   add or delete. Wait for my approval before removing anything.
3. Ask before sending any image to a real AI service.

Rules: test only against the scratch SQLite backend (8100; web 3100; start with
`bash docs/media/_authoring/preflight.sh`; never 8000/3000). For the phone screens in a browser: restart the scratch
backend with `CORS_ALLOWED_ORIGINS=http://localhost:8181` exported (after sourcing `scratch_env.sh`) and start Metro
web with the "mobile-scratch" entry in `.claude/launch.json` (port 8181); on-device testing is mine. Run only the paper
builder and the touched tests while building, plus `npx tsc --noEmit` (mobile) and
`node scripts/build-rich-editor.mjs --check`; run the full examinations suites once at the end. No videos. Show any
migration before it runs; dropping a column or table needs my explicit sign-off. No commits unless I ask.
