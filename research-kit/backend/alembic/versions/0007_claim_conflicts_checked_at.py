"""add conflicts_checked_at to claims

Revision ID: 0007_claim_conflicts_checked_at
Revises: 0006_conflict_resolved
Create Date: 2026-05-16
"""

from alembic import op
import sqlalchemy as sa

revision = "0007_claim_conflicts_checked_at"
down_revision = "0006_conflict_resolved"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "claims",
        sa.Column("conflicts_checked_at", sa.TIMESTAMP(timezone=False), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("claims", "conflicts_checked_at")
