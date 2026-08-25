#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ "${1:-}" != "--execute" || "${NEOVISTA_MAINTENANCE_CONFIRMED:-}" != "YES" ]]; then
  cat >&2 <<'EOF'
Refusing to enter maintenance mode.
Run only after reading deploy/PRODUCTION_RUNBOOK_NEOVISTA_CN.md:
  sudo env NEOVISTA_MAINTENANCE_CONFIRMED=YES ... \
    ./deploy/scripts/migrate-neovista-production.sh --execute
EOF
  exit 2
fi
if (( EUID != 0 )); then
  echo "This release transaction must run as root (use sudo); refusing partial privileges" >&2
  exit 2
fi

APP_ROOT="${APP_ROOT:-/var/www/neovista}"
BACKEND_DIR="$APP_ROOT/backend"
DB_PATH="${DATABASE_PATH:-/var/lib/neovista/neovista.db}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/neovista/releases}"
PRODUCTION_NGINX_SOURCE="$APP_ROOT/deploy/nginx/neovista-cn.conf"
MAINTENANCE_NGINX_SOURCE="$APP_ROOT/deploy/nginx/neovista-cn-maintenance.conf"
NGINX_AVAILABLE="${NGINX_AVAILABLE_PATH:-/etc/nginx/sites-available/neovista}"
NGINX_ENABLED="${NGINX_ENABLED_PATH:-/etc/nginx/sites-enabled/neovista}"
SYSTEMD_SOURCE="$APP_ROOT/deploy/systemd/neovista-api.service"
SYSTEMD_TARGET="/etc/systemd/system/neovista-api.service"
CLEANUP_SERVICE_SOURCE="$APP_ROOT/deploy/systemd/neovista-seedance-reference-cleanup.service"
CLEANUP_TIMER_SOURCE="$APP_ROOT/deploy/systemd/neovista-seedance-reference-cleanup.timer"
CLEANUP_SERVICE_TARGET="/etc/systemd/system/neovista-seedance-reference-cleanup.service"
CLEANUP_TIMER_TARGET="/etc/systemd/system/neovista-seedance-reference-cleanup.timer"
CLEANUP_SCRIPT="$APP_ROOT/deploy/scripts/cleanup-seedance-references.sh"
SERVICE="neovista-api.service"
ENV_FILE="$BACKEND_DIR/.env"
VENV_LINK="$BACKEND_DIR/.venv-current"
VENV_ROOT="${VENV_ROOT:-/var/lib/neovista/venvs}"
CANDIDATE_VENV="${CANDIDATE_VENV:?Set CANDIDATE_VENV to the prebuilt, root-owned candidate venv}"
EXPECTED_CANDIDATE_MANIFEST="${EXPECTED_CANDIDATE_MANIFEST:?Set EXPECTED_CANDIDATE_MANIFEST to the root-owned tested artifact SHA256SUMS}"
PREVIOUS_ARTIFACT_DIR="${PREVIOUS_ARTIFACT_DIR:?Set PREVIOUS_ARTIFACT_DIR to the verified pre-release code/dist/config backup}"
RELEASE_CODE_REF="${RELEASE_CODE_REF:?Set RELEASE_CODE_REF to the tested candidate commit or immutable artifact ID}"
CANONICAL_ROLLBACK_DATABASE_BACKUP="${CANONICAL_ROLLBACK_DATABASE_BACKUP:-}"

for tool in awk cmp curl find flock fuser grep install jq nginx pgrep pkill readlink realpath \
  runuser sed sha256sum sort sqlite3 ss stat systemctl xargs; do
  command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done

