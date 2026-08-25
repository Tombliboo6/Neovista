import os

from sqlalchemy import text
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from database import Base, create_db_engine
from models import VideoGenerationTask


TABLE_NAME = VideoGenerationTask.__tablename__
MIGRATION_TABLE_NAME = f"{TABLE_NAME}__migration"

TARGET_COLUMNS = (
    "id",
    "task_id",
    "provider_task_id",
    "request_id",
    "user_id",
    "hold_transaction_id",
    "selected_model",
    "provider_model",
    "api_format",
    "prompt",
    "request_fingerprint",
    "aspect_ratio",
    "resolution",
    "duration_seconds",
    "status",
    "settlement_status",
    "attempt_count",
    "next_poll_at",
    "last_polled_at",
    "deadline_at",
    "finished_at",
    "video_url",
    "reference_paths",
    "last_provider_error",
    "error_message",
    "created_at",
    "updated_at",
)

LEGACY_REQUIRED_COLUMNS = {
    "id",
    "task_id",
    "request_id",
    "user_id",
    "hold_transaction_id",
    "selected_model",
    "provider_model",
    "prompt",
    "aspect_ratio",
    "duration_seconds",
    "status",
    "created_at",
    "updated_at",
}

NULLABLE_RECOVERY_COLUMNS = {
    "next_poll_at",
    "last_polled_at",
    "deadline_at",
    "finished_at",
    "video_url",
    "reference_paths",
    "last_provider_error",
    "error_message",
    "request_fingerprint",
}

UNRESOLVED_STATUS_SQL = (
    "lower(status) IN ('ready','creating','submitting','submit_unknown','submitted',"
    "'running','finalizing','queued','pending','created','processing','reconciliation_required')"
)

SUCCESS_STATUS_SQL = "lower(status) IN ('succeeded','success','completed')"
FAILURE_STATUS_SQL = "lower(status) IN ('failed','error','cancelled','canceled')"
UNRESOLVED_INDEX_NAME = "uq_video_generation_tasks_user_unresolved"
UNRESOLVED_INDEX_REQUIRED_TOKENS = (
    " where ",
    "submit_unknown",
    "finalizing",
    "queued",
    "pending",
    "created",
    "processing",
    "reconciliation_required",
)


def _quote_identifier(value: str) -> str:
    return f'"{value.replace(chr(34), chr(34) * 2)}"'


def _column_names(connection, table_name: str):
    table = _quote_identifier(table_name)
    rows = connection.execute(text(f"PRAGMA table_info({table})")).fetchall()
    return {row[1] for row in rows}


def _unique_index_columns(connection, table_name: str):
    table = _quote_identifier(table_name)
    unique_column_sets = set()
    for row in connection.execute(text(f"PRAGMA index_list({table})")).fetchall():
        if not row[2]:
            continue
        index_name = _quote_identifier(row[1])
        index_rows = connection.execute(text(f"PRAGMA index_info({index_name})")).fetchall()
        unique_column_sets.add(tuple(index_row[2] for index_row in index_rows))
    return unique_column_sets


def _duplicate_group_count(connection, columns: str, where_clause: str = "") -> int:
    where_sql = f" WHERE {where_clause}" if where_clause else ""
    row = connection.execute(
        text(
            f"SELECT COUNT(*) FROM ("
            f"SELECT 1 FROM {TABLE_NAME}{where_sql} "
            f"GROUP BY {columns} HAVING COUNT(*) > 1"
            f")"
        )
    ).fetchone()
    return int(row[0])


def _credit_transaction_columns(connection):
    return _column_names(connection, "credit_transactions")


