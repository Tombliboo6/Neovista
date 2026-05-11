import hashlib
from datetime import datetime
from typing import Optional

from sqlalchemy import update
from sqlalchemy.orm import Session

from models import CreditTransaction, RedemptionCode, User
from pricing import WELCOME_CREDITS, calculate_generation_cost, calculate_video_generation_cost


def _create_transaction(
    db: Session,
    *,
    user: User,
    tx_type: str,
    amount: int,
    status: str,
    balance_after: int,
    idempotency_key: Optional[str] = None,
    related_request_id: Optional[str] = None,
    error_code: Optional[str] = None,
    error_message: Optional[str] = None,
) -> CreditTransaction:
    transaction = CreditTransaction(
        user_id=user.id,
        type=tx_type,
        amount=amount,
        status=status,
        balance_after=balance_after,
        idempotency_key=idempotency_key,
        related_request_id=related_request_id,
        error_code=error_code,
        error_message=error_message,
    )
    db.add(transaction)
    db.flush()
    return transaction


def grant_welcome_credits(db: Session, user: User, *, source: str = "register"):
    user.credits += WELCOME_CREDITS
    db.add(user)
    db.flush()
    transaction = _create_transaction(
        db,
        user=user,
        tx_type="WELCOME_GRANT",
        amount=WELCOME_CREDITS,
        status="SUCCESS",
        balance_after=user.credits,
        related_request_id=source,
    )
    return transaction, user.credits


def create_generation_hold(
    db: Session,
    user: User,
    *,
    resolution: str,
    num_images: int,
    request_id: str,
    idempotency_key: str,
    selected_model: Optional[str] = None,
):
    existing = db.query(CreditTransaction).filter(
        CreditTransaction.idempotency_key == idempotency_key,
        CreditTransaction.type == "GENERATE_HOLD",
    ).first()
    if existing and existing.status != "REFUNDED":
        return existing

    cost = calculate_generation_cost(resolution, num_images, selected_model)
    result = db.execute(
        update(User)
        .where(
            User.id == user.id,
            User.credits >= cost,
        )
        .values(credits=User.credits - cost)
    )
    if result.rowcount == 0:
        raise ValueError("积分不足")

    db.flush()
    db.refresh(user)

    hold = _create_transaction(
        db,
        user=user,
        tx_type="GENERATE_HOLD",
        amount=-cost,
        status="PENDING",
        balance_after=user.credits,
        idempotency_key=idempotency_key,
        related_request_id=request_id,
    )
    return hold


def create_video_generation_hold(
    db: Session,
    user: User,
    *,
    duration_seconds: int,
    resolution: str,
    request_id: str,
    idempotency_key: str,
    selected_model: Optional[str] = None,
):
    existing = db.query(CreditTransaction).filter(
        CreditTransaction.idempotency_key == idempotency_key,
        CreditTransaction.type == "GENERATE_HOLD",
    ).first()
    if existing and existing.status != "REFUNDED":
        return existing

    cost = calculate_video_generation_cost(duration_seconds, selected_model, resolution)
    result = db.execute(
        update(User)
        .where(
            User.id == user.id,
            User.credits >= cost,
        )
        .values(credits=User.credits - cost)
    )
    if result.rowcount == 0:
        raise ValueError("积分不足")

    db.flush()
    db.refresh(user)

    hold = _create_transaction(
        db,
        user=user,
        tx_type="GENERATE_HOLD",
        amount=-cost,
        status="PENDING",
        balance_after=user.credits,
        idempotency_key=idempotency_key,
        related_request_id=request_id,
    )
    return hold


def capture_generation_hold(db: Session, hold_txn: CreditTransaction, provider_meta=None):
    existing = db.query(CreditTransaction).filter(
        CreditTransaction.type == "GENERATE_CAPTURE",
        CreditTransaction.related_request_id == hold_txn.related_request_id,
    ).first()
    if existing:
        return existing

    hold_txn.status = "SUCCESS"
    db.add(hold_txn)
    user = db.query(User).filter(User.id == hold_txn.user_id).first()
    db.flush()

    capture = _create_transaction(
        db,
        user=user,
        tx_type="GENERATE_CAPTURE",
        amount=0,
        status="SUCCESS",
        balance_after=user.credits,
        related_request_id=hold_txn.related_request_id,
    )
    return capture


def refund_generation_hold(
    db: Session,
    hold_txn: CreditTransaction,
    *,
    error_code: str,
    error_message: str,
):
    existing = db.query(CreditTransaction).filter(
        CreditTransaction.type == "GENERATE_REFUND",
        CreditTransaction.related_request_id == hold_txn.related_request_id,
    ).first()
    if existing:
        return existing

    refund_amount = abs(hold_txn.amount)
    user = db.query(User).filter(User.id == hold_txn.user_id).first()
    user.credits += refund_amount
    hold_txn.status = "REFUNDED"
    hold_txn.idempotency_key = None
    hold_txn.error_code = error_code
    hold_txn.error_message = error_message
    db.add(user)
    db.add(hold_txn)
    db.flush()

    refund = _create_transaction(
        db,
        user=user,
        tx_type="GENERATE_REFUND",
        amount=refund_amount,
        status="SUCCESS",
        balance_after=user.credits,
        related_request_id=hold_txn.related_request_id,
        error_code=error_code,
        error_message=error_message,
    )
    return refund


def redeem_code(db: Session, user: User, raw_code: str):
    code_hash = hashlib.sha256(raw_code.strip().upper().encode("utf-8")).hexdigest()
    code = db.query(RedemptionCode).filter(RedemptionCode.code_hash == code_hash).first()
    if not code:
        raise ValueError("兑换码无效")
    if code.status != "ACTIVE":
        raise ValueError("兑换码不可用")
    if code.expires_at and code.expires_at < datetime.utcnow():
        raise ValueError("兑换码已过期")

    user.credits += code.credits
    code.status = "REDEEMED"
    code.redeemed_by_user_id = user.id
    code.redeemed_at = datetime.utcnow()
    db.add(user)
    db.add(code)
    db.flush()

    transaction = _create_transaction(
        db,
        user=user,
        tx_type="REDEEM",
        amount=code.credits,
        status="SUCCESS",
        balance_after=user.credits,
        related_request_id=f"redeem:{code.id}",
    )
    return transaction, user.credits
