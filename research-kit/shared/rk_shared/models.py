from __future__ import annotations
import uuid
from datetime import datetime
from sqlalchemy import (
    BigInteger, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func, TIMESTAMP
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def _uuid_pk():
    return mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class User(Base):
    __tablename__ = "users"
    id:          Mapped[uuid.UUID] = _uuid_pk()
    google_sub:  Mapped[str]       = mapped_column(Text, unique=True, nullable=False)
    email:       Mapped[str]       = mapped_column(Text, nullable=False)
    name:        Mapped[str | None] = mapped_column(Text)
    created_at:  Mapped[datetime]  = mapped_column(server_default=func.now(), nullable=False)


class Session(Base):
    __tablename__ = "sessions"
    token_hash:    Mapped[str]       = mapped_column(Text, primary_key=True)
    user_id:       Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                     ForeignKey("users.id", ondelete="CASCADE"),
                                                     nullable=False, index=True)
    created_at:    Mapped[datetime]  = mapped_column(nullable=False)
    expires_at:    Mapped[datetime]  = mapped_column(nullable=False, index=True)
    last_used_at:  Mapped[datetime]  = mapped_column(nullable=False)


class Project(Base):
    __tablename__ = "projects"
    id:         Mapped[uuid.UUID] = _uuid_pk()
    user_id:    Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                  ForeignKey("users.id", ondelete="CASCADE"),
                                                  nullable=False, index=True)
    name:       Mapped[str]       = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime]  = mapped_column(server_default=func.now(), nullable=False)


class Claim(Base):
    __tablename__ = "claims"
    id:           Mapped[uuid.UUID] = _uuid_pk()
    user_id:      Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                    ForeignKey("users.id", ondelete="CASCADE"),
                                                    nullable=False)
    project_id:   Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                    ForeignKey("projects.id", ondelete="CASCADE"),
                                                    nullable=False)
    text:         Mapped[str]       = mapped_column(Text, nullable=False)
    paper_title:  Mapped[str | None] = mapped_column(Text)
    doi:          Mapped[str | None] = mapped_column(Text, index=True)
    paper_url:    Mapped[str | None] = mapped_column(Text)
    page:         Mapped[str | None] = mapped_column(Text)
    site:         Mapped[str]       = mapped_column(Text, nullable=False)
    status:       Mapped[str]       = mapped_column(Text, nullable=False)
    confidence:   Mapped[float | None] = mapped_column(Float)
    quote:        Mapped[str | None] = mapped_column(Text)
    reason:       Mapped[str | None] = mapped_column(Text)
    page_url:     Mapped[str | None] = mapped_column(Text)
    extracted_at: Mapped[datetime | None]
    created_at:   Mapped[datetime]  = mapped_column(server_default=func.now(), nullable=False)
    updated_at:   Mapped[datetime]  = mapped_column(server_default=func.now(),
                                                    onupdate=func.now(), nullable=False)
    conflicts_checked_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=False), nullable=True)
    __table_args__ = (Index("ix_claims_project_status", "project_id", "status"),)


class InboxItem(Base):
    __tablename__ = "inbox_items"
    id:         Mapped[uuid.UUID] = _uuid_pk()
    user_id:    Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                  ForeignKey("users.id", ondelete="CASCADE"),
                                                  nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                  ForeignKey("projects.id", ondelete="CASCADE"),
                                                  nullable=False)
    claim_id:   Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                  ForeignKey("claims.id", ondelete="CASCADE"),
                                                  nullable=False)
    saved_at:    Mapped[datetime]      = mapped_column(server_default=func.now(), nullable=False)
    archived_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    __table_args__ = (UniqueConstraint("project_id", "claim_id", name="uq_inbox_project_claim"),)


class Conflict(Base):
    __tablename__ = "conflicts"
    id:           Mapped[uuid.UUID] = _uuid_pk()
    user_id:      Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                    ForeignKey("users.id", ondelete="CASCADE"),
                                                    nullable=False)
    project_id:   Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                    ForeignKey("projects.id", ondelete="CASCADE"),
                                                    nullable=False, index=True)
    doi:          Mapped[str | None] = mapped_column(Text)
    group_key:    Mapped[str]       = mapped_column(Text, nullable=False)
    paper_title:  Mapped[str | None] = mapped_column(Text)
    flagged_at:   Mapped[datetime]  = mapped_column(server_default=func.now(), nullable=False)
    resolution:   Mapped[str | None] = mapped_column(Text)
    sides:        Mapped[dict]      = mapped_column(JSONB, nullable=False)
    resolved_at:        Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    accepted_claim_id:  Mapped[uuid.UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)