def _settlement_truth_sql(credit_columns, *, outcome: str) -> str:
    required_columns = {
        "id",
        "user_id",
        "type",
        "amount",
        "status",
        "related_request_id",
    }
    if not required_columns.issubset(credit_columns):
        return "0"

    if outcome == "success":
        hold_status = "SUCCESS"
        settlement_type = "GENERATE_CAPTURE"
        opposite_type = "GENERATE_REFUND"
        settlement_amount_sql = "settlement.amount = 0"
    elif outcome == "failure":
        hold_status = "REFUNDED"
        settlement_type = "GENERATE_REFUND"
        opposite_type = "GENERATE_CAPTURE"
        settlement_amount_sql = "settlement.amount = ABS(hold.amount)"
    else:
        raise ValueError(f"Unsupported settlement outcome: {outcome}")

    outer_user_id = f"{TABLE_NAME}.user_id"
    outer_request_id = f"{TABLE_NAME}.request_id"
    outer_hold_id = f"{TABLE_NAME}.hold_transaction_id"
    settlement_key_sql = (
        "'generation-hold' || char(58) || CAST(hold.id AS TEXT) || "
        "char(58) || 'settlement'"
    )

    if "settlement_key" in credit_columns:
        association_sql = (
            f"settlement.related_request_id = {outer_request_id} AND "
            f"(settlement.settlement_key = ({settlement_key_sql}) OR "
            "settlement.settlement_key IS NULL)"
        )
        opposite_association_sql = (
            f"opposite.related_request_id = {outer_request_id} AND "
            f"(opposite.settlement_key = ({settlement_key_sql}) OR "
            "opposite.settlement_key IS NULL)"
        )
    else:
        association_sql = f"settlement.related_request_id = {outer_request_id}"
        opposite_association_sql = f"opposite.related_request_id = {outer_request_id}"

    if "created_at" in credit_columns:
        association_sql += (
            " AND (hold.created_at IS NULL OR settlement.created_at >= hold.created_at)"
        )
        opposite_association_sql += (
            " AND (hold.created_at IS NULL OR opposite.created_at >= hold.created_at)"
        )

    return (
        "EXISTS (SELECT 1 FROM credit_transactions AS hold "
        f"WHERE hold.id = {outer_hold_id} "
        f"AND hold.user_id = {outer_user_id} "
        "AND hold.type = 'GENERATE_HOLD' "
        f"AND hold.status = '{hold_status}' "
        f"AND hold.related_request_id = {outer_request_id} "
        "AND hold.amount < 0 "
        "AND (SELECT COUNT(*) FROM credit_transactions AS settlement "
        f"WHERE settlement.user_id = {outer_user_id} "
        f"AND settlement.type = '{settlement_type}' "
        "AND settlement.status = 'SUCCESS' "
        f"AND {settlement_amount_sql} "
        f"AND {association_sql}) = 1 "
        "AND NOT EXISTS (SELECT 1 FROM credit_transactions AS opposite "
        f"WHERE opposite.user_id = {outer_user_id} "
        f"AND opposite.type = '{opposite_type}' "
        "AND opposite.status = 'SUCCESS' "
        f"AND {opposite_association_sql}))"
    )


def _copy_expression(
    column: str,
    existing_columns,
    *,
    provider_task_id_was_missing: bool,
    credit_transaction_columns,
) -> str:
    if column == "provider_task_id":
        return "task_id" if provider_task_id_was_missing else "provider_task_id"
    if column == "api_format":
        return "COALESCE(api_format, 'v3')" if column in existing_columns else "'v3'"
    if column == "resolution":
        return "COALESCE(resolution, '720p')" if column in existing_columns else "'720p'"
    if column == "settlement_status":
        existing_value = "COALESCE(settlement_status, 'PENDING')" if column in existing_columns else "'PENDING'"
        success_truth_sql = _settlement_truth_sql(
            credit_transaction_columns,
            outcome="success",
        )
        failure_truth_sql = _settlement_truth_sql(
            credit_transaction_columns,
            outcome="failure",
        )
        return (
            "CASE "
            "WHEN lower(status) IN ('succeeded', 'success', 'completed') THEN "
            f"CASE WHEN {success_truth_sql} THEN 'CAPTURED' ELSE 'REVIEW_REQUIRED' END "
            "WHEN lower(status) IN ('failed', 'error', 'cancelled', 'canceled') THEN "
            f"CASE WHEN {failure_truth_sql} THEN 'REFUNDED' ELSE 'REVIEW_REQUIRED' END "
            f"ELSE {existing_value} END"
        )
    if column == "attempt_count":
        return "COALESCE(attempt_count, 0)" if column in existing_columns else "0"
    if column == "deadline_at":
        existing_value = "deadline_at" if column in existing_columns else "NULL"
        return (
            "CASE WHEN lower(status) IN "
            "('ready', 'creating', 'submitting', 'submit_unknown', 'submitted', 'running', 'finalizing', "
            "'queued', 'pending', 'created', 'processing') "
            f"THEN COALESCE({existing_value}, datetime(created_at, '+2 hours')) ELSE {existing_value} END"
        )
    if column in NULLABLE_RECOVERY_COLUMNS and column not in existing_columns:
        return "NULL"
    return column


