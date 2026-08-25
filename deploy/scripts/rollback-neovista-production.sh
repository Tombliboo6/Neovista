#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ "${1:-}" != "--execute" || "${NEOVISTA_ROLLBACK_CONFIRMED:-}" != "YES" ]]; then
  cat >&2 <<'EOF'
Refusing paired production rollback.
Run only with the exact release backup printed by the failed migration:
  sudo env NEOVISTA_ROLLBACK_CONFIRMED=YES RELEASE_BACKUP=/var/backups/neovista/releases/<id> \
    ./deploy/scripts/rollback-neovista-production.sh --execute
EOF
  exit 2
fi
(( EUID == 0 )) || { echo "Rollback must run as root" >&2; exit 2; }

APP_ROOT="${APP_ROOT:-/var/www/neovista}"
DB_PATH="${DATABASE_PATH:-/var/lib/neovista/neovista.db}"
RELEASE_ROOT="${RELEASE_ROOT:-/var/backups/neovista/releases}"
RELEASE_BACKUP="${RELEASE_BACKUP:?Set RELEASE_BACKUP to the exact failed release backup}"
NGINX_AVAILABLE="${NGINX_AVAILABLE_PATH:-/etc/nginx/sites-available/neovista}"
NGINX_ENABLED="${NGINX_ENABLED_PATH:-/etc/nginx/sites-enabled/neovista}"
SYSTEMD_TARGET="/etc/systemd/system/neovista-api.service"
ENV_FILE="$APP_ROOT/backend/.env"
VENV_LINK="$APP_ROOT/backend/.venv-current"
SERVICE="neovista-api.service"

for tool in curl flock fuser grep install nginx pgrep pkill python3 readlink realpath rsync \
  sed sha256sum sqlite3 ss stat sync systemctl; do
  command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done

