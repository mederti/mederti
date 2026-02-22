"""
Exponential backoff retry decorator.

Usage:
    from backend.utils.retry import with_exponential_backoff

    @with_exponential_backoff(max_attempts=3, base_delay=2.0, exceptions=(httpx.HTTPError,))
    def fetch_something():
        ...

Delay formula per attempt (1-indexed):
    delay = min(base_delay × 2^(attempt - 1) + uniform(0, 1), max_delay)

The decorator is safe to use on both plain functions and instance methods.
"""

import functools
import random
import time
from typing import Callable, Tuple, Type, TypeVar

from backend.utils.logger import get_logger

_log = get_logger("mederti.retry")

F = TypeVar("F", bound=Callable)


def with_exponential_backoff(
    max_attempts: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 30.0,
    jitter: bool = True,
    exceptions: Tuple[Type[Exception], ...] = (Exception,),
) -> Callable[[F], F]:
    """
    Decorator factory.  Wraps a callable with retry-on-exception logic.

    Args:
        max_attempts:  Total number of attempts before re-raising (default 3).
        base_delay:    Base wait in seconds before the first retry (default 1.0).
        max_delay:     Maximum wait in seconds between retries (default 30.0).
        jitter:        Add uniform(0, 1) seconds to each delay to avoid thundering herd.
        exceptions:    Tuple of exception types that should trigger a retry.
                       Non-matching exceptions propagate immediately.
    """
    def decorator(func: F) -> F:
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            last_exc: Exception | None = None

            for attempt in range(1, max_attempts + 1):
                try:
                    return func(*args, **kwargs)

                except exceptions as exc:
                    last_exc = exc

                    if attempt == max_attempts:
                        _log.error(
                            "All retry attempts exhausted",
                            extra={
                                "func":         func.__qualname__,
                                "attempt":      attempt,
                                "max_attempts": max_attempts,
                                "error":        str(exc),
                            },
                        )
                        raise

                    delay = min(
                        base_delay * (2 ** (attempt - 1))
                        + (random.uniform(0, 1) if jitter else 0),
                        max_delay,
                    )
                    _log.warning(
                        "Attempt failed — retrying",
                        extra={
                            "func":         func.__qualname__,
                            "attempt":      attempt,
                            "max_attempts": max_attempts,
                            "retry_in_s":   round(delay, 2),
                            "error":        str(exc),
                        },
                    )
                    time.sleep(delay)

            raise last_exc  # unreachable; satisfies type checkers

        return wrapper  # type: ignore[return-value]
    return decorator
