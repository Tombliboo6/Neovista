from sqlalchemy import create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os

# 从环境变量读取数据库 URL
# 开发环境默认：sqlite:///./neovista.db（当前目录）
# 生产环境建议：sqlite:////var/lib/neovista/neovista.db（独立数据目录）
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./neovista.db")

def get_connect_args(database_url: str):
    if database_url.startswith("sqlite"):
        return {"check_same_thread": False, "timeout": 30}
    return {}

def create_db_engine(database_url: str = None):
    resolved_url = database_url or DATABASE_URL
    engine = create_engine(
        resolved_url,
        connect_args=get_connect_args(resolved_url),
        pool_pre_ping=True,
    )
    if resolved_url.startswith("sqlite"):
        is_memory_database = ":memory:" in resolved_url

        @event.listens_for(engine, "connect")
        def _configure_sqlite_connection(dbapi_connection, _connection_record):
            cursor = dbapi_connection.cursor()
            try:
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.execute("PRAGMA busy_timeout=30000")
                if not is_memory_database:
                    cursor.execute("PRAGMA journal_mode=WAL")
                    cursor.execute("PRAGMA synchronous=NORMAL")
            finally:
                cursor.close()

    return engine

engine = create_db_engine(DATABASE_URL)
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
