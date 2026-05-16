from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field


class ConflictSide(BaseModel):
    claim_id: UUID
    label: str
    quote: str | None = None


class ConflictIn(BaseModel):
    project_id: UUID
    group_key: str = Field(min_length=1, max_length=400)
    doi: str | None = None
    paper_title: str | None = None
    sides: list[ConflictSide] = Field(min_length=2)


class ConflictPatch(BaseModel):
    resolution: str | None = Field(default=None, max_length=2000)


class ConflictOut(BaseModel):
    id: UUID
    project_id: UUID
    group_key: str
    doi: str | None
    paper_title: str | None
    flagged_at: datetime
    resolution: str | None
    resolved_at: datetime | None = None
    accepted_claim_id: UUID | None = None
    sides: list[ConflictSide]


from app.schemas.inbox import InboxOut  # noqa: E402


class ConflictConfirmIn(BaseModel):
    accepted_claim_id: UUID


class ConflictConfirmOut(BaseModel):
    conflict: ConflictOut
    inbox_item: InboxOut


class ConflictCheckStatusOut(BaseModel):
    last_checked_at: datetime | None = None
    pending_count: int = 0
