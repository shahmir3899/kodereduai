"""
End-to-end check: async TOC OCR (create job + poll until SUCCEEDED).

Usage (from repo root, with Python + Pillow + requests):
  set TOCE2E_BASE_URL=https://kodereduai-api.onrender.com
  set TOCE2E_USERNAME=qaisar
  set TOCE2E_PASSWORD=Abcd1234
  set TOCE2E_SCHOOL_ID=42
  python scripts/toc_import_e2e_check.py

By default uses ``frontend/toc_sample.jpeg`` under the repo root if that file exists;
otherwise falls back to a built-in synthetic PNG. Override with:

  set TOCE2E_IMAGE_PATH=D:\\path\\to\\toc_snippet.png
  python scripts/toc_import_e2e_check.py

Supported types: PNG, JPEG, WebP (same as API). Max 10 MB.

Omit other env vars to use the defaults above (public demo from docs/CLAUDE.md).

Busy Render dynos (one Gunicorn worker, few gthreads) can queue the multipart
``ocr_toc/?async=1`` accept for minutes before returning HTTP 202 — that is server
capacity, not Google Vision. ``TOCE2E_ACCEPT_READ_TIMEOUT`` is a *maximum* wait
for that response (not a fixed delay). Polling uses ``TOCE2E_POLL_INTERVAL`` between
GETs after the first immediate poll.
"""
from __future__ import annotations

import os
import sys
import time
from io import BytesIO
from pathlib import Path

import requests
from PIL import Image, ImageDraw

BASE = os.environ.get("TOCE2E_BASE_URL", "https://kodereduai-api.onrender.com").rstrip("/")
USER = os.environ.get("TOCE2E_USERNAME", "qaisar")
PASSWORD = os.environ.get("TOCE2E_PASSWORD", "Abcd1234")
SCHOOL_ID = os.environ.get("TOCE2E_SCHOOL_ID", "42")

CONNECT_TIMEOUT = 25
# JSON / GET calls: keep moderate so dead hosts fail fast.
READ_TIMEOUT = int(os.environ.get("TOCE2E_READ_TIMEOUT", "120"))
TIMEOUT = (CONNECT_TIMEOUT, READ_TIMEOUT)
# Multipart job accept can wait behind large API responses on small instances.
ACCEPT_READ_TIMEOUT = int(os.environ.get("TOCE2E_ACCEPT_READ_TIMEOUT", "420"))
ACCEPT_TIMEOUT = (CONNECT_TIMEOUT, ACCEPT_READ_TIMEOUT)
ACCEPT_RETRIES = int(os.environ.get("TOCE2E_ACCEPT_RETRIES", "2"))
POLL_INTERVAL = float(os.environ.get("TOCE2E_POLL_INTERVAL", "1.5"))
POLL_MAX = int(os.environ.get("TOCE2E_POLL_MAX", "60"))

_REPO_ROOT = Path(__file__).resolve().parent.parent
_DEFAULT_SAMPLE = _REPO_ROOT / "frontend" / "toc_sample.jpeg"

_MAX_UPLOAD = 10 * 1024 * 1024
_EXT_TO_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}


def _resolve_image_path(raw: str) -> Path:
    p = Path(raw).expanduser()
    if not p.is_absolute():
        p = _REPO_ROOT / p
    return p


def _load_image_bytes() -> tuple[bytes, str, str, Path | None]:
    """Returns (raw_bytes, upload_filename, content_type, resolved_path or None if synthetic)."""
    path = (os.environ.get("TOCE2E_IMAGE_PATH") or "").strip()
    if path:
        p = _resolve_image_path(path)
    elif _DEFAULT_SAMPLE.is_file():
        p = _DEFAULT_SAMPLE
    else:
        return _build_png(), "toc_e2e.png", "image/png", None

    if not p.is_file():
        raise FileNotFoundError(f"Image not found: {p}")
    size = p.stat().st_size
    if size > _MAX_UPLOAD:
        raise ValueError(f"Image too large ({size} bytes); max {_MAX_UPLOAD}.")
    ext = p.suffix.lower()
    mime = _EXT_TO_MIME.get(ext)
    if not mime:
        raise ValueError(f"Unsupported extension {ext!r}; use .png, .jpg, .jpeg, or .webp")
    data = p.read_bytes()
    return data, p.name, mime, p.resolve()


