import argparse
import json
import time
from pathlib import Path
from typing import Any, Dict, List

from core import AIConfig, GeminiAPI

DEFAULT_INPUT = "output_jsons/search1_trending_github.json"
DEFAULT_OUTPUT_DIR = "outputs_daily/trending"
DEFAULT_MODEL = "gemini-2.5-flash"


"""
Example:
python3 -m apis_trending.trending_daily_push \
    --input output_jsons/search1_trending_github.json \
    --output-dir outputs_daily/trending

"""


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
    try:
        dump = getattr(response, "model_dump_json", None)
        if callable(dump):
            return dump()
    except Exception:
        pass
    return str(response)


def _pick_first(item: Dict[str, Any], keys: List[str]) -> str:
    for key in keys:
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _collect_results(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, dict):
        results = payload.get("results")
        if isinstance(results, list):
            return [item for item in results if isinstance(item, dict)]
        items = payload.get("items")
        if isinstance(items, list):
            return [item for item in items if isinstance(item, dict)]
        data = payload.get("data")
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    return []


def _extract_search_service(payload: Any) -> str:
    if isinstance(payload, dict):
        for key in ("trendingParameters", "searchParameters"):
            params = payload.get(key)
            if isinstance(params, dict):
                service = params.get("search_service")
                if isinstance(service, str) and service.strip():
                    return service.strip().lower()
        service = payload.get("search_service")
        if isinstance(service, str) and service.strip():
            return service.strip().lower()
    return ""


def _build_output_filename(date_str: str, service: str) -> str:
    service_slug = (service or "trending").strip().lower().replace(" ", "_")
    return f"{service_slug}.txt" if service_slug else "trending.txt"


def render_trending_daily(
    items: List[Dict[str, Any]],
    header: str,
    include_summary: bool = True,
    include_detail: bool = True,
) -> str:
    lines: List[str] = [header]
    for idx, item in enumerate(items, start=1):
        title = _pick_first(item, ["title", "name", "headline"])
        summary = _pick_first(item, ["snippet", "summary", "description", "excerpt"])
        detail = _pick_first(item, ["content", "detail", "url", "link"])

        lines.append(f"{idx}. {title}".strip())
        if include_summary:
            lines.append(summary)
        if include_detail:
            lines.append(detail)
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def translate_github_briefs(api: GeminiAPI, model: str, text: str) -> str:
    prompt = (
        "请将以下文本中每个条目“标题行”的下一行翻译为简体中文。\n"
        "标题行格式示例：\"1. repo/name\"，必须保持英文不变。\n"
        "每个条目由三行组成：标题行、简介行、描述/链接行；仅翻译简介行。\n"
        "保留原有行数、空行和标点，不要添加任何说明。\n\n"
        f"内容：\n{text}\n"
    )
    response = api.generate_content([prompt], model=model)
    translated = extract_response_text(response).strip()
    if not translated.endswith("\n"):
        translated += "\n"
    return translated


def translate_hn_titles(api: GeminiAPI, model: str, text: str) -> str:
    prompt = (
        "请将以下文本中每个条目的标题行翻译为简体中文。\n"
        "标题行格式示例：\"1. Some Title\"，行首编号必须保留。\n"
        "仅翻译标题行，URL行保持不变，空行保持不变。\n"
        "专有名词、项目名、人名、机构名、产品名保持英文原样，不要翻译。\n"
        "不要添加任何说明。\n\n"
        f"内容：\n{text}\n"
    )
    response = api.generate_content([prompt], model=model)
    translated = extract_response_text(response).strip()
    if not translated.endswith("\n"):
        translated += "\n"
    return translated


def main() -> None:
    parser = argparse.ArgumentParser(description="Render trending results into daily push text.")
    parser.add_argument("--input", type=str, default=DEFAULT_INPUT, help="Input JSON file.")
    parser.add_argument("--output-dir", type=str, default=DEFAULT_OUTPUT_DIR, help="Output directory.")
    parser.add_argument("--date", type=str, default="", help="Date string for filename (YYYY-MM-DD).")
    parser.add_argument("--model", type=str, default=DEFAULT_MODEL, help="Gemini model name.")
    parser.add_argument("--api-key-path", type=str, default="api_key.text", help="Gemini API key file.")
    parser.add_argument("--vertex-path", type=str, default="vertex_1.json", help="Vertex credentials path.")
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        raise RuntimeError(f"Input not found: {input_path}")

    payload = json.loads(input_path.read_text(encoding="utf-8"))
    items = _collect_results(payload)
    if not items:
        raise RuntimeError("No results found in input JSON.")

    service = _extract_search_service(payload)
    header = "每日github趋势速览：" if service == "github" else "每日新闻速览："
    include_summary = service == "github"
    output_text = render_trending_daily(
        items,
        header=header,
        include_summary=include_summary,
        include_detail=True,
    )

    if service in {"github", "hackernews"}:
        config = AIConfig(api_key_path=args.api_key_path, vertex_path=args.vertex_path)
        if not config.has_api_key:
            raise RuntimeError("Missing Gemini API key. Set api_key.text or pass --api-key-path.")
        api = GeminiAPI(config)
        if service == "github":
            output_text = translate_github_briefs(api, args.model, output_text)
        else:
            output_text = translate_hn_titles(api, args.model, output_text)

    date_str = args.date.strip() or time.strftime("%Y-%m-%d")
    header = "每日github趋势速览" if service == "github" else "每日新闻速览"
    output_text = output_text.replace(header + "：", f"{header} {date_str}：", 1)

    output_dir = Path(args.output_dir) / date_str
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / _build_output_filename(date_str, service)
    output_path.write_text(output_text, encoding="utf-8")
    print(f"Saved: {output_path}")


if __name__ == "__main__":
    main()
