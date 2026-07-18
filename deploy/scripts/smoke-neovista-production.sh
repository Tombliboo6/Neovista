#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ "${1:-}" != "--execute" || "${NEOVISTA_PAID_SMOKE_CONFIRMED:-}" != "YES" ]]; then
  cat >&2 <<'EOF'
Refusing paid smoke test. This workflow permits exactly 1280 net credits:
  30 credits: one Nano Banana 2 1K image
  1250 credits: one Seedance 2.0 5-second 720p first-frame video

Only a conclusively rejected, provider-unaccepted video with one complete
refund may use the deterministic -a2 attempt under the same SMOKE_RUN_ID.

Run only after the production runbook's zero-cost gates pass:
  sudo env NEOVISTA_PAID_SMOKE_CONFIRMED=YES SMOKE_RUN_ID=<immutable-release-id> \
    ./deploy/scripts/smoke-neovista-production.sh --execute
EOF
  exit 2
fi
if (( EUID != 0 )); then
  echo "The paid smoke transaction must run as root (use sudo)" >&2
  exit 2
fi

SMOKE_RUN_ID="${SMOKE_RUN_ID:?Set SMOKE_RUN_ID to the immutable tested release ID}"
[[ "$SMOKE_RUN_ID" =~ ^[A-Za-z0-9._:-]{7,128}$ ]] || {
  echo "SMOKE_RUN_ID has an unsafe format" >&2; exit 2;
}

APP_ROOT="${APP_ROOT:-/var/www/neovista}"
DB_PATH="${DATABASE_PATH:-/var/lib/neovista/neovista.db}"
ENV_FILE="${NEOVISTA_ENV_FILE:-$APP_ROOT/backend/.env}"
STATE_ROOT="${SMOKE_STATE_ROOT:-/var/backups/neovista/smoke}"
NGINX_AVAILABLE="${NGINX_AVAILABLE_PATH:-/etc/nginx/sites-available/neovista}"
NGINX_ENABLED="${NGINX_ENABLED_PATH:-/etc/nginx/sites-enabled/neovista}"
SMOKE_NGINX_SOURCE="$APP_ROOT/deploy/nginx/neovista-cn-smoke-reference.conf"
MAINTENANCE_NGINX_SOURCE="$APP_ROOT/deploy/nginx/neovista-cn-maintenance.conf"
PRODUCTION_NGINX_SOURCE="$APP_ROOT/deploy/nginx/neovista-cn.conf"
CLEANUP_SCRIPT="$APP_ROOT/deploy/scripts/cleanup-seedance-references.sh"
VERIFY_SCRIPT="$APP_ROOT/deploy/scripts/verify-neovista-production.sh"
STATE_GUARDS="$APP_ROOT/deploy/scripts/smoke-state-guards.sh"
SERVICE="${NEOVISTA_SERVICE:-neovista-api.service}"
LOCAL_BASE_URL="http://127.0.0.1:8000"

for tool in basename cmp curl cut file flock grep install jq nginx python3 \
  readlink sed sha256sum sqlite3 stat systemctl tr; do
  command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done
[[ -f "$DB_PATH" && ! -L "$DB_PATH" ]]
[[ -f "$ENV_FILE" ]]
[[ -f "$SMOKE_NGINX_SOURCE" && -f "$MAINTENANCE_NGINX_SOURCE" && -f "$PRODUCTION_NGINX_SOURCE" ]]
[[ -x "$CLEANUP_SCRIPT" && -x "$VERIFY_SCRIPT" && -r "$STATE_GUARDS" ]]
# shellcheck source=smoke-state-guards.sh
source "$STATE_GUARDS"

env_value() {
  local key="$1" count
  count="$(grep -Ec "^${key}=" "$ENV_FILE" || true)"
  [[ "$count" == "1" ]] || return 1
  sed -n "s/^${key}=//p" "$ENV_FILE"
}
require_env_equals() {
  local key="$1" expected="$2" value
  value="$(env_value "$key")" || {
    echo "Required smoke environment key is missing or duplicated: $key" >&2
    exit 1
  }
  [[ "$value" == "$expected" ]] || {
    echo "Required smoke environment key has an invalid value: $key" >&2
    exit 1
  }
}
[[ "$(stat -c '%a' "$ENV_FILE")" == "600" ]] || { echo "Environment file mode must be 600" >&2; exit 1; }
require_env_equals NEOVISTA_ENV production
require_env_equals DATABASE_SCHEMA_AUTO_CREATE_ENABLED false
require_env_equals PUBLIC_BASE_URL https://neovista.cn
require_env_equals IMAGE_GENERATION_FEATURE_ENABLED true
require_env_equals SEEDANCE_FEATURE_ENABLED true
require_env_equals SEEDANCE_RECONCILER_ENABLED true
require_env_equals SEEDANCE_REFERENCE_ALLOWED_HOSTS neovista.cn