def _build_png() -> bytes:
    img = Image.new("RGB", (320, 160), color="white")
    draw = ImageDraw.Draw(img)
    draw.text((20, 60), "Maps and Globes\nDirections\nCulture", fill="black")
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def main() -> int:
    image_bytes, image_name, image_mime, image_path = _load_image_bytes()
    if image_path is not None:
        print(f"Using image file: {image_path} ({len(image_bytes)} bytes, {image_mime})")
    else:
        print("Using built-in synthetic PNG (Vision may return empty text).")
    session = requests.Session()
    print(f"POST login {BASE}/api/auth/login/ ...")
    r = session.post(
        f"{BASE}/api/auth/login/",
        json={"username": USER, "password": PASSWORD},
        timeout=TIMEOUT,
    )
    if not r.ok:
        print("Login failed:", r.status_code, r.text[:500])
        return 1
    access = r.json()["access"]
    headers = {"Authorization": f"Bearer {access}", "X-School-ID": SCHOOL_ID}

    print(f"GET {BASE}/api/ (warmup) ...")
    session.get(f"{BASE}/api/", headers={"Accept": "application/json"}, timeout=TIMEOUT)

    books_path = f"{BASE}/api/lms/books/"
    r2 = session.get(books_path, headers=headers, params={"page_size": 5}, timeout=TIMEOUT)
    r2.raise_for_status()
    results = r2.json().get("results") or []
    if not results:
        cls = session.get(
            f"{BASE}/api/classes/",
            headers=headers,
            params={"page_size": 1},
            timeout=TIMEOUT,
        )
        cls.raise_for_status()
        class_id = cls.json()["results"][0]["id"]
        subj = session.get(f"{BASE}/api/academics/subjects/", headers=headers, timeout=TIMEOUT)
        subj.raise_for_status()
        subj_list = subj.json()
        if isinstance(subj_list, dict):
            subj_list = subj_list.get("results") or []
        subject_id = subj_list[0]["id"]
        payload = {
            "school": int(SCHOOL_ID),
            "class_obj": class_id,
            "subject": subject_id,
            "title": "E2E TOC probe (auto-created)",
            "language": "en",
            "is_active": True,
        }
        cr = session.post(books_path, headers=headers, json=payload, timeout=TIMEOUT)
        if not cr.ok:
            print("Create book failed:", cr.status_code, cr.text[:600])
            return 2
        book_id = cr.json()["id"]
        print("Created book_id:", book_id)
    else:
        book_id = results[0]["id"]
        print("Using book_id:", book_id)

    files = {"image": (image_name, image_bytes, image_mime)}
    url = f"{BASE}/api/lms/books/{book_id}/ocr_toc/"
    print(f"Uploading image file: {image_name}")
    print(
        f"POST {url}?async=1 — waiting up to {ACCEPT_READ_TIMEOUT}s for HTTP 202 "
        f"(not a sleep; server may queue this behind other traffic). "
        f"Up to {ACCEPT_RETRIES + 1} attempt(s) on ReadTimeout."
    )
    r3 = None
    _post_t0 = time.perf_counter()
    for attempt in range(ACCEPT_RETRIES + 1):
        try:
            r3 = session.post(
                url,
                headers=headers,
                files=files,
                params={"async": "1"},
                timeout=ACCEPT_TIMEOUT,
            )
            break
        except requests.exceptions.ReadTimeout:
            if attempt >= ACCEPT_RETRIES:
                raise
            wait = 5 * (attempt + 1)
            print(f"  accept ReadTimeout, retry in {wait}s ({attempt + 1}/{ACCEPT_RETRIES}) ...")
            time.sleep(wait)
    _post_elapsed = time.perf_counter() - _post_t0
    assert r3 is not None
    if r3.status_code != 202:
        print("Expected HTTP 202, got", r3.status_code, r3.text[:800])
        return 3
    job = r3.json()
    job_id = job.get("job_id")
    print(f"HTTP 202 after {_post_elapsed:.1f}s — job {job_id} status: {job.get('status')}")

    for i in range(POLL_MAX):
        if i > 0:
            time.sleep(POLL_INTERVAL)
        pr = session.get(
            f"{BASE}/api/lms/toc-jobs/{job_id}/",
            headers=headers,
            timeout=TIMEOUT,
        )
        pr.raise_for_status()
        body = pr.json()
        st = body.get("status")
        print(f"  poll {i + 1}: {st}")
        if st == "SUCCEEDED":
            # API renames model field result_payload -> "result" on GET (see TOCImportJobStatusView).
            ocr_block = body.get("result") or body.get("result_payload") or {}
            text = (ocr_block.get("text") or "").strip()
            print("OK — extracted text preview:", repr(text[:240]))
            if not text:
                print("Warning: SUCCEEDED but empty text (try TOCE2E_IMAGE_PATH with a clear photo).")
                return 4
            return 0
        if st in ("FAILED", "TIMED_OUT"):
            print("Terminal:", body.get("error_message") or body)
            return 5

    print("Poll limit reached without SUCCEEDED")
    return 6


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (FileNotFoundError, ValueError) as e:
        print(e)
        sys.exit(8)
    except requests.exceptions.ReadTimeout as e:
        print("ReadTimeout:", e)
        print(
            "Multipart OCR accept did not return in time. "
            "Raise TOCE2E_ACCEPT_READ_TIMEOUT, TOCE2E_ACCEPT_RETRIES, or reduce load on the API dyno "
            "(Render: more threads GUNICORN_THREADS, larger plan, or cache heavy list endpoints)."
        )
        sys.exit(7)
