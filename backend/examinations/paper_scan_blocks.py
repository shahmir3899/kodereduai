"""Paper Builder v2, Phase 4: a photo of a paper -> blocks for the block editor.

The vision model is shown the block registry (so the prompt can never drift from the editor) and the
names of the library pictures, and returns blocks directly. What it returns is never trusted as is:
every field is coerced to its registry kind and limits, pictures are matched to the library or cut out
of the photo, and each block is checked with ``validate_block`` and finally ``check_document``. A block
that still fails is dropped and named in ``notes`` so the review screen can say what was not read.

Since Phase 7 this is the only paper scan (web and phone); the old questions-only scan was removed.
"""
import base64
import io
from html import escape
import json
import logging
import re
import time
import uuid
from typing import Any, Dict, List, Optional

import requests
from django.conf import settings

from .paper_blocks.makers import MAKERS
from .paper_blocks.pictures import _catalog
from .paper_blocks.registry import BLOCK_TYPES, LAYOUT_BLOCKS, MAX_ITEMS, validate_block
from .paper_blocks.urdu import ARABIC_SCRIPT, URDU_LETTERS
from .paper_ocr_processor import MSG_AI_BUSY, MSG_GENERIC_FAILURE, _describe_http_error

logger = logging.getLogger(__name__)

SCAN_MODE = 'blocks'
GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
# A page of Play Group activities has at most a dozen drawings; the cap stops a confused model from
# filling storage with hundreds of crops of one photo.
MAX_CROPS_PER_PAGE = 30
# Boxes are on Gemini's native 0-1000 scale ([ymin, xmin, ymax, xmax]); both providers are asked for it.
BOX_SCALE = 1000.0
# Small: a wider margin picked up the dashed frame printed around activity pictures.
CROP_PAD = 0.005

MSG_NO_BLOCKS = "No questions could be read from this photo. Please retake it flat, in good light and fully in frame."


class ScanError(Exception):
    """A failure whose message is safe to show the teacher."""


# Busy or rate-limited: the photo is fine, so the teacher is told to wait, not to retake it.
BUSY_STATUSES = {429, 500, 502, 503, 504}
RETRY_WAIT_SECONDS = 8


def _post_with_retry(url: str, **kwargs) -> 'requests.Response':
    """POST once more after a short wait when the service is busy (Groq answers 503 "over capacity" at
    peak times). One retry only: the scan runs in a background thread and the teacher is polling."""
    response = requests.post(url, **kwargs)
    if response.status_code in BUSY_STATUSES:
        time.sleep(RETRY_WAIT_SECONDS)
        response = requests.post(url, **kwargs)
    return response


def _raise_for(response: 'requests.Response', label: str) -> None:
    if not response.ok:
        logger.error('Paper scan (%s) failed: %s', label, _describe_http_error(response))
        raise ScanError(MSG_AI_BUSY if response.status_code in BUSY_STATUSES else MSG_GENERIC_FAILURE)


# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------

def _describe_field(field: Dict[str, Any]) -> str:
    kind = field['kind']
    if kind == 'list':
        inner = ', '.join(_describe_field(sub) for sub in field['fields'])
        text = f"{field['name']}: list of {{{inner}}}"
    elif kind == 'choice':
        text = f"{field['name']}: one of {'|'.join(field['choices'])}"
    elif kind == 'int' and 'min' in field:
        text = f"{field['name']}: int {field['min']}-{field['max']}"
    elif kind == 'text_list':
        text = f"{field['name']}: list of strings"
    elif kind == 'letter_rows':
        text = f"{field['name']}: list of rows, each a list of single letters"
    else:
        text = f"{field['name']}: {kind}"
    if field.get('max') and kind in ('list', 'text_list', 'letter_rows'):
        text += f" (max {field['max']})"
    if field.get('optional'):
        text += ' (optional)'
    return text


def describe_blocks() -> str:
    lines = []
    for name, spec in BLOCK_TYPES.items():
        if name in LAYOUT_BLOCKS:
            lines.append(f"- {name} ({spec['label']}): no data; use for a printed section heading like 'Section A'.")
            continue
        fields = '; '.join(_describe_field(field) for field in spec['fields']) or 'no fields'
        lines.append(f"- {name} ({spec['label']}, {spec['kind']}): {fields}")
    return '\n'.join(lines)


def library_names() -> List[str]:
    return [entry['name'] for entry in _catalog()]


