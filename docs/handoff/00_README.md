# Aura handoff: read this first

Aura is the EducationAI assistant (backend `backend/assistant/`, web `frontend/src/components/assistant/`). This folder splits the
remaining work into small sessions so each one starts with a light context. **Do the sessions in order**; each file ends with a
paste-ready prompt.

| # | File | What it is |
|---|---|---|
| 1 | `01_FIX_SESSION.md` | Fix the 23 failures found by the baseline scan (the bug list is in that file) |
| 2 | `02_ROMAN_URDU.md` | Finish item 5: spelling-variant test and Roman Urdu fixes |
| 3 | `03_HARDENING.md` | Item 6: per-school flag, usage numbers, token caps, legacy Groq calls, allow-lists |
| 4 | `04_MOBILE.md` | Item 7: Aura and voice in the Expo app |
| 5 | `05_REAL_WORLD_CHECKS.md` | Item 8: checks only the owner can do |
| 6 | `06_LEARNING_FEATURE.md` | The "learning loop" feature (gap capture, insights page, weekly grouping). **BUILT 2026-11-09, uncommitted; see the status block in that file** |
| 7 | `07_FINAL_DOCS.md` | Final documentation update (plan doc, ENV_AND_DEPLOYMENT, memory) |
| 8 | `08_BACKLOG_FROM_PLAN.md` | Items the ORIGINAL plan promised that are still unbuilt (class-system audit, rollout and leakage tests, preferences, coverage matrix, finance / academics gaps, retiring old widgets, ...) with a prompt per item |

## State of the work (2026-11-08)

- **Agents built** (all uncommitted): Finance, Academics, Attendance, Parent Communication, Study Helper, Exams, HR (incl. payroll),
  Students & Admissions (incl. fees, class change), Operations (library, hostel, inventory, transport), Parents ("family").
  About 165 tools. Writes always go proposal -> preview card -> Approve; nothing is saved by the model.
- **Also built:** conversation list, tables in replies, streaming, voice (Whisper) and Talk mode on web, messaging to parents
  (in-app / push, admin only, daily cap), study extras (weak subjects, revision plan, quiz material), `class` vs `section` resolver.
- **Baseline:** 127 questions, last full run on school 37 with realistic seeded data: **104 pass, 23 fail** (`docs/ai_baseline_unified_state.json`,
  one entry per question with the reply and tool calls). Language split: English 75/87, Roman Urdu 29/40.
- **Learning feature (session 6): built 2026-11-09**, uncommitted (models `AgentGap` / `AgentGapGroup`, migration `0003_agentgap` applied on Supabase, insights page `/aura-insights`, weekly grouping + daily cleanup on Celery Beat).
- **Not done:** items 5 (rest), 7, 8, the final docs, and the extra items in `08_BACKLOG_FROM_PLAN.md` (checked against `docs/AI_AGENT_UPGRADE_PLAN.md`).
- **Decisions that changed since the plan was written:** payroll and payslips are now allowed (generate / approve / mark paid / delete drafts, each with a preview card); PRINCIPAL may see
  salary figures; staff, teachers and managers see only their own leave and payslip; students are created only by converting an enquiry (owner decision 2026-11-08: that is enough; no direct `create_student` tool); parents and students still get no writes.
- **Nothing is committed or pushed.** The working tree also holds unrelated mobile / leadership-insights / LMS work from before. A commit needs a
  per-file plan first (see "Commit groups" below).

## Rules that apply in EVERY session (from the owner's CLAUDE.md and memory)

1. **Plan first.** Write a short plan and get the owner's OK before any code change. No exceptions for "small" fixes.
2. **Never push, open a PR or commit without explicit approval in chat.** No `Co-Authored-By` trailer in commits. Show `git show` before a commit.
3. **Do not run the full test suites after each step.** Run only the new or touched test files (a full backend `assistant` run takes ~2 min and the owner
   finds it wasteful). Run everything once at the end of a whole group, or when asked.
4. **No secrets in chat, files or commits.** Keys live in `backend/.env` (`EDU_CEREBRAS_API_KEY`, `GROQ_API_KEY`, ...).
5. **The dev database is remote Supabase.** Read-only queries are fine. Any write needs the owner's OK. School 37 (`SEED_TEST_School_Alpha`) is the
   test school; it now holds the `BASE` seed data (see below). Never write to other schools.
6. **Do not create virtual environments.** Backend tests: from `backend/`, `python -m pytest assistant/tests/<file>.py -q -p no:cacheprovider`.
7. **Class vs section are two things** (master `Class` vs per-year `SessionClass`). Read `CLASS_SYSTEM_GUIDE.md` before touching class scoping.
8. Schema changes (new tables or columns) need explicit sign-off. The two tables for the learning feature are approved; nothing else is.
9. Replies and comments: explain WHY in code comments, not what. Keep answers short and plain.

