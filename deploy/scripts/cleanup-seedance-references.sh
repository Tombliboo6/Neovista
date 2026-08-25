#!/usr/bin/env bash
set -Eeuo pipefail

# Dry-run by default. Terminal task cleanup happens in the application; this is
# the bounded safety net for files left by crashes or legacy releases.
MODE="dry-run"
TTL_HOURS="${SEEDANCE_REFERENCE_RETENTION_HOURS:-24}"
APP_ROOT="${APP_ROOT:-/var/www/neovista}"
DB_PATH="${DATABASE_PATH:-/var/lib/neovista/neovista.db}"
REFERENCE_DIR="${SEEDANCE_REFERENCE_DIR:-$APP_ROOT/backend/static/seedance_references}"

usage() {
  cat <<'EOF'
Usage: cleanup-seedance-references.sh [--dry-run|--delete] [--ttl-hours HOURS]

Default is --dry-run with a 24-hour minimum retention window. Files referenced
by active or reconciliation-required tasks are always retained. The reference
directory must resolve to APP_ROOT/backend/static/seedance_references exactly.
Only aggregate counts are printed; filenames and reference URLs stay out of logs.
EOF
}

while (($#)); do
  case "$1" in
    --dry-run) MODE="dry-run" ;;
    --delete) MODE="delete" ;;
    --ttl-hours)
      shift
      TTL_HOURS="${1:?--ttl-hours requires a value}"
      ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

[[ "$TTL_HOURS" =~ ^[0-9]+$ ]] || { echo "TTL must be an integer" >&2; exit 2; }
(( TTL_HOURS >= 24 )) || { echo "Refusing retention shorter than 24 hours" >&2; exit 2; }
for tool in basename find grep mktemp realpath sort sqlite3; do
  command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done
[[ -f "$DB_PATH" ]] || { echo "Database not found: $DB_PATH" >&2; exit 1; }
[[ -d "$APP_ROOT" ]] || { echo "Application root not found: $APP_ROOT" >&2; exit 1; }
[[ -d "$REFERENCE_DIR" ]] || { echo "Reference directory absent; nothing to clean"; exit 0; }

# Never let an environment typo turn this cleanup into an arbitrary recursive
# delete. Canonical APP_ROOT may vary in tests, but the suffix is not configurable.
APP_ROOT_REAL="$(realpath -- "$APP_ROOT")"
REFERENCE_DIR_REAL="$(realpath -- "$REFERENCE_DIR")"
EXPECTED_REFERENCE_DIR="${APP_ROOT_REAL%/}/backend/static/seedance_references"
if [[ "$REFERENCE_DIR_REAL" != "$EXPECTED_REFERENCE_DIR" ]]; then
  echo "Refusing unsafe reference directory: it is outside the exact application path" >&2
  exit 2
fi
[[ "$REFERENCE_DIR_REAL" != "/" && "$REFERENCE_DIR_REAL" != "$APP_ROOT_REAL" ]]

[[ "$(sqlite3 -bail "$DB_PATH" 'PRAGMA integrity_check;')" == "ok" ]]

ACTIVE_BASENAMES="$(mktemp)"
ACTIVE_PATHS="$(mktemp)"
trap 'rm -f -- "$ACTIVE_BASENAMES" "$ACTIVE_PATHS"' EXIT
chmod 600 "$ACTIVE_BASENAMES" "$ACTIVE_PATHS"

# Old production schemas may have the task table but not reference_paths yet.
# In that case there cannot be a persisted active reference list, so the list is
# intentionally empty and the 24-hour TTL still protects recent files.
has_video_table="$(sqlite3 -bail "$DB_PATH" \
  "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='video_generation_tasks';")"
has_reference_column="0"
if [[ "$has_video_table" == "1" ]]; then
  has_reference_column="$(sqlite3 -bail "$DB_PATH" \
    "SELECT count(*) FROM pragma_table_info('video_generation_tasks') WHERE name='reference_paths';")"
fi

if [[ "$has_reference_column" == "1" ]]; then
  [[ "$(sqlite3 -bail "$DB_PATH" "SELECT json_valid('{}');")" == "1" ]]
  sqlite3 -bail -noheader "$DB_PATH" <<'SQL' >"$ACTIVE_PATHS"
WITH active AS (
  SELECT reference_paths
  FROM video_generation_tasks
  WHERE lower(status) IN (
    'ready','creating','submitting','submit_unknown','submitted','running',
    'finalizing','queued','pending','created','processing','reconciliation_required'
  )
  AND reference_paths IS NOT NULL
  AND json_valid(reference_paths)
), path_arrays AS (
  SELECT CASE
    WHEN json_type(reference_paths, '$.local_paths') = 'array'
      THEN json_extract(reference_paths, '$.local_paths')
    WHEN json_type(reference_paths) = 'array'
      THEN reference_paths
    ELSE '[]'
  END AS paths
  FROM active
)
SELECT DISTINCT value
FROM path_arrays, json_each(path_arrays.paths)
WHERE type = 'text';
SQL
fi

while IFS= read -r active_path; do
  [[ -n "$active_path" ]] || continue
  basename -- "$active_path"
done <"$ACTIVE_PATHS" | LC_ALL=C sort -u >"$ACTIVE_BASENAMES"

cutoff_minutes=$((TTL_HOURS * 60))
candidate_count=0
eligible_count=0
deleted_count=0
retained_active_count=0

while IFS= read -r -d '' candidate; do
  candidate_count=$((candidate_count + 1))
  filename="$(basename -- "$candidate")"
  if grep -Fqx -- "$filename" "$ACTIVE_BASENAMES"; then
    retained_active_count=$((retained_active_count + 1))
    continue
  fi
  eligible_count=$((eligible_count + 1))
  if [[ "$MODE" == "delete" ]]; then
    rm -f -- "$candidate"
    deleted_count=$((deleted_count + 1))
  fi
done < <(find "$REFERENCE_DIR_REAL" -xdev -type f -mmin "+$cutoff_minutes" -print0)

if [[ "$MODE" == "delete" ]]; then
  # Nested legacy directories are removed only after their files are safely gone.
  find "$REFERENCE_DIR_REAL" -xdev -mindepth 1 -depth -type d -empty -delete
fi

printf 'mode=%s candidates=%d eligible=%d deleted=%d retained_active=%d ttl_hours=%d\n' \
  "$MODE" "$candidate_count" "$eligible_count" "$deleted_count" \
  "$retained_active_count" "$TTL_HOURS"
