#!/usr/bin/env bash

# Sourced by smoke-neovista-production.sh. A terminal paid task must never cause
# the release workflow to invent a new request or pretend missing live-reference
# evidence can be reconstructed after application cleanup.
neovista_require_terminal_reference_evidence() {
  local status="$1" settlement="$2" state_file="$3" get_headers="$4"
  local head_headers="$5" post_status="$6" evidence

  [[ "$status" == "succeeded" && "$settlement" == "CAPTURED" ]] || return 0
  for evidence in "$state_file" "$get_headers" "$head_headers" "$post_status"; do
    [[ -f "$evidence" && ! -L "$evidence" ]] || {
      echo "Terminal paid video lacks persisted pre-terminal reference evidence; refusing replay/new request" >&2
      return 1
    }
  done
}

# Permit exactly one deterministic video retry only when the previous attempt
# was conclusively rejected before provider acceptance and its 1250-credit hold
# was refunded exactly once.  This is deliberately stricter than checking only
# task.status: any extra task, ledger row, event, provider ID, or result blocks
# the retry and requires operator review.
neovista_require_refunded_video_attempt_eligible() {
  local database="$1" user_id="$2" request_id="$3" eligible

  [[ -f "$database" && ! -L "$database" ]] || return 1
  [[ "$user_id" =~ ^[1-9][0-9]*$ ]] || return 1
  [[ "$request_id" =~ ^[A-Za-z0-9._:-]{8,64}$ ]] || return 1

  eligible="$(sqlite3 -bail "$database" "
    SELECT CASE WHEN
      (SELECT count(*) FROM video_generation_tasks WHERE request_id='$request_id')=1
      AND (SELECT count(*) FROM credit_transactions WHERE related_request_id='$request_id')=2
      AND (SELECT count(*) FROM generation_events WHERE request_id='$request_id')=1
      AND (
        SELECT count(*)
        FROM video_generation_tasks v
        JOIN credit_transactions h ON h.id=v.hold_transaction_id
        WHERE v.user_id=$user_id
          AND v.request_id='$request_id'
          AND v.status='failed'
          AND v.settlement_status='REFUNDED'
          AND v.provider_task_id IS NULL
          AND v.video_url IS NULL
          AND v.api_format='v3'
          AND v.selected_model='seedance-2.0'
          AND v.duration_seconds=5
          AND v.resolution='720p'
          AND v.aspect_ratio='16:9'
          AND length(v.request_fingerprint)=64
          AND h.user_id=v.user_id
          AND h.related_request_id=v.request_id
          AND h.type='GENERATE_HOLD'
          AND h.status='REFUNDED'
          AND h.amount=-1250
          AND h.idempotency_key IS NULL
          AND h.error_code='SEEDANCE_CREATE_REJECTED'
          AND (
            SELECT count(*) FROM credit_transactions s
            WHERE s.user_id=v.user_id
              AND s.related_request_id=v.request_id
              AND s.settlement_key='generation-hold:' || h.id || ':settlement'
              AND s.type='GENERATE_REFUND'
              AND s.status='SUCCESS'
              AND s.amount=1250
              AND s.error_code='SEEDANCE_CREATE_REJECTED'
          )=1
          AND (
            SELECT count(*) FROM credit_transactions s
            WHERE s.settlement_key='generation-hold:' || h.id || ':settlement'
              AND s.type='GENERATE_CAPTURE'
          )=0
          AND (
            SELECT count(*) FROM generation_events e
            WHERE e.user_id=v.user_id
              AND e.request_id=v.request_id
              AND e.entrypoint='video_generate'
              AND e.status='FAILED'
              AND e.error_code='SEEDANCE_CREATE_REJECTED'
          )=1
      )=1
    THEN 1 ELSE 0 END;
  ")" || return 1

  [[ "$eligible" == "1" ]] || {
    echo "Previous video attempt is not an exact pre-accept rejection with one complete refund" >&2
    return 1
  }
}
