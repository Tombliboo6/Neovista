import os

from fastapi import Header, HTTPException


ADMIN_SECRET_KEY = os.getenv("ADMIN_SECRET_KEY")
if not ADMIN_SECRET_KEY:
    raise RuntimeError("ADMIN_SECRET_KEY 环境变量未设置，请在 .env 中配置")


def verify_admin_token(x_admin_token: str = Header(None)):
    if x_admin_token != ADMIN_SECRET_KEY:
        raise HTTPException(status_code=403, detail="无效的管理员令牌")
    return True