def build_prompt(context: Optional[Dict[str, Any]] = None, ocr_text: str = '') -> str:
    context = context or {}
    hints = []
    if context.get('class_name'):
        hints.append(f"Class: {context['class_name']}")
    if context.get('subject_name'):
        hints.append(f"Subject: {context['subject_name']}")
    prompt = f"""You read a photo of a school exam paper or worksheet (any class, from Play Group activity papers
with pictures to Grade 12 written papers) and rebuild it as a list of blocks for a paper editor.
{('Known: ' + '; '.join(hints)) if hints else ''}

Block types and their data fields:
{describe_blocks()}

Pictures. Wherever a field is a picture, give EITHER
- the exact name of a library picture from the list below, if the drawing clearly shows that thing, OR
- {{"crop": [ymin, xmin, ymax, xmax], "label": "short description"}}: where that one drawing sits on the
  photo, on a 0-1000 scale (0,0 is the top-left corner), tightly around the drawing only.
Library pictures: {', '.join(library_names())}

Rules:
- One block per printed question, in paper order. Do not invent, merge or skip questions.
- "title" is the question's instruction exactly as printed (keep its wording and punctuation), without the
  question number ("Q1:", "1.") and without the marks; the paper numbers questions itself.
- Parts inside "items" also leave out their own numbers or letters ("1.", "(a)", "ii)"). Instead set the
  block's "numbering" to the style the paper uses for them: "number" for 1. 2. 3., "letter" for (a) (b) or
  (الف) (ب), "roman" for (i) (ii).
- A section_heading's "title" is the heading text exactly as printed; leave out headings you cannot read.
- "marks" is the marks printed for the whole question, or null if none are printed.
- Drawing and writing tasks for young children use the activity blocks (counting pictures -> count_write,
  missing numbers -> missing_sequence, writing practice boxes -> writing_grid or handwriting_lines,
  circle/colour the big or small or long one -> compare_objects, find a letter/number in circles -> find_colour,
  joining two columns -> match_columns, a picture to colour -> colour_picture, pictures with a line to write
  on -> picture_answer, pictures with choices to tick or circle -> picture_choice, letter grids -> letter_grid,
  oral questions -> oral).
- Written questions use the text blocks; the parts of one question go in its "items".
  In missing_sequence, give the full sequence with "" for each empty box.
- Mathematical notation in question and option text goes between $...$ as LaTeX (for example $x^2 + 1$,
  $\\frac{{1}}{{2}}$, $\\sqrt{{49}}$). Plain numbers are written as they are, without $ (9,999 not $9,999$).
  Titles are plain text with no $.
- Fill "answer" or "answers" only when the paper itself shows the answer (an answer key, a ticked or circled
  option). Never work answers out yourself; leave the field out instead.
- Also read the header: school name, exam title, class, subject, total marks, time.
- Urdu (or other right-to-left) papers: copy every word in Urdu script exactly as printed, never translate
  or transliterate. Numbers keep the digits the paper uses. Strip question and part markers too
  ("سوال 1:", "سوال نمبر 2۔", "(الف)", "ب)"). Lists go in reading order, which starts at the RIGHT: the first
  item, box, picture or row of letters is the rightmost one. In match_columns "left" is the first column
  read (printed on the right) and "right" is the other one. Urdu letters ("ا", "ب", "پ") are valid items in
  missing_sequence, find_colour and letter_grid.

Reply with JSON only, in this shape:
{{"header": {{"school_name": "", "exam_title": "", "class_name": "", "subject": "", "total_marks": null,
  "duration_minutes": null}},
 "blocks": [{{"type": "count_write", "title": "Count and write.", "marks": 5,
   "data": {{"rows": [{{"picture": "apple", "count": 3}}]}}}}]}}"""
    if ocr_text.strip():
        # Vision's text is better at small print and handwriting than the vision models; the model is
        # told to trust it for wording but the photo for layout and pictures.
        prompt += (
            "\n\nText read from the same photo by an OCR service (trust it for exact wording and numbers; "
            "use the photo for layout and pictures):\n" + ocr_text[:12000]
        )
    return prompt


# ---------------------------------------------------------------------------
# Provider calls
# ---------------------------------------------------------------------------

def _parse_json(content: str) -> Dict[str, Any]:
    text = (content or '').strip()
    fenced = re.search(r'```(?:json)?\s*(.*?)```', text, re.S)
    if fenced:
        text = fenced.group(1).strip()
    start, end = text.find('{'), text.rfind('}')
    if start < 0 or end <= start:
        raise ValueError('no JSON object in the reply')
    data = json.loads(text[start:end + 1])
    if not isinstance(data, dict):
        raise ValueError('the reply is not an object')
    return data


