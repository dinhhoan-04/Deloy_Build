from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import NotFoundError
from rk_shared.models import Project


class ProjectRepo:
    def __init__(self, s: AsyncSession):
        self.s = s

    async def create(self, user_id: UUID, *, name: str) -> Project:
        p = Project(user_id=user_id, name=name)
        self.s.add(p)
        await self.s.flush()
        return p

    async def list_for(self, user_id: UUID) -> list[Project]:
        return list(
            (
                await self.s.execute(
                    select(Project).where(Project.user_id == user_id).order_by(Project.created_at)
                )
            ).scalars()
        )

    async def get(self, user_id: UUID, project_id: UUID) -> Project:
        p = (
            await self.s.execute(
                select(Project).where(Project.id == project_id, Project.user_id == user_id)
            )
        ).scalar_one_or_none()
        if not p:
            raise NotFoundError("project not found")
        return p

    async def update(self, user_id: UUID, project_id: UUID, *, name: str | None) -> Project:
        p = await self.get(user_id, project_id)
        if name is not None:
            p.name = name
        await self.s.flush()
        return p

    async def delete(self, user_id: UUID, project_id: UUID) -> None:
        p = await self.get(user_id, project_id)
        await self.s.delete(p)
