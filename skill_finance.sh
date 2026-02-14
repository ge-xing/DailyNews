#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FINANCE_CATEGORIES_DIR="$ROOT_DIR/skills/finance_rss_list/categories"
PER_CATEGORY_CAP=12
FORWARDED_ARGS=()

CATEGORY_ORDER=(
  macro_policy
  markets_assets
  companies_industry
  global_general_news
  tech_business
  crypto_digital_assets
)

category_label() {
  case "$1" in
    macro_policy) echo "宏观政策" ;;
    markets_assets) echo "市场资产" ;;
    companies_industry) echo "公司产业" ;;
    global_general_news) echo "全球要闻" ;;
    tech_business) echo "科技商业" ;;
    crypto_digital_assets) echo "加密资产" ;;
    *) echo "$1" ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --per-category-cap)
      if [[ $# -lt 2 ]]; then
        echo "Error: --per-category-cap requires a value" >&2
        exit 1
      fi
      PER_CATEGORY_CAP="$2"
      shift 2
      ;;
    --per-category-cap=*)
      PER_CATEGORY_CAP="${1#*=}"
      shift
      ;;
    *)
      FORWARDED_ARGS+=("$1")
      shift
      ;;
  esac
done

if ! [[ "$PER_CATEGORY_CAP" =~ ^[0-9]+$ ]] || [[ "$PER_CATEGORY_CAP" -le 0 ]]; then
  echo "Error: --per-category-cap must be a positive integer" >&2
  exit 1
fi

USER_INPUT=""
EXTRA_ARGS=()
if [[ ${#FORWARDED_ARGS[@]} -gt 0 ]]; then
  if [[ "${FORWARDED_ARGS[0]}" != --* ]]; then
    USER_INPUT="${FORWARDED_ARGS[0]}"
    EXTRA_ARGS=("${FORWARDED_ARGS[@]:1}")
  else
    EXTRA_ARGS=("${FORWARDED_ARGS[@]}")
  fi
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/finance_categories_XXXXXX")"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

FAILED_CATEGORIES=()

for category in "${CATEGORY_ORDER[@]}"; do
  category_file="$FINANCE_CATEGORIES_DIR/${category}.txt"
  if [[ ! -f "$category_file" ]]; then
    echo "[Finance] skip missing category file: $category_file" >&2
    continue
  fi

  selected_file="$TMP_DIR/${category}.txt"
  awk 'NF && $1 !~ /^#/ {print}' "$category_file" | head -n "$PER_CATEGORY_CAP" > "$selected_file"
  selected_count="$(wc -l < "$selected_file" | tr -d ' ')"
  if [[ "$selected_count" -eq 0 ]]; then
    echo "[Finance] skip empty category: $category" >&2
    continue
  fi

  label="$(category_label "$category")"
  echo "[Finance] category=${category} label=${label} feeds=${selected_count}" >&2

  CMD=(
    python3 "$ROOT_DIR/scripts/run_youmind_skill.py"
    --prompt-file "$ROOT_DIR/skills/finance_daily.prompt.md"
    --feed-list-file "$selected_file"
    --gist-url "skills/finance_rss_list/categories/${category}.txt"
    --report-name "每日财经资讯 - ${label}"
    --material-group-name "每日财经资讯素材 - ${label}"
    --oss-prefix "daily-news/finance-reports/${category}"
  )

  if [[ -n "$USER_INPUT" ]]; then
    CMD+=(--input "$USER_INPUT")
  fi

  if [[ ${#EXTRA_ARGS[@]} -gt 0 ]]; then
    CMD+=("${EXTRA_ARGS[@]}")
  fi

  if ! "${CMD[@]}"; then
    echo "[Finance] category failed: ${category}" >&2
    FAILED_CATEGORIES+=("$category")
  fi
done

if [[ ${#FAILED_CATEGORIES[@]} -gt 0 ]]; then
  echo "[Finance] failed categories: ${FAILED_CATEGORIES[*]}" >&2
  exit 1
fi

echo "[Finance] all categories completed" >&2