def _download(image_url: str) -> bytes:
    response = requests.get(image_url, timeout=30)
    response.raise_for_status()
    return response.content


def call_groq(image_url: str, prompt: str) -> Dict[str, Any]:
    from assistant.usage import record_external
    model = getattr(settings, 'PAPER_SCAN_GROQ_MODEL', '')
    response = _post_with_retry(GROQ_URL, timeout=90, headers={
        'Authorization': f"Bearer {getattr(settings, 'GROQ_API_KEY', '')}", 'Content-Type': 'application/json',
    }, json={
        'model': model,
        'messages': [{'role': 'user', 'content': [
            {'type': 'text', 'text': prompt},
            {'type': 'image_url', 'image_url': {'url': image_url}},
        ]}],
        'temperature': 0.1,
        # Groq's free plan allows Qwen 1,000 output tokens a minute and refuses any request whose maximum is
        # higher, so the default fits it; a Play Group page is about 400. A dense written page can need
        # more: raise PAPER_SCAN_GROQ_MAX_TOKENS on a paid Groq plan.
        'max_completion_tokens': getattr(settings, 'PAPER_SCAN_GROQ_MAX_TOKENS', 1000),
        'response_format': {'type': 'json_object'},
    })
    _raise_for(response, f'Groq {model}')
    result = response.json()
    record_external('examinations.paper_scan_blocks', result)
    return _parse_json(result['choices'][0]['message']['content'])


def call_gemini(image_url: str, prompt: str, image_bytes: Optional[bytes] = None) -> Dict[str, Any]:
    model = getattr(settings, 'PAPER_SCAN_GEMINI_MODEL', '')
    key = getattr(settings, 'GEMINI_API_KEY', '')
    if not key:
        raise ScanError('The Gemini scan is not set up on this server.')
    image_bytes = image_bytes if image_bytes is not None else _download(image_url)
    # The key goes in a header, not the address, so it never lands in request logs.
    response = _post_with_retry(GEMINI_URL.format(model=model), timeout=120, headers={
        'x-goog-api-key': key, 'Content-Type': 'application/json',
    }, json={
        'contents': [{'parts': [
            {'inline_data': {'mime_type': 'image/jpeg', 'data': base64.b64encode(image_bytes).decode('ascii')}},
            {'text': prompt},
        ]}],
        'generationConfig': {'temperature': 0.1, 'responseMimeType': 'application/json'},
    })
    _raise_for(response, f'Gemini {model}')
    result = response.json()
    parts = (((result.get('candidates') or [{}])[0].get('content') or {}).get('parts') or [])
    return _parse_json(''.join(part.get('text', '') for part in parts))


# ---------------------------------------------------------------------------
# Vision language hints and figure crops (kept from the old scan, removed in Phase 7)
# ---------------------------------------------------------------------------

# Subject name/code words -> language, for schools that have no curriculum book recorded for the subject.
_SUBJECT_LANGUAGE_WORDS = (
    ('urdu', 'ur'), ('arabic', 'ar'), ('sindhi', 'sd'), ('pashto', 'ps'), ('punjabi', 'pa'),
    ('islamiyat', 'ur'), ('islamic', 'ur'), ('quran', 'ar'), ('nazra', 'ar'), ('deeniyat', 'ur'),
)


def subject_language(context: Optional[Dict[str, Any]]) -> Optional[str]:
    """Language code of the paper's subject: the curriculum book recorded for that class and subject first,
    then words in the subject's name or code. None when nothing says (then English only)."""
    context = context or {}
    subject_id, school_id = context.get('subject_id'), context.get('school_id')
    if subject_id and school_id:
        try:
            from lms.models import Book
            books = Book.objects.filter(school_id=school_id, subject_id=subject_id, is_active=True)
            if context.get('class_id'):
                scoped = books.filter(class_obj_id=context['class_id'])
                books = scoped if scoped.exists() else books
            languages = [lang for lang in books.values_list('language', flat=True) if lang and lang != 'other']
            if languages:
                return max(set(languages), key=languages.count)
        except Exception:
            # Hints are an improvement, never a reason to fail a read.
            logger.warning('Could not look up the subject language', exc_info=True)
    name = f"{context.get('subject_name') or ''} {context.get('subject_code') or ''}".lower()
    for word, code in _SUBJECT_LANGUAGE_WORDS:
        if word in name:
            return code
    return None


def vision_language_hints(context: Optional[Dict[str, Any]]) -> List[str]:
    """Language hints for Vision; English is always included, as for TOC OCR."""
    from lms.toc_ocr import _build_language_hints
    return _build_language_hints(subject_language(context) or 'en')


