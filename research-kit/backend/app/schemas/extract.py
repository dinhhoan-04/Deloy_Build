from typing import Literal
from pydantic import BaseModel, Field, ConfigDict


SiteId = Literal["elicit", "scispace", "consensus"]


class ExtractRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str = Field(min_length=1)
    site: SiteId
    page_markdown: str = Field(min_length=1)


class PaperOut(BaseModel):
    id: str
    title: str
    doi: str | None = None
    url: str | None = None
    authors: list[str] = Field(default_factory=list)
    year: int | None = None
    anchorText: str = ""


class ClaimOut(BaseModel):
    id: str
    text: str
    paperIds: list[str]


class ExtractMeta(BaseModel):
    provider: str
    latencyMs: int
    inputChars: int
    papersCount: int
    claimsCount: int
    warnings: list[str] = Field(default_factory=list)


class ExtractResponse(BaseModel):
    papers: list[PaperOut]
    claims: list[ClaimOut]
    extractMeta: ExtractMeta
