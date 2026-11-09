# Aura in the mobile app: phone test script

Nothing here has been run on a phone yet. It needs a **new APK** (new native modules `expo-audio` and `expo-speech`, microphone permission) and the server with Aura on.

## Turn it on
- Build with `EXPO_PUBLIC_ASSISTANT_ENABLED=true` (add it to the `preview` env in `eas.json`, or export it for a local build). Without it the app shows no Aura button, like the web's dark default.
- The server decides the rest: `GET /api/assistant/capabilities/` must return agents for the signed-in user, otherwise the button stays hidden.
- Test school: 37 (`SEED_TEST_School_Alpha`), admin `SEED_TEST_admin`.

## Checks
1. **Button.** Each role (admin, teacher, manager, accountant, staff, parent, student) sees the floating "Aura" button on its home. A driver, or a school with Aura off, sees none.
2. **Live steps.** Ask "who is absent today?". You see "Thinking", then step lines with a colour per agent, then the answer. A table answer scrolls sideways.
3. **Stream fallback.** On a network that holds streams back, the answer still arrives (without live steps).
4. **Choices.** Ask about a name with several matches: "which one?" buttons appear on the latest reply only; tapping one sends it.
5. **Cards.** Ask for a change (for example "mark Ali Khan present today"). A card appears. **Edit** (remove a row, change an amount or a status, Update card), **Reject**, and **Approve**. Nothing is saved before Approve. After Approve the card shows the result line and a thumbs control.
6. **Memory and history.** The counter reads N/10. History lists conversations (pinned first); open, pin, delete (asks once). New starts clean. Closing and reopening Aura resumes the latest conversation.
7. **Voice in.** Tap the microphone: the permission prompt appears the first time. Speak, tap Stop: the words land in the box (not sent). Fix them, then Send. A tap shorter than a second says "too short". Recording stops by itself at the server's limit (60 s). Cancel discards it.
8. **Voice out.** After a spoken question, the reply is read aloud (English voice). Typed questions are not read. The speaker button turns reading off.
9. **Urdu.** Ask in Urdu or Roman Urdu with an Urdu voice installed: read in Urdu. With no Urdu voice installed: a notice appears and nothing is read.
10. **Permission denied.** Deny the microphone: the message says to allow it in settings; typing still works.
11. **Session.** Let the access token expire, then ask: the stream retries once after a refresh. Sign out: Aura state is gone for the next user (history differs per user).
12. **Quota.** If the model quota is spent, the error text on screen is the server's plain message, and the app does not crash.

## Not covered by automated tests
Recording and upload (m4a to `/voice/transcribe/`), `expo/fetch` streaming on a real network, the Urdu voice check, button placement above the tab bar on each shell, keyboard behaviour. The jest files only cover the parser, reducer, card edits, transport (mocked), and speech helpers.
