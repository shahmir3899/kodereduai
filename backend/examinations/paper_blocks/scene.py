"""A scene is one activity drawing described once (rectangles, circles, lines, text, pictures) and written
two ways: SVG for the HTML page and PNG for Word. One description keeps the PDF and the Word file alike.

All positions are in scene units; ``layouts.SCENE_WIDTH`` units span the printable width of the page.
"""
import io
from functools import lru_cache
from html import escape
from typing import Any, Dict, List, Sequence, Tuple

from .urdu import URDU_FONT, font_path, has_urdu

INK = '#1f2937'
LIGHT = '#cbd5e1'
DASH = (6, 5)

# Latin text in Word drawings uses whichever of these the machine has (Urdu text uses the bundled Nastaliq
# font). TODO before go-live: ship a Latin font file too so Render (Linux) and Windows draw the same letters.
_FONT_FILES = {
    True: ('trebucbd.ttf', 'arialbd.ttf', 'DejaVuSans-Bold.ttf'),
    False: ('trebuc.ttf', 'arial.ttf', 'DejaVuSans.ttf'),
}


class Scene:
    def __init__(self, width: float, height: float):
        self.width = width
        self.height = height
        self.items: List[Tuple[str, Dict[str, Any]]] = []

    def rect(self, x, y, w, h, *, stroke=1.6, radius=0, dash=False, fill=None, color=INK):
        self.items.append(('rect', dict(x=x, y=y, w=w, h=h, stroke=stroke, radius=radius, dash=dash, fill=fill, color=color)))

    def circle(self, cx, cy, r, *, stroke=1.6, fill=None, color=INK):
        self.items.append(('circle', dict(cx=cx, cy=cy, r=r, stroke=stroke, fill=fill, color=color)))

    def line(self, x1, y1, x2, y2, *, stroke=1.6, dash=False, color=INK):
        self.items.append(('line', dict(x1=x1, y1=y1, x2=x2, y2=y2, stroke=stroke, dash=dash, color=color)))

    def polygon(self, points: Sequence[Tuple[float, float]], *, stroke=1.6, fill=None, color=INK):
        self.items.append(('polygon', dict(points=list(points), stroke=stroke, fill=fill, color=color)))

    def text(self, x, y, text, *, size=18, bold=True, anchor='middle', outline=False, color=INK):
        """``y`` is the vertical middle of the text. ``outline`` draws hollow letters for colouring in."""
        self.items.append(('text', dict(x=x, y=y, text=str(text), size=size, bold=bold, anchor=anchor, outline=outline, color=color)))

    def ellipse(self, cx, cy, rx, ry, *, stroke=1.6, fill=None, color=INK):
        self.items.append(('ellipse', dict(cx=cx, cy=cy, rx=rx, ry=ry, stroke=stroke, fill=fill, color=color)))

    def picture(self, ref, x, y, w, h):
        """The picture is fitted inside the box, keeping its shape, and centred. ``ref`` is a library
        name ("star"), a school upload (``{"upload": 12}``) or a picture drawn by code
        (``{"make": "clock", "time": "3:30"}``, see ``makers.py``)."""
        if isinstance(ref, dict) and 'make' in ref:
            from .makers import make
            drawn = make(ref)
            if drawn is not None:
                self.embed(drawn, x, y, w, h)
                return
            ref = str(ref.get('make') or 'picture')
        elif isinstance(ref, dict) and 'upload' in ref:
            ref = f'upload:{ref["upload"]}'
        elif isinstance(ref, dict) and 'url' in ref:
            ref = f'url:{ref["url"]}'
        self.items.append(('picture', dict(name=ref, x=x, y=y, w=w, h=h)))

    def embed(self, other: 'Scene', x, y, w, h):
        """Draws another scene inside the box, scaled to fit and centred."""
        if not other.width or not other.height:
            return
        k = min(w / other.width, h / other.height)
        dx = x + (w - other.width * k) / 2
        dy = y + (h - other.height * k) / 2
        for kind, p in other.items:
            q = dict(p)
            # Lines thin out with the drawing, but never so far that they vanish in print.
            if 'stroke' in q:
                q['stroke'] = max(0.8, q['stroke'] * min(1.0, k ** 0.5))
            if kind in ('rect', 'picture'):
                q.update(x=dx + p['x'] * k, y=dy + p['y'] * k, w=p['w'] * k, h=p['h'] * k)
                if kind == 'rect':
                    q['radius'] = p['radius'] * k
            elif kind == 'circle':
                q.update(cx=dx + p['cx'] * k, cy=dy + p['cy'] * k, r=p['r'] * k)
            elif kind == 'ellipse':
                q.update(cx=dx + p['cx'] * k, cy=dy + p['cy'] * k, rx=p['rx'] * k, ry=p['ry'] * k)
            elif kind == 'line':
                q.update(x1=dx + p['x1'] * k, y1=dy + p['y1'] * k, x2=dx + p['x2'] * k, y2=dy + p['y2'] * k)
            elif kind == 'polygon':
                q['points'] = [(dx + px * k, dy + py * k) for px, py in p['points']]
            elif kind == 'text':
                q.update(x=dx + p['x'] * k, y=dy + p['y'] * k, size=p['size'] * k)
            self.items.append((kind, q))

    def mirrored(self) -> 'Scene':
        """The same drawing laid out right to left, for Urdu papers: every position is flipped across the
        page, but pictures and text are not turned round. A train then leads from the right and the first
        column of a matching question sits on the right."""
        out = Scene(self.width, self.height)
        W = self.width
        for kind, p in self.items:
            q = dict(p)
            if kind in ('rect', 'picture'):
                q['x'] = W - p['x'] - p['w']
            elif kind in ('circle', 'ellipse'):
                q['cx'] = W - p['cx']
            elif kind == 'line':
                q.update(x1=W - p['x1'], x2=W - p['x2'])
            elif kind == 'polygon':
                q['points'] = [(W - x, y) for x, y in p['points']]
            elif kind == 'text':
                q['x'] = W - p['x']
                q['anchor'] = {'start': 'end', 'end': 'start'}.get(p['anchor'], p['anchor'])
            out.items.append((kind, q))
        return out