class _UploadBuffer(io.BytesIO):
    content_type = 'image/jpeg'


def _crop_and_store(image, box: Dict[str, float], school_id: Optional[int]) -> Optional[str]:
    try:
        from core.storage import SupabaseStorageService
        width, height = image.size
        left, right = int(box['x0'] * width), int(box['x1'] * width)
        top, bottom = int(box['y0'] * height), int(box['y1'] * height)
        if right - left < 40 or bottom - top < 40:
            return None
        crop = image.crop((left, top, right, bottom)).convert('RGB')
        buffer = _UploadBuffer()
        crop.save(buffer, format='JPEG', quality=80, optimize=True)
        buffer.seek(0)
        return SupabaseStorageService().upload_file(
            file=buffer, folder=f'papers/{school_id or 0}/figures', filename=f'fig_{uuid.uuid4().hex}.jpg',
        )
    except Exception:
        logger.warning('Could not crop or store a figure', exc_info=True)
        return None


def vision_text(image_url: str, context: Optional[Dict[str, Any]]) -> str:
    """Google Vision's text of the photo, or '' when it is not set up or fails (the scan works without it)."""
    key = getattr(settings, 'GOOGLE_VISION_API_KEY', '')
    if not key:
        return ''
    try:
        response = requests.post(
            'https://vision.googleapis.com/v1/images:annotate', params={'key': key}, timeout=30,
            json={'requests': [{
                'image': {'source': {'imageUri': image_url}},
                'features': [{'type': 'DOCUMENT_TEXT_DETECTION'}],
                'imageContext': {'languageHints': vision_language_hints(context)},
            }]},
        )
        if not response.ok:
            logger.warning('Paper scan: Google Vision failed: %s', _describe_http_error(response))
            return ''
        first = (response.json().get('responses') or [{}])[0]
        return (first.get('fullTextAnnotation') or {}).get('text', '')
    except Exception:
        logger.warning('Paper scan: Google Vision text unavailable', exc_info=True)
        return ''


# ---------------------------------------------------------------------------
# Pictures
# ---------------------------------------------------------------------------

def _norm(text: Any) -> str:
    return re.sub(r'[^\w]+', ' ', str(text or '').lower()).strip()


def _singular(word: str) -> str:
    if word.endswith('ies') and len(word) > 4:
        return word[:-3] + 'y'
    if word.endswith('es') and len(word) > 4 and word[-3] in 'sxz':
        return word[:-2]
    if word.endswith('s') and len(word) > 3 and not word.endswith('ss'):
        return word[:-1]
    return word


def match_library(name: Any) -> Optional[str]:
    """The library picture a model's name means, or None. Exact names win; then the English or Urdu
    name, with "apples"/"an apple"/"Apple" all meaning "apple". When several pictures share a name
    (owl, owl_2) the first one, the plain name, is used."""
    raw = str(name or '').strip()
    if not raw:
        return None
    entries = _catalog()
    names = {entry['name'] for entry in entries}
    if raw in names:
        return raw
    wanted = _norm(raw)
    wanted = re.sub(r'^(a|an|the)\s+', '', wanted)
    candidates = {wanted, _singular(wanted), wanted.replace(' ', '_'), _singular(wanted).replace(' ', '_')}
    if wanted.replace(' ', '_') in names:
        return wanted.replace(' ', '_')
    for entry in entries:
        keys = {_norm(entry['en']), _norm(entry['ur']), _norm(re.sub(r'_\d+$', '', entry['name'])).replace(' ', '_')}
        if candidates & keys:
            return entry['name']
    return None


