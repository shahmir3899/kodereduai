"""Turns one activity block's data into a scene. Each function here is the single place that decides
how that question type looks, for the PDF and for Word.

Missing or odd values fall back to something drawable rather than raising: the teacher fixes a paper by
looking at it, so a wrong-looking block is more useful than an error page.
"""
from typing import Any, Callable, Dict, List

from .scene import INK, LIGHT, Scene

# Scene units across the printable width of an A4 page.
SCENE_WIDTH = 660.0
W = SCENE_WIDTH

RULE_RED = '#dc2626'
RULE_BLUE = '#3b82f6'
RULE_GREY = '#64748b'
FIND_COLOUR_MAX = 20


def _int(value: Any, default: int, low: int = 1, high: int = 30) -> int:
    try:
        return max(low, min(high, int(value)))
    except (TypeError, ValueError):
        return default


def _rows_of(items: List[Any], per_row: int) -> List[List[Any]]:
    return [items[i:i + per_row] for i in range(0, len(items), per_row)] or [[]]


def writing_grid(data: Dict[str, Any]) -> Scene:
    rows, cols = _int(data.get('rows'), 4), _int(data.get('cols'), 5)
    cell_h = 50
    scene = Scene(W, rows * cell_h + 2)
    scene.rect(1, 1, W - 2, rows * cell_h)
    for row in range(1, rows):
        scene.line(1, 1 + row * cell_h, W - 1, 1 + row * cell_h)
    for col in range(1, cols):
        x = 1 + col * (W - 2) / cols
        scene.line(x, 1, x, 1 + rows * cell_h)
    return scene


def handwriting_lines(data: Dict[str, Any]) -> Scene:
    """Four-line copybook rows: red top and bottom, two dashed blue guides between."""
    rows, cols = _int(data.get('rows'), 4), _int(data.get('cols'), 4)
    band, gap = 44, 14
    scene = Scene(W, rows * (band + gap) - gap + 4)
    for row in range(rows):
        top = 2 + row * (band + gap)
        scene.line(0, top, W, top, color=RULE_RED)
        scene.line(0, top + band, W, top + band, color=RULE_RED)
        scene.line(0, top + band / 3, W, top + band / 3, stroke=1, dash=True, color=RULE_BLUE)
        scene.line(0, top + 2 * band / 3, W, top + 2 * band / 3, stroke=1, dash=True, color=RULE_BLUE)
        for col in range(cols + 1):
            x = min(W - 0.5, max(0.5, col * W / cols))
            scene.line(x, top, x, top + band, stroke=1, color=RULE_GREY)
    return scene


def _engine(scene: Scene, x: float, y: float) -> None:
    """A small steam engine, 96 units wide, drawn from plain shapes so it needs no picture file."""
    scene.rect(x, y + 34, 12, 24)                      # buffer
    scene.rect(x + 12, y + 28, 38, 30)                 # boiler
    scene.rect(x + 24, y + 12, 10, 16)                 # chimney
    scene.line(x + 20, y + 12, x + 38, y + 12, stroke=3)
    scene.rect(x + 50, y + 8, 46, 50)                  # cab
    scene.rect(x + 60, y + 16, 26, 18)                 # window
    scene.line(x + 73, y + 16, x + 73, y + 34, stroke=1.2)
    scene.line(x + 60, y + 25, x + 86, y + 25, stroke=1.2)
    for wheel_x in (x + 20, x + 36, x + 62, x + 82):
        scene.circle(wheel_x, y + 65, 5.5, fill='#ffffff')