class Run(Base):
    __tablename__ = "runs"
    id:               Mapped[uuid.UUID] = _uuid_pk()
    user_id:          Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                        ForeignKey("users.id", ondelete="CASCADE"),
                                                        nullable=False)
    project_id:       Mapped[uuid.UUID | None] = mapped_column(PG_UUID(as_uuid=True),
                                                               ForeignKey("projects.id", ondelete="SET NULL"))
    kind:             Mapped[str] = mapped_column(Text, nullable=False)
    status:           Mapped[str] = mapped_column(Text, nullable=False)
    input:            Mapped[dict]      = mapped_column(JSONB, nullable=False)
    result:           Mapped[dict | None] = mapped_column(JSONB)
    error:            Mapped[dict | None] = mapped_column(JSONB)
    goclaw_run_id:    Mapped[str | None] = mapped_column(Text)
    idempotency_key:  Mapped[str | None] = mapped_column(Text)
    created_at:       Mapped[datetime]  = mapped_column(server_default=func.now(), nullable=False)
    started_at:       Mapped[datetime | None]
    finished_at:      Mapped[datetime | None]
    __table_args__ = (
        UniqueConstraint("user_id", "idempotency_key", name="uq_runs_user_idem"),
        Index("ix_runs_user_created", "user_id", "created_at"),
        Index("ix_runs_active", "status",
              postgresql_where="status in ('queued','running','cancelling')"),
    )


class RunEventRow(Base):
    __tablename__ = "run_events"
    id:      Mapped[int]       = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    run_id:  Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                               ForeignKey("runs.id", ondelete="CASCADE"),
                                               nullable=False)
    seq:     Mapped[int]       = mapped_column(Integer, nullable=False)
    ts:      Mapped[datetime]  = mapped_column(server_default=func.now(), nullable=False)
    type:    Mapped[str]       = mapped_column(Text, nullable=False)
    payload: Mapped[dict]      = mapped_column(JSONB, nullable=False)
    __table_args__ = (
        UniqueConstraint("run_id", "seq", name="uq_run_event_seq"),
        Index("ix_run_events_run_seq", "run_id", "seq"),
    )


class VerifyCache(Base):
    __tablename__ = "verify_cache"
    doi:        Mapped[str] = mapped_column(Text, primary_key=True)
    claim_hash: Mapped[str] = mapped_column(Text, primary_key=True)
    result:     Mapped[dict] = mapped_column(JSONB, nullable=False)
    cached_at:  Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)


class PaperContentCache(Base):
    __tablename__ = "paper_content_cache"
    user_id:      Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                    ForeignKey("users.id", ondelete="CASCADE"),
                                                    primary_key=True)
    project_id:   Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                    ForeignKey("projects.id", ondelete="CASCADE"),
                                                    primary_key=True)
    paper_key:    Mapped[str] = mapped_column(Text, primary_key=True)
    paper_title:  Mapped[str | None] = mapped_column(Text)
    doi:          Mapped[str | None] = mapped_column(Text, index=True)
    source_url:   Mapped[str | None] = mapped_column(Text)
    text:         Mapped[str] = mapped_column(Text, nullable=False)
    chars:        Mapped[int] = mapped_column(Integer, nullable=False)
    fetch_source: Mapped[str] = mapped_column(Text, nullable=False)
    fetched_at:   Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    expires_at:   Mapped[datetime] = mapped_column(nullable=False, index=True)
    __table_args__ = (
        Index("ix_paper_content_cache_scope_exp", "user_id", "project_id", "expires_at"),
    )


class VerifyResultCache(Base):
    __tablename__ = "verify_result_cache"
    user_id:        Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                      ForeignKey("users.id", ondelete="CASCADE"),
                                                      primary_key=True)
    project_id:     Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                      ForeignKey("projects.id", ondelete="CASCADE"),
                                                      primary_key=True)
    paper_key:      Mapped[str] = mapped_column(Text, primary_key=True)
    claim_hash:     Mapped[str] = mapped_column(Text, primary_key=True)
    status:         Mapped[str] = mapped_column(Text, nullable=False)
    verbatim_quote: Mapped[str | None] = mapped_column(Text)
    confidence:     Mapped[float] = mapped_column(Float, nullable=False)
    reason:         Mapped[str] = mapped_column(Text, nullable=False)
    provider_used:  Mapped[str | None] = mapped_column(Text)
    cached_at:      Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    expires_at:     Mapped[datetime] = mapped_column(nullable=False, index=True)
    __table_args__ = (
        Index("ix_verify_result_cache_scope_exp", "user_id", "project_id", "expires_at"),
    )


class Draft(Base):
    __tablename__ = "drafts"
    id:         Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                  ForeignKey("projects.id", ondelete="CASCADE"),
                                                  nullable=False)
    user_id:    Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True),
                                                  ForeignKey("users.id", ondelete="CASCADE"),
                                                  nullable=False)
    run_id:     Mapped[uuid.UUID | None] = mapped_column(PG_UUID(as_uuid=True),
                                                         ForeignKey("runs.id", ondelete="SET NULL"),
                                                         nullable=True)
    title:      Mapped[str]       = mapped_column(Text, nullable=False, default="Untitled Draft")
    markdown:   Mapped[str]       = mapped_column(Text, nullable=False)
    sections:   Mapped[list]      = mapped_column(JSONB, nullable=False, default=list)
    created_at: Mapped[datetime]  = mapped_column(server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime]  = mapped_column(server_default=func.now(),
                                                  onupdate=func.now(), nullable=False)
    __table_args__ = (
        UniqueConstraint("project_id", "user_id", name="uq_drafts_project_user"),
    )
