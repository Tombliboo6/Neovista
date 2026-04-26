from sqlalchemy import text

from database import Base, create_db_engine
from models import AlertEvent, FrontendErrorEvent, GenerationEvent, User


def _column_names(connection, table_name: str):
    rows = connection.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
    return {row[1] for row in rows}


def _ensure_user_monitoring_columns(connection):
    columns = _column_names(connection, User.__tablename__)

    if "created_at" not in columns:
        connection.execute(text("ALTER TABLE users ADD COLUMN created_at DATETIME"))

    if "last_login_at" not in columns:
        connection.execute(text("ALTER TABLE users ADD COLUMN last_login_at DATETIME"))


def migrate_database(database_url: str = None):
    engine = create_db_engine(database_url)

    Base.metadata.create_all(
        bind=engine,
        tables=[
            GenerationEvent.__table__,
            FrontendErrorEvent.__table__,
            AlertEvent.__table__,
        ],
    )

    with engine.begin() as connection:
        _ensure_user_monitoring_columns(connection)

    return engine


if __name__ == "__main__":
    migrate_database()
    print("✅ Monitoring schema migration complete")