def missing_sequence(data: Dict[str, Any]) -> Scene:
    """Numbers or letters in order with some left empty. ``shape``: cloud, train or box."""
    items = [str(item or '') for item in (data.get('items') or [])]
    per_row = _int(data.get('per_row'), 4, 1, 8)
    shape = data.get('shape') or 'cloud'
    rows = _rows_of(items, per_row)

    if shape == 'train':
        row_h, engine_x, first_car, gap = 96, 60, 174, 16
        car_w = (W - 2 - first_car - gap * (per_row - 1)) / per_row
        scene = Scene(W, len(rows) * row_h)
        for r, row in enumerate(rows):
            y = r * row_h + 6
            _engine(scene, engine_x, y)
            scene.line(engine_x + 96, y + 36, first_car, y + 36, stroke=2)
            for c, label in enumerate(row):
                x = first_car + c * (car_w + gap)
                scene.rect(x, y + 4, car_w, 56, stroke=2)
                if c < len(row) - 1:
                    scene.line(x + car_w, y + 36, x + car_w + gap, y + 36, stroke=2)
                for wheel_x in (x + car_w * 0.28, x + car_w * 0.72):
                    scene.circle(wheel_x, y + 66, 4.5, fill='#ffffff')
                if label:
                    scene.text(x + car_w / 2, y + 32, label, size=22)
        return scene

    row_h, cell_w = 86, W / per_row
    scene = Scene(W, len(rows) * row_h)
    for r, row in enumerate(rows):
        # A short last row sits in the middle, as a teacher would draw it.
        offset = (per_row - len(row)) * cell_w / 2
        for c, label in enumerate(row):
            cx, cy = offset + (c + 0.5) * cell_w, r * row_h + row_h / 2
            if shape == 'box':
                scene.rect(cx - 32, cy - 32, 64, 64, stroke=2)
            else:
                scene.picture('cloud', cx - 38, cy - 38, 76, 76)
            if label:
                scene.text(cx, cy, label, size=20)
    return scene


def count_write(data: Dict[str, Any]) -> Scene:
    rows = [row for row in (data.get('rows') or []) if isinstance(row, dict)]
    row_h = 60
    scene = Scene(W, max(1, len(rows)) * row_h + 2)
    for r, row in enumerate(rows):
        y = r * row_h
        for i in range(_int(row.get('count'), 1, 1, 7)):
            scene.picture(row.get('picture') or '', 12 + i * 82, y + 8, 44, 44)
        scene.rect(W - 66, y + 7, 56, 46)
        scene.line(0, y + row_h, W, y + row_h, stroke=1, color=LIGHT)
    return scene


def _pencil(scene: Scene, x: float, cy: float, length: float) -> None:
    half = 16
    scene.polygon([(x, cy), (x + 44, cy - half), (x + 44, cy + half)], stroke=2)
    scene.polygon([(x, cy), (x + 14, cy - 5), (x + 14, cy + 5)], stroke=1, fill=INK)
    scene.rect(x + 44, cy - half, length - 44 - 14, half * 2, stroke=2)
    scene.rect(x + length - 30, cy - half, 30, half * 2, stroke=2, radius=14, fill='#ffffff')
    scene.line(x + length - 30, cy - half, x + length - 30, cy + half, stroke=2)
    for dy in (-6, 6):
        scene.line(x + 44, cy + dy, x + length - 30, cy + dy, stroke=1.2)


def compare_objects(data: Dict[str, Any]) -> Scene:
    """``mode`` "size": the same picture big and small, side by side.
    ``mode`` "length": long and short pencils, one under the other."""
    scales = [s for s in (data.get('scales') or [1, 0.5]) if isinstance(s, (int, float)) and 0 < s <= 1] or [1, 0.5]

    if data.get('mode') == 'length':
        row_h = 52
        scene = Scene(W, len(scales) * row_h + 4)
        for i, scale in enumerate(scales):
            _pencil(scene, 36, 26 + i * row_h, max(120, (W - 190) * scale))
        return scene

    scene = Scene(W, 130)
    slot = W / len(scales)
    for i, scale in enumerate(scales):
        box_w, box_h = 190 * scale, 110 * scale
        cx = slot * (i + 0.5)
        scene.picture(data.get('picture') or '', cx - box_w / 2, 65 - box_h / 2, box_w, box_h)
    return scene


