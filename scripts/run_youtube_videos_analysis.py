#!/usr/bin/env python3
"""Search YouTube videos from TikHub API and rank by computed hot degree."""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import parse_qs, urlparse

import requests

"""
python3 scripts/run_youtube_videos_analysis.py --search-query "ai news" --video-count 100 --order-by this_month --language-code en --country-code us --output outputs/ai_news_videos.json --api-token "qJNaMeUn+26RpDCtP4au8C3yZhyye4UzxinemHuxS6agl06wfVyyZSqvbA=="

"""

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ENDPOINT = "https://api.tikhub.io/api/v1/youtube/web/search_video"

TITLE_KEYS = {
    "title",
    "video_title",
    "name",
    "headline",
}
URL_KEYS = {
    "url",
    "video_url",
    "watch_url",
    "link",
    "video_link",
    "webpage_url",
}
ID_KEYS = {
    "video_id",
    "videoid",
    "videoId",
    "id",
}
VIEWS_KEYS = {
    "views",
    "view_count",
    "viewCount",
    "view_count_text",
    "viewCountText",
    "shortViewCountText",
    "short_view_count_text",
    "videoViewCountText",
    "video_view_count_text",
    "video_views",
    "views_text",
    "view_text",
    "short_view_count",
    "viewCountShort",
    "viewCountSimpleText",
    "view_count_simple_text",
}
PUBLISH_KEYS = {
    "published",
    "published_at",
    "published_time",
    "publish_time",
    "published_date",
    "publish_date",
    "upload_date",
    "uploaded_at",
    "time_text",
}
THUMBNAIL_KEYS = {
    "thumbnail",
    "thumbnails",
    "thumbnail_url",
    "cover",
    "covers",
    "image",
    "images",
}

TOKEN_ENV_KEYS = ("TIKHUB_API_KEY", "TIKHUB_API_TOKEN", "YOUTUBE_WEB_API_TOKEN")
TOKEN_KEYS = (
    "continuation_token",
    "continuationToken",
    "next_continuation_token",
    "nextContinuationToken",
    "next_token",
    "nextToken",
)
VIDEO_ID_PATTERN = re.compile(r"[A-Za-z0-9_-]{11}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Search YouTube videos and rank by hot degree (views + publish time)."
    )
    parser.add_argument("--search-query", required=True, help="Search keyword.")
    parser.add_argument("--video-count", type=int, required=True, help="Target number of videos.")
    parser.add_argument("--language-code", default="en", help="Language code, default: en.")
    parser.add_argument(
        "--order-by",
        default="this_month",
        choices=["this_week", "this_month", "this_year", "last_hour", "today"],
        help="Sort window for API search.",
    )
    parser.add_argument("--country-code", default="us", help="Country code, default: us.")
    parser.add_argument("--continuation-token", default="", help="Initial continuation token.")
    parser.add_argument("--max-pages", type=int, default=30, help="Pagination cap to avoid infinite loops.")
    parser.add_argument("--timeout", type=int, default=30, help="HTTP timeout in seconds.")
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT, help="API endpoint URL.")
    parser.add_argument("--api-token", default="", help="TikHub API token.")
    parser.add_argument(
        "--api-token-file",
        type=Path,
        default=None,
        help="Fallback token file path (first non-empty line).",
    )
    parser.add_argument("--output", type=Path, default=None, help="Optional JSON output file path.")
    return parser.parse_args()


def read_first_non_empty_line(path: Path) -> str:
    if not path.exists():
        return ""
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        value = line.strip()
        if value:
            return value
    return ""


def resolve_api_token(args: argparse.Namespace) -> str:
    if args.api_token.strip():
        return args.api_token.strip()
    for key in TOKEN_ENV_KEYS:
        value = os.getenv(key, "").strip()
        if value:
            return value
    if args.api_token_file:
        value = read_first_non_empty_line(args.api_token_file)
        if value:
            return value
    fallback = read_first_non_empty_line(REPO_ROOT / "tikhub_api_token.txt")
    if fallback:
        return fallback
    raise RuntimeError(
        "Missing API token. Provide --api-token, --api-token-file, or set "
        "TIKHUB_API_KEY/TIKHUB_API_TOKEN/YOUTUBE_WEB_API_TOKEN."
    )


