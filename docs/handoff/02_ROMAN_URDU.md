# Session 2: finish item 5, Roman Urdu

## Where it stands

- **Licence check is done** (summary below). **No dataset has been downloaded.** Downloading needs the owner's OK in chat (state file name, source, size).
- The full baseline already ran on Cerebras: Roman Urdu 29/40 vs English 75/87 (before the fix session). Many Roman Urdu misses were routing, ambiguity or
  data problems, not language. Re-measure after `01_FIX_SESSION.md`.
- `backend/assistant/management/commands/roman_urdu_variants.py` exists and is tested (7 tests in `tests/test_roman_urdu_variants.py`): it rewrites our own Roman
  Urdu questions with other attested spellings of the same word. It needs the Dakshina lexicon files.
- `assistant_baseline --questions <file>` runs any question file with its own state file.
- Owner decision (2026-11-07): **no hand-typed Urdu glossary.** Use public data for evaluation and spelling variants only; school words come from our own data.

## Licence findings (secondary sources; confirm in the repos)

| Dataset | Licence | Use |
|---|---|---|
| MASSIVE (Amazon), `ur-PK`, Urdu script | CC BY 4.0 | Attribution needed; generic intents, not Roman Urdu: skip for now |
| Dakshina (Google), Urdu romanization lexicon | CC BY-SA 4.0 (confirm the repo LICENSE file) | Spelling variants. Share-alike: never commit derived files; keep data and output OUTSIDE the repo |
| UCI Roman Urdu data set | CC BY 4.0 on UCI; the Hugging Face mirror says "unknown" | Optional sample of real spellings |
| Aksharantar (AI4Bharat) | CC BY (hand-collected) / CC0 (mined) | Optional; no per-language provenance |

## Steps

1. Ask the owner to approve the download of the Dakshina Urdu lexicon files (`ur.translit.sampled.{train,dev,test}.tsv`, `google-research-datasets/dakshina`
   on GitHub). Say the file names, the source and the size when asking. Save them OUTSIDE the repo (e.g. the scratchpad or `D:\data\dakshina`).
   Check the repo's LICENSE file and note the result in the plan doc.
2. `python manage.py roman_urdu_variants --lexicon <folder> --out <path outside repo>/ur_variants.json --per-question 2`
3. Run `assistant_baseline --school-id 37 --mode unified --questions <that file> --delay 30 --max-seconds 570` in batches. Compare pass rate with the originals
   (same question ids with a `v1`/`v2` suffix, `variant_of` points to the original).
4. Group the variant misses: wrong sub-agent, wrong tool, wrong argument, wrong reply language. Fix by (in this order): router and tool descriptions, the
   system prompt, a few short Roman Urdu examples taken from OUR passing questions. Never a glossary.
5. Check reply language on the Roman Urdu questions: reply must be Latin letters (previously A09 came back in Urdu script and X15 in Devanagari; a prompt rule was
   added; verify it holds).
6. Re-run only the misses, report the table (English vs Roman Urdu vs variants), add a section to `docs/AI_AGENT_UPGRADE_PLAN.md`.

7. Also in scope from the plan (section 10): compare Whisper on public Urdu clips (Common Voice / FLEURS) with `stt_probe` once the owner approves downloading a few; and see
   `08_BACKLOG_FROM_PLAN.md` items L (normalisation / school vocabulary) and M (150+ questions, run on every prompt change).

## Done means

- Variant pass rate is within about 5 points of the original Roman Urdu rate, or each remaining miss is explained.
- The attribution note for Dakshina (CC BY-SA) is in `docs/` and no derived data is in the repo.

## Prompt to paste into a fresh session

```
You are continuing work on Aura (the EducationAI assistant) in D:\personal\EducationAI.
Read docs/handoff/00_README.md first (rules, how things fit), then docs/handoff/02_ROMAN_URDU.md (your task).
Task: finish the Roman Urdu work. First ask me to approve downloading the Dakshina Urdu lexicon (give file names, source, size); keep the data and any
derived file outside the repo. Then run the spelling-variant test, group the misses, and fix them with descriptions / prompt / few-shot lines from our own
questions (no hand-typed glossary).
Rules: plan first and wait for my OK before code; no commit or push; no Co-Authored-By; run only new or touched tests; no database writes without asking;
no virtual environments. End with a short recap: results table, what you did not verify, what you need from me.
```
