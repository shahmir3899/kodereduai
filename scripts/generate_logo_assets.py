"""Builds every logo/icon file the landing app, web app and mobile app use.

Reads only the two originals in marketing/KODER KIDS Logo/ (never modified):
  - "Koder EduAi.png"      full-colour logo with the "Education AI" text
  - "Koder EduAi (2).png"  white mark, no text (for dark backgrounds)

Run from the repo root:  python scripts/generate_logo_assets.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'marketing' / 'KODER KIDS Logo'
FULL_SRC = SRC / 'Koder EduAi.png'
WHITE_SRC = SRC / 'Koder EduAi (2).png'

LANDING = ROOT / 'frontend' / 'apps' / 'educationai-landing-astro' / 'public'
WEB = ROOT / 'frontend' / 'public'
MOBILE = ROOT / 'mobile' / 'assets'

# In the full logo the "Education AI" text starts below this row; everything above is the laptop/plane mark.
TEXT_TOP = 840


def square_pad(im: Image.Image, pad: float = 0.0, bg=None) -> Image.Image:
    """Centre `im` on a square canvas with `pad` (fraction of the side) of empty margin."""
    side = max(im.size)
    side = int(round(side / (1 - 2 * pad)))
    canvas = Image.new('RGBA', (side, side), bg or (0, 0, 0, 0))
    canvas.alpha_composite(im, ((side - im.width) // 2, (side - im.height) // 2))
    return canvas


def crop_to_alpha(im: Image.Image) -> Image.Image:
    return im.crop(im.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox())


def on_white(im: Image.Image) -> Image.Image:
    base = Image.new('RGBA', im.size, (255, 255, 255, 255))
    base.alpha_composite(im)
    return base.convert('RGB')


def save(im: Image.Image, path: Path, size: int | None = None, **kw) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    out = im.resize((size, size), Image.LANCZOS) if size else im
    out.save(path, **kw)
    print('wrote', path.relative_to(ROOT), out.size)


full = Image.open(FULL_SRC).convert('RGBA')
white = Image.open(WHITE_SRC).convert('RGBA')

mark = crop_to_alpha(full.crop((0, 0, full.width, TEXT_TOP)))          # colour mark only
mark_sq = square_pad(mark, pad=0.06)                                      # tab icons: little margin
mark_ui = square_pad(mark, pad=0.12)                                      # in-page icon (may sit in a circle)
white_mark = crop_to_alpha(white.crop((0, 0, white.width, TEXT_TOP)))   # the white file also carries the text
white_sq = square_pad(white_mark, pad=0.12)
full_sq = square_pad(crop_to_alpha(full), pad=0.06)

# ── Landing app ─────────────────────────────────────────────────────────────
save(mark_ui, LANDING / 'logo-mark.png', 256)
save(white_sq, LANDING / 'logo-mark-white.png', 256)
save(full_sq, LANDING / 'logo-full.png', 512)
save(mark_sq, LANDING / 'favicon-32.png', 32)
save(mark_sq, LANDING / 'favicon-192.png', 192)
save(mark_sq, LANDING / 'favicon-512.png', 512)
save(mark_sq, LANDING / 'favicon.png', 512)
mark_sq.resize((256, 256), Image.LANCZOS).save(
    LANDING / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
print('wrote favicon.ico (16/32/48)')
save(on_white(square_pad(mark, pad=0.16)), LANDING / 'apple-touch-icon.png', 180)

# ── Landing: link-preview image (1200x630) ──────────────────────────────────
W, H = 1200, 630
og = Image.new('RGB', (W, H), (255, 255, 255))
draw = ImageDraw.Draw(og)
draw.rectangle((0, 0, 14, H), fill=(24, 144, 203))
logo_h = 190
logo = crop_to_alpha(full)
logo = logo.resize((int(logo.width * logo_h / logo.height), logo_h), Image.LANCZOS)
og.paste(logo, (70, 60), logo)
head = ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf', 46)
sub = ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf', 28)
url = ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf', 26)
y = 300
for line in ('School Management', 'Software & AI Agent'):
    draw.text((70, y), line, font=head, fill=(51, 51, 51))
    y += 60
draw.text((70, y + 14), 'Attendance · Fees · Exams · Parent portal', font=sub, fill=(110, 110, 110))
draw.text((70, H - 62), 'educationai.pk', font=url, fill=(24, 144, 203))
shot = Image.open(LANDING / 'screens' / 'dashboard-desktop.webp').convert('RGB')
sw = 480
shot = shot.resize((sw, int(shot.height * sw / shot.width)), Image.LANCZOS)
card = Image.new('RGB', (sw + 4, shot.height + 4), (205, 213, 224))
card.paste(shot, (2, 2))
mask = Image.new('L', card.size, 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, card.width, card.height), 18, fill=255)
og.paste(card, (W - card.width - 50, (H - card.height) // 2), mask)
save(og, LANDING / 'og-home.jpg', quality=90)

# ── Web app ─────────────────────────────────────────────────────────────────
save(mark_sq, WEB / 'favicon.png', 512)
mark_sq.resize((256, 256), Image.LANCZOS).save(WEB / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
print('wrote web favicon.ico')
save(on_white(square_pad(mark, pad=0.16)), WEB / 'apple-touch-icon.png', 180)
save(mark_ui, WEB / 'logo-mark.png', 256)
save(full_sq, WEB / 'logo-full.png', 512)

# ── Mobile app ──────────────────────────────────────────────────────────────
full_1024 = on_white(full).resize((1024, 1024), Image.LANCZOS)         # same framing as the old icon
save(full_1024, MOBILE / 'icon.png')
save(full_1024, MOBILE / 'splash-icon.png')
# Android adaptive icon: transparent foreground, mark kept inside the central 66% safe zone.
fg = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
m = mark.resize((620, int(mark.height * 620 / mark.width)), Image.LANCZOS)
fg.alpha_composite(m, ((1024 - m.width) // 2, (1024 - m.height) // 2))
save(fg, MOBILE / 'adaptive-icon.png')
# Android notification icon must be a white silhouette on transparency.
save(square_pad(white_mark, pad=0.1), MOBILE / 'notification-icon.png', 96)
save(mark_sq, MOBILE / 'favicon.png', 48)
