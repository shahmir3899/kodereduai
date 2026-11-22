"""Makes the PNG copy of every SVG in the paper-builder picture library.

Word cannot take SVG reliably and the server has no SVG drawing library, so each library picture is
stored as SVG (sharp in the PDF) plus a PNG made once, here, when the picture is added.

Developer tool only: needs PyMuPDF (``pip install pymupdf``) on the developer's machine. It is not a
server dependency and must not be added to requirements.

    python scripts/paper_pictures_to_png.py            # only pictures that have no PNG yet
    python scripts/paper_pictures_to_png.py --all      # redo every picture
"""
import sys
from pathlib import Path

import fitz  # PyMuPDF

LIBRARY = Path(__file__).resolve().parent.parent / 'backend' / 'examinations' / 'paper_blocks' / 'pictures'
LONG_SIDE_PX = 480


def main() -> None:
    redo = '--all' in sys.argv
    for svg in sorted(LIBRARY.glob('*.svg')):
        png = svg.with_suffix('.png')
        if png.exists() and not redo:
            continue
        page = fitz.open(svg)[0]
        zoom = LONG_SIDE_PX / max(page.rect.width, page.rect.height)
        page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=True).save(png)
        print('made', png.name)


if __name__ == '__main__':
    main()
