# Troubleshooting

| What you see | Why | What to do |
|---|---|---|
| `Refusing to record <host>` | The address is not on this computer | Run the app locally. If a remote demo site is really safe, add its host to `target.allowHosts` |
| `could not find {"text":"X"}: nothing visible matches` | The words differ from the screen, or the element is not on the page yet | Read the failure screenshot; copy the exact visible words; add a `waitFor` before the step |
| `matches 2 elements; the first is used` (warning) | Ambiguous locator | Add `nth` or `within` |
| `X is disabled, so a person could not click it` | A required field is empty | Add the typing/choosing steps before it |
| `expected the page to show "..."` | The action did not do what the video claims | Fix the action or the expected text. Do not weaken `expect` to make it pass |
| `nothing is ready for typing` | `type` without `into` and no field focused | Give `into` |
| `the page shows text that must never be in a demo` | A `target.forbidden` pattern matched | Fix the demo data, then record again |
| `Chrome was not found` | No Chrome/Edge | Install Chrome or set `CHROME_PATH` |
| `No Urdu voice is installed` | Offline voices are English only | Choose the online voice (ask first), own recordings, or `engines: {"ur": "none"}` |
| Exit code 3 and "sends the narration text over the internet" | Online voice not allowed | Ask the user; with a yes add `--allow-online-tts` |
| `The online voice package is not installed` | `edge-tts` missing | With the user's approval: `python -m pip install --user edge-tts` |
| QA: `a black picture from ...` | The page was blank (loading) | Add `waitFor`/`hold` before it |
| QA: `the picture does not change from ... to ...` | A long still moment | Shorten `hold`/`wait`, or add a `scroll`/`highlight` there |
| QA: `no voice is heard where "<step>" should be speaking` | Narration missing or muted | Run `demo render`; check the voice engine and clips |
| QA: `the sound level is ... LUFS` | Unusual music volume | Set `music.volume` (for example 0.15) and `demo render` |
| The page shows an old layout or different language | Wrong locale | Set `target.locale` and check the app supports it |
| Native dropdown list not visible in the video | The page recorder cannot see native popups | Use `--driver desktop` (Windows) or build the step with `click` on a custom list |
| Slow take | The app is slow | Add `{"waitFor": "idle"}`; use `hold`; check the scratch database is local |
| Leftover processes | A run was interrupted | Stop dev servers and `docker rm -f` the scratch container; temporary files are in the system temp folder |

Developer helpers (for fixing the skill itself) are in `tests/` (`debug-run.mjs`, `visual-slides.mjs`, `desktop-manual.mjs`).
Run the automatic tests with `node --test tests/` from the skill folder (about 6 minutes; it opens Chrome without a window).

## Scrolling fails or a number changes by itself
A real mouse wheel over a focused number field changes its value instead of scrolling the page, so a later `scroll` can fail ("could not scroll ... into view"). Leave number fields out of the scenario, or click on empty page space (or press Tab) before scrolling.
