# Session 1: fix the baseline failures

Source of truth: `docs/ai_baseline_unified_state.json` (127 questions on school 37 with seeded data: **104 pass, 23 fail**).
Run `python -m pytest assistant/tests/<touched file> -q -p no:cacheprovider` only for files you touch. Re-run only the failed questions at the end.

## Already fixed in this scan (do not redo; for context)

- Turn crash when a tool returned plain text (`orchestrator._choices_from`).
- Payslip generation crash: `hr/models.py` salary totals with decimal allowances (this was an app bug, not only Aura).
- `class_key` ignores a school prefix ("SEED_TEST_Class_1A" == "Class 1A"); `lms_common.find_sections` now uses it: "Class 5" = all sections, "5A" / "5-B" /
  "Class 5 section B" / "fifth A" = one section. Messaging and `list_students` treat "Class 5" as every section.
- System prompt: Roman Urdu uses Latin letters only; "my / mera" means the signed-in user; never write a year you were not given.
- New: `get_child_homework` (parents), `send_message_to_parents(absent_today=True)`, `get_teacher_schedule` defaults to the signed-in teacher.
- Runner: stops cleanly on a lost connection, savepoint per question, prefers accounts that have a staff / student / parent profile.

## Real bugs still open (fix these)

| ID | Questions | What goes wrong | Root cause | Fix |
|---|---|---|---|---|
| **B1** | X27 X29 X31 X33 X36 X39 C07 | "Ali Farooq" returns the exact match PLUS partial matches (other Farooqs), so Aura says "several students" and asks instead of acting | `directory.find_student` ranks exact matches first but still returns the partial ones | If any result contains ALL words of the query, return only those; if exactly one, add a note "exactly one student matches, use it". Return partials only when nobody has all the words (that path already exists, note "NO student has all of these words"). Also let the model pass the class (`class_name`) to disambiguate (already supported). |
| **B2** | X30 X38 | Aura asks "Shall I prepare...?" or asks for title and body instead of making the card | System prompt and tool text do not say the card IS the confirmation | Prompt: "When you have the details, call the prepare tool immediately; the preview card is the confirmation. Never ask 'shall I'." `send_message_to_parents`: "Write the title and body yourself from the request." |
| **B3** | F03 X23 C07 | Router picks the wrong sub-agent: fee-pending list went to *students*, a staff name went to *students*, one student's attendance history went to *attendance* | `router.AGENTS` descriptions overlap | Sharpen descriptions: students = a person's record, never "who owes fees" (finance); hr = staff, teachers, employees; attendance = class / school counts, not one student's history (communication). Router prompt: "if a name could be a student or a staff member, choose both agents". Add router tests. |
| **B4** | X03 | Wrong answer: "951 children absent today" | The legacy `get_attendance_summary` (`notifications/ai_agent.py::_get_attendance_summary`, exposed in the communication pack) takes only `student_id` / `class_id`; with neither it counts every attendance record of the school for all time, and the model passed a `date` it ignores | In `assistant/skills/communication.py` hide or correct it for school-wide use: require student_id or class_id, otherwise tell the model to use `get_attendance_summary_school`. Test it. |
| **B5** | A15 | Reply says "2024-11-04 to 2024-11-10" while the tool was called with 2026 dates | Model writes the year from memory | Put the exact period in tool output (`period: "2026-11-04 to 2026-11-10"`) for `count_lesson_plans` / `list_lesson_plans` and other date-range tools; keep the prompt rule. |
| **B6** | C15 C14 F16 | Missing capabilities: parents of fee-pending students; "absent today" not used (model asks which class); no list of who has a scholarship | Tool coverage | Add audience `fee_pending` (optional class) to `send_message_to_parents` (default event FEE_DUE; recipients = parents of students with unpaid records); description example for `absent_today` ("whole school if no class given, do not ask"); add `list_scholarship_recipients` to finance (read via `StudentDiscount`). |
| **B7** | F09 | "total collection minus expenses so far" answered with this month's income only (zeros) | `get_balance` description is vague | Describe it as "net position to date: all income minus all expenses"; keep the monthly tools for monthly questions. |

## Baseline / scorer corrections (not product bugs)

- **A04**: Aura correctly passes `day: "MON"` (the tool enum). Change the expectation to `{"day":"MON"}`.
- **F28 F29**: asking which account is a correct clarification (the school has several). Add `"clarify": true` to both.
- **A22**: Mathematics is not assigned to the test teacher, so refusing is right. Use role `SCHOOL_ADMIN`, or keep TEACHER and expect a clarify/refusal.
- **X16**: the test teacher is not assigned to Class 5 so Aura sees no exams. Use role `SCHOOL_ADMIN`.
- **F30**: there are no November expenses. Ask about a month that has them ("Delete the October utilities expense", `clarify: true`).
- **C14**: today (Sunday 8 Nov) has no attendance, so no card can exist; mark `clarify: true` or run the question on a school day.
- **X03**: expected `get_attendance_summary_school`; accept stays strict until B4 is fixed.
- After the fixes re-seed is NOT needed. If any question needs more data, extend `seed_baseline_data.py` (idempotent) and ask the owner before running it on school 37.

## Order of work

1. B1 (biggest: 8 questions) -> tests in `assistant/tests/test_bugfixes_round1.py` (add) and `test_student_tools.py`.
2. B2 -> prompt (`orchestrator.SYSTEM_PROMPT`) + tool descriptions in `messaging_tools.py`, `student_tools.py`, `student_fee_tools.py`.
3. B3 -> `router.py` + `tests/test_router_and_ports.py`.
4. B4 -> `skills/communication.py` + test.
5. B5, B7 -> descriptions and outputs; B6 -> new audience, tool and tests (`test_item4_tools.py` / `test_finance_*`).
6. Scorer / question corrections above, then `python -m pytest assistant/tests/test_baseline_scoring.py -q`.
7. Re-run only the failed questions: delete their keys from `docs/ai_baseline_unified_state.json` (back it up first), then run
   `assistant_baseline` batches until 0 left. Target: **at least 120 of 127 (94%)**, no tool-count or capability test broken.

## Done means

- Each fix has a test that fails without it.
- The re-run result table (by agent and language) is written into `docs/AI_AGENT_UPGRADE_PLAN.md` section 18.
- No commit, push or full-suite run unless the owner asks.

## Prompt to paste into a fresh session

```
You are continuing work on Aura (the EducationAI assistant) in D:\personal\EducationAI.
Read, in this order: docs/handoff/00_README.md (rules and how things fit), then docs/handoff/01_FIX_SESSION.md (your task).
Look at docs/ai_baseline_unified_state.json only for the failing questions listed in 01_FIX_SESSION.md.

Task: fix bugs B1-B7 and apply the baseline/scorer corrections from 01_FIX_SESSION.md, then re-run only the failed baseline questions.

Rules (from 00_README.md): write a short plan and wait for my OK before changing code; do not commit or push; no Co-Authored-By trailer;
run only the new or touched test files, never the full suites; never write to the database without asking me; do not create virtual
environments; class and section are two different things (read CLASS_SYSTEM_GUIDE.md before touching class scoping).

Keep a task list. When done, give me a short recap: what changed, the before/after baseline numbers by agent and language, what you did
not verify, and what you need from me.
```
