from datetime import datetime
from uuid import UUID
from typing import Any, Literal
from pydantic import BaseModel, Field


class RunCreate(BaseModel):
    kind: Literal["verify", "extract", "chat", "draft", "conflict"]
    input: dict[str, Any]
    provider: Literal["openai", "zai", "gemini"] | None = None
    model: str | None = Field(default=None, min_length=1, max_length=200)
    project_id: UUID | None = None
    idempotency_key: str = Field(min_length=1, max_length=200)


class RunCreateResponse(BaseModel):
    run_id: UUID
    status: str
    stream_url: str


class RunOut(BaseModel):
    id: UUID
    kind: str
    status: str
    project_id: UUID | None
    input: dict
    result: dict | None
    error: dict | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
