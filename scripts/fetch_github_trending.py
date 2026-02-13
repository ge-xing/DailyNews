#!/usr/bin/env python3
"""Fetch GitHub trending results and print normalized JSON to stdout."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from apis_trending.search1_trending import fetch_trending
from core import AIConfig, GeminiAPI


DEFAULT_MODEL = "gemini-2.5-flash"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch GitHub trending from Search1API.")
    parser.add_argument("--max-results", type=int, default=20)
    parser.add_argument(
        "--api-key-path",
        type=str,
        default="trending_api.txt",
        help="Search1 key file fallback. Env first: SEARCH1_API_KEY / TRENDING_API_KEY.",
    )
    parser.add_argument("--base-url", type=str, default="https://api.302.ai")
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument("--translate", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--model", type=str, default=DEFAULT_MODEL)
    parser.add_argument(
        "--gemini-api-key-path",
        type=str,
        default="api_key.text",
        help="Gemini key file fallback. Env first: GEMINI_API_KEY / GOOGLE_API_KEY.",
    )
    parser.add_argument("--vertex-path", type=str, default="vertex_1.json")
    return parser.parse_args()


def extract_response_text(response: Any) -> str:
    if response is None:
        return ""
    text = getattr(response, "text", None)
    if isinstance(text, str) and text.strip():
        return text.strip()
    try:
        candidates = getattr(response, "candidates", None)
        if candidates:
            parts: List[str] = []
            for candidate in candidates:
                content = getattr(candidate, "content", None)
                candidate_parts = getattr(content, "parts", None)
                if candidate_parts:
                    for part in candidate_parts:
                        part_text = getattr(part, "text", None)
                        if isinstance(part_text, str) and part_text.strip():
                            parts.append(part_text.strip())
            if parts:
                return "\n".join(parts).strip()
    except Exception:
        pass
    return str(response)


def parse_json_array(text: str) -> List[str]:
    candidate = text.strip()
    if candidate.startswith("```"):
        lines = [line for line in candidate.splitlines() if not line.startswith("```")]
        candidate = "\n".join(lines).strip()

    parsed = json.loads(candidate)
    if not isinstance(parsed, list):
        raise ValueError("Gemini response is not a JSON array.")

    values: List[str] = []
    for item in parsed:
        if isinstance(item, str):
            values.append(item.strip())
        elif item is None:
            values.append("")
        else:
            values.append(str(item).strip())
    return values


def pick_first(item: Dict[str, Any], keys: List[str]) -> str:
    for key in keys:
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return str(value)
    return ""


def collect_results(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, dict):
        for key in ("results", "items", "data"):
            rows = payload.get(key)
            if isinstance(rows, list):
                return [row for row in rows if isinstance(row, dict)]
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    return []


def translate_descriptions(
    descriptions: List[str],
    model: str,
    gemini_api_key_path: str,
    vertex_path: str,
) -> List[str]:
    if not descriptions:
        return []

    config = AIConfig(api_key_path=gemini_api_key_path, vertex_path=vertex_path)
    if not config.has_api_key:
        raise RuntimeError(
            "Missing Gemini API key. Set GEMINI_API_KEY/GOOGLE_API_KEY "
            f"or provide --gemini-api-key-path ({gemini_api_key_path})."
        )

    api = GeminiAPI(config)
    prompt = (
        "请把下面 JSON 数组中的英文简介翻译为简体中文。\n"
        "输出必须是严格 JSON 数组，长度与输入一致。\n"
        "每个元素只包含对应翻译文本，不要添加说明。\n"
        "输入为空字符串时，输出也必须是空字符串。\n\n"
        f"输入：{json.dumps(descriptions, ensure_ascii=False)}\n"
    )

    response = api.generate_content([prompt], model=model)
    translated_text = extract_response_text(response)
    translated = parse_json_array(translated_text)
    if len(translated) != len(descriptions):
        raise RuntimeError("Gemini translation length mismatch.")
    return translated


def main() -> int:
    args = parse_args()
    payload = fetch_trending(
        search_service="github",
        max_results=args.max_results,
        api_key_path=str(Path(args.api_key_path)),
        base_url=args.base_url,
        timeout=args.timeout,
    )

    rows = collect_results(payload)
    descriptions = [pick_first(row, ["description", "snippet", "summary", "excerpt"]) for row in rows]

    translation_error = ""
    descriptions_zh = ["" for _ in rows]
    if args.translate:
        try:
            descriptions_zh = translate_descriptions(
                descriptions=descriptions,
                model=args.model,
                gemini_api_key_path=args.gemini_api_key_path,
                vertex_path=args.vertex_path,
            )
        except Exception as exc:
            translation_error = str(exc)

    items = []
    for idx, row in enumerate(rows, start=1):
        items.append(
            {
                "rank": idx,
                "title": pick_first(row, ["title", "name", "repo_name", "repository", "full_name", "headline"]),
                "url": pick_first(row, ["url", "link", "html_url", "repository_url"]),
                "description_en": descriptions[idx - 1],
                "description_zh": descriptions_zh[idx - 1] if idx - 1 < len(descriptions_zh) else "",
                "language": pick_first(row, ["language", "lang"]),
                "stars": pick_first(row, ["stars", "stargazers_count", "star_count"]),
                "forks": pick_first(row, ["forks", "forks_count"]),
            }
        )

    output = {
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "search_service": "github",
        "count": len(items),
        "translation_enabled": bool(args.translate),
        "translation_error": translation_error,
        "items": items,
    }
    print(json.dumps(output, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
