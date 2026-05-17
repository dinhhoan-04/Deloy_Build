from uuid import UUID
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import current_user, db
from app.repos.projects import ProjectRepo
from app.schemas.projects import ProjectIn, ProjectOut, ProjectPatch
from rk_shared.models import User

router = APIRouter(prefix="/v1/projects", tags=["projects"])


def _to_out(p) -> ProjectOut:
    return ProjectOut(id=p.id, name=p.name, created_at=p.created_at)


@router.get("", response_model=list[ProjectOut])
async def list_projects(u: User = Depends(current_user), s: AsyncSession = Depends(db)):
    return [_to_out(p) for p in await ProjectRepo(s).list_for(u.id)]


@router.post("", response_model=ProjectOut, status_code=201)
async def create_project(
    body: ProjectIn, u: User = Depends(current_user), s: AsyncSession = Depends(db)
):
    p = await ProjectRepo(s).create(u.id, name=body.name)
    await s.commit()
    return _to_out(p)


@router.patch("/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: UUID,
    body: ProjectPatch,
    u: User = Depends(current_user),
    s: AsyncSession = Depends(db),
):
    p = await ProjectRepo(s).update(u.id, project_id, name=body.name)
    await s.commit()
    return _to_out(p)


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    project_id: UUID, u: User = Depends(current_user), s: AsyncSession = Depends(db)
):
    await ProjectRepo(s).delete(u.id, project_id)
    await s.commit()
