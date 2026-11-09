# Session 6: Aura learning feature ("what people ask that Aura cannot do yet")

**Status: BUILT (2026-11-09), all three steps, uncommitted.** Tests pass: `test_gaps.py`, `test_insights.py`, `test_gap_grouping.py`, vitest for `FeedbackThumbs` and `AuraInsightsPage`.
Migration `assistant/0003_agentgap` is applied on the remote database (checked read-only). The sections below are the original plan; where the build differs, this block wins.

**What differs from the plan / what was decided while building**
- `report_missing_capability` is registered under the `directory` agent (shared tool, all roles, no module gate), so that agent has 4 tools. One self-report per turn (`skills/gaps.py`).
- Signals: `denied` / `tool_error` in `registry.execute`; `card_rejected` / `card_edited` in `engine.reject` / `engine.edit` (tool name only, never card contents);
  plain decline text and `clarify_loop` (3 questions in a row) in `orchestrator._capture_gaps`. Thumbs via `POST /api/assistant/feedback/` (one row per person per message; a changed mind replaces it).
- The `final` event carries `ask_feedback`; card data carries `message_id`. Thumbs show only after a decline / "could not help", and after a card is approved or rejected (`FeedbackThumbs.jsx`).
- Redaction and storage: `assistant/redact.py`, `assistant/gaps.py`. Students and parents store category only (no summary, reason or language). If name lookup fails nothing is stored.
- Insights (`assistant/insights.py`, views in `views.py`): `GET /api/assistant/insights/` (school admin / principal = own school, `?school=` ignored for them; super admin = all) and
  `PATCH /api/assistant/insights/groups/<id>/` (super admin only: status, note, baseline_question_id). Not gated by the per-school assistant flag. Rows not yet grouped show as an "Ungrouped" bucket.
  Page: `/aura-insights` (`pages/admin/AuraInsightsPage.jsx`), sidebar link for school admin / principal (`navigationConfig.js`) and super admin (`Layout.jsx`).
- Grouping (`assistant/grouping.py`, `tasks.py`): denied / tool_error / card_* rows group by tool name with no model; text rows go to `llm.complete(tier='fast')` in batches of 40 (max 5 calls a run).
  Beat: `assistant-gap-cleanup` daily 03:30, `assistant-gap-grouping` Sundays 04:00 (`config/settings.py`).
- Commands: `group_gaps_now [--dry-run]`, `export_gap_questions --group <id> [--out file]` (drafts only; never edits `questions.json`; `expect` is left as `TODO`, placeholders `<student>` / `<staff>` must be replaced).

**Not verified:** no live model call (prompt, decline-phrase detection, the model calling the tool), thumbs buttons never seen in a browser, Beat never fired in production, super-admin view checked by tests only.
The insights page was checked in a browser for the school admin on a scratch SQLite database (scoping, examples, read-only note, sidebar link).

## Why

Users ask things no tool covers (the baseline found: parents of fee-pending children, a list of scholarship holders, parents of absent students...). Capture those
requests, group them, show how often each is asked, so the owner decides what to build next. Fixed gaps become baseline questions, so they stay fixed.

## The loop (8 stages)

