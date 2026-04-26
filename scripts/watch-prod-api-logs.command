#!/usr/bin/env bash

# Double-click this file in macOS Terminal to open the filtered production API log watcher.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "${SCRIPT_DIR}/watch-prod-api-logs.sh" "$@"