set_feature_flags() {
  local value="$1"
  [[ "$value" == "true" || "$value" == "false" ]]
  NEOVISTA_ENV_FILE="$ENV_FILE" NEOVISTA_FEATURE_VALUE="$value" python3 - <<'PY'
import os
import stat
from pathlib import Path

path = Path(os.environ["NEOVISTA_ENV_FILE"])
value = os.environ["NEOVISTA_FEATURE_VALUE"]
metadata = path.stat()
lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
targets = {"IMAGE_GENERATION_FEATURE_ENABLED", "SEEDANCE_FEATURE_ENABLED"}
seen = {key: 0 for key in targets}
updated = []
for line in lines:
    replaced = False
    for key in targets:
        if line.startswith(f"{key}="):
            seen[key] += 1
            updated.append(f"{key}={value}\n")
            replaced = True
            break
    if not replaced:
        updated.append(line)
if any(count != 1 for count in seen.values()):
    raise SystemExit("feature flag keys must each appear exactly once")
temporary = path.with_name(f".{path.name}.smoke-{os.getpid()}")
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

install_nginx_config_atomic() {
  local source="$1" next="${NGINX_AVAILABLE}.next.$$"
  install -m 644 -o root -g root "$source" "$next"
  mv -Tf "$next" "$NGINX_AVAILABLE"
  ln -sfn "$NGINX_AVAILABLE" "$NGINX_ENABLED"
}

install -d -m 700 -o root -g root "$STATE_ROOT"
exec 9>"$STATE_ROOT/.smoke.lock"
flock -n 9 || { echo "Another paid smoke transaction is active" >&2; exit 1; }

run_hash="$(printf '%s' "$SMOKE_RUN_ID" | sha256sum | cut -c1-24)"
expected_image_request_id="prod-image-smoke-$run_hash"
expected_video_request_id="prod-video-smoke-$run_hash"
expected_video_retry_request_id="${expected_video_request_id}-a2"
state_dir="$STATE_ROOT/$SMOKE_RUN_ID"
state_file="$state_dir/state.env"
install -d -m 700 -o root -g root "$state_dir"

if [[ ! -e "$state_file" ]]; then
  state_tmp="$(mktemp)"
  printf 'FORMAT_VERSION=1\nSMOKE_RUN_ID=%s\nIMAGE_REQUEST_ID=%s\nVIDEO_REQUEST_ID=%s\n' \
    "$SMOKE_RUN_ID" "$expected_image_request_id" "$expected_video_request_id" >"$state_tmp"
  install -m 600 -o root -g root "$state_tmp" "$state_file"
  rm -f -- "$state_tmp"
fi
[[ -f "$state_file" && ! -L "$state_file" ]]
[[ "$(stat -c '%U:%G:%a' "$state_file")" == "root:root:600" ]]

state_value() {
  local key="$1" count
  count="$(grep -Ec "^${key}=" "$state_file" || true)"
  [[ "$count" == "1" ]] || return 1
  sed -n "s/^${key}=//p" "$state_file"
}
format_version="$(state_value FORMAT_VERSION)" || { echo "Invalid persistent smoke state" >&2; exit 1; }
persisted_run_id="$(state_value SMOKE_RUN_ID)" || { echo "Invalid persistent smoke state" >&2; exit 1; }
IMAGE_REQUEST_ID="$(state_value IMAGE_REQUEST_ID)" || { echo "Invalid persistent image request ID state" >&2; exit 1; }
VIDEO_REQUEST_ID="$(state_value VIDEO_REQUEST_ID)" || { echo "Invalid persistent video request ID state" >&2; exit 1; }
[[ "$format_version" == "1" && "$persisted_run_id" == "$SMOKE_RUN_ID" ]] \
  || { echo "Persistent smoke state does not match this run" >&2; exit 1; }
[[ "$IMAGE_REQUEST_ID" == "$expected_image_request_id" ]] \
  || { echo "Persistent image request ID mismatch" >&2; exit 1; }
[[ "$VIDEO_REQUEST_ID" == "$expected_video_request_id" ]] \
  || { echo "Persistent video request ID mismatch" >&2; exit 1; }

AUTH_FILE="$(mktemp)"
touch "$AUTH_FILE"
chmod 600 "$AUTH_FILE"

cleanup_auth() {
  rm -f -- "${AUTH_FILE:-}"
}
fail_smoke() {
  local code="${1:-1}"
  trap - ERR INT TERM
  systemctl stop "$SERVICE" nginx >/dev/null 2>&1 || true
  set_feature_flags false || true
  if install_nginx_config_atomic "$MAINTENANCE_NGINX_SOURCE" && nginx -t; then
    systemctl start nginx || true
  fi
  cleanup_auth
  cat >&2 <<EOF
PAID SMOKE STOPPED (status=$code). Stable IDs and responses remain root-only at:
  $state_dir
Do not choose a new SMOKE_RUN_ID or issue a new paid call. Resolve/reconcile the
persisted IMAGE_REQUEST_ID/VIDEO_REQUEST_ID, then rerun this exact smoke ID.
If a provider rejected the first video before accepting it, this script alone
may use its deterministic, persisted -a2 attempt; never choose an -a3 manually.
EOF
  exit "$code"
}
trap cleanup_auth EXIT
trap 'fail_smoke $?' ERR
trap 'fail_smoke 130' INT
trap 'fail_smoke 143' TERM

read -rsp '测试账户 JWT（不会持久化）: ' TEST_JWT; echo
printf 'Authorization: Bearer %s\n' "$TEST_JWT" >"$AUTH_FILE"
unset TEST_JWT

# Migration must have left the production edge stopped. The API is local-only.
! systemctl is-active --quiet nginx
systemctl is-active --quiet "$SERVICE"
for _ in $(seq 1 90); do
  curl -fsS "$LOCAL_BASE_URL/api/ready" \
    | jq -e '.status == "ready" and ([.checks[]] | all)' >/dev/null && break
  sleep 2
done
curl -fsS "$LOCAL_BASE_URL/api/ready" \
  | jq -e '.status == "ready" and ([.checks[]] | all)' >/dev/null

ME_FILE="$state_dir/account-current.json"
curl -fsS "$LOCAL_BASE_URL/api/v1/auth/me" --header @"$AUTH_FILE" \
  | jq '{id,credits,is_admin}' >"$ME_FILE.tmp"
install -m 600 -o root -g root "$ME_FILE.tmp" "$ME_FILE"
rm -f -- "$ME_FILE.tmp"
TEST_USER_ID="$(jq -er '.id | select(type == "number" and . > 0)' "$ME_FILE")"
CURRENT_CREDITS="$(jq -er '.credits | select(type == "number" and . >= 0)' "$ME_FILE")"
account_file="$state_dir/account.env"
if [[ ! -e "$account_file" ]]; then
  printf 'USER_ID=%s\nSTARTING_CREDITS=%s\n' "$TEST_USER_ID" "$CURRENT_CREDITS" >"$account_file.tmp"
  install -m 600 -o root -g root "$account_file.tmp" "$account_file"
  rm -f -- "$account_file.tmp"
fi
[[ "$(sed -n 's/^USER_ID=//p' "$account_file")" == "$TEST_USER_ID" ]]

# No unrelated unresolved task may coexist on this dedicated smoke account.
unrelated_video="$(sqlite3 -bail "$DB_PATH" \
  "SELECT count(*) FROM video_generation_tasks WHERE user_id=$TEST_USER_ID AND request_id NOT IN ('$VIDEO_REQUEST_ID','$expected_video_retry_request_id') AND (lower(status) IN ('ready','creating','submitting','submit_unknown','submitted','running','finalizing','queued','pending','created','processing','reconciliation_required') OR settlement_status='REVIEW_REQUIRED');")"
unrelated_image="$(sqlite3 -bail "$DB_PATH" \
  "SELECT count(*) FROM image_generation_tasks WHERE user_id=$TEST_USER_ID AND request_id<>'$IMAGE_REQUEST_ID' AND (lower(status) IN ('ready','submitting','submit_unknown','reconciliation_required') OR settlement_status='REVIEW_REQUIRED');")"
[[ "$unrelated_video" == "0" && "$unrelated_image" == "0" ]]

IMAGE_BODY_FILE="$state_dir/image-request.json"
if [[ ! -e "$IMAGE_BODY_FILE" ]]; then
  jq -nc --arg request_id "$IMAGE_REQUEST_ID" \
    '{request_id:$request_id,user_params:"生产链路烟测：简洁白底建筑体块分析图，无文字",resolution:"1K",aspect_ratio:"1:1",num_images:1,selected_model:"nano-banana-2"}' \
    >"$IMAGE_BODY_FILE.tmp"
  install -m 600 -o root -g root "$IMAGE_BODY_FILE.tmp" "$IMAGE_BODY_FILE"
  rm -f -- "$IMAGE_BODY_FILE.tmp"
fi
IMAGE_RESPONSE_FILE="$state_dir/image-response.json"
IMAGE_REPLAY_FILE="$state_dir/image-replay.json"

image_task_row="$(sqlite3 -bail -separator '|' "$DB_PATH" \
  "SELECT user_id,status,settlement_status FROM image_generation_tasks WHERE request_id='$IMAGE_REQUEST_ID';")"
image_task_count="$(sqlite3 -bail "$DB_PATH" \
  "SELECT count(*) FROM image_generation_tasks WHERE request_id='$IMAGE_REQUEST_ID';")"
image_txn_count="$(sqlite3 -bail "$DB_PATH" \
  "SELECT count(*) FROM credit_transactions WHERE related_request_id='$IMAGE_REQUEST_ID';")"
image_event_count="$(sqlite3 -bail "$DB_PATH" \
  "SELECT count(*) FROM generation_events WHERE request_id='$IMAGE_REQUEST_ID';")"
if [[ "$image_task_count" == "0" ]]; then
  [[ "$image_txn_count" == "0" && "$image_event_count" == "0" ]]
  (( CURRENT_CREDITS >= 1280 ))
elif [[ "$image_task_count" == "1" ]]; then
  IFS='|' read -r owner status settlement <<<"$image_task_row"
  [[ "$owner" == "$TEST_USER_ID" ]]
  [[ "$status" == "succeeded" && "$settlement" == "CAPTURED" ]] || {
    echo "Persisted image smoke is not safely replayable: status=$status settlement=$settlement" >&2
    false
  }
else
  echo "Duplicate image smoke request ID detected" >&2; false
fi

# First call or persisted replay: the same ID and immutable payload are always
# used. A network interruption can never cause this script to mint a new ID.
curl -fsS "$LOCAL_BASE_URL/api/v1/generate" \
  --header @"$AUTH_FILE" -H 'Content-Type: application/json' \
  --data-binary @"$IMAGE_BODY_FILE" >"$IMAGE_RESPONSE_FILE.tmp"
install -m 600 -o root -g root "$IMAGE_RESPONSE_FILE.tmp" "$IMAGE_RESPONSE_FILE"
rm -f -- "$IMAGE_RESPONSE_FILE.tmp"
jq -e --arg request_id "$IMAGE_REQUEST_ID" \
  '.request_id == $request_id and .charged_credits == 30 and (.image_url|length>0)' \
  "$IMAGE_RESPONSE_FILE" >/dev/null

IMAGE_TXNS_BEFORE="$(sqlite3 -bail "$DB_PATH" \
  "SELECT count(*) FROM credit_transactions WHERE related_request_id='$IMAGE_REQUEST_ID' AND type IN ('GENERATE_HOLD','GENERATE_CAPTURE');")"
IMAGE_TASKS_BEFORE="$(sqlite3 -bail "$DB_PATH" \
  "SELECT count(*) FROM image_generation_tasks WHERE request_id='$IMAGE_REQUEST_ID';")"
[[ "$IMAGE_TXNS_BEFORE" == "2" && "$IMAGE_TASKS_BEFORE" == "1" ]]
curl -fsS "$LOCAL_BASE_URL/api/v1/generate" \
  --header @"$AUTH_FILE" -H 'Content-Type: application/json' \
  --data-binary @"$IMAGE_BODY_FILE" >"$IMAGE_REPLAY_FILE.tmp"
install -m 600 -o root -g root "$IMAGE_REPLAY_FILE.tmp" "$IMAGE_REPLAY_FILE"
rm -f -- "$IMAGE_REPLAY_FILE.tmp"
cmp -s <(jq -c '{request_id,image_url,charged_credits,remaining_credits}' "$IMAGE_RESPONSE_FILE") \
  <(jq -c '{request_id,image_url,charged_credits,remaining_credits}' "$IMAGE_REPLAY_FILE")
[[ "$(sqlite3 -bail "$DB_PATH" "SELECT count(*) FROM credit_transactions WHERE related_request_id='$IMAGE_REQUEST_ID' AND type IN ('GENERATE_HOLD','GENERATE_CAPTURE');")" == "$IMAGE_TXNS_BEFORE" ]]
[[ "$(sqlite3 -bail "$DB_PATH" "SELECT count(*) FROM image_generation_tasks WHERE request_id='$IMAGE_REQUEST_ID';")" == "$IMAGE_TASKS_BEFORE" ]]

VIDEO_BODY_FILE="$state_dir/video-request.json"
if [[ ! -e "$VIDEO_BODY_FILE" ]]; then
  jq -nc --slurpfile image "$IMAGE_RESPONSE_FILE" --arg request_id "$VIDEO_REQUEST_ID" \
    '{request_id:$request_id,prompt:"生产链路烟测：日光下建筑体块的缓慢稳定推进镜头",image_data:$image[0].image_url,duration_seconds:5,resolution:"720p",aspect_ratio:"16:9",video_mode:"first_frame",selected_model:"seedance-2.0"}' \
    >"$VIDEO_BODY_FILE.tmp"
  install -m 600 -o root -g root "$VIDEO_BODY_FILE.tmp" "$VIDEO_BODY_FILE"
  rm -f -- "$VIDEO_BODY_FILE.tmp"
fi
VIDEO_CREATE_FILE="$state_dir/video-create.json"
VIDEO_RESPONSE_FILE="$state_dir/video-response.json"
VIDEO_REPLAY_FILE="$state_dir/video-replay.json"
ORIGINAL_VIDEO_REQUEST_ID="$VIDEO_REQUEST_ID"
PRIOR_REFUNDED_VIDEO_REQUEST_ID=""
VIDEO_ATTEMPT_SUFFIX=""

video_task_row="$(sqlite3 -bail -separator '|' "$DB_PATH" \
  "SELECT user_id,task_id,status,settlement_status,provider_task_id IS NULL,video_url IS NULL FROM video_generation_tasks WHERE request_id='$VIDEO_REQUEST_ID';")"
video_task_count="$(sqlite3 -bail "$DB_PATH" \
  "SELECT count(*) FROM video_generation_tasks WHERE request_id='$VIDEO_REQUEST_ID';")"
video_txn_count="$(sqlite3 -bail "$DB_PATH" \
  "SELECT count(*) FROM credit_transactions WHERE related_request_id='$VIDEO_REQUEST_ID';")"
video_was_terminal="false"
if [[ "$video_task_count" == "0" ]]; then
  [[ "$video_txn_count" == "0" ]]
  remaining_now="$(curl -fsS "$LOCAL_BASE_URL/api/v1/auth/me" --header @"$AUTH_FILE" | jq -er '.credits')"
  (( remaining_now >= 1250 ))
elif [[ "$video_task_count" == "1" ]]; then
  IFS='|' read -r owner persisted_task_id status settlement no_provider_task no_video_result <<<"$video_task_row"
  [[ "$owner" == "$TEST_USER_ID" ]]
  case "$status:$settlement" in
    succeeded:CAPTURED) video_was_terminal="true" ;;
    ready:PENDING|creating:PENDING|submitting:PENDING|submit_unknown:PENDING|submitted:PENDING|running:PENDING|finalizing:PENDING|queued:PENDING|pending:PENDING|created:PENDING|processing:PENDING) ;;
    failed:REFUNDED)
      # A deterministic second attempt is allowed only after a conclusive
      # pre-accept provider rejection.  The first task and its financial
      # history remain immutable; this block never rewrites or deletes them.
      [[ "$no_provider_task" == "1" && "$no_video_result" == "1" ]]
      neovista_require_refunded_video_attempt_eligible \
        "$DB_PATH" "$TEST_USER_ID" "$ORIGINAL_VIDEO_REQUEST_ID"

      retry_state="$state_dir/video-attempt-a2.env"
      retry_payload_hash="$(jq -S -c 'del(.request_id)' "$VIDEO_BODY_FILE" | sha256sum | cut -d' ' -f1)"
      if [[ ! -e "$retry_state" ]]; then
        retry_state_tmp="$(mktemp)"
        printf 'PREVIOUS_REQUEST_ID=%s\nREQUEST_ID=%s\nPAYLOAD_SHA256=%s\nREASON=%s\n' \
          "$ORIGINAL_VIDEO_REQUEST_ID" "$expected_video_retry_request_id" \
          "$retry_payload_hash" "PROVIDER_PREACCEPT_REJECTED_AND_REFUNDED" >"$retry_state_tmp"
        install -m 600 -o root -g root "$retry_state_tmp" "$retry_state"
        rm -f -- "$retry_state_tmp"
      fi
      [[ -f "$retry_state" && ! -L "$retry_state" ]]
      [[ "$(stat -c '%U:%G:%a' "$retry_state")" == "root:root:600" ]]
      grep -qx "PREVIOUS_REQUEST_ID=$ORIGINAL_VIDEO_REQUEST_ID" "$retry_state"
      grep -qx "REQUEST_ID=$expected_video_retry_request_id" "$retry_state"
      grep -qx "PAYLOAD_SHA256=$retry_payload_hash" "$retry_state"
      grep -qx 'REASON=PROVIDER_PREACCEPT_REJECTED_AND_REFUNDED' "$retry_state"

      retry_body_file="$state_dir/video-request-a2.json"
      if [[ ! -e "$retry_body_file" ]]; then
        jq --arg request_id "$expected_video_retry_request_id" \
          '.request_id=$request_id' "$VIDEO_BODY_FILE" >"$retry_body_file.tmp"
        install -m 600 -o root -g root "$retry_body_file.tmp" "$retry_body_file"
        rm -f -- "$retry_body_file.tmp"
      fi
      [[ -f "$retry_body_file" && ! -L "$retry_body_file" ]]
      [[ "$(stat -c '%U:%G:%a' "$retry_body_file")" == "root:root:600" ]]
      [[ "$(jq -er '.request_id' "$retry_body_file")" == "$expected_video_retry_request_id" ]]
      [[ "$(jq -S -c 'del(.request_id)' "$retry_body_file" | sha256sum | cut -d' ' -f1)" == "$retry_payload_hash" ]]

      PRIOR_REFUNDED_VIDEO_REQUEST_ID="$ORIGINAL_VIDEO_REQUEST_ID"
      VIDEO_REQUEST_ID="$expected_video_retry_request_id"
      VIDEO_BODY_FILE="$retry_body_file"
      VIDEO_CREATE_FILE="$state_dir/video-create-a2.json"
      VIDEO_RESPONSE_FILE="$state_dir/video-response-a2.json"
      VIDEO_REPLAY_FILE="$state_dir/video-replay-a2.json"
      VIDEO_ATTEMPT_SUFFIX="-a2"

      video_task_row="$(sqlite3 -bail -separator '|' "$DB_PATH" \
        "SELECT user_id,task_id,status,settlement_status,provider_task_id IS NULL,video_url IS NULL FROM video_generation_tasks WHERE request_id='$VIDEO_REQUEST_ID';")"
      video_task_count="$(sqlite3 -bail "$DB_PATH" \
        "SELECT count(*) FROM video_generation_tasks WHERE request_id='$VIDEO_REQUEST_ID';")"
      video_txn_count="$(sqlite3 -bail "$DB_PATH" \
        "SELECT count(*) FROM credit_transactions WHERE related_request_id='$VIDEO_REQUEST_ID';")"
      video_event_count="$(sqlite3 -bail "$DB_PATH" \
        "SELECT count(*) FROM generation_events WHERE request_id='$VIDEO_REQUEST_ID';")"
      if [[ "$video_task_count" == "0" ]]; then
        [[ "$video_txn_count" == "0" && "$video_event_count" == "0" ]]
        remaining_now="$(curl -fsS "$LOCAL_BASE_URL/api/v1/auth/me" --header @"$AUTH_FILE" | jq -er '.credits')"
        (( remaining_now >= 1250 ))
        persisted_task_id=""
        status=""
        settlement=""
      elif [[ "$video_task_count" == "1" ]]; then
        IFS='|' read -r owner persisted_task_id status settlement no_provider_task no_video_result <<<"$video_task_row"
        [[ "$owner" == "$TEST_USER_ID" ]]
        case "$status:$settlement" in
          succeeded:CAPTURED) video_was_terminal="true" ;;
          ready:PENDING|creating:PENDING|submitting:PENDING|submit_unknown:PENDING|submitted:PENDING|running:PENDING|finalizing:PENDING|queued:PENDING|pending:PENDING|created:PENDING|processing:PENDING) ;;
          *)
            echo "Persisted -a2 video attempt is not safely replayable: status=$status settlement=$settlement" >&2
            false ;;
        esac
      else
        echo "Duplicate -a2 video request ID detected" >&2; false
      fi
      ;;
    *)
      echo "Persisted video smoke requires operator reconciliation: status=$status settlement=$settlement" >&2
      false ;;
  esac
