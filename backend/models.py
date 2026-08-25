from sqlalchemy import Column, Integer, String, DateTime, Boolean, Text, Date, ForeignKey, Index, text
from database import Base
from datetime import datetime
from uuid import uuid4

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    credits = Column(Integer, default=0)
    is_admin = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=True)
    last_login_at = Column(DateTime, nullable=True)


class CreditTransaction(Base):
    __tablename__ = "credit_transactions"
    __table_args__ = (
        Index(
            "uq_credit_transactions_settlement_key",
            "settlement_key",
            unique=True,
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(String(64), unique=True, index=True, nullable=False, default=lambda: str(uuid4()))
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    type = Column(String(32), index=True, nullable=False)
    amount = Column(Integer, nullable=False)
    status = Column(String(16), index=True, nullable=False)
    balance_after = Column(Integer, nullable=False)
    idempotency_key = Column(String(128), unique=True, index=True, nullable=True)
    settlement_key = Column(String(128), nullable=True)
    related_request_id = Column(String(64), index=True, nullable=True)
    error_code = Column(String(64), nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class RedemptionCode(Base):
    __tablename__ = "redemption_codes"

    id = Column(Integer, primary_key=True, index=True)
    code_hash = Column(String(128), unique=True, index=True, nullable=False)
    credits = Column(Integer, nullable=False)
    status = Column(String(16), index=True, nullable=False, default="ACTIVE")
    batch = Column(String(64), index=True, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    redeemed_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    redeemed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class AdminAuditLog(Base):
    __tablename__ = "admin_audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    actor_user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    action = Column(String(64), index=True, nullable=False)
    details = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class UsageCounter(Base):
    __tablename__ = "usage_counters"
    __table_args__ = (
        Index(
            "uq_usage_lookup",
            "subject_type",
            "subject_key",
            "action",
            "bucket_date",
            unique=True,
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    subject_type = Column(String(16), index=True, nullable=False)
    subject_key = Column(String(128), index=True, nullable=False)
    action = Column(String(64), index=True, nullable=False)
    bucket_date = Column(Date, index=True, nullable=False)
    count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

class EmailVerification(Base):
    __tablename__ = "email_verifications"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, index=True, nullable=False)
    code = Column(String, nullable=False)
    expires_at = Column(DateTime, nullable=False)

class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String(64), unique=True, index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=True)
    chat_history = Column(Text, nullable=False, default="[]")
    template_id = Column(String(16), nullable=True)
    collected_params = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class GenerationEvent(Base):
    __tablename__ = "generation_events"

    id = Column(Integer, primary_key=True, index=True)
    request_id = Column(String(64), index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    entrypoint = Column(String(32), index=True, nullable=False)
    template_id = Column(String(32), index=True, nullable=True)
    selected_model = Column(String(64), index=True, nullable=True)
    provider_name = Column(String(64), index=True, nullable=True)
    resolution = Column(String(16), nullable=True)
    aspect_ratio = Column(String(16), nullable=True)
    num_images = Column(Integer, nullable=False, default=1)
    status = Column(String(16), index=True, nullable=False)
    error_code = Column(String(64), nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class ImageGenerationTask(Base):
    """Durable image-generation intent and settlement record.

    The prompt and reference payloads are deliberately not stored here.  The
    request fingerprint is sufficient for idempotency while avoiding plaintext
    prompt/reference retention in the operational database.
    """

    __tablename__ = "image_generation_tasks"
    __table_args__ = (
        Index(
            "uq_image_generation_tasks_user_request",
            "user_id",
            "request_id",
            unique=True,
        ),
        Index(
            "uq_image_generation_tasks_hold_transaction_id",
            "hold_transaction_id",
            unique=True,
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(String(96), unique=True, index=True, nullable=False)
    request_id = Column(String(64), index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    hold_transaction_id = Column(
        Integer,
        ForeignKey("credit_transactions.id"),
        nullable=True,
    )
    entrypoint = Column(String(32), index=True, nullable=False)
    template_id = Column(String(32), index=True, nullable=True)
    selected_model = Column(String(64), index=True, nullable=False)
    request_fingerprint = Column(String(64), nullable=False)
    resolution = Column(String(16), nullable=False)
    aspect_ratio = Column(String(16), nullable=False)
    num_images = Column(Integer, nullable=False, default=1)
    status = Column(String(24), index=True, nullable=False)
    settlement_status = Column(String(24), index=True, nullable=False, default="PENDING")
    provider_name = Column(String(64), index=True, nullable=True)
    image_url = Column(Text, nullable=True)
    result_size_bytes = Column(Integer, nullable=True)
    result_expires_at = Column(DateTime, index=True, nullable=True)
    last_provider_error = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class VideoGenerationTask(Base):
    __tablename__ = "video_generation_tasks"
    __table_args__ = (
        Index(
            "uq_video_generation_tasks_user_request",
            "user_id",
            "request_id",
            unique=True,
        ),
        Index(
            "uq_video_generation_tasks_provider_task_id",
            "provider_task_id",
            unique=True,
        ),
        Index(
            "uq_video_generation_tasks_hold_transaction_id",
            "hold_transaction_id",
            unique=True,
        ),
        Index(
            "uq_video_generation_tasks_user_unresolved",
            "user_id",
            unique=True,
            sqlite_where=text(
                "lower(status) IN ('ready','creating','submitting','submit_unknown','submitted','running','finalizing','queued','pending','created','processing','reconciliation_required')"
            ),
            postgresql_where=text(
                "lower(status) IN ('ready','creating','submitting','submit_unknown','submitted','running','finalizing','queued','pending','created','processing','reconciliation_required')"
            ),
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(String(96), unique=True, index=True, nullable=False)
    provider_task_id = Column(String(96), nullable=True)
    request_id = Column(String(64), index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    hold_transaction_id = Column(Integer, ForeignKey("credit_transactions.id"), nullable=False)
    selected_model = Column(String(64), index=True, nullable=False)
    provider_model = Column(String(96), nullable=False)
    api_format = Column(String(16), nullable=False, default="v3")
    prompt = Column(Text, nullable=False)
    request_fingerprint = Column(String(64), nullable=True)
    aspect_ratio = Column(String(16), nullable=False)
    resolution = Column(String(16), nullable=False, default="720p")
    duration_seconds = Column(Integer, nullable=False)
    status = Column(String(24), index=True, nullable=False)
    settlement_status = Column(String(24), index=True, nullable=False, default="PENDING")
    attempt_count = Column(Integer, nullable=False, default=0)
    next_poll_at = Column(DateTime, index=True, nullable=True)
    last_polled_at = Column(DateTime, nullable=True)
    deadline_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    video_url = Column(Text, nullable=True)
    reference_paths = Column(Text, nullable=True)
    last_provider_error = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class FrontendErrorEvent(Base):
    __tablename__ = "frontend_error_events"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=True)
    route = Column(String(255), index=True, nullable=False)
    message = Column(Text, nullable=False)
    stack = Column(Text, nullable=True)
    user_agent = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class AlertEvent(Base):
    __tablename__ = "alert_events"

    id = Column(Integer, primary_key=True, index=True)
    type = Column(String(64), index=True, nullable=False)
    status = Column(String(16), index=True, nullable=False)
    message = Column(Text, nullable=False)
    fingerprint = Column(String(128), index=True, nullable=False)
    triggered_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    resolved_at = Column(DateTime, nullable=True)
    last_evaluated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    meta_json = Column(Text, nullable=True)
