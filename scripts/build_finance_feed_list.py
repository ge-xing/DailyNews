#!/usr/bin/env python3
"""Build runtime finance feed list from categorized files with per-category cap."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

CATEGORY_ORDER = [
    "macro_policy",
    "markets_assets",
    "companies_industry",
    "global_general_news",
    "tech_business",
    "crypto_digital_assets",
]


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description="Build finance feed list using category quota.")
    parser.add_argument(
        "--categories-dir",
        type=Path,
        default=root / "skills" / "finance_rss_list" / "categories",
        help="Directory containing category txt files.",
    )
    parser.add_argument(
        "--per-category-cap",
        type=int,
        default=12,
        help="Max feed URLs to keep from each category.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("/tmp/finance_feeds_selected.txt"),
        help="Output feed list file path.",
    )
    return parser.parse_args()


def read_urls(path: Path) -> list[str]:
    if not path.exists():
        raise FileNotFoundError(f"Category file not found: {path}")
    urls: list[str] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        urls.append(line)
    return urls


def main() -> int:
    args = parse_args()
    if args.per_category_cap <= 0:
        print("Error: --per-category-cap must be > 0", file=sys.stderr)
        return 1

    selected: list[str] = []
    seen: set[str] = set()

    for category in CATEGORY_ORDER:
        file_path = args.categories_dir / f"{category}.txt"
        urls = read_urls(file_path)
        picked = 0
        for url in urls:
            if url in seen:
                continue
            seen.add(url)
            selected.append(url)
            picked += 1
            if picked >= args.per_category_cap:
                break
        print(f"[Category] {category}: picked={picked} source_total={len(urls)}", file=sys.stderr)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(selected) + ("\n" if selected else ""), encoding="utf-8")
    print(f"[Feed List] {args.output} total={len(selected)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
