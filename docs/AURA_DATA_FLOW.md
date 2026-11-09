# Aura: what leaves the server, and the switches

For the owner's decision on the model providers' data terms. Nothing here has been signed off; the terms of
Cerebras and Groq still have to be read by the owner.

## Where each kind of call goes

| Call | Provider (normal order) | Notes |
|---|---|---|
| Routing (which agent?) | Groq, then Cerebras | tiny prompt: the user's message (first 500 chars) and agent names |
| Tool loop (the answer) | Cerebras, then Groq | the big one: see below |
| Conversation summary, spoken rewrite | Groq, then Cerebras | text of earlier messages / of one reply |
| Speech to text | Groq (Whisper) only | audio held in memory for the request, never stored |
| Older features (finance chat, comments, lesson/TOC AI, session health, digests, exam-paper tools ...) | Groq directly | not part of Aura; counted by `llm_usage` since this change |
| Exam-paper OCR | Google Vision (default `VISION_PROVIDER=google`), then Groq text | Groq vision only if `VISION_PROVIDER=groq` |

## What the main (Cerebras) call contains

1. The system prompt: school name, today's date, the user's role, the role rules.
2. The last 10 messages of the conversation plus the rolling summary (both can hold names and figures the user typed or saw).
3. The tool definitions (names and parameter schemas, no data).
4. **Tool results**, as JSON, for every tool the model calls. This is where personal data goes. By agent
   (167 tools: 126 read, 41 write-preview):
   - students / directory: student names, admission numbers, class and section, guardian names and phone numbers where the tool returns them
   - attendance, academics, exams: per-student attendance status, marks, grades, timetable, lesson plans, assignments
   - finance: fee amounts, arrears, payments and expenses with student names; account balances
   - hr: staff names, leave, payslips and salary figures (only for roles allowed to see them)
   - communication / family / study: messages, child summaries for a parent, a student's own study data
   - operations: library, hostel (gate passes), inventory, transport rosters
5. Write tools send only the proposal (what the user is about to approve), not the database.

Tool results are cut to what the tool returns for THAT user's role and school: the permission checks run before the data
is built, so a teacher's call never carries payroll and a parent's call carries only their own children.

## Never sent

Passwords, tokens, API keys, password hashes, uploaded documents and photos, audio (except the live Whisper request),
face-recognition data, payment-gateway secrets, other schools' data.

## Switches (runbook)

| Want | Do |
|---|---|
| Stop sending school data to Cerebras (Groq only) | set `EDU_LLM_CEREBRAS_ENABLED=false` on Render, redeploy |
| Turn voice off | `EDU_VOICE_ENABLED=false` |
| Turn Aura off for one school | `python manage.py assistant_switch --school-id N off` (no redeploy) |
| Start a rollout with everything off | `EDU_ASSISTANT_DEFAULT_ENABLED=false`, then `assistant_switch ... on` per school (Demo School, then Focus) |
| Change a person's daily allowance | `EDU_USER_DAILY_TOKENS` (staff, default 60000) and `EDU_ADMIN_DAILY_TOKENS` (school leaders, default 250000); 0 = no cap |
| See the cost | `python manage.py llm_usage --days 7 [--school-id N] [--users]` and `llm_status` |

## Reading the terms: questions to answer

1. Does the provider train on, or retain, API inputs? For how long?
2. Is a data-processing agreement available (student names and marks are children's data)?
3. Where is the data processed (region)?
4. Does a paid tier change any of the above (the free tier is what is used today)?
