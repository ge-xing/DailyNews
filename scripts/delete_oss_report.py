#!/usr/bin/env python3
"""Delete one report markdown from OSS and update index.json."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

try:
    import oss2
except Exception as exc:  # noqa: BLE001
    raise SystemExit(f"oss2 import failed: {exc}")

from core.api import build_public_oss_url, load_oss_config, upload_json_to_oss


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Delete a report markdown object from OSS.")
    parser.add_argument("--file-name", required=True, help="Report file name, e.g. 2026-02-13 - xxx.md")
    parser.add_argument("--prefix", help="OSS prefix override, e.g. daily-news/reports")
    return parser.parse_args()


def _normalize_endpoint(endpoint: str) -> str:
    return (endpoint or "").replace("https://", "").replace("http://", "").strip().rstrip("/")


def _normalize_prefix(prefix: str) -> str:
    return (prefix or "").strip().strip("/")


def _load_index(bucket: oss2.Bucket, index_object_name: str) -> list[dict[str, Any]]:
    try:
        data = bucket.get_object(index_object_name).read()
    except Exception:
        return []

    try:
        payload = json.loads(data.decode("utf-8"))
    except Exception:
        return []
    items = payload.get("items", []) if isinstance(payload, dict) else []
    if not isinstance(items, list):
        return []
    return [x for x in items if isinstance(x, dict)]


def main() -> int:
    args = parse_args()
    cfg = load_oss_config(REPO_ROOT / "env.py")

    access_key_id = cfg.get("access_key_id", "")
    access_key_secret = cfg.get("access_key_secret", "")
    bucket_name = cfg.get("bucket_name", "")
    endpoint = _normalize_endpoint(cfg.get("endpoint", ""))
    prefix = _normalize_prefix(args.prefix or cfg.get("prefix", "") or "daily-news/reports")
    public_base_url = (cfg.get("public_base_url", "") or "").strip() or None
    file_name = Path(args.file_name).name

    if not access_key_id or not access_key_secret or not bucket_name or not endpoint:
        print(json.dumps({"ok": False, "message": "OSS config incomplete in env.py"}, ensure_ascii=False))
        return 1

    auth = oss2.Auth(access_key_id, access_key_secret)
    bucket = oss2.Bucket(auth, endpoint, bucket_name)

    index_object_name = f"{prefix}/index.json" if prefix else "index.json"
    items = _load_index(bucket, index_object_name)

    matched_item: dict[str, Any] | None = None
    remaining: list[dict[str, Any]] = []
    for item in items:
        if str(item.get("fileName", "")).strip() == file_name and matched_item is None:
            matched_item = item
        else:
            remaining.append(item)

    object_name = ""
    if matched_item:
        object_name = str(matched_item.get("objectName", "")).strip()
    if not object_name:
        object_name = f"{prefix}/{file_name}" if prefix else file_name

    try:
        bucket.delete_object(object_name)
    except Exception as exc:  # noqa: BLE001
        print(
            json.dumps(
                {
                    "ok": False,
                    "message": f"delete object failed: {exc}",
                    "objectName": object_name,
                },
                ensure_ascii=False,
            )
        )
        return 1

    index_payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(remaining),
        "prefix": prefix,
        "items": remaining,
    }

    try:
        index_url = upload_json_to_oss(
            payload=index_payload,
            access_key_id=access_key_id,
            access_key_secret=access_key_secret,
            bucket_name=bucket_name,
            endpoint=endpoint,
            oss_object_name=index_object_name,
            public_base_url=public_base_url,
        )
    except Exception as exc:  # noqa: BLE001
        print(
            json.dumps(
                {
                    "ok": False,
                    "message": f"update index failed: {exc}",
                    "objectName": object_name,
                },
                ensure_ascii=False,
            )
        )
        return 1

    deleted_url = build_public_oss_url(
        bucket_name=bucket_name,
        endpoint=endpoint,
        oss_object_name=object_name,
        public_base_url=public_base_url,
    )

    print(
        json.dumps(
            {
                "ok": True,
                "fileName": file_name,
                "objectName": object_name,
                "deletedUrl": deleted_url,
                "indexUrl": index_url,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
