import os

from fastapi import Depends, Header, HTTPException

from auth import get_current_user
from models import User


ADMIN_SECRET_KEY = os.getenv("ADMIN_SECRET_KEY")
if not ADMIN_SECRET_KEY:
    raise RuntimeError("ADMIN_SECRET_KEY 环境变量未设置，请在 .env 中配置")


def verify_admin_token(x_admin_token: str = Header(None)):
    if x_admin_token != ADMIN_SECRET_KEY:
        raise HTTPException(status_code=403, detail="无效的管理员令牌")
    return True


def verify_admin_access(
    x_admin_token: str = Header(None),
    current_user: User = Depends(get_current_user),
) -> User:
    """Require both a named admin account and the independent admin secret."""
    verify_admin_token(x_admin_token)
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return current_user