def _n(value: float) -> str:
    return f'{value:.1f}'.rstrip('0').rstrip('.')


def to_svg(scene: Scene, store) -> str:
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" class="scene" viewBox="0 0 {_n(scene.width)} {_n(scene.height)}" '
        f'width="100%" role="img">'
    ]
    for kind, p in scene.items:
        if kind in ('rect', 'circle', 'ellipse', 'line', 'polygon'):
            style = f'stroke="{p["color"]}" stroke-width="{_n(p["stroke"])}" fill="{p.get("fill") or "none"}"'
            if p.get('dash'):
                style += f' stroke-dasharray="{DASH[0]} {DASH[1]}"'
        if kind == 'rect':
            out.append(
                f'<rect x="{_n(p["x"])}" y="{_n(p["y"])}" width="{_n(p["w"])}" height="{_n(p["h"])}" '
                f'rx="{_n(p["radius"])}" {style}/>'
            )
        elif kind == 'circle':
            out.append(f'<circle cx="{_n(p["cx"])}" cy="{_n(p["cy"])}" r="{_n(p["r"])}" {style}/>')
        elif kind == 'ellipse':
            out.append(
                f'<ellipse cx="{_n(p["cx"])}" cy="{_n(p["cy"])}" rx="{_n(p["rx"])}" ry="{_n(p["ry"])}" {style}/>'
            )
        elif kind == 'line':
            out.append(
                f'<line x1="{_n(p["x1"])}" y1="{_n(p["y1"])}" x2="{_n(p["x2"])}" y2="{_n(p["y2"])}" '
                f'{style} stroke-linecap="round"/>'
            )
        elif kind == 'polygon':
            points = ' '.join(f'{_n(x)},{_n(y)}' for x, y in p['points'])
            out.append(f'<polygon points="{points}" {style} stroke-linejoin="round"/>')
        elif kind == 'text':
            anchor = {'middle': 'middle', 'start': 'start', 'end': 'end'}[p['anchor']]
            paint = (
                f'fill="#ffffff" stroke="{p["color"]}" stroke-width="{_n(max(1, p["size"] / 50))}" stroke-linejoin="round"'
                if p['outline'] else f'fill="{p["color"]}"'
            )
            urdu = has_urdu(p['text'])
            # Nastaliq letters are small for their size and sit high, so Urdu is drawn larger and lower.
            size = p['size'] * URDU_SCALE if urdu else p['size']
            y = p['y'] + size * URDU_DROP if urdu else p['y']
            font = f' font-family="&quot;{URDU_FONT}&quot;, serif"' if urdu else ''
            out.append(
                f'<text x="{_n(p["x"])}" y="{_n(y)}" font-size="{_n(size)}"{font} '
                f'font-weight="{"700" if p["bold"] else "400"}" text-anchor="{anchor}" '
                f'dominant-baseline="central" {paint}>{escape(p["text"])}</text>'
            )
        elif kind == 'picture':
            uri = store.data_uri(p['name'])
            if uri is None:
                out.append(_missing_picture_svg(p))
            else:
                out.append(
                    f'<image href="{escape(uri, quote=True)}" x="{_n(p["x"])}" y="{_n(p["y"])}" width="{_n(p["w"])}" '
                    f'height="{_n(p["h"])}" preserveAspectRatio="xMidYMid meet"/>'
                )
    out.append('</svg>')
    return ''.join(out)


