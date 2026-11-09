# Session 7: final documentation update

Do this after sessions 1-6 (or after whichever of them the owner ran). The owner asked for the docs to be updated fully at the end.

## What to update

1. **`docs/AI_AGENT_UPGRADE_PLAN.md`**: replace the interim log (section 18) with the final state: every agent with its tools (name, kind, roles, notes), decisions, what is left out on
   purpose, the final baseline table (by agent, language, kind), the learning feature, hardening results, mobile status. Keep sections 1-17 accurate; mark superseded text.
2. **`docs/ENV_AND_DEPLOYMENT.md`**: every Aura environment variable with default and where it is set (Render vs local): `EDU_CEREBRAS_API_KEY`, `GROQ_API_KEY`, `EDU_LLM_CEREBRAS_ENABLED`,
   `EDU_GROQ_FAST_MODEL`, `EDU_VOICE_ENABLED`, voice limits, per-user caps (if added), the Groq project allow-list, `VITE_ASSISTANT_ENABLED`, Celery Beat tasks, migrations to apply.
3. **`docs/FRONTEND_COMPONENTS.md`** and **`docs/API_ENDPOINTS.md`**: assistant components and the `/api/assistant/` endpoints (capabilities, conversations, stream, actions, voice, feedback, insights).
4. **`docs/BACKEND_APPS.md`**: the `assistant` app (models, skills, commands: `assistant_baseline`, `seed_baseline_data`, `roman_urdu_variants`, `llm_probe`, `llm_status`, `stt_probe`).
5. **`CLAUDE.md`** (repo root): a short "Aura" gotcha block only if something non-obvious must be known by every session (for example: tools write only through viewsets as the user;
   baseline uses school 37; never full-suite runs per step). Keep it brief.
6. **Memory** (`C:\Users\hp\.claude\projects\D--personal-EducationAI\memory\`): update `ai-agent-upgrade-decisions.md` with a final status line and add a pointer to `docs/handoff/`;
   keep `MEMORY.md` one line per memory.
7. **Handoff folder:** mark finished sessions as done at the top of `00_README.md`.

## Statements in the plan doc that are now wrong (fix them)

- Decision 3 (section 1, section 9 table): payroll is **no longer blocked**: payslips can be generated, approved, marked paid and drafts deleted, each with a preview card. Salary structures and role changes stay blocked.
- Section 18 "Decisions to remember": PRINCIPAL **may** see salary figures; HR scope for teacher / staff / manager is **own leave and own payslip** (both confirmed by the owner).
- Section 16 status table: everything marked "Not started" for Exams, Students & Admissions, HR, Operations, conversation list, parent read access, messaging and Study Helper extras is now built.
- Section 9 table: "create/edit student" is edit + enquiry conversion only, by owner decision (2026-11-08): students are created through enquiry conversion; there is no direct create tool (see `08_BACKLOG_FROM_PLAN.md`, item I, closed).
- Section 11: add the learning feature and the items from `08_BACKLOG_FROM_PLAN.md` that were not built.

## Rules

Facts only from the code and from what was verified (cite file paths). Do not document features that were not built. No secrets. Do not commit; show a `git diff --stat` and wait.

## Prompt to paste into a fresh session

```
You are continuing work on Aura (the EducationAI assistant) in D:\personal\EducationAI.
Read docs/handoff/00_README.md first, then docs/handoff/07_FINAL_DOCS.md (your task).
Task: update the project documentation to the final state of Aura as described in 07_FINAL_DOCS.md. Verify each fact against the code before writing it.
Rules: plan first (list the files you will change) and wait for my OK; no commit or push; no Co-Authored-By; no secrets in docs; run no test suites unless I ask.
End with a short recap and a git diff --stat.
```
