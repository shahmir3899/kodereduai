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

## Talk mode checks
13. **Switch.** Tap "Talk" in the header: the chat gives way to the big orb and no text box. "Chat" goes back. The choice is remembered after closing the app.
14. **Listen and pause.** Tap the orb: it turns red and swells with your voice. Speak one sentence, then stop. It should end by itself about 1.5 s after you stop. If it cuts you off mid-sentence, or never stops in a noisy room, the quiet level (`SPEECH_LEVEL` in `services/assistantTalk.ts`, now 0.25) needs tuning: note the room and what happened.
15. **No speech.** Tap the orb and say nothing: after about 8 s it drops the recording and says it did not hear anything. Nothing is uploaded.
16. **Check your words.** After the grey "turning your voice into text" step, the words appear with "Sending in 3". Let it count down (sends), or tap Edit (countdown stops, fix the words, Send), or Cancel (nothing sent).
17. **Thinking and speaking.** The orb takes the working agent's colour and the step trail shows. The reply is read aloud with a caption and a Stop button. Tapping the orb while it speaks stops it and starts listening.
18. **Cards.** Ask for a change by voice: the orb shrinks, the card stays below it. It is only ever approved by tapping Approve; Edit and Reject work as in chat.
19. **Last reply and choices.** In the ready state the last reply shows with Listen; "which one?" choices appear and a tap on one sends it and the answer is read aloud.
20. **Urdu and no Urdu voice.** Same rules as check 9.

## Welcome, reply text and look
21. **Welcome plays once.** The first time Talk is opened after a tap, a short welcome is read aloud and its words show under the orb. It does not play when the app starts, or on later visits. "Hear what Aura can do" replays it, Skip stops it, "اردو"/"English" switches language (Urdu needs an Urdu voice; otherwise nothing is read and no error shows on the automatic play).
22. **Role wording.** A parent or student welcome never mentions preparing changes.
23. **Talk shows little text.** After a reply only "Listen again" and "Show reply" appear; the full text opens on demand and hides again on the next reply. While speaking, only the short spoken line shows.
24. **Look.** The round Aura button (small orb bars, a slow pulse) sits clear of every role's tab bar. The header has close, a Chat/Talk switch, history and new chat; starter prompts are chips; bubbles and the input bar are rounded.
25. **Name.** Ask "who are you?": the answer says Aura from Education AI (needs the backend deployed).

26. **Move the button.** Press and drag the Aura button anywhere: it follows your finger, then settles against the nearer side edge at the height you dropped it. It never goes under the status bar or over the tab bar. A quick tap (even a slightly shaky one) still opens Aura; a drag never does. Close the app and reopen: it is where you left it. Rotate the phone: it stays on screen.

## Not covered by automated tests
Recording and upload (m4a to `/voice/transcribe/`), `expo/fetch` streaming on a real network, the Urdu voice check, button placement above the tab bar on each shell, keyboard behaviour. The jest files only cover the parser, reducer, card edits, transport (mocked), and speech helpers.