class _PictureResolver:
    """Turns a model's picture value into a picture the renderer accepts, keeping notes for review."""

    def __init__(self, image_url: str, school_id: Optional[int], image_bytes: Optional[bytes] = None):
        self.image_url = image_url
        self.school_id = school_id
        self._bytes = image_bytes
        self._image = None
        self._image_failed = False
        self.crops = 0
        self.matched = 0
        self.missing: List[str] = []

    def _photo(self):
        if self._image is None and not self._image_failed:
            try:
                from PIL import Image
                data = self._bytes if self._bytes is not None else _download(self.image_url)
                self._image = Image.open(io.BytesIO(data))
                self._image.load()
            except Exception:
                logger.warning('Paper scan: could not open the photo to cut out pictures', exc_info=True)
                self._image_failed = True
        return self._image

    def _crop(self, box: Any) -> Optional[str]:
        if self.crops >= MAX_CROPS_PER_PAGE or not isinstance(box, (list, tuple)) or len(box) != 4:
            return None
        try:
            ymin, xmin, ymax, xmax = (min(max(float(v) / BOX_SCALE, 0.0), 1.0) for v in box)
        except (TypeError, ValueError):
            return None
        if ymax <= ymin or xmax <= xmin:
            return None
        area = (ymax - ymin) * (xmax - xmin)
        # A box over most of the page is the model pointing at the whole question, not one drawing.
        if area < 0.0004 or area > 0.6:
            return None
        image = self._photo()
        if image is None:
            return None
        url = _crop_and_store(image, {
            'x0': max(xmin - CROP_PAD, 0.0), 'x1': min(xmax + CROP_PAD, 1.0),
            'y0': max(ymin - CROP_PAD, 0.0), 'y1': min(ymax + CROP_PAD, 1.0),
        }, self.school_id)
        if url:
            self.crops += 1
        return url

    def resolve(self, value: Any) -> Any:
        if isinstance(value, dict) and value.get('make') in MAKERS:
            return value
        if isinstance(value, dict) and isinstance(value.get('upload'), int) and not isinstance(value.get('upload'), bool):
            return value
        if isinstance(value, dict):
            label = str(value.get('label') or value.get('name') or '').strip()[:60]
            # A library match beats a crop: the library drawing prints sharper than a phone photo.
            named = match_library(value.get('name')) or match_library(label)
            if named:
                self.matched += 1
                return named
            url = self._crop(value.get('crop') or value.get('box'))
            if url:
                return {'url': url}
            self.missing.append(label or 'picture')
            return label or 'picture'
        if isinstance(value, str) and value.strip():
            named = match_library(value)
            if named:
                self.matched += 1
                return named
            # Not in the library: the paper prints a dashed box with this name for the teacher to swap.
            label = value.strip()[:60]
            self.missing.append(label)
            return label
        return None


# ---------------------------------------------------------------------------
# Coercion and checks
# ---------------------------------------------------------------------------

_DOLLAR_MATH = re.compile(r'\$([^$\n]{1,300})\$')
# "$9,999$" is a number, not maths: KaTeX would print it as "9, 999" (a comma is punctuation in maths).
_PLAIN_NUMBER = re.compile(r'-?\d[\d,.\s]*')


def _equation_html(latex: str) -> str:
    """The rich editor's own equation node, so the teacher can edit it as an equation and the page draws it
    (see html_sanitize: data-type="inlineMath")."""
    return (f'<span data-latex="{escape(latex, quote=True)}" data-evaluate="no" data-display="no" '
            f'data-type="inlineMath">${escape(latex, quote=False)}$</span>')


def rich_text(text: str) -> str:
    """The model's plain text for a rich-text field, as editor HTML: the text escaped (a "5 < 7" must not
    read as a tag) and each $...$ turned into an equation, or back into plain text when it is only a number."""
    out, last = [], 0
    for match in _DOLLAR_MATH.finditer(text):
        out.append(escape(text[last:match.start()], quote=False))
        latex = match.group(1).strip()
        if _PLAIN_NUMBER.fullmatch(latex):
            out.append(escape(latex, quote=False))
        elif latex:
            out.append(_equation_html(latex))
        last = match.end()
    out.append(escape(text[last:], quote=False))
    # A line break the model kept (a poem, a couplet list) stays a line break on the page and in Word.
    return re.sub(r'[ \t]*\n\s*', '<br>', ''.join(out).strip())


def _unwrap_math(text: str) -> str:
    """Plain-text fields cannot hold equations: keep what was inside the dollars."""
    return _DOLLAR_MATH.sub(lambda match: match.group(1).strip(), text)


def _to_int(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    try:
        return int(round(float(str(value).strip())))
    except (TypeError, ValueError):
        return None


def _to_number(value: Any) -> Optional[float]:
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError):
        match = re.search(r'\d+(?:\.\d+)?', str(value))
        if not match:
            return None
        number = float(match.group())
    return int(number) if number.is_integer() else number


