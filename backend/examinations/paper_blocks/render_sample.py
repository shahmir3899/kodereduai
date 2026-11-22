"""Writes a paper's HTML and Word files from a block-data JSON file, for looking at the result by eye.

From ``backend/``:  python -m examinations.paper_blocks.render_sample <paper.json> <output folder>

Pictures are looked up in the library and in a ``pictures`` folder next to the JSON file.
"""
import json
import sys
from pathlib import Path

from .docx_renderer import render_docx
from .html_renderer import render_html
from .pictures import PictureStore
from .registry import validate_document


def main(argv) -> int:
    if len(argv) != 3:
        print(__doc__)
        return 2
    source, out_dir = Path(argv[1]), Path(argv[2])
    document = json.loads(source.read_text(encoding='utf-8'))
    errors = validate_document(document)
    if errors:
        print('\n'.join(errors))
        return 1
    store = PictureStore([source.parent / 'pictures'])
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f'{source.stem}.html').write_text(render_html(document, store), encoding='utf-8')
    (out_dir / f'{source.stem}.docx').write_bytes(render_docx(document, store))
    print(f'Wrote {source.stem}.html and {source.stem}.docx to {out_dir}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
