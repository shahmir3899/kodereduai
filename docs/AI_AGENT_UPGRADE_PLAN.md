# AI Agent Upgrade Plan — Unified EduAI Assistant

Status (2026-11-07): **plan approved; implementation under way, all uncommitted.** See §16 for what is built and what is open.
Hard rules that apply: no push/PR without approval; schema changes need sign-off (Phase 0 tables are approved); tests use the shared `seed_data` school; dev DB is remote Supabase — no test writes against it.

## 1. Decisions (user, 2026-11-07)

| # | Decision |
|---|---|
| 1 | New tables approved (AgentConversation, AgentMessage, AgentAction, AgentAuditLog). |
| 2 | One unified assistant; the UI **must show which sub-agent is working** (chips such as "Finance agent working…", and each answer tagged with its sub-agent). |
| 3 | **Blocked for the agent:** bulk promotion, role/permission changes, payroll. **Deleting records is allowed** (lesson plan, fee entry, etc.) via preview/approve. |
| 4 | **No write actions for parents and students.** |
| 5 | Groq Whisper approved for voice. |
| 6 | Roman Urdu support via **public datasets**, not a hand-written glossary. |
| 7 | **Context depth = 10 messages**, shown to the user as a counter (e.g. `3/10`). |
| 8 | Lesson-plan dates = **any working day** (school off days and Sundays excluded). |
| 9 | Lesson-plan spreading follows the **depth of the user's input** (chapter / topic / page), see §6. |
| 10 | The new sub-agents (Attendance, Exams, Students & Admissions, HR, Operations) are **required** before the work is considered finished. |
| 11 | **Chat UI = a talking orb** (not a robot character): pops up, shows live steps by sub-agent, slides change cards up, then minimises. Voice never approves a change; pending cards never disappear on their own. |
| 12 | **Second model provider: Cerebras, lean version** — primary with fallback, kill switch, usage counting; no balancing maths until data shows a need (see §15). |

## 2. Today's baseline (read-only, siloed)

| Agent | Code | Tools | Audience |
|---|---|---|---|
| Finance | `finance/ai_agent.py` | ~17 read | admins |
| Academics | `academics/ai_engine.py` | ~15 read | any school user |
| Parent Communication | `notifications/ai_agent.py` | ~15 read, drafts only | admins |
| Student Study Helper | `students/study_helper_service.py` | ~7 read | students |

Problems: text-parsed JSON tool calls, 3-round loop, 1000 max_tokens, last-10 reload with no summary, no stored history for Communication, view-level (not tool-level) role checks, no writes, English only, no voice, 9 modules without any agent. Baseline numbers are measured in Phase 0 (see §9).

## 3. Target architecture

```
Voice/Text (web + mobile)
  → Language layer (Roman Urdu / Urdu / English)
  → Orchestrator (native tool-calling, planner, conversation state)
  → Sub-agent router  (Finance | Academics | Communication | Study | Attendance | Exams | Students&Admissions | HR | Operations)
  → Tool registry (filtered per user role)
       ├─ READ tools   → run immediately
       ├─ WORKFLOW tools (deterministic composites, e.g. plan chapters into lessons)
       └─ WRITE tools  → create a PROPOSAL only
  → Preview card: Approve / Edit / Reject
  → Executor → existing DRF viewsets/serializers as the logged-in user
  → AgentAuditLog
```

Principles:
- The agent never writes with the ORM directly; it calls the same APIs the frontend uses (permissions, validation, tenant scoping, module gating, signals all inherited).
- The LLM understands and fills slots; **code** counts, schedules and allocates. The model never does arithmetic or counting.
- The model is never the security boundary: tools are filtered per role, and re-checked at execution.

## 4. Conversation memory and the 10-message counter

