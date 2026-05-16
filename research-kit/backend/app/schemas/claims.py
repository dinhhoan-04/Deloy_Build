from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field, field_validator

from app.utils.datetime import to_utc_naive


class ClaimInput(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    paper_title: str | None = None
    doi: str | None = None
    paper_url: str | None = None
    page: str | None = None
    site: str
    page_url: str | None = None
    extracted_at: datetime | None = None

    @field_validator("extracted_at")
    @classmethod
    def normalize_extracted_at(cls, v: datetime | None) -> datetime | None:
        return to_utc_naive(v)


class ClaimOut(BaseModel):
    id: UUID
    project_id: UUID
    text: str
    paper_title: str | None
    doi: str | None
    paper_url: str | None
    page: str | None
    site: str
    status: str
    confidence: float | None
    quote: str | None
    reason: str | None
    page_url: str | None
    extracted_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ClaimsBatchRequest(BaseModel):
    project_id: UUID
    claims: list[ClaimInput] = Field(max_length=100)
    idempotency_key: str | None = None


class ClaimsBatchResponse(BaseModel):
    created: list[ClaimOut]


class ClaimPatch(BaseModel):
    status: str | None = None
    quote: str | None = None
    confidence: float | None = None
    reason: str | None = None
    page: str | None = None
