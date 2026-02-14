#!/usr/bin/env python3
"""Utilities for converting Markdown into WeChat-friendly outputs."""

from __future__ import annotations

import html
import re
from pathlib import Path

DEFAULT_REPORT_NAME = "Karpathy 精选 RSS 日报"
DEFAULT_STYLE_VARIANT = "default"
STYLE_VARIANTS = {"default", "minimal"}

_DEFAULT_STYLES = {
    "section": (
        "font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;"
        "font-size:16px;line-height:1.8;color:#1f2328;word-break:break-word;"
    ),
    "title": "font-size:30px;line-height:1.4;font-weight:700;margin:0 0 20px;color:#111827;",
    "h1": "font-size:26px;line-height:1.5;font-weight:700;margin:28px 0 16px;color:#111827;",
    "h2": (
        "font-size:21px;line-height:1.6;font-weight:700;margin:24px 0 12px;padding-left:10px;"
        "border-left:4px solid #2563eb;color:#111827;"
    ),
    "h3": "font-size:18px;line-height:1.7;font-weight:700;margin:20px 0 10px;color:#1f2937;",
    "p": "margin:0 0 16px;text-align:justify;",
    "blockquote": (
        "margin:0 0 16px;padding:10px 14px;border-left:4px solid #94a3b8;"
        "background:#f8fafc;color:#334155;"
    ),
    "ul": "margin:0 0 16px 0;padding-left:1.4em;",
    "ol": "margin:0 0 16px 0;padding-left:1.4em;",
    "li": "margin:0 0 8px;",
    "hr": "border:0;border-top:1px solid #d1d5db;margin:24px 0;",
    "code_block": (
        "margin:0 0 16px;padding:12px;background:#f3f4f6;border-radius:6px;"
        "font-family:Menlo,Monaco,Consolas,'Courier New',monospace;font-size:13px;"
        "line-height:1.6;white-space:pre-wrap;"
    ),
    "inline_code": (
        "padding:1px 4px;background:#f3f4f6;border-radius:4px;"
        "font-family:Menlo,Monaco,Consolas,'Courier New',monospace;font-size:0.92em;"
    ),
}

_MINIMAL_STYLES = {
    "section": (
        "font-family:'PingFang SC','Microsoft YaHei',sans-serif;"
        "font-size:16px;line-height:1.8;color:#222;word-break:break-word;"
    ),
    "title": "font-size:28px;line-height:1.4;font-weight:700;margin:0 0 16px;",
    "h1": "font-size:24px;line-height:1.5;font-weight:700;margin:24px 0 12px;",
    "h2": "font-size:20px;line-height:1.6;font-weight:700;margin:20px 0 10px;",
    "h3": "font-size:18px;line-height:1.7;font-weight:700;margin:16px 0 8px;",
    "p": "margin:0 0 14px;",
    "blockquote": "margin:0 0 14px;padding:8px 12px;border-left:3px solid #bbb;color:#444;",
    "ul": "margin:0 0 14px 0;padding-left:1.3em;",
    "ol": "margin:0 0 14px 0;padding-left:1.3em;",
    "li": "margin:0 0 6px;",
    "hr": "border:0;border-top:1px solid #ccc;margin:20px 0;",
    "code_block": (
        "margin:0 0 14px;padding:10px;background:#f5f5f5;"
        "font-family:Menlo,Monaco,Consolas,'Courier New',monospace;"
        "font-size:13px;line-height:1.6;white-space:pre-wrap;"
    ),
    "inline_code": (
        "padding:1px 4px;background:#f5f5f5;"
        "font-family:Menlo,Monaco,Consolas,'Courier New',monospace;font-size:0.92em;"
    ),
}


def _get_styles(style_variant: str) -> dict[str, str]:
    if style_variant not in STYLE_VARIANTS:
        raise ValueError(f"Unsupported style variant: {style_variant}")
    return _DEFAULT_STYLES if style_variant == "default" else _MINIMAL_STYLES


