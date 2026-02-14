# AI Daily News Site

一个基于 Next.js 的日报网站，首页左侧支持多 Tab：

- `AI日报`：展示每日 Markdown 报告归档（优先 OSS，失败回退本地 `outputs/`）。
- `币圈日报`：展示币圈每日资讯归档（优先 OSS，失败回退本地 `outputs/`）。
- `财经日报`：展示每日财经资讯归档（优先 OSS，失败回退本地 `outputs/`）。
- `Github趋势`：服务端直接调用 Search1API 抓取趋势，并使用 Gemini 将英文简介翻译为中文。

## 功能概览

- AI 日报归档列表与详情页阅读
- 币圈日报与财经日报归档列表与详情页阅读
- Github 趋势按 item 列表展示（英文 + 中文翻译）
- OSS 索引读取与本地回退

## 环境变量（推荐）

- `GEMINI_API_KEY`（或 `GOOGLE_API_KEY`）：Gemini Key（日报生成与趋势翻译）
- `SEARCH1_API_KEY`（或 `TRENDING_API_KEY`）：Search1API Key（Github 趋势抓取）
- `ALIYUN_OSS_ACCESS_KEY_ID` / `ALIYUN_OSS_ACCESS_KEY_SECRET`
- `ALIYUN_OSS_BUCKET_NAME` / `ALIYUN_OSS_ENDPOINT`
- 可选：`ALIYUN_OSS_PUBLIC_BASE_URL`、`ALIYUN_OSS_PREFIX`
- 可选（币圈日报专用）：`ALIYUN_OSS_CRYPTO_PREFIX`（默认 `daily-news/crypto-reports`）
- 可选（币圈日报专用）：`ALIYUN_OSS_CRYPTO_INDEX_URL`（显式指定 index.json 地址）
- 可选（财经日报专用）：`ALIYUN_OSS_FINANCE_PREFIX`（默认 `daily-news/finance-reports`）
- 可选（财经日报专用）：`ALIYUN_OSS_FINANCE_INDEX_URL`（显式指定 index.json 地址）

兼容兜底（本地）：

- `api_key.text`：Gemini Key 文件
- `trending_api.txt`：Search1API Key 文件
- `env.py`：OSS 配置文件（可选增加 `crypto_prefix`、`finance_prefix`）

## 本地运行

```bash
npm install
cp .env.example .env.local
npm run dev
```

打开：`http://localhost:3000`

## AI 日报生成

- 在本地运行你的生成流程。
- 上传日报 Markdown 到 OSS，并更新 `index.json`。
- 网站会自动从 OSS 索引读取并展示。

```bash
bash skill_m2h.sh
```

默认会额外生成两份公众号版本文件：

- `... - 公众号格式.md`（纯文本增强版）
- `... - 公众号格式.html`（可直接粘贴公众号编辑器的内联样式版）

如果你有任意现成 Markdown，可直接转换为公众号 HTML：

```bash
python3 scripts/convert_md_to_wechat.py --input outputs/你的文件.md
```

## 币圈日报生成

默认使用 `miguelmota` 的币圈 RSS gist：

```bash
bash skill_crypto.sh
```

可选参数示例：

```bash
# 调整抓取窗口、并发与 feed 数量
bash skill_crypto.sh --window-hours 24 --max-feeds 160 --max-workers 12

# 附加写作要求
bash skill_crypto.sh "文末数据源必须是 gist 链接，保持简短。"

# 只抓取不生成（检查数据量）
bash skill_crypto.sh --dry-run
```

## 财经日报生成

默认按 6 个财经分类分别生成日报（一次运行会生成多份 md）：

```bash
bash skill_finance.sh
```

财经源目录：

- 全量可用索引：`skills/finance_rss_list/feedspot_financial_rss_urls.txt`
- 分类目录：`skills/finance_rss_list/categories/`
- 分类索引：`skills/finance_rss_list/category_index.json`

默认策略：

- 6 个主题分类：`macro_policy`、`markets_assets`、`companies_industry`、`global_general_news`、`tech_business`、`crypto_digital_assets`
- 每个分类单独运行一次日报生成
- 每类最多取 `12` 个 feed（可通过 `--per-category-cap` 调整）

可选参数示例：

```bash
# 调整抓取窗口、并发与每类配额
bash skill_finance.sh --window-hours 24 --max-workers 12 --per-category-cap 16

# 附加写作要求
bash skill_finance.sh "文末保留风险提示，避免投资建议语气。"

# 只抓取不生成（检查数据量）
bash skill_finance.sh --dry-run
```

## Github 趋势抓取与翻译

- 由服务端实时抓取（无需 Python）。
- 默认读取 `SEARCH1_API_KEY` 抓取趋势。
- 若配置 `GEMINI_API_KEY`，会自动补全中文翻译。

## 主要目录

- `app/`：Next.js 页面与 API Route
- `components/`：前端组件
- `lib/`：服务端数据逻辑（日报/趋势/OSS）
- `apis_trending/`：Search1API 趋势抓取模块
- `scripts/`：日报任务与趋势抓取脚本
- `outputs/`：本地日报输出目录

## 运行环境

- Node.js `>= 20`
- Python（仅本地脚本可选，不是 Web 运行必需）

## 部署说明

可部署到 Vercel 或自托管环境，但要注意：

- 线上建议配置 OSS，用于持久化日报和索引（无状态平台本地文件不持久）
- 若线上依赖 Google Fonts，构建环境需允许访问 Google 字体服务
- Vercel 上请在 Project Settings -> Environment Variables 配置上述 key，避免提交到仓库
