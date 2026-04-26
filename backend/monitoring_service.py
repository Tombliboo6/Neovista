import traceback
from typing import Optional

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
    except Exception:
        db.rollback()
        traceback.print_exc()
        return None
