#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CMD=(python3 "$ROOT_DIR/scripts/run_youmind_skill.py")

if [[ $# -gt 0 && "${1}" != --* ]]; then
  CMD+=(--input "$1")
  shift
fi

CMD+=("$@")
exec "${CMD[@]}"
