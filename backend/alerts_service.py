from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from models import AlertEvent, GenerationEvent


GENERATION_FAILURE_ALERT_TYPE = "generation_failure_rate_high"
GENERATION_FAILURE_FINGERPRINT = "generation_failure_rate_high"
GENERATION_FAILURE_WINDOW_MINUTES = 15
GENERATION_FAILURE_THRESHOLD = 0.5
GENERATION_FAILURE_MIN_SAMPLE = 2


def _active_alert(db: Session, *, fingerprint: str) -> Optional[AlertEvent]:
    return (
        db.query(AlertEvent)
        .filter(AlertEvent.fingerprint == fingerprint, AlertEvent.status == "ACTIVE")
        .first()
    )


def upsert_active_alert(
    db: Session,
    *,
    alert_type: str,
    fingerprint: str,
    message: str,
    now: datetime,
):
    alert = _active_alert(db, fingerprint=fingerprint)
    if alert:
        alert.message = message
        alert.last_evaluated_at = now
        db.add(alert)
        return alert

    alert = AlertEvent(
        type=alert_type,
        status="ACTIVE",
        message=message,
        fingerprint=fingerprint,
        triggered_at=now,
        last_evaluated_at=now,
    )
    db.add(alert)
    return alert


def resolve_active_alert(db: Session, *, fingerprint: str, now: datetime):
    alert = _active_alert(db, fingerprint=fingerprint)
    if not alert:
        return None

    alert.status = "RESOLVED"
    alert.resolved_at = now
    alert.last_evaluated_at = now
    db.add(alert)
    return alert


def evaluate_generation_failure_rate(db: Session, *, now: datetime):
    window_start = now - timedelta(minutes=GENERATION_FAILURE_WINDOW_MINUTES)
    events = (
        db.query(GenerationEvent)
        .filter(GenerationEvent.created_at >= window_start)
        .all()
    )
    total = len(events)
    failures = sum(1 for event in events if event.status == "FAILED")
    failure_rate = failures / total if total else 0.0

    if total >= GENERATION_FAILURE_MIN_SAMPLE and failure_rate >= GENERATION_FAILURE_THRESHOLD:
        percentage = round(failure_rate * 100)
        message = f"最近 {GENERATION_FAILURE_WINDOW_MINUTES} 分钟生图失败率达到 {percentage}%"
        upsert_active_alert(
            db,
            alert_type=GENERATION_FAILURE_ALERT_TYPE,
            fingerprint=GENERATION_FAILURE_FINGERPRINT,
            message=message,
            now=now,
        )
        return

    resolve_active_alert(db, fingerprint=GENERATION_FAILURE_FINGERPRINT, now=now)


def evaluate_alerts(db: Session, *, now: Optional[datetime] = None):
    current_time = now or datetime.utcnow()
    evaluate_generation_failure_rate(db, now=current_time)
    db.commit()
