from sqlalchemy import Column, Integer, String, DateTime, Boolean, Text, Date, ForeignKey, Index
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

    id = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(String(64), unique=True, index=True, nullable=False, default=lambda: str(uuid4()))
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    type = Column(String(32), index=True, nullable=False)
    amount = Column(Integer, nullable=False)
    status = Column(String(16), index=True, nullable=False)
    balance_after = Column(Integer, nullable=False)
    idempotency_key = Column(String(128), unique=True, index=True, nullable=True)
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
