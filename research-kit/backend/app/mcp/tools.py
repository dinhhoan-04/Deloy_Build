"""MCP tool implementations for the RK inbox."""

from __future__ import annotations
import httpx
from uuid import UUID
from typing import Any

from sqlalchemy import select, or_

from app.db import sessionmaker
from rk_shared.models import InboxItem, Claim


async def search_inbox(query: str, project_id: str, limit: int = 10) -> list[dict[str, Any]]:
    """Search inbox claims by text using PostgreSQL ILIKE (simple BM25 approximation).

    Args:
        query: Search query string
        project_id: UUID of the project to search within
        limit: Maximum number of results (default 10)

    Returns:
        List of matching claim records with id, text, paper_title, doi, paper_url, status, confidence
    """
    pid = UUID(project_id)
    async with sessionmaker()() as session:
        terms = query.split()
        conditions = [Claim.text.ilike(f"%{t}%") for t in terms if t]
        stmt = (
            select(Claim)
            .join(InboxItem, InboxItem.claim_id == Claim.id)
            .where(InboxItem.project_id == pid)
            .where(or_(*conditions) if conditions else True)
            .order_by(Claim.created_at.desc())
            .limit(limit)
        )
        result = await session.execute(stmt)
        claims = result.scalars().all()
        return [
            {
                "id": str(c.id),
                "text": c.text,
                "paper_title": c.paper_title,
                "doi": c.doi,
                "paper_url": c.paper_url,
                "status": c.status,
                "confidence": c.confidence,
            }
            for c in claims
        ]


async def get_inbox_items(ids: list[str]) -> list[dict[str, Any]]:
    """Retrieve full claim records by ID.

    Args:
        ids: List of claim UUIDs to retrieve

    Returns:
        List of full claim records
    """
    uuids = [UUID(i) for i in ids]
    async with sessionmaker()() as session:
        stmt = select(Claim).where(Claim.id.in_(uuids))
        result = await session.execute(stmt)
        claims = result.scalars().all()
        return [
            {
                "id": str(c.id),
                "text": c.text,
                "paper_title": c.paper_title,
                "doi": c.doi,
                "paper_url": c.paper_url,
                "page": c.page,
                "site": c.site,
                "status": c.status,
                "confidence": c.confidence,
                "quote": c.quote,
                "reason": c.reason,
                "page_url": c.page_url,
                "created_at": str(c.created_at),
                "updated_at": str(c.updated_at),
            }
            for c in claims
        ]


async def fetch_paper(url: str) -> dict[str, Any]:
    """Fetch paper text from a URL.

    Args:
        url: URL to fetch paper content from

    Returns:
        Dict with 'text' (extracted text) and 'metadata' (url, content_type, length)
    """
    headers = {
        "User-Agent": "ResearchKit/1.0 (research@researchkit.app)",
        "Accept": "text/html,application/xhtml+xml,application/pdf,text/*",
    }
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        resp = await client.get(url, headers=headers)
        resp.raise_for_status()
        text = resp.text
        content_type = resp.headers.get("content-type", "")
        return {
            "text": text[:50000],  # cap at 50k chars
            "metadata": {
                "url": str(resp.url),
                "content_type": content_type,
                "length": len(text),
            },
        }
