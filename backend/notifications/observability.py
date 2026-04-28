"""Observability helpers for notification logging and retry behavior."""

from django.utils import timezone


REASON_SKIPPED_DUE_TO_CONFIG = 'skipped_due_to_config'
REASON_SKIPPED_DUE_TO_DEDUPE = 'skipped_due_to_dedupe'
REASON_FAILED_DISPATCH = 'failed_dispatch'


def merge_metadata(existing, updates):
    """Merge metadata dictionaries while preserving existing keys."""
    base = dict(existing or {})
    for key, value in (updates or {}).items():
        if value is not None:
            base[key] = value
    return base


def mark_log_failed(log, reason_code, error=None, retriable=False, extra_metadata=None):
    """Mark a NotificationLog as FAILED with standardized metadata."""
    payload = {
        'reason_code': reason_code,
        'error': str(error) if error else None,
        'retriable': bool(retriable),
        'last_failed_at': timezone.now().isoformat(),
    }
    if extra_metadata:
        payload.update(extra_metadata)

    log.status = 'FAILED'
    log.metadata = merge_metadata(log.metadata, payload)
    log.save(update_fields=['status', 'metadata'])
    return log


def should_retry_log(log, max_retries=3):
    """Return True when a log is eligible for retry processing."""
    if log.status == 'PENDING':
        return True

    if log.status != 'FAILED':
        return False

    metadata = log.metadata or {}
    retriable = bool(metadata.get('retriable'))
    retry_count = int(metadata.get('retry_count', 0) or 0)

    return retriable and retry_count < max_retries


def bump_retry_count(log):
    """Increment retry metadata counters on a notification log."""
    metadata = log.metadata or {}
    retry_count = int(metadata.get('retry_count', 0) or 0) + 1
    log.metadata = merge_metadata(
        metadata,
        {
            'retry_count': retry_count,
            'last_retry_at': timezone.now().isoformat(),
        },
    )
    log.save(update_fields=['metadata'])
    return retry_count