else
  echo "Duplicate video smoke request ID detected" >&2; false
fi

# The provider cannot fetch a local first-frame file while Nginx is stopped.
# Start only the reviewed reference-only maintenance vhost: all pages/APIs stay
# 503, api.neovista.cn references stay 404, and no paid API is public.
install_nginx_config_atomic "$SMOKE_NGINX_SOURCE"
nginx -t
systemctl start nginx
[[ "$(curl -sS -o /dev/null -w '%{http_code}' https://neovista.cn/)" == "503" ]]
[[ "$(curl -sS -o /dev/null -w '%{http_code}' https://neovista.cn/api/health)" == "503" ]]
[[ "$(curl -sS -o /dev/null -w '%{http_code}' https://api.neovista.cn/static/seedance_references/not-public.jpg)" == "404" ]]

if [[ "$video_task_count" == "0" ]]; then
  curl -fsS "$LOCAL_BASE_URL/api/v1/video/generate" \
    --header @"$AUTH_FILE" -H 'Content-Type: application/json' \
    --data-binary @"$VIDEO_BODY_FILE" >"$VIDEO_CREATE_FILE.tmp"
  install -m 600 -o root -g root "$VIDEO_CREATE_FILE.tmp" "$VIDEO_CREATE_FILE"
  rm -f -- "$VIDEO_CREATE_FILE.tmp"
  VIDEO_TASK_ID="$(jq -er '.task_id' "$VIDEO_CREATE_FILE")"
