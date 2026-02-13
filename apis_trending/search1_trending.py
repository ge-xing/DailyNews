import argparse
import json
import os
import time
from pathlib import Path
from typing import Any, Dict, Optional

import requests

DEFAULT_API_BASE = "https://api.302.ai"
DEFAULT_API_KEY_PATH = "trending_api.txt"
DEFAULT_API_KEY_ENV_VARS = ("SEARCH1_API_KEY", "TRENDING_API_KEY")
DEFAULT_SEARCH_SERVICE = "github"
DEFAULT_MAX_RESULTS = 10
DEFAULT_TIMEOUT = 30


"""
Example:
python3 -m apis_trending.search1_trending --search-service github --max-results 10

"""


def _load_api_key(path: str) -> str:
    for env_name in DEFAULT_API_KEY_ENV_VARS:
        value = os.getenv(env_name, "").strip()
        if value:
            return value

    key_path = Path(path)
    if not key_path.exists():
        return ""
    try:
        return key_path.read_text(encoding="utf-8").strip()
    except Exception:
        return ""


def _build_authorization(api_key: str) -> str:
    if not api_key:
        return ""
    lower_key = api_key.lower()
    if lower_key.startswith("bearer "):
        return api_key
    return f"Bearer {api_key}"


def save_json_named(name: str, payload: Any, output_dir: str = "output_jsons") -> Path:
    directory = Path(output_dir)
    directory.mkdir(parents=True, exist_ok=True)
    safe_name = (name or "search1_trending").strip().replace(" ", "_")
    ts = time.strftime("%Y%m%d_%H%M%S")
    output_path = directory / f"{safe_name}_{ts}.json"
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return output_path


def fetch_trending(
    search_service: str,
    max_results: int = DEFAULT_MAX_RESULTS,
    api_key_path: str = DEFAULT_API_KEY_PATH,
    base_url: str = DEFAULT_API_BASE,
    timeout: int = DEFAULT_TIMEOUT,
) -> Dict[str, Any]:
    api_key = _load_api_key(api_key_path)
    if not api_key:
        raise ValueError(
            f"Missing API key. Set {DEFAULT_API_KEY_ENV_VARS[0]}/{DEFAULT_API_KEY_ENV_VARS[1]} "
            f"or pass --api-key-path."
        )

    url = base_url.rstrip("/") + "/search1api/trending"
    headers = {
        "Authorization": _build_authorization(api_key),
        "Content-Type": "application/json",
    }
    payload: Dict[str, Any] = {"search_service": search_service}
    if max_results is not None:
        payload["max_results"] = int(max_results)

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=timeout)
    except Exception as exc:
        raise RuntimeError(f"Request failed: {exc}") from exc

    if not response.ok:
        detail = response.text.strip()
        status = response.status_code
        raise RuntimeError(f"Request failed with status {status}: {detail}")

    try:
        data = response.json()
    except Exception as exc:
        raise RuntimeError(f"Failed to parse JSON response: {exc}") from exc

    if isinstance(data, dict):
        return data
    return {"data": data}


def _build_default_output_name(search_service: str) -> str:
    service = (search_service or "trending").strip().lower().replace(" ", "_")
    return f"search1_trending_{service}" if service else "search1_trending"


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch Search1API trending results.")
    parser.add_argument(
        "--search-service",
        type=str,
        default=DEFAULT_SEARCH_SERVICE,
        help="Available options: github, hackernews.",
    )
    parser.add_argument("--max-results", type=int, default=DEFAULT_MAX_RESULTS, help="Max results (default 10).")
    parser.add_argument(
        "--api-key-path",
        type=str,
        default=DEFAULT_API_KEY_PATH,
        help=(
            "API key file path fallback (default trending_api.txt). "
            "Env first: SEARCH1_API_KEY / TRENDING_API_KEY."
        ),
    )
    parser.add_argument("--base-url", type=str, default=DEFAULT_API_BASE, help="API base URL.")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help="Request timeout seconds.")
    parser.add_argument(
        "--output-name",
        type=str,
        default="",
        help="Output JSON name (saved to output_jsons). Default uses service name.",
    )
    args = parser.parse_args()

    output_name = args.output_name.strip() if args.output_name else _build_default_output_name(args.search_service)

    payload = fetch_trending(
        search_service=args.search_service,
        max_results=args.max_results,
        api_key_path=args.api_key_path,
        base_url=args.base_url,
        timeout=args.timeout,
    )
    output_path = save_json_named(output_name, payload)
    print(json.dumps({"output": str(output_path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
