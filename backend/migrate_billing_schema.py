from sqlalchemy import text

from database import create_db_engine, Base
from models import AdminAuditLog, CreditTransaction, RedemptionCode, UsageCounter


def migrate_database(database_url: str = None):
    engine = create_db_engine(database_url)
    Base.metadata.create_all(
        bind=engine,
        tables=[
            CreditTransaction.__table__,
            RedemptionCode.__table__,
            AdminAuditLog.__table__,
            UsageCounter.__table__,
        ],
    )
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_usage_lookup "
                "ON usage_counters (subject_type, subject_key, action, bucket_date)"
            )
        )
    return engine


if __name__ == "__main__":
    migrate_database()
    print("✅ Billing schema migration complete")
