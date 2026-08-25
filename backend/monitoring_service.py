from typing import Callable, Optional

from sqlalchemy.orm import Session

from models import FrontendErrorEvent, GenerationEvent


def record_frontend_error_event(
    db: Session,
    *,
    user_id: Optional[int],
    route: str,
    message: str,
    stack: Optional[str] = None,
    user_agent: Optional[str] = None,
):
    event = FrontendErrorEvent(
        user_id=user_id,
        route=route,
        message=message,
        stack=stack,
        user_agent=user_agent,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def record_generation_event(
    db: Session,
    *,
    request_id: str,
    user_id: int,
    entrypoint: str,
    template_id: Optional[str],
    selected_model: Optional[str],
    provider_name: Optional[str],
    resolution: Optional[str],
    aspect_ratio: Optional[str],
    num_images: int,
    status: str,
    error_code: Optional[str] = None,
    error_message: Optional[str] = None,
):
    event = GenerationEvent(
        request_id=request_id,
        user_id=user_id,
        entrypoint=entrypoint,
        template_id=template_id,
        selected_model=selected_model,
        provider_name=provider_name,
        resolution=resolution,
        aspect_ratio=aspect_ratio,
        num_images=num_images,
        status=status,
        error_code=error_code,
        error_message=error_message,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def safe_record_generation_event(db: Session, **kwargs):
    try:
        return record_generation_event(db, **kwargs)
    except Exception as error:
        db.rollback()
        print(f"⚠️ 生成事件记录失败: {type(error).__name__}")
        return None


def safe_record_generation_event_isolated(
    session_factory: Callable[[], Session],
    **kwargs,
):
    """Persist monitoring data without sharing the business transaction session."""
    db = session_factory()
    try:
        return record_generation_event(db, **kwargs)
    except Exception as error:
        db.rollback()
        print(f"⚠️ 独立生成事件记录失败: {type(error).__name__}")
        return None
    finally:
        db.close()


def safe_update_generation_event_status(
    session_factory: Callable[[], Session],
    *,
    request_id: str,
    user_id: int,
    entrypoint: str,
    status: str,
    error_code: Optional[str] = None,
    error_message: Optional[str] = None,
):
    """Update the newest matching event in an isolated best-effort transaction."""
    db = session_factory()
    try:
        event = (
            db.query(GenerationEvent)
            .filter(
                GenerationEvent.request_id == request_id,
                GenerationEvent.user_id == user_id,
                GenerationEvent.entrypoint == entrypoint,
            )
            .order_by(GenerationEvent.id.desc())
            .first()
        )
        if not event:
            return None
        event.status = status
        event.error_code = error_code
        event.error_message = error_message
        db.add(event)
        db.commit()
        db.refresh(event)
        return event
    except Exception as error:
        db.rollback()
        print(f"⚠️ 生成事件状态更新失败: {type(error).__name__}")
        return None
    finally:
        db.close()
