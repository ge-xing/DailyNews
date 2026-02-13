# AI Daily News Site

一个基于 Next.js 的日报网站，首页左侧支持双 Tab：

- `AI日报`：展示每日 Markdown 报告归档（优先 OSS，失败回退本地 `outputs/`）。
- `Github趋势`：调用 `apis_trending` 抓取趋势，并使用 Gemini 将英文简介翻译为中文。

## 功能概览

- AI 日报归档列表与详情页阅读
- 一键触发“生成今日日报”（后端执行 `bash skill_m2h.sh`）
- Github 趋势按 item 列表展示（英文 + 中文翻译）
- OSS 索引读取与本地回退

## 环境变量（推荐）

- `GEMINI_API_KEY`（或 `GOOGLE_API_KEY`）：Gemini Key（日报生成与趋势翻译）
- `SEARCH1_API_KEY`（或 `TRENDING_API_KEY`）：Search1API Key（Github 趋势抓取）
- `ALIYUN_OSS_ACCESS_KEY_ID` / `ALIYUN_OSS_ACCESS_KEY_SECRET`
- `ALIYUN_OSS_BUCKET_NAME` / `ALIYUN_OSS_ENDPOINT`
- 可选：`ALIYUN_OSS_PUBLIC_BASE_URL`、`ALIYUN_OSS_PREFIX`

兼容兜底（本地）：

- `api_key.text`：Gemini Key 文件
- `trending_api.txt`：Search1API Key 文件
- `env.py`：OSS 配置文件

## 本地运行

```bash
npm install
cp .env.example .env.local
npm run dev
```

打开：`http://localhost:3000`

## AI 日报生成

你可以用下面两种方式生成当日日报：

- 网站按钮：首页点击“生成今日日报”
- 命令行：

```bash
bash skill_m2h.sh
```

生成成功后会产出/更新：

- 本地 `outputs/` 日报文件
- OSS 对应 Markdown 与 `index.json`（若 OSS 环境变量或 `env.py` 可用）

## Github 趋势抓取与翻译

手动执行脚本：

```bash
python3 scripts/fetch_github_trending.py --max-results 20
```

常用参数：

- `--max-results`：趋势条数（默认 20）
- `--translate / --no-translate`：开启或关闭 Gemini 翻译（默认开启）
- `--api-key-path`：趋势 key 文件兜底路径（默认 `trending_api.txt`，环境变量优先）
- `--gemini-api-key-path`：Gemini key 文件兜底路径（默认 `api_key.text`，环境变量优先）

## 主要目录

- `app/`：Next.js 页面与 API Route
- `components/`：前端组件
- `lib/`：服务端数据逻辑（日报/趋势）
- `apis_trending/`：Search1API 趋势抓取模块
- `scripts/`：日报任务与趋势抓取脚本
- `outputs/`：本地日报输出目录

## 运行环境

- Node.js `>= 20`
- Python `>= 3.10`（建议）
- 已安装脚本依赖（如 `requests`、`google-genai` 等）

## 部署说明

可部署到 Vercel 或自托管环境，但要注意：

- 运行时触发脚本（例如“生成今日日报”）更适合本地或自托管服务器
- 无状态平台通常不适合长期持久化本地文件输出
- 若线上依赖 Google Fonts，构建环境需允许访问 Google 字体服务
- Vercel 上请在 Project Settings -> Environment Variables 配置上述 key，避免提交到仓库
