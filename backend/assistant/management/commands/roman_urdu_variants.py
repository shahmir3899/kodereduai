"""Spelling-variant stress test for the Roman Urdu baseline questions.

Roman Urdu has no standard spelling ("hazri", "haazri", "hazree"). This takes our own Roman Urdu baseline questions and swaps words for OTHER
spellings that real people attested for the same Urdu word, using the Dakshina romanization lexicon (Google, CC BY-SA 4.0). It writes a variant
question file; run it with `assistant_baseline --questions <file>` and compare with the original pass rate.

    python manage.py roman_urdu_variants --lexicon <dir-or-file-with-ur.translit.sampled.*.tsv> --out <path.json> [--per-question 2] [--seed 1]

Nothing from the lexicon is stored in the repo: keep the downloaded data and the generated file OUTSIDE the repository (the generated file is a
derivative, so CC BY-SA share-alike would apply to it). Only this script and the attribution are committed.

Lexicon format (Dakshina, one row per attested pair): native_word <TAB> latin_spelling <TAB> count
"""
import json
import random
import re
from collections import defaultdict
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

QUESTIONS = Path(__file__).resolve().parents[2] / 'baseline' / 'questions.json'
WORD = re.compile(r"[A-Za-z]+")
MIN_COUNT = 2           # ignore one-off spellings: they are mostly typos, not variants people agree on


def load_variants(path):
    """{latin spelling (lowercase): [other attested latin spellings of the same Urdu word]}"""
    files = sorted(Path(path).glob('ur.translit.sampled.*.tsv')) if Path(path).is_dir() else [Path(path)]
    if not files:
        raise CommandError(f'no ur.translit.sampled.*.tsv files in {path}')
    by_native = defaultdict(dict)
    for f in files:
        for line in f.read_text(encoding='utf-8').splitlines():
            parts = line.split('\t')
            if len(parts) < 2:
                continue
            native, latin = parts[0].strip(), parts[1].strip().lower()
            count = int(parts[2]) if len(parts) > 2 and parts[2].strip().isdigit() else 1
            if native and latin.isascii() and latin.isalpha():
                by_native[native][latin] = by_native[native].get(latin, 0) + count
    out = defaultdict(set)
    for spellings in by_native.values():
        good = [s for s, c in spellings.items() if c >= MIN_COUNT]
        for s in good:
            out[s].update(x for x in good if x != s)
    return {k: sorted(v) for k, v in out.items()}


def make_variant(text, variants, rng, max_swaps=3):
    """Swap up to `max_swaps` words of `text` for an attested alternative spelling; keep everything else (numbers, class names, names of people)."""
    words = [(m.start(), m.end(), m.group().lower()) for m in WORD.finditer(text)]
    # A word can be in the lexicon with a single attested spelling (empty list): nothing to swap it for, and random.choice would crash.
    swappable = [w for w in words if variants.get(w[2]) and len(w[2]) > 2]
    if not swappable:
        return None
    rng.shuffle(swappable)
    chosen = sorted(swappable[:max_swaps])
    out, last = [], 0
    for start, end, low in chosen:
        original = text[start:end]
        alt = rng.choice(variants[low])
        out.append(text[last:start] + (alt.capitalize() if original[:1].isupper() else alt))
        last = end
    out.append(text[last:])
    return ''.join(out)


class Command(BaseCommand):
    help = 'Write spelling-variant versions of the Roman Urdu baseline questions (lexicon kept outside the repo).'

    def add_arguments(self, parser):
        parser.add_argument('--lexicon', required=True, help='Dakshina ur.translit.sampled.*.tsv file or the folder holding them')
        parser.add_argument('--out', required=True, help='Where to write the variant question file (outside the repo)')
        parser.add_argument('--per-question', type=int, default=2)
        parser.add_argument('--seed', type=int, default=1)

    def handle(self, *args, **opts):
        out = Path(opts['out']).resolve()
        repo = Path(__file__).resolve().parents[4]
        if repo in out.parents:
            raise CommandError('Write the variant file outside the repository (it is a derivative of CC BY-SA data).')
        variants = load_variants(opts['lexicon'])
        rng = random.Random(opts['seed'])
        questions = [q for q in json.loads(QUESTIONS.read_text(encoding='utf-8')) if q['lang'] == 'ur_roman']
        made, seen = [], set()
        for q in questions:
            for n in range(1, opts['per_question'] + 1):
                for _ in range(5):          # a few tries to get a text different from the original and from earlier variants
                    text = make_variant(q['q'], variants, rng)
                    if text and text != q['q'] and (q['id'], text) not in seen:
                        seen.add((q['id'], text))
                        made.append({**q, 'id': f'{q["id"]}v{n}', 'q': text, 'variant_of': q['id']})
                        break
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(made, indent=1, ensure_ascii=False), encoding='utf-8')
        self.stdout.write(f'{len(questions)} Roman Urdu questions -> {len(made)} variants written to {out}')
