"""Exponential-backoff retry for flaky external (Naukri) HTTP calls.

Retries only *transient* failures — network timeouts/connection drops and HTTP
429/5xx — never 4xx/auth errors or programming errors (those re-raise at once).
Works on both sync and async functions.
"""

from __future__ import annotations

import asyncio
import functools
import logging
import random
import time

import requests

logger = logging.getLogger(__name__)

_TRANSIENT_STATUS = {429, 500, 502, 503, 504}


def _is_transient(exc: Exception) -> bool:
    if isinstance(exc, (
        requests.exceptions.Timeout,
        requests.exceptions.ConnectionError,
        requests.exceptions.ChunkedEncodingError,
    )):
        return True
    if isinstance(exc, requests.exceptions.HTTPError) and exc.response is not None:
        return exc.response.status_code in _TRANSIENT_STATUS
    return False


def with_retry(
    *,
    max_attempts: int = 4,
    base_delay: float = 1.0,
    max_delay: float = 20.0,
    multiplier: float = 2.0,
    jitter: float = 0.3,
    label: str = "request",
):
    """Decorator adding exponential backoff + jitter on transient failures."""

    def _sleep_seconds(delay: float) -> float:
        return min(delay * (1 + jitter * random.random()), max_delay)

    def decorator(func):
        if asyncio.iscoroutinefunction(func):
            @functools.wraps(func)
            async def async_wrapper(*args, **kwargs):
                delay = base_delay
                for attempt in range(1, max_attempts + 1):
                    try:
                        return await func(*args, **kwargs)
                    except Exception as exc:
                        if attempt == max_attempts or not _is_transient(exc):
                            raise
                        logger.warning(
                            "[%s] attempt %d/%d transient (%s); retrying in ~%.1fs",
                            label, attempt, max_attempts, type(exc).__name__, delay,
                        )
                        await asyncio.sleep(_sleep_seconds(delay))
                        delay = min(delay * multiplier, max_delay)
            return async_wrapper

        @functools.wraps(func)
        def sync_wrapper(*args, **kwargs):
            delay = base_delay
            for attempt in range(1, max_attempts + 1):
                try:
                    return func(*args, **kwargs)
                except Exception as exc:
                    if attempt == max_attempts or not _is_transient(exc):
                        raise
                    logger.warning(
                        "[%s] attempt %d/%d transient (%s); retrying in ~%.1fs",
                        label, attempt, max_attempts, type(exc).__name__, delay,
                    )
                    time.sleep(_sleep_seconds(delay))
                    delay = min(delay * multiplier, max_delay)
        return sync_wrapper

    return decorator
