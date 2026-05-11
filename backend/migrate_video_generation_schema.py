import os

from sqlalchemy import text
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from database import Base, create_db_engine
from models import VideoGenerationTask


def _column_names(connection, table_name: str):
    rows = connection.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
    return {row[1] for row in rows}


def migrate_database(database_url: str = None):
    engine = create_db_engine(database_url)
    Base.metadata.create_all(bind=engine, tables=[VideoGenerationTask.__table__])

    with engine.begin() as connection:
        columns = _column_names(connection, VideoGenerationTask.__tablename__)
        if "resolution" not in columns:
            connection.execute(
                text("ALTER TABLE video_generation_tasks ADD COLUMN resolution VARCHAR(16) NOT NULL DEFAULT '720p'")
            )
        if "api_format" not in columns:
            connection.execute(
                text("ALTER TABLE video_generation_tasks ADD COLUMN api_format VARCHAR(16) NOT NULL DEFAULT 'v3'")
            )

    return engine


if __name__ == "__main__":
    migrate_database()
    print("✅ Video generation schema migration complete")
