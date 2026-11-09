# Item 8: real-world checks (owner only)

These cannot be done from code. Do them after the fix session; each line says what to do, what good looks like, and what to tell the next session.

| # | Check | How | Good looks like | If it fails, tell the session |
|---|---|---|---|---|
| 1 | **Urdu and Roman Urdu voice clips** | Record 10 short clips (5 Urdu, 5 Roman Urdu school requests) on the phone; run `python manage.py stt_probe <file>` from `backend/` | Transcript is close to what you said; silence is rejected | The clip, what was heard |
| 2 | **Render deploy** | After the owner approves a push: kodereduai `main`, then bump the submodule in `D:/personal` (memory `repo-layout-personal-gateway`) | `GET https://personal-gateway-sg.onrender.com/educationai/api/assistant/capabilities/` returns 401 (not 404) without a token | The status code and Render logs |
| 3 | **Streaming through Render's proxy** | Log in on the live site with the orb enabled, ask a question | Steps appear live, not all at the end; no 406 or timeout | Browser network tab for `.../stream/` |
| 4 | **Audio upload live** | Press the mic on the live site | Transcript appears; no 403 | Error text (a 403 `model_permission_blocked_project` means the Groq allow-list) |
| 5 | **Talk mode with a real voice** | Open Talk mode, speak with room noise | Starts and stops on pauses; does not cut you off; does not stop at noise | Which of the three constants felt wrong (quiet threshold 0.07, pause 1.5 s, no-speech 8 s) |
| 6 | **Frontend deploy flag** | Build with `VITE_ASSISTANT_ENABLED=true`, or set `localStorage assistant_beta=1` to try | Orb shows for users with tools; hidden when none | Which role did not see it |
| 7 | **Env vars on Render** | `EDU_CEREBRAS_API_KEY` already set; confirm no other secret is needed (all other settings have defaults) | Live answers come from Cerebras (see `llm_status` or logs) | Log lines `llm_call provider=...` |
| 8 | **Groq console allow-list** | Project limits: allow `openai/gpt-oss-120b`, `whisper-large-v3-turbo`, and the vision model used for exam-paper OCR | OCR still works | The model name in the 403 |
| 9 | **Cerebras data terms** | Read their terms (what they keep, training, region) | You are comfortable with what Aura sends (tool results with student names, marks, fees) | Your decision; if no, set `EDU_LLM_CEREBRAS_ENABLED=false` |
| 10 | **Real accounts** | Try a teacher, parent and student account on the demo school | Each sees only their own agents; a parent sees only their children | Role, question, answer |
| 11 | **Urdu names reach the tools** | Say a student name in Urdu and Roman Urdu on a real clip | The transcript spelling still finds the student (names are stored in Latin letters) | The clip, the transcript, the student |
| 12 | **Baseline school state** | School 37 now holds the `BASE` seed data and a current year `BASE_2026-2027` | Manual QA on school 37 still makes sense to you | Anything that looks wrong in screens |

Send the failing items (not the passing ones) in one message so the next session can fix them in one go.
