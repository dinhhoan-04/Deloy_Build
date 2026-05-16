"""paper_content cache table

Revision ID: 0002_paper_content
Revises: 0001_initial
Create Date: 2026-05-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0002_paper_content"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "paper_content",
        sa.Column("url_key", sa.Text(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("fetch_reason", sa.Text(), nullable=True),
        sa.Column("fetched_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("url_key"),
    )


def downgrade() -> None:
    op.drop_table("paper_content")