- The agent sees the **last 10 messages verbatim**. The chat header shows a counter `N/10` (messages currently in the agent's memory window), with a tooltip: "The assistant remembers the last 10 messages."
- When the window is full the oldest message drops out of the verbatim window; a **rolling summary** keeps the gist.
- A separate **conversation state** (JSON on `AgentConversation`) stores things that must survive beyond 10 messages:
  - the **working set** (e.g. the 12 pending fee records with IDs, or the chosen class/book/teacher),
  - resolved entities (teacher, class, book),
  - pending clarification questions,
  - the user's chosen defaults for the session (e.g. "same period as before").
- Named conversations (new / rename / pin / delete) on web and mobile.
- Long-term preferences (language, default class, frequent reports) stored explicitly and visible to the user.
- Entity grounding: a fuzzy resolver for people, classes, subjects, books. One clear match → proceed and state the assumption; several close matches → ask with buttons.

## 5. Finance sub-agent

**Reads:** pending/unpaid fees, defaulters, income/expense summaries, fee structure, discounts and scholarships, online payment (Kuickpay) status, monthly closing, collection trends, transfers, **account balances (each account; plus a projected "after this action" balance, labelled an estimate)**, student ledgers and receipts.

**Writes (all preview → approve/edit → existing API):**
- Record fee payment(s), including **bulk**, via `fee-payments/bulk_update` (`pay_full`, `ids`, `account`, `payment_method`; `records` mode for partial amounts).
- Add/edit/delete expense and other-income entries; create/edit discounts.

**Bulk fee flow (multi-turn):**
1. "Class 5 ki fee ka status?" → tool returns the pending list; **12/12 pending, with names**. The 12 records are saved as the working set.
2. "Ahmad aur Akram ke ilawa sab ki fee aa gai?" → agent computes the set difference over the working set (fuzzy-match names inside the set; ask if two Ahmads).
3. **Preview card:** table (student, month, due, paying now), **total at the end**, target account, **account balance before → after**. Each row has a checkbox; Edit can drop students, change amounts, account, payment method, date.
4. The agent states its interpretation in the preview ("Mark 10 students paid in full"). If the account is missing, it asks.
5. **Approve → API call.** At approval the records are re-checked as still unpaid. The API commits per record (not all-or-nothing), so the result card shows success/failure **per row**.

**Access:** admin, principal, finance manager only. A parent sees only their own child's dues (read).

## 6. Academics sub-agent

**Reads:** timetable, teacher/room schedules, substitutes, conflicts, **lesson plans, books, chapters, topics, sub-topics, book content** (outline first; full topic content fetched on demand via `semantic_search`, never whole books), `TopicSchedule` dates, class subjects, curriculum progress, assignments, **diary / homework / classwork**.

**Access:** teachers only see their own classes/subjects/plans; admins see all.

**Counting / summary questions** ("Miss Hasnat ke kitne lesson plan draft hain?"):
- Teacher lookup is fuzzy (spelling variants; ignores "Miss"/"Sir"). One clear match → proceed and say who was assumed; several → ask with buttons.
- If the time period is missing the agent **asks**, with quick buttons (this week / this month / this term / all time), then reuses the answer in the same conversation.
- Counting is done by a DB aggregate tool (filters: teacher, status, dates, class, subject). The model does not count rows.

**Short lesson plan creation:** the agent drafts a compact plan (objective, activity, assessment), marks it `is_ai_generated`, and shows a preview card with editable text. Approve saves as `DRAFT`; publishing is a separate approval.

**Complex request** — "mere class 4 ki English ke book ke chapter 3 aur 4 next month ke lesson plan mein daal do":

| Step | Who | Detail |
|---|---|---|
| "mere" | code | the logged-in teacher |
| class 4 | code → ask if needed | if she teaches 4A and 4B: "which section, or both?" |
| English book | code → ask if needed | several books (course book / workbook / grammar) → show list |
| chapters 3 and 4 | code | load their topics/sub-topics (and page ranges if stored) |
| "next month" | code | today 2026-11-07 → December 2026 |
| dates | code | **all working days** in the range (school off days + Sundays excluded; Saturday handling = `skip_saturday` option, shown as a chip) |
| allocation | code | by the depth of the user's input — rules below |
| existing plans on a date | ask once | skip / replace / add (default: skip) |
| preview | UI | table: date, day, topics, status `DRAFT`, warnings; Edit moves topics between dates |
| approve | existing API | `lesson-plans/bulk_create` (+ optionally `set-planned-date`) |

**Allocation rules (follow what the user gave):**
- **Chapter-level** ("spread chapter 3 and 4"): divide working days equally among the chapters — 2 chapters over 8 days = 4 days each. If it does not divide evenly, the extra days go to the earlier chapters (e.g. 8 days / 3 chapters = 3, 3, 2) and the preview shows it.
- **Topic-level** ("chapter 3 ke topics"): count the topics and spread them over the days in order. More topics than days → several topics on a day; fewer topics than days → warn and offer: one topic over several days, or fewer plans.
- **Page-level** (user gives page numbers/ranges): spread by page count. If the user mentions pages, the agent assumes the book has page data.
- **Missing structure:** if the book has no chapters/topics/pages stored and the user did not supply them, the agent **warns and asks the user** (e.g. "this English book has no chapters or pages saved — how many chapters/pages should I use?") instead of guessing.
- No page weighting is applied unless the user gave pages.
- Clarification rule: at most two questions at once, shown as buttons with defaults filled in; every assumption is an editable chip on the preview.

**Diary / daily work:** create diary, homework, classwork or lab entries (`Assignment` types `DIARY`, `HOMEWORK`, `CLASSWORK`, `LAB`) for one or several sections ("5A aur 5B dono"), by voice or text, through preview/approve; read today's diary for a class; count pending submissions and list who has not submitted; grade/return work. Parents get a read-only "aaj ki diary" for their own child. Delete of lesson plans / assignments is allowed via approval.

## 7. Parent Communication sub-agent

**Reads:** the existing per-student lookups plus whole-class views (all absent today, fee-pending parents).
**Writes:** send notifications/announcements to a parent, a class or a group. The preview shows recipient count, a sample list and the exact message text; Approve sends through the normal notification path.
**Memory:** stored conversations (today the browser sends history). **Language:** drafts in Urdu, Roman Urdu or English on request.

## 8. Student Study Helper (read-only, per decision 4)

Keeps its rate limit and content-safety check, adds the prompt-injection guard and long-term memory, plus:
1. **Quiz me** — practice questions generated from the student's own syllabus topics, with a running score in the conversation.
2. **"Aaj ka kaam"** — today's diary, homework and what is due, in the student's language.
3. **Explain in Roman Urdu / Urdu** — step-by-step, with a read-aloud option.
4. Revision planner (from the exam schedule and weak subjects).
5. Weak-topic finder (from mark trends).
6. Later: flashcards; photo-of-a-problem via the vision model.
Ship order: 1, 2, 3 first.

## 9. New required sub-agents

| Sub-agent | Reads | Writes (preview → approve) |
|---|---|---|
| **Attendance** | class/student/teacher attendance, trends, not-marked lists | mark and correct attendance |
| **Students & Admissions** | student 360, enquiries | create/edit student, enquiry notes and status |
| **Exams** | marks, report cards, grade scales | enter/edit marks, delete an entry |
| **HR** | staff, leave, departments | approve/reject leave, edit staff record (**payroll blocked**) |
| **Operations** | transport, library, hostel, inventory | library issue/return, inventory stock entries, gate passes |

Build order: Finance → Academics → Attendance → Exams → Students & Admissions → HR → Operations.

## 10. Roman Urdu and voice

**Roman Urdu (no hard-coded glossary):**
- *Test set:* public intent/utterance and romanized-Urdu corpora (candidates: MASSIVE `ur-PK`, Google Dakshina romanized Urdu, UCI Roman-Urdu sentiment data and other Roman Urdu corpora on Hugging Face) → an evaluation set of ~150+ phrases with expected tool and arguments, run on every prompt change.
- *Normalization:* Roman ↔ Urdu script ↔ English via public transliteration pairs (e.g. Aksharantar, Dakshina) used as few-shot examples or a small retrieval index, plus fuzzy matching for name spelling variants.
- *School vocabulary:* mined from our own data (field names, existing Urdu captions/translations in the app, real chat logs once live) and reviewed, not typed in.
- *Replies mirror the user's language*, overridable in preferences.
- **First task of this phase: verify availability and licences (including commercial use) of every dataset before depending on it.**

**Voice:** web `MediaRecorder` and mobile `expo-av` upload to `/api/agent/transcribe/` (Groq Whisper `whisper-large-v3`). Accuracy is checked against Common Voice / FLEURS Urdu. The transcript is shown in the input box for correction before sending; write previews can be read aloud; audio is not stored by default; size and rate limits apply.

## 11. Phases

| Phase | Scope | Effort |
|---|---|---|
| **0 Foundation** | new tables; `core/agent/` package; native tool calling (up to 8 rounds, larger budget, retries); remove four duplicate loops; **baseline test (~150 questions across roles/languages)**; migrate old chat history | 3–4 d |
| **1 Memory** | named conversations, 10-message window + `N/10` counter, rolling summary, conversation state/working set, entity resolver, preferences | 3 d |
| **2 Roles** | per-tool modules/roles/scope, per-user tool filtering, execution re-check, per-role prompts, injection guard | 2 d |
| **3 Read coverage** | coverage matrix (module × entity × tool) for all modules; pagination and caps | 6–8 d |
| **4 Writes** | proposal → preview → approve/edit → execute → audit; blocked-action list; stale-check; per-row results; Wave A (fees incl. bulk, expenses, attendance, leave, enquiries), Wave B (students, marks, assignments/diary, lesson plans, messaging), Wave C (timetable, HR, inventory, library, transport, hostel) | 12–15 d |
| **5 Roman Urdu** | dataset licence check, eval set, normalization, name matching | 3–4 d |
| **6 Voice** | transcribe endpoint, web and mobile capture, read-back | 3 d |
| **7 UI** | one assistant (button + page) replacing the separate chat widgets/pages; sub-agent chips; conversation list; `N/10` counter; tables in chat; preview/approve/edit cards; clarification buttons; mic; web + mobile | 6–7 d |
| **8 Sub-agent completion** | Attendance, Exams, Students & Admissions, HR, Operations (read + write) — required for completion | 8–10 d |
| **9 Hardening and rollout** | per-role/tenant/leakage tests, metrics, cost control, feature flag per school (Demo School → Focus) | 3–4 d |

Total ≈ **7–8 weeks** (phases overlap: 5 and 6 can run beside 3/4). First shippable cut: Phases 0, 1, 2, Finance + Academics writes, and 7.

## 12. Testing and quality

- Backend: per-role tool visibility, permission denial, proposal lifecycle (create / approve / edit / reject / expire / double-approve), tenant isolation, cross-role leakage, bulk fee flow (set-difference, stale records, per-row results), lesson-plan allocation rules (even/uneven chapters, topics vs days, missing book structure), count tools. All use the shared `seed_data` school.
- Frontend (vitest) and mobile (jest) for the preview card, counter and clarification buttons.
- Metrics: tool-call success, approval rate, edit rate, latency and token cost per message; before/after numbers reported against the Phase 0 baseline.
- Cost: short-lived read cache, cheaper model for routing/summaries, per-user daily token cap.

## 13. Risks

- Model quality on Roman Urdu — the eval set shows this early; fallback is a stronger model for the planning step.
- Wrong writes — the preview gate is never skipped; every write goes through real serializers.
- Cost/latency from more tool rounds — caching and a cheaper routing model.
- Class system mid-rollout — class/fee tools must follow the per-section (`SessionClass`) rule in `CLASS_SYSTEM_GUIDE.md`.
- Testing writes — never against the remote Supabase data.

## 14. Open items

- Confirm the `N/10` counter reading (§4) matches what you meant.
- Saturday handling for lesson plans: default off unless the school's calendar says otherwise (chip on the preview).
- Dataset licence check (Phase 5) may change which sources we use.

## 15. Model providers: Groq + Cerebras (lean gateway)

**Why.** The Groq free tier is the bottleneck: for `openai/gpt-oss-120b` it allows 30 requests/min, **8K tokens/min** and **200K tokens/day** (limits page; the account's own limits page is the final word). A Cerebras key adds **5 requests/min, 90K tokens/min, 1M tokens/day** on the free trial. The two fail in opposite ways (Groq: many small calls, few tokens; Cerebras: few calls, many tokens), and both offer the same model, so prompts and tool calls behave the same on either.

**Verified with a real key (`manage.py llm_probe`, 2026-11-07).** Models for this key: `gpt-oss-120b`, `qwen-3.8-27b`. A plain answer takes about 0.8-1 s. Native tool calling works, including a Roman Urdu question ("class 5 ki fee ka kia status hai?") turned into `get_pending_fees(class_name="Class 5")`. `reasoning_effort: low` and `max_tokens` are accepted. The server returns `x-ratelimit-{limit,remaining}-{requests,tokens}-{minute,hour,day}` headers (the daily limit read back as 1,000,000 tokens and the minute limit as 5 requests).

**What it does and does not do.** It does not reduce tokens per answer; it raises the daily ceiling (200K to 1.2M) and turns a 429 into a quick switch. Real token savings come from shorter tool definitions, fewer model calls, and the router (already built).

**As built** (`backend/assistant/providers.py`, `backend/assistant/llm.py`; the orchestrator, router and tests are unchanged because `llm.complete()` keeps its signature):

| Rule | Behaviour |
|---|---|
| Order | `main` calls (tool loop, big prompts) go to `EDU_LLM_PRIMARY` (cerebras) then the other. `fast` calls (router, summaries) go to Groq first, to keep Cerebras' 5 requests/min for big calls. |
| Rate limit (429) | The provider rests for as long as it asked (`retry-after`, or "try again in 5m41s" in the message; 60 s if unstated); the call moves to the other provider. |
| Outage / timeout | One quick retry, then the other provider; the failed one rests 20 s. |
| Refused request (400, e.g. malformed tool call) | One retry, then the other provider; no rest (not the provider's fault). |
| Bad key (401/403) | Rests for an hour; the other provider is used. |
| Both resting | The user gets the normal "temporarily unavailable" answer; no call is made until one is back. |
| Local request guard | `EDU_LLM_CEREBRAS_RPM` (5): once this process has used them, Cerebras goes last for that minute (a preference, not a wall). |
| Learns from headers | Cerebras: 0 requests left this minute rests it 30 s; under 1,500 tokens left today rests it an hour. Groq: out of requests or nearly out of tokens rests it until its stated reset. |
| Kill switch | `EDU_LLM_CEREBRAS_ENABLED=false` (or no key) = Groq only, exactly as before. |
| Counting | One cache increment per call (tokens used today, per provider) plus one log line `llm_call provider= model= tier= prompt= completion= total= ms= fallback=`. State for resting and the guard is per process, so there is no shared-cache traffic per call. |
| Visibility | `manage.py llm_status` (configuration, order, tokens today vs budget, what the server last reported). `manage.py llm_probe [--provider cerebras|groq|all]` (cheap check of a key and model). |

Environment (all in `docs/ENV_AND_DEPLOYMENT.md`): `EDU_CEREBRAS_API_KEY` (set in `backend/.env` / the host's secrets, never in chat or commits), `EDU_CEREBRAS_MODEL`, `EDU_LLM_PRIMARY`, `EDU_LLM_CEREBRAS_ENABLED`, `EDU_LLM_CEREBRAS_RPM`, `EDU_{GROQ,CEREBRAS}_FAST_MODEL`, `EDU_{GROQ,CEREBRAS}_REASONING_EFFORT`, `EDU_{GROQ,CEREBRAS}_MAX_TOKENS_PARAM`, `EDU_{GROQ,CEREBRAS}_DAILY_TOKENS` (display only).

**Left out on purpose** (add only if the numbers justify it): balancing by share of daily budget, a shared per-minute limiter in Redis, usage columns in the database (logs only for now), and moving the ~22 other Groq call sites (report comments, session health, lesson/TOC generators, inventory, notification digests, Study Helper...) onto the gateway. Those still call Groq directly and still share its 200K/day; how much they use is not measured yet.

**Review rule.** After about a week of real use look at: tokens per answer, how often the fallback fired, Groq vs Cerebras use, answer quality (run the baseline on both). If there is no clear win, remove the gateway and keep Groq only; if one provider runs dry while the other idles, add balancing.

**Capacity warning.** Together the two free limits allow only about two full assistant answers per minute (a tool-loop turn is 2-4 model calls). That is enough for a pilot, not for a busy school; production needs paid tiers or smaller prompts.

**Open.** Student, fee and attendance data now can leave for Cerebras as well as Groq: the owner must read Cerebras' data-use terms and confirm before it is enabled for real schools (not verified here).

## 16. Implementation status (2026-11-07, all uncommitted)

| Area | State |
|---|---|
| Foundation: tables (migration applied to Supabase), registry, orchestrator, memory `N/10`, API `/api/assistant/` | Built |
| Sub-agent router, role-filtered tools, student guards (daily limit, safety filters) | Built |
| Tools ported: Finance (19 + entries), Academics (21), Communication (15), Study Helper (8), lookups | Built |
| Write engine: propose, preview, edit, approve/reject, stale-check, role re-check, audit | Built |
| Writes: fee payments (bulk), expenses/income (add, edit, delete), lesson plans from book chapters / single draft / delete, diary and homework, attendance | Built |
| Sensitive-data fix for principals/finance managers in the Finance read tools | Built |
| Streaming (server-sent events) and `capabilities` endpoint | Built |
| Web orb: live steps by sub-agent, approval cards with edit, memory counter (switch: `VITE_ASSISTANT_ENABLED=true` or `localStorage.assistant_beta=1`) | Built, checked in a browser with fake data |
| Cerebras lean gateway (§15) | Built; probe passes on a real key |
| Baseline question set (98) and resumable runner | Built; first real numbers pending (quota) |
| Voice, web: record, Whisper transcript into the message box, spoken short replies with subtitles (§17) | Built; blocked only by the Groq project setting for Whisper (see §17); not heard on a real Urdu voice yet |
| Talk mode: the voice-first screen with the big orb (§17b) | Built (web); checked in a browser with a fake microphone and voice; not yet tried with a real voice |
| Mobile orb | Not started |
| Sub-agents Exams, Students & Admissions, HR, Operations | Not started (required for completion) |
| History migration from the old chat tables; removal of the old widgets' code | Not started |
| Roman Urdu dataset evaluation (licences first), conversation list in the UI | Not started |
| Move the other ~22 Groq call sites onto the gateway | Not started (measure first) |

## 17. Voice (web, built 2026-11-07)

**Listening.** `POST /api/assistant/voice/transcribe/` (multipart `audio`, optional `language` auto/ur/en) sends the recording to Groq Whisper (`EDU_STT_MODEL`, default `whisper-large-v3-turbo`; `whisper-large-v3` is the more accurate one) and returns `{text, language, duration}`. A short vocabulary hint (`EDU_STT_PROMPT`) helps Roman Urdu / English mixes. The audio exists only in memory for the request; only its size, length and timing are logged, never the words. Clips Whisper itself marks as no-speech, and mis-taps under 0.4 s, come back empty (it otherwise invents "thank you" from silence). Limits: 4 MB per clip (`EDU_STT_MAX_BYTES`), 60 s recording, 150 voice calls per user per day (`EDU_VOICE_DAILY_PER_USER`), kill switch `EDU_VOICE_ENABLED=false`. Only users who have at least one assistant tool can use it, so it is not a free speech API.

**The words are shown before they are sent.** The transcript goes into the message box. "Send automatically after I speak" is an option, off by default.

**Speaking back.** `POST /api/assistant/voice/spoken/` turns a reply into a one- or two-sentence spoken version (small model tier, about 300-600 tokens; Urdu or Roman Urdu replies become Urdu script, numbers and names kept, no tables). The browser reads it with the voices already on the device (free, nothing leaves the device) and shows it as subtitles with a Stop button. If the device has no Urdu voice the reply stays text with a notice (an English voice never reads Urdu script). Only answers to spoken questions are read aloud, switchable with "Aloud: on/off"; any reply has a Listen button. A card is never approved by voice; only the Approve button does it, and cards stay until acted on.

**Checked.** Backend 40 tests + web 29 tests for voice; probed Groq's real error for a blocked Whisper model; in a browser the recording bar, transcribing state, transcript-in-box and the "no Urdu voice" path all worked (the harness browser had no Urdu voice, which is the normal case to plan for).

**Blocker found on the real key.** Groq answered 403 `model_permission_blocked_project` for both Whisper models: they are blocked in the Groq project settings (console.groq.com -> project -> limits). A project admin must enable them; the key itself is fine (chat works). After that run `manage.py stt_probe --file <clip> --models both --language auto` on real Urdu / Roman Urdu recordings and choose the model and language setting from the result.

**Still open.** Hearing replies on real devices (Android Chrome and Windows usually have an Urdu voice; this must be tested), accuracy of Whisper on real voices (Urdu names must reach the tools in the Latin spelling stored in the database), the mobile app, and a hands-free "keep listening" mode. A cloud text-to-speech provider is only worth adding if the device voices sound poor, and would send reply text to another company.

### 17a. Bug found on first real use (2026-11-08): 406 on every message
The browser opens the stream with `Accept: text/event-stream`, which matches none of DRF's JSON/HTML renderers, so DRF answered **406 "Could not satisfy the request Accept header"** before the view ran. The test client sends no Accept header, so the tests never saw it. Fix: `MessageStreamView` uses `IgnoreAcceptNegotiation` (always the JSON renderer for its small error bodies; the stream itself is a plain streaming response). New tests send the real browser headers (`text/event-stream` on the stream, axios' `application/json, text/plain, */*` on every other assistant endpoint) and fail with 406 if the fix is removed. Audio upload was checked end to end with a real Chromium MediaRecorder recording (`audio/webm;codecs=opus`) through a running backend into Whisper: HTTP 200, correct words. Voice refusals are now logged with their reason in the backend console (never the audio or the words), and errors in the panel name the HTTP status or say the server cannot be reached.

### 17b. Talk mode (web, built 2026-11-08)
A second view of the same assistant, switched with the Talk / Text button in the panel header (remembered per browser; only offered where the device can record and the server has voice on). One large orb in the middle, one line of status, the words, and any change waiting for approval.

| Phase | What happens |
|---|---|
| Ready | "Tap the orb and speak". The last reply stays readable below, with a Listen button. |
| Listening | Red orb, rings swell with the voice, timer. **Stops by itself after 1.5 s of quiet** once speech was heard (loud for 0.32 s or more); gives up after 8 s with no speech and sends nothing. Tap the orb to finish early, Cancel to throw it away. |
| Turning your voice into text | Grey turning orb. |
| Check your words | The transcript with "Sending in 3", Send now, Edit (stops the countdown; the corrected text is what is sent) and Cancel. "Send instantly" removes the wait (remembered). |
| Thinking | The orb takes the working agent's colour, with its name and live step lines. Not tappable. |
| Speaking | Bars move, subtitles under the orb, Stop. Tapping the orb interrupts and starts listening again. Replies are read only for spoken questions ("Aloud" switch); with no Urdu voice on the device the subtitles and the reply text still show. |
| Waiting for you | A card slides up under the orb and stays until a person taps Approve, Edit or Reject; the orb gets smaller so the buttons stay in reach. **Voice never approves.** Older unanswered cards stay visible too. |

Files: `TalkMode.jsx`, `TalkOrb.jsx`, `icons.jsx`, changes in `AssistantOrb.jsx`, `useVoiceInput.js` (silence stop), `agentTheme.js` (SVG colours). 116 web assistant tests cover the phases, the countdown, edit/cancel, silence stop (with a fake audio level), no-speech timeout, speaking and interrupting, cards, and the mode switch.

**To tune on real devices:** the loudness threshold (0.07), the 1.5 s pause and the 8 s no-speech limit are first guesses from a quiet fake input; a noisy classroom may need a higher threshold or a longer pause (constants in `AssistantOrb.jsx` and `useVoiceInput.js`).

## 18. Progress log, 2026-11-08 (Aura)

**Name.** The assistant is called **Aura** (Administrative and Unified Resource Assistant). Screen text says Aura; file and class names still say "Orb".

### Remaining work: 8 groups, status

| # | Group | Status |
|---|---|---|
| 1 | Fixes to what exists | **Done** (uncommitted). F10 tool descriptions (`get_total_expenses` = one total, `get_expense_breakdown` = split by category); `class_key` / `class_matches` in `skills/directory.py` so "8B", "8-b", "Class 8 B", "eighth B" are one class and "5" never matches "15"; `find_student` applies the class before its cut-off; clickable "which one?" buttons (`choices` on the final event, built from `find_student`/`find_class` results, live only, not saved). |
| 2 | Chat screen | **Done** (uncommitted). History view (open, pin, delete with a confirm) using the existing conversation endpoints; markdown tables drawn as real tables (`RichText.jsx`); the system prompt now asks for a markdown table when records share fields. |
| 3 | Four missing agents | **In progress.** Exams **done** (below). HR, Admissions & Students, Operations still to build, one at a time, pausing for approval between agents. |
| 4 | More abilities | Not started: send messages with a preview, parent read access, Study Helper extras (quiz, revision planner, weak topics). |
| 5 | Roman Urdu | Not started: licence check of public datasets first; run the remaining baseline questions on Cerebras (`--restart`, `--delay ~40`); fix misses. |
| 6 | Hardening | Not started: per-school flag, usage numbers, per-user token caps, move ~22 legacy Groq calls to the gateway after measuring, Groq allowed-models vs exam-paper OCR, Cerebras data terms. |
| 7 | Mobile | Not started: orb/Aura and voice in the Expo app. |
| 8 | Real-world checks (user) | Not started: record Urdu / Roman Urdu clips for `stt_probe`; try on Render after the frontend deploy; try Talk mode with a real voice and tune the quiet/pause constants. |

### Exams agent (built)
File `backend/assistant/skills/exam_tools.py`, sub-agent `exams`, module `examinations`. Everything runs through `ExamViewSet`, `ExamSubjectViewSet`, `StudentMarkViewSet`, `AcademicRiskView` as the signed-in user, so teacher scope, the "departed students get no marks" rule and the marks range check are the app's own.

| Tool | Kind | Roles | Notes |
|---|---|---|---|
| `list_exams` | read | admins, teacher | current year; marks entered / expected; teacher sees own scope |
| `get_exam_results` | read | admins, teacher | pass/fail uses the exam's `fail_threshold_subjects` rule; top 5, failed list, per-subject average and pass % |
| `get_marks_entry_status` | read | admins, teacher | missing marks by subject and name |
| `get_student_marks` | read | admins, teacher | needs `student_id` (use `find_student`) |
| `get_grade_scale` | read | admins, teacher | |
| `get_at_risk_students` | read | admins | `AcademicRiskView` |
| `enter_marks` | write | admins, teacher | one subject; card kind `marks_entry`; edit marks or remove students; teacher only for own subject (subjects come from the scoped list) |
| `create_exam` | write | admins | whole-class exam (the single-exam serializer has no section field); starts with all class subjects |
| `reschedule_exam` | write | admins | exam dates and single paper dates; refused for completed / published exams |
| `delete_exam` | write | admins | only SCHEDULED with no marks |

Frontend: card kinds `marks_entry`, `exam_create`, `exam_reschedule`, `delete_exams` in `cardConfig.js`; rose colour in `agentTheme.js`; `ActionCard` passes the row to a cell formatter (so an absent student shows "Absent"). Baseline questions X04, X05, X15, X16, X17. Tests: `assistant/tests/test_exam_tools.py` (29), tool-count and capability tests updated.

### Decisions to remember
- Salary figures (HR): the plan was to show them only to SUPER_ADMIN, SCHOOL_ADMIN, PRINCIPAL; the user was asked whether PRINCIPAL should see them and has **not answered yet**. Ask again before building HR salary reads.
- Teacher scope: Exams = own classes and subjects only; HR = own leave only (proposed, not yet confirmed by the user).
- Left out on purpose: bulk promotion, payroll, role/permission changes, student exit / transfer / re-admission, batch enquiry conversion.
- Docs are updated again after all 8 groups finish (user's instruction); this section is the interim log.

### Fix session 1 (2026-11-09): bugs B1-B7 and scorer corrections
Fixed: B1 `find_student` returns only full-name matches when any exist; B2 prompt says the card is the confirmation; B3 router descriptions sharpened (+ "student or staff, choose both"); B4 legacy `get_attendance_summary` refuses school-wide use; B5 `period` in `list_lesson_plans` / `list_assignments`; B6 `fee_pending` audience and `list_scholarship_recipients`; B7 `get_balance` described as net position to date. Tests: `test_bugfixes_round1.py`, `test_router_and_ports.py`.

Baseline re-run (failed questions only; before = 104/127). **Interim: 116 of 117 answered pass; 10 questions not yet re-run** (X03 X16 X23 X29 X30 X31 X33 X36 X38 X39) because the Cerebras daily budget ran out.

| Group | Before | Now (117 done) |
|---|---|---|
| finance | 23/30 | 30/30 |
| academics | 21/24 | 24/24 |
| communication | 14/19 | 16/17 |
| exams | 4/5 | 4/4 |
| students | 5/8 | 5/5 |
| attendance | 2/3 | 2/2 |
| English | 75/87 | 80/80 |
| Roman Urdu | 29/40 | 36/37 |

Open: C14 (today was a Sunday, no absences with linked parents). Found while running: when Cerebras rests, the Groq fallback fails with 400 "tools: maximum number of items is 128" on turns that offer more than 128 tools, and the runner reports it as a rate limit.

### Learning feature (built 2026-11-09, uncommitted)
Captures what Aura could not do, groups it weekly and shows it to admins. Details, differences from the plan and what is unverified: `docs/handoff/06_LEARNING_FEATURE.md`.
- Tables `AgentGap`, `AgentGapGroup` (`backend/assistant/models.py`, migration `0003_agentgap`, applied on Supabase). Text is redacted (`redact.py`) and kept 90 days; students and parents never have text stored.
- Signals: missing tool (tool or decline text), tool error, denied, card rejected/edited, clarify loop, thumbs. Endpoints: `/api/assistant/feedback/`, `/insights/`, `/insights/groups/<id>/`. Web page `/aura-insights`.
- Celery Beat: `assistant-gap-cleanup` (daily 03:30), `assistant-gap-grouping` (Sundays 04:00). Commands: `group_gaps_now`, `export_gap_questions`.

### Roman Urdu and spelling variants (2026-11-09, uncommitted)

Source for spellings: the Dakshina romanization lexicon, Urdu part (Google Research, **CC BY-SA 4.0**, https://github.com/google-research-datasets/dakshina,
data in `dakshina_dataset_v1.0.tar`). Attribution: "Dakshina dataset, Roark et al. 2020, CC BY-SA 4.0". Share-alike applies to derived data, so the
lexicon, the generated variant question file and every state file that contains variant text are kept OUTSIDE the repository (`D:\data\dakshina`).
Only `roman_urdu_variants.py` (code) is committed. No hand-typed glossary was added.

| Set (school 37, unified mode) | Pass |
|---|---|
| Roman Urdu originals (40) | 37 / 40 (92.5%); X01 and X24 fixed afterwards (3 of 3 runs each); C14 is a data limit: nobody is absent on the run day |
| Spelling variants (72) before the last fixes | 50 / 72 (69%) |
| Spelling variants after fixes (re-run of the real misses only) | about 55 / 72 (76%) |
| Variants without test artefacts (12 name / English-word swaps, 2 C14) | about 55 / 58 (95%); the 12 were judged by reading, not re-run |

Findings and fixes (descriptions, prompts and one guard; no glossary):
- **Fast router returned an empty answer** for many Roman Urdu messages (20 tokens were used up by its reasoning), which silently offered all 144 tools
  (over Groq's 128 limit, so the fallback failed too). `max_tokens` is now 200.
- **Router said "none" for oddly spelled questions**, leaving the model without tools; it then wrote pretend tool calls and invented figures (F02v1, X19v2).
  The router prompt now allows "none" only for greetings and general knowledge, and the system prompt forbids tool-call text and figures that did not come
  from a tool.
- **Urdu-script words inside Latin replies** (3 of 72 variants, 0 of 40 originals): a prompt rule did not hold, so `orchestrator._keep_latin` asks once for a rewrite.
- A tool error that names a tool the router did not offer now adds that read tool (`_tools_named_in_error`); before, the model repeated the failing call.
- Description fixes: communication vs attendance (school-wide counts), finance vs hr (payroll), `find_student(class_name)`, `get_staff_salary`, `get_leave_today`.
- Scorer: `report_missing_capability` is not "data". Generator: capitalised names after the first word are not swapped. Baseline runner waits and retries a question
  when both providers are resting.

Later in the day: X24v1/v2 ("maheeney" read as a staff name) now pass 4 of 4 runs after `get_staff_salary` was changed to tell the model to call
`get_payroll_summary` when no staff member matches. A re-route (one more routing pass using the model's own tool-call summary when the router offered no
tools) was added and unit-tested, but did NOT fix X19v2 in live runs.

Still failing, not fixed: X19v2 ("aaj koon kon chutti paar hai": the router answers "none", and the model reads "chutti" as holiday, so it logs a gap) and
the Groq fallback failing on its 128-tool limit (see `03_HARDENING.md`). A second forced router prompt was tried and reverted: it made greetings route to every
agent. Reply script was re-checked only on the 7 re-run variants (all Latin), not on all 72.

### State of the working tree
Nothing from items 1-3 (Exams), the Talk mode, the 406 fix or the voice diagnostics is committed. Never push without the user's explicit OK. Commit messages carry no Claude co-author trailer unless the user says otherwise.

