from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os

# 从环境变量读取数据库 URL
# 开发环境默认：sqlite:///./neovista.db（当前目录）
# 生产环境建议：sqlite:////var/lib/neovista/neovista.db（独立数据目录）
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./neovista.db")

# SQLite 需要特殊参数
connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# 安全日志：只打印数据库类型，不泄露凭据
db_type = DATABASE_URL.split(":")[0] if ":" in DATABASE_URL else "unknown"
print(f"✅ 数据库类型: {db_type}")