def _coerce(field: Dict[str, Any], value: Any, pictures: _PictureResolver) -> Any:
    """``value`` made into the field's kind and limits, or None to leave the field out (the registry
    default or "missing" then applies)."""
    kind = field['kind']
    if kind == 'picture':
        resolved = pictures.resolve(value) if value is not None else None
        if resolved is None and not field.get('optional'):
            # A required picture the model left out: keep the question, print an empty box to fill.
            pictures.missing.append('picture')
            return 'picture'
        return resolved
    if value is None:
        return field.get('default')
    if kind in ('text', 'richtext'):
        text = str(value).strip() if not isinstance(value, (dict, list)) else ''
        if kind == 'richtext':
            return rich_text(text)
        text = _unwrap_math(text)
        return text[:field['max_length']] if field.get('max_length') else text
    if kind == 'int':
        number = _to_int(value)
        if number is None:
            return field.get('default')
        return min(max(number, field.get('min', number)), field.get('max', number))
    if kind == 'number':
        number = _to_number(value)
        return None if number is None else max(number, field.get('min', number))
    if kind == 'bool':
        return value if isinstance(value, bool) else str(value).strip().lower() in ('true', 'yes', '1')
    if kind == 'choice':
        for choice in field['choices']:
            if str(value).strip().lower() == choice.lower():
                return choice
        return field.get('default')
    if kind == 'text_list':
        if not isinstance(value, list):
            return []
        items = ['' if item is None else str(item).strip() for item in value if not isinstance(item, (dict, list))]
        return items[:field.get('max', MAX_ITEMS)]
    if kind == 'letter_rows':
        if not isinstance(value, list):
            return []
        rows = []
        for row in value[:field.get('max', MAX_ITEMS)]:
            if isinstance(row, str):
                row = list(row.replace(' ', ''))
            if isinstance(row, list):
                rows.append([str(cell).strip() for cell in row if not isinstance(cell, (dict, list))])
        return rows
    if kind == 'list':
        if not isinstance(value, list):
            return []
        items = []
        for raw in value[:field.get('max', MAX_ITEMS)]:
            if isinstance(raw, str) and len(field['fields']) and field['fields'][0]['kind'] in ('text', 'richtext'):
                raw = {field['fields'][0]['name']: raw}  # a bare string is the item's first text field
            if not isinstance(raw, dict):
                continue
            items.append(_coerce_fields(field['fields'], raw, pictures))
        return items
    return value


def _coerce_fields(fields: List[Dict[str, Any]], raw: Dict[str, Any], pictures: _PictureResolver) -> Dict[str, Any]:
    out = {}
    for field in fields:
        value = _coerce(field, raw.get(field['name']), pictures)
        if value is not None:
            out[field['name']] = value
    return out


def _main_list(spec: Dict[str, Any]) -> Optional[str]:
    for field in spec['fields']:
        if field['kind'] in ('list', 'text_list', 'letter_rows') and not field.get('optional'):
            return field['name']
    return None


# The paper prints its own numbers, so a printed "Q1:" or "2." kept by the model would print twice.
# Urdu papers number questions "سوال 1:" / "سوال نمبر 1۔" and letter parts "(الف)", "ب)", "ج۔" (۔ is the
# Urdu full stop; \d also matches Urdu digits ۱۲۳).
_URDU_PART = '|'.join(URDU_LETTERS)
_QUESTION_NUMBER = re.compile(
    r'^\s*(?:(?:Q|Question)\s*\.?\s*\d+[a-z]?|سوال(?:\s*نمبر)?\s*\d+|\d+)\s*[:.)\-۔](?!\d)\s*', re.I)
_PART_NUMBER = re.compile(
    r'^\s*(?:\(?(?:\d+|[ivx]{1,4}|[a-h])\))\s*|^\s*(?:\d+|[ivx]{1,4}|[a-h])\s*[.:۔]\s+'
    rf'|^\s*\(?(?:{_URDU_PART})\)\s*|^\s*(?:{_URDU_PART})\s*[.:۔]\s+', re.I)


def _strip_part_numbers(data: Dict[str, Any]) -> None:
    items = data.get('items')
    if not isinstance(items, list):
        return
    for item in items:
        if isinstance(item, dict) and isinstance(item.get('text'), str):
            item['text'] = _PART_NUMBER.sub('', item['text'], count=1)


def clean_block(raw: Any, pictures: _PictureResolver) -> Dict[str, Any]:
    """A model block as a block the editor accepts. Raises ValueError with a reason when it cannot be."""
    if not isinstance(raw, dict):
        raise ValueError('not a block')
    kind = str(raw.get('type') or '').strip().lower()
    spec = BLOCK_TYPES.get(kind)
    if spec is None:
        raise ValueError(f"unknown kind of question '{kind or '?'}'")
    title = raw.get('title')
    title = '' if title is None else _unwrap_math(_QUESTION_NUMBER.sub('', str(title).strip(), count=1))
    block = {'id': uuid.uuid4().hex[:12], 'type': kind, 'title': title[:500]}
    if kind in LAYOUT_BLOCKS:
        if not title.strip():
            raise ValueError('a section heading with no words')
        return block
    data = raw.get('data') if isinstance(raw.get('data'), dict) else {}
    block['data'] = _coerce_fields(spec['fields'], data, pictures)
    _strip_part_numbers(block['data'])
    marks = _to_number(raw.get('marks'))
    if marks is not None and marks >= 0:
        block['marks'] = marks
    main = _main_list(spec)
    if main and not block['data'].get(main):
        raise ValueError('nothing was read inside it')
    attempt = block['data'].get('attempt')
    if attempt and attempt > len(block['data'].get('items') or []):
        block['data'].pop('attempt')
    errors = validate_block(block)
    if errors:
        raise ValueError(errors[0])
    return block


