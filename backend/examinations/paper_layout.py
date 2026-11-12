"""Reads the word geometry Google Vision returns and rebuilds the page the way a person reads it.

Vision's flat ``fullTextAnnotation.text`` follows its own block order, which on a phone photo of a
handwritten page (tilted, curved, sub-questions side by side, numbers stacked as fractions) comes out
scrambled. Every word also comes back with a box and a confidence, so this module:

* straightens the page (the tilt is found from the words themselves, not the image),
* groups words into lines, left to right (right to left for Urdu/Arabic papers),
* joins stacked fractions ("5" over "14" -> "5/14"),
* lifts handwritten marks in the page margin out of the question text (``[MARKS 4]``),
* marks side-by-side parts (`` | ``) and empty answer boxes (``[BLANK]``),
* finds drawings: tall stretches with no writing between two lines (``[FIGURE F1]``),
* drops what is not part of this page (a neighbouring sheet's rotated text, the "Page 3" label),
* gives every line an id and a box so a question can be pointed at on the photo.

Pure functions, no Django and no network: the caller passes the Vision response in.
"""
import math
import re
from dataclasses import dataclass, field
from statistics import median
from typing import Any, Dict, List, Optional, Tuple

# A digit-bearing word read below this confidence is worth a second look by the teacher.
LOW_CONFIDENCE = 0.6
# Words rotated more than this (degrees) are not part of the page body (e.g. the edge of the
# next sheet photographed sideways).
MAX_WORD_ANGLE = 25.0
# Candidate page tilts tried, in degrees.
SKEW_RANGE = (-12.0, 12.0)
SKEW_STEP = 0.25
# A stretch of page with no writing at least this many line-heights tall (and at least this
# fraction of the page) is treated as a drawing.
FIGURE_MIN_LINE_HEIGHTS = 5.0
FIGURE_MIN_PAGE_FRACTION = 0.10
# Horizontal gap, as a fraction of page width, that separates side-by-side parts of a row.
PART_GAP_FRACTION = 0.12
# Width of the page edge where handwritten marks are looked for.
MARGIN_FRACTION = 0.12

_CLOSING = {',', '.', ')', ':', ';', '?', '!', '%'}
_OPENING = {'(', '['}
_MARK_RE = re.compile(r'^\d{1,2}(?:[.,:]\d)?[:.]?$')
_SHORT_INT_RE = re.compile(r'^\d{1,3}$')
_LABEL_ONLY_RE = re.compile(r'^(?:Q|q)?\s*\.?\s*\d{1,2}\s*[.):]?$')


@dataclass
class Word:
    text: str
    conf: float
    # Axis-aligned box on the original photo, in pixels.
    x0: float
    y0: float
    x1: float
    y1: float
    # Centre and size in the straightened page, in pixels.
    cx: float = 0.0
    cy: float = 0.0
    w: float = 0.0
    h: float = 0.0
    angle: float = 0.0


@dataclass
class Line:
    id: int
    words: List[Word]
    text: str
    # Union of the words' original boxes, as 0-1 fractions of the photo.
    box: Dict[str, float]
    marks: Optional[str] = None
    cy: float = 0.0
    top: float = 0.0
    bottom: float = 0.0


@dataclass
class Figure:
    id: str
    # Where to cut on the original photo, as 0-1 fractions.
    box: Dict[str, float]
    after_line: Optional[int]


@dataclass
class Layout:
    page_width: int
    page_height: int
    direction: str
    skew_degrees: float
    lines: List[Line] = field(default_factory=list)
    figures: List[Figure] = field(default_factory=list)
    text: str = ''

    def line(self, line_id: int) -> Optional[Line]:
        return next((ln for ln in self.lines if ln.id == line_id), None)


# --------------------------------------------------------------------------- parsing

def _vertex(v: Dict[str, Any]) -> Tuple[float, float]:
    # Vision omits a coordinate that is exactly 0.
    return float(v.get('x', 0) or 0), float(v.get('y', 0) or 0)


