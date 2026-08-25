import hashlib
from datetime import datetime
from typing import Optional

from sqlalchemy import or_, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models import CreditTransaction, RedemptionCode, User
from pricing import WELCOME_CREDITS, calculate_generation_cost, calculate_video_generation_cost


SETTLEMENT_TRANSACTION_TYPES = ("GENERATE_CAPTURE", "GENERATE_REFUND")


def _create_transaction(
    db: Session,
    *,
    user: User,
    tx_type: str,
    amount: int,
    status: str,
    balance_after: int,
    idempotency_key: Optional[str] = None,
    settlement_key: Optional[str] = None,
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
        settlement_key=settlement_key,
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
    cost = calculate_video_generation_cost(duration_seconds, selected_model, resolution)
    try:
        with db.begin_nested():
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
            hold.balance_after = user.credits
            db.add(hold)
            db.flush()
    except IntegrityError:
        existing = db.query(CreditTransaction).filter(
            CreditTransaction.idempotency_key == idempotency_key,
            CreditTransaction.type == "GENERATE_HOLD",
            CreditTransaction.status != "REFUNDED",
        ).first()
        if existing:
            return existing
        raise

    return hold


def _hold_settlement_key(hold_txn: CreditTransaction) -> str:
    if hold_txn.id is None:
        raise ValueError("积分预占流水尚未持久化")
    return f"generation-hold:{hold_txn.id}:settlement"


def _find_existing_settlement(
    db: Session,
    hold_txn: CreditTransaction,
    settlement_key: str,
    *,
    include_legacy: bool = True,
) -> Optional[CreditTransaction]:
    refund_amount = abs(int(hold_txn.amount or 0))

    def is_financially_compatible(candidate: CreditTransaction) -> bool:
        return (
            candidate.type == "GENERATE_CAPTURE"
            and int(candidate.amount or 0) == 0
        ) or (
            candidate.type == "GENERATE_REFUND"
            and int(candidate.amount or 0) == refund_amount
        )

    existing = db.query(CreditTransaction).filter(
        CreditTransaction.settlement_key == settlement_key,
        CreditTransaction.user_id == hold_txn.user_id,
        CreditTransaction.type.in_(SETTLEMENT_TRANSACTION_TYPES),
        CreditTransaction.status == "SUCCESS",
    ).first()
    if existing and not is_financially_compatible(existing):
        raise ValueError("积分结算流水金额异常，需要管理员复核")
    if existing or not include_legacy:
        return existing

    # Compatibility for settlement rows created before settlement_key existed.
    # A legacy row is only safe to associate when it is the sole successful,
    # financially compatible settlement for the same user/request after the
    # hold.  Ambiguity must fail closed because guessing here could either
    # double-refund credits or capture a request that was already refunded.
    if not hold_txn.related_request_id:
        return None
    legacy_query = db.query(CreditTransaction).filter(
        CreditTransaction.user_id == hold_txn.user_id,
        CreditTransaction.related_request_id == hold_txn.related_request_id,
        CreditTransaction.type.in_(SETTLEMENT_TRANSACTION_TYPES),
        CreditTransaction.status == "SUCCESS",
    )
    if hold_txn.created_at is not None:
        legacy_query = legacy_query.filter(
            CreditTransaction.created_at >= hold_txn.created_at,
        )
    candidates = legacy_query.order_by(CreditTransaction.id.asc()).all()
    candidates = [
        candidate
        for candidate in candidates
        if is_financially_compatible(candidate)
    ]
    if any(
        candidate.settlement_key not in (None, settlement_key)
        for candidate in candidates
    ):
        raise ValueError("历史积分结算流水已关联其他预占，需要管理员复核")
    if len(candidates) > 1:
        raise ValueError("历史积分结算流水存在歧义，需要管理员复核")
    existing = candidates[0] if candidates else None
    if existing and existing.settlement_key is None:
        existing.settlement_key = settlement_key
        db.add(existing)
        db.flush()
    return existing


def _normalize_hold_from_existing_settlement(
    db: Session,
    hold_txn: CreditTransaction,
    settlement: CreditTransaction,
) -> None:
    """Repair legacy hold state without applying any balance mutation.

    Older production code could persist a refund/capture row while leaving the
    corresponding hold PENDING.  The settlement row is the durable financial
    fact; replaying the requested operation would be unsafe.  This helper only
    aligns the hold's terminal status with that fact.
    """

    if settlement.type == "GENERATE_CAPTURE":
        terminal_status = "SUCCESS"
        error_code = None
        error_message = None
    elif settlement.type == "GENERATE_REFUND":
        terminal_status = "REFUNDED"
        error_code = settlement.error_code
        error_message = settlement.error_message
    else:
        raise ValueError("未知积分结算流水类型")

    if hold_txn.status == "PENDING":
        _claim_pending_hold(
            db,
            hold_txn,
            terminal_status=terminal_status,
            error_code=error_code,
            error_message=error_message,
        )
        db.flush()


def _claim_pending_hold(
    db: Session,
    hold_txn: CreditTransaction,
    *,
    terminal_status: str,
    error_code: Optional[str] = None,
    error_message: Optional[str] = None,
) -> bool:
    values = {
        "status": terminal_status,
        "updated_at": datetime.utcnow(),
    }
    if terminal_status == "REFUNDED":
        values.update(
            idempotency_key=None,
            error_code=error_code,
            error_message=error_message,
        )

    result = db.execute(
        update(CreditTransaction)
        .where(
            CreditTransaction.id == hold_txn.id,
            CreditTransaction.type == "GENERATE_HOLD",
            CreditTransaction.status == "PENDING",
        )
        .values(**values)
        .execution_options(synchronize_session=False)
    )
    db.expire(hold_txn)
    return result.rowcount == 1


def _get_settlement_user(db: Session, user_id: int) -> User:
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise ValueError("积分账户不存在")
    return user


def capture_generation_hold(db: Session, hold_txn: CreditTransaction, provider_meta=None):
    settlement_key = _hold_settlement_key(hold_txn)
    existing = _find_existing_settlement(db, hold_txn, settlement_key)
    if existing:
        _normalize_hold_from_existing_settlement(db, hold_txn, existing)
        return existing

    if not _claim_pending_hold(db, hold_txn, terminal_status="SUCCESS"):
        existing = _find_existing_settlement(db, hold_txn, settlement_key)
        if existing:
            _normalize_hold_from_existing_settlement(db, hold_txn, existing)
            return existing
        raise ValueError("积分预占已处于非待结算状态")

    existing = _find_existing_settlement(
        db,
        hold_txn,
        settlement_key,
        include_legacy=False,
    )
    if existing:
        return existing
    user = _get_settlement_user(db, hold_txn.user_id)

    capture = _create_transaction(
        db,
        user=user,
        tx_type="GENERATE_CAPTURE",
        amount=0,
        status="SUCCESS",
        balance_after=user.credits,
        settlement_key=settlement_key,
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
    settlement_key = _hold_settlement_key(hold_txn)
    refund_amount = abs(hold_txn.amount)
    existing = _find_existing_settlement(db, hold_txn, settlement_key)
    if existing:
        _normalize_hold_from_existing_settlement(db, hold_txn, existing)
        return existing

    if not _claim_pending_hold(
        db,
        hold_txn,
        terminal_status="REFUNDED",
        error_code=error_code,
        error_message=error_message,
    ):
        existing = _find_existing_settlement(db, hold_txn, settlement_key)
        if existing:
            _normalize_hold_from_existing_settlement(db, hold_txn, existing)
            return existing
        raise ValueError("积分预占已处于非待结算状态")

    existing = _find_existing_settlement(
        db,
        hold_txn,
        settlement_key,
        include_legacy=False,
    )
    if existing:
        return existing
    result = db.execute(
        update(User)
        .where(User.id == hold_txn.user_id)
        .values(credits=User.credits + refund_amount)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        raise ValueError("积分账户不存在")
    user = _get_settlement_user(db, hold_txn.user_id)
    db.refresh(user)

    refund = _create_transaction(
        db,
        user=user,
        tx_type="GENERATE_REFUND",
        amount=refund_amount,
        status="SUCCESS",
        balance_after=user.credits,
        settlement_key=settlement_key,
        related_request_id=hold_txn.related_request_id,
        error_code=error_code,
        error_message=error_message,
    )
    return refund


def redeem_code(db: Session, user: User, raw_code: str):
    code_hash = hashlib.sha256(raw_code.strip().upper().encode("utf-8")).hexdigest()
    redeemed_at = datetime.utcnow()
    claim = db.execute(
        update(RedemptionCode)
        .where(
            RedemptionCode.code_hash == code_hash,
            RedemptionCode.status == "ACTIVE",
            or_(
                RedemptionCode.expires_at.is_(None),
                RedemptionCode.expires_at >= redeemed_at,
            ),
        )
        .values(
            status="REDEEMED",
            redeemed_by_user_id=user.id,
            redeemed_at=redeemed_at,
        )
        .execution_options(synchronize_session=False)
    )

    if claim.rowcount != 1:
        code = db.query(RedemptionCode).filter(RedemptionCode.code_hash == code_hash).first()
        if not code:
            raise ValueError("兑换码无效")
        if code.status == "REDEEMED" and code.redeemed_by_user_id == user.id:
            existing_transaction = db.query(CreditTransaction).filter(
                CreditTransaction.user_id == user.id,
                CreditTransaction.type == "REDEEM",
                CreditTransaction.related_request_id == f"redeem:{code.id}",
            ).first()
            if existing_transaction:
                return existing_transaction, existing_transaction.balance_after
        if code.status == "ACTIVE" and code.expires_at and code.expires_at < redeemed_at:
            raise ValueError("兑换码已过期")
        raise ValueError("兑换码不可用")

    code = db.query(RedemptionCode).filter(RedemptionCode.code_hash == code_hash).one()
    balance_update = db.execute(
        update(User)
        .where(User.id == user.id)
        .values(credits=User.credits + code.credits)
        .execution_options(synchronize_session=False)
    )
    if balance_update.rowcount != 1:
        raise ValueError("积分账户不存在")
    db.flush()
    db.refresh(user)

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
