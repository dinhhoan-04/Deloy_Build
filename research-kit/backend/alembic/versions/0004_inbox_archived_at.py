"""add archived_at to inbox_items

Revision ID: 0004_inbox_archived_at
Revises: 0003_scope_cache
Create Date: 2026-05-15
"""

from alembic import op
import sqlalchemy as sa

revision = "0004_inbox_archived_at"
down_revision = "0003_scope_cache"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "inbox_items", sa.Column("archived_at", sa.TIMESTAMP(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("inbox_items", "archived_at")