def find_colour(data: Dict[str, Any]) -> Scene:
    """A big hollow number or letter with small circles around it; the child colours the matching ones.
    The page has room for 20 circles; any more are left out."""
    items = [str(item) for item in (data.get('items') or [])][:FIND_COLOUR_MAX]
    scene = Scene(W, 182)
    scene.rect(1, 1, W - 2, 180, stroke=1.2, radius=8, color=LIGHT)
    cx, cy = W / 2, 91
    scene.text(cx, cy, str(data.get('target') or '')[:2], size=150, outline=True)
    # Columns of circles going outwards on both sides; every second column is shifted half a step
    # so the circles look scattered but can never overlap.
    slots = []
    for column in range(4):
        offsets = (-56, 0, 56) if column % 2 == 0 else (-28, 28)
        for side in (-1, 1):
            slots.extend((cx + side * (100 + column * 60), cy + dy) for dy in offsets)
    for label, (x, y) in zip(items, slots):
        scene.circle(x, y, 21, stroke=2, fill='#ffffff')
        scene.text(x, y, label, size=18)
    return scene


def _column_item(scene: Scene, item: Any, cx: float, cy: float, box: Any, has_picture: bool) -> None:
    item = item if isinstance(item, dict) else {'text': item}
    picture = item.get('picture')
    if box in ('solid', 'dashed'):
        half_w, half_h = (44, 26) if has_picture else (18, 18)
        scene.rect(cx - half_w, cy - half_h, half_w * 2, half_h * 2, stroke=1.4, dash=box == 'dashed',
                   color=RULE_GREY if box == 'dashed' else INK)
    if picture:
        scene.picture(picture, cx - 26, cy - 22, 52, 44)
    else:
        scene.text(cx, cy, item.get('text') or '', size=20)


def match_columns(data: Dict[str, Any]) -> Scene:
    """Two columns to join with a line. Items are ``{"text": ...}`` or ``{"picture": ...}``."""
    left, right = list(data.get('left') or []), list(data.get('right') or [])

    def any_picture(items):
        return any(isinstance(item, dict) and item.get('picture') for item in items)

    left_pictures, right_pictures = any_picture(left), any_picture(right)
    row_h = 60 if (left_pictures or right_pictures) else 38
    count = max(len(left), len(right), 1)
    scene = Scene(W, count * row_h)
    for index in range(count):
        cy = index * row_h + row_h / 2
        if index < len(left):
            _column_item(scene, left[index], W * 0.2, cy, data.get('left_box'), left_pictures)
            if data.get('dots'):
                scene.circle(W * 0.3, cy, 3.5, fill=INK)
        if index < len(right):
            _column_item(scene, right[index], W * 0.8, cy, data.get('right_box'), right_pictures)
            if data.get('dots'):
                scene.circle(W * 0.7, cy, 3.5, fill=INK)
    return scene


def letter_grid(data: Dict[str, Any]) -> Scene:
    """Rows of letters to circle, with an optional picture on the right."""
    rows = [list(row) for row in (data.get('rows') or []) if isinstance(row, (list, tuple))]
    picture = data.get('picture')
    row_h = 50
    height = max(1, len(rows)) * row_h
    grid_w = W * 0.62 if picture else W
    scene = Scene(W, height + 4)
    for r, row in enumerate(rows):
        for c, label in enumerate(row):
            scene.text((c + 0.5) * grid_w / max(1, len(row)), 2 + r * row_h + row_h / 2, label, size=20)
    if picture:
        scene.rect(W * 0.645, 2, W * 0.355 - 1, height, stroke=1.6)
        scene.picture(picture, W * 0.645 + 14, 12, W * 0.355 - 29, height - 20)
    return scene


