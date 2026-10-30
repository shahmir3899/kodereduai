"""
The school's logo for generated PDFs, in one place.

A logo is a Supabase URL the school uploaded. Both PDF libraries here (ReportLab and fpdf) read local
bytes only, and a URL that cannot be fetched, is not an image, or is an SVG would take down the whole
export if handed to them. So the logo is fetched here, checked by Pillow, converted to a small PNG
and cached; anything that goes wrong means "no logo", never a failed PDF.
"""
import hashlib
import io
import logging

import requests
from django.core.cache import cache

from core.url_safety import UnsafeUrlError, assert_safe_external_url

logger = logging.getLogger(__name__)

LOGO_FETCH_TIMEOUT = 6
LOGO_MAX_BYTES = 3 * 1024 * 1024
LOGO_MAX_PX = 400
LOGO_CACHE_SECONDS = 600
# A logo that failed is remembered briefly so a slow or dead URL does not stall every report.
LOGO_FAILED_CACHE_SECONDS = 120


def _normalise(raw):
    """PNG bytes plus width and height, or None when the bytes are not a usable raster image."""
    from PIL import Image

    image = Image.open(io.BytesIO(raw))
    image.load()
    image = image.convert('RGBA')
    image.thumbnail((LOGO_MAX_PX, LOGO_MAX_PX))
    out = io.BytesIO()
    image.save(out, format='PNG')
    return out.getvalue(), image.width, image.height


def school_logo_png(school):
    """(png_bytes, width, height) for the school's logo, or None."""
    url = (getattr(school, 'logo', None) or '').strip() if school else ''
    if not url:
        return None
    key = f"pdf-logo:{school.pk}:{hashlib.md5(url.encode()).hexdigest()}"
    cached = cache.get(key)
    if cached is not None:
        return cached or None
    try:
        assert_safe_external_url(url)
        resp = requests.get(url, timeout=LOGO_FETCH_TIMEOUT)
        resp.raise_for_status()
        if len(resp.content) > LOGO_MAX_BYTES:
            raise ValueError('logo is too large')
        result = _normalise(resp.content)
    except UnsafeUrlError as exc:
        logger.warning('Rejected unsafe school logo URL: %s', exc)
        result = None
    except Exception as exc:  # unreachable, not an image, SVG: a report without a logo beats no report
        logger.warning('Could not use the school logo for a PDF: %s', exc)
        result = None
    cache.set(key, result or b'', LOGO_CACHE_SECONDS if result else LOGO_FAILED_CACHE_SECONDS)
    return result


def reportlab_logo(school, height_mm=18):
    """A ReportLab Image of the logo at the given height, or None."""
    logo = school_logo_png(school)
    if not logo:
        return None
    from reportlab.lib.units import mm
    from reportlab.platypus import Image

    png, width, height = logo
    h = height_mm * mm
    return Image(io.BytesIO(png), width=h * width / height, height=h)


def reportlab_header(school, flowables, height_mm=18):
    """The logo on the left and the given flowables beside it; just the flowables with no logo."""
    logo = reportlab_logo(school, height_mm)
    if logo is None:
        return list(flowables)
    from reportlab.platypus import Table, TableStyle

    table = Table([[logo, list(flowables)]], colWidths=[logo.drawWidth + 8, None])
    table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (0, 0), 8),
    ]))
    return [table]


def fpdf_logo(pdf, school, x=10, y=8, height_mm=14):
    """Draw the logo on an fpdf page. Returns the x where text can start beside it (x when no logo)."""
    logo = school_logo_png(school)
    if not logo:
        return x
    png, width, height = logo
    w = height_mm * width / height
    pdf.image(io.BytesIO(png), x=x, y=y, w=w, h=height_mm)
    return x + w + 4
