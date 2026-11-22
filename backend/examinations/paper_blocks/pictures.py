"""Finds a picture by name. Every picture has a PNG (Word needs one, and it gives the size); library line
art also has an SVG, which the HTML page prefers because it stays sharp in print.

Phase 1 reads folders. School uploads (Phase 2) will sit behind the same three methods.
"""
import base64
import io
import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional

LIBRARY_DIR = Path(__file__).parent / 'pictures'
# Names come from saved paper data, so they are never trusted as paths.
_SAFE_NAME = re.compile(r'^[a-z0-9_]{1,60}$')


class PictureStore:
    def __init__(self, extra_dirs: Iterable[Path] = (), uploads: Optional[Dict[int, str]] = None,
                 fetch: Optional[Callable[[str], Optional[bytes]]] = None, link_base: str = ''):
        """``uploads`` maps a school upload's id to its file address; ``fetch`` turns an address into
        bytes. Both come from the caller, so this package itself never touches the database or network."""
        # A paper's own pictures come first: a sample or school folder that has its own "cat" means
        # that drawing, not the library's.
        self.dirs = [*[Path(d) for d in extra_dirs], LIBRARY_DIR]
        self.uploads = {f'upload:{key}': url for key, url in (uploads or {}).items()}
        self._fetch = fetch
        # When set, library pictures are linked (``<link_base><name>/``) instead of embedded: the page
        # served by the API stays small, and the browser loads each picture once.
        self.link_base = link_base
        self._fetched: Dict[str, Any] = {}

    def _path(self, name: str, suffix: str) -> Optional[Path]:
        if not isinstance(name, str) or not _SAFE_NAME.match(name):
            return None
        for folder in self.dirs:
            candidate = folder / f'{name}{suffix}'
            if candidate.is_file():
                return candidate
        return None

    def _address(self, name: str) -> Optional[str]:
        """The file address behind an upload or an old paper's diagram, or None."""
        if not isinstance(name, str):
            return None
        if name in self.uploads:
            return self.uploads[name]
        if name.startswith('url:https://') and self._fetch is not None:
            return name[4:]
        return None

    def has(self, name: str) -> bool:
        return self._address(name) is not None or self._path(name, '.png') is not None

    def data_uri(self, name: str) -> Optional[str]:
        """What an ``<img>`` or SVG ``<image>`` points at. None when the picture is not known."""
        if not self.has(name):
            return None
        if self._address(name):
            return self._address(name)
        if self.link_base:
            png = self._path(name, '.png')
            if png is not None and png.parent == LIBRARY_DIR:
                return f'{self.link_base}{name}/'
        # The SVG must come from the same folder as the PNG that won, or a school's own "cat.png"
        # would print in the PDF as the library's cat.
        png = self._path(name, '.png')
        svg = png.with_suffix('.svg')
        if svg.is_file():
            return _encode(str(svg), 'image/svg+xml')
        return _encode(str(png), 'image/png')

    def png_image(self, name: str):
        """A Pillow RGBA image, or None."""
        from PIL import Image
        address = self._address(name)
        if address:
            if name not in self._fetched:
                self._fetched[name] = None
                raw = self._fetch(address) if self._fetch else None
                if raw:
                    try:
                        with Image.open(io.BytesIO(raw)) as image:
                            self._fetched[name] = image.convert('RGBA')
                    except Exception:
                        # A file that is gone or broken prints as the empty named box, like any
                        # other missing picture; it must not stop the whole paper from exporting.
                        pass
            return self._fetched[name]
        path = self._path(name, '.png')
        if path is None:
            return None
        with Image.open(path) as image:
            return image.convert('RGBA')

    def catalog(self) -> List[Dict[str, Any]]:
        """The library pictures with their English and Urdu names and search words."""
        return [dict(entry) for entry in _catalog() if self._path(entry['name'], '.png')]

    def search(self, query: str) -> List[Dict[str, Any]]:
        """Library pictures whose name, Urdu name or search words contain ``query``."""
        needle = str(query or '').strip().lower()
        if not needle:
            return self.catalog()
        return [
            entry for entry in self.catalog()
            if any(needle in str(text).lower() for text in (entry['name'], entry['en'], entry['ur'], *entry['tags']))
        ]


@lru_cache(maxsize=1)
def _catalog() -> List[Dict[str, Any]]:
    return json.loads((LIBRARY_DIR / 'catalog.json').read_text(encoding='utf-8'))


@lru_cache(maxsize=256)
def _encode(path: str, mime: str) -> str:
    return f'data:{mime};base64,' + base64.b64encode(Path(path).read_bytes()).decode('ascii')