else
  VIDEO_TASK_ID="$persisted_task_id"
  jq -nc --arg task_id "$VIDEO_TASK_ID" --arg request_id "$VIDEO_REQUEST_ID" \
    '{task_id:$task_id,request_id:$request_id,persisted:true}' >"$VIDEO_CREATE_FILE.tmp"
  install -m 600 -o root -g root "$VIDEO_CREATE_FILE.tmp" "$VIDEO_CREATE_FILE"
  rm -f -- "$VIDEO_CREATE_FILE.tmp"
fi

# While the task is active, validate the exact anonymous reference path without
# logging its UUID. Persist the evidence so an interrupted script can safely
# resume a terminal task without issuing another paid request.
reference_prefix="$state_dir/reference$VIDEO_ATTEMPT_SUFFIX"
reference_state="$reference_prefix.env"
if [[ "$video_was_terminal" == "true" ]]; then
  neovista_require_terminal_reference_evidence \
    "$status" "$settlement" "$reference_state" \
    "$reference_prefix-get.headers" "$reference_prefix-head.headers" \
    "$reference_prefix-post.status" || false
fi
if [[ ! -e "$reference_state" ]]; then
  reference_local_path="$(sqlite3 -bail "$DB_PATH" \
    "SELECT CASE WHEN json_valid(reference_paths) THEN json_extract(reference_paths,'$.local_paths[0]') END FROM video_generation_tasks WHERE task_id='$VIDEO_TASK_ID';")"
  [[ -n "$reference_local_path" ]]
  reference_filename="$(basename -- "$reference_local_path")"
  [[ "$reference_filename" =~ ^[0-9a-f]{32}\.(jpg|png|webp)$ ]]
  printf 'LOCAL_PATH=%s\nFILENAME=%s\n' "$reference_local_path" "$reference_filename" >"$reference_state.tmp"
  install -m 600 -o root -g root "$reference_state.tmp" "$reference_state"
  rm -f -- "$reference_state.tmp"
