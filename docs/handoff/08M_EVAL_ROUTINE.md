# Item M: the evaluation set and how to run it on every prompt change

## The set

`backend/assistant/baseline/questions.json`: **165 questions** (the original 127 `F/A/C/S/X` ids plus 38 `N` ids added for the tools of backlog items A to K).
Each question has an agent, a role, a language (`en` / `ur_roman`) and one expectation: the right tool (`tool`, with `accept` for other equally right tools), a
write proposal (`write`), a refusal (`denied`) or a blocked action (`blocked`); `clarify` lets "asking first" count. Scoring: `baseline/scoring.py`.

- Roman Urdu questions use plain everyday phrasing in the style of the existing ones. There is **no glossary**; spelling variants come from the Dakshina
  lexicon kept outside the repo (`D:\data\dakshina`, CC BY-SA, see `docs/AI_AGENT_UPGRADE_PLAN.md`).
- `backend/assistant/tests/test_baseline_questions.py` checks the file **without a model** (unique ids, every expected tool exists with the right kind,
  the asking role may use it, at least 150 questions). It runs with the normal assistant tests, so a renamed tool or a role change breaks a unit test, not a day of tokens.
- Not in the set, on purpose: `delete_marks` (the seed has only a published exam, which Aura refuses, and a scheduled one without marks), grading and
  returning (school 37 has no assignments with submissions), the account ledger needs payments received in the month. Those are covered by unit tests.

## When to run what

| You changed | Run |
|---|---|
| A tool description or one agent's tools | that agent's questions: `--agent <name>` |
| The router (`router.py`), the system prompt, the language rules, `llm.py` | the agent(s) it can affect first, then the **full set once** before merging |
| Only a tool's code (no description) | its unit tests; no model run |
| A new tool | add a question or two (`N` ids), run just those with `--questions` |

**Never run the full set per step.** It is a deliberate gate before merging a prompt, router or model change.

## Commands (from `backend/`, school 37 is the test school; every database write is rolled back)

```bash
# one agent, ~10-minute batches, resumable (progress is kept in docs/ai_baseline_unified_state.json)
python manage.py assistant_baseline --school-id 37 --mode unified --agent finance --delay 30 --max-seconds 570
# only some questions (own state file next to the questions file's name)
python manage.py assistant_baseline --school-id 37 --mode unified --questions assistant/baseline/questions_new_n.json --delay 25 --max-seconds 570
# start over
python manage.py assistant_baseline --school-id 37 --mode unified --restart ...
```

Re-run the same command until it prints a final table. It stops cleanly (without scoring) on a rate limit or a lost database connection.

## Cost and the daily limit

About 6.9k Cerebras tokens per question. The full set of 165 is roughly **1.1M tokens, more than one day's free 1M**: run it over **two sessions on two days**
(the resumable state does this). Check `python manage.py llm_usage --days 1` before starting. A change to a single agent is 5-30 questions and fits easily.

## Reading the result

- Pass rate overall and per language. Compare with the last recorded table in `docs/AI_AGENT_UPGRADE_PLAN.md` (English 80/80, Roman Urdu 36/37 on the
  original 127; the 38 `N` questions have the first-run table below).
- Each state entry has the reply and the tool calls: read the failing ones before changing anything. Most misses are routing (the router saw no matching
  words), a missing seed fact (nobody absent on a Sunday, no assignments), or a clarifying question that is actually fine (add `clarify` / `accept`).
- Fix in this order: router and tool descriptions, then the system prompt, then a short example taken from OUR passing questions. Never a hand-typed glossary.
- State files that contain spelling-variant text stay outside the repo.

## Go / no-go for a prompt change

Merge when: no agent drops by more than 2 questions against the last full run, the Roman Urdu rate stays within 5 points of English, and every new miss is
either fixed or explained in the table. Record the date and the table in `docs/AI_AGENT_UPGRADE_PLAN.md`.

## First run of the 38 new questions

Run on 2026-11-09, school 37, real model (Cerebras main, Groq router), writes rolled back.

| | Pass |
|---|---|
| 38 new `N` questions, first run | 31 / 38 |
| The 7 misses after fixes, re-run | 7 / 7 |

What the 7 were:

| Id | Cause | Fix |
|---|---|---|
| N09 vendors list (Roman Urdu) | router description of `operations` did not mention vendors; the model logged a missing capability | description now names vendors and suppliers |
| N36, N37 parents' leave requests | no agent description mentioned them; Roman Urdu went to staff leave (`hr`) | `students` names parents' leave requests; `hr` says NEVER for them |
| N33 "always reply in Roman Urdu" | the preference tools were shared lookups, which are only offered when another agent is picked; the router said "none" | own agent `settings` with its own router line, label and colour |
| N05 | question design: the seed teacher is not class teacher of 5A, so refusing was right | asked as admin |
| N14 | question design: a teacher may read their own payslip, so that call is not data leaking | asked as student |
| N27 | question design: asking which assignment is a correct answer | `clarify` added (N26 too) |

Four of the seven were real routing gaps (found only because the questions exist); three were questions that expected the wrong thing.
Not re-run: the other 31 `N` questions and the original 127 after the router and `settings` changes. The full set is the gate before merging (see above).
