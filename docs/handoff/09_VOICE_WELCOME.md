# Session 9: spoken welcome for Aura (voice intro)

## Goal (from the owner)

Today Aura speaks only in answer to something (a reply the user plays, or a turn in Talk mode). Nothing introduces it. Add a short
**spoken welcome** that tells the user who Aura is and what it can do for THEIR role.

## Facts to start from (checked 2026-11-09)

- Speech out is the browser's own text-to-speech: `frontend/src/components/assistant/useSpeech.js` (`speechSupported`, `scriptOf`, `pickVoice`,
  default hook `useSpeech`). No audio files, no server voice. It picks an Urdu or English voice by the script of the text and shows a notice
  when no Urdu voice is installed.
- Talk mode lives in `TalkMode.jsx` / `TalkOrb.jsx`; mic input in `useVoiceInput.js`, `VoiceBar.jsx`; the orb is `AssistantOrb.jsx`; state in `useAssistant.js`
  and `assistantState.js`; the flag is `flag.js`.
- What Aura can do per user is already served by `GET /api/assistant/capabilities/` (`agents` with `label`, `tools`, `can_write`; `suggestions`).
  It returns empty when the school's switch is off (see `docs/AURA_DATA_FLOW.md` and `backend/assistant/usage.py`), so a welcome must not show then.
- The server already writes a speakable short version of a reply (`POST /api/assistant/voice/spoken/`, uses the cheap model tier and a per-user daily voice cap).
  **The welcome must not use it**: build the text on the client from the capabilities list so it costs no tokens and no voice allowance.
- Replies for Roman Urdu users are turned into Urdu script before speaking; the welcome needs the same rule (Urdu script for Urdu or Roman Urdu users).

## Proposed design (write the real plan and get the owner's OK first)

1. **Text template, no model call.** A small function builds the welcome from `capabilities.agents[].label`, for example
   "Hi, I'm Aura, your school assistant. I can help you with fees, attendance and exams. Just ask, or tap the mic and talk." Roles with a write
   agent add one sentence: "I can also prepare changes, but you always approve them." Parents and students get a shorter, role-appropriate line
   (no mention of changes). Provide English and Urdu (Urdu script) versions; pick by the user's language setting, else by the browser language.
2. **When it plays.** Only when the user starts Talk mode or presses a "Hear what Aura can do" button; never on page load (browsers block autoplay and
   it would surprise people). First Talk mode use plays it once automatically; afterwards only on the button. Remember "heard" in `localStorage`
   (per user id, wrapped in try/catch) so it is not repeated. Always show a **Skip** control and stop on any key, tap or when the user starts speaking.
3. **Also show the same text** in the orb panel so it works with sound off and for deaf users.
4. **No backend change expected.** If a per-school custom greeting is wanted later, that is a new field and needs the owner's sign-off.
5. **Edge cases:** speech not supported (`speechSupported()` false) = text only; no Urdu voice installed = existing notice, fall back to text;
   switch off or empty capabilities = nothing shown; do not repeat when the tab is reopened the same day.

## Tests (only new or touched files)

Frontend, vitest, from `frontend/`: a new `src/components/assistant/__tests__/AssistantWelcome.test.jsx` (text per role, English and Urdu, skip
stops speech, plays once, not when unsupported, not when capabilities are empty) plus any touched existing assistant test files.
Run with `npx vitest run <file>`; do not run the whole suite. If the machine is slow, run one file at a time.

## Done means

- A first-time Talk mode user hears a short welcome in their language that lists only what their role can do; it can be skipped and replayed from a button.
- The same words are visible as text; nothing is spoken on page load.
- The new test file passes; nothing is committed or pushed.

## Prompt to paste into a fresh session

```
You are continuing work on Aura (the EducationAI assistant) in D:\personal\EducationAI.
Read docs/handoff/00_README.md first (rules, how things fit), then docs/handoff/09_VOICE_WELCOME.md (your task).
Task: add a spoken welcome that tells the user who Aura is and what it can do for their role. Start by writing a short plan (text template per role,
English and Urdu, when it plays, skip and replay, tests) and wait for my OK before any code.
Rules: plan first; no commit or push; no Co-Authored-By; run only new or touched test files, one at a time (my laptop struggles with long runs);
no database writes; no schema change without my approval; no virtual environments; never put keys in chat or files.
End with a short recap and a list of what you need from me.
```