def _normalize_newlines(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _normalize_links(text: str) -> str:
    text = re.sub(r"\[\[([^\]]+)\]\]\((https?://[^)\s]+)\)", r"\1（\2）", text)
    text = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", r"\1（\2）", text)
    return text


def _strip_md_inline(text: str) -> str:
    out = _normalize_links(text)
    out = re.sub(r"`([^`]+)`", r"\1", out)
    out = re.sub(r"\*\*([^*]+)\*\*", r"\1", out)
    out = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"\1", out)
    return out


def _inline_to_html(text: str, inline_code_style: str) -> str:
    out = _normalize_links(text)
    out = html.escape(out, quote=False)
    out = re.sub(
        r"`([^`]+)`",
        lambda match: f'<code style="{inline_code_style}">{match.group(1)}</code>',
        out,
    )
    out = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", out)
    out = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"<em>\1</em>", out)
    return out


def extract_first_h1(markdown_text: str) -> str | None:
    text = _normalize_newlines(markdown_text)
    for raw in text.split("\n"):
        stripped = raw.strip()
        if not stripped:
            continue
        match = re.match(r"^#\s+(.+)$", stripped)
        if match:
            return _strip_md_inline(match.group(1)).strip()
        break
    return None


def markdown_to_wechat_text(markdown_text: str) -> str:
    text = _normalize_newlines(markdown_text).strip()
    text = _strip_md_inline(text)

    out_lines: list[str] = []
    in_code = False
    for raw in text.split("\n"):
        line = raw.rstrip()
        stripped = line.strip()

        if stripped.startswith("```"):
            in_code = not in_code
            if not in_code:
                out_lines.append("")
            continue

        if not stripped:
            out_lines.append("")
            continue

        if stripped in {"---", "***", "___"}:
            out_lines.append("──────────")
            continue

        if in_code:
            out_lines.append(stripped)
            continue

        if stripped.startswith(">"):
            out_lines.append(stripped.lstrip(">").strip())
            continue

        if stripped.startswith("#"):
            out_lines.append(f"【{stripped.lstrip('#').strip()}】")
            continue

        unordered = re.match(r"^[-*+]\s+(.+)$", stripped)
        if unordered:
            out_lines.append(f"• {unordered.group(1).strip()}")
            continue

        ordered = re.match(r"^\d+\.\s+(.+)$", stripped)
        if ordered:
            out_lines.append(f"• {ordered.group(1).strip()}")
            continue

        out_lines.append(stripped)

    wechat_text = "\n".join(out_lines)
    return re.sub(r"\n{3,}", "\n\n", wechat_text).strip()


