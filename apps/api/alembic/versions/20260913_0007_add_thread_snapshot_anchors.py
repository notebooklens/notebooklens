"""Persist known per-snapshot thread placements without inventing history."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260913_0007"
down_revision = "20260413_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    anchors = op.create_table(
        "thread_snapshot_anchors",
        sa.Column("thread_id", sa.Uuid(), nullable=False),
        sa.Column("snapshot_id", sa.Uuid(), nullable=False),
        sa.Column("anchor_json", sa.JSON().with_variant(postgresql.JSONB(), "postgresql"), nullable=False),
        sa.Column("anchor_drifted", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["thread_id"], ["review_threads.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["snapshot_id"], ["review_snapshots.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("thread_id", "snapshot_id"),
    )
    op.create_index("ix_thread_snapshot_anchors_snapshot_id", "thread_snapshot_anchors", ["snapshot_id"])
    threads = sa.table(
        "review_threads", sa.column("id"), sa.column("origin_snapshot_id"),
        sa.column("current_snapshot_id"), sa.column("origin_anchor_json"),
        sa.column("anchor_json"), sa.column("status"),
    )
    fields = ["thread_id", "snapshot_id", "anchor_json", "anchor_drifted"]
    op.execute(anchors.insert().from_select(fields, sa.select(
        threads.c.id, threads.c.origin_snapshot_id, threads.c.origin_anchor_json, sa.false(),
    )))
    # Legacy current pointers always describe the last successful placement;
    # OUTDATED may refer to failure on a later snapshot with no stored mapping.
    op.execute(anchors.insert().from_select(fields, sa.select(
        threads.c.id, threads.c.current_snapshot_id, threads.c.anchor_json,
        sa.false(),
    ).where(threads.c.current_snapshot_id != threads.c.origin_snapshot_id)))


def downgrade() -> None:
    op.drop_index("ix_thread_snapshot_anchors_snapshot_id", table_name="thread_snapshot_anchors")
    op.drop_table("thread_snapshot_anchors")