RELEASE_ROOT_REAL="$(realpath -- "$RELEASE_ROOT")"
RELEASE_BACKUP_REAL="$(realpath -- "$RELEASE_BACKUP")"
case "$RELEASE_BACKUP_REAL" in
  "$RELEASE_ROOT_REAL"/*) ;;
  *) echo "Release backup is outside the root-only release directory" >&2; exit 2 ;;
esac
[[ -d "$RELEASE_BACKUP_REAL" && ! -L "$RELEASE_BACKUP" ]]
[[ "$(stat -c '%U:%G:%a' "$RELEASE_BACKUP_REAL")" == "root:root:700" ]]
for required in neovista.db release-manifest.txt maintenance-nginx.conf; do
  [[ -f "$RELEASE_BACKUP_REAL/$required" && ! -L "$RELEASE_BACKUP_REAL/$required" ]]
done

manifest_value() {
  local key="$1" count
  count="$(grep -Ec "^${key}=" "$RELEASE_BACKUP_REAL/release-manifest.txt" || true)"
  [[ "$count" == "1" ]] || return 1
  sed -n "s/^${key}=//p" "$RELEASE_BACKUP_REAL/release-manifest.txt"
}
PREVIOUS_ARTIFACT_DIR="$(manifest_value previous_artifact_dir)"
PREVIOUS_VENV_TARGET="$(manifest_value previous_venv_target)"
CANONICAL_DATABASE_FILE="$(manifest_value canonical_database_file 2>/dev/null || printf 'neovista.db')"
[[ "$CANONICAL_DATABASE_FILE" == "neovista.db" || \
   "$CANONICAL_DATABASE_FILE" == "canonical-neovista.db" ]]
[[ -f "$RELEASE_BACKUP_REAL/$CANONICAL_DATABASE_FILE" && \
   ! -L "$RELEASE_BACKUP_REAL/$CANONICAL_DATABASE_FILE" ]]
[[ "$(stat -c '%U:%G:%a' "$RELEASE_BACKUP_REAL/$CANONICAL_DATABASE_FILE")" == "root:root:600" ]]
[[ -d "$PREVIOUS_ARTIFACT_DIR/backend" && -d "$PREVIOUS_ARTIFACT_DIR/frontend-dist" ]]
[[ -f "$PREVIOUS_ARTIFACT_DIR/SHA256SUMS" ]]
(cd "$PREVIOUS_ARTIFACT_DIR" && sha256sum -c SHA256SUMS)
(cd "$RELEASE_BACKUP_REAL" && \
  grep -E "^[0-9a-f]{64}  ${CANONICAL_DATABASE_FILE}$" release-manifest.txt | sha256sum -c -)

case "$(realpath -- "$PREVIOUS_VENV_TARGET")" in
  /var/lib/neovista/venvs/*|"$(realpath -- "$APP_ROOT")"/backend/.venv) ;;
  *) echo "Recorded previous venv target is outside approved locations" >&2; exit 2 ;;
esac
[[ -x "$PREVIOUS_VENV_TARGET/bin/python" ]]

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

set_feature_flags_false() {
  NEOVISTA_ENV_FILE="$ENV_FILE" python3 - <<'PY'
import os
import stat
from pathlib import Path

path = Path(os.environ["NEOVISTA_ENV_FILE"])
metadata = path.stat()
targets = {"IMAGE_GENERATION_FEATURE_ENABLED", "SEEDANCE_FEATURE_ENABLED"}
seen = set()
updated = []
for line in path.read_text(encoding="utf-8").splitlines(keepends=True):
    matched = False
    for key in targets:
        if line.startswith(f"{key}="):
            if key in seen:
                raise SystemExit(f"duplicate feature flag: {key}")
            seen.add(key)
            updated.append(f"{key}=false\n")
            matched = True
            break
    if not matched:
        updated.append(line)
for key in sorted(targets - seen):
    updated.append(f"{key}=false\n")
temporary = path.with_name(f".{path.name}.rollback-{os.getpid()}")
try:
    temporary.write_text("".join(updated), encoding="utf-8")
    os.chmod(temporary, stat.S_IMODE(metadata.st_mode))
    os.chown(temporary, metadata.st_uid, metadata.st_gid)
    os.replace(temporary, path)
finally:
    try:
        temporary.unlink()
    except FileNotFoundError:
        pass
PY
}

install -d -m 700 -o root -g root "$RELEASE_ROOT_REAL"
exec 9>"$RELEASE_ROOT_REAL/.release.lock"
flock -n 9 || { echo "Another release/rollback transaction is active" >&2; exit 1; }

rollback_failed() {
  local status="${1:-1}"
  trap - ERR INT TERM
  if stop_release_services_fail_closed; then
    rm -f /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/neovista.conf
    if install_nginx_config_atomic "$RELEASE_BACKUP_REAL/maintenance-nginx.conf" && nginx -t; then
      systemctl start nginx || true
    fi
  else
    echo "CRITICAL: unable to prove Nginx/API stopped; hard-maintenance was not started" >&2
  fi
  echo "ROLLBACK INCOMPLETE (status=$status): API stopped; hard-maintenance edge retained" >&2
  exit "$status"
}
trap 'rollback_failed $?' ERR
trap 'rollback_failed 130' INT
trap 'rollback_failed 143' TERM

systemctl stop nginx "$SERVICE"
! systemctl is-active --quiet nginx
! systemctl is-active --quiet "$SERVICE"
if pgrep -a -f '[u]vicorn.*main:app' >/dev/null; then
  echo "Stray Uvicorn process blocks rollback" >&2; false
fi
if [[ -n "$(ss -H -ltnp 'sport = :8000' 2>/dev/null)" ]]; then
  echo "Port 8000 listener blocks rollback" >&2; false
fi
for held_path in "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm"; do
  if [[ -e "$held_path" ]] && fuser "$held_path" >/dev/null 2>&1; then
    echo "Database holder blocks rollback" >&2; false
  fi
done

# Restore the paired code and DB without any network package installation.
rsync -a --delete \
  --exclude='.env' --exclude='.venv' --exclude='.venv-current' --exclude='static' \
  --exclude='*.db' --exclude='*.sqlite' --exclude='*.pem' --exclude='*.key' \
  "$PREVIOUS_ARTIFACT_DIR/backend/" "$APP_ROOT/backend/"
rsync -a --delete "$PREVIOUS_ARTIFACT_DIR/frontend-dist/" "$APP_ROOT/frontend/dist/"
install -m 644 -o root -g root "$PREVIOUS_ARTIFACT_DIR/neovista-api.previous" "$SYSTEMD_TARGET"

venv_next="${VENV_LINK}.next.$$"
ln -s "$PREVIOUS_VENV_TARGET" "$venv_next"
mv -Tf "$venv_next" "$VENV_LINK"
[[ "$(readlink -f -- "$VENV_LINK")" == "$(realpath -- "$PREVIOUS_VENV_TARGET")" ]]

restore_tmp="$(dirname "$DB_PATH")/.neovista-restore-$$.db"
sqlite3 -bail "$RELEASE_BACKUP_REAL/$CANONICAL_DATABASE_FILE" ".backup '$restore_tmp'"
[[ "$(sqlite3 -bail "$restore_tmp" 'PRAGMA integrity_check;')" == "ok" ]]
[[ -z "$(sqlite3 -bail "$restore_tmp" 'PRAGMA foreign_key_check;')" ]]
rm -f -- "$DB_PATH-wal" "$DB_PATH-shm"
chown ecs-user:ecs-user "$restore_tmp"
chmod 600 "$restore_tmp"
sync -f "$restore_tmp"
mv -Tf "$restore_tmp" "$DB_PATH"
sync -f "$(dirname -- "$DB_PATH")"
set_feature_flags_false

# Never restore/start the old public vhost here: old code may ignore modern
# feature flags and the old static rule may expose references. Keep only a 503
# hard-maintenance edge; the restored API remains stopped for offline diagnosis.
install_nginx_config_atomic "$RELEASE_BACKUP_REAL/maintenance-nginx.conf"
rm -f /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/neovista.conf
nginx -t
systemctl daemon-reload
systemctl start nginx
! systemctl is-active --quiet "$SERVICE"
[[ "$(curl -sS -o /dev/null -w '%{http_code}' https://neovista.cn/)" == "503" ]]
[[ "$(curl -sS -o /dev/null -w '%{http_code}' https://neovista.cn/api/health)" == "503" ]]
[[ "$(curl -sS -o /dev/null -w '%{http_code}' https://neovista.cn/static/seedance_references/rollback-blocked.jpg)" == "503" ]]

trap - ERR INT TERM
echo "PASS: paired code/DB/venv restored; API stopped; public edge remains hard-maintenance"
