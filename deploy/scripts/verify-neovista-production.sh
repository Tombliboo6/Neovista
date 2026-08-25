#!/usr/bin/env bash
set -Eeuo pipefail

BASE_URL="${BASE_URL:-https://neovista.cn}"
API_BASE_URL="${API_BASE_URL:-https://api.neovista.cn}"
DB_PATH="${DATABASE_PATH:-/var/lib/neovista/neovista.db}"
NGINX_ENABLED="${NGINX_ENABLED_PATH:-/etc/nginx/sites-enabled/neovista}"
NGINX_AVAILABLE="${NGINX_AVAILABLE_PATH:-/etc/nginx/sites-available/neovista}"
NGINX_PRODUCTION_SOURCE="${NGINX_PRODUCTION_SOURCE:-/var/www/neovista/deploy/nginx/neovista-cn.conf}"
SERVICE="${NEOVISTA_SERVICE:-neovista-api.service}"
ENV_FILE="${NEOVISTA_ENV_FILE:-/var/www/neovista/backend/.env}"
EXPECTED_IMAGE_FEATURE="${EXPECTED_IMAGE_FEATURE:-}"
EXPECTED_SEEDANCE_FEATURE="${EXPECTED_SEEDANCE_FEATURE:-}"

for tool in cmp curl grep jq nginx readlink sed sqlite3 stat systemctl tr; do
  command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done

[[ "$(readlink -f "$NGINX_ENABLED")" == "$NGINX_AVAILABLE" ]]
[[ -f "$NGINX_PRODUCTION_SOURCE" ]]
cmp -s "$NGINX_PRODUCTION_SOURCE" "$NGINX_AVAILABLE"
! grep -Rqs --include='*' 'neotest\.site' "$NGINX_ENABLED"
nginx -t
systemctl is-active --quiet nginx
systemctl is-active --quiet "$SERVICE"
systemctl is-enabled --quiet neovista-seedance-reference-cleanup.timer
systemctl is-active --quiet neovista-seedance-reference-cleanup.timer
[[ "$(systemctl show -p User --value "$SERVICE")" == "ecs-user" ]]
grep -Fq '/var/www/neovista/backend/.venv-current/bin/python -m uvicorn' \
  /etc/systemd/system/neovista-api.service
grep -Fq 'Environment="NEOVISTA_ENV=production"' /etc/systemd/system/neovista-api.service
grep -Fq 'Environment="DATABASE_SCHEMA_AUTO_CREATE_ENABLED=false"' \
  /etc/systemd/system/neovista-api.service
[[ -x "$(readlink -f /var/www/neovista/backend/.venv-current)/bin/python" ]]
[[ "$(stat -c '%a' "$ENV_FILE")" == "600" ]]
[[ "$(stat -c '%a' "$DB_PATH")" == "600" ]]

