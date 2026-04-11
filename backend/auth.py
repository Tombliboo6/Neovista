from fastapi import APIRouter, Depends, HTTPException, Header, Request
from sqlalchemy.orm import Session
from sqlalchemy import exc
from pydantic import BaseModel, Field
from datetime import datetime, timedelta
from jose import jwt, JWTError
import bcrypt
import random
import os

from database import get_db
from billing_service import grant_welcome_credits
from rate_limit_service import check_and_increment_ip_limit, extract_client_ip
from models import User, EmailVerification
from email_utils import send_verification_email

router = APIRouter()

SECRET_KEY = os.getenv("JWT_SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("JWT_SECRET_KEY 环境变量未设置，请在 .env 中配置")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7天
SEND_CODE_IP_HOURLY_LIMIT = int(os.getenv("SEND_CODE_IP_HOURLY_LIMIT", "10"))
REGISTER_IP_DAILY_LIMIT = int(os.getenv("REGISTER_IP_DAILY_LIMIT", "3"))

class SendCodeRequest(BaseModel):
    email: str

class RegisterRequest(BaseModel):
    email: str
    password: str = Field(..., min_length=8, max_length=24)
    code: str

class LoginRequest(BaseModel):
    email: str
    password: str = Field(..., min_length=8, max_length=24)

def hash_password(password: str) -> str:
    pwd_bytes = password[:72].encode('utf-8')
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pwd_bytes, salt).decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    pwd_bytes = plain_password[:72].encode('utf-8')
    hash_bytes = hashed_password.encode('utf-8')
    return bcrypt.checkpw(pwd_bytes, hash_bytes)

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
    except JWTError:
        raise HTTPException(status_code=401, detail="无效的token")

    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise HTTPException(status_code=401, detail="用户不存在")

    return user

@router.post("/send-code")
async def send_code(request: SendCodeRequest, http_request: Request, db: Session = Depends(get_db)):
    client_ip = extract_client_ip(http_request)
    try:
        check_and_increment_ip_limit(db, client_ip, "send_code", SEND_CODE_IP_HOURLY_LIMIT, period="hour")
    except ValueError as e:
        raise HTTPException(status_code=429, detail=str(e))

    code = str(random.randint(100000, 999999))
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
    except exc.SQLAlchemyError as e:
        db.rollback()
        print(f"❌ 数据库操作失败: {e}")
        raise HTTPException(status_code=500, detail="数据库操作失败")

    success = send_verification_email(request.email, code)
    if not success:
        raise HTTPException(status_code=500, detail="邮件发送失败")

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
    except ValueError as e:
        raise HTTPException(status_code=429, detail=str(e))

    try:
        existing_user = db.query(User).filter(User.email == request.email).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="邮箱已注册")

        verification = db.query(EmailVerification).filter(
            EmailVerification.email == request.email,
            EmailVerification.code == request.code
        ).first()

        if not verification or verification.expires_at < datetime.now():
            raise HTTPException(status_code=400, detail="验证码错误或已过期")

        db.delete(verification)

        user = User(
            email=request.email,
            hashed_password=hash_password(request.password),
            credits=0
        )
        db.add(user)
        db.flush()
        grant_welcome_credits(db, user, source="register")
        db.commit()
        db.refresh(user)
    except HTTPException:
        raise
    except exc.SQLAlchemyError as e:
        db.rollback()
        print(f"❌ 数据库操作失败: {e}")
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
async def login(request: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == request.email).first()
    if not user or not verify_password(request.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="邮箱或密码错误")

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
