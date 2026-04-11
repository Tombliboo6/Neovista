import hashlib
import json
import secrets
import string
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from auth import get_current_user
from billing_service import redeem_code
from database import get_db
from models import AdminAuditLog, CreditTransaction, RedemptionCode, User

router = APIRouter()
MAX_CODE_GENERATION_ATTEMPTS = 10


class RedeemCodeRequest(BaseModel):
    code: str = Field(..., min_length=4, max_length=64)


class RedemptionCodeBatchRequest(BaseModel):
    credits: int = Field(..., gt=0)
    count: int = Field(default=1, gt=0, le=200)
    batch: Optional[str] = None
    expires_days: Optional[int] = Field(default=None, gt=0, le=365)
    prefix: str = Field(default="NV", min_length=2, max_length=8)


def _generate_plain_code(prefix: str) -> str:
    alphabet = string.ascii_uppercase + string.digits
    groups = ["".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(2)]
    return f"{prefix.upper()}-{groups[0]}-{groups[1]}"


def _write_admin_audit_log(
    db: Session,
    *,
    actor_user_id: int,
    action: str,
    details: dict,
):
    db.add(
        AdminAuditLog(
            actor_user_id=actor_user_id,
            action=action,
            details=json.dumps(details, ensure_ascii=False),
        )
    )


@router.get("/me")
async def get_billing_me(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    current_user = db.merge(current_user)
    transactions = (
        db.query(CreditTransaction)
        .filter(CreditTransaction.user_id == current_user.id)
        .order_by(CreditTransaction.created_at.desc())
        .limit(20)
        .all()
    )

    return {
        "credits": current_user.credits,
        "transactions": [
            {
                "transaction_id": tx.transaction_id,
                "type": tx.type,
                "amount": tx.amount,
                "status": tx.status,
                "balance_after": tx.balance_after,
                "created_at": tx.created_at.isoformat() if tx.created_at else None,
            }
            for tx in transactions
        ],
    }


@router.post("/redeem")
async def redeem_billing_code(
    request: RedeemCodeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    current_user = db.merge(current_user)
    try:
        transaction, balance = redeem_code(db, current_user, request.code)
        db.commit()
        db.refresh(current_user)
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"兑换失败: {str(e)}")

    return {
        "credits": balance,
        "transaction_id": transaction.transaction_id,
    }


@router.post("/admin/redemption-codes")
async def create_redemption_codes(
    request: RedemptionCodeBatchRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    current_user = db.merge(current_user)
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="需要管理员权限")

    expires_at = None
    if request.expires_days:
        expires_at = datetime.utcnow() + timedelta(days=request.expires_days)

    plaintext_codes = []
    try:
        for _ in range(request.count):
            generated_code = None
            for _attempt in range(MAX_CODE_GENERATION_ATTEMPTS):
                raw_code = _generate_plain_code(request.prefix)
                code_hash = hashlib.sha256(raw_code.strip().upper().encode("utf-8")).hexdigest()
                existing = (
                    db.query(RedemptionCode.id)
                    .filter(RedemptionCode.code_hash == code_hash)
                    .first()
                )
                if existing:
                    continue

                db.add(
                    RedemptionCode(
                        code_hash=code_hash,
                        credits=request.credits,
                        status="ACTIVE",
                        batch=request.batch,
                        expires_at=expires_at,
                    )
                )
                generated_code = raw_code
                plaintext_codes.append(raw_code)
                break

            if generated_code is None:
                raise HTTPException(status_code=500, detail="兑换码生成失败，请重试")

        _write_admin_audit_log(
            db,
            actor_user_id=current_user.id,
            action="GENERATE_REDEMPTION_CODES",
            details={
                "credits": request.credits,
                "count": request.count,
                "batch": request.batch,
                "expires_days": request.expires_days,
                "codes": plaintext_codes,
            },
        )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"生成兑换码失败: {str(e)}")
    return {
        "count": len(plaintext_codes),
        "credits": request.credits,
        "codes": plaintext_codes,
    }