env_value() {
  key="$1"
  count="$(grep -Ec "^${key}=" "$ENV_FILE" || true)"
  [[ "$count" == "1" ]] || return 1
  sed -n "s/^${key}=//p" "$ENV_FILE"
}
require_env_equals() {
  key="$1"
  expected="$2"
  value="$(env_value "$key")" || {
    echo "Required production environment key is missing or duplicated: $key" >&2
    exit 1
  }
  [[ "$value" == "$expected" ]] || {
    echo "Required production environment key has an invalid value: $key" >&2
    exit 1
  }
}
require_strong_secret() {
  key="$1"
  value="$(env_value "$key")" || return 1
  [[ ${#value} -ge 32 ]] || return 1
  lowered="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
  [[ ! "$lowered" =~ (changeme|change-me|placeholder|replace-me|example|default|insecure|test-secret|your-secret) ]] \
    || return 1
}
require_env_equals NEOVISTA_ENV production
require_env_equals DATABASE_SCHEMA_AUTO_CREATE_ENABLED false
require_env_equals DATABASE_URL sqlite:////var/lib/neovista/neovista.db
require_env_equals PUBLIC_BASE_URL https://neovista.cn
require_strong_secret JWT_SECRET_KEY || { echo "JWT_SECRET_KEY fails production strength policy" >&2; exit 1; }
require_strong_secret ADMIN_SECRET_KEY || { echo "ADMIN_SECRET_KEY fails production strength policy" >&2; exit 1; }
jwt_secret="$(env_value JWT_SECRET_KEY)" || exit 1
admin_secret="$(env_value ADMIN_SECRET_KEY)" || exit 1
[[ "$jwt_secret" != "$admin_secret" ]] || { echo "JWT and admin secrets must be distinct" >&2; exit 1; }
unset jwt_secret admin_secret
image_feature_enabled="$(env_value IMAGE_GENERATION_FEATURE_ENABLED)" || {
  echo "IMAGE_GENERATION_FEATURE_ENABLED is missing or duplicated" >&2; exit 1;
}
[[ "$image_feature_enabled" == "true" || "$image_feature_enabled" == "false" ]] \
  || { echo "IMAGE_GENERATION_FEATURE_ENABLED is not boolean" >&2; exit 1; }
require_env_equals SEEDANCE_RECONCILER_ENABLED true
require_env_equals SEEDANCE_REFERENCE_ALLOWED_HOSTS neovista.cn
require_env_equals SEEDANCE_REFERENCE_GC_ENABLED true
require_env_equals SEEDANCE_REFERENCE_TTL_SECONDS 86400
feature_enabled="$(env_value SEEDANCE_FEATURE_ENABLED)" || {
  echo "SEEDANCE_FEATURE_ENABLED is missing or duplicated" >&2; exit 1;
}
[[ "$feature_enabled" == "true" || "$feature_enabled" == "false" ]] \
  || { echo "SEEDANCE_FEATURE_ENABLED is not boolean" >&2; exit 1; }
cors_origins="$(env_value CORS_ALLOW_ORIGINS)" || {
  echo "CORS_ALLOW_ORIGINS is missing or duplicated" >&2; exit 1;
}
[[ "$cors_origins" == "https://neovista.cn" || \
   "$cors_origins" == "https://neovista.cn,https://www.neovista.cn" || \
   "$cors_origins" == "https://www.neovista.cn,https://neovista.cn" ]] \
  || { echo "CORS_ALLOW_ORIGINS has an invalid production value" >&2; exit 1; }
if [[ -n "$EXPECTED_SEEDANCE_FEATURE" ]]; then
  [[ "$EXPECTED_SEEDANCE_FEATURE" == "true" || "$EXPECTED_SEEDANCE_FEATURE" == "false" ]] \
    || { echo "EXPECTED_SEEDANCE_FEATURE is not boolean" >&2; exit 1; }
  [[ "$feature_enabled" == "$EXPECTED_SEEDANCE_FEATURE" ]] \
    || { echo "Seedance feature state does not match expectation" >&2; exit 1; }
fi
if [[ -n "$EXPECTED_IMAGE_FEATURE" ]]; then
  [[ "$EXPECTED_IMAGE_FEATURE" == "true" || "$EXPECTED_IMAGE_FEATURE" == "false" ]] \
    || { echo "EXPECTED_IMAGE_FEATURE is not boolean" >&2; exit 1; }
  [[ "$image_feature_enabled" == "$EXPECTED_IMAGE_FEATURE" ]] \
    || { echo "Image feature state does not match expectation" >&2; exit 1; }
fi
[[ "$(sqlite3 -bail "$DB_PATH" 'PRAGMA integrity_check;')" == "ok" ]] \
  || { echo "Database integrity_check failed" >&2; exit 1; }
[[ -z "$(sqlite3 -bail "$DB_PATH" 'PRAGMA foreign_key_check;')" ]] \
  || { echo "Database foreign_key_check failed" >&2; exit 1; }

for index_name in \
  uq_credit_transactions_settlement_key \
  ix_chat_sessions_user_id \
  uq_video_generation_tasks_user_request \
  uq_video_generation_tasks_provider_task_id \
  uq_video_generation_tasks_hold_transaction_id \
  uq_video_generation_tasks_user_unresolved \
  uq_image_generation_tasks_user_request \
  uq_image_generation_tasks_hold_transaction_id; do
  [[ "$(sqlite3 -bail "$DB_PATH" "SELECT count(*) FROM sqlite_master WHERE type='index' AND name='$index_name';")" == "1" ]] \
    || { echo "Required database index is missing: $index_name" >&2; exit 1; }
done

curl -fsS "$BASE_URL/api/health" | jq -e '.status == "ok"' >/dev/null
curl -fsS "$BASE_URL/api/ready" \
  | jq -e '.status == "ready" and ([.checks[]] | all)' >/dev/null

image_capabilities="$(curl -fsS "$BASE_URL/api/v1/image/capabilities")"
if [[ "$image_feature_enabled" == "true" ]]; then
  jq -e '
    .enabled == true and
    .max_num_images == 1 and
    ([.models[].id] | sort) == ["gpt-image-2","nano-banana-2","nano-banana-pro"] and
    all(.models[]; ((.provider_model // "") | length) > 0)
  ' <<<"$image_capabilities" >/dev/null
else
  jq -e '.enabled == false' <<<"$image_capabilities" >/dev/null
fi

video_capabilities="$(curl -fsS "$BASE_URL/api/v1/video/capabilities")"
if [[ "$EXPECTED_SEEDANCE_FEATURE" == "true" ]]; then
  jq -e '
    .enabled == true and ((.model // "") | length) > 0 and
    ((.resolution_credits_per_second | keys | sort) == ["1080p","4k","720p"]) and
    .resolution_credits_per_second["720p"] == 250 and
    .resolution_credits_per_second["1080p"] == 300 and
    .resolution_credits_per_second["4k"] == 600
  ' <<<"$video_capabilities" >/dev/null
elif [[ "$EXPECTED_SEEDANCE_FEATURE" == "false" ]]; then
  jq -e '.enabled == false' <<<"$video_capabilities" >/dev/null
fi

headers="$(curl -fsSI "$BASE_URL/assets/definitely-missing-release-check.js" || true)"
grep -Eq '^HTTP/[^ ]+ 404([[:space:]]|$)' <<<"$headers"

reference_path="/static/seedance_references/release-check-must-not-exist.jpg"
for method in GET HEAD; do
  if [[ "$method" == "HEAD" ]]; then
    root_reference_headers="$(curl -sSI "$BASE_URL$reference_path" || true)"
  else
    root_reference_headers="$(curl -sS -D - -o /dev/null "$BASE_URL$reference_path" || true)"
  fi
  grep -Eq '^HTTP/[^ ]+ 404([[:space:]]|$)' <<<"$root_reference_headers"
  grep -Eqi '^cache-control:.*no-store' <<<"$root_reference_headers"
  grep -Eqi '^x-robots-tag:.*noindex' <<<"$root_reference_headers"
done
root_reference_post="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE_URL$reference_path" || true)"
[[ "$root_reference_post" == "403" || "$root_reference_post" == "405" ]]

for method in GET HEAD; do
  if [[ "$method" == "HEAD" ]]; then
    api_reference_headers="$(curl -sSI "$API_BASE_URL$reference_path" || true)"
  else
    api_reference_headers="$(curl -sS -D - -o /dev/null "$API_BASE_URL$reference_path" || true)"
  fi
  grep -Eq '^HTTP/[^ ]+ 404([[:space:]]|$)' <<<"$api_reference_headers"
  grep -Eqi '^cache-control:.*no-store' <<<"$api_reference_headers"
  grep -Eqi '^x-robots-tag:.*noindex' <<<"$api_reference_headers"
done

echo "PASS: $BASE_URL production gates are ready"