else
  reference_local_path="$(sed -n 's/^LOCAL_PATH=//p' "$reference_state")"
  reference_filename="$(sed -n 's/^FILENAME=//p' "$reference_state")"
  [[ "$reference_local_path" == "static/seedance_references/$reference_filename" ]]
  [[ "$reference_filename" =~ ^[0-9a-f]{32}\.(jpg|png|webp)$ ]]
fi
reference_url="https://neovista.cn/static/seedance_references/$reference_filename"
if [[ -e "$APP_ROOT/backend/$reference_local_path" ]]; then
  for method in GET HEAD; do
    header_file="$reference_prefix-${method,,}.headers"
    if [[ "$method" == "HEAD" ]]; then
      curl -sS -I -D "$header_file.tmp" -o /dev/null "$reference_url"
    else
      curl -sS -D "$header_file.tmp" -o /dev/null "$reference_url"
    fi
    install -m 600 -o root -g root "$header_file.tmp" "$header_file"
    rm -f -- "$header_file.tmp"
  done
  post_code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$reference_url")"
  printf '%s\n' "$post_code" >"$reference_prefix-post.status.tmp"
  install -m 600 -o root -g root "$reference_prefix-post.status.tmp" "$reference_prefix-post.status"
  rm -f -- "$reference_prefix-post.status.tmp"
