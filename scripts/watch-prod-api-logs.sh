#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SSH_KEY="${REPO_ROOT}/neovistassh.pem"
SSH_HOST="ubuntu@43.154.202.242"
SSH_OPTIONS=(
  -i "${SSH_KEY}"
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=3
  -o StrictHostKeyChecking=accept-new
)
JOURNAL_BASE_CMD="sudo journalctl -u neovista-api -f -n 150 -o short-iso"

usage() {
  cat <<'EOF'
Usage: ./scripts/watch-prod-api-logs.sh [--since "10 min ago"]

Streams production neovista-api logs with filtering and ANSI highlighting.
EOF
}

STOP_REQUESTED=0
cleanup() {
  STOP_REQUESTED=1
}
trap cleanup INT TERM

SINCE_VALUE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --since)
      shift
      if [[ $# -eq 0 ]]; then
        echo "Missing value for --since" >&2
        usage >&2
        exit 1
      fi
      SINCE_VALUE="$1"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

if [[ ! -f "${SSH_KEY}" ]]; then
  echo "SSH key not found: ${SSH_KEY}" >&2
  exit 1
fi

run_remote_journal() {
  local since_value="$1"

  ssh "${SSH_OPTIONS[@]}" "${SSH_HOST}" "SINCE_VALUE=$(printf '%q' "${since_value}") bash -s" <<'EOF'
set -euo pipefail

SINCE_VALUE="${SINCE_VALUE:-}"
journalctl_args=(sudo journalctl -u neovista-api -f -n 150 -o short-iso)
if [[ -n "${SINCE_VALUE}" ]]; then
  journalctl_args+=("--since" "${SINCE_VALUE}")
fi
exec "${journalctl_args[@]}"
EOF
}

echo "Watching filtered neovista-api logs from ${SSH_HOST}"
if [[ -n "${SINCE_VALUE}" ]]; then
  echo "Including historical logs since: ${SINCE_VALUE}"
fi
echo "Keeping API requests, Traceback, ERROR, Exception, [Flash], [Pro], [Pro Vision], and [Pro Vision Prompt]."
echo "Press Ctrl+C to stop."

while true; do
  if run_remote_journal "${SINCE_VALUE}" | python3 -u -c '
import re
import sys

KEEP = re.compile(r"(POST /api/|GET /api/|HTTP/1\.1|Traceback|ERROR|Exception|\[Flash\]|\[Pro\]|\[Pro Vision\]|\[Pro Vision Prompt\])")
ACCENT = "\033[1;36m"
WARN = "\033[1;33m"
ERR = "\033[1;31m"
RESET = "\033[0m"

for raw_line in sys.stdin:
    if not KEEP.search(raw_line):
        continue

    line = raw_line.rstrip("\n")
    if "Traceback" in line or "ERROR" in line or "Exception" in line:
        color = ERR
    elif "[Flash]" in line or "[Pro]" in line or "[Pro Vision]" in line or "[Pro Vision Prompt]" in line:
        color = WARN
    else:
        color = ACCENT

    print(f"{color}{line}{RESET}", flush=True)
'; then
    exit 0
  fi
  if [[ "${STOP_REQUESTED}" -eq 1 ]]; then
    exit 130
  fi

  echo
  echo "Connection dropped at $(date '+%Y-%m-%d %H:%M:%S'). Reconnecting in 3s..." >&2
  sleep 3
done
