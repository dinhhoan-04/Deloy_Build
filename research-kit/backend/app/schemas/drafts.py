from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field


class DraftCreate(BaseModel):
    project_id: UUID
    run_id: UUID | None = None
    title: str = "Untitled Draft"
    markdown: str
    sections: list = Field(default_factory=list)


class DraftPatch(BaseModel):
    title: str | None = None
    markdown: str | None = None


class DraftOut(BaseModel):
    id: UUID
    project_id: UUID
    run_id: UUID | None
    title: str
    markdown: str
    sections: list
    created_at: datetime
    updated_at: datetime