def parse_words(vision_response: Dict[str, Any]) -> Tuple[List[Word], int, int]:
    """Words of the first page of a Vision response, plus the page width and height."""
    pages = (vision_response.get('fullTextAnnotation') or {}).get('pages') or []
    if not pages:
        return [], 0, 0
    page = pages[0]
    width, height = int(page.get('width') or 0), int(page.get('height') or 0)
    words: List[Word] = []
    for block in page.get('blocks', []):
        for paragraph in block.get('paragraphs', []):
            for raw in paragraph.get('words', []):
                text = ''.join(s.get('text', '') for s in raw.get('symbols', [])).strip()
                vertices = (raw.get('boundingBox') or {}).get('vertices') or []
                if not text or len(vertices) < 4:
                    continue
                pts = [_vertex(v) for v in vertices[:4]]
                xs, ys = [p[0] for p in pts], [p[1] for p in pts]
                (ax, ay), (bx, by), (dx, dy) = pts[0], pts[1], pts[3]
                word = Word(
                    text=text, conf=float(raw.get('confidence', 1.0) or 0.0),
                    x0=min(xs), y0=min(ys), x1=max(xs), y1=max(ys),
                    w=math.hypot(bx - ax, by - ay), h=math.hypot(dx - ax, dy - ay),
                    angle=math.degrees(math.atan2(by - ay, bx - ax)),
                    cx=sum(xs) / 4.0, cy=sum(ys) / 4.0,
                )
                words.append(word)
    return words, width, height


# --------------------------------------------------------------------------- straightening