[[ "$(id -un)" == "root" ]]
[[ "$RELEASE_CODE_REF" =~ ^[A-Za-z0-9._:-]{7,128}$ ]]
[[ -d "$APP_ROOT" && -d "$BACKEND_DIR" ]]
[[ -f "$DB_PATH" && ! -L "$DB_PATH" ]]
[[ -f "$PRODUCTION_NGINX_SOURCE" && -f "$MAINTENANCE_NGINX_SOURCE" ]]
[[ -f "$SYSTEMD_SOURCE" && -f "$CLEANUP_SERVICE_SOURCE" && -f "$CLEANUP_TIMER_SOURCE" ]]
[[ -x "$CLEANUP_SCRIPT" ]]
[[ -f "$APP_ROOT/frontend/dist/index.html" ]]
[[ -f "$EXPECTED_CANDIDATE_MANIFEST" && ! -L "$EXPECTED_CANDIDATE_MANIFEST" ]]
[[ "$(stat -c '%U:%G' "$EXPECTED_CANDIDATE_MANIFEST")" == "root:root" ]]
[[ "$(stat -c '%a' "$EXPECTED_CANDIDATE_MANIFEST")" == "600" ]]
[[ -d "$PREVIOUS_ARTIFACT_DIR/backend" ]]
[[ -d "$PREVIOUS_ARTIFACT_DIR/frontend-dist" ]]
[[ -f "$PREVIOUS_ARTIFACT_DIR/nginx.previous" ]]
[[ -f "$PREVIOUS_ARTIFACT_DIR/neovista-api.previous" ]]
[[ -f "$PREVIOUS_ARTIFACT_DIR/previous-venv-target.txt" ]]
[[ -f "$PREVIOUS_ARTIFACT_DIR/SHA256SUMS" ]]
(cd "$PREVIOUS_ARTIFACT_DIR" && sha256sum -c SHA256SUMS)

