#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP_ROOT="${APP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
OUTPUT="${OUTPUT:-$APP_ROOT/SHA256SUMS}"

for tool in find mktemp realpath sha256sum sort xargs; do
  command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done
APP_ROOT_REAL="$(realpath -- "$APP_ROOT")"
[[ -d "$APP_ROOT_REAL/backend" ]]
[[ -d "$APP_ROOT_REAL/frontend/dist" ]]
[[ -d "$APP_ROOT_REAL/deploy" ]]

temporary="$(mktemp)"
trap 'rm -f -- "$temporary"' EXIT
(
  cd "$APP_ROOT_REAL"
  {
    find backend -type f \
      ! -path 'backend/.env' \
      ! -path 'backend/.venv/*' \
      ! -path 'backend/.venv-current/*' \
      ! -path 'backend/static/*' \
      ! -path '*/__pycache__/*' \
      ! -path '*/.pytest_cache/*' \
      ! -name '*.pyc' ! -name '*.pyo' \
      ! -name '*.db' ! -name '*.sqlite' \
      ! -name '*.pem' ! -name '*.key' -print0
    find deploy -type f -print0
    find frontend/dist -type f -print0
  } | LC_ALL=C sort -z | xargs -0 sha256sum | LC_ALL=C sort -k2
) >"$temporary"
[[ -s "$temporary" ]]
install -m 600 "$temporary" "$OUTPUT"
(cd "$APP_ROOT_REAL" && sha256sum -c "$OUTPUT")
echo "PASS: immutable release manifest written to $OUTPUT"
