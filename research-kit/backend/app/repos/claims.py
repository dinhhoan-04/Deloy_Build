from datetime import datetime, timezone
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import NotFoundError, ValidationError
from app.utils.datetime import to_utc_naive
from rk_shared.models import Claim, Project
from rk_shared.types import ClaimStatus, Site


class ClaimRepo:
    def __init__(self, s: AsyncSession):
        self.s = s

    async def _ensure_project(self, user_id: UUID, project_id: UUID) -> None:
        owns = (
            await self.s.execute(
                select(Project.id).where(Project.id == project_id, Project.user_id == user_id)
            )
        ).scalar_one_or_none()
        if not owns:
            raise NotFoundError("project not found")

    async def batch_create(self, user_id: UUID, project_id: UUID, items: list[dict]) -> list[Claim]:
        await self._ensure_project(user_id, project_id)
        rows: list[Claim] = []
        valid_sites = {s.value for s in Site}
        for it in items:
            site = it.get("site")
            if site not in valid_sites:
                raise ValidationError(f"invalid site: {site}")
            c = Claim(
                user_id=user_id,
                project_id=project_id,
                text=it["text"],
                paper_title=it.get("paper_title"),
                doi=it.get("doi"),
                paper_url=it.get("paper_url"),
                page=it.get("page"),
                site=site,
                status=ClaimStatus.PENDING.value,
                confidence=None,
                quote=None,
                reason=None,
                page_url=it.get("page_url"),
                extracted_at=to_utc_naive(it.get("extracted_at")),
            )
            self.s.add(c)
            rows.append(c)
        await self.s.flush()
        return rows

    async def list(
        self,
        user_id: UUID,
        *,
        project_id: UUID,
        status: str | None,
        limit: int = 50,
    ) -> list[Claim]:
        q = select(Claim).where(Claim.user_id == user_id, Claim.project_id == project_id)
        if status:
            q = q.where(Claim.status == status)
        q = q.order_by(Claim.created_at).limit(limit)
        return list((await self.s.execute(q)).scalars())

    async def get(self, user_id: UUID, claim_id: UUID) -> Claim:
        c = (
            await self.s.execute(
                select(Claim).where(Claim.id == claim_id, Claim.user_id == user_id)
            )
        ).scalar_one_or_none()
        if not c:
            raise NotFoundError("claim not found")
        return c

    async def patch(self, user_id: UUID, claim_id: UUID, **fields) -> Claim:
        c = await self.get(user_id, claim_id)
        for k, v in fields.items():
            if v is not None:
                setattr(c, k, v)
        c.updated_at = datetime.now(tz=timezone.utc).replace(tzinfo=None)
        await self.s.flush()
        return c
