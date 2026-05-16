from datetime import datetime
from uuid import UUID
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from app.errors import NotFoundError, ConflictError
from rk_shared.models import InboxItem, Claim, Project


class InboxRepo:
    def __init__(self, s: AsyncSession): self.s = s

    async def _ensure_owns(self, user_id: UUID, project_id: UUID, claim_id: UUID) -> None:
        proj = (await self.s.execute(
            select(Project.id).where(Project.id == project_id, Project.user_id == user_id)
        )).scalar_one_or_none()
        if not proj:
            raise NotFoundError("project not found")
        clm = (await self.s.execute(
            select(Claim.id).where(Claim.id == claim_id,
                                   Claim.user_id == user_id,
                                   Claim.project_id == project_id)
        )).scalar_one_or_none()
        if not clm:
            raise NotFoundError("claim not found")

    async def _get_item(self, user_id: UUID, inbox_id: UUID) -> InboxItem:
        item = (await self.s.execute(
            select(InboxItem).where(InboxItem.id == inbox_id, InboxItem.user_id == user_id)
        )).scalar_one_or_none()
        if not item:
            raise NotFoundError("inbox item not found")
        return item

    async def add(self, user_id: UUID, *, project_id: UUID, claim_id: UUID) -> InboxItem:
        await self._ensure_owns(user_id, project_id, claim_id)
        item = InboxItem(user_id=user_id, project_id=project_id, claim_id=claim_id)
        self.s.add(item)
        try:
            await self.s.flush()
        except IntegrityError as e:
            await self.s.rollback()
            raise ConflictError("claim already in inbox") from e
        return item

    async def list_for(self, user_id: UUID, *, project_id: UUID) -> list[InboxItem]:
        return list((await self.s.execute(
            select(InboxItem)
            .where(InboxItem.user_id == user_id, InboxItem.project_id == project_id)
            .order_by(InboxItem.saved_at.desc())
        )).scalars())

    async def patch(self, user_id: UUID, inbox_id: UUID, *, archived_at: datetime | None) -> InboxItem:
        item = await self._get_item(user_id, inbox_id)
        item.archived_at = archived_at
        await self.s.flush()
        return item

    async def bulk_patch(self, user_id: UUID, ids: list[UUID], *, archived_at: datetime | None) -> list[InboxItem]:
        if not ids:
            return []
        await self.s.execute(
            update(InboxItem)
            .where(InboxItem.id.in_(ids), InboxItem.user_id == user_id)
            .values(archived_at=archived_at)
        )
        await self.s.flush()
        result = await self.s.execute(
            select(InboxItem).where(InboxItem.id.in_(ids), InboxItem.user_id == user_id)
        )
        by_id = {i.id: i for i in result.scalars()}
        return [by_id[i] for i in ids if i in by_id]

    async def remove(self, user_id: UUID, inbox_id: UUID) -> None:
        item = await self._get_item(user_id, inbox_id)
        await self.s.delete(item)
