from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from rk_shared.models import VerifyResultCache


@dataclass
class VerifyCacheRecord:
    status: str
    verbatim_quote: str | None
    confidence: float
    reason: str


class VerifyCacheRepo:
    def __init__(self, s: AsyncSession, ttl_days: int):
        self.s = s
        self.ttl_days = ttl_days

    async def get(
        self,
        user_id: UUID,
        project_id: UUID,
        paper_key: str,
        claim_hash: str,
    ) -> VerifyCacheRecord | None:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        row = (
            await self.s.execute(
                select(VerifyResultCache).where(
                    VerifyResultCache.user_id == user_id,
                    VerifyResultCache.project_id == project_id,
                    VerifyResultCache.paper_key == paper_key,
                    VerifyResultCache.claim_hash == claim_hash,
                    VerifyResultCache.expires_at > now,
                )
            )
        ).scalar_one_or_none()
        if not row:
            return None
        return VerifyCacheRecord(
            status=row.status,
            verbatim_quote=row.verbatim_quote,
            confidence=row.confidence,
            reason=row.reason,
        )

    async def set(
        self,
        *,
        user_id: UUID,
        project_id: UUID,
        paper_key: str,
        claim_hash: str,
        status: str,
        verbatim_quote: str | None,
        confidence: float,
        reason: str,
        provider_used: str | None,
    ) -> None:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        expires_at = now + timedelta(days=self.ttl_days)
        await self.s.execute(
            delete(VerifyResultCache).where(
                VerifyResultCache.user_id == user_id,
                VerifyResultCache.project_id == project_id,
                VerifyResultCache.paper_key == paper_key,
                VerifyResultCache.claim_hash == claim_hash,
            )
        )
        self.s.add(
            VerifyResultCache(
                user_id=user_id,
                project_id=project_id,
                paper_key=paper_key,
                claim_hash=claim_hash,
                status=status,
                verbatim_quote=verbatim_quote,
                confidence=confidence,
                reason=reason,
                provider_used=provider_used,
                expires_at=expires_at,
            )
        )
        await self.s.flush()
