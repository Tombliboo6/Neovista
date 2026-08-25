#!/usr/bin/env bash
set -Eeuo pipefail

DB_PATH="${DATABASE_PATH:-/var/lib/neovista/neovista.db}"
ENV_FILE="${NEOVISTA_ENV_FILE:-/var/www/neovista/backend/.env}"
VENV_LINK="${NEOVISTA_VENV_LINK:-/var/www/neovista/backend/.venv-current}"

for tool in grep readlink sed sqlite3 stat; do
  command -v "$tool" >/dev/null || exit 1
done

fail_runtime() {
  # Deliberately never print values from .env or database content.
  echo "NeoVista runtime preflight failed: $1" >&2
  exit 1
}

# Refuse to let application startup/create_all silently replace a missing
# production database with a new empty file.
[[ -e "$DB_PATH" && -f "$DB_PATH" && ! -L "$DB_PATH" ]] || fail_runtime "database path/type"
[[ -s "$DB_PATH" ]] || fail_runtime "database is empty"
[[ -r "$DB_PATH" && -w "$DB_PATH" ]] || fail_runtime "database permissions"
[[ "$(stat -c '%U:%G:%a' "$DB_PATH")" == "ecs-user:ecs-user:600" ]] || fail_runtime "database owner/mode"
[[ "$(sqlite3 -readonly -bail "$DB_PATH" 'PRAGMA quick_check;')" == "ok" ]] || fail_runtime "database quick_check"
for required_table in users credit_transactions chat_sessions video_generation_tasks image_generation_tasks; do
  [[ "$(sqlite3 -readonly -bail "$DB_PATH" \
    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='$required_table';")" == "1" ]] \
    || fail_runtime "required schema table"
done
[[ "$(sqlite3 -readonly -bail "$DB_PATH" \
  "SELECT count(*) FROM sqlite_master WHERE type='index' AND name='ix_chat_sessions_user_id';")" == "1" ]] \
  || fail_runtime "required schema index"

[[ -e "$ENV_FILE" && -f "$ENV_FILE" && ! -L "$ENV_FILE" ]] || fail_runtime "environment path/type"
[[ -r "$ENV_FILE" ]] || fail_runtime "environment readability"
[[ "$(stat -c '%U:%G:%a' "$ENV_FILE")" == "ecs-user:ecs-user:600" ]] || fail_runtime "environment owner/mode"

env_value() {
  local key="$1" count
  count="$(grep -Ec "^${key}=" "$ENV_FILE" || true)"
  [[ "$count" == "1" ]] || return 1
  sed -n "s/^${key}=//p" "$ENV_FILE"
}
neovista_env="$(env_value NEOVISTA_ENV)" || fail_runtime "NEOVISTA_ENV missing or duplicated"
schema_auto_create="$(env_value DATABASE_SCHEMA_AUTO_CREATE_ENABLED)" \
  || fail_runtime "DATABASE_SCHEMA_AUTO_CREATE_ENABLED missing or duplicated"
[[ "$neovista_env" == "production" ]] || fail_runtime "NEOVISTA_ENV is not production"
[[ "$schema_auto_create" == "false" ]] || fail_runtime "schema auto-create is not disabled"

[[ -L "$VENV_LINK" ]] || fail_runtime "venv pointer is not a symlink"
VENV_REAL="$(readlink -f -- "$VENV_LINK")"
[[ -n "$VENV_REAL" && -x "$VENV_REAL/bin/python" ]] || fail_runtime "venv target"
