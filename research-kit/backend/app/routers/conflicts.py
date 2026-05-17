from uuid import UUID
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import current_user, db
from app.repos.conflicts import ConflictRepo
from app.schemas.conflicts import (
    ConflictCheckStatusOut,
    ConflictConfirmIn,
    ConflictConfirmOut,
    ConflictIn,
    ConflictOut,
    ConflictPatch,
    ConflictSide,
)
from app.schemas.inbox import InboxOut
from rk_shared.models import User

router = APIRouter(prefix="/v1/conflicts", tags=["conflicts"])


def _out(c) -> ConflictOut:
    return ConflictOut(
        id=c.id,
        project_id=c.project_id,
        group_key=c.group_key,
        doi=c.doi,
        paper_title=c.paper_title,
        flagged_at=c.flagged_at,
        resolution=c.resolution,
        resolved_at=c.resolved_at,
        accepted_claim_id=c.accepted_claim_id,
        sides=[ConflictSide.model_validate(s) for s in (c.sides or [])],
    )


@router.get("/check-status", response_model=ConflictCheckStatusOut)
async def check_status(
    project_id: UUID = Query(...), u: User = Depends(current_user), s: AsyncSession = Depends(db)
):
    last_at, pending = await ConflictRepo(s).check_status(u.id, project_id)
    return ConflictCheckStatusOut(last_checked_at=last_at, pending_count=pending)


@router.get("", response_model=list[ConflictOut])
async def list_conflicts(
    project_id: UUID = Query(...), u: User = Depends(current_user), s: AsyncSession = Depends(db)
):
    return [_out(c) for c in await ConflictRepo(s).list_for(u.id, project_id=project_id)]


@router.post("", response_model=ConflictOut, status_code=201)
async def create_conflict(
    body: ConflictIn, u: User = Depends(current_user), s: AsyncSession = Depends(db)
):
    c = await ConflictRepo(s).create(
        u.id,
        project_id=body.project_id,
        group_key=body.group_key,
        doi=body.doi,
        paper_title=body.paper_title,
        sides=[side.model_dump(mode="json") for side in body.sides],
    )
    await s.commit()
    return _out(c)


@router.patch("/{conflict_id}", response_model=ConflictOut)
async def patch_conflict(
    conflict_id: UUID,
    body: ConflictPatch,
    u: User = Depends(current_user),
    s: AsyncSession = Depends(db),
):
    c = await ConflictRepo(s).patch(u.id, conflict_id, resolution=body.resolution)
    await s.commit()
    return _out(c)


@router.post("/{conflict_id}/confirm", response_model=ConflictConfirmOut)
async def confirm_conflict(
    conflict_id: UUID,
    body: ConflictConfirmIn,
    u: User = Depends(current_user),
    s: AsyncSession = Depends(db),
):
    conflict, inbox_item = await ConflictRepo(s).confirm(u.id, conflict_id, body.accepted_claim_id)
    await s.commit()
    return ConflictConfirmOut(
        conflict=_out(conflict),
        inbox_item=InboxOut.model_validate(inbox_item, from_attributes=True),
    )
