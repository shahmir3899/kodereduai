"""Smart creation: pictures drawn by our own code, so no picture file and no outside service is needed.

A paper refers to one as ``{"make": "<kind>", ...}`` anywhere a picture name is accepted. ``MAKERS`` is
the one list of kinds and their fields; the editor's "Create" tab is built from it.

Like the layouts, a maker never raises on odd values: it draws its nearest sensible picture.
"""
import math
from typing import Any, Callable, Dict, List, Optional, Tuple

from .scene import INK, Scene

SHADE = '#cbd5e1'


def _int(value: Any, default: int, low: int, high: int) -> int:
    try:
        return max(low, min(high, int(value)))
    except (TypeError, ValueError):
        return default


def _num(value: Any, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def _label(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else f'{value:g}'


def _ring(cx: float, cy: float, r: float, sides: int, start_deg: float = -90) -> List[Tuple[float, float]]:
    return [
        (cx + r * math.cos(math.radians(start_deg + 360 * i / sides)),
         cy + r * math.sin(math.radians(start_deg + 360 * i / sides)))
        for i in range(sides)
    ]


POLYGON_SIDES = {'triangle': 3, 'pentagon': 5, 'hexagon': 6, 'octagon': 8}
SHAPES = ['circle', 'oval', 'square', 'rectangle', 'triangle', 'diamond', 'pentagon', 'hexagon', 'octagon', 'star']


def shape(spec: Dict[str, Any]) -> Scene:
    """One flat shape, with an optional word or number written inside it."""
    name = spec.get('shape') if spec.get('shape') in SHAPES else 'circle'
    wide = name in ('oval', 'rectangle')
    scene = Scene(150 if wide else 100, 100)
    cx, cy = scene.width / 2, 50
    if name == 'circle':
        scene.circle(cx, cy, 45, stroke=2.5)
    elif name == 'oval':
        scene.ellipse(cx, cy, 70, 44, stroke=2.5)
    elif name == 'square':
        scene.rect(6, 6, 88, 88, stroke=2.5)
    elif name == 'rectangle':
        scene.rect(5, 10, 140, 80, stroke=2.5)
    elif name == 'diamond':
        scene.polygon([(cx, 4), (92, cy), (cx, 96), (8, cy)], stroke=2.5)
    elif name == 'star':
        outer, inner = _ring(cx, 53, 47, 5), _ring(cx, 53, 19, 5, start_deg=-54)
        scene.polygon([point for pair in zip(outer, inner) for point in pair], stroke=2.5)
    else:
        sides = POLYGON_SIDES[name]
        scene.polygon(_ring(cx, 56 if sides == 3 else 50, 50 if sides == 3 else 46, sides), stroke=2.5)
    if spec.get('label'):
        scene.text(cx, 58 if name == 'triangle' else cy, str(spec['label'])[:6], size=30)
    return scene


def repeat(spec: Dict[str, Any]) -> Scene:
    """The same picture several times, in rows: "5 stars", "12 apples in rows of 4"."""
    count = _int(spec.get('count'), 3, 1, 40)
    per_row = _int(spec.get('per_row'), min(count, 10), 1, 10)
    cell, gap = 60, 10
    rows = math.ceil(count / per_row)
    scene = Scene(per_row * (cell + gap) - gap, rows * (cell + gap) - gap)
    inner = spec.get('picture')
    if isinstance(inner, dict) and inner.get('make') == 'repeat':
        # 40 x 40 x 40 ... : a few nested lines of paper data could ask for millions of shapes.
        inner = ''
    for index in range(count):
        scene.picture(inner or '', (index % per_row) * (cell + gap), (index // per_row) * (cell + gap), cell, cell)
    return scene


def clock(spec: Dict[str, Any]) -> Scene:
    """A clock face. ``time`` like "3:30". ``hands`` false leaves it empty for "draw the hands"."""
    scene = Scene(200, 200)
    cx = cy = 100
    scene.circle(cx, cy, 96, stroke=3)
    for hour in range(1, 13):
        angle = math.radians(hour * 30 - 90)
        cos, sin = math.cos(angle), math.sin(angle)
        scene.line(cx + 88 * cos, cy + 88 * sin, cx + 95 * cos, cy + 95 * sin, stroke=2.5)
        if spec.get('numbers', True):
            scene.text(cx + 72 * cos, cy + 72 * sin, hour, size=20)
    if spec.get('hands', True):
        hours, _, minutes = str(spec.get('time') or '12:00').partition(':')
        hour, minute = _int(hours, 12, 0, 23) % 12, _int(minutes, 0, 0, 59)
        for length, width, degrees in ((70, 3, minute * 6), (46, 5.5, hour * 30 + minute / 2)):
            angle = math.radians(degrees - 90)
            scene.line(cx, cy, cx + length * math.cos(angle), cy + length * math.sin(angle), stroke=width)
    scene.circle(cx, cy, 5, fill=INK)
    return scene


def fraction(spec: Dict[str, Any]) -> Scene:
    """A circle or a bar cut into equal parts, some shaded: 3 of 4 is three quarters."""
    parts = _int(spec.get('parts'), 4, 1, 12)
    shaded = _int(spec.get('shaded'), 1, 0, parts)
    if spec.get('shape') == 'bar':
        cell = 240 / parts
        scene = Scene(244, 64)
        for index in range(parts):
            scene.rect(2 + index * cell, 2, cell, 60, stroke=2.5, fill=SHADE if index < shaded else None)
        return scene
    scene = Scene(200, 200)
    cx = cy = 100
    radius = 95
    for index in range(shaded):
        start, end = 360 * index / parts - 90, 360 * (index + 1) / parts - 90
        steps = max(2, int((end - start) / 6))
        arc = [(cx + radius * math.cos(math.radians(start + (end - start) * s / steps)),
                cy + radius * math.sin(math.radians(start + (end - start) * s / steps))) for s in range(steps + 1)]
        scene.polygon([(cx, cy), *arc], stroke=0.8, fill=SHADE, color=SHADE)
    scene.circle(cx, cy, radius, stroke=3)
    if parts > 1:
        for index in range(parts):
            angle = math.radians(360 * index / parts - 90)
            scene.line(cx, cy, cx + radius * math.cos(angle), cy + radius * math.sin(angle), stroke=2.5)
    return scene


def number_line(spec: Dict[str, Any]) -> Scene:
    """A number line with ticks. Numbers listed in ``hide`` print as an empty box to fill in."""
    start, step = _num(spec.get('start'), 0), abs(_num(spec.get('step'), 1)) or 1
    end = _num(spec.get('end'), start + 10 * step)
    ticks = _int(round((end - start) / step), 10, 1, 20)
    hidden = set()
    for value in spec.get('hide') or []:
        hidden.add(round(_num(value, float('nan')), 6))
    scene = Scene(640, 76)
    left, right, y = 30, 610, 22
    scene.line(8, y, 632, y, stroke=2.5)
    scene.polygon([(2, y), (12, y - 6), (12, y + 6)], fill=INK)
    scene.polygon([(638, y), (628, y - 6), (628, y + 6)], fill=INK)
    for index in range(ticks + 1):
        x = left + (right - left) * index / ticks
        value = start + index * step
        scene.line(x, y - 9, x, y + 9, stroke=2.5)
        if round(value, 6) in hidden:
            scene.rect(x - 13, y + 20, 26, 26, stroke=1.6)
        else:
            scene.text(x, y + 33, _label(value), size=17)
    return scene


def ten_frame(spec: Dict[str, Any]) -> Scene:
    """Two rows of five boxes with counters in some of them; over ten starts a second frame."""
    filled = _int(spec.get('filled'), 5, 0, 20)
    frames = 2 if filled > 10 else 1
    cell, gap = 40, 24
    scene = Scene(frames * 5 * cell + (frames - 1) * gap + 4, 2 * cell + 4)
    for frame in range(frames):
        left = 2 + frame * (5 * cell + gap)
        for index in range(10):
            x, y = left + (index % 5) * cell, 2 + (index // 5) * cell
            scene.rect(x, y, cell, cell, stroke=2)
            if frame * 10 + index < filled:
                scene.circle(x + cell / 2, y + cell / 2, 13, fill=INK)
    return scene


_PIPS = {
    1: [(0, 0)],
    2: [(-1, -1), (1, 1)],
    3: [(-1, -1), (0, 0), (1, 1)],
    4: [(-1, -1), (1, -1), (-1, 1), (1, 1)],
    5: [(-1, -1), (1, -1), (0, 0), (-1, 1), (1, 1)],
    6: [(-1, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (1, 1)],
}


def dice(spec: Dict[str, Any]) -> Scene:
    scene = Scene(100, 100)
    scene.rect(4, 4, 92, 92, stroke=3, radius=14)
    for dx, dy in _PIPS[_int(spec.get('value'), 1, 1, 6)]:
        scene.circle(50 + dx * 25, 50 + dy * 25, 8, fill=INK)
    return scene


def tally(spec: Dict[str, Any]) -> Scene:
    """Tally marks in bundles of five."""
    count = _int(spec.get('count'), 5, 1, 30)
    groups = math.ceil(count / 5)
    scene = Scene(groups * 78 - 14, 70)
    for group in range(groups):
        left = group * 78 + 8
        in_group = min(5, count - group * 5)
        for stick in range(min(4, in_group)):
            scene.line(left + stick * 14, 8, left + stick * 14, 62, stroke=3)
        if in_group == 5:
            scene.line(left - 8, 54, left + 50, 16, stroke=3)
    return scene


def grid(spec: Dict[str, Any]) -> Scene:
    """Squared paper, for drawing shapes, bar charts or graphs."""
    rows, cols = _int(spec.get('rows'), 8, 1, 30), _int(spec.get('cols'), 8, 1, 30)
    cell = 20
    scene = Scene(cols * cell + 2, rows * cell + 2)
    for row in range(rows + 1):
        scene.line(1, 1 + row * cell, 1 + cols * cell, 1 + row * cell, stroke=0.9)
    for col in range(cols + 1):
        scene.line(1 + col * cell, 1, 1 + col * cell, 1 + rows * cell, stroke=0.9)
    return scene


# ``fields`` describes what the editor asks for: name -> {type, and limits or choices}.
MAKERS: Dict[str, Dict[str, Any]] = {
    'shape': {'label': 'Shape', 'draw': shape, 'fields': {
        'shape': {'type': 'choice', 'choices': SHAPES},
        'label': {'type': 'text', 'optional': True},
    }},
    'repeat': {'label': 'Repeat a picture', 'draw': repeat, 'fields': {
        'picture': {'type': 'picture'},
        'count': {'type': 'int', 'min': 1, 'max': 40},
        'per_row': {'type': 'int', 'min': 1, 'max': 10, 'optional': True},
    }},
    'clock': {'label': 'Clock', 'draw': clock, 'fields': {
        'time': {'type': 'text', 'example': '3:30'},
        'hands': {'type': 'bool', 'optional': True},
        'numbers': {'type': 'bool', 'optional': True},
    }},
    'fraction': {'label': 'Fraction', 'draw': fraction, 'fields': {
        'shape': {'type': 'choice', 'choices': ['circle', 'bar']},
        'parts': {'type': 'int', 'min': 1, 'max': 12},
        'shaded': {'type': 'int', 'min': 0, 'max': 12},
    }},
    'number_line': {'label': 'Number line', 'draw': number_line, 'fields': {
        'start': {'type': 'number'},
        'end': {'type': 'number'},
        'step': {'type': 'number', 'optional': True},
        'hide': {'type': 'numbers', 'optional': True},
    }},
    'ten_frame': {'label': 'Ten frame', 'draw': ten_frame, 'fields': {
        'filled': {'type': 'int', 'min': 0, 'max': 20},
    }},
    'dice': {'label': 'Dice', 'draw': dice, 'fields': {
        'value': {'type': 'int', 'min': 1, 'max': 6},
    }},
    'tally': {'label': 'Tally marks', 'draw': tally, 'fields': {
        'count': {'type': 'int', 'min': 1, 'max': 30},
    }},
    'grid': {'label': 'Squared paper', 'draw': grid, 'fields': {
        'rows': {'type': 'int', 'min': 1, 'max': 30},
        'cols': {'type': 'int', 'min': 1, 'max': 30},
    }},
}


def make(spec: Dict[str, Any]) -> Optional[Scene]:
    """The drawing for ``{"make": kind, ...}``, or None when the kind is not known."""
    maker = MAKERS.get(spec.get('make')) if isinstance(spec, dict) else None
    if maker is None:
        return None
    draw: Callable[..., Scene] = maker['draw']
    return draw(spec)


def makers_for_api() -> List[Dict[str, Any]]:
    return [{'kind': kind, 'label': maker['label'], 'fields': maker['fields']} for kind, maker in MAKERS.items()]