def _missing_picture_svg(p: Dict[str, Any]) -> str:
    """An empty dashed box with the picture's name: the teacher sees what to add, the page keeps its shape."""
    return (
        f'<rect x="{_n(p["x"])}" y="{_n(p["y"])}" width="{_n(p["w"])}" height="{_n(p["h"])}" fill="none" '
        f'stroke="{LIGHT}" stroke-width="1.2" stroke-dasharray="{DASH[0]} {DASH[1]}"/>'
        f'<text x="{_n(p["x"] + p["w"] / 2)}" y="{_n(p["y"] + p["h"] / 2)}" font-size="10" text-anchor="middle" '
        f'dominant-baseline="central" fill="#94a3b8">{escape(str(p["name"]))}</text>'
    )


# How much larger and lower Urdu text is drawn than Latin text of the same size (see to_svg).
URDU_SCALE = 1.15
URDU_DROP = -0.06


@lru_cache(maxsize=128)
def _font(size: int, bold: bool, urdu: bool = False):
    from PIL import ImageFont
    if urdu:
        return ImageFont.truetype(str(font_path(bold)), size)
    for name in _FONT_FILES[bold]:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size)


@lru_cache(maxsize=1)
def _can_shape() -> bool:
    """Whether Pillow can join Urdu letters. On Linux Pillow loads FriBiDi from the system at run time;
    without it Urdu in Word drawings prints as separate, reversed letters (the page is not affected)."""
    from PIL import features
    ok = bool(features.check('raqm'))
    if not ok:
        import logging
        logging.getLogger(__name__).warning('Pillow cannot shape Urdu (no raqm/fribidi): Urdu in Word drawings will look wrong')
    return ok


def _dashed_line(draw, start, end, width, color, unit):
    (x1, y1), (x2, y2) = start, end
    length = ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
    if length == 0:
        return
    on, off = DASH[0] * unit, DASH[1] * unit
    position = 0.0
    while position < length:
        stop = min(position + on, length)
        draw.line(
            [(x1 + (x2 - x1) * position / length, y1 + (y2 - y1) * position / length),
             (x1 + (x2 - x1) * stop / length, y1 + (y2 - y1) * stop / length)],
            fill=color, width=width,
        )
        position += on + off