fi
for method in GET HEAD; do
  header_file="$reference_prefix-${method,,}.headers"
  [[ -f "$header_file" ]]
  grep -Eq '^HTTP/[^ ]+ 200([[:space:]]|$)' "$header_file"
  grep -Eqi '^cache-control:.*no-store' "$header_file"
  grep -Eqi '^x-robots-tag:.*noindex' "$header_file"
done
post_code="$(tr -d '[:space:]' <"$reference_prefix-post.status")"
[[ "$post_code" == "403" || "$post_code" == "405" ]]

for _ in $(seq 1 120); do
  curl -fsS "$LOCAL_BASE_URL/api/v1/video/tasks/$VIDEO_TASK_ID" \
    --header @"$AUTH_FILE" >"$VIDEO_RESPONSE_FILE.tmp"
  install -m 600 -o root -g root "$VIDEO_RESPONSE_FILE.tmp" "$VIDEO_RESPONSE_FILE"
  rm -f -- "$VIDEO_RESPONSE_FILE.tmp"
  status="$(jq -er '.status' "$VIDEO_RESPONSE_FILE")"
  [[ "$status" =~ ^(succeeded|failed|reconciliation_required)$ ]] && break
  sleep 10
done
jq -e '.status == "succeeded" and .settlement_status == "CAPTURED" and (.video_url|length>0)' \
  "$VIDEO_RESPONSE_FILE" >/dev/null

