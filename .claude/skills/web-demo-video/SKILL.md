---
name: web-demo-video
description: "Make a polished, human-like walkthrough video (MP4) of a WEB app: a real cursor that glides and hovers, real typing and key presses, smooth scrolling, a heading slide, step captions in English and/or Urdu, optional voice-over and background music, plus captions files and a quality report. Use whenever the user asks for a demo video, walkthrough, tutorial, how-to video, product video, onboarding video or screen recording of a web app or website, even if they do not name this skill. Each app needs its own scenario file (the steps)."
---

# web-demo-video

Turns a **scenario** (a JSON file listing the steps for one app) into an MP4 that looks like a person using the app:
curved, eased pointer movement with real hover effects, genuine key presses, wheel scrolling, click ripples, a heading slide,
step captions (English and Urdu, right-to-left), voice-over, background music that dips under speech, chapters, `.srt`/`.vtt` files,
a poster image and an automatic quality check.

Everything is in `scripts/` (Node 22+, Chrome, ffmpeg; no packages to install). Run it as:

```
node "<this skill folder>/scripts/demo.mjs" <command> ...
```

In this document `demo` means that command. Reference files: `references/scenario-format.md` (every field), `references/authoring-guide.md`
(how to write good steps, narration, Urdu), `references/troubleshooting.md`. A worked example is in `examples/`.

## Hard rules (never break these)

1. **Only record apps running on this computer** (localhost). The tool refuses other addresses. Never aim it at production.
2. **Use made-up data.** Start the app against a scratch/test database with fake people. Never show real patient, customer or staff data.
3. **No passwords in the scenario or on screen.** Sign-in belongs in `setup.login` (done before recording, cursor hidden) and secrets come from `${ENV:NAME}`.
4. **The online voice sends the narration text to Microsoft.** Never use it, or install its package, without the user saying yes in this conversation. Show them the text first (`demo script`). Without a yes, use the offline voice, captions only, or their own recordings.
5. **Clean up.** Stop servers and containers you started, and do not commit the videos unless the user asks.
6. **Do not invent Urdu or product claims silently.** You write the Urdu text, but tell the user it needs their review, and keep narration to what the screen actually shows.

## Workflow (follow in order)

### 1. Check the machine
`demo check`. If something required is missing, tell the user in plain words what to install and stop. Optional items (voices, Urdu fonts) only limit choices.

### 2. Ask the user the choices (one question box, not many messages)
Use AskUserQuestion with at most four questions. Offer defaults in **bold**:
- **Language**: English / Urdu / both. (Urdu captions and slides work everywhere; an Urdu *voice* needs the online voice or their own audio.)
- **Voice-over**: **offline voice (English)** / online Microsoft voice (natural, and the only way to get an Urdu voice; sends text to Microsoft) / my own recordings / no voice.
- **Music**: **calm** / warm / bright / minimal / none / a file from their music folder (`demo music list` shows what exists).
- **Size**: **web 1280x720** / hd 1920x1080 / whatsapp (small, under ~15 MB). And pace: calm / **normal** / brisk.
If the user already answered some of these, do not ask again. If they said "just make it", use the bold defaults.

### 3. Prepare a safe demo environment
Find how the app runs locally. Start it against a **scratch database** (for example a throwaway Docker Postgres, never the project's real `.env` database), seed fake data that makes the story interesting, and create a demo login. Put the start, reset and stop commands in the scenario's `setup.before`, `setup.reset` and `setup.after` so a take can be repeated. Read `references/authoring-guide.md` section "Demo data".

### 4. Learn the app, then write the scenario
- `demo init <name> --url <local url>` writes a starter file.
- Learn the real labels by opening the app with the browser tools you have (read the page, find buttons) and by reading the source if it is local. Use the words **visible on screen** in locators.
- Write steps: one idea per step, a caption of at most eight words, narration of one or two short sentences, an `expect` on every step, and `captionPosition` where a caption would cover a button. Keep the whole video to 45 to 120 seconds.
- Write the heading slide: what the video is about (`meta.title`, `meta.subtitle`, two to four `meta.learn` points) and a short `intro.say`.
- For Urdu, write every caption, title and narration line in Urdu too; mark it for the user's review.

### 5. Validate and rehearse (no recording yet)
```
demo validate <scenario>
demo rehearse <scenario>
```
Fix every failure and every `warning` (an ambiguous locator needs `nth` or `within`). Rehearse until it passes cleanly. A failing step prints the step name, the locator and a screenshot path: look at the screenshot.

### 6. Approve the narration
`demo script <scenario>` prints what will be spoken. Show it to the user. If the voice is online, also say plainly that this exact text will be sent to Microsoft, and wait for their yes. Only then add `--allow-online-tts`.

### 7. Record
```
demo record <scenario> [--lang en|ur|all] [--preset web|hd|whatsapp] [--music calm|...|none] [--voice sapi|edge|files|none] [--allow-online-tts]
```
Do not use the computer's mouse during a take if `--driver desktop` is used; the default page recorder does not care. A take takes about as long as the video plus 30 to 60 seconds. Each language is its own take. Output goes to `./demo-videos/`: `<name>.<lang>.mp4`, `.srt`, `.vtt`, `.poster.jpg`, and `qa/` (contact sheet and report).

### 8. Look at it before showing it
- Read the QA verdict printed at the end. `fail` means do not deliver: fix and record again. `warn` means read the warnings.
- **Open the contact sheet image** (`demo-videos/qa/<name>.<lang>.contact.jpg`) and look: slide, captions readable, nothing hidden by a caption, cursor visible, final state correct, no real data, no error messages.
- Change only what is wrong and record again. To change just the music, level or size, use `demo render <scenario> --music ... --preset ...` (no new take).

### 9. Deliver
Send the MP4(s) to the user (SendUserFile), mention the `.srt` files, and say which choices were used (voice, music, preset). Then clean up: stop servers/containers you started. Offer, do not do, anything extra (another language, another preset).

## Commands

| Command | What it does |
|---|---|
| `check` | Lists what is installed and what is missing, with fixes |
| `init <name> --url URL` | Writes a starter scenario |
| `validate <scenario>` | Finds mistakes without opening a browser |
| `rehearse <scenario>` | Runs every step quickly, no recording |
| `script <scenario> [--lang]` | Prints the narration for approval |
| `voices` | Lists offline voices and how to use the online or your own |
| `music list` / `music build [name\|all]` | Shows or makes the background tracks |
| `record <scenario>` | Full production for each language, with quality checks |
| `render <scenario>` | Redo sound, size and checks from the last take |

Options: `--lang`, `--preset`, `--music`, `--voice`, `--allow-online-tts`, `--driver page|desktop`, `--retries N`, `--out DIR`, `--headed`, `--no-hooks`, `--speed`.

## Limits to remember
- Web apps only. The page recorder (default) captures the page itself at the viewport size, so a sharper video means a larger `target.viewport`.
- A native `<select>` list's open popup is not visible to the page recorder; the `select` action still chooses the option correctly. If the open list must be seen, use `--driver desktop` (Windows only, needs the window visible).
- Offline voices here are English only. Urdu voice needs the online voice (with consent) or the user's recordings.
- Built-in music is simple generated ambient music. It is royalty-free and safe, but plain: the user can pick their own track.