def to_png(scene: Scene, store, scale: float = 2.0) -> bytes:
    """PNG bytes, ``scale`` pixels per scene unit. Drawn at twice that and shrunk, because Pillow's own
    shapes have hard, stepped edges."""
    from PIL import Image, ImageDraw

    unit = scale * 2
    image = Image.new('RGB', (round(scene.width * unit), round(scene.height * unit)), 'white')
    draw = ImageDraw.Draw(image)

    def px(value):
        return value * unit

    for kind, p in scene.items:
        width = max(1, round(p.get('stroke', 1) * unit))
        if kind == 'rect':
            box = [px(p['x']), px(p['y']), px(p['x'] + p['w']), px(p['y'] + p['h'])]
            if p['dash']:
                corners = [(box[0], box[1]), (box[2], box[1]), (box[2], box[3]), (box[0], box[3])]
                for index in range(4):
                    _dashed_line(draw, corners[index], corners[(index + 1) % 4], width, p['color'], unit)
            elif p['radius']:
                draw.rounded_rectangle(box, radius=px(p['radius']), outline=p['color'], width=width, fill=p['fill'])
            else:
                draw.rectangle(box, outline=p['color'], width=width, fill=p['fill'])
        elif kind == 'circle':
            box = [px(p['cx'] - p['r']), px(p['cy'] - p['r']), px(p['cx'] + p['r']), px(p['cy'] + p['r'])]
            draw.ellipse(box, outline=p['color'], width=width, fill=p['fill'])
        elif kind == 'ellipse':
            box = [px(p['cx'] - p['rx']), px(p['cy'] - p['ry']), px(p['cx'] + p['rx']), px(p['cy'] + p['ry'])]
            draw.ellipse(box, outline=p['color'], width=width, fill=p['fill'])
        elif kind == 'line':
            start, end = (px(p['x1']), px(p['y1'])), (px(p['x2']), px(p['y2']))
            if p['dash']:
                _dashed_line(draw, start, end, width, p['color'], unit)
            else:
                draw.line([start, end], fill=p['color'], width=width)
        elif kind == 'polygon':
            draw.polygon([(px(x), px(y)) for x, y in p['points']], outline=p['color'], fill=p['fill'], width=width)
        elif kind == 'text':
            urdu = has_urdu(p['text'])
            size = p['size'] * URDU_SCALE if urdu else p['size']
            y = p['y'] + size * URDU_DROP if urdu else p['y']
            font = _font(round(px(size)), p['bold'], urdu)
            anchor = {'middle': 'mm', 'start': 'lm', 'end': 'rm'}[p['anchor']]
            # Urdu needs Pillow's shaping engine (raqm) to join letters and run right to left.
            extra = {'direction': 'rtl', 'language': 'ur'} if urdu and _can_shape() else {}
            if p['outline']:
                draw.text((px(p['x']), px(y)), p['text'], font=font, anchor=anchor, fill='white',
                          stroke_width=max(1, round(p['size'] / 100 * unit)), stroke_fill=p['color'], **extra)
            else:
                draw.text((px(p['x']), px(y)), p['text'], font=font, anchor=anchor, fill=p['color'], **extra)
        elif kind == 'picture':
            picture = store.png_image(p['name'])
            if picture is None:
                box = [px(p['x']), px(p['y']), px(p['x'] + p['w']), px(p['y'] + p['h'])]
                corners = [(box[0], box[1]), (box[2], box[1]), (box[2], box[3]), (box[0], box[3])]
                for index in range(4):
                    _dashed_line(draw, corners[index], corners[(index + 1) % 4], max(1, round(unit)), LIGHT, unit)
                draw.text(((box[0] + box[2]) / 2, (box[1] + box[3]) / 2), str(p['name']),
                          font=_font(round(px(10)), False), anchor='mm', fill='#94a3b8')
                continue
            ratio = min(px(p['w']) / picture.width, px(p['h']) / picture.height)
            size = (max(1, round(picture.width * ratio)), max(1, round(picture.height * ratio)))
            picture = picture.resize(size, Image.LANCZOS)
            left = round(px(p['x']) + (px(p['w']) - size[0]) / 2)
            top = round(px(p['y']) + (px(p['h']) - size[1]) / 2)
            image.paste(picture, (left, top), picture)

    final = image.resize((round(scene.width * scale), round(scene.height * scale)), Image.LANCZOS)
    buffer = io.BytesIO()
    final.save(buffer, format='PNG', optimize=True)
    return buffer.getvalue()
