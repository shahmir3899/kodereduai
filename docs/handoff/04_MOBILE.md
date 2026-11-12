# Session 4: Aura and voice in the Expo app (item 7)

## Goal

The same assistant in the mobile app (`mobile/`, Expo 54, React Native 0.81, TypeScript, expo-router): chat with live steps, preview cards with Approve / Edit /
Reject, voice input (Whisper) and spoken replies, history. Roles in the app: admin, teacher, student, parent, manager, finance manager (see `docs/MOBILE.md`).

## What the backend already gives (no backend change should be needed)

- `GET /api/assistant/capabilities/` -> agents and starter prompts for THIS user; hide the entry point when `agents` is empty.
- `POST /api/assistant/conversations/` and `.../<id>/messages/`; **SSE stream** `POST /api/assistant/conversations/<id>/stream/` with events
  `start, route, step (start/end), card, final, error`. The `final` event carries `memory` (N/10 counter), `choices` (clickable "which one?" options), `sub_agents`.
- Cards: `GET /api/assistant/actions/`, `POST /api/assistant/actions/<id>/approve|edit|reject/` (edit payloads: `amounts`, `statuses`, `remove_ids` / `remove_keys`, text fields).
- Voice: `POST /api/assistant/voice/transcribe/` (multipart audio, Groq Whisper, limits and silence filter) and `/voice/spoken/` (Urdu-script reply for speaking).
  The reply language rule: never read an Urdu reply with an English voice; if no Urdu voice exists show a notice instead.
- Every request needs `Authorization` and `X-School-ID`.

## Web code to port (read these, do not copy blindly)

`frontend/src/components/assistant/`: `useAssistant.js` (state, history, streaming), `assistantState.js`, `cardConfig.js` + `ActionCard.jsx` (card kinds), `agentTheme.js`
(colours), `useVoiceInput.js` / `useSpeech.js` / `TalkMode.jsx` (voice), `services/assistantApi.js` (fetch SSE reader). Card kinds are listed in `cardConfig.js`.

## Plan outline

1. **Transport:** React Native `fetch` does not stream response bodies; use `react-native-sse` or `expo/fetch` streaming (check Expo 54 docs) or fall back to polling the
   non-stream endpoint. Decide in the plan.
2. **Screens:** a floating Aura button (only when capabilities has agents), chat screen, history list, card component per kind (reuse a generic table renderer
   driven by `columns` / `rows` from the server; port `cardConfig.js` as `mobile/components/assistant/cardConfig.ts`), edit sheet, choice buttons.
3. **Voice:** `expo-audio` or `expo-av` recording to m4a/webm (check what Whisper accepts; the web sends webm/opus), upload multipart, show the transcript for correction, never
   approve by voice. Speech output with `expo-speech`, Urdu voice check.
4. **Roles:** the portal shells differ (`mobile/app/(admin)`, teacher, student, parent...). One shared component mounted in each layout.
5. **Tests:** jest tests for the SSE reader, card config and the state reducer (mirror `frontend/.../__tests__`). Manual device test list for the owner.

## Cautions

- The mobile tree has unrelated uncommitted work (finance screens, leadership insights, lesson plans): do not touch or commit those files.
- Mobile build or release steps are the owner's; a new APK is one batch at the end.
- Read `docs/MOBILE.md` and `MOBILE_QA.md` first. Do not run the Expo dev server in a way that leaves it running.

## Done means

- Typecheck and the new jest tests pass; a documented manual test script for the phone; no backend change (or a listed one the owner approved).

## Prompt to paste into a fresh session

```
You are continuing work on Aura (the EducationAI assistant) in D:\personal\EducationAI.
Read docs/handoff/00_README.md first (rules, how things fit), then docs/handoff/04_MOBILE.md (your task), then docs/MOBILE.md.
Task: add Aura and voice to the Expo app, reusing the existing backend endpoints. Write a plan first (streaming transport on React Native, screens, voice
recording and speech, role shells, tests) and wait for my OK.
Rules: plan first; no commit or push; no Co-Authored-By; run only new or touched tests (typecheck + the new jest files); do not touch the unrelated uncommitted
mobile files; no database writes; no virtual environments. End with a short recap, what you did not verify on a device, and what you need from me.
```
