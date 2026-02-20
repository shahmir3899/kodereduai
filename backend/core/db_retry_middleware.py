"""
Middleware to retry requests on transient database connection errors.
Handles SSL drops and connection resets common with remote DB poolers.
"""

import logging
import time

from django.db import close_old_connections, OperationalError

logger = logging.getLogger(__name__)

MAX_RETRIES = 2
RETRY_DELAY = 0.5  # seconds


class DatabaseRetryMiddleware:
    """Retries the request once if a transient DB connection error occurs."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        for attempt in range(MAX_RETRIES + 1):
            try:
                response = self.get_response(request)
                return response
            except OperationalError as e:
                error_msg = str(e).lower()
                is_transient = any(phrase in error_msg for phrase in [
                    'ssl syscall error',
                    'eof detected',
                    'connection reset',
                    'server closed the connection unexpectedly',
                    'could not connect to server',
                    'connection timed out',
                ])

                if is_transient and attempt < MAX_RETRIES:
                    logger.warning(
                        "Transient DB error (attempt %d/%d): %s — retrying in %.1fs",
                        attempt + 1, MAX_RETRIES + 1, e, RETRY_DELAY,
                    )
                    close_old_connections()
                    time.sleep(RETRY_DELAY)
                    continue

                raise
