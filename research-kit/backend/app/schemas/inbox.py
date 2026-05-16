from datetime import datetime
from uuid import UUID
from pydantic import BaseModel


class InboxAdd(BaseModel):
    project_id: UUID
    claim_id: UUID


class InboxPatch(BaseModel):
    archived_at: datetime | None


class InboxBulkPatch(BaseModel):
    ids: list[UUID]
    archived_at: datetime | None


class InboxOut(BaseModel):
    id: UUID
    project_id: UUID
    claim_id: UUID
    saved_at: datetime
    archived_at: datetime | None = None