def _create_replacement_table(connection):
    connection.execute(text(f"DROP TABLE IF EXISTS {MIGRATION_TABLE_NAME}"))
    connection.execute(
        text(
            f"""
            CREATE TABLE {MIGRATION_TABLE_NAME} (
                id INTEGER NOT NULL PRIMARY KEY,
                task_id VARCHAR(96) NOT NULL,
                provider_task_id VARCHAR(96),
                request_id VARCHAR(64) NOT NULL,
                user_id INTEGER NOT NULL,
                hold_transaction_id INTEGER NOT NULL,
                selected_model VARCHAR(64) NOT NULL,
                provider_model VARCHAR(96) NOT NULL,
                api_format VARCHAR(16) NOT NULL DEFAULT 'v3',
                prompt TEXT NOT NULL,
                request_fingerprint VARCHAR(64),
                aspect_ratio VARCHAR(16) NOT NULL,
                resolution VARCHAR(16) NOT NULL DEFAULT '720p',
                duration_seconds INTEGER NOT NULL,
                status VARCHAR(24) NOT NULL,
                settlement_status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
                attempt_count INTEGER NOT NULL DEFAULT 0,
                next_poll_at DATETIME,
                last_polled_at DATETIME,
                deadline_at DATETIME,
                finished_at DATETIME,
                video_url TEXT,
                reference_paths TEXT,
                last_provider_error TEXT,
                error_message TEXT,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users (id),
                FOREIGN KEY(hold_transaction_id) REFERENCES credit_transactions (id)
            )
            """
        )
    )


def _create_indexes(connection):
    index_statements = (
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_video_generation_tasks_task_id "
        "ON video_generation_tasks (task_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_video_generation_tasks_user_request "
        "ON video_generation_tasks (user_id, request_id)",
        "CREATE INDEX IF NOT EXISTS ix_video_generation_tasks_id "
        "ON video_generation_tasks (id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_video_generation_tasks_provider_task_id "
        "ON video_generation_tasks (provider_task_id)",
        "CREATE INDEX IF NOT EXISTS ix_video_generation_tasks_request_id "
        "ON video_generation_tasks (request_id)",
        "CREATE INDEX IF NOT EXISTS ix_video_generation_tasks_user_id "
        "ON video_generation_tasks (user_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_video_generation_tasks_hold_transaction_id "
        "ON video_generation_tasks (hold_transaction_id)",
        f"CREATE UNIQUE INDEX IF NOT EXISTS {UNRESOLVED_INDEX_NAME} "
        f"ON video_generation_tasks (user_id) WHERE {UNRESOLVED_STATUS_SQL}",
        "CREATE INDEX IF NOT EXISTS ix_video_generation_tasks_selected_model "
        "ON video_generation_tasks (selected_model)",
        "CREATE INDEX IF NOT EXISTS ix_video_generation_tasks_status "
        "ON video_generation_tasks (status)",
        "CREATE INDEX IF NOT EXISTS ix_video_generation_tasks_settlement_status "
        "ON video_generation_tasks (settlement_status)",
        "CREATE INDEX IF NOT EXISTS ix_video_generation_tasks_next_poll_at "
        "ON video_generation_tasks (next_poll_at)",
    )
    for statement in index_statements:
        connection.execute(text(statement))


def _refresh_unresolved_partial_index_definition(connection):
    existing_sql = connection.execute(
        text(
            "SELECT sql FROM sqlite_master "
            "WHERE type = 'index' AND name = :index_name"
        ),
        {"index_name": UNRESOLVED_INDEX_NAME},
    ).scalar()
    if not existing_sql:
        return
    normalized_sql = " ".join(str(existing_sql).lower().split())
    if all(token in normalized_sql for token in UNRESOLVED_INDEX_REQUIRED_TOKENS):
        return
    connection.execute(text(f'DROP INDEX "{UNRESOLVED_INDEX_NAME}"'))


