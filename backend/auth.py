from fastapi import APIRouter, Depends, HTTPException, Header, Request
from sqlalchemy.orm import Session
from sqlalchemy import exc
from pydantic import BaseModel, Field
from pydantic import field_validator
from datetime import datetime, timedelta
import jwt
from jwt import InvalidTokenError
import bcrypt
import hashlib
import hmac
import logging
import os
import re
import secrets

from database import get_db
from billing_service import grant_welcome_credits
from rate_limit_service import (
    check_and_increment_ip_limit,
    check_and_increment_subject_limit,
    extract_client_ip,
)
from models import User, EmailVerification
from email_utils import send_verification_email
from runtime_security import require_runtime_secret

router = APIRouter()
logger = logging.getLogger(__name__)

SECRET_KEY = require_runtime_secret("JWT_SECRET_KEY", os.getenv("JWT_SECRET_KEY"))
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7天
SEND_CODE_IP_HOURLY_LIMIT = int(os.getenv("SEND_CODE_IP_HOURLY_LIMIT", "10"))
SEND_CODE_EMAIL_HOURLY_LIMIT = int(os.getenv("SEND_CODE_EMAIL_HOURLY_LIMIT", "5"))
REGISTER_IP_DAILY_LIMIT = int(os.getenv("REGISTER_IP_DAILY_LIMIT", "3"))
REGISTER_EMAIL_DAILY_LIMIT = int(os.getenv("REGISTER_EMAIL_DAILY_LIMIT", "10"))
LOGIN_IP_HOURLY_LIMIT = int(os.getenv("LOGIN_IP_HOURLY_LIMIT", "30"))
LOGIN_EMAIL_HOURLY_LIMIT = int(os.getenv("LOGIN_EMAIL_HOURLY_LIMIT", "10"))
GENERIC_REGISTRATION_ERROR = "注册信息无效或验证码错误"

_EMAIL_LOCAL_PART_RE = re.compile(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+\Z")
_EMAIL_DOMAIN_LABEL_RE = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\Z")


def _normalize_email(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("邮箱格式无效")
    if len(value) > 512:
        raise ValueError("邮箱格式无效")

    normalized = value.strip().lower()
    if not (3 <= len(normalized) <= 254) or normalized.count("@") != 1:
        raise ValueError("邮箱格式无效")

    local_part, domain = normalized.rsplit("@", 1)
    if (
        not local_part
        or len(local_part) > 64
        or local_part.startswith(".")
        or local_part.endswith(".")
        or ".." in local_part
        or not _EMAIL_LOCAL_PART_RE.fullmatch(local_part)
    ):
        raise ValueError("邮箱格式无效")

    domain_labels = domain.split(".")
    if len(domain_labels) < 2 or any(not _EMAIL_DOMAIN_LABEL_RE.fullmatch(label) for label in domain_labels):
        raise ValueError("邮箱格式无效")
    return normalized


class EmailRequest(BaseModel):
    email: str = Field(..., strict=True, min_length=3, max_length=254)

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value):
        return _normalize_email(value)


class SendCodeRequest(EmailRequest):
    pass


class RegisterRequest(EmailRequest):
    password: str = Field(..., strict=True, min_length=8, max_length=24)
    code: str = Field(..., strict=True, min_length=6, max_length=6, pattern=r"^[0-9]{6}$")


class LoginRequest(EmailRequest):
    password: str = Field(..., strict=True, min_length=8, max_length=24)


def hash_password(password: str) -> str:
    pwd_bytes = password[:72].encode('utf-8')
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pwd_bytes, salt).decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    pwd_bytes = plain_password[:72].encode('utf-8')
    hash_bytes = hashed_password.encode('utf-8')
    try:
        return bcrypt.checkpw(pwd_bytes, hash_bytes)
    except (TypeError, ValueError):
        return False