def decode_json_string(data: Any) -> Any:
    value = data
    for _ in range(3):
        if isinstance(value, str):
            text = value.strip()
            if not text:
                break
            if (text.startswith("{") and text.endswith("}")) or (
                text.startswith("[") and text.endswith("]")
            ):
                try:
                    value = json.loads(text)
                    continue
                except json.JSONDecodeError:
                    break
        break
    return value


def iter_dicts(node: Any) -> Iterable[dict[str, Any]]:
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from iter_dicts(value)
    elif isinstance(node, list):
        for item in node:
            yield from iter_dicts(item)


def deep_find_values(node: Any, keys: set[str]) -> Iterable[Any]:
    if isinstance(node, dict):
        for key, value in node.items():
            if key in keys:
                yield value
            yield from deep_find_values(value, keys)
    elif isinstance(node, list):
        for item in node:
            yield from deep_find_values(item, keys)


def iter_strings(node: Any) -> Iterable[str]:
    if isinstance(node, str):
        text = node.strip()
        if text:
            yield text
        return
    if isinstance(node, dict):
        for value in node.values():
            yield from iter_strings(value)
        return
    if isinstance(node, list):
        for item in node:
            yield from iter_strings(item)


def value_to_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    if isinstance(value, list):
        texts = [value_to_text(item) for item in value]
        return " ".join([text for text in texts if text]).strip()
    if isinstance(value, dict):
        for key in ("text", "simpleText", "label", "title", "name"):
            if key in value:
                text = value_to_text(value.get(key))
                if text:
                    return text
        runs = value.get("runs")
        if isinstance(runs, list):
            texts = [value_to_text(item.get("text")) for item in runs if isinstance(item, dict)]
            merged = "".join([text for text in texts if text]).strip()
            if merged:
                return merged
    return ""