def estimate_skew(words: List[Word]) -> float:
    """Page tilt in degrees (negative: lines rise to the right), by projection profile: the angle at which
    the words' vertical positions pile up into the fewest, sharpest rows."""
    if len(words) < 8:
        return 0.0
    mh = median(w.h for w in words) or 10.0
    bin_size = max(4.0, mh * 0.5)
    best_angle, best_score = 0.0, -1.0
    angle = SKEW_RANGE[0]
    while angle <= SKEW_RANGE[1] + 1e-9:
        rad = math.radians(angle)
        sin_a, cos_a = math.sin(rad), math.cos(rad)
        buckets: Dict[int, int] = {}
        for w in words:
            key = int((w.cy * cos_a - w.cx * sin_a) // bin_size)
            buckets[key] = buckets.get(key, 0) + 1
        score = sum(c * c for c in buckets.values())
        if score > best_score:
            best_angle, best_score = angle, score
        angle += SKEW_STEP
    return best_angle


def _straighten(words: List[Word], skew: float) -> None:
    rad = math.radians(skew)
    sin_a, cos_a = math.sin(rad), math.cos(rad)
    for w in words:
        x, y = w.cx, w.cy
        w.cx = x * cos_a + y * sin_a
        w.cy = y * cos_a - x * sin_a


# --------------------------------------------------------------------------- fractions

def _merge_fractions(words: List[Word]) -> List[Word]:
    """A short number directly above another, centred on it, is a stacked fraction: replace the pair
    with one word "5/14". List labels ("1)" over "2)") are left alone: a label is followed by a bracket."""
    by_id = {id(w): w for w in words}

    def is_label(w: Word) -> bool:
        for other in words:
            if other is w or other.text not in (')', '.', ':', '}'):
                continue
            if 0 <= other.x0 - w.x1 <= 0.8 * w.w + 6 and abs(other.cy - w.cy) < 0.8 * w.h:
                return True
        return False

    def in_math_row(w: Word) -> bool:
        """A real stacked fraction sits in a row of numbers and operators. A number above another in
        running text ("295 sweets ... 364 packets") or in a comma list ("21, 42, 63") is not one."""
        for other in words:
            if other is w or abs(other.cy - w.cy) > 0.65 * max(w.h, other.h):
                continue
            if re.search(r'[A-Za-z]', other.text) and other.text.lower() not in ('x', 'q'):
                return False
            if other.text.endswith(','):
                return False
        return True

    candidates = [w for w in words if _SHORT_INT_RE.match(w.text) and not is_label(w) and in_math_row(w)]
    below_of: Dict[int, Word] = {}
    above_of: Dict[int, Word] = {}
    for n in candidates:
        best = None
        for d in candidates:
            if d is n:
                continue
            h = max(n.h, d.h)
            gap = d.cy - n.cy
            if not (0.8 * h <= gap <= 2.4 * h):
                continue
            if abs(d.cx - n.cx) > 0.6 * max(n.w, d.w) + 4:
                continue
            if best is None or gap < best.cy - n.cy:
                best = d
        if best is not None:
            below_of[id(n)] = best
    for n_id, d in below_of.items():
        n = by_id[n_id]
        current = above_of.get(id(d))
        if current is None or (d.cy - n.cy) < (d.cy - current.cy):
            above_of[id(d)] = n

    drop = set()
    merged = []
    for w in words:
        d = below_of.get(id(w))
        if d is not None and above_of.get(id(d)) is w:
            fraction = Word(
                text=f'{w.text}/{d.text}', conf=min(w.conf, d.conf),
                x0=min(w.x0, d.x0), y0=min(w.y0, d.y0), x1=max(w.x1, d.x1), y1=max(w.y1, d.y1),
                cx=(w.cx + d.cx) / 2, cy=(w.cy + d.cy) / 2, w=max(w.w, d.w), h=w.h + d.h, angle=0.0,
            )
            merged.append(fraction)
            drop.add(id(d))
        elif id(w) not in drop:
            merged.append(w)
    return [w for w in merged if id(w) not in drop]


# --------------------------------------------------------------------------- lines

def _group_lines(words: List[Word], rtl: bool) -> List[List[Word]]:
    """Chain words into rows. Sweeping left to right (right to left for RTL) each word joins the row whose
    last word is vertically nearest, so a row that bends across a curved page still holds together."""
    if not words:
        return []
    mh = median(w.h for w in words) or 10.0
    tolerance = 0.65 * mh
    rows: List[List[Word]] = []
    ordered = sorted(words, key=lambda w: -w.cx if rtl else w.cx)
    for word in ordered:
        best_row, best_dy = None, None
        for row in rows:
            last = row[-1]
            dy = abs(word.cy - last.cy)
            if dy > tolerance:
                continue
            if abs(word.cx - last.cx) <= 0.5 * min(word.w, last.w):
                continue  # sits on top of the last word: a stacked item, not the next word in the row
            if best_dy is None or dy < best_dy:
                best_row, best_dy = row, dy
        if best_row is None:
            rows.append([word])
        else:
            best_row.append(word)
    rows.sort(key=lambda r: sum(w.cy for w in r) / len(r))
    return rows


def _is_margin_mark(word: Word, prev: Optional[Word], page_w: float, rtl: bool) -> bool:
    if not _MARK_RE.match(word.text):
        return False
    if rtl:
        in_margin = (word.x0 + word.x1) / 2 < MARGIN_FRACTION * page_w
    else:
        in_margin = (word.x0 + word.x1) / 2 > (1 - MARGIN_FRACTION) * page_w
    if not in_margin:
        return False
    if prev is None:
        return True
    gap = (prev.cx - word.cx) if rtl else (word.cx - prev.cx)
    # Isolated: an answer option at the page edge ("d, 99,999") sits right beside its neighbour.
    return gap - (word.w + prev.w) / 2 >= 0.05 * page_w


def _row_text(row: List[Word], page_w: float, rtl: bool) -> Tuple[str, Optional[str]]:
    """Joins a row's words, splitting side-by-side parts and marking empty answer boxes.
    Returns (text, margin marks)."""
    marks: Optional[str] = None
    body = list(row)
    if body and _is_margin_mark(body[-1], body[-2] if len(body) > 1 else None, page_w, rtl):
        marks = body.pop().text.rstrip(':.')
    # RTL rows are stored right to left already, so reading order is just list order.
    gaps = []
    for a, b in zip(body, body[1:]):
        gaps.append(abs(b.cx - a.cx) - (a.w + b.w) / 2)
    typical = median(gaps) if gaps else 0.0
    parts: List[str] = []
    for i, word in enumerate(body):
        if i > 0:
            gap = gaps[i - 1]
            prev = body[i - 1]
            if gap >= PART_GAP_FRACTION * page_w:
                parts.append(' | ')
            elif (
                gap >= max(0.05 * page_w, 2.2 * typical)
                and (prev.text.endswith(',') or word.text.startswith(','))
                and re.search(r'\d', prev.text + word.text)
            ):
                parts.append(' [BLANK] ')
            elif word.text in _CLOSING or prev.text in _OPENING:
                pass  # "1)" and "a," read as written, not "1 )"
            else:
                parts.append(' ')
        parts.append(word.text)
    return ''.join(parts).strip(), marks


def _union_box(words: List[Word], page_w: float, page_h: float) -> Dict[str, float]:
    return {
        'x0': round(max(0.0, min(w.x0 for w in words) / page_w), 4),
        'y0': round(max(0.0, min(w.y0 for w in words) / page_h), 4),
        'x1': round(min(1.0, max(w.x1 for w in words) / page_w), 4),
        'y1': round(min(1.0, max(w.y1 for w in words) / page_h), 4),
    }


# --------------------------------------------------------------------------- figures

def _find_figures(lines: List[Line], mh: float, page_w: float, page_h: float) -> List[Figure]:
    """Stretches with no writing between two lines (or after a lone question label at the page foot)."""
    figures: List[Figure] = []
    min_gap = max(FIGURE_MIN_LINE_HEIGHTS * mh, FIGURE_MIN_PAGE_FRACTION * page_h)

    for prev, nxt in zip(lines, lines[1:]):
        if nxt.top - prev.bottom >= min_gap:
            # Between the lines' own boxes (which contain every word of those lines) there is no
            # writing at all, however the photo is tilted, so the crop never clips a neighbour.
            box = {'x0': 0.02, 'y0': prev.box['y1'], 'x1': 0.98, 'y1': nxt.box['y0']}
            if box['y1'] > box['y0']:
                figures.append(Figure(id=f'F{len(figures) + 1}', box=box, after_line=prev.id))
    if lines:
        last = lines[-1]
        label_only = bool(_LABEL_ONLY_RE.match(re.sub(r'\s+', '', last.text)))
        if label_only and page_h - last.bottom >= min_gap:
            box = {'x0': 0.02, 'y0': last.box['y1'], 'x1': 0.98, 'y1': 0.99}
            if box['y1'] > box['y0']:
                figures.append(Figure(id=f'F{len(figures) + 1}', box=box, after_line=last.id))
    return figures


# --------------------------------------------------------------------------- entry points

def build_layout(vision_response: Dict[str, Any], direction: str = 'ltr') -> Optional[Layout]:
    """The page as lines with ids, boxes, marks, fractions and figures; None when Vision found no words
    (the caller then falls back to the flat text)."""
    words, page_w, page_h = parse_words(vision_response)
    if not words or not page_w or not page_h:
        return None
    rtl = direction == 'rtl'

    words = [w for w in words if abs(w.angle) <= MAX_WORD_ANGLE]
    if not words:
        return None
    skew = estimate_skew(words)
    _straighten(words, skew)

    # The "Page 3" label at the top is not paper content.
    words = _drop_page_label(words, page_h)
    words = _merge_fractions(words)
    rows = _group_lines(words, rtl)
    mh = median(w.h for w in words) or 10.0

    layout = Layout(page_width=page_w, page_height=page_h, direction=direction, skew_degrees=round(skew, 2))
    for row in rows:
        text, marks = _row_text(row, page_w, rtl)
        body = row[:-1] if marks is not None else row
        if not text and marks is None:
            continue
        box_words = body or row
        line = Line(
            id=len(layout.lines) + 1, words=row, text=text,
            box=_union_box(box_words, page_w, page_h), marks=marks,
            cy=sum(w.cy for w in row) / len(row),
            top=min(w.cy - w.h / 2 for w in box_words), bottom=max(w.cy + w.h / 2 for w in box_words),
        )
        layout.lines.append(line)

    _attach_stray_marks(layout, mh)
    layout.figures = _find_figures(layout.lines, mh, page_w, page_h)
    layout.text = _render(layout)
    return layout


def _attach_stray_marks(layout: Layout, mh: float) -> None:
    """A mark written in the margin often sits a little above or below its question's row and lands in a
    row of its own. Move it onto the nearest row (within ~1.6 line heights) that has no mark yet."""
    for line in list(layout.lines):
        if line.text or line.marks is None:
            continue
        near = [
            other for other in layout.lines
            if other is not line and other.text and other.marks is None and abs(other.cy - line.cy) <= 1.6 * mh
        ]
        if not near:
            continue
        target = min(near, key=lambda o: abs(o.cy - line.cy))
        target.marks = line.marks
        layout.lines.remove(line)
    for number, line in enumerate(layout.lines, start=1):
        line.id = number


def _drop_page_label(words: List[Word], page_h: float) -> List[Word]:
    drop = set()
    for w in words:
        if w.text.lower() == 'page' and w.cy < 0.08 * page_h:
            drop.add(id(w))
            follower = min(
                (o for o in words if o is not w and o.cx > w.cx and abs(o.cy - w.cy) < w.h and _SHORT_INT_RE.match(o.text)),
                key=lambda o: o.cx - w.cx, default=None,
            )
            if follower is not None and follower.cx - w.cx < 4 * w.w:
                drop.add(id(follower))
    return [w for w in words if id(w) not in drop]


def _render(layout: Layout) -> str:
    out: List[str] = []
    figures_after: Dict[int, List[Figure]] = {}
    for fig in layout.figures:
        figures_after.setdefault(fig.after_line or 0, []).append(fig)
    for line in layout.lines:
        suffix = f' [MARKS {line.marks}]' if line.marks else ''
        out.append(f'[L{line.id}] {line.text}{suffix}')
        for fig in figures_after.get(line.id, []):
            out.append(f'[FIGURE {fig.id}] (a drawing, no text)')
    return '\n'.join(out)


# --------------------------------------------------------------------------- helpers for the caller

def box_for_lines(layout: Layout, first: int, last: int) -> Optional[Dict[str, float]]:
    """Union box of lines first..last (inclusive), 0-1 fractions of the photo."""
    chosen = [ln for ln in layout.lines if first <= ln.id <= last]
    if not chosen:
        return None
    return {
        'x0': min(ln.box['x0'] for ln in chosen), 'y0': min(ln.box['y0'] for ln in chosen),
        'x1': max(ln.box['x1'] for ln in chosen), 'y1': max(ln.box['y1'] for ln in chosen),
    }


def uncertain_notes(layout: Layout, first: int, last: int, limit: int = 5) -> List[str]:
    """Digit-bearing words in lines first..last that Vision was unsure of, for the review screen."""
    notes: List[str] = []
    for ln in layout.lines:
        if not (first <= ln.id <= last):
            continue
        for w in ln.words:
            if w.conf < LOW_CONFIDENCE and re.search(r'\d', w.text):
                notes.append(f'"{w.text}" may be misread')
                if len(notes) >= limit:
                    return notes
    return notes


def figure_after_line(layout: Layout, last_line: int) -> Optional[Figure]:
    """The figure that follows a question ending at ``last_line``, if any."""
    return next((f for f in layout.figures if f.after_line == last_line), None)