1. A user asks. 2. Aura tries (router, tools, preview cards). 3. A **signal** is caught. 4. The text is **redacted** and stored for 90 days. 5. A weekly job **groups**
similar requests. 6. An **insights page** shows the groups. 7. The owner **decides** (new / planned / built / won't do). 8. The feature is built and added as a
baseline question; back to stage 2 with a better Aura.

## Owner decisions (final)

- School admins and principals see **their own school's** gaps; the super admin (owner) sees **all** schools.
- **Staff roles:** store redacted question text. **Students and parents:** store the category only, never the text (many are minors).
- **Retention:** delete after 90 days (daily Celery Beat job).
- **Thumbs up / down** appear only (a) after Aura could not help or declined, and (b) after a preview card was approved or rejected. Not on every reply.
- **Web only** for now.
- The page is an Aura insights page; no mobile screen yet.

## Signals to capture

| Kind | Where to hook |
|---|---|
| `missing_tool` | the model calls the new tool `report_missing_capability(summary, category)` when no tool fits; also an assistant message with no tool call whose text declines ("I can't", "no tool") |
| `tool_error` | `registry.execute` error path (not `ProposalError`, which is a normal question) |
| `denied` | `registry.execute` "not permitted" path |
| `card_rejected` / `card_edited` | `engine.reject` / `engine.edit` |
| `clarify_loop` | same conversation, assistant asked a question 3 times in a row |
| `thumbs_down` / `thumbs_up` | new feedback endpoint |

## New tables (approved)

- `AgentGap`: school (FK), user (FK, null on delete), role, agent, kind (above), language (`en` / `ur` / `ur_roman` guess), `summary` (redacted, max 300 chars, empty for student and
  parent roles), tool_hint, conversation_id and message_id (plain integers), rating (null / 1 / -1), reason (short), group (FK to the group table, null), created_at, delete_after.
- `AgentGapGroup`: label, description, status (`new`, `planned`, `built`, `wont_do`), note, baseline_question_id (text, null), created_at, updated_at.
  Global (not per school); counts per school are computed from `AgentGap`.
- Migration in `backend/assistant/migrations/`; the owner applies migrations to Supabase themselves (do not run them against the remote database).

## Redaction (before saving)

Replace known student and staff names of THIS school (match by tokens), phone numbers (03xxxxxxxxx, +92...), emails, CNIC-like numbers and long ids with `<student>`, `<staff>`,
`<phone>`, `<email>`, `<id>`. Truncate to 300 chars. Unit-test with Roman Urdu and English examples. The raw message is never copied into `AgentGap`.

## Build steps (one at a time, plan each, owner OK between)

**Step 1: capture.** Models + migration, redaction util (`assistant/redact.py`), signal hooks (above), `report_missing_capability` tool (all roles; for student and parent it stores
the category only) + one system-prompt line ("if no tool fits, say so and call report_missing_capability once"), `POST /api/assistant/feedback/` (`message_id`, rating, reason),
`final` event flag `ask_feedback` (declined or card result), frontend thumbs component shown only when the flag is set. Caps: one self-report per turn, ignore exact duplicates.
Tests: redaction, each signal, role scoping, retention field, endpoint permissions.

**Step 2: insights page.** `GET /api/assistant/insights/` (scoped: school admin / principal = own school; super admin = all with a school filter), group list with counts for 7 and 30
days, roles, agents, languages, up to 3 redacted examples; `PATCH /api/assistant/insights/groups/<id>/` (status, note) for the super admin only. Web route `/aura-insights`
(sidebar entry for admins), table + trend sparkline, filters. Tests for scoping and PATCH permission.

**Step 3: weekly grouping and baseline link.** Celery Beat weekly task: send new ungrouped summaries (batched) to the cheap model tier (`llm.complete(..., tier='fast')`) asking to attach each
to an existing group label or create a new one; daily cleanup task deleting rows past `delete_after`. Management command `export_gap_questions --group <id>` writes a draft
baseline question (never edits `questions.json` automatically). Tests with a fake model.

## Cautions

- Notification scheduling lives on Celery Beat (`render.yaml` already sets `ENABLE_CELERY` and `ENABLE_CELERY_BEAT`); add the two tasks to the beat schedule in `config/settings.py` / `celery.py`
  the same way the others are.
- Never store raw text for students or parents. Never show another school's rows to a school admin.
- Cost is negligible: rules do most of the work; one small model call a week.
- Keep UI text short and plain; follow `cardConfig.js` / existing components for style.

## Prompt to paste into a fresh session

```
You are continuing work on Aura (the EducationAI assistant) in D:\personal\EducationAI.
Read docs/handoff/00_README.md first (rules, how things fit), then docs/handoff/06_LEARNING_FEATURE.md (your task: the approved learning feature).
Start with Step 1 (capture). The plan and the two new tables (AgentGap, AgentGapGroup) are already approved by me; write a short implementation plan for Step 1
(files, migration, hooks, tests) and wait for my OK before coding. Do not apply migrations to the remote database.
Rules: plan first; no commit or push; no Co-Authored-By; run only new or touched tests; no database writes; no virtual environments; redaction is mandatory and
students and parents never have their text stored.
End with a short recap, what you did not verify, and what you need from me. Then stop; I will tell you when to start Step 2.
```
