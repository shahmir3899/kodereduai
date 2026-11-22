"""Urdu papers: the bundled Nastaliq font, the fixed words a paper prints (Name, Total Marks, True / False)
and part numbering, in English or Urdu.

The font file ships with the app so the page, the Word file and the Word drawings show the same letters on
Render and on a teacher's Windows PC. Noto Nastaliq Urdu has Urdu letters and digits but no Latin letters,
so English words on an Urdu paper fall back to the Latin font.
"""
import base64
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict

FONT_DIR = Path(__file__).resolve().parent / 'fonts'
URDU_FONT = 'Noto Nastaliq Urdu'
FONT_FILES = {False: 'NotoNastaliqUrdu-Regular.ttf', True: 'NotoNastaliqUrdu-Bold.ttf'}

# Arabic script, which Urdu, Sindhi and Pashto use (main block, supplement, extended-A, presentation forms).
ARABIC_SCRIPT = re.compile('[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]')


# A stretch of English inside Urdu text: from a Latin letter, digit or opening bracket up to the last Latin
# letter, digit, closing bracket or full stop before the next Urdu letter, and holding at least one Latin
# letter ("Choose the correct answer.", "(ii), (iii), (iv)", "7x2=14"). Left alone, the bidi rules move its
# brackets, commas and full stop to the Urdu side ("Supervisor immediately." printed as ".Supervisor ...").
# Never starts inside a word or an HTML entity ("&quot;", "&#39;").
_LTR_STRETCH = re.compile(r'(?<![&#A-Za-z0-9])(?:[A-Za-z0-9(\[][^؀-ۿ<>\n]*[A-Za-z0-9)\].!?]|[A-Za-z])')
_LATIN = re.compile('[A-Za-z]')


def latin_stretches(text: str):
    """(start, end) of each English stretch in ``text``."""
    return [m.span() for m in _LTR_STRETCH.finditer(text) if _LATIN.search(m.group())]


def isolate_latin(html: str) -> str:
    """Wraps every English stretch in the page's text (not inside tags, styles, scripts or drawings) in
    <bdi>, so it keeps its own order inside an Urdu paragraph."""
    out, skip = [], None
    for piece in re.split(r'(<[^>]*>)', html):
        if piece.startswith('<'):
            name = re.match(r'</?\s*([a-zA-Z0-9]+)', piece)
            name = name.group(1).lower() if name else ''
            if skip is None and name in ('style', 'script', 'svg', 'title') and not piece.startswith('</'):
                skip = name
            elif skip == name and piece.startswith('</'):
                skip = None
            out.append(piece)
            continue
        if skip or not _LATIN.search(piece):
            out.append(piece)
            continue
        position, parts = 0, []
        for start, end in latin_stretches(piece):
            parts.append(piece[position:start])
            parts.append(f'<bdi>{piece[start:end]}</bdi>')
            position = end
        parts.append(piece[position:])
        out.append(''.join(parts))
    return ''.join(out)


def has_urdu(text: Any) -> bool:
    return bool(ARABIC_SCRIPT.search(str(text or '')))


def is_rtl(document: Dict[str, Any]) -> bool:
    return document.get('direction') == 'rtl'


def font_path(bold: bool) -> Path:
    return FONT_DIR / FONT_FILES[bool(bold)]


@lru_cache(maxsize=2)
def font_bytes(bold: bool) -> bytes:
    return font_path(bold).read_bytes()


@lru_cache(maxsize=1)
def font_face_css() -> str:
    """@font-face rules with the font inside the page (about 680 KB as text). Embedded rather than linked so
    the page stays one file: it prints offline, inside the editor's sandboxed preview and on the phone."""
    rules = []
    for bold, weight in ((False, 400), (True, 700)):
        data = base64.b64encode(font_bytes(bold)).decode('ascii')
        rules.append(
            f'@font-face {{ font-family: "{URDU_FONT}"; font-weight: {weight}; font-display: block; '
            f'src: url(data:font/ttf;base64,{data}) format("truetype"); }}'
        )
    return '\n'.join(rules)


def document_has_urdu(document: Dict[str, Any]) -> bool:
    return is_rtl(document) or has_urdu(document.get('blocks')) or has_urdu(document.get('header'))


# Part letters as Urdu papers write them: الف، ب، ج، د ... (abjad order).
URDU_LETTERS = ['الف', 'ب', 'ج', 'د', 'ہ', 'و', 'ز', 'ح', 'ط', 'ی', 'ک', 'ل', 'م', 'ن', 'س', 'ع', 'ف', 'ص',
                'ق', 'ر', 'ش', 'ت', 'ث', 'خ', 'ذ', 'ض', 'ظ', 'غ']

LABELS = {
    'en': {
        'question': 'Q{n}:', 'name': 'Name', 'roll': 'Roll No', 'date': 'Date', 'paper': 'Paper', 'subject': 'Subject',
        'class': 'Class', 'time': 'Time', 'total_marks': 'Total Marks', 'office': 'For office Use Only',
        'office_question': 'Question', 'office_total': 'Total', 'office_obtained': 'Obtained',
        'sign': 'Teacher’s Sign', 'instructions': 'Instructions', 'attempt': 'Attempt any {n}.',
        'true_false': 'True / False', 'column_a': 'Column A', 'column_b': 'Column B',
        'page': 'Page', 'of': 'of',
    },
    'ur': {
        'question': 'سوال {n}:', 'name': 'نام', 'roll': 'رول نمبر', 'date': 'تاریخ', 'paper': 'مضمون', 'subject': 'مضمون',
        'class': 'جماعت', 'time': 'وقت', 'total_marks': 'کل نمبر', 'office': 'برائے دفتری استعمال',
        'office_question': 'سوال', 'office_total': 'کل نمبر', 'office_obtained': 'حاصل کردہ نمبر',
        'sign': 'دستخط استاد', 'instructions': 'ہدایات', 'attempt': 'کوئی سے {n} حل کریں۔',
        'true_false': 'درست / غلط', 'column_a': 'کالم (الف)', 'column_b': 'کالم (ب)',
        'page': 'صفحہ', 'of': 'از',
    },
}


def labels_for(document: Dict[str, Any]) -> Dict[str, str]:
    """Urdu words for a right-to-left paper, English otherwise. A teacher-typed sign label still wins."""
    return dict(LABELS['ur' if is_rtl(document) else 'en'])


def urdu_letter(index: int) -> str:
    """index counts from 1."""
    return URDU_LETTERS[(index - 1) % len(URDU_LETTERS)]
