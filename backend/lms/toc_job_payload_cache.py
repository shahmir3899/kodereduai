"""
Temporary storage for TOC OCR uploads.

Large base64 payloads in Postgres block a single-worker Gunicorn for seconds (INSERT + WAL),
which queues other API calls — browsers show ocr_toc stuck Pending while unrelated XHRs run 45s+.
When django-redis is configured, stash raw bytes here and keep the TOCImportJob row small.
"""

import logging

from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)

CACHE_TIMEOUT_SEC = 15 * 60  # must cover slow Vision + retries


def toc_job_blob_cache_allowed() -> bool:
    backend = settings.CACHES.get("default", {}).get("BACKEND", "")
    return backend == "django_redis.cache.RedisCache"


def toc_job_blob_cache_key(job_id) -> str:
    return f"toc_ocr_raw:{job_id}"


def try_put_job_blob(job_id, image_bytes: bytes) -> bool:
    """If Redis cache is enabled, store bytes and return True (skip DB blob)."""
    if not toc_job_blob_cache_allowed() or not image_bytes:
        return False
    try:
        cache.set(toc_job_blob_cache_key(job_id), image_bytes, timeout=CACHE_TIMEOUT_SEC)
        return True
    except Exception as exc:
        logger.warning(
            "[TOC-OCR-BLOB] cache write failed job=%s: %s — using DB fallback",
            job_id,
            exc,
        )
        return False


def read_job_image_bytes(job) -> bytes:
    """Load image bytes without deleting Redis entry (supports Celery retries)."""
    if toc_job_blob_cache_allowed():
        key = toc_job_blob_cache_key(job.id)
        try:
            raw = cache.get(key)
        except Exception as exc:
            logger.warning("[TOC-OCR-BLOB] cache read failed job=%s: %s", job.id, exc)
            raw = None
        if raw is not None:
            if isinstance(raw, memoryview):
                return raw.tobytes()
            return bytes(raw) if isinstance(raw, bytearray) else raw

    b64 = (job.image_payload_b64 or "").strip()
    if not b64:
        return b""
    import base64

    return base64.b64decode(b64.encode("utf-8"))


def purge_job_blob_cache(job_id) -> None:
    """Remove temporary blob once processing finished or terminally failed."""
    if not toc_job_blob_cache_allowed():
        return
    try:
        cache.delete(toc_job_blob_cache_key(job_id))
    except Exception:
        pass