def markdown_to_wechat_html(markdown_text: str, title: str | None = None, style_variant: str = DEFAULT_STYLE_VARIANT) -> str:
    styles = _get_styles(style_variant)
    lines = _normalize_newlines(markdown_text).split("\n")

    parts: list[str] = [f'<section style="{styles["section"]}">']
    final_title = (title or "").strip() or extract_first_h1(markdown_text)
    if final_title:
        parts.append(f'<h1 style="{styles["title"]}">{html.escape(final_title)}</h1>')
        for idx, raw in enumerate(lines):
            stripped = raw.strip()
            if not stripped:
                continue
            match = re.match(r"^#\s+(.+)$", stripped)
            if match and _strip_md_inline(match.group(1)).strip() == final_title:
                lines = lines[idx + 1 :]
            break

    paragraph_buffer: list[str] = []
    quote_buffer: list[str] = []
    list_type: str | None = None
    list_items: list[str] = []
    in_code = False
    code_buffer: list[str] = []

    def flush_paragraph() -> None:
        if not paragraph_buffer:
            return
        content = "<br/>".join(_inline_to_html(line, styles["inline_code"]) for line in paragraph_buffer)
        parts.append(f'<p style="{styles["p"]}">{content}</p>')
        paragraph_buffer.clear()

    def flush_quote() -> None:
        if not quote_buffer:
            return
        content = "<br/>".join(_inline_to_html(line, styles["inline_code"]) for line in quote_buffer)
        parts.append(f'<blockquote style="{styles["blockquote"]}">{content}</blockquote>')
        quote_buffer.clear()

    def flush_list() -> None:
        nonlocal list_type
        if not list_type:
            return
        open_tag = "ul" if list_type == "ul" else "ol"
        list_style = styles["ul"] if list_type == "ul" else styles["ol"]
        items_html = "".join([f'<li style="{styles["li"]}">{item}</li>' for item in list_items])
        parts.append(f"<{open_tag} style=\"{list_style}\">{items_html}</{open_tag}>")
        list_type = None
        list_items.clear()

    def flush_code() -> None:
        if not code_buffer:
            return
        code_text = html.escape("\n".join(code_buffer), quote=False)
        parts.append(f'<pre style="{styles["code_block"]}"><code>{code_text}</code></pre>')
        code_buffer.clear()

    for raw in lines:
        stripped = raw.strip()

        if in_code:
            if stripped.startswith("```"):
                in_code = False
                flush_code()
            else:
                code_buffer.append(raw.rstrip())
            continue

        if stripped.startswith("```"):
            flush_paragraph()
            flush_quote()
            flush_list()
            in_code = True
            continue

        if not stripped:
            flush_paragraph()
            flush_quote()
            flush_list()
            continue

        if re.match(r"^(-{3,}|\*{3,}|_{3,})$", stripped):
            flush_paragraph()
            flush_quote()
            flush_list()
            parts.append(f'<hr style="{styles["hr"]}"/>')
            continue

        heading = re.match(r"^(#{1,6})\s+(.+)$", stripped)
        if heading:
            flush_paragraph()
            flush_quote()
            flush_list()
            level = min(len(heading.group(1)), 3)
            heading_text = _inline_to_html(heading.group(2).strip(), styles["inline_code"])
            tag = f"h{level}"
            style_key = "h1" if level == 1 else "h2" if level == 2 else "h3"
            parts.append(f"<{tag} style=\"{styles[style_key]}\">{heading_text}</{tag}>")
            continue

        quote = re.match(r"^>\s?(.*)$", stripped)
        if quote:
            flush_paragraph()
            flush_list()
            quote_buffer.append(quote.group(1).strip())
            continue

        unordered = re.match(r"^[-*+]\s+(.+)$", stripped)
        ordered = re.match(r"^\d+\.\s+(.+)$", stripped)
        if unordered or ordered:
            flush_paragraph()
            flush_quote()
            next_type = "ul" if unordered else "ol"
            content = unordered.group(1).strip() if unordered else ordered.group(1).strip()
            if list_type and list_type != next_type:
                flush_list()
            list_type = next_type
            list_items.append(_inline_to_html(content, styles["inline_code"]))
            continue

        if list_type:
            flush_list()
        if quote_buffer:
            flush_quote()
        paragraph_buffer.append(stripped)

    if in_code:
        flush_code()
    flush_paragraph()
    flush_quote()
    flush_list()
    parts.append("</section>")

    return "\n".join(parts)


def build_wechat_output_path(
    default_dir: Path,
    date_label: str,
    report_name: str,
    explicit_path: Path | None,
    md_path: Path | None,
    extension: str,
) -> Path:
    if explicit_path is not None:
        return explicit_path
    if md_path is not None:
        return md_path.with_name(f"{md_path.stem} - 公众号格式{extension}")
    clean_report_name = (report_name or "").strip() or DEFAULT_REPORT_NAME
    return default_dir / f"{date_label} - {clean_report_name} - 公众号格式{extension}"


def save_wechat_output(path: Path, content: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.rstrip() + "\n", encoding="utf-8")
    return path
