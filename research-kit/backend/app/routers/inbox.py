from uuid import UUID
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import current_user, db
from app.repos.inbox import InboxRepo
from app.schemas.inbox import InboxAdd, InboxBulkPatch, InboxOut, InboxPatch
from rk_shared.models import User

router = APIRouter(prefix="/v1/inbox", tags=["inbox"])


def _out(i) -> InboxOut:
    return InboxOut(
        id=i.id,
        project_id=i.project_id,
        claim_id=i.claim_id,
        saved_at=i.saved_at,
        archived_at=i.archived_at,
    )


@router.get("", response_model=list[InboxOut])
async def list_inbox(
    project_id: UUID = Query(...), u: User = Depends(current_user), s: AsyncSession = Depends(db)
):
    return [_out(i) for i in await InboxRepo(s).list_for(u.id, project_id=project_id)]


@router.post("", response_model=InboxOut, status_code=201)
async def add_inbox(body: InboxAdd, u: User = Depends(current_user), s: AsyncSession = Depends(db)):
    i = await InboxRepo(s).add(u.id, project_id=body.project_id, claim_id=body.claim_id)
    await s.commit()
    return _out(i)


@router.patch("/bulk", response_model=list[InboxOut])
async def bulk_patch_inbox(
    body: InboxBulkPatch, u: User = Depends(current_user), s: AsyncSession = Depends(db)
):
    items = await InboxRepo(s).bulk_patch(u.id, body.ids, archived_at=body.archived_at)
    await s.commit()
    return [_out(i) for i in items]


@router.patch("/{inbox_id}", response_model=InboxOut)
async def patch_inbox(
    inbox_id: UUID, body: InboxPatch, u: User = Depends(current_user), s: AsyncSession = Depends(db)
):
    i = await InboxRepo(s).patch(u.id, inbox_id, archived_at=body.archived_at)
    await s.commit()
    return _out(i)


@router.delete("/{inbox_id}", status_code=204)
async def delete_inbox(
    inbox_id: UUID, u: User = Depends(current_user), s: AsyncSession = Depends(db)
):
    await InboxRepo(s).remove(u.id, inbox_id)
    await s.commit()
    return Response(status_code=204)