VIDEO_TXNS_BEFORE="$(sqlite3 -bail "$DB_PATH" \
  "SELECT count(*) FROM credit_transactions WHERE related_request_id='$VIDEO_REQUEST_ID' AND type IN ('GENERATE_HOLD','GENERATE_CAPTURE');")"
VIDEO_TASKS_BEFORE="$(sqlite3 -bail "$DB_PATH" \
  "SELECT count(*) FROM video_generation_tasks WHERE request_id='$VIDEO_REQUEST_ID';")"
[[ "$VIDEO_TXNS_BEFORE" == "2" && "$VIDEO_TASKS_BEFORE" == "1" ]]
curl -fsS "$LOCAL_BASE_URL/api/v1/video/generate" \
  --header @"$AUTH_FILE" -H 'Content-Type: application/json' \
  --data-binary @"$VIDEO_BODY_FILE" >"$VIDEO_REPLAY_FILE.tmp"
install -m 600 -o root -g root "$VIDEO_REPLAY_FILE.tmp" "$VIDEO_REPLAY_FILE"
rm -f -- "$VIDEO_REPLAY_FILE.tmp"
[[ "$(jq -er '.task_id' "$VIDEO_REPLAY_FILE")" == "$VIDEO_TASK_ID" ]]
[[ "$(sqlite3 -bail "$DB_PATH" "SELECT count(*) FROM credit_transactions WHERE related_request_id='$VIDEO_REQUEST_ID' AND type IN ('GENERATE_HOLD','GENERATE_CAPTURE');")" == "$VIDEO_TXNS_BEFORE" ]]
[[ "$(sqlite3 -bail "$DB_PATH" "SELECT count(*) FROM video_generation_tasks WHERE request_id='$VIDEO_REQUEST_ID';")" == "$VIDEO_TASKS_BEFORE" ]]

# Both durable ledgers must show one hold and one capture at exactly 30+1250.
IMAGE_LEDGER="$(sqlite3 -bail "$DB_PATH" \
  "SELECT count(*) FROM image_generation_tasks t JOIN credit_transactions h ON h.id=t.hold_transaction_id WHERE t.user_id=$TEST_USER_ID AND t.request_id='$IMAGE_REQUEST_ID' AND t.status='succeeded' AND t.settlement_status='CAPTURED' AND h.type='GENERATE_HOLD' AND h.status='SUCCESS' AND abs(h.amount)=30 AND (SELECT count(*) FROM credit_transactions s WHERE s.settlement_key='generation-hold:' || h.id || ':settlement' AND s.type='GENERATE_CAPTURE' AND s.status='SUCCESS' AND s.amount=0)=1;")"
VIDEO_LEDGER="$(sqlite3 -bail "$DB_PATH" \
  "SELECT count(*) FROM video_generation_tasks v JOIN credit_transactions h ON h.id=v.hold_transaction_id WHERE v.user_id=$TEST_USER_ID AND v.request_id='$VIDEO_REQUEST_ID' AND v.status='succeeded' AND v.settlement_status='CAPTURED' AND h.type='GENERATE_HOLD' AND h.status='SUCCESS' AND abs(h.amount)=1250 AND (SELECT count(*) FROM credit_transactions s WHERE s.settlement_key='generation-hold:' || h.id || ':settlement' AND s.type='GENERATE_CAPTURE' AND s.status='SUCCESS' AND s.amount=0)=1;")"
[[ "$IMAGE_LEDGER" == "1" && "$VIDEO_LEDGER" == "1" ]]
if [[ -n "$PRIOR_REFUNDED_VIDEO_REQUEST_ID" ]]; then
  PRIOR_VIDEO_LEDGER="$(sqlite3 -bail "$DB_PATH" \
    "SELECT count(*) FROM video_generation_tasks v JOIN credit_transactions h ON h.id=v.hold_transaction_id WHERE v.user_id=$TEST_USER_ID AND v.request_id='$PRIOR_REFUNDED_VIDEO_REQUEST_ID' AND v.status='failed' AND v.settlement_status='REFUNDED' AND v.provider_task_id IS NULL AND v.video_url IS NULL AND h.type='GENERATE_HOLD' AND h.status='REFUNDED' AND h.amount=-1250 AND (SELECT count(*) FROM credit_transactions s WHERE s.settlement_key='generation-hold:' || h.id || ':settlement' AND s.type='GENERATE_REFUND' AND s.status='SUCCESS' AND s.amount=1250)=1 AND (SELECT count(*) FROM credit_transactions s WHERE s.settlement_key='generation-hold:' || h.id || ':settlement' AND s.type='GENERATE_CAPTURE')=0;")"
  [[ "$PRIOR_VIDEO_LEDGER" == "1" ]]
  FINGERPRINT_MATCH="$(sqlite3 -bail "$DB_PATH" \
    "SELECT count(*) FROM video_generation_tasks old JOIN video_generation_tasks retry ON retry.user_id=old.user_id WHERE old.user_id=$TEST_USER_ID AND old.request_id='$PRIOR_REFUNDED_VIDEO_REQUEST_ID' AND retry.request_id='$VIDEO_REQUEST_ID' AND old.request_fingerprint=retry.request_fingerprint AND retry.api_format='v3' AND retry.selected_model='seedance-2.0' AND retry.duration_seconds=5 AND retry.resolution='720p' AND retry.aspect_ratio='16:9';")"
  [[ "$FINGERPRINT_MATCH" == "1" ]]
