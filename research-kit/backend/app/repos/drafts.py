from uuid import UUID
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import NotFoundError
from rk_shared.models import Draft


class DraftRepo:
    def __init__(self, s: AsyncSession):
        self.s = s

    async def upsert(
        self,
        user_id: UUID,
        *,
        project_id: UUID,
        markdown: str,
        title: str = "Untitled Draft",
        sections: list | None = None,
        run_id: UUID | None = None,
    ) -> Draft:
        stmt = (
            pg_insert(Draft)
            .values(
                project_id=project_id,
                user_id=user_id,
                run_id=run_id,
                title=title,
                markdown=markdown,
                sections=sections or [],
            )
            .on_conflict_do_update(
                constraint="uq_drafts_project_user",
                set_={
                    "run_id": run_id,
                    "title": title,
                    "markdown": markdown,
                    "sections": sections or [],
                    "updated_at": text("now()"),
                },
            )
            .returning(Draft)
        )
        result = await self.s.execute(stmt)
        return result.scalar_one()

    async def get(self, user_id: UUID, project_id: UUID) -> Draft:
        draft = (
            await self.s.execute(
                select(Draft).where(Draft.user_id == user_id, Draft.project_id == project_id)
            )
        ).scalar_one_or_none()
        if not draft:
            raise NotFoundError("draft not found")
        return draft

    async def get_by_id(self, user_id: UUID, draft_id: UUID) -> Draft:
        draft = (
            await self.s.execute(
                select(Draft).where(Draft.id == draft_id, Draft.user_id == user_id)
            )
        ).scalar_one_or_none()
        if not draft:
            raise NotFoundError("draft not found")
        return draft

    async def patch(
        self,
        user_id: UUID,
        draft_id: UUID,
        *,
        title: str | None,
        markdown: str | None,
    ) -> Draft:
        draft = await self.get_by_id(user_id, draft_id)
        if title is not None:
            draft.title = title
        if markdown is not None:
            draft.markdown = markdown
        await self.s.flush()
        return draft

    async def delete(self, user_id: UUID, draft_id: UUID) -> None:
        draft = await self.get_by_id(user_id, draft_id)
        await self.s.delete(draft)