def picture_choice(data: Dict[str, Any]) -> Scene:
    """Cards with a picture on top and the choices below; the child circles the right one."""
    items = [item for item in (data.get('items') or []) if isinstance(item, dict)]
    per_row = _int(data.get('per_row'), 3, 1, 4)
    gap, picture_h, option_h = 12, 76, 40
    card_w = (W - gap * (per_row - 1)) / per_row
    card_h = picture_h + option_h
    rows = _rows_of(items, per_row)
    scene = Scene(W, len(rows) * (card_h + 8))
    for r, row in enumerate(rows):
        for c, item in enumerate(row):
            x, y = c * (card_w + gap) + 0.5, r * (card_h + 8) + 1
            scene.rect(x, y, card_w - 1, card_h, stroke=1.4)
            scene.line(x, y + picture_h, x + card_w - 1, y + picture_h, stroke=1.4)
            scene.picture(item.get('picture') or '', x + 10, y + 8, card_w - 21, picture_h - 16)
            options = [str(option) for option in (item.get('options') or [])][:4]
            for o, option in enumerate(options):
                option_w = (card_w - 1) / len(options)
                if o:
                    scene.line(x + o * option_w, y + picture_h, x + o * option_w, y + card_h, stroke=1.4)
                # Words ("Hexagon") get smaller letters than single letters so they stay in the box.
                size = max(11, min(20, 1.35 * option_w / max(1, len(option))))
                scene.text(x + (o + 0.5) * option_w, y + picture_h + option_h / 2, option, size=size)
    return scene


def colour_picture(data: Dict[str, Any]) -> Scene:
    height = _int(data.get('height'), 380, 120, 760)
    scene = Scene(W, height + 2)
    frame = data.get('frame') or 'solid'
    if frame != 'none':
        scene.rect(1, 1, W - 2, height, stroke=1.2, radius=6 if frame == 'dashed' else 0,
                   dash=frame == 'dashed', color=RULE_GREY if frame == 'dashed' else INK)
    scene.picture(data.get('picture') or '', 12, 10, W - 24, height - 18)
    return scene


def picture_answer(data: Dict[str, Any]) -> Scene:
    """Pictures in a row, each with room to write under it: "name the picture", "what time is it?".
    ``answer``: line, box or none."""
    items = [item if isinstance(item, dict) else {'picture': item} for item in (data.get('items') or [])]
    per_row = _int(data.get('per_row'), 3, 1, 5)
    answer = data.get('answer') or 'line'
    cell_w, picture_h = W / per_row, 108
    answer_h = 0 if answer == 'none' else 44
    row_h = picture_h + answer_h + 14
    rows = _rows_of(items, per_row)
    scene = Scene(W, len(rows) * row_h)
    for r, row in enumerate(rows):
        offset = (per_row - len(row)) * cell_w / 2
        for c, item in enumerate(row):
            cx, top = offset + (c + 0.5) * cell_w, r * row_h
            scene.picture(item.get('picture') or '', cx - cell_w / 2 + 16, top + 4, cell_w - 32, picture_h - 8)
            if answer == 'box':
                scene.rect(cx - 34, top + picture_h + 4, 68, 36)
            elif answer == 'line':
                scene.line(cx - cell_w / 2 + 28, top + picture_h + 36, cx + cell_w / 2 - 28, top + picture_h + 36)
    return scene


# 'oral' has no scene: it is plain text and stays editable text in Word.
SCENE_BUILDERS: Dict[str, Callable[[Dict[str, Any]], Scene]] = {
    'writing_grid': writing_grid,
    'handwriting_lines': handwriting_lines,
    'missing_sequence': missing_sequence,
    'count_write': count_write,
    'compare_objects': compare_objects,
    'find_colour': find_colour,
    'match_columns': match_columns,
    'letter_grid': letter_grid,
    'picture_choice': picture_choice,
    'colour_picture': colour_picture,
    'picture_answer': picture_answer,
}


def build_scene(block: Dict[str, Any], rtl: bool = False):
    """The scene for a block, or None for block types that are plain text. ``rtl`` (Urdu papers) lays the
    same drawing out from the right."""
    builder = SCENE_BUILDERS.get(block.get('type'))
    if not builder:
        return None
    data = block.get('data')
    scene = builder(data if isinstance(data, dict) else {})
    return scene.mirrored() if rtl else scene
