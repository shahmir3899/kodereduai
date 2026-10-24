# Authoring guide

## What makes a good demo video
- **One idea.** "Add a specialty to your clinic", not "a tour of the app".
- **45 to 120 seconds.** Longer videos lose people. If it needs more, make chapters or two videos.
- **The viewer sees the result.** End each step on the screen that proves it worked (a saved message, the new item in a list).
- **Nothing that distracts.** No error banners, no dev badges (`target.hide`), no half-loaded pages (`waitFor`).

## Demo data
- Start the app on **this computer** against a **scratch database**. A throwaway Postgres container is ideal; never the database named in the project's real `.env`.
- Make a demo account with an obvious fake name and fake data that fit the story (one clinic, one doctor, a few patients).
- Put sign-in into `setup.login` so the password is never recorded. Provide the password through an environment variable and reference it as `${ENV:NAME}`.
- Make `setup.reset` restore the exact starting state, so a take can be repeated and a failed step can be retried.
- Use `target.forbidden` for patterns that must never appear (real email domains, real names).

## Finding the right words for locators
- Use what a person sees: button texts, labels, tab names. Prefer `{"label": ...}` for fields and `{"role": "tab", "name": ...}` for tabs.
- Open the app with the browser tools and read the page to learn the exact visible words. In a local project, search the source for the label strings.
- If `rehearse` warns that a locator matches several elements, add `nth` or `within`.
- If a button is hidden until something is done, add that action first and an `expect` that proves the state.

## Captions
- At most eight words. "Step 3: Press Add more specialties".
- Put a caption at the `bottom` for steps where the target is at the top, and the other way round (`captionPosition`).

## Narration
- One or two short sentences per step, in the order of the actions. "First, open Settings. Then choose the Specialties tab."
- Say what the person is doing and why, not what the caption already says word for word.
- Numbers and names: write them as they should be spoken. Use `voice.pronounce` for product names ("MediDesk" becomes "Medi Desk").
- The step waits for the speech, so long lines make slow videos. Aim for about 12 words per 5 seconds of screen time.
- Open with `intro.say`: what the video shows and who it is for. Close with `outro.say`: one sentence.

## Urdu
- Write captions, slide text and narration in natural, simple Urdu. Do not translate word for word; keep the same meaning and length.
- Keep product names and button labels exactly as they appear in the app (if the app is English, leave those words in English inside the Urdu sentence).
- Always tell the user the Urdu text needs a native review before it is published.
- Offline Windows voices are English only. For an Urdu voice-over choose the online voice (ask first), the user's own recordings, or leave the Urdu video with captions and music only (`"voice": {"engines": {"ur": "none"}}`).
- Slides and captions use right-to-left layout and Urdu fonts automatically (Jameel Noori Nastaleeq, Urdu Typesetting, Noto Nastaliq if installed).

## Timing and pace
- `style.speed`: `calm` for first-time users, `normal`, `brisk` for experienced ones.
- `hold` adds time after a step. Use 1 to 2 seconds after an important result.
- Slides: heading slide about 5 seconds, longer if its narration is longer.

## Music and sound
- `calm` or `minimal` under voice-over; `warm` or `bright` for a silent walkthrough. The music is lowered automatically while speech plays.
- Users can add their own tracks to the music folder printed by `demo music list`.

## Iterating without wasting takes
1. `validate` (seconds) then `rehearse` (about a quarter of video length).
2. `script` to read the narration out loud.
3. `record`, then open the contact sheet. Fix the scenario for what is wrong and record again.
4. To change only music, volume, preset or captions files, use `render`: no new recording.
