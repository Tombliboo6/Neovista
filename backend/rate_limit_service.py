from datetime import date as date_type
from datetime import datetime
from typing import Optional, Tuple

from fastapi import Request
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models import UsageCounter


def extract_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _bucketed_action(action: str, now: datetime, period: str) -> Tuple[str, date_type]:
    if period == "hour":
        return f"{action}:{now.strftime('%Y%m%d%H')}", now.date()
    return action, now.date()


def _ensure_counter_row(
    db: Session,
    *,
    subject_type: str,
    subject_key: str,
    action: str,
    bucket_date: date_type,
    now: datetime,
):
    counter = (
        db.query(UsageCounter)
        .filter(
            UsageCounter.subject_type == subject_type,
            UsageCounter.subject_key == subject_key,
            UsageCounter.action == action,
            UsageCounter.bucket_date == bucket_date,
        )
        .first()
    )
    if counter:
        return counter

    db.add(
        UsageCounter(
            subject_type=subject_type,
            subject_key=subject_key,
            action=action,
            bucket_date=bucket_date,
            count=0,
            created_at=now,
            updated_at=now,
        )
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()

    return (
        db.query(UsageCounter)
        .filter(
            UsageCounter.subject_type == subject_type,
            UsageCounter.subject_key == subject_key,
            UsageCounter.action == action,
            UsageCounter.bucket_date == bucket_date,
        )
        .first()
    )


def _check_and_increment(
    db: Session,
    *,
    subject_type: str,
    subject_key: str,
    action: str,
    limit: int,
    now: Optional[datetime] = None,
    period: str = "day",
) -> int:
    if limit <= 0:
        return 0

    current_time = now or datetime.utcnow()
    bucketed_action, bucket_date = _bucketed_action(action, current_time, period)

    _ensure_counter_row(
        db,
        subject_type=subject_type,
        subject_key=subject_key,
        action=bucketed_action,
        bucket_date=bucket_date,
        now=current_time,
    )

    result = db.execute(
        update(UsageCounter)
        .where(
            UsageCounter.subject_type == subject_type,
            UsageCounter.subject_key == subject_key,
            UsageCounter.action == bucketed_action,
            UsageCounter.bucket_date == bucket_date,
            UsageCounter.count < limit,
        )
        .values(
            count=UsageCounter.count + 1,
            updated_at=current_time,
        )
    )

    if result.rowcount == 0:
        db.rollback()
        raise ValueError("请求过于频繁，请稍后再试")

    db.commit()

    counter = (
        db.query(UsageCounter)
        .filter(
            UsageCounter.subject_type == subject_type,
            UsageCounter.subject_key == subject_key,
            UsageCounter.action == bucketed_action,
            UsageCounter.bucket_date == bucket_date,
        )
        .first()
    )
    return counter.count


def check_and_increment_ip_limit(
    db: Session,
    ip: str,
    action: str,
    limit: int,
    *,
    now: Optional[datetime] = None,
    period: str = "day",
) -> int:
    return _check_and_increment(
        db,
        subject_type="ip",
        subject_key=ip,
        action=action,
        limit=limit,
        now=now,
        period=period,
    )


def check_and_increment_user_limit(
    db: Session,
    user_id: int,
    action: str,
    limit: int,
    *,
    now: Optional[datetime] = None,
    period: str = "day",
) -> int:
    return _check_and_increment(
        db,
        subject_type="user",
        subject_key=str(user_id),
        action=action,
        limit=limit,
        now=now,
        period=period,
    )
