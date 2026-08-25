"""Forward-only, additive image-generation reliability schema migration.

The legacy application does not reference ``image_generation_tasks``, so a
code rollback remains compatible while this table is retained.  The migration
never settles or refunds historical holds: ambiguous legacy ``generate:*`` and
``generate-diagram:*`` holds must remain available for operator review.
"""

import hashlib

from sqlalchemy import inspect, or_, text
from sqlalchemy.orm import sessionmaker

from database import Base, create_db_engine
from models import CreditTransaction, ImageGenerationTask


REQUIRED_COLUMNS = {
    "id",
    "task_id",
    "request_id",
    "user_id",
    "hold_transaction_id",
    "entrypoint",
    "template_id",
    "selected_model",
    "request_fingerprint",
    "resolution",
    "aspect_ratio",
    "num_images",
    "status",
    "settlement_status",
    "provider_name",
    "image_url",
    "result_size_bytes",
    "result_expires_at",
    "last_provider_error",
    "error_message",
    "finished_at",
    "created_at",
    "updated_at",
}


def _unique_index_columns(connection):
    rows = connection.execute(text("PRAGMA index_list(image_generation_tasks)")).fetchall()
    result = set()
    for row in rows:
        if not row[2]:
            continue
        index_name = str(row[1]).replace('"', '""')
        index_rows = connection.execute(
            text(f'PRAGMA index_info("{index_name}")')
        ).fetchall()
        result.add(tuple(index_row[2] for index_row in index_rows))
    return result


def migrate_database(database_url: str = None):
    engine = create_db_engine(database_url)
    Base.metadata.create_all(bind=engine, tables=[ImageGenerationTask.__table__])

    inspector = inspect(engine)
    columns = {
        column["name"]
        for column in inspector.get_columns(ImageGenerationTask.__tablename__)
    }
    missing_columns = REQUIRED_COLUMNS - columns
    if missing_columns:
        engine.dispose()
        raise RuntimeError(
            "image_generation_tasks 存在不兼容的部分结构，缺少列："
            + ", ".join(sorted(missing_columns))
        )

    with engine.begin() as connection:
        if engine.dialect.name == "sqlite":
            unique_columns = _unique_index_columns(connection)
            required_unique_columns = {
                ("task_id",),
                ("user_id", "request_id"),
                ("hold_transaction_id",),
            }
            if not required_unique_columns.issubset(unique_columns):
                raise RuntimeError("image_generation_tasks 缺少生产必需的唯一索引")

    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    db = Session()
    try:
        orphan_holds = (
            db.query(CreditTransaction)
            .outerjoin(
                ImageGenerationTask,
                ImageGenerationTask.hold_transaction_id == CreditTransaction.id,
            )
            .filter(
                CreditTransaction.type == "GENERATE_HOLD",
                CreditTransaction.status == "PENDING",
                or_(
                    CreditTransaction.idempotency_key.like("image-generate:%"),
                    CreditTransaction.idempotency_key.like("generate:%"),
                    CreditTransaction.idempotency_key.like("generate-diagram:%"),
                ),
                ImageGenerationTask.id.is_(None),
            )
            .order_by(CreditTransaction.id.asc())
            .all()
        )
        for hold in orphan_holds:
            request_id = (hold.related_request_id or f"legacy-hold-{hold.id}")[:64]
            collision = db.query(ImageGenerationTask).filter(
                ImageGenerationTask.user_id == hold.user_id,
                ImageGenerationTask.request_id == request_id,
            ).first()
            if collision:
                raise RuntimeError(
                    f"历史生图预占 {hold.id} 与任务 {collision.task_id} 的 user/request 冲突"
                )
            idempotency_key = hold.idempotency_key or ""
            entrypoint = (
                "generate_diagram"
                if idempotency_key.startswith("generate-diagram:")
                else "generate"
            )
            fingerprint = hashlib.sha256(
                f"legacy-image-hold:{hold.id}:{hold.user_id}:{request_id}".encode("utf-8")
            ).hexdigest()
            db.add(ImageGenerationTask(
                task_id=f"legacy-image-hold-{hold.id}",
                request_id=request_id,
                user_id=hold.user_id,
                hold_transaction_id=hold.id,
                entrypoint=entrypoint,
                template_id=None,
                selected_model="legacy-unknown",
                request_fingerprint=fingerprint,
                resolution="unknown",
                aspect_ratio="unknown",
                num_images=1,
                status="reconciliation_required",
                settlement_status="REVIEW_REQUIRED",
                last_provider_error="历史任务缺少供应商终态",
                error_message="迁移发现历史生图积分预占；未自动退款或扣款，需要管理员显式结算",
                created_at=hold.created_at,
                updated_at=hold.updated_at or hold.created_at,
            ))
        db.commit()
    except Exception:
        db.rollback()
        engine.dispose()
        raise
    finally:
        db.close()

    return engine


if __name__ == "__main__":
    migrate_database()
    print("✅ Image generation schema migration complete")
