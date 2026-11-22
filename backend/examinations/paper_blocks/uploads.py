"""Gets a teacher's own picture ready for a paper: checks it, turns it upright, and (for a photo or scan
of a drawing) makes the paper white, trims the empty edges and shrinks it. Always stores a PNG.

SVG uploads are refused: an SVG file can carry script, and these files are shown inside the app.
"""
import io
import warnings
from dataclasses import dataclass

MAX_BYTES = 8 * 1024 * 1024
MAX_PIXELS = 40_000_000
MAX_SIDE = 1200
ALLOWED_FORMATS = {'PNG', 'JPEG', 'WEBP'}
# In a cleaned scan, anything this light is paper, not ink.
PAPER_LEVEL = 205


# Ink fainter than this against its paper is treated as no drawing at all.
FAINTEST_INK = 25


def _even_out_light(grey):
    """Phone photos are lit unevenly: one side of the page is brighter than the other, so no single
    grey level separates paper from ink. This estimates the bare paper at every point (the photo with
    the thin dark lines wiped out and blurred) and keeps only how much darker each pixel is than that."""
    from PIL import Image, ImageChops, ImageFilter, ImageOps

    longest = max(grey.size)
    small = grey
    if longest > 300:
        small = grey.resize((max(1, grey.width * 300 // longest), max(1, grey.height * 300 // longest)), Image.BILINEAR)
    paper = small.filter(ImageFilter.MaxFilter(15)).filter(ImageFilter.GaussianBlur(6))
    # A large solid black shape would otherwise be taken for "dark paper" and come out hollow, so
    # the paper estimate is never allowed far below the page's usual brightness.
    histogram, seen, median = small.histogram(), 0, 255
    for level, count in enumerate(histogram):
        seen += count
        if seen * 2 >= small.width * small.height:
            median = level
            break
    floor = max(0, median - 40)
    paper = paper.point(lambda level: max(level, floor)).resize(grey.size, Image.BILINEAR)
    ink = ImageChops.subtract(paper, grey)
    if ink.getextrema()[1] < FAINTEST_INK:
        return Image.new('L', grey.size, 255)
    return ImageOps.autocontrast(ImageChops.invert(ink), cutoff=(0.5, 0))


class UploadError(ValueError):
    """The message is written for the teacher and is safe to show as it is."""


@dataclass
class PreparedPicture:
    png: bytes
    width: int
    height: int


def prepare_upload(raw: bytes, clean: bool = True) -> PreparedPicture:
    """``clean`` is for line drawings photographed or scanned on paper. Turn it off for a picture that
    should keep its colours and greys as they are."""
    from PIL import Image, ImageChops, ImageOps

    if not raw:
        raise UploadError('The file is empty.')
    if len(raw) > MAX_BYTES:
        raise UploadError('The picture is larger than 8 MB.')
    try:
        with warnings.catch_warnings():
            # Pillow only warns about an image built to exhaust memory; here that is a refusal.
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            image = Image.open(io.BytesIO(raw))
            if image.format not in ALLOWED_FORMATS:
                raise UploadError('Use a PNG, JPG or WebP picture.')
            if image.width * image.height > MAX_PIXELS:
                raise UploadError('The picture has too many pixels. Use a smaller one.')
            image.load()
    except UploadError:
        raise
    except Exception:
        raise UploadError('This file is not a picture we can read.')

    image = ImageOps.exif_transpose(image)
    # Transparent areas print as white paper.
    rgba = image.convert('RGBA')
    flat = Image.new('RGB', rgba.size, 'white')
    flat.paste(rgba, mask=rgba.getchannel('A'))

    if clean:
        grey = _even_out_light(flat.convert('L'))
        grey = grey.point(lambda level: 255 if level >= PAPER_LEVEL else level)
        box = ImageChops.invert(grey).getbbox()
        if box is None:
            raise UploadError('The picture is blank.')
        pad = round(max(grey.size) * 0.02)
        box = (max(0, box[0] - pad), max(0, box[1] - pad),
               min(grey.width, box[2] + pad), min(grey.height, box[3] + pad))
        result = grey.crop(box)
    else:
        result = flat

    if max(result.size) > MAX_SIDE:
        ratio = MAX_SIDE / max(result.size)
        result = result.resize((max(1, round(result.width * ratio)), max(1, round(result.height * ratio))), Image.LANCZOS)

    buffer = io.BytesIO()
    result.save(buffer, format='PNG', optimize=True)
    return PreparedPicture(png=buffer.getvalue(), width=result.width, height=result.height)
