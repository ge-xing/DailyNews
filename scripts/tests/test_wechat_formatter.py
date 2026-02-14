from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.wechat_formatter import (
    build_wechat_output_path,
    extract_first_h1,
    markdown_to_wechat_html,
    markdown_to_wechat_text,
    save_wechat_output,
)


class WechatFormatterTests(unittest.TestCase):
    def test_extract_first_h1(self) -> None:
        md = "# 标题\n\n正文"
        self.assertEqual(extract_first_h1(md), "标题")

    def test_markdown_to_wechat_text_basics(self) -> None:
        md = "# 标题\n\n- 条目\n1. 顺序\n\n[链接](https://example.com)"
        out = markdown_to_wechat_text(md)
        self.assertIn("【标题】", out)
        self.assertIn("• 条目", out)
        self.assertIn("• 顺序", out)
        self.assertIn("链接（https://example.com）", out)

    def test_markdown_to_wechat_html_basics(self) -> None:
        md = "# 标题\n\n段落含 `code` 和 [链接](https://example.com)。\n\n> 引用"
        out = markdown_to_wechat_html(md, title="文章标题", style_variant="default")
        self.assertIn("<section", out)
        self.assertIn("文章标题", out)
        self.assertIn("<code", out)
        self.assertIn("链接（https://example.com）", out)
        self.assertIn("<blockquote", out)

    def test_markdown_to_wechat_html_skip_duplicate_leading_h1(self) -> None:
        md = "# 标题\n\n正文"
        out = markdown_to_wechat_html(md, title="标题", style_variant="default")
        self.assertEqual(out.count("<h1"), 1)

    def test_build_wechat_output_path(self) -> None:
        default_dir = Path("outputs")
        md_path = Path("outputs/demo.md")
        out = build_wechat_output_path(default_dir, "2026-02-14", "日报", None, md_path, ".html")
        self.assertEqual(out.as_posix(), "outputs/demo - 公众号格式.html")

    def test_save_wechat_output(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "a" / "wechat.html"
            save_wechat_output(path, "<section>ok</section>")
            self.assertTrue(path.exists())
            self.assertIn("<section>ok</section>", path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
