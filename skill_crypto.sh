#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRYPTO_GIST_URL="https://gist.github.com/miguelmota/09757c4d605549f07540ff39fd80079c"

CMD=(
  python3 "$ROOT_DIR/scripts/run_youmind_skill.py"
  --prompt-file "$ROOT_DIR/skills/crypto_daily.prompt.md"
  --gist-url "$CRYPTO_GIST_URL"
  --report-name "币圈每日资讯"
  --material-group-name "币圈每日资讯素材"
  --oss-prefix "daily-news/crypto-reports"
)

if [[ $# -gt 0 && "${1}" != --* ]]; then
  CMD+=(--input "$1")
  shift
fi

CMD+=("$@")
exec "${CMD[@]}"
