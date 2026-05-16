from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from rk_shared.models import PaperContentCache


@dataclass
class PaperCacheRecord:
    text: str
    fetch_source: str


class PaperCacheRepo:
    def __init__(self, s: AsyncSession, ttl_days: int):
        self.s = s
        self.ttl_days = ttl_days

    async def get(self, user_id: UUID, project_id: UUID, paper_key: str) -> PaperCacheRecord | None:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        row = (
            await self.s.execute(
                select(PaperContentCache).where(
                    PaperContentCache.user_id == user_id,
                    PaperContentCache.project_id == project_id,
                    PaperContentCache.paper_key == paper_key,
                    PaperContentCache.expires_at > now,
                )
            )
        ).scalar_one_or_none()
        if not row:
            return None
        return PaperCacheRecord(text=row.text, fetch_source=row.fetch_source)

    async def set(
        self,
        *,
        user_id: UUID,
        project_id: UUID,
        paper_key: str,
        paper_title: str | None,
        doi: str | None,
        source_url: str | None,
        text: str,
        fetch_source: str,
    ) -> None:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        expires_at = now + timedelta(days=self.ttl_days)
        await self.s.execute(
            delete(PaperContentCache).where(
                PaperContentCache.user_id == user_id,
                PaperContentCache.project_id == project_id,
                PaperContentCache.paper_key == paper_key,
            )
        )
        self.s.add(
            PaperContentCache(
                user_id=user_id,
                project_id=project_id,
                paper_key=paper_key,
                paper_title=paper_title,
                doi=doi,
                source_url=source_url,
                text=text,
                chars=len(text),
                fetch_source=fetch_source,
                expires_at=expires_at,
            )
        )
        await self.s.flush()