def _email_limit_key(email: str) -> str:
    normalized = _normalize_email(email)
    return hmac.new(
        SECRET_KEY.encode("utf-8"),
        normalized.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _login_email_limit_key(email: str) -> str:
    return _email_limit_key(email)

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(authorization: str = Header(None), db: Session = Depends(get_db)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未登录")

    token = authorization.replace("Bearer ", "")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise HTTPException(status_code=401, detail="无效的token")
    except InvalidTokenError:
        raise HTTPException(status_code=401, detail="无效的token")

    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise HTTPException(status_code=401, detail="用户不存在")

    return user


def get_optional_user(authorization: str = Header(None), db: Session = Depends(get_db)):
    if not authorization or not authorization.startswith("Bearer "):
        return None

    try:
        return get_current_user(authorization=authorization, db=db)
    except HTTPException:
        return None

@router.post("/send-code")
async def send_code(request: SendCodeRequest, http_request: Request, db: Session = Depends(get_db)):
    client_ip = extract_client_ip(http_request)
    try:
        check_and_increment_ip_limit(db, client_ip, "send_code", SEND_CODE_IP_HOURLY_LIMIT, period="hour")
        check_and_increment_subject_limit(
            db,
            "send_code_email",
            _email_limit_key(request.email),
            "send_code",
            SEND_CODE_EMAIL_HOURLY_LIMIT,
            period="hour",
        )
    except ValueError as e:
        raise HTTPException(status_code=429, detail=str(e))

    code = f"{secrets.randbelow(1_000_000):06d}"
    expires_at = datetime.now() + timedelta(minutes=5)

    try:
        db.query(EmailVerification).filter(EmailVerification.email == request.email).delete()
        verification = EmailVerification(
            email=request.email,
            code=code,
            expires_at=expires_at
        )
        db.add(verification)
        db.commit()
    except exc.SQLAlchemyError:
        db.rollback()
        logger.error("send-code database operation failed")
        raise HTTPException(status_code=500, detail="数据库操作失败")

    success = send_verification_email(request.email, code)
    if not success:
        try:
            db.query(EmailVerification).filter(
                EmailVerification.email == request.email,
                EmailVerification.code == code,
            ).delete()
            db.commit()
        except exc.SQLAlchemyError:
            db.rollback()
            logger.error("send-code cleanup failed")
        raise HTTPException(status_code=503, detail="暂时无法发送验证码，请稍后再试")

    return {"message": "验证码已发送"}

@router.post("/register")
async def register(request: RegisterRequest, http_request: Request, db: Session = Depends(get_db)):
    if len(request.password) < 8 or len(request.password) > 24:
        raise HTTPException(status_code=400, detail="密码长度必须为8-24位")

    if len(request.password.encode('utf-8')) > 72:
        raise HTTPException(status_code=400, detail="密码包含过多特殊字符，请使用简单字符")

    if not any(c.isalpha() for c in request.password):
        raise HTTPException(status_code=400, detail="密码必须包含至少一个字母")

    client_ip = extract_client_ip(http_request)
    try:
        check_and_increment_ip_limit(db, client_ip, "register", REGISTER_IP_DAILY_LIMIT, period="day")
        check_and_increment_subject_limit(
            db,
            "register_email",
            _email_limit_key(request.email),
            "register",
            REGISTER_EMAIL_DAILY_LIMIT,
            period="day",
        )
    except ValueError as e:
        raise HTTPException(status_code=429, detail=str(e))

    try:
        existing_user = db.query(User).filter(User.email == request.email).first()
        verification = db.query(EmailVerification).filter(
            EmailVerification.email == request.email,
            EmailVerification.code == request.code
        ).first()

        if existing_user or not verification or verification.expires_at < datetime.now():
            raise HTTPException(status_code=400, detail=GENERIC_REGISTRATION_ERROR)

        db.delete(verification)

        user = User(
            email=request.email,
            hashed_password=hash_password(request.password),
            credits=0,
            created_at=datetime.utcnow(),
        )
        db.add(user)
        db.flush()
        grant_welcome_credits(db, user, source="register")
        db.commit()
        db.refresh(user)
    except HTTPException:
        raise
    except exc.IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail=GENERIC_REGISTRATION_ERROR)
    except exc.SQLAlchemyError:
        db.rollback()
        logger.error("register database operation failed")
        raise HTTPException(status_code=500, detail="数据库操作失败")

    token = create_access_token({"sub": user.email, "user_id": user.id})

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "credits": user.credits
        }
    }

@router.post("/login")
async def login(request: LoginRequest, http_request: Request, db: Session = Depends(get_db)):
    client_ip = extract_client_ip(http_request)
    try:
        check_and_increment_ip_limit(db, client_ip, "login", LOGIN_IP_HOURLY_LIMIT, period="hour")
        check_and_increment_subject_limit(
            db,
            "login_email",
            _login_email_limit_key(request.email),
            "login",
            LOGIN_EMAIL_HOURLY_LIMIT,
            period="hour",
        )
    except ValueError as e:
        raise HTTPException(status_code=429, detail=str(e))

    user = db.query(User).filter(User.email == request.email).first()
    if not user or not verify_password(request.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="邮箱或密码错误")

    user.last_login_at = datetime.utcnow()
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token({"sub": user.email, "user_id": user.id})

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "credits": user.credits
        }
    }

@router.get("/me")
async def get_me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "email": current_user.email,
        "credits": current_user.credits,
        "is_admin": current_user.is_admin
    }
