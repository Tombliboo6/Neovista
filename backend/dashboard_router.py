from collections import Counter
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from admin_auth import verify_admin_access
from database import get_db
from models import AlertEvent, FrontendErrorEvent, GenerationEvent, User
from umami_service import get_traffic_snapshot


router = APIRouter(
    prefix="/api/v1/admin/dashboard",
    tags=["admin-dashboard"],
    dependencies=[Depends(verify_admin_access)],
)


def _iso(value):
    return value.isoformat() if value else None


def _day_start(now: Optional[datetime] = None):
    current = now or datetime.utcnow()
    return current.replace(hour=0, minute=0, second=0, microsecond=0)


def _recent_users(db: Session):
    return (
        db.query(User)
        .order_by(User.created_at.desc().nullslast(), User.id.desc())
        .limit(10)
        .all()
    )


@router.get("/overview")
async def get_dashboard_overview(db: Session = Depends(get_db)):
    today_start = _day_start()
    users = db.query(User).all()
    generations = db.query(GenerationEvent).all()
    frontend_errors = db.query(FrontendErrorEvent).all()
    active_alerts = db.query(AlertEvent).filter(AlertEvent.status == "ACTIVE").all()
    traffic = get_traffic_snapshot()

    today_registrations = sum(1 for user in users if user.created_at and user.created_at >= today_start)
    today_logins = sum(1 for user in users if user.last_login_at and user.last_login_at >= today_start)
    today_generations = sum(1 for event in generations if event.created_at and event.created_at >= today_start)
    today_errors = sum(1 for event in frontend_errors if event.created_at and event.created_at >= today_start)

    return {
        "kpis": {
            "today_uv": traffic["summary"]["today"]["uv"],
            "today_pv": traffic["summary"]["today"]["pv"],
            "today_registrations": today_registrations,
            "today_logins": today_logins,
            "today_generations": today_generations,
            "today_errors": today_errors,
            "active_alerts": len(active_alerts),
        },
        "today": {
            "registrations": today_registrations,
            "logins": today_logins,
            "generations": today_generations,
            "errors": today_errors,
        },
        "status": {
            "service_health": "ok",
            "umami_available": traffic["summary"]["available"],
            "recent_alerts": [
                {
                    "type": alert.type,
                    "status": alert.status,
                    "message": alert.message,
                    "triggered_at": _iso(alert.triggered_at),
                }
                for alert in active_alerts[:5]
            ],
        },
    }


@router.get("/traffic")
async def get_dashboard_traffic():
    return get_traffic_snapshot()


@router.get("/users")
async def get_dashboard_users(db: Session = Depends(get_db)):
    now = datetime.utcnow()
    seven_days_ago = now - timedelta(days=7)
    thirty_days_ago = now - timedelta(days=30)
    users = db.query(User).all()

    recent_registrations = _recent_users(db)
    new_today = sum(1 for user in users if user.created_at and user.created_at >= _day_start(now))
    new_7d = sum(1 for user in users if user.created_at and user.created_at >= seven_days_ago)
    new_30d = sum(1 for user in users if user.created_at and user.created_at >= thirty_days_ago)
    logins_7d = sum(1 for user in users if user.last_login_at and user.last_login_at >= seven_days_ago)

    return {
        "totals": {
            "registered_users": len(users),
            "new_today": new_today,
            "new_7d": new_7d,
            "new_30d": new_30d,
            "logins_7d": logins_7d,
        },
        "trends": {
            "registrations": [],
            "logins": [],
        },
        "recent_registrations": [
            {
                "id": user.id,
                "email": user.email,
                "created_at": _iso(user.created_at),
                "last_login_at": _iso(user.last_login_at),
                "credits": user.credits,
            }
            for user in recent_registrations
        ],
    }


@router.get("/generations")
async def get_dashboard_generations(db: Session = Depends(get_db)):
    events = (
        db.query(GenerationEvent)
        .order_by(GenerationEvent.created_at.desc(), GenerationEvent.id.desc())
        .limit(50)
        .all()
    )

    status_counter = Counter(event.status for event in events)
    model_counter = Counter(event.selected_model or "unknown" for event in events)
    template_counter = Counter(event.template_id or "none" for event in events)

    return {
        "summary": {
            "total": len(events),
            "success": status_counter.get("SUCCESS", 0),
            "failed": status_counter.get("FAILED", 0),
        },
        "records": [
            {
                "created_at": _iso(event.created_at),
                "user_id": event.user_id,
                "request_id": event.request_id,
                "entrypoint": event.entrypoint,
                "template_id": event.template_id,
                "selected_model": event.selected_model,
                "provider_name": event.provider_name,
                "status": event.status,
                "error_code": event.error_code,
            }
            for event in events
        ],
        "model_ranking": [
            {"label": label, "count": count}
            for label, count in model_counter.most_common(10)
        ],
        "template_ranking": [
            {"label": label, "count": count}
            for label, count in template_counter.most_common(10)
        ],
    }


@router.get("/errors")
async def get_dashboard_errors(db: Session = Depends(get_db)):
    frontend_errors = (
        db.query(FrontendErrorEvent)
        .order_by(FrontendErrorEvent.created_at.desc(), FrontendErrorEvent.id.desc())
        .limit(20)
        .all()
    )
    failed_generations = (
        db.query(GenerationEvent)
        .filter(GenerationEvent.status == "FAILED")
        .order_by(GenerationEvent.created_at.desc(), GenerationEvent.id.desc())
        .limit(20)
        .all()
    )

    backend_summary_counter = Counter(event.error_code or "UNKNOWN" for event in failed_generations)

    return {
        "frontend_errors": [
            {
                "created_at": _iso(event.created_at),
                "route": event.route,
                "message": event.message,
                "user_id": event.user_id,
                "user_agent": event.user_agent,
            }
            for event in frontend_errors
        ],
        "backend_summary": [
            {"error_code": code, "count": count}
            for code, count in backend_summary_counter.most_common(10)
        ],
        "upstream_failures": [
            {
                "created_at": _iso(event.created_at),
                "request_id": event.request_id,
                "error_code": event.error_code,
                "error_message": event.error_message,
            }
            for event in failed_generations
        ],
    }


@router.get("/alerts")
async def get_dashboard_alerts(db: Session = Depends(get_db)):
    active_alerts = (
        db.query(AlertEvent)
        .filter(AlertEvent.status == "ACTIVE")
        .order_by(AlertEvent.triggered_at.desc(), AlertEvent.id.desc())
        .all()
    )
    recent_history = (
        db.query(AlertEvent)
        .order_by(AlertEvent.triggered_at.desc(), AlertEvent.id.desc())
        .limit(20)
        .all()
    )

    return {
        "active_alerts": [
            {
                "type": alert.type,
                "status": alert.status,
                "message": alert.message,
                "triggered_at": _iso(alert.triggered_at),
                "resolved_at": _iso(alert.resolved_at),
            }
            for alert in active_alerts
        ],
        "recent_history": [
            {
                "type": alert.type,
                "status": alert.status,
                "message": alert.message,
                "triggered_at": _iso(alert.triggered_at),
                "resolved_at": _iso(alert.resolved_at),
            }
            for alert in recent_history
        ],
    }
