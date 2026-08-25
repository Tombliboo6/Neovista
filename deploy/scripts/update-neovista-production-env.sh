#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ "${1:-}" != "--execute" || "${NEOVISTA_ENV_UPDATE_CONFIRMED:-}" != "YES" ]]; then
  cat >&2 <<'EOF'
Refusing production environment update.
This script only updates the reviewed non-secret NeoVista production settings.
EOF
  exit 2
fi
if (( EUID != 0 )); then
  echo "Production environment update must run as root" >&2
  exit 2
fi

ENV_FILE="${NEOVISTA_ENV_FILE:-/var/www/neovista/backend/.env}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/neovista/releases/environment}"
RELEASE_CODE_REF="${RELEASE_CODE_REF:?Set RELEASE_CODE_REF to the immutable release ID}"

for tool in awk date grep install mktemp stat; do
  command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done
[[ "$RELEASE_CODE_REF" =~ ^[A-Za-z0-9._:-]{7,128}$ ]]
[[ -f "$ENV_FILE" && ! -L "$ENV_FILE" ]]
[[ "$(stat -c '%U:%G:%a' "$ENV_FILE")" == "ecs-user:ecs-user:600" ]]

install -d -m 700 -o root -g root "$BACKUP_ROOT"
backup="$BACKUP_ROOT/${RELEASE_CODE_REF}-$(date -u +%Y%m%dT%H%M%SZ).env"
install -m 600 -o root -g root "$ENV_FILE" "$backup"

next="$(mktemp "${ENV_FILE}.next.XXXXXX")"
cleanup() {
  rm -f -- "${next:-}"
}
trap cleanup EXIT

# Deliberately allowlisted and fully non-secret. API keys, relay Base URLs,
# JWT and administrator secrets are copied through byte-for-byte and never
# printed. Channel 3's provider model is the reviewed Nano Banana Pro route.
awk '
  BEGIN {
    count = 0
    keys[++count] = "NEOVISTA_ENV"; values[count] = "production"
    keys[++count] = "DATABASE_SCHEMA_AUTO_CREATE_ENABLED"; values[count] = "false"
    keys[++count] = "DATABASE_URL"; values[count] = "sqlite:////var/lib/neovista/neovista.db"
    keys[++count] = "PUBLIC_BASE_URL"; values[count] = "https://neovista.cn"
    keys[++count] = "CORS_ALLOW_ORIGINS"; values[count] = "https://neovista.cn,https://www.neovista.cn"
    keys[++count] = "IMAGE_GENERATION_FEATURE_ENABLED"; values[count] = "false"
    keys[++count] = "SEEDANCE_FEATURE_ENABLED"; values[count] = "false"
    keys[++count] = "SEEDANCE_RECONCILER_ENABLED"; values[count] = "true"
    keys[++count] = "SEEDANCE_REFERENCE_ALLOWED_HOSTS"; values[count] = "neovista.cn"
    keys[++count] = "SEEDANCE_REFERENCE_GC_ENABLED"; values[count] = "true"
    keys[++count] = "SEEDANCE_REFERENCE_TTL_SECONDS"; values[count] = "86400"
    keys[++count] = "ADMIN_TEMPLATE_MUTATIONS_ENABLED"; values[count] = "false"
    keys[++count] = "API_CHANNEL_1_PRODUCT_MODEL"; values[count] = "nano-banana-2"
    keys[++count] = "API_CHANNEL_2_PRODUCT_MODEL"; values[count] = "nano-banana-2"
    keys[++count] = "API_CHANNEL_3_PRODUCT_MODEL"; values[count] = "nano-banana-pro"
    keys[++count] = "API_CHANNEL_3_MODEL"; values[count] = "nano-banana-pro"
    keys[++count] = "API_CHANNEL_4_PRODUCT_MODEL"; values[count] = "gpt-image-2"
    for (i = 1; i <= count; i++) managed[keys[i]] = 1
  }
  {
    key = $0
    sub(/=.*/, "", key)
    if (key in managed) next
    print $0
  }
  END {
    for (i = 1; i <= count; i++) {
      print keys[i] "=" values[i]
    }
  }
' "$ENV_FILE" >"$next"

for key in \
  NEOVISTA_ENV DATABASE_SCHEMA_AUTO_CREATE_ENABLED DATABASE_URL \
  PUBLIC_BASE_URL CORS_ALLOW_ORIGINS IMAGE_GENERATION_FEATURE_ENABLED \
  SEEDANCE_FEATURE_ENABLED SEEDANCE_RECONCILER_ENABLED \
  SEEDANCE_REFERENCE_ALLOWED_HOSTS SEEDANCE_REFERENCE_GC_ENABLED \
  SEEDANCE_REFERENCE_TTL_SECONDS ADMIN_TEMPLATE_MUTATIONS_ENABLED \
  API_CHANNEL_1_PRODUCT_MODEL API_CHANNEL_2_PRODUCT_MODEL \
  API_CHANNEL_3_PRODUCT_MODEL API_CHANNEL_3_MODEL API_CHANNEL_4_PRODUCT_MODEL; do
  [[ "$(grep -Ec "^${key}=" "$next")" == "1" ]]
done

install -m 600 -o ecs-user -g ecs-user "$next" "$ENV_FILE"
trap - EXIT
rm -f -- "$next"
echo "PASS: reviewed non-secret production settings updated; root-only backup: $backup"
