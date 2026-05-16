from __future__ import annotations
from typing import Literal, Optional
from pydantic import BaseModel, Field


class Paragraph(BaseModel):
    id: str
    text: str
    citationIds: list[str] = Field(default_factory=list)


class Citation(BaseModel):
    id: str
    label: str
    url: Optional[str] = None
    doi: Optional[str] = None
    title: Optional[str] = None
    authors: Optional[list[str]] = None
    year: Optional[int] = None
    rawAnchorText: str
    stance: Optional[Literal["supporting", "contradicting", "mixed", "neutral"]] = None


class TableCell(BaseModel):
    text: str
    citationIds: list[str] = Field(default_factory=list)


class TableRow(BaseModel):
    id: str
    paperCitationId: str
    cells: dict[str, TableCell]


class Answer(BaseModel):
    id: str
    text: str
    paragraphs: list[Paragraph] = Field(default_factory=list)


class AdapterMeta(BaseModel):
    adapterVersion: str
    extractionWarnings: list[str] = Field(default_factory=list)
    selectorHits: dict[str, int] = Field(default_factory=dict)


class SelectionRef(BaseModel):
    text: str
    contextBefore: str
    contextAfter: str
    nearestParagraphId: Optional[str] = None
    nearestCitationIds: list[str] = Field(default_factory=list)


class PageModel(BaseModel):
    site: Literal["elicit", "scispace", "consensus"]
    schemaVersion: Literal["1.0"]
    capturedAt: str
    url: str
    title: str
    query: Optional[str] = None
    answer: Optional[Answer] = None
    tableRows: Optional[list[TableRow]] = None
    citations: list[Citation] = Field(default_factory=list)
    selection: Optional[SelectionRef] = None
    adapterMeta: AdapterMeta