def _backfill_recovery_state(connection):
    connection.execute(
        text(
            "UPDATE video_generation_tasks "
            "SET deadline_at = datetime(created_at, '+2 hours') "
            "WHERE deadline_at IS NULL AND lower(status) IN "
            "('ready', 'creating', 'submitting', 'submit_unknown', 'submitted', 'running', 'finalizing', "
            "'queued', 'pending', 'created', 'processing')"
        )
    )
    credit_transaction_columns = _credit_transaction_columns(connection)
    success_truth_sql = _settlement_truth_sql(
        credit_transaction_columns,
        outcome="success",
    )
    failure_truth_sql = _settlement_truth_sql(
        credit_transaction_columns,
        outcome="failure",
    )
    connection.execute(
        text(
            "UPDATE video_generation_tasks SET settlement_status = CASE "
            "WHEN lower(status) IN ('succeeded', 'success', 'completed') THEN "
            f"CASE WHEN {success_truth_sql} THEN 'CAPTURED' ELSE 'REVIEW_REQUIRED' END "
            "WHEN lower(status) IN ('failed', 'error', 'cancelled', 'canceled') THEN "
            f"CASE WHEN {failure_truth_sql} THEN 'REFUNDED' ELSE 'REVIEW_REQUIRED' END "
            "ELSE settlement_status END "
            "WHERE lower(status) IN "
            "('succeeded', 'success', 'completed', 'failed', 'error', 'cancelled', 'canceled')"
        )
    )
    connection.execute(
        text(
            "UPDATE video_generation_tasks "
            "SET status = 'reconciliation_required', "
            "error_message = COALESCE(error_message, 'Legacy terminal task requires settlement review') "
            "WHERE settlement_status = 'REVIEW_REQUIRED' AND lower(status) IN "
            "('succeeded', 'success', 'completed', 'failed', 'error', 'cancelled', 'canceled')"
        )
    )


def _normalize_status_values(connection):
    connection.execute(
        text(
            "UPDATE video_generation_tasks SET status = CASE "
            "WHEN lower(status) IN ('queued', 'pending', 'created') THEN 'submitted' "
            "WHEN lower(status) = 'processing' THEN 'running' "
            "ELSE lower(status) END "
            "WHERE lower(status) IN "
            "('ready', 'creating', 'submitting', 'submit_unknown', 'submitted', 'running', "
            "'finalizing', 'queued', 'pending', 'created', 'processing', "
            "'reconciliation_required', 'succeeded', 'success', 'completed', "
            "'failed', 'error', 'cancelled', 'canceled')"
        )
    )


def _future_unresolved_status_sql(connection) -> str:
    credit_transaction_columns = _credit_transaction_columns(connection)
    success_truth_sql = _settlement_truth_sql(
        credit_transaction_columns,
        outcome="success",
    )
    failure_truth_sql = _settlement_truth_sql(
        credit_transaction_columns,
        outcome="failure",
    )
    terminal_review_sql = (
        f"({SUCCESS_STATUS_SQL} AND NOT ({success_truth_sql})) OR "
        f"({FAILURE_STATUS_SQL} AND NOT ({failure_truth_sql}))"
    )
    return f"({UNRESOLVED_STATUS_SQL} OR {terminal_review_sql})"


def _validate_future_unresolved_uniqueness(connection):
    future_where = _future_unresolved_status_sql(connection)
    if _duplicate_group_count(connection, "user_id", future_where):
        raise RuntimeError(
            "video_generation_tasks 在恢复状态投影后存在同一用户的多个未完成/待复核任务；"
            "请按供应商证据逐条处理后重试迁移"
        )


