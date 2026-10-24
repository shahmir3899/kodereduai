# Scenario format

A scenario is a JSON file (comments with `//` and `/* */` and trailing commas are allowed). `demo init` writes a starter.
Anywhere a text is shown or spoken you may give **one string** (used for every language) or **an object per language**: `{ "en": "...", "ur": "..." }`.
Captions and titles fall back to English if a language is missing. **Narration never falls back**: an Urdu video never speaks English by accident.

## Top level

| Field | Meaning |
|---|---|
| `version` | Always `1` |
| `name` | File-name friendly: lowercase letters, digits, hyphens |
| `languages` | `["en"]`, `["ur"]` or `["en","ur"]`. One video per language |
| `meta` | `app`, `title`, `subtitle`, `learn` (list of 2 to 4 points), `logo` (file path, relative to the scenario, or URL) |
| `target` | Where the app runs and how to show it (below) |
| `setup` | Commands and login that surround the recording (below) |
| `style` | Pace and looks (below) |
| `voice` | Narration engine (below) |
| `music` | Background music (below) |
| `intro` | Heading slide. `true`/omitted = built from `meta`; `false` = none; or an object |
| `outro` | Closing slide object, or omit for none |
| `steps` | The list of steps |

## target

```json
"target": {
  "url": "http://localhost:3000/login",       // first page. Must be on this computer unless the host is in allowHosts
  "start": "/dashboard",                        // optional: page to be on when recording starts (after login)
  "allowHosts": [],                             // extra hosts that are safe, e.g. ["demo.example.test", "*.staging.test"]
  "viewport": { "width": 1280, "height": 720 }, // the video size. Larger = sharper (e.g. 1920x1080)
  "hide": ["nextjs-portal", ".cookie-banner"],  // CSS selectors hidden while recording
  "locale": { "en": "en-US", "ur": "ur-PK" },   // language the app is asked for, if it supports it
  "forbidden": ["@gmail\\.com", "real patient"] // regular expressions; if the page ever shows them, the take stops
}
```

## setup

```json
"setup": {
  "before": [ "docker compose up -d db", { "run": "pnpm dev", "background": true, "waitForUrl": "http://localhost:3000" } ],
  "login":  [ { "type": "demo.owner", "into": { "label": "Username" } },
              { "type": "${ENV:DEMO_PASSWORD}", "into": { "label": "Password" } },
              { "click": "Sign in" }, { "waitFor": { "url": "/dashboard" } } ],
  "reset":  [ "node scripts/reset-demo-data.mjs" ],
  "after":  [ "docker compose down" ]
}
```
- `before` runs once; `reset` before every take; `after` at the end (always, even after a failure). Background commands are stopped for you.
- A command is text, or `{ "run", "cwd", "env", "background", "waitForUrl", "timeout" }`.
- `login` actions run before recording starts, with the cursor and key badges hidden. Passwords: `${ENV:NAME}` only; a missing variable is an error.

## style

| Field | Values |
|---|---|
| `speed` | `calm`, `normal`, `brisk` (how fast the person acts) |
| `theme` | `teal`, `blue`, `slate`, `warm`, or `{ accent, accent2, bg1, bg2, text, captionBg, captionText }` |
| `captionPosition` | `top` (default) or `bottom` (a step can override with its own `captionPosition`) |
| `cursor` | `false` hides the drawn cursor |
| `keys` | `shortcuts` (badge for Ctrl+S, Enter, Tab...), `all`, `none` |
| `cps` | typing speed in characters per second (default 9) |
| `typos` | chance 0..1 of a small typing mistake that is corrected (default 0) |

## voice

```json
"voice": {
  "engine": "sapi",                       // sapi = offline Windows voices | edge = online (needs the user's yes) | files = your recordings | none
  "engines": { "ur": "none" },            // optional per-language override
  "voices": { "en": "Zira", "ur": "ur-PK-UzmaNeural" },
  "rate": 0,                              // -10 slower .. +10 faster
  "pronounce": { "MediDesk": "Medi Desk" },
  "dir": "audio"                          // for files: <step-id>.<lang>.wav (or mp3, m4a)
}
```
File names for slides: `intro`, `outro`, `chapter-<step-id>`. Run `demo voices` to see what is available.

