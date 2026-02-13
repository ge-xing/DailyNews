"""Search1API trending utilities."""

from __future__ import annotations

from typing import Any

__all__ = ["fetch_trending"]


def fetch_trending(*args: Any, **kwargs: Any):
    from .search1_trending import fetch_trending as _fetch_trending

    return _fetch_trending(*args, **kwargs)
