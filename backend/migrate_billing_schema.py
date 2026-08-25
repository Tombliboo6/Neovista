from sqlalchemy import text

from database import create_db_engine, Base
from models import AdminAuditLog, ChatSession, CreditTransaction, RedemptionCode, UsageCounter


def _column_names(connection, table_name: str):
    rows = connection.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
    return {row[1] for row in rows}


def _normalize_unambiguous_legacy_hold_settlements(connection):
    """Bind old settlement rows to holds without changing any user balance.

    A legacy deployment could write a successful capture/refund transaction
    but leave its hold PENDING.  Replaying settlement after the new schema is
    deployed would be especially dangerous for refunds.  Only an exact,
    unambiguous user/request/time/amount match is repaired automatically; all
    other cases remain PENDING for explicit operator review.
    """

    holds = connection.execute(
        text(
            "SELECT id, user_id, related_request_id, amount, created_at "
            "FROM credit_transactions "
            "WHERE type = 'GENERATE_HOLD' AND status = 'PENDING' "
            "AND related_request_id IS NOT NULL "
            "ORDER BY id"
        )
    ).mappings().all()
    repaired = 0
    for hold in holds:
        settlement_key = f"generation-hold:{hold['id']}:settlement"
        candidates = connection.execute(
            text(
                "SELECT id, type, amount, settlement_key, created_at "
                "FROM credit_transactions "
                "WHERE user_id = :user_id "
                "AND related_request_id = :request_id "
                "AND type IN ('GENERATE_CAPTURE', 'GENERATE_REFUND') "
                "AND status = 'SUCCESS' "
                "AND created_at >= :hold_created_at "
                "ORDER BY id"
            ),
            {
                "user_id": hold["user_id"],
                "request_id": hold["related_request_id"],
                "hold_created_at": hold["created_at"],
            },
        ).mappings().all()
        refund_amount = abs(int(hold["amount"] or 0))
        candidates = [
            candidate
            for candidate in candidates
            if (
                candidate["type"] == "GENERATE_CAPTURE"
                and int(candidate["amount"] or 0) == 0
            )
            or (
                candidate["type"] == "GENERATE_REFUND"
                and int(candidate["amount"] or 0) == refund_amount
            )
        ]
        if len(candidates) != 1:
            continue
        settlement = candidates[0]
        if settlement["settlement_key"] not in (None, settlement_key):
            continue

        possible_holds = connection.execute(
            text(
                "SELECT COUNT(*) FROM credit_transactions "
                "WHERE user_id = :user_id "
                "AND related_request_id = :request_id "
                "AND type = 'GENERATE_HOLD' "
                "AND created_at <= :settlement_created_at"
            ),
            {
                "user_id": hold["user_id"],
                "request_id": hold["related_request_id"],
                "settlement_created_at": settlement["created_at"],
            },
        ).scalar_one()
        if possible_holds != 1:
            continue

        terminal_status = (
            "SUCCESS" if settlement["type"] == "GENERATE_CAPTURE" else "REFUNDED"
        )
        connection.execute(
            text(
                "UPDATE credit_transactions "
                "SET settlement_key = :settlement_key "
                "WHERE id = :settlement_id AND settlement_key IS NULL"
            ),
            {
                "settlement_key": settlement_key,
                "settlement_id": settlement["id"],
            },
        )
        connection.execute(
            text(
                "UPDATE credit_transactions "
                "SET status = :terminal_status, "
                "idempotency_key = CASE "
                "WHEN :terminal_status = 'REFUNDED' THEN NULL "
                "ELSE idempotency_key END, "
                "updated_at = CURRENT_TIMESTAMP "
                "WHERE id = :hold_id AND status = 'PENDING'"
            ),
            {
                "terminal_status": terminal_status,
                "hold_id": hold["id"],
            },
        )
        repaired += 1
    return repaired


def migrate_database(database_url: str = None):
    engine = create_db_engine(database_url)
    Base.metadata.create_all(
        bind=engine,
        tables=[
            CreditTransaction.__table__,
            RedemptionCode.__table__,
            AdminAuditLog.__table__,
            UsageCounter.__table__,
            ChatSession.__table__,
        ],
    )
    with engine.begin() as connection:
        columns = _column_names(connection, CreditTransaction.__tablename__)
        if "settlement_key" not in columns:
            connection.execute(
                text(
                    "ALTER TABLE credit_transactions "
                    "ADD COLUMN settlement_key VARCHAR(128)"
                )
            )
        _normalize_unambiguous_legacy_hold_settlements(connection)
        connection.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS "
                "uq_credit_transactions_settlement_key "
                "ON credit_transactions (settlement_key)"
            )
        )
        connection.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_usage_lookup "
                "ON usage_counters (subject_type, subject_key, action, bucket_date)"
            )
        )
        chat_session_columns = _column_names(connection, ChatSession.__tablename__)
        if "user_id" not in chat_session_columns:
            connection.execute(
                text(
                    "ALTER TABLE chat_sessions "
                    "ADD COLUMN user_id INTEGER REFERENCES users(id)"
                )
            )
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_chat_sessions_user_id "
                "ON chat_sessions (user_id)"
            )
        )
    return engine


if __name__ == "__main__":
    migrate_database()
    print("✅ Billing schema migration complete")