def _rebuild_table(connection, existing_columns):
    missing_required = LEGACY_REQUIRED_COLUMNS - existing_columns
    if missing_required:
        missing = ", ".join(sorted(missing_required))
        raise RuntimeError(f"video_generation_tasks 缺少不可恢复字段: {missing}")
    if _duplicate_group_count(connection, "task_id"):
        raise RuntimeError("video_generation_tasks 存在重复 task_id，无法安全迁移")
    if _duplicate_group_count(connection, "user_id, request_id"):
        raise RuntimeError("video_generation_tasks 存在重复的用户 request_id，无法安全迁移")
    if "provider_task_id" in existing_columns and _duplicate_group_count(
        connection,
        "provider_task_id",
        "provider_task_id IS NOT NULL",
    ):
        raise RuntimeError("video_generation_tasks 存在重复 provider_task_id，无法安全迁移")
    if _duplicate_group_count(connection, "hold_transaction_id"):
        raise RuntimeError("video_generation_tasks 存在重复 hold_transaction_id，无法安全迁移")
    if _duplicate_group_count(connection, "user_id", UNRESOLVED_STATUS_SQL):
        raise RuntimeError("video_generation_tasks 存在同一用户的多个未完成任务，无法安全迁移")

    provider_task_id_was_missing = "provider_task_id" not in existing_columns
    credit_transaction_columns = _credit_transaction_columns(connection)
    _create_replacement_table(connection)
    target_columns = ", ".join(TARGET_COLUMNS)
    select_expressions = ", ".join(
        _copy_expression(
            column,
            existing_columns,
            provider_task_id_was_missing=provider_task_id_was_missing,
            credit_transaction_columns=credit_transaction_columns,
        )
        for column in TARGET_COLUMNS
    )
    connection.execute(
        text(
            f"INSERT INTO {MIGRATION_TABLE_NAME} ({target_columns}) "
            f"SELECT {select_expressions} FROM {TABLE_NAME}"
        )
    )
    connection.execute(text(f"DROP TABLE {TABLE_NAME}"))
    connection.execute(
        text(f"ALTER TABLE {MIGRATION_TABLE_NAME} RENAME TO {TABLE_NAME}")
    )


def _validate_postmigration_uniqueness(connection):
    if _duplicate_group_count(connection, "task_id"):
        raise RuntimeError("video_generation_tasks 存在重复 task_id，无法安全建立唯一索引")
    if _duplicate_group_count(connection, "user_id, request_id"):
        raise RuntimeError("video_generation_tasks 存在重复的用户 request_id，无法安全建立唯一索引")
    if _duplicate_group_count(
        connection,
        "provider_task_id",
        "provider_task_id IS NOT NULL",
    ):
        raise RuntimeError("video_generation_tasks 存在重复 provider_task_id，无法安全建立唯一索引")
    if _duplicate_group_count(connection, "hold_transaction_id"):
        raise RuntimeError("video_generation_tasks 存在重复 hold_transaction_id，无法安全建立唯一索引")
    if _duplicate_group_count(connection, "user_id", UNRESOLVED_STATUS_SQL):
        raise RuntimeError(
            "video_generation_tasks 在恢复状态回填后存在同一用户的多个未完成/待复核任务；"
            "请按供应商证据逐条处理后重试迁移"
        )


def migrate_database(database_url: str = None):
    engine = create_db_engine(database_url)
    Base.metadata.create_all(bind=engine, tables=[VideoGenerationTask.__table__])

    with engine.begin() as connection:
        if connection.dialect.name != "sqlite":
            raise RuntimeError("Video generation schema migration currently supports SQLite only")

        columns = _column_names(connection, TABLE_NAME)
        _validate_future_unresolved_uniqueness(connection)
        _normalize_status_values(connection)
        unique_column_sets = _unique_index_columns(connection, TABLE_NAME)
        needs_rebuild = (
            not set(TARGET_COLUMNS).issubset(columns)
            or ("request_id",) in unique_column_sets
            or ("user_id", "request_id") not in unique_column_sets
        )
        if needs_rebuild:
            _rebuild_table(connection, columns)
        _backfill_recovery_state(connection)
        _validate_postmigration_uniqueness(connection)
        _refresh_unresolved_partial_index_definition(connection)
        _create_indexes(connection)

    return engine


if __name__ == "__main__":
    migrate_database()
    print("✅ Video generation schema migration complete")
