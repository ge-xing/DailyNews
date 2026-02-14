#!/usr/bin/env python3
"""Convert a markdown file to a WeChat-friendly HTML snippet."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.wechat_formatter import (  # noqa: E402
    DEFAULT_STYLE_VARIANT,
    STYLE_VARIANTS,
    extract_first_h1,
    markdown_to_wechat_html,
    save_wechat_output,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert markdown to WeChat-friendly HTML.")
    parser.add_argument("--input", type=Path, required=True, help="Input markdown file path.")
    parser.add_argument("--output", type=Path, help="Output html file path.")
    parser.add_argument("--title", help="Override article title.")
    parser.add_argument(
        "--style",
        default=DEFAULT_STYLE_VARIANT,
        choices=sorted(STYLE_VARIANTS),
        help="Style variant for generated HTML.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if not args.input.exists():
        print(f"Error: input file not found: {args.input}", file=sys.stderr)
        return 1

    markdown = args.input.read_text(encoding="utf-8")
    title = (args.title or "").strip() or extract_first_h1(markdown) or args.input.stem

    html = markdown_to_wechat_html(markdown, title=title, style_variant=args.style)

    output = args.output or args.input.with_name(f"{args.input.stem} - 公众号格式.html")
    save_wechat_output(output, html)
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