def parse_views(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return max(0, int(value))

    text = value_to_text(value).lower()
    if not text:
        return 0
    if "no views" in text:
        return 0

    # Prefer numbers tied to view semantics.
    view_patterns = (
        r"(\d+(?:[.,]\d+)?)\s*([kmb]|万|萬|亿|億)?\s*(?:views?|view|次观看|次播放|观看|觀看|播放)",
        r"(?:views?|view|次观看|次播放|观看|觀看|播放)\s*(\d+(?:[.,]\d+)?)\s*([kmb]|万|萬|亿|億)?",
    )
    for pat in view_patterns:
        m = re.search(pat, text, flags=re.IGNORECASE)
        if m:
            number = float(m.group(1).replace(",", ""))
            unit = (m.group(2) or "").lower()
            unit_factor = {
                "k": 1_000,
                "m": 1_000_000,
                "b": 1_000_000_000,
                "万": 10_000,
                "萬": 10_000,
                "亿": 100_000_000,
                "億": 100_000_000,
            }.get(unit, 1)
            return max(0, int(number * unit_factor))

    normalized = text.replace(",", "").replace("，", "").replace(" ", "")
    match = re.search(r"(\d+(?:\.\d+)?)\s*([kmb]|万|萬|亿|億)?", normalized, flags=re.IGNORECASE)
    if not match:
        digits = re.findall(r"\d+", normalized)
        return int(digits[0]) if digits else 0

    number = float(match.group(1))
    unit = (match.group(2) or "").lower()
    unit_factor = {
        "k": 1_000,
        "m": 1_000_000,
        "b": 1_000_000_000,
        "万": 10_000,
        "萬": 10_000,
        "亿": 100_000_000,
        "億": 100_000_000,
    }.get(unit, 1)
    return max(0, int(number * unit_factor))


def parse_epoch(value: Any) -> datetime | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        stamp = float(value)
    else:
        text = value_to_text(value).strip()
        if not text.isdigit():
            return None
        stamp = float(text)

    if stamp <= 0:
        return None
    if stamp > 1_000_000_000_000:
        stamp = stamp / 1000.0
    return datetime.fromtimestamp(stamp, tz=timezone.utc)


def parse_relative_time(text: str, now: datetime) -> datetime | None:
    lowered = text.strip().lower()
    if not lowered:
        return None

    if lowered in {"today", "今天"}:
        return now
    if lowered in {"yesterday", "昨天"}:
        return now - timedelta(days=1)

    en = re.search(
        r"(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago",
        lowered,
        flags=re.IGNORECASE,
    )
    if en:
        count = int(en.group(1))
        unit = en.group(2).lower()
        factor = {
            "second": timedelta(seconds=count),
            "minute": timedelta(minutes=count),
            "hour": timedelta(hours=count),
            "day": timedelta(days=count),
            "week": timedelta(weeks=count),
            "month": timedelta(days=30 * count),
            "year": timedelta(days=365 * count),
        }
        return now - factor[unit]

    zh = re.search(r"(\d+)\s*(秒|分钟|分|小时|天|周|个月|月|年)\s*前", text)
    if zh:
        count = int(zh.group(1))
        unit = zh.group(2)
        if unit == "秒":
            return now - timedelta(seconds=count)
        if unit in {"分钟", "分"}:
            return now - timedelta(minutes=count)
        if unit == "小时":
            return now - timedelta(hours=count)
        if unit == "天":
            return now - timedelta(days=count)
        if unit == "周":
            return now - timedelta(weeks=count)
        if unit in {"个月", "月"}:
            return now - timedelta(days=30 * count)
        if unit == "年":
            return now - timedelta(days=365 * count)
    return None


def parse_datetime(value: Any, now: datetime) -> datetime | None:
    epoch = parse_epoch(value)
    if epoch:
        return epoch

    raw = value_to_text(value).strip()
    if not raw:
        return None

    relative = parse_relative_time(raw, now=now)
    if relative:
        return relative

    iso_candidate = raw.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(iso_candidate)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        pass

    date_formats = (
        "%Y-%m-%d",
        "%Y/%m/%d",
        "%Y-%m-%d %H:%M:%S",
        "%Y/%m/%d %H:%M:%S",
        "%b %d, %Y",
        "%B %d, %Y",
        "%d %b %Y",
        "%d %B %Y",
    )
    for fmt in date_formats:
        try:
            dt = datetime.strptime(raw, fmt)
            return dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def extract_video_id(item: dict[str, Any]) -> str:
    # Prefer explicit videoId keys first.
    for key in ("videoId", "video_id", "videoid"):
        for obj in iter_dicts(item):
            if key in obj:
                text = value_to_text(obj.get(key)).strip()
                if VIDEO_ID_PATTERN.fullmatch(text):
                    return text

    for value in deep_find_values(item, ID_KEYS):
        text = value_to_text(value).strip()
        if VIDEO_ID_PATTERN.fullmatch(text):
            return text
    for value in deep_find_values(item, URL_KEYS):
        url = normalize_video_url(value_to_text(value))
        video_id = parse_video_id_from_url(url)
        if video_id:
            return video_id
    # Fallback: infer ID from common thumbnail URL pattern /vi/<video_id>/...
    for thumb_url in extract_thumbnail_urls(item):
        m = re.search(r"/vi(?:_webp)?/([A-Za-z0-9_-]{11})(?:/|\\?|$)", thumb_url)
        if m:
            return m.group(1)
    return ""


def parse_video_id_from_url(url: str) -> str:
    if not url:
        return ""
    parsed = urlparse(url)
    if parsed.path == "/watch":
        query = parse_qs(parsed.query)
        values = query.get("v", [])
        if values and VIDEO_ID_PATTERN.fullmatch(values[0]):
            return values[0]
    if parsed.path.startswith("/shorts/"):
        short_id = parsed.path.rsplit("/", 1)[-1]
        if VIDEO_ID_PATTERN.fullmatch(short_id):
            return short_id
    return ""


def normalize_video_url(raw: str) -> str:
    text = raw.strip()
    if not text:
        return ""
    if text.startswith("//"):
        return f"https:{text}"
    if text.startswith("/watch") or text.startswith("/shorts"):
        return f"https://www.youtube.com{text}"
    return text


def extract_video_url(item: dict[str, Any], video_id: str) -> str:
    if video_id:
        return f"https://www.youtube.com/watch?v={video_id}"
    for value in deep_find_values(item, URL_KEYS):
        url = normalize_video_url(value_to_text(value))
        if not url:
            continue
        parsed_video_id = parse_video_id_from_url(url)
        if parsed_video_id:
            return f"https://www.youtube.com/watch?v={parsed_video_id}"
    return ""


def looks_like_video(item: dict[str, Any]) -> bool:
    title = first_text_by_keys(item, TITLE_KEYS)
    if not title:
        return False
    has_ref = bool(first_text_by_keys(item, URL_KEYS) or first_text_by_keys(item, ID_KEYS))
    has_signal = bool(first_text_by_keys(item, VIEWS_KEYS) or first_text_by_keys(item, PUBLISH_KEYS))
    return has_ref or has_signal


def first_text_by_keys(item: dict[str, Any], keys: set[str]) -> str:
    for value in deep_find_values(item, keys):
        text = value_to_text(value).strip()
        if text:
            return text
    return ""


def extract_views(item: dict[str, Any]) -> tuple[int, str]:
    candidates: list[str] = []

    for value in deep_find_values(item, VIEWS_KEYS):
        text = value_to_text(value).strip()
        if text:
            candidates.append(text)

    for obj in iter_dicts(item):
        for key, value in obj.items():
            lowered = key.lower()
            if "view" in lowered:
                text = value_to_text(value).strip()
                if text:
                    candidates.append(text)
            if lowered in {"label", "simpletext", "text", "title"}:
                text = value_to_text(value).strip()
                if text and (
                    "view" in text.lower()
                    or "观看" in text
                    or "播放" in text
                    or "觀看" in text
                ):
                    candidates.append(text)

    best_views = 0
    best_raw = ""
    for text in candidates:
        views = parse_views(text)
        if views > best_views:
            best_views = views
            best_raw = text

    if best_views > 0:
        return best_views, best_raw

    # Last fallback: scan all strings to catch labels like "1,234 views".
    for text in iter_strings(item):
        if (
            "view" in text.lower()
            or "观看" in text
            or "播放" in text
            or "觀看" in text
        ):
            views = parse_views(text)
            if views > best_views:
                best_views = views
                best_raw = text
    return best_views, best_raw


def extract_thumbnail_urls(item: dict[str, Any]) -> list[str]:
    urls: list[str] = []

    def collect(node: Any) -> None:
        if isinstance(node, str):
            text = node.strip()
            if text.startswith("http://") or text.startswith("https://"):
                urls.append(text)
            return
        if isinstance(node, dict):
            for key, value in node.items():
                if key in {"url", "src", "thumbnail_url"}:
                    collect(value)
                else:
                    collect(value)
            return
        if isinstance(node, list):
            for item in node:
                collect(item)

    for value in deep_find_values(item, THUMBNAIL_KEYS):
        collect(value)

    deduped: list[str] = []
    seen: set[str] = set()
    for url in urls:
        if url not in seen:
            seen.add(url)
            deduped.append(url)
    return deduped


def hot_degree(views: int, published_at: datetime | None, now: datetime) -> float:
    # Views bring scale; recency provides time decay.
    age_hours = 24.0 * 365.0
    if published_at is not None:
        age_hours = max(0.0, (now - published_at).total_seconds() / 3600.0)
    recency_weight = 1.0 / (1.0 + age_hours / 24.0)
    return round(math.log10(max(1, views) + 1.0) * recency_weight * 100.0, 4)


def normalize_video(item: dict[str, Any], now: datetime) -> dict[str, Any]:
    title = first_text_by_keys(item, TITLE_KEYS)
    video_id = extract_video_id(item)
    video_url = extract_video_url(item, video_id)
    views, views_raw = extract_views(item)
    published_raw = first_text_by_keys(item, PUBLISH_KEYS)
    published_at = parse_datetime(published_raw, now=now)
    published_iso = published_at.isoformat() if published_at else ""
    thumbnails = extract_thumbnail_urls(item)

    return {
        "video_id": video_id,
        "video_url": video_url,
        "title": title,
        "views": views,
        "views_text": views_raw,
        "publication_time": published_iso,
        "publication_time_raw": published_raw,
        "thumbnails": thumbnails,
        "hot_degree": hot_degree(views, published_at, now=now),
    }


def collect_video_candidates(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    if not isinstance(data, dict):
        return []

    for key in ("videos", "items", "results", "contents", "data"):
        rows = data.get(key)
        if isinstance(rows, list):
            dict_rows = [item for item in rows if isinstance(item, dict)]
            if dict_rows:
                return dict_rows

    candidates: list[dict[str, Any]] = []
    for obj in iter_dicts(data):
        if looks_like_video(obj):
            candidates.append(obj)
    return candidates


def extract_next_token(payload: dict[str, Any], parsed_data: Any) -> str:
    for key in TOKEN_KEYS:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    for node in (parsed_data, payload):
        for obj in iter_dicts(node):
            for key, value in obj.items():
                if "continuation" in key.lower() and isinstance(value, str) and value.strip():
                    return value.strip()
    return ""


def request_page(
    session: requests.Session,
    endpoint: str,
    token: str,
    search_query: str,
    language_code: str,
    order_by: str,
    country_code: str,
    continuation_token: str,
    timeout: int,
) -> tuple[dict[str, Any], Any]:
    params = {
        "search_query": search_query,
        "language_code": language_code,
        "order_by": order_by,
        "country_code": country_code,
    }
    if continuation_token:
        params["continuation_token"] = continuation_token

    headers = {"Authorization": f"Bearer {token}"}
    resp = session.get(endpoint, params=params, headers=headers, timeout=timeout)
    resp.raise_for_status()
    payload = resp.json()
    if not isinstance(payload, dict):
        raise RuntimeError("API payload is not a JSON object.")

    code = payload.get("code")
    if isinstance(code, int) and code != 200:
        message = payload.get("message") or payload.get("message_zh") or "API returned non-200 code."
        raise RuntimeError(f"API error code={code}: {message}")

    parsed_data = decode_json_string(payload.get("data"))
    return payload, parsed_data


def fetch_ranked_videos(args: argparse.Namespace, api_token: str) -> dict[str, Any]:
    if args.video_count <= 0:
        raise RuntimeError("--video-count must be > 0")
    if args.max_pages <= 0:
        raise RuntimeError("--max-pages must be > 0")

    now = datetime.now(timezone.utc)
    videos: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    seen_urls: set[str] = set()
    seen_tokens: set[str] = set()
    used_tokens: list[str] = []
    current_token = args.continuation_token.strip()
    pages = 0
    stop_reason = "max_pages_reached"
    last_next_token = ""

    with requests.Session() as session:
        while pages < args.max_pages and len(videos) < args.video_count:
            pages += 1
            payload, parsed_data = request_page(
                session=session,
                endpoint=args.endpoint,
                token=api_token,
                search_query=args.search_query,
                language_code=args.language_code,
                order_by=args.order_by,
                country_code=args.country_code,
                continuation_token=current_token,
                timeout=args.timeout,
            )

            candidates = collect_video_candidates(parsed_data)
            for item in candidates:
                normalized = normalize_video(item, now=now)
                unique_key = normalized["video_url"] or normalized["video_id"] or normalized["title"]
                if not unique_key:
                    continue
                if normalized["video_id"] and normalized["video_id"] in seen_ids:
                    continue
                if normalized["video_url"] and normalized["video_url"] in seen_urls:
                    continue

                videos.append(normalized)
                if normalized["video_id"]:
                    seen_ids.add(normalized["video_id"])
                if normalized["video_url"]:
                    seen_urls.add(normalized["video_url"])
                if len(videos) >= args.video_count:
                    break

            next_token = extract_next_token(payload, parsed_data)
            last_next_token = next_token
            if not next_token:
                stop_reason = "no_continuation_token"
                break
            if next_token in seen_tokens:
                stop_reason = "duplicate_continuation_token"
                break
            seen_tokens.add(next_token)
            used_tokens.append(next_token)
            current_token = next_token
        else:
            if len(videos) >= args.video_count:
                stop_reason = "target_count_reached"

    videos.sort(key=lambda item: (item["hot_degree"], item["views"]), reverse=True)
    ranked = []
    for idx, item in enumerate(videos[: args.video_count], start=1):
        row = dict(item)
        row["rank"] = idx
        ranked.append(row)

    return {
        "query": args.search_query,
        "requested_count": args.video_count,
        "returned_count": len(ranked),
        "order_by": args.order_by,
        "language_code": args.language_code,
        "country_code": args.country_code,
        "fetched_pages": pages,
        "stop_reason": stop_reason,
        "last_continuation_token": last_next_token,
        "used_continuation_tokens": used_tokens,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "videos": ranked,
    }


def main() -> int:
    args = parse_args()
    try:
        token = resolve_api_token(args)
        result = fetch_ranked_videos(args, api_token=token)
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    payload = json.dumps(result, ensure_ascii=False, indent=2)
    print(payload)
    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