def clean_header(raw: Any) -> Dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    header = {}
    for key in ('school_name', 'exam_title', 'class_name', 'subject'):
        value = raw.get(key)
        if isinstance(value, (str, int, float)) and not isinstance(value, bool) and str(value).strip():
            header[key] = str(value).strip()[:200]
    for key in ('total_marks', 'duration_minutes'):
        number = _to_number(raw.get(key))
        if number is not None and number > 0:
            header[key] = number
    return header


_LATIN_LETTER = re.compile('[A-Za-z]')


def text_direction(header: Dict[str, Any], blocks: List[Dict[str, Any]]) -> str:
    """'rtl' when most letters on the page are Urdu (Arabic script). Judged from what was read, so an
    English paper with a few Urdu words, or an Islamiyat paper written in English, stays left to right.
    Picture names are left out: they are English library names on every paper."""
    def texts(value, key=None):
        if key in ('picture', 'id', 'type') or isinstance(value, bool):
            return
        if isinstance(value, str):
            yield value
        elif isinstance(value, dict):
            for k, v in value.items():
                yield from texts(v, k)
        elif isinstance(value, list):
            for v in value:
                yield from texts(v)
    # Rich text carries tags (<p>, data-latex) whose Latin letters are not the paper's words.
    joined = re.sub(r'<[^>]*>', ' ', ' '.join(texts([header, blocks])))
    urdu, latin = len(ARABIC_SCRIPT.findall(joined)), len(_LATIN_LETTER.findall(joined))
    return 'rtl' if urdu > latin else 'ltr'


def clean_result(raw: Dict[str, Any], pictures: _PictureResolver) -> Dict[str, Any]:
    from .paper_document import check_document
    blocks, notes = [], []
    raw_blocks = raw.get('blocks') if isinstance(raw.get('blocks'), list) else []
    for index, raw_block in enumerate(raw_blocks[:100], start=1):
        try:
            blocks.append(clean_block(raw_block, pictures))
        except ValueError as exc:
            title = str((raw_block or {}).get('title') or '').strip() if isinstance(raw_block, dict) else ''
            notes.append(f"Question {index}{' (' + title[:60] + ')' if title else ''} was left out: {exc}.")
    # The whole-paper check also needs settings (crop addresses must be our own storage); a block that
    # fails it on its own is dropped rather than failing the scan.
    if check_document({'blocks': blocks}):
        kept = []
        for block in blocks:
            problems = check_document({'blocks': [block]})
            if problems:
                notes.append(f"'{block.get('title') or block['type']}' was left out: {problems[0]}")
            else:
                kept.append(block)
        blocks = kept
    if pictures.missing:
        unique = list(dict.fromkeys(pictures.missing))
        notes.append('Pictures not found, shown as empty boxes to replace: ' + ', '.join(unique[:12]) + '.')
    header = clean_header(raw.get('header'))
    return {
        'scan_mode': SCAN_MODE,
        'direction': text_direction(header, blocks),
        'header': header,
        'blocks': blocks,
        'notes': notes,
        'pictures': {'library': pictures.matched, 'cropped': pictures.crops, 'missing': len(pictures.missing)},
    }


# ---------------------------------------------------------------------------
# Entry points
# ---------------------------------------------------------------------------

def _read_with(provider: str, image_url: str, prompt: str, image_bytes: Optional[bytes]):
    """(raw reply, model, image bytes) from one provider. Raises ScanError for anything that is the
    service's fault, so the caller can try the next one."""
    try:
        if provider == 'gemini':
            image_bytes = image_bytes if image_bytes is not None else _download(image_url)
            return call_gemini(image_url, prompt, image_bytes), getattr(settings, 'PAPER_SCAN_GEMINI_MODEL', ''), image_bytes
        if provider == 'groq':
            return call_groq(image_url, prompt), getattr(settings, 'PAPER_SCAN_GROQ_MODEL', ''), image_bytes
        raise ScanError(MSG_GENERIC_FAILURE)
    except ScanError:
        raise
    except (ValueError, KeyError, IndexError) as exc:
        logger.error('Paper scan (%s): unreadable reply: %s', provider, exc)
        raise ScanError(MSG_GENERIC_FAILURE)
    except requests.RequestException:
        logger.exception('Paper scan (%s): request failed', provider)
        raise ScanError(MSG_AI_BUSY)