fi
NET_SMOKE_SPEND="$(sqlite3 -bail "$DB_PATH" \
  "SELECT -coalesce(sum(amount),0) FROM credit_transactions WHERE user_id=$TEST_USER_ID AND related_request_id IN ('$IMAGE_REQUEST_ID','$ORIGINAL_VIDEO_REQUEST_ID','$VIDEO_REQUEST_ID');")"
FINAL_SMOKE_BALANCE="$(sqlite3 -bail "$DB_PATH" \
  "SELECT credits FROM users WHERE id=$TEST_USER_ID;")"
[[ "$NET_SMOKE_SPEND" == "1280" && "$FINAL_SMOKE_BALANCE" == "0" ]]

# Terminal cleanup must remove this exact first-frame file. Then remove all old
# recursive leftovers and prove no expired/unreferenced candidate remains.
[[ ! -e "$APP_ROOT/backend/$reference_local_path" ]]
APP_ROOT="$APP_ROOT" DATABASE_PATH="$DB_PATH" \
  "$CLEANUP_SCRIPT" --delete --ttl-hours 24 >"$state_dir/reference-cleanup-delete.txt"
APP_ROOT="$APP_ROOT" DATABASE_PATH="$DB_PATH" \
  "$CLEANUP_SCRIPT" --dry-run --ttl-hours 24 >"$state_dir/reference-cleanup-after.txt"
grep -Eq '(^| )eligible=0( |$)' "$state_dir/reference-cleanup-after.txt"
chmod 600 "$state_dir"/reference-cleanup-*.txt

# Close the reference-only edge before visual/ledger approval. Hard maintenance
# may run (503 only), but the production frontend and APIs remain unavailable.
systemctl stop nginx
install_nginx_config_atomic "$MAINTENANCE_NGINX_SOURCE"
nginx -t
systemctl start nginx

# Materialize outputs into the persistent root-only evidence directory without
# printing data URIs or signed result URLs.
IMAGE_RESPONSE_FILE="$IMAGE_RESPONSE_FILE" VIDEO_RESPONSE_FILE="$VIDEO_RESPONSE_FILE" \
SMOKE_DIR="$state_dir" python3 - <<'PY'
import base64
import hashlib
import ipaddress
import json
import os
import socket
import urllib.parse
import urllib.request
from pathlib import Path

root = Path(os.environ["SMOKE_DIR"])
with open(os.environ["IMAGE_RESPONSE_FILE"], encoding="utf-8") as source:
    image_url = json.load(source)["image_url"]
with open(os.environ["VIDEO_RESPONSE_FILE"], encoding="utf-8") as source:
    video_url = json.load(source)["video_url"]

def validate_public_https(value):
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise SystemExit("unsafe smoke artifact URL")
    for result in socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM):
        address = ipaddress.ip_address(result[4][0])
        if not address.is_global:
            raise SystemExit("smoke artifact URL resolved to non-public address")

class SafeRedirect(urllib.request.HTTPRedirectHandler):
    count = 0
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        self.count += 1
        if self.count > 3:
            raise SystemExit("too many smoke artifact redirects")
        validate_public_https(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def materialize(value, destination, max_bytes):
    if value.startswith("data:"):
        header, payload = value.split(",", 1)
        if ";base64" not in header:
            raise SystemExit("unsupported non-base64 data URI")
        data = base64.b64decode(payload, validate=True)
        if not data or len(data) > max_bytes:
            raise SystemExit("smoke artifact exceeds safety limit")
        destination.write_bytes(data)
    else:
        validate_public_https(value)
        request = urllib.request.Request(value, headers={"User-Agent": "NeoVista-Release-Smoke/1"})
        opener = urllib.request.build_opener(SafeRedirect())
        total = 0
        with opener.open(request, timeout=60) as response, destination.open("wb") as output:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise SystemExit("smoke artifact exceeds safety limit")
                output.write(chunk)
        if total == 0:
            raise SystemExit("empty smoke artifact")
    os.chmod(destination, 0o600)
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    print(f"artifact={destination.name} bytes={destination.stat().st_size} sha256={digest}")

materialize(image_url, root / "smoke-image.bin", 32 * 1024 * 1024)
materialize(video_url, root / "smoke-video.bin", 256 * 1024 * 1024)
PY
file "$state_dir/smoke-image.bin" "$state_dir/smoke-video.bin"

echo "烟测证据位于 root-only 目录：$state_dir（未打印 JWT、URL 或 data URI）"
read -rp '目视检查图片/视频并核对账本；输入 PRODUCTION_SMOKE_VISUALLY_VERIFIED: ' VISUAL_CONFIRMATION
[[ "$VISUAL_CONFIRMATION" == "PRODUCTION_SMOKE_VISUALLY_VERIFIED" ]]

# Only now atomically expose the tested production vhost and start the cleanup
# timer. A failed final verifier returns to hard maintenance via fail_smoke().
systemctl stop nginx
install_nginx_config_atomic "$PRODUCTION_NGINX_SOURCE"
nginx -t
systemctl start nginx
systemctl enable --now neovista-seedance-reference-cleanup.timer >/dev/null
BASE_URL=https://neovista.cn API_BASE_URL=https://api.neovista.cn \
EXPECTED_IMAGE_FEATURE=true EXPECTED_SEEDANCE_FEATURE=true "$VERIFY_SCRIPT"

touch "$state_dir/COMPLETED"
chmod 600 "$state_dir/COMPLETED"
trap - ERR INT TERM EXIT
cleanup_auth
echo "PASS: net 1280 credits settled (one image plus one accepted video); production edge opened"
