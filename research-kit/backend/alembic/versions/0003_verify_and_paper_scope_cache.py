"""scoped caches for verify and paper content

Revision ID: 0003_scope_cache
Revises: 0002_paper_content
Create Date: 2026-05-13
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0003_scope_cache"
down_revision = "0002_paper_content"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "paper_content_cache",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("paper_key", sa.Text(), nullable=False),
        sa.Column("paper_title", sa.Text(), nullable=True),
        sa.Column("doi", sa.Text(), nullable=True),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("chars", sa.Integer(), nullable=False),
        sa.Column("fetch_source", sa.Text(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "project_id", "paper_key"),
    )
    op.create_index("ix_paper_content_cache_doi", "paper_content_cache", ["doi"])
    op.create_index("ix_paper_content_cache_expires_at", "paper_content_cache", ["expires_at"])
    op.create_index(
        "ix_paper_content_cache_scope_exp",
        "paper_content_cache",
        ["user_id", "project_id", "expires_at"],
    )

    op.create_table(
        "verify_result_cache",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("paper_key", sa.Text(), nullable=False),
        sa.Column("claim_hash", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("verbatim_quote", sa.Text(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("provider_used", sa.Text(), nullable=True),
        sa.Column("cached_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "project_id", "paper_key", "claim_hash"),
    )
    op.create_index("ix_verify_result_cache_expires_at", "verify_result_cache", ["expires_at"])
    op.create_index(
        "ix_verify_result_cache_scope_exp",
        "verify_result_cache",
        ["user_id", "project_id", "expires_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_verify_result_cache_scope_exp", table_name="verify_result_cache")
    op.drop_index("ix_verify_result_cache_expires_at", table_name="verify_result_cache")
    op.drop_table("verify_result_cache")

    op.drop_index("ix_paper_content_cache_scope_exp", table_name="paper_content_cache")
    op.drop_index("ix_paper_content_cache_expires_at", table_name="paper_content_cache")
    op.drop_index("ix_paper_content_cache_doi", table_name="paper_content_cache")
    op.drop_table("paper_content_cache")