def scan_providers() -> List[str]:
    """The main provider, then the fallback (user decision 2026-11-16: Gemini, then Groq Qwen). Gemini read
    the Play Group test papers with no fixes needed; Qwen needed about six on English, so it is only used
    when Gemini is busy, out of free quota or not set up."""
    providers = []
    for name in (getattr(settings, 'PAPER_SCAN_PROVIDER', 'gemini'), getattr(settings, 'PAPER_SCAN_FALLBACK', 'groq')):
        name = (name or '').strip().lower()
        if name and name not in providers:
            providers.append(name)
    return providers


def scan_page(image_url: str, context: Optional[Dict[str, Any]] = None, provider: Optional[str] = None) -> Dict[str, Any]:
    """One photo -> ``{scan_mode, header, blocks, notes, pictures, provider, model}``. Raises ScanError.

    ``provider`` forces one service (tests, trials); otherwise the main one is tried, then the fallback.
    Only a service failure moves on to the fallback: a reply with no questions in it is the photo's
    problem, and a second service would not see more."""
    context = context or {}
    providers = [provider.lower()] if provider else scan_providers()
    prompt = build_prompt(context, vision_text(image_url, context))
    image_bytes = None
    if 'gemini' in providers:
        # Gemini needs the photo's bytes; fetched once here so a fallback's picture crops reuse them.
        try:
            image_bytes = _download(image_url)
        except requests.RequestException:
            logger.warning('Paper scan: could not fetch the photo', exc_info=True)
    failure: Optional[ScanError] = None
    for index, name in enumerate(providers):
        try:
            raw, model, image_bytes = _read_with(name, image_url, prompt, image_bytes)
        except ScanError as exc:
            failure = exc
            if index + 1 < len(providers):
                logger.warning('Paper scan: %s failed, trying %s', name, providers[index + 1])
            continue
        result = clean_result(raw, _PictureResolver(image_url, context.get('school_id'), image_bytes))
        if not result['blocks']:
            raise ScanError(MSG_NO_BLOCKS)
        result.update(provider=name, model=model)
        if index:
            result['fallback_from'] = providers[0]
        return result
    raise failure or ScanError(MSG_GENERIC_FAILURE)


def _joinable(previous: Dict[str, Any], block: Dict[str, Any]) -> bool:
    """A text question that runs over a page break comes back as two blocks of the same kind; the
    second one has no title or repeats the first one's."""
    if previous.get('type') != block.get('type') or BLOCK_TYPES[block['type']]['kind'] != 'text':
        return False
    if 'items' not in (previous.get('data') or {}) or 'items' not in (block.get('data') or {}):
        return False
    return not block.get('title') or block.get('title') == previous.get('title')


def merge_pages(pages: List[Dict[str, Any]]) -> Dict[str, Any]:
    """The block results of every page of one capture, in page order, as one result."""
    header: Dict[str, Any] = {}
    blocks: List[Dict[str, Any]] = []
    notes: List[str] = []
    totals = {'library': 0, 'cropped': 0, 'missing': 0}
    for number, page in pages:
        page = page or {}
        for key, value in (page.get('header') or {}).items():
            header.setdefault(key, value)
        for index, block in enumerate(page.get('blocks') or []):
            block = dict(block, page_number=number)
            if index == 0 and blocks and _joinable(blocks[-1], block):
                previous = blocks[-1]
                merged_items = (previous['data']['items'] + block['data']['items'])[:MAX_ITEMS]
                previous['data'] = dict(previous['data'], items=merged_items)
                if block.get('marks') is not None:
                    previous['marks'] = (previous.get('marks') or 0) + block['marks']
                continue
            blocks.append(block)
        prefix = f'Page {number}: ' if len(pages) > 1 else ''
        notes.extend(prefix + note for note in page.get('notes') or [])
        for key in totals:
            totals[key] += (page.get('pictures') or {}).get(key, 0)
    directions = [(page or {}).get('direction') for _, page in pages]
    direction = 'rtl' if directions.count('rtl') > directions.count('ltr') else 'ltr'
    return {'scan_mode': SCAN_MODE, 'direction': direction, 'header': header, 'blocks': blocks, 'notes': notes,
            'pictures': totals}