## music

```json
"music": { "track": "calm", "volume": 0.2, "duck": true }
```
`track` is `calm`, `warm`, `bright`, `minimal`, `none`, a name from the music folder (`demo music list`), or a file path. `duck` lowers the music while someone speaks. The final mix is levelled to -16 LUFS.

## intro and outro

```json
"intro": { "kicker": "MediDesk", "headline": {"en": "..."}, "subtitle": {"en": "..."}, "bullets": {"en": ["..."]}, "seconds": 5, "say": {"en": "..."} },
"outro": { "headline": {"en": "That is all"}, "subtitle": {"en": "..."}, "bullets": {"en": ["..."]}, "seconds": 4, "say": {"en": "..."} }
```
Any missing intro field comes from `meta`. A slide stays at least as long as its narration plus one second.

## steps

```json
{
  "id": "open-settings",                          // unique; used in logs and audio file names
  "chapter": { "en": "Your settings" },           // optional chapter card before the step
  "chapterSay": { "en": "Now the settings." },    // optional narration for the chapter card
  "caption": { "en": "Step 1: Open Settings" },   // shown on screen
  "captionPosition": "bottom",                    // optional
  "say": { "en": "First, open Settings." },       // narration; the step lasts at least as long as the speech
  "do": [ { "click": "Settings" } ],              // actions, in order
  "expect": { "text": "Billing settings", "url": "/settings", "selector": "#panel", "notText": "Error", "timeout": 8 },
  "hold": 0.6                                     // seconds to stay after the actions
}
```

## Locators (how to point at something)

A text is shorthand for "the visible text". Or an object with **one** of:

| Key | Finds |
|---|---|
| `text` | an element whose visible text starts with (or equals) this; the clickable parent is used |
| `role` + `name` | `button`, `link`, `textbox`, `checkbox`, `radio`, `tab`, `combobox`, `heading`, `listitem`, `row`, `option`, `menuitem`, `img`; `name` is its label or text |
| `label` | the field with this label |
| `placeholder` | the field with this placeholder |
| `testid` | `data-testid`, `data-test` or `data-cy` |
| `css` | a CSS selector (last resort) |

Plus optional `within` (another locator: search only inside it), `nth` (0 = first), `exact` (whole text must match).
If a locator matches several things, the first is used and a warning is printed: add `nth` or `within`.

## Actions

| Action | Example |
|---|---|
| `goto` | `{"goto": "/settings"}` (relative to the target, must be allowed) |
| `click`, `doubleClick` | `{"click": "Save"}` |
| `hover` | `{"hover": "Reports", "for": 1.2}` (opens real hover menus) |
| `type` | `{"type": "Aisha", "into": {"label": "Name"}, "typos": 0.05}` (clicks the field first; real key presses; Urdu works) |
| `clear` | `{"clear": {"label": "Name"}}` |
| `press` | `{"press": "Enter"}`, `{"press": "Control+S"}` (Tab, Escape, ArrowDown, ...) |
| `scroll` | `{"scroll": {"by": 300}}`, `{"scroll": {"to": "Bottom text"}}`, `{"scroll": {"by": 200, "within": {"css": "#list"}}}` (real wheel) |
| `select` | `{"select": "Green", "in": {"label": "Colour"}}` (native lists) |
| `check`, `uncheck` | `{"check": "I agree"}` |
| `drag` | `{"drag": {"from": "Card A", "to": "Column B"}}` |
| `wait`, `pause` | `{"wait": 1.5}` seconds |
| `waitFor` | `"idle"`, `{"text": "..."}`, `{"gone": "..."}`, `{"url": "..."}`, `{"selector": "..."}` |
| `highlight` | `{"highlight": "Save", "for": 2}` dims everything else |
| `zoom` | `{"zoom": {"css": "#chart"}, "scale": 1.6, "for": 2}` |

Elements out of view are scrolled into view with the wheel automatically. A disabled button cannot be clicked: the step fails.

## output (optional)
`"output": { "dir": "../docs/media" }` sets where the videos, captions, posters and the `qa/` reports go, relative to the scenario file. The `--out` flag overrides it. Without either, results go to `./demo-videos`. Put it in every scenario so videos land in the project, not in a temporary folder.
