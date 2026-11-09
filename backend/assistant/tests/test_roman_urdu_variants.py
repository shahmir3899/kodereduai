"""The spelling-variant generator for the Roman Urdu stress test. Uses a tiny made-up lexicon; the real Dakshina data is never in the repo."""
import json
import random

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from assistant.management.commands.roman_urdu_variants import load_variants, make_variant

LEXICON = (
    'حاضری\thazri\t9\n'
    'حاضری\thaazri\t5\n'
    'حاضری\thazree\t3\n'
    'حاضری\thazrii\t1\n'          # one-off spelling: ignored as a probable typo
    'بچے\tbachay\t8\n'
    'بچے\tbachey\t6\n'
    'کتنے\tkitne\t7\n'
    'کتنے\tkitnay\t4\n'
)


@pytest.fixture
def lexicon(tmp_path):
    d = tmp_path / 'lex'
    d.mkdir()
    (d / 'ur.translit.sampled.train.tsv').write_text(LEXICON, encoding='utf-8')
    return d


def test_variants_group_spellings_of_the_same_word_and_drop_one_offs(lexicon):
    v = load_variants(lexicon)
    assert set(v['hazri']) == {'haazri', 'hazree'} and 'hazrii' not in v
    assert 'bachey' in v['bachay'] and 'kitnay' in v['kitne']


def test_only_known_words_change_and_the_rest_is_kept(lexicon):
    v = load_variants(lexicon)
    out = make_variant('Class 5A ki hazri lagao, Ali ghair hazir hai', v, random.Random(1))
    assert out and out != 'Class 5A ki hazri lagao, Ali ghair hazir hai'
    assert 'Class 5A' in out and 'Ali' in out and 'lagao' in out


def test_capitalised_names_after_the_first_word_are_never_swapped(lexicon):
    v = {**load_variants(lexicon), 'bachay': ['bachey'], 'ali': ['ila']}
    for seed in range(20):
        out = make_variant('hazri lagao Ali Bachay', v, random.Random(seed))
        assert out is None or ('Ali' in out and 'Bachay' in out)


def test_capital_letter_is_kept(lexicon):
    out = make_variant('Hazri lagao', load_variants(lexicon), random.Random(2))
    assert out[0].isupper()


def test_text_with_no_known_word_gives_nothing(lexicon):
    assert make_variant('Show timetable', load_variants(lexicon), random.Random(1)) is None


def test_word_with_no_alternative_spelling_is_left_alone():
    # Real lexicon data has words with a single attested spelling; picking from its empty list used to crash.
    assert make_variant('hazri lagao', {'hazri': [], 'lagao': []}, random.Random(1)) is None


def test_command_writes_variants_of_roman_urdu_questions_only(lexicon, tmp_path):
    out = tmp_path / 'variants.json'
    call_command('roman_urdu_variants', lexicon=str(lexicon), out=str(out), per_question=1)
    rows = json.loads(out.read_text(encoding='utf-8'))
    assert rows and all(r['lang'] == 'ur_roman' and r['variant_of'] and r['id'].endswith('v1') for r in rows)


def test_refuses_to_write_inside_the_repository(lexicon):
    from pathlib import Path
    inside = Path(__file__).resolve().parents[3] / 'docs' / 'variants.json'
    with pytest.raises(CommandError):
        call_command('roman_urdu_variants', lexicon=str(lexicon), out=str(inside))


def test_missing_lexicon_is_reported(tmp_path):
    with pytest.raises(CommandError):
        call_command('roman_urdu_variants', lexicon=str(tmp_path), out=str(tmp_path / 'x.json'))