APP_ROOT_REAL="$(realpath -- "$APP_ROOT")"
VENV_ROOT_REAL="$(realpath -- "$VENV_ROOT")"
CANDIDATE_VENV_REAL="$(realpath -- "$CANDIDATE_VENV")"
case "$CANDIDATE_VENV_REAL" in
  "$VENV_ROOT_REAL"/*) ;;
  *) echo "Candidate venv must be below $VENV_ROOT_REAL" >&2; exit 2 ;;
esac
[[ "$CANDIDATE_VENV_REAL" != "$VENV_ROOT_REAL/current" ]]
[[ "$(basename -- "$CANDIDATE_VENV_REAL")" == "$RELEASE_CODE_REF" ]] || {
  echo "Candidate venv directory must exactly match RELEASE_CODE_REF" >&2
  exit 2
}
[[ -x "$CANDIDATE_VENV_REAL/bin/python" ]]
if find "$CANDIDATE_VENV_REAL" -xdev ! -type l \
  \( ! -user root -o -perm /022 \) -print -quit | grep -q .; then
  echo "Candidate venv must be root-owned and not group/world writable" >&2
  exit 2
fi
PYTHON="$CANDIDATE_VENV_REAL/bin/python"
"$PYTHON" -m pip check
"$PYTHON" - <<'PY'
import bcrypt
import cryptography
import fastapi
import httpx
import jwt
import PIL
import pydantic
import sqlalchemy
import uvicorn
PY

env_value() {
  local key="$1" count
  count="$(grep -Ec "^${key}=" "$ENV_FILE" || true)"
  [[ "$count" == "1" ]] || return 1
  sed -n "s/^${key}=//p" "$ENV_FILE"
}
require_env_nonempty() {
  local value
  value="$(env_value "$1")" || return 1
  [[ -n "$value" ]]
}
require_env_equals() {
  local key="$1" expected="$2" value
  value="$(env_value "$key")" || {
    echo "Required environment key is missing or duplicated: $key" >&2
    exit 1
  }
  [[ "$value" == "$expected" ]] || {
    echo "Required environment key has an invalid production value: $key" >&2
    exit 1
  }
}
require_strong_secret() {
  local key="$1" value lowered
  value="$(env_value "$key")" || return 1
  (( ${#value} >= 32 )) || return 1
  lowered="${value,,}"
  [[ ! "$lowered" =~ (changeme|change-me|placeholder|replace-me|example|default|insecure|test-secret|your-secret) ]] \
    || return 1
}
[[ "$(stat -c '%a' "$ENV_FILE")" == "600" ]] || { echo "Environment file mode must be 600" >&2; exit 1; }
require_env_equals NEOVISTA_ENV production
require_env_equals DATABASE_SCHEMA_AUTO_CREATE_ENABLED false
require_env_equals DATABASE_URL sqlite:////var/lib/neovista/neovista.db
require_env_equals PUBLIC_BASE_URL https://neovista.cn
require_env_equals IMAGE_GENERATION_FEATURE_ENABLED false
require_env_equals SEEDANCE_FEATURE_ENABLED false
require_env_equals SEEDANCE_RECONCILER_ENABLED true
require_env_equals SEEDANCE_REFERENCE_ALLOWED_HOSTS neovista.cn
require_env_equals SEEDANCE_REFERENCE_GC_ENABLED true
require_env_equals SEEDANCE_REFERENCE_TTL_SECONDS 86400
cors_origins="$(env_value CORS_ALLOW_ORIGINS)" || {
  echo "CORS_ALLOW_ORIGINS is missing or duplicated" >&2; exit 1;
}
[[ "$cors_origins" == "https://neovista.cn" || \
   "$cors_origins" == "https://neovista.cn,https://www.neovista.cn" || \
   "$cors_origins" == "https://www.neovista.cn,https://neovista.cn" ]] \
  || { echo "CORS_ALLOW_ORIGINS has an invalid production value" >&2; exit 1; }
for secret_key in JWT_SECRET_KEY ADMIN_SECRET_KEY SEEDANCE_API_KEY SEEDANCE_BASE_URL SEEDANCE_MODEL; do
  require_env_nonempty "$secret_key" || {
    echo "Required secret/config key is missing, duplicated, or empty: $secret_key" >&2
    exit 1
  }
done
require_strong_secret JWT_SECRET_KEY || { echo "JWT_SECRET_KEY fails production strength policy" >&2; exit 1; }
require_strong_secret ADMIN_SECRET_KEY || { echo "ADMIN_SECRET_KEY fails production strength policy" >&2; exit 1; }
jwt_secret="$(env_value JWT_SECRET_KEY)" || exit 1
admin_secret="$(env_value ADMIN_SECRET_KEY)" || exit 1
[[ "$jwt_secret" != "$admin_secret" ]] || { echo "JWT and admin secrets must be distinct" >&2; exit 1; }
unset jwt_secret admin_secret

migrations=(
  migrate_billing_schema.py
  migrate_video_generation_schema.py
  migrate_image_generation_schema.py
)
for migration in "${migrations[@]}"; do
  [[ -f "$BACKEND_DIR/$migration" ]] || { echo "Missing migration: $migration" >&2; exit 1; }
done

validate_candidate_manifest() {
  local manifest="$1" line relative count=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[0-9a-f]{64}\ \ ([A-Za-z0-9_./@+:,=-]+)$ ]] || {
      echo "Invalid candidate manifest line" >&2
      return 1
    }
    relative="${BASH_REMATCH[1]}"
    [[ "$relative" != /* && "$relative" != *".."* ]] || {
      echo "Candidate manifest contains an unsafe relative path" >&2
      return 1
    }
    case "$relative" in
      backend/.env|backend/.venv/*|backend/.venv-current/*|backend/static/*|backend/*.db|backend/*.sqlite|backend/*.pem|backend/*.key)
        echo "Candidate manifest contains protected runtime data" >&2; return 1 ;;
      backend/*|frontend/dist/*|deploy/*) ;;
      *) echo "Candidate manifest path is outside deployable roots" >&2; return 1 ;;
    esac
    count=$((count + 1))
  done <"$manifest"
  (( count > 0 ))
}

build_installed_manifest() {
  local destination="$1"
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
  ) >"$destination"
}

validate_candidate_manifest "$EXPECTED_CANDIDATE_MANIFEST" || exit 1
EXPECTED_SORTED="$(mktemp)"
ACTUAL_MANIFEST="$(mktemp)"
trap 'rm -f -- "${EXPECTED_SORTED:-}" "${ACTUAL_MANIFEST:-}"' EXIT
LC_ALL=C sort -k2 "$EXPECTED_CANDIDATE_MANIFEST" >"$EXPECTED_SORTED"
build_installed_manifest "$ACTUAL_MANIFEST"
(cd "$APP_ROOT_REAL" && sha256sum -c "$EXPECTED_SORTED")
cmp -s "$EXPECTED_SORTED" "$ACTUAL_MANIFEST" || {
  echo "Installed candidate file set/digests do not exactly match the tested manifest" >&2
  exit 1
}

install_nginx_config_atomic() {
  local source="$1" next="${NGINX_AVAILABLE}.next.$$"
  install -m 644 -o root -g root "$source" "$next"
  mv -Tf "$next" "$NGINX_AVAILABLE"
  ln -sfn "$NGINX_AVAILABLE" "$NGINX_ENABLED"
}

stop_release_services_fail_closed() {
  systemctl stop "$SERVICE" nginx >/dev/null 2>&1 || true
  for unit in "$SERVICE" nginx; do
    if systemctl is-active --quiet "$unit"; then
      systemctl kill --kill-who=all --signal=KILL "$unit" >/dev/null 2>&1 || true
      systemctl stop "$unit" >/dev/null 2>&1 || true
    fi
  done
  if pgrep -a -f '[u]vicorn.*main:app' >/dev/null; then
    pkill -KILL -f '[u]vicorn.*main:app' >/dev/null 2>&1 || true
  fi
  if pgrep -x nginx >/dev/null; then
    pkill -KILL -x nginx >/dev/null 2>&1 || true
  fi
  ! systemctl is-active --quiet "$SERVICE" &&
    ! systemctl is-active --quiet nginx &&
    ! pgrep -a -f '[u]vicorn.*main:app' >/dev/null &&
    ! pgrep -x nginx >/dev/null &&
    [[ -z "$(ss -H -ltnp 'sport = :8000' 2>/dev/null)" ]]
}

install -d -m 700 -o root -g root "$BACKUP_ROOT"
exec 9>"$BACKUP_ROOT/.release.lock"
flock -n 9 || { echo "Another NeoVista release transaction is active" >&2; exit 1; }

release_id="$(date -u +%Y%m%dT%H%M%SZ)-${RELEASE_CODE_REF:0:12}"
release_backup="$BACKUP_ROOT/$release_id"
install -d -m 700 -o root -g root "$release_backup"
maintenance_entered=0
rollback_bundle_ready=0
canonical_database_file=""

rollback_notice() {
  local status="${1:-1}"
  trap - ERR INT TERM
  if [[ "$maintenance_entered" == "1" ]]; then
    if stop_release_services_fail_closed; then
      # Do not let a distro default or legacy NeoVista vhost bypass the hard
      # maintenance server if a release fails before the normal staging block.
      rm -f /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/neovista.conf
      if install_nginx_config_atomic "$MAINTENANCE_NGINX_SOURCE" && nginx -t; then
        systemctl start nginx || true
      fi
    else
      echo "CRITICAL: unable to prove Nginx/API stopped; hard-maintenance was not started" >&2
    fi
  fi
  cat >&2 <<EOF
RELEASE STOPPED (status=$status). Paid APIs are not public; the edge is either
hard-maintenance (HTTP 503) or stopped. Do not roll back code alone.
EOF
  if [[ "$rollback_bundle_ready" == "1" ]]; then
    echo "Rollback bundle: release_backup=$release_backup canonical_database=$canonical_database_file" >&2
  elif [[ -n "$CANONICAL_ROLLBACK_DATABASE_BACKUP" ]]; then
    echo "No new rollback pair was created; preserve and use the original verified first-run bundle." >&2
  else
    echo "No verified rollback pair was created by this run; stop for operator review." >&2
  fi
  echo "Follow the paired rollback section in deploy/PRODUCTION_RUNBOOK_NEOVISTA_CN.md." >&2
  exit "$status"
}
trap 'rollback_notice $?' ERR
trap 'rollback_notice 130' INT
trap 'rollback_notice 143' TERM

# Stop the public edge first, then the only API/reconciler process.
maintenance_entered=1
systemctl stop nginx
systemctl stop "$SERVICE"
! systemctl is-active --quiet nginx
! systemctl is-active --quiet "$SERVICE"

# Do not trust systemd state alone: fail on stray Uvicorn, port listeners, or
# any process still holding the DB/WAL/SHM before the consistent snapshot.
if pgrep -a -f '[u]vicorn.*main:app' >/dev/null; then
  echo "Stray Uvicorn process remains after service stop" >&2; false
fi
if [[ -n "$(ss -H -ltnp 'sport = :8000' 2>/dev/null)" ]]; then
  echo "Port 8000 is still listening after service stop" >&2; false
fi
for held_path in "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm"; do
  if [[ -e "$held_path" ]] && fuser "$held_path" >/dev/null 2>&1; then
    echo "A process still holds the production database" >&2; false
  fi
done

# WAL-safe consistent backup and immutable release evidence.
sqlite3 -bail "$DB_PATH" 'PRAGMA wal_checkpoint(TRUNCATE);'
sqlite3 -bail "$DB_PATH" ".backup '$release_backup/neovista.db'"
chmod 600 "$release_backup/neovista.db"
[[ "$(sqlite3 -bail "$release_backup/neovista.db" 'PRAGMA integrity_check;')" == "ok" ]]
[[ -z "$(sqlite3 -bail "$release_backup/neovista.db" 'PRAGMA foreign_key_check;')" ]]

previous_venv_target="$(tr -d '\r\n' <"$PREVIOUS_ARTIFACT_DIR/previous-venv-target.txt")"
[[ -n "$previous_venv_target" && -x "$previous_venv_target/bin/python" ]]

# A retry after a forward migration must never relabel the retry checkpoint as
# the database paired with the old code artifact.  Copy the verified original
# snapshot into this release bundle so rollback has one immutable, self-
# contained input and cannot accidentally restore the retry checkpoint.
canonical_database_file="neovista.db"
if [[ -n "$CANONICAL_ROLLBACK_DATABASE_BACKUP" ]]; then
  [[ -f "$CANONICAL_ROLLBACK_DATABASE_BACKUP" && ! -L "$CANONICAL_ROLLBACK_DATABASE_BACKUP" ]]
  canonical_source="$(realpath -- "$CANONICAL_ROLLBACK_DATABASE_BACKUP")"
  case "$canonical_source" in
    "$(realpath -- "$BACKUP_ROOT")"/*/neovista.db|\
    "$(realpath -- "$BACKUP_ROOT")"/*/canonical-neovista.db) ;;
    *) echo "Canonical rollback database must be a release backup below $BACKUP_ROOT" >&2; false ;;
  esac
  canonical_source_dir="$(dirname -- "$canonical_source")"
  canonical_source_manifest="$canonical_source_dir/release-manifest.txt"
  [[ "$(stat -c '%U:%G:%a' "$canonical_source_dir")" == "root:root:700" ]]
  [[ "$(stat -c '%U:%G:%a' "$canonical_source")" == "root:root:600" ]]
  [[ -f "$canonical_source_manifest" && ! -L "$canonical_source_manifest" ]]
  canonical_manifest_value() {
    local key="$1" count
    count="$(grep -Ec "^${key}=" "$canonical_source_manifest" || true)"
    [[ "$count" == "1" ]] || return 1
    sed -n "s/^${key}=//p" "$canonical_source_manifest"
  }
  canonical_source_member="$(canonical_manifest_value canonical_database_file 2>/dev/null || printf 'neovista.db')"
  [[ "$canonical_source_member" == "neovista.db" || \
     "$canonical_source_member" == "canonical-neovista.db" ]]
  [[ "$(basename -- "$canonical_source")" == "$canonical_source_member" ]] || {
    echo "Canonical source does not match its release manifest" >&2
    false
  }
  canonical_previous_artifact="$(canonical_manifest_value previous_artifact_dir)"
  canonical_previous_venv="$(canonical_manifest_value previous_venv_target)"
  [[ "$(realpath -- "$canonical_previous_artifact")" == "$(realpath -- "$PREVIOUS_ARTIFACT_DIR")" ]]
  [[ "$(realpath -- "$canonical_previous_venv")" == "$(realpath -- "$previous_venv_target")" ]]
  (cd "$canonical_source_dir" && \
    grep -E "^[0-9a-f]{64}  ${canonical_source_member}$" release-manifest.txt | sha256sum -c -)
  [[ "$(sqlite3 -bail "$canonical_source" 'PRAGMA integrity_check;')" == "ok" ]]
  [[ -z "$(sqlite3 -bail "$canonical_source" 'PRAGMA foreign_key_check;')" ]]
  canonical_database_file="canonical-neovista.db"
  install -m 600 -o root -g root "$canonical_source" \
    "$release_backup/$canonical_database_file"
  cmp -s "$canonical_source" "$release_backup/$canonical_database_file"
fi

printf 'previous_artifact_dir=%s\nrelease_code_ref=%s\nprevious_venv_target=%s\ncanonical_database_file=%s\n' \
  "$PREVIOUS_ARTIFACT_DIR" "$RELEASE_CODE_REF" "$previous_venv_target" \
  "$canonical_database_file" \
  >"$release_backup/release-manifest.txt"
printf '%s  %s\n' "$(sha256sum "$release_backup/neovista.db" | awk '{print $1}')" \
  "neovista.db" >>"$release_backup/release-manifest.txt"
if [[ "$canonical_database_file" != "neovista.db" ]]; then
  printf '%s  %s\n' \
    "$(sha256sum "$release_backup/$canonical_database_file" | awk '{print $1}')" \
    "$canonical_database_file" >>"$release_backup/release-manifest.txt"
fi
chmod 600 "$release_backup/release-manifest.txt"
install -m 600 -o root -g root "$EXPECTED_SORTED" "$release_backup/candidate-SHA256SUMS.expected"
install -m 600 -o root -g root "$ACTUAL_MANIFEST" "$release_backup/candidate-SHA256SUMS.installed"
install -m 600 -o root -g root "$MAINTENANCE_NGINX_SOURCE" "$release_backup/maintenance-nginx.conf"
rollback_bundle_ready=1

# Inventory contains identifiers/status only—never prompts, keys, or user data.
sqlite3 -bail -header -tabs "$DB_PATH" \
  "SELECT task_id,status,hold_transaction_id FROM video_generation_tasks WHERE lower(status) NOT IN ('succeeded','failed','cancelled','canceled');" \
  >"$release_backup/video-reconciliation-before.tsv"
chmod 600 "$release_backup/video-reconciliation-before.tsv"

cd "$BACKEND_DIR"
migration_database_url="sqlite:///$DB_PATH"
for migration in "${migrations[@]}"; do
  # Never rely on a migration module happening to load .env.  Bind every
  # migration to the single database that was snapshotted and will be checked.
  runuser -u ecs-user -- env \
    DATABASE_URL="$migration_database_url" \
    NEOVISTA_ENV=production \
    DATABASE_SCHEMA_AUTO_CREATE_ENABLED=false \
    "$PYTHON" "$migration"
done

[[ "$(sqlite3 -bail "$DB_PATH" 'PRAGMA integrity_check;')" == "ok" ]]
[[ -z "$(sqlite3 -bail "$DB_PATH" 'PRAGMA foreign_key_check;')" ]]
chown ecs-user:ecs-user "$DB_PATH"
chmod 600 "$DB_PATH"

for index_name in \
  uq_credit_transactions_settlement_key \
  ix_chat_sessions_user_id \
  uq_video_generation_tasks_user_request \
  uq_video_generation_tasks_provider_task_id \
  uq_video_generation_tasks_hold_transaction_id \
  uq_video_generation_tasks_user_unresolved \
  uq_image_generation_tasks_user_request \
  uq_image_generation_tasks_hold_transaction_id; do
  [[ "$(sqlite3 -bail "$DB_PATH" "SELECT count(*) FROM sqlite_master WHERE type='index' AND name='$index_name';")" == "1" ]]
done

# Stage the candidate runtime before reconciliation gates. If a historical item
# needs evidence-based admin settlement, the failure handler keeps only the hard
# maintenance edge public while this candidate API can be started on localhost.
install_nginx_config_atomic "$MAINTENANCE_NGINX_SOURCE"
rm -f /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/neovista.conf
install -m 644 -o root -g root "$SYSTEMD_SOURCE" "$SYSTEMD_TARGET"
install -m 644 -o root -g root "$CLEANUP_SERVICE_SOURCE" "$CLEANUP_SERVICE_TARGET"
install -m 644 -o root -g root "$CLEANUP_TIMER_SOURCE" "$CLEANUP_TIMER_TARGET"
venv_next="${VENV_LINK}.next.$$"
ln -s "$CANDIDATE_VENV_REAL" "$venv_next"
mv -Tf "$venv_next" "$VENV_LINK"
[[ "$(readlink -f -- "$VENV_LINK")" == "$CANDIDATE_VENV_REAL" ]]
[[ "$(readlink -f "$NGINX_ENABLED")" == "$NGINX_AVAILABLE" ]]
! grep -Rqs 'neotest\.site' /etc/nginx/sites-enabled
nginx -t
systemctl daemon-reload

# Image calls are synchronous. Any unresolved task or orphan PENDING hold needs
# evidence-based operator review; never auto-refund it merely to pass release.
sqlite3 -bail -header -tabs "$DB_PATH" \
  "SELECT t.task_id,t.request_id,t.status,t.settlement_status,t.hold_transaction_id FROM image_generation_tasks t WHERE lower(t.status) IN ('ready','submitting','submit_unknown','reconciliation_required') OR t.settlement_status='REVIEW_REQUIRED';" \
  >"$release_backup/image-reconciliation-required.tsv"
chmod 600 "$release_backup/image-reconciliation-required.tsv"
IMAGE_REVIEW_REQUIRED="$(sqlite3 -bail "$DB_PATH" "SELECT count(*) FROM image_generation_tasks WHERE lower(status) IN ('ready','submitting','submit_unknown','reconciliation_required') OR settlement_status='REVIEW_REQUIRED';")"
ORPHAN_IMAGE_HOLDS="$(sqlite3 -bail "$DB_PATH" "SELECT count(*) FROM credit_transactions h LEFT JOIN image_generation_tasks t ON t.hold_transaction_id=h.id WHERE h.type='GENERATE_HOLD' AND h.status='PENDING' AND (h.idempotency_key LIKE 'image-generate:%' OR h.idempotency_key LIKE 'generate:%' OR h.idempotency_key LIKE 'generate-diagram:%') AND t.id IS NULL;")"
if [[ "$IMAGE_REVIEW_REQUIRED" != "0" || "$ORPHAN_IMAGE_HOLDS" != "0" ]]; then
  echo "Image reconciliation gate blocked release; review root-only evidence in $release_backup" >&2
  false
fi

# Remove every recursively nested, expired, unreferenced legacy file before any
# public reference gateway can start, then prove the remaining eligible set is 0.
APP_ROOT="$APP_ROOT" DATABASE_PATH="$DB_PATH" \
  "$CLEANUP_SCRIPT" --delete --ttl-hours 24 >"$release_backup/reference-cleanup-delete.txt"
APP_ROOT="$APP_ROOT" DATABASE_PATH="$DB_PATH" \
  "$CLEANUP_SCRIPT" --dry-run --ttl-hours 24 >"$release_backup/reference-cleanup-after.txt"
grep -Eq '(^| )eligible=0( |$)' "$release_backup/reference-cleanup-after.txt"
chmod 600 "$release_backup"/reference-cleanup-*.txt

# Nginx deliberately remains stopped until the paid smoke workflow.
systemctl enable neovista-seedance-reference-cleanup.timer >/dev/null

systemctl start "$SERVICE"
ready=0
for _ in $(seq 1 90); do
  if curl -fsS http://127.0.0.1:8000/api/ready \
    | jq -e '.status == "ready" and ([.checks[]] | all)' >/dev/null; then
    ready=1
    break
  fi
  sleep 2
done
[[ "$ready" == "1" ]]
! systemctl is-active --quiet nginx

sqlite3 -bail -header -tabs "$DB_PATH" \
  "SELECT task_id,provider_task_id,status,settlement_status,hold_transaction_id FROM video_generation_tasks WHERE lower(status) NOT IN ('succeeded','failed','cancelled','canceled');" \
  >"$release_backup/video-reconciliation-after.tsv"
chmod 600 "$release_backup/video-reconciliation-after.tsv"

trap - ERR INT TERM EXIT
rm -f -- "$EXPECTED_SORTED" "$ACTUAL_MANIFEST"
echo "PASS: migrations/local readiness complete; Nginx remains stopped; backup pair: $release_backup"
