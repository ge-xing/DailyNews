#!/usr/bin/env python3
"""Generate RSS daily report from a feed list URL (last N hours)."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse
import xml.etree.ElementTree as ET

import requests
from bs4 import BeautifulSoup
from dateutil import parser as date_parser

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from core import AIConfig, GeminiAPI
from core.api import build_public_oss_url, load_oss_config, upload_json_to_oss, upload_markdown_to_oss
from scripts.wechat_formatter import (
    build_wechat_output_path,
    extract_first_h1,
    markdown_to_wechat_html,
    markdown_to_wechat_text,
    save_wechat_output,
)

DEFAULT_GIST_URL = "https://gist.github.com/emschwartz/e6d2bf860ccc367fe37ff953ba6de66b"
USER_AGENT = "Mozilla/5.0 (compatible; KarpathyRSSBot/1.0; +https://github.com)"
OSS_CONFIG = load_oss_config(REPO_ROOT / "env.py")
DEFAULT_REPORT_NAME = "Karpathy 精选 RSS 日报"
DEFAULT_MATERIAL_GROUP_NAME = "Karpathy 精选 RSS 日报素材"


@dataclass
class FeedEntry:
    source: str
    feed_url: str
    title: str
    link: str
    published_raw: str
    published_iso: str
    summary: str
    article_excerpt: str


def log_stage(message: str) -> None:
    print(f"[Stage] {message}", file=sys.stderr, flush=True)


def _progress_line(label: str, done: int, total: int, extra: str = "") -> str:
    if total <= 0:
        return f"\r{label} {done}/{total}{extra}"
    width = 28
    ratio = max(0.0, min(1.0, done / total))
    filled = int(width * ratio)
    bar = "#" * filled + "-" * (width - filled)
    return f"\r{label} [{bar}] {done}/{total}{extra}"


def progress_update(label: str, done: int, total: int, extra: str = "") -> None:
    print(_progress_line(label, done, total, extra), end="", file=sys.stderr, flush=True)


def progress_end() -> None:
    print(file=sys.stderr, flush=True)


def parse_args() -> argparse.Namespace:
    now = datetime.now(timezone.utc)
    default_prompt = REPO_ROOT / "skills" / "m2hGLrr0fO5x7H.prompt.md"
    default_api_key = REPO_ROOT / "api_key.text"
    upload_oss_env = os.getenv("DAILY_NEWS_UPLOAD_OSS", "").strip().lower()
    if upload_oss_env:
        default_upload_oss = upload_oss_env in {"1", "true", "yes", "on"}
    else:
        default_upload_oss = all(
            OSS_CONFIG.get(k, "").strip()
            for k in ("access_key_id", "access_key_secret", "bucket_name", "endpoint")
        )

    parser = argparse.ArgumentParser(description="Fetch feed items from a feed list URL and generate daily report.")
    parser.add_argument("--prompt-file", type=Path, default=default_prompt)
    parser.add_argument(
        "--api-key-file",
        type=Path,
        default=default_api_key,
        help="Gemini API key file fallback. Env first: GEMINI_API_KEY / GOOGLE_API_KEY.",
    )
    parser.add_argument(
        "--gist-url",
        default=DEFAULT_GIST_URL,
        help="Feed list URL. Supports GitHub Gist links and normal webpages containing feed URLs.",
    )
    parser.add_argument(
        "--report-name",
        default=DEFAULT_REPORT_NAME,
        help="Report name used in output filenames (without date prefix).",
    )
    parser.add_argument(
        "--material-group-name",
        default=DEFAULT_MATERIAL_GROUP_NAME,
        help="Material group name used in output folder name (without date prefix).",
    )
    parser.add_argument(
        "--date",
        default=now.astimezone().strftime("%Y-%m-%d"),
        help="Date label used in output naming.",
    )
    parser.add_argument(
        "--window-hours",
        type=int,
        default=24,
        help="Only keep entries published in this recent window.",
    )
    parser.add_argument(
        "--max-feeds",
        type=int,
        default=92,
        help="Max feed URLs extracted from feed list URL (default 92).",
    )
    parser.add_argument(
        "--max-per-source",
        type=int,
        default=2,
        help="Max selected entries per feed source.",
    )
    parser.add_argument("--max-workers", type=int, default=12)
    parser.add_argument("--feed-timeout", type=int, default=12)
    parser.add_argument("--article-timeout", type=int, default=12)
    parser.add_argument("--model", default="gemini-2.5-flash")
    parser.add_argument("--input", help="Supplementary instruction text.")
    parser.add_argument("--input-file", type=Path, help="Supplementary instruction file.")
    parser.add_argument(
        "--feed-list-file",
        type=Path,
        help="Read feed URLs from a local text/markdown file instead of fetching --gist-url.",
    )
    parser.add_argument("--save", type=Path, help="Save report markdown to this path.")
    parser.add_argument(
        "--save-wechat",
        type=Path,
        help="Save WeChat-friendly text version to this path.",
    )
    parser.add_argument(
        "--save-wechat-html",
        type=Path,
        help="Save WeChat-friendly HTML version to this path.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=REPO_ROOT / "outputs",
        help="Directory for default outputs.",
    )
    parser.add_argument(
        "--no-save",
        action="store_true",
        help="Do not save report markdown.",
    )
    parser.add_argument(
        "--no-wechat",
        action="store_true",
        help="Do not generate WeChat-format text output file.",
    )
    parser.add_argument(
        "--no-wechat-html",
        action="store_true",
        help="Do not generate WeChat-format HTML output file.",
    )
    parser.add_argument(
        "--upload-oss",
        action="store_true",
        default=default_upload_oss,
        help="Upload the saved report markdown to Aliyun OSS (auto-enabled when env.py has full OSS config).",
    )
    parser.add_argument(
        "--oss-access-key-id",
        default=OSS_CONFIG.get("access_key_id", ""),
        help="OSS AccessKey ID (default from env.py).",
    )
    parser.add_argument(
        "--oss-access-key-secret",
        default=OSS_CONFIG.get("access_key_secret", ""),
        help="OSS AccessKey Secret (default from env.py).",
    )
    parser.add_argument(
        "--oss-bucket-name",
        default=OSS_CONFIG.get("bucket_name", ""),
        help="OSS bucket name (default from env.py).",
    )
    parser.add_argument(
        "--oss-endpoint",
        default=OSS_CONFIG.get("endpoint", ""),
        help="OSS endpoint, e.g. oss-cn-beijing.aliyuncs.com (default from env.py).",
    )
    parser.add_argument(
        "--oss-public-base-url",
        default=OSS_CONFIG.get("public_base_url", ""),
        help="Optional public base URL (CDN/custom domain, default from env.py).",
    )
    parser.add_argument(
        "--oss-prefix",
        default=OSS_CONFIG.get("prefix", "") or "daily-news/reports",
        help="OSS object prefix when --oss-object-name is not set.",
    )
    parser.add_argument(
        "--oss-object-name",
        help="Explicit OSS object name for the report markdown.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch data and print stats only, skip Gemini generation.",
    )
    return parser.parse_args()


def read_text(path: Path, label: str) -> str:
    if not path.exists():
        raise FileNotFoundError(f"{label} not found: {path}")
    return path.read_text(encoding="utf-8").strip()


def resolve_user_input(args: argparse.Namespace) -> str:
    provided = [bool(args.input), bool(args.input_file)]
    if sum(provided) > 1:
        raise ValueError("Use either --input or --input-file, not both.")
    if args.input:
        return args.input.strip()
    if args.input_file:
        return read_text(args.input_file, "Input file")
    if not sys.stdin.isatty():
        return sys.stdin.read().strip()
    return ""


def _local_name(tag: str) -> str:
    if "}" in tag:
        return tag.rsplit("}", 1)[-1].lower()
    return tag.lower()


def _text_of(elem: ET.Element | None) -> str:
    if elem is None:
        return ""
    return " ".join("".join(elem.itertext()).split()).strip()


def _first_child(elem: ET.Element, names: set[str]) -> ET.Element | None:
    for child in list(elem):
        if _local_name(child.tag) in names:
            return child
    return None


def _first_child_text(elem: ET.Element, names: set[str]) -> str:
    child = _first_child(elem, names)
    return _text_of(child)


def _parse_datetime(value: str) -> datetime | None:
    raw = (value or "").strip()
    if not raw:
        return None
    try:
        dt = parsedate_to_datetime(raw)
    except Exception:
        try:
            dt = date_parser.parse(raw)
        except Exception:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _normalize_url(url: str) -> str:
    return url.strip().rstrip(".,);]")


def _is_probably_feed_xml(text: str) -> bool:
    head = text.lstrip()[:800].lower()
    return "<rss" in head or "<feed" in head or "<rdf:rdf" in head


def _extract_urls(text: str) -> list[str]:
    candidates = re.findall(r"https?://[^\s<>\"'`]+", text)
    seen: set[str] = set()
    out: list[str] = []
    for c in candidates:
        url = _normalize_url(c)
        if url and url not in seen:
            seen.add(url)
            out.append(url)
    return out


def _extract_gist_id(gist_url: str) -> str:
    patterns = [
        r"gist\.github\.com/[^/]+/([0-9a-fA-F]+)",
        r"gist\.githubusercontent\.com/[^/]+/([0-9a-fA-F]+)",
    ]
    for pat in patterns:
        m = re.search(pat, gist_url)
        if m:
            return m.group(1)
    raise ValueError(f"Cannot parse gist id from URL: {gist_url}")


def fetch_gist_content(gist_url: str, timeout: int = 20) -> str:
    headers = {"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"}
    if "gist.githubusercontent.com" in gist_url:
        resp = requests.get(gist_url, headers=headers, timeout=timeout)
        resp.raise_for_status()
        return resp.text

    if "gist.github.com" in gist_url:
        gist_id = _extract_gist_id(gist_url)
        api_url = f"https://api.github.com/gists/{gist_id}"
        resp = requests.get(api_url, headers=headers, timeout=timeout)
        resp.raise_for_status()
        payload = resp.json()

        files = payload.get("files", {})
        if not files:
            raise RuntimeError("No files found in gist payload.")

        chunks: list[str] = []
        for name in sorted(files.keys()):
            content = files[name].get("content", "")
            if content:
                chunks.append(content)

        if not chunks:
            raise RuntimeError("Gist files found but all file content is empty.")
        return "\n\n".join(chunks)

    resp = requests.get(gist_url, headers={"User-Agent": USER_AGENT}, timeout=timeout)
    resp.raise_for_status()
    return resp.text


def _domain(url: str) -> str:
    host = urlparse(url).netloc.lower()
    return host[4:] if host.startswith("www.") else host


def parse_feed_urls_from_gist(content: str, max_feeds: int) -> list[str]:
    all_urls = _extract_urls(content)

    # Drop obvious non-feed references from the gist body itself.
    excluded_hosts = {"gist.github.com", "github.com", "gist.githubusercontent.com"}
    feed_urls: list[str] = []
    for url in all_urls:
        if _domain(url) in excluded_hosts:
            continue
        feed_urls.append(url)

    if not feed_urls:
        raise RuntimeError("No candidate URLs extracted from gist content.")

    return feed_urls[:max_feeds] if max_feeds > 0 else feed_urls


def discover_feed_url(page_url: str, html: str) -> str | None:
    soup = BeautifulSoup(html, "html.parser")
    for link in soup.find_all("link"):
        rel = " ".join(link.get("rel") or []).lower()
        typ = (link.get("type") or "").lower()
        href = link.get("href")
        if not href:
            continue
        if "alternate" in rel and ("rss" in typ or "atom" in typ or "xml" in typ):
            return urljoin(page_url, href)

    for a in soup.find_all("a"):
        href = a.get("href")
        if not href:
            continue
        low = href.lower()
        if "rss" in low or "atom" in low or "feed" in low:
            return urljoin(page_url, href)
    return None


def _parse_rss_or_rdf(root: ET.Element, fallback_source: str) -> tuple[str, list[dict[str, str]]]:
    channel = _first_child(root, {"channel"})
    source = _first_child_text(channel, {"title"}) if channel is not None else ""
    source = source or fallback_source

    entries: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for item in root.iter():
        if _local_name(item.tag) != "item":
            continue
        title = _first_child_text(item, {"title"})
        link = _first_child_text(item, {"link"})
        if not link:
            link = _first_child_text(item, {"guid"})
        published_raw = _first_child_text(
            item, {"pubdate", "published", "updated", "date", "issued", "dc:date"}
        )
        summary_raw = _first_child_text(item, {"description", "summary", "content", "encoded"})
        summary = _clean_text(summary_raw, 600)

        key = (title.strip().lower(), link.strip())
        if title and link and key not in seen:
            seen.add(key)
            entries.append(
                {
                    "title": title,
                    "link": link,
                    "published_raw": published_raw,
                    "summary": summary,
                }
            )
    return source, entries


def _parse_atom(root: ET.Element, fallback_source: str) -> tuple[str, list[dict[str, str]]]:
    source = _first_child_text(root, {"title"}) or fallback_source
    entries: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()

    for entry in list(root):
        if _local_name(entry.tag) != "entry":
            continue
        title = _first_child_text(entry, {"title"})

        link = ""
        for child in list(entry):
            if _local_name(child.tag) != "link":
                continue
            rel = (child.attrib.get("rel") or "alternate").lower()
            href = child.attrib.get("href")
            if href and rel in {"alternate", ""}:
                link = href
                break
            if href and not link:
                link = href

        published_raw = _first_child_text(entry, {"published", "updated", "created", "issued"})
        summary_raw = _first_child_text(entry, {"summary", "content"})
        summary = _clean_text(summary_raw, 600)

        key = (title.strip().lower(), link.strip())
        if title and link and key not in seen:
            seen.add(key)
            entries.append(
                {
                    "title": title,
                    "link": link,
                    "published_raw": published_raw,
                    "summary": summary,
                }
            )

    return source, entries


def parse_feed_xml(feed_url: str, xml_text: str) -> tuple[str, list[dict[str, str]]]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise RuntimeError(f"Invalid XML for {feed_url}: {exc}") from exc

    name = _local_name(root.tag)
    fallback_source = _domain(feed_url) or feed_url

    if name in {"rss", "rdf"}:
        return _parse_rss_or_rdf(root, fallback_source)
    if name == "feed":
        return _parse_atom(root, fallback_source)

    # Some feeds return XML wrapper with nested rss/feed
    for child in list(root):
        child_name = _local_name(child.tag)
        if child_name in {"rss", "rdf", "feed"}:
            return parse_feed_xml(feed_url, ET.tostring(child, encoding="unicode"))

    raise RuntimeError(f"Unsupported feed root tag: {root.tag}")


def _clean_text(raw: str, max_len: int) -> str:
    if not raw:
        return ""
    if "<" not in raw and ">" not in raw:
        text = " ".join(raw.split())
    else:
        soup = BeautifulSoup(raw, "html.parser")
        text = " ".join(soup.get_text(" ", strip=True).split())
    return text[:max_len]


def fetch_feed_entries(feed_url: str, timeout: int) -> tuple[str, str, list[dict[str, str]]]:
    headers = {"User-Agent": USER_AGENT}
    resp = requests.get(feed_url, headers=headers, timeout=timeout)
    resp.raise_for_status()
    text = resp.text

    if _is_probably_feed_xml(text):
        source, entries = parse_feed_xml(feed_url, text)
        return feed_url, source, entries

    discovered = discover_feed_url(feed_url, text)
    if not discovered:
        raise RuntimeError("Not a feed XML and no alternate feed discovered")

    resp2 = requests.get(discovered, headers=headers, timeout=timeout)
    resp2.raise_for_status()
    text2 = resp2.text
    if not _is_probably_feed_xml(text2):
        raise RuntimeError(f"Discovered feed URL is not XML: {discovered}")

    source, entries = parse_feed_xml(discovered, text2)
    return discovered, source, entries


def select_recent_entries(
    feed_urls: list[str],
    window_hours: int,
    max_per_source: int,
    max_workers: int,
    feed_timeout: int,
    show_progress: bool = True,
) -> tuple[list[FeedEntry], dict[str, int]]:
    now_utc = datetime.now(timezone.utc)
    window_start = now_utc - timedelta(hours=window_hours)

    selected: list[FeedEntry] = []
    stats = {
        "feeds_total": len(feed_urls),
        "feeds_ok": 0,
        "feeds_failed": 0,
        "items_in_window": 0,
    }

    def _task(url: str) -> tuple[str, str, list[dict[str, str]]]:
        return fetch_feed_entries(url, feed_timeout)

    feed_results: list[tuple[str, str, list[dict[str, str]]]] = []
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        future_map = {pool.submit(_task, url): url for url in feed_urls}
        total = len(future_map)
        done = 0
        if show_progress and total > 0:
            progress_update("正在爬取信源", 0, total)
        for fut in as_completed(future_map):
            try:
                resolved_feed_url, source, entries = fut.result()
                feed_results.append((resolved_feed_url, source, entries))
                stats["feeds_ok"] += 1
            except Exception:
                stats["feeds_failed"] += 1
            finally:
                done += 1
                if show_progress and total > 0:
                    extra = f" | 成功 {stats['feeds_ok']} 失败 {stats['feeds_failed']}"
                    progress_update("正在爬取信源", done, total, extra=extra)
        if show_progress and total > 0:
            progress_end()

    grouped: dict[str, list[FeedEntry]] = defaultdict(list)
    grouped_seen: dict[str, set[tuple[str, str]]] = defaultdict(set)
    for resolved_feed_url, source, entries in feed_results:
        source_name = source or _domain(resolved_feed_url)
        source_key = f"{source_name}||{resolved_feed_url}"
        for item in entries:
            pub_dt = _parse_datetime(item.get("published_raw", ""))
            if pub_dt is None or pub_dt < window_start or pub_dt > now_utc + timedelta(minutes=5):
                continue
            entry = FeedEntry(
                source=source_name,
                feed_url=resolved_feed_url,
                title=item.get("title", "").strip(),
                link=item.get("link", "").strip(),
                published_raw=item.get("published_raw", "").strip(),
                published_iso=pub_dt.isoformat(),
                summary=item.get("summary", "").strip(),
                article_excerpt="",
            )
            dedupe_key = (entry.title.strip().lower(), entry.link.strip())
            if entry.title and entry.link and dedupe_key not in grouped_seen[source_key]:
                grouped_seen[source_key].add(dedupe_key)
                grouped[source_key].append(entry)

    for _, items in grouped.items():
        items.sort(key=lambda x: x.published_iso, reverse=True)
        picks = items[:max_per_source]
        selected.extend(picks)

    selected.sort(key=lambda x: x.published_iso, reverse=True)
    stats["items_in_window"] = len(selected)
    return selected, stats


def fetch_article_excerpt(url: str, timeout: int) -> str:
    headers = {"User-Agent": USER_AGENT}
    resp = requests.get(url, headers=headers, timeout=timeout)
    resp.raise_for_status()

    ctype = (resp.headers.get("content-type") or "").lower()
    if "html" not in ctype and "xml" not in ctype:
        return ""

    soup = BeautifulSoup(resp.text, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header", "aside", "noscript"]):
        tag.extract()

    article = soup.find("article")
    container = article if article else soup.body
    if container is None:
        container = soup

    pieces: list[str] = []
    for p in container.find_all(["p", "li"]):
        txt = " ".join(p.get_text(" ", strip=True).split())
        if len(txt) >= 40:
            pieces.append(txt)
        if sum(len(x) for x in pieces) >= 3000:
            break

    if not pieces:
        text = " ".join(container.get_text(" ", strip=True).split())
    else:
        text = "\n".join(pieces)
    return text[:3000]


def enrich_articles(
    entries: list[FeedEntry],
    max_workers: int,
    timeout: int,
    show_progress: bool = True,
) -> None:
    def _task(i: int, link: str) -> tuple[int, str]:
        try:
            return i, fetch_article_excerpt(link, timeout)
        except Exception:
            return i, ""

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futs = [pool.submit(_task, i, e.link) for i, e in enumerate(entries)]
        total = len(futs)
        done = 0
        ok_count = 0
        if show_progress and total > 0:
            progress_update("正在抓取原文", 0, total)
        for fut in as_completed(futs):
            idx, excerpt = fut.result()
            entries[idx].article_excerpt = excerpt
            if excerpt:
                ok_count += 1
            done += 1
            if show_progress and total > 0:
                progress_update("正在抓取原文", done, total, extra=f" | 成功 {ok_count}")
        if show_progress and total > 0:
            progress_end()


def save_material_group(
    base_dir: Path,
    date_label: str,
    entries: list[FeedEntry],
    material_group_name: str,
) -> Path:
    group_name = (material_group_name or "").strip() or DEFAULT_MATERIAL_GROUP_NAME
    group_dir = base_dir / f"{date_label} - {group_name}"
    group_dir.mkdir(parents=True, exist_ok=True)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(entries),
        "items": [asdict(e) for e in entries],
    }
    (group_dir / "materials.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    lines = [
        f"# {date_label} - {group_name}",
        "",
        f"- 条目数：{len(entries)}",
        f"- 生成时间（UTC）：{payload['generated_at']}",
        "",
    ]
    for idx, e in enumerate(entries, start=1):
        lines.extend(
            [
                f"## {idx}. {e.title}",
                f"- Source: {e.source}",
                f"- Published: {e.published_iso}",
                f"- Link: {e.link}",
                f"- Feed: {e.feed_url}",
                f"- Feed 摘要: {e.summary or '(无)'}",
                f"- 原文摘录: {e.article_excerpt or '(抓取失败或为空)'}",
                "",
            ]
        )
    (group_dir / "materials.md").write_text("\n".join(lines), encoding="utf-8")
    return group_dir


def response_to_text(response: Any) -> str:
    text = getattr(response, "text", None)
    if isinstance(text, str) and text.strip():
        return text.strip()

    chunks: list[str] = []
    candidates = getattr(response, "candidates", None) or []
    for cand in candidates:
        content = getattr(cand, "content", None)
        parts = getattr(content, "parts", None) or []
        for part in parts:
            value = getattr(part, "text", None)
            if isinstance(value, str) and value.strip():
                chunks.append(value.strip())

    merged = "\n\n".join(chunks).strip()
    if not merged:
        raise RuntimeError("Gemini returned no text output.")
    return merged


def postprocess_report(report: str, gist_url: str, report_name: str) -> str:
    text = report.strip()

    # Models sometimes wrap markdown in code fences; unwrap for direct publishing.
    if text.startswith("```"):
        lines = text.splitlines()
        if len(lines) >= 2 and lines[-1].strip().startswith("```"):
            text = "\n".join(lines[1:-1]).strip()

    text = re.sub(
        r"https?://(?:www\\.)?gist\\.com/emschwartz/e6d2bf860ccc367fe37ff953ba6de66b",
        gist_url,
        text,
        flags=re.IGNORECASE,
    )
    text = text.replace(
        "https://youmind.com/rss/pack/andrej-karpathy-curated-rss",
        gist_url,
    )

    clean_report_name = (report_name or "").strip()
    summary_line_pattern = r"(?m)^>\s*.+?\|\s*共\s*([^\n]*?)\s*条更新\s*$"
    summary_match = re.search(summary_line_pattern, text)
    if summary_match:
        # Drop any model preamble before the summary line.
        text = text[summary_match.start() :].lstrip()

    if clean_report_name:
        # Force the leading summary quote line to use the current report name.
        text, replaced = re.subn(
            summary_line_pattern,
            lambda m: f"> {clean_report_name} | 共 {m.group(1).strip()} 条更新",
            text,
            count=1,
        )
        if replaced == 0:
            guessed_count = extractItemCount(text)
            if guessed_count > 0:
                text = f"> {clean_report_name} | 共 {guessed_count} 条更新\n\n{text}".strip()
            else:
                text = f"> {clean_report_name} | 共 N 条更新\n\n{text}".strip()

    # Remove footer signature/source line if the model still outputs it.
    text = re.sub(
        r"(?mi)^\*?\s*本日报由\s*AI\s*自动生成\s*\|\s*数据源：.*$",
        "",
        text,
    )
    text = re.sub(
        r"(?mi)^\*?\s*this report was .*data source.*$",
        "",
        text,
    )
    # Collapse excessive blank lines introduced by footer removal.
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


def build_full_prompt(
    prompt_template: str,
    date_label: str,
    window_hours: int,
    gist_url: str,
    entries: list[FeedEntry],
    user_input: str,
    report_name: str,
) -> str:
    materials_json = json.dumps([asdict(e) for e in entries], ensure_ascii=False, indent=2)
    extra = f"\n补充要求：{user_input.strip()}" if user_input.strip() else ""

    return (
        f"{prompt_template.strip()}\n\n"
        "严格执行以下约束：\n"
        "1) 只基于‘已抓取素材’生成，不得编造不存在的来源、标题、链接或时间。\n"
        "2) 每个主题段落至少附带引用链接。\n"
        "3) 如果某条素材没有原文摘录，需明确标注‘仅基于 feed 摘要’。\n"
        "4) 输出必须是完整 markdown 文档。\n"
        "5) 不要输出任何尾注、署名或“本日报由 AI 自动生成 | 数据源”这一类文案。\n\n"
        f"执行上下文：\n- 日报名称：{report_name}\n- 日期标签：{date_label}\n- 统计窗口：过去 {window_hours} 小时\n- 数据源列表：{gist_url}{extra}\n\n"
        "已抓取素材（JSON）：\n"
        f"```json\n{materials_json}\n```\n"
    )


def save_report(
    default_dir: Path,
    date_label: str,
    report_name: str,
    text: str,
    explicit_path: Path | None,
) -> Path:
    clean_report_name = (report_name or "").strip() or DEFAULT_REPORT_NAME
    path = explicit_path or (default_dir / f"{date_label} - {clean_report_name}.md")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text.rstrip() + "\n", encoding="utf-8")
    return path


def build_oss_object_name(prefix: str, file_name: str) -> str:
    clean_prefix = (prefix or "").strip().strip("/")
    if clean_prefix:
        return f"{clean_prefix}/{file_name}"
    return file_name


def build_oss_index_object_name(prefix: str) -> str:
    return build_oss_object_name(prefix, "index.json")


def extractItemCount(text: str) -> int:
    match = re.search(r"\*\*(\d+)\*\*\s*条 RSS 更新", text, flags=re.IGNORECASE) or re.search(
        r"(\d+)\s*条 RSS 更新", text, flags=re.IGNORECASE
    )
    return int(match.group(1)) if match else 0


def extractThemeCount(text: str) -> int:
    match = re.search(r"\*\*(\d+)\*\*\s*个核心主题", text, flags=re.IGNORECASE) or re.search(
        r"(\d+)\s*个核心主题", text, flags=re.IGNORECASE
    )
    return int(match.group(1)) if match else 0


def buildExcerpt(text: str) -> str:
    lines = []
    for raw in text.split("\n"):
        line = raw.strip()
        if not line:
            continue
        if line.startswith("[^") or line.startswith("---") or line.startswith("#") or line.startswith(">"):
            continue
        lines.append(line)
    if not lines:
        return "暂无摘要。"
    excerpt = " ".join(lines[:2])
    excerpt = re.sub(r"[*_`]", "", excerpt)
    return excerpt[:160]


def fetch_existing_oss_index(index_url: str) -> list[dict[str, Any]]:
    if not index_url:
        return []
    try:
        resp = requests.get(index_url, timeout=12)
        if resp.status_code != 200:
            return []
        payload = resp.json()
        items = payload.get("items", []) if isinstance(payload, dict) else []
        if isinstance(items, list):
            return [it for it in items if isinstance(it, dict)]
        return []
    except Exception:
        return []


def upsert_oss_index_items(
    items: list[dict[str, Any]],
    new_item: dict[str, Any],
) -> list[dict[str, Any]]:
    key = str(new_item.get("fileName", "")).strip()
    out: list[dict[str, Any]] = []
    replaced = False
    for item in items:
        if str(item.get("fileName", "")).strip() == key and key:
            out.append(new_item)
            replaced = True
        else:
            out.append(item)
    if not replaced:
        out.append(new_item)

    def _sort_key(v: dict[str, Any]) -> tuple[str, str]:
        return (
            str(v.get("date") or ""),
            str(v.get("updatedAt") or ""),
        )

    out.sort(key=_sort_key, reverse=True)
    return out


def main() -> int:
    args = parse_args()

    try:
        log_stage("正在加载提示词与输入参数")
        prompt_template = read_text(args.prompt_file, "Prompt file")
        user_input = resolve_user_input(args)
        if args.feed_list_file:
            log_stage("正在读取本地 feed 列表文件")
            feed_source_content = read_text(args.feed_list_file, "Feed list file")
        else:
            log_stage("正在读取 feed 列表来源")
            feed_source_content = fetch_gist_content(args.gist_url)
        feed_urls = parse_feed_urls_from_gist(feed_source_content, args.max_feeds)
        log_stage(f"已获取 {len(feed_urls)} 个候选信源，开始筛选过去 {args.window_hours} 小时内容")
        entries, stats = select_recent_entries(
            feed_urls=feed_urls,
            window_hours=args.window_hours,
            max_per_source=args.max_per_source,
            max_workers=args.max_workers,
            feed_timeout=args.feed_timeout,
            show_progress=True,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    if not entries:
        print(
            "Error: no feed entries found in the selected time window. "
            "Try increasing --window-hours.",
            file=sys.stderr,
        )
        return 1

    log_stage(f"开始抓取 {len(entries)} 条精选条目的原文")
    enrich_articles(
        entries,
        max_workers=max(4, min(args.max_workers, 16)),
        timeout=args.article_timeout,
        show_progress=True,
    )
    log_stage("正在写入素材组文件")
    material_dir = save_material_group(
        args.output_dir,
        args.date,
        entries,
        args.material_group_name,
    )

    print(
        (
            f"[Fetch] feeds={stats['feeds_total']} ok={stats['feeds_ok']} failed={stats['feeds_failed']} "
            f"selected_items={stats['items_in_window']}"
        ),
        file=sys.stderr,
    )
    print(f"[Materials] {material_dir}", file=sys.stderr)

    full_prompt = build_full_prompt(
        prompt_template=prompt_template,
        date_label=args.date,
        window_hours=args.window_hours,
        gist_url=args.gist_url,
        entries=entries,
        user_input=user_input,
        report_name=args.report_name,
    )

    if args.dry_run:
        print("[Dry Run] Gemini generation skipped.", file=sys.stderr)
        print(f"[Dry Run] prompt_length={len(full_prompt)} chars", file=sys.stderr)
        print(f"[Dry Run] selected_items={len(entries)}", file=sys.stderr)
        return 0

    try:
        log_stage(f"正在调用 Gemini 生成日报（模型: {args.model}）")
        config = AIConfig(api_key_path=str(args.api_key_file))
        if not config.has_api_key:
            raise RuntimeError(
                "Gemini API key not found. Set GEMINI_API_KEY/GOOGLE_API_KEY "
                f"or provide --api-key-file ({args.api_key_file})."
            )
        gemini = GeminiAPI(config)
        response = gemini.generate_content(contents=full_prompt, model=args.model)
        report = response_to_text(response)
        report = postprocess_report(report, args.gist_url, args.report_name)
    except Exception as exc:  # noqa: BLE001
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    md_out_path: Path | None = None
    if not args.no_save:
        log_stage("正在保存日报文件")
        md_out_path = save_report(
            args.output_dir,
            args.date,
            args.report_name,
            report,
            args.save,
        )
        print(f"[Saved] {md_out_path}", file=sys.stderr)

    if args.upload_oss:
        if md_out_path is None:
            log_stage("启用 OSS 上传：先保存日报文件")
            md_out_path = save_report(
                args.output_dir,
                args.date,
                args.report_name,
                report,
                args.save,
            )
            print(f"[Saved] {md_out_path}", file=sys.stderr)

        oss_object_name = args.oss_object_name or build_oss_object_name(args.oss_prefix, md_out_path.name)
        try:
            log_stage("正在上传日报 Markdown 到 OSS")
            oss_url = upload_markdown_to_oss(
                local_file=str(md_out_path),
                access_key_id=args.oss_access_key_id or "",
                access_key_secret=args.oss_access_key_secret or "",
                bucket_name=args.oss_bucket_name or "",
                endpoint=args.oss_endpoint or "",
                oss_object_name=oss_object_name,
                public_base_url=args.oss_public_base_url,
            )
            print(f"[OSS] {oss_url}", file=sys.stderr)

            index_object_name = build_oss_index_object_name(args.oss_prefix)
            index_url = build_public_oss_url(
                bucket_name=args.oss_bucket_name or "",
                endpoint=args.oss_endpoint or "",
                oss_object_name=index_object_name,
                public_base_url=args.oss_public_base_url or None,
            )
            existing_items = fetch_existing_oss_index(index_url)

            title_line = next((line.strip() for line in report.splitlines() if line.strip()), md_out_path.stem)
            new_item = {
                "fileName": md_out_path.name,
                "title": title_line,
                "date": args.date,
                "url": oss_url,
                "objectName": oss_object_name,
                "excerpt": buildExcerpt(report),
                "itemCount": extractItemCount(report),
                "themeCount": extractThemeCount(report),
                "updatedAt": datetime.now(timezone.utc).isoformat(),
            }
            index_items = upsert_oss_index_items(existing_items, new_item)
            index_payload = {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "count": len(index_items),
                "prefix": args.oss_prefix,
                "items": index_items,
            }
            index_public_url = upload_json_to_oss(
                payload=index_payload,
                access_key_id=args.oss_access_key_id or "",
                access_key_secret=args.oss_access_key_secret or "",
                bucket_name=args.oss_bucket_name or "",
                endpoint=args.oss_endpoint or "",
                oss_object_name=index_object_name,
                public_base_url=args.oss_public_base_url,
            )
            print(f"[OSS Index] {index_public_url}", file=sys.stderr)
        except Exception as exc:  # noqa: BLE001
            print(f"Error: failed to upload report markdown to OSS: {exc}", file=sys.stderr)
            return 1

    if not args.no_wechat:
        if args.save_wechat is not None or not args.no_save:
            log_stage("正在保存公众号格式文件")
            wechat_text = markdown_to_wechat_text(report)
            wechat_text_ext = md_out_path.suffix if md_out_path is not None and md_out_path.suffix else ".md"
            wechat_path = build_wechat_output_path(
                default_dir=args.output_dir,
                date_label=args.date,
                report_name=args.report_name,
                explicit_path=args.save_wechat,
                md_path=md_out_path,
                extension=wechat_text_ext,
            )
            wechat_out_path = save_wechat_output(wechat_path, wechat_text)
            print(f"[Saved WeChat] {wechat_out_path}", file=sys.stderr)

    if not args.no_wechat_html:
        if args.save_wechat_html is not None or not args.no_save:
            log_stage("正在保存公众号 HTML 文件")
            wechat_html = markdown_to_wechat_html(
                report,
                title=extract_first_h1(report),
                style_variant="default",
            )
            wechat_html_path = build_wechat_output_path(
                default_dir=args.output_dir,
                date_label=args.date,
                report_name=args.report_name,
                explicit_path=args.save_wechat_html,
                md_path=md_out_path,
                extension=".html",
            )
            wechat_html_out_path = save_wechat_output(wechat_html_path, wechat_html)
            print(f"[Saved WeChat HTML] {wechat_html_out_path}", file=sys.stderr)

    print(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
