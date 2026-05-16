"""add resolved_at and accepted_claim_id to conflicts

Revision ID: 0006_conflict_resolved
Revises: 0005_drafts
Create Date: 2026-05-15
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0006_conflict_resolved"
down_revision = "0005_drafts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("conflicts",
        sa.Column("resolved_at", sa.TIMESTAMP(timezone=True), nullable=True))
    op.add_column("conflicts",
        sa.Column("accepted_claim_id", postgresql.UUID(as_uuid=True), nullable=True))


def downgrade() -> None:
    op.drop_column("conflicts", "accepted_claim_id")
    op.drop_column("conflicts", "resolved_at")
