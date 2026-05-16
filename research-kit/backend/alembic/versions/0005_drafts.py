"""add drafts table

Revision ID: 0005_drafts
Revises: 0004_inbox_archived_at
Create Date: 2026-05-15
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0005_drafts'
down_revision = '0004_inbox_archived_at'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'drafts',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('project_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('run_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('runs.id', ondelete='SET NULL'), nullable=True),
        sa.Column('title', sa.Text(), nullable=False, server_default='Untitled Draft'),
        sa.Column('markdown', sa.Text(), nullable=False),
        sa.Column('sections', postgresql.JSONB(), nullable=False, server_default='[]'),
        sa.Column('created_at', sa.TIMESTAMP(), nullable=False,
                  server_default=sa.text('now()')),
        sa.Column('updated_at', sa.TIMESTAMP(), nullable=False,
                  server_default=sa.text('now()')),
        sa.UniqueConstraint('project_id', 'user_id', name='uq_drafts_project_user'),
    )


def downgrade() -> None:
    op.drop_table('drafts')
