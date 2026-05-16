from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class ProjectPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)


class ProjectOut(BaseModel):
    id: UUID
    name: str
    created_at: datetime
