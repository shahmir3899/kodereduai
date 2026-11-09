# Session 3: hardening (item 6)

## Goals (from the owner)

1. **Per-school on/off switch** for Aura (today the orb shows when the user has at least one tool; the web flag is `VITE_ASSISTANT_ENABLED` or localStorage `assistant_beta=1`).
2. **Usage numbers**: tokens, calls, fallbacks, voice seconds per school and per day, visible to the owner (today `llm_status` reads per-process cache counters; Redis in production).
3. **Per-user token caps** (daily), with a clear message when reached; students and parents already have message caps (`guards.py`).
4. **Move the ~22 legacy Groq call sites to the gateway** (`assistant/llm.py`) after measuring how much of the Groq daily quota they use (Groq free tier is shared
   with the live app: 200k tokens/day).
5. **Groq allow-list vs exam-paper OCR**: the Groq project allows only `openai/gpt-oss-120b` and `whisper-large-v3-turbo`. Check `GROQ_VISION_MODEL` (exam-paper OCR) and
   `EDU_GROQ_FAST_MODEL`; any other model gets a 403 (`model_permission_blocked_project`). Either add the vision model in the Groq console (owner) or route it elsewhere.
6. **Cerebras data terms**: the owner must read them (school data goes to Cerebras). List what Aura sends (tool results with student names, marks, fees) so the
   owner can decide; add an `EDU_LLM_CEREBRAS_ENABLED=false` runbook line.

7. **Also from the original plan (Phase 9):** a cross-role and cross-tenant leakage test generated from the registry; metrics (tool-call success, approval rate, edit rate, latency, tokens per
   message) against the baseline; rollout order Demo School then Focus behind the per-school flag; a one-week review of the Cerebras gateway (keep, drop or balance) and a decision on paid tiers.
   These are items B, C and P in `08_BACKLOG_FROM_PLAN.md`; do them here if the owner agrees, otherwise run them as their own sessions.

## Facts to start from

- Gateway: `backend/assistant/llm.py` (main -> Cerebras then Groq; fast -> Groq then Cerebras; learns limits from `x-ratelimit-*` headers; one cache counter per call;
  kill switches `EDU_LLM_CEREBRAS_ENABLED`, `EDU_VOICE_ENABLED`). Commands: `llm_probe`, `llm_status`, `stt_probe`.
- Measured: about 6.9k tokens per question (Cerebras ~67k tokens for 10 questions, Groq router ~2k). 1M Cerebras tokens/day is about 145 questions. Render runs 1
  gthread worker x 4 threads, timeout 120; each assistant stream holds a thread 5-10 s.
- Env vars exist only in local `.env` except `EDU_CEREBRAS_API_KEY` (set on Render). Everything else has defaults.
- Audit tables: `AgentAuditLog` (every tool call, duration), `AgentAction`, `AgentMessage` (has token counts? check), `AgentConversation`.

## Plan outline (write the real plan and get the owner's OK first)

- **School switch:** prefer existing structures: a key in `School.enabled_modules` (e.g. `assistant`) checked by `CapabilitiesView` and `registry.tools_for`, and a toggle on the
  school settings screen (superadmin). Default ON for schools that already had the old chat widgets? Ask the owner. No new table if `enabled_modules` is enough.
- **Usage numbers:** log tokens per call into a small daily counter. A new table (e.g. `AgentUsageDay`: school, user, date, tokens, calls, fallbacks, voice_seconds) needs the
  owner's sign-off; otherwise use Redis counters with daily keys and a management command that prints them.
- **Per-user caps:** `EDU_USER_DAILY_TOKENS` (default e.g. 60k) checked in `orchestrator` before a turn; message "daily limit reached" in the user's language; admins configurable.
- **Legacy Groq sites:** `grep -rn "groq" backend --include=*.py` (22 sites in ~20 files). First measure: add a tag to each call site's log line and run a normal day, or count with
  `llm_status`. Then move one site at a time behind `assistant.llm.complete(..., tier='fast')`, keeping behaviour and tests.
- **OCR model:** read how exam-paper OCR calls Groq (`GROQ_VISION_MODEL`), test with a safe sample, report the exact model name the owner must allow.

## Done means

- A school with the switch off shows no orb and every assistant endpoint answers 404 / empty capabilities.
- `python manage.py llm_status` (or the new command) prints per-school usage; a per-user cap test passes; moved call sites have tests.
- The owner has a short list: env vars for Render, Groq console changes, Cerebras terms to read.

## Prompt to paste into a fresh session

```
You are continuing work on Aura (the EducationAI assistant) in D:\personal\EducationAI.
Read docs/handoff/00_README.md first (rules, how things fit), then docs/handoff/03_HARDENING.md (your task).
Task: item 6, hardening. Start by writing a plan (per-school switch, usage numbers, per-user token caps, moving the legacy Groq calls to the gateway after
measuring, the Groq allow-list versus exam-paper OCR, a summary of what is sent to Cerebras). Mark every new table or column; I must approve schema changes.
Rules: plan first and wait for my OK before code; no commit or push; no Co-Authored-By; run only new or touched tests; no database writes without asking;
no virtual environments; never put keys in chat or files. End with a short recap and a list of what you need from me (console changes, env vars).
```