## How the pieces fit

- `assistant/registry.py`: tool registry. A tool has a sub-agent, module, roles, kind (read / write). A write tool only PROPOSES (`handler`), then a
  person approves and `apply` calls the real DRF viewset as that user (`assistant/internal_api.py::call`). `revise` rebuilds the card after an edit.
- `assistant/router.py`: picks which sub-agent(s) a message needs (`AGENTS` descriptions are what the routing model reads). A sub-agent missing
  from `AGENTS` is never offered.
- `assistant/orchestrator.py`: system prompt, tool loop, streaming events. `assistant/llm.py` + `providers.py`: Cerebras (main) and Groq (fast) gateway.
- `assistant/skills/*.py`: tool packs. `lms_common.py` holds shared resolvers (`find_sections`, `match_names`, dates). `directory.py` has `find_student`,
  `find_class`, `class_key`.
- Frontend: `agentTheme.js` (colour per agent), `cardConfig.js` (how each card kind is drawn / edited), `ActionCard.jsx`, `useAssistant.js`.
- Per new agent the checklist is: register tools in `skills/__init__.py::load_all`, entry in `router.AGENTS`, `AGENT_LABELS` + `SUGGESTIONS` in
  `views.py`, a colour in `agentTheme.js`, card kinds in `cardConfig.js`, baseline questions, tests, tool-count test in `tests/test_router_and_ports.py`.

## The baseline (how to run and read it)

```bash
cd backend
python manage.py assistant_baseline --school-id 37 --mode unified --delay 30 --max-seconds 570        # one ~10-minute batch, resumable
python manage.py assistant_baseline --school-id 37 --mode unified --restart ...                          # start over
python manage.py assistant_baseline ... --questions <file.json>                                          # another question file (own state file)
```

- Questions: `backend/assistant/baseline/questions.json`. Scoring: `backend/assistant/baseline/scoring.py` (`tool`, `write`, `denied`, `blocked`,
  `accept` = other tools that are equally right, `clarify` = asking first is a correct answer).
- It calls the real model (Cerebras main, Groq router), rolls back every database write, and saves reply + tool calls per question.
- **Batches use ~0.9M Cerebras tokens for all 127** (daily limit 1M); run in ~10-minute batches (~17 questions each) so a dropped connection loses little.
- The command stops cleanly (without scoring) on a rate limit or a lost database connection, and each question runs in its own savepoint.
- The remote database drops connections now and then: just re-run the same command.

## Test school data (school 37)

`python manage.py seed_baseline_data --school-id 37 --part a|b|c` (idempotent, refuses non-test schools, accounts have no usable password) added:
a current year `BASE_2026-2027`, Classes 4-6 with sections A and B (150 students, many repeated names), 12 teachers, ~100 parent links, attendance up to
6 Nov, a published Mid Term with marks, a scheduled Final Term, fees with arrears and partials, payslips (none for November), expenses, inventory
(4 items low), library (3 overdue), hostel (4 pending gate passes), transport (30 riders), 15 enquiries. Tags: `BASE-` admission numbers / employee ids,
`base_` usernames, `BASE` names. Tests: `assistant/tests/test_seed_baseline_data.py`.

## Commit groups (for when the owner asks)

1. **Backend assistant**: `backend/assistant/**` (skills, tests, baseline, commands).
2. **App fixes found by Aura**: `backend/hr/models.py` (salary totals with decimal allowances).
3. **Frontend assistant**: `frontend/src/components/assistant/**`, `frontend/src/services/assistantApi.js`.
4. **Learning feature files** are inside groups 1 and 3 (backend: `gaps.py`, `redact.py`, `insights.py`, `grouping.py`, `tasks.py`, `skills/gaps.py`, `migrations/0003_agentgap.py`, 3 test files, 2 commands, edits to `models/registry/engine/orchestrator/views/urls/admin`; plus `backend/config/settings.py` Beat entries; frontend: `FeedbackThumbs.jsx`, `AuraInsightsPage.jsx`, `App.jsx`, `Layout.jsx`, `navigation/navigationConfig.js` and their tests).
5. **Docs**: `docs/AI_AGENT_UPGRADE_PLAN.md`, `docs/handoff/**`, baseline state files.
6. **Not Aura (leave out):** `mobile/**`, leadership insights, LMS lesson-plan view files, finance mobile screens.

Deploy order when allowed: push `kodereduai` main, then bump the submodule pointer in `D:/personal` (see memory `repo-layout-personal-gateway`).
