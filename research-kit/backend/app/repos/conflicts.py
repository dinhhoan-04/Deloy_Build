import json
from datetime import datetime, timezone
from uuid import UUID
from sqlalchemy import select, delete, func, case
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import NotFoundError, ValidationError
from rk_shared.models import Claim, Conflict, InboxItem, Project


class ConflictRepo:
    def __init__(self, s: AsyncSession): self.s = s

    async def _ensure_project(self, user_id: UUID, project_id: UUID) -> None:
        if not (await self.s.execute(
            select(Project.id).where(Project.id == project_id, Project.user_id == user_id)
        )).scalar_one_or_none():
            raise NotFoundError("project not found")

    async def create(self, user_id: UUID, *, project_id: UUID, group_key: str,
                     doi: str | None, paper_title: str | None,
                     sides: list[dict]) -> Conflict:
        await self._ensure_project(user_id, project_id)
        c = Conflict(user_id=user_id, project_id=project_id, group_key=group_key,
                     doi=doi, paper_title=paper_title, sides=sides, resolution=None)
        self.s.add(c); await self.s.flush()
        return c

    async def list_for(self, user_id: UUID, *, project_id: UUID) -> list[Conflict]:
        return list((await self.s.execute(
            select(Conflict)
            .where(Conflict.user_id == user_id, Conflict.project_id == project_id)
            .order_by(Conflict.flagged_at.desc())
        )).scalars())

    async def find_by_claim_pair(self, user_id: UUID, project_id: UUID,
                                  claim_id_a: UUID, claim_id_b: UUID) -> Conflict | None:
        """Return existing conflict containing both claim IDs in its sides (JSONB containment)."""
        a, b = str(claim_id_a), str(claim_id_b)
        stmt = select(Conflict).where(
            Conflict.user_id == user_id,
            Conflict.project_id == project_id,
            Conflict.sides.op("@>")([{"claim_id": a}]),
            Conflict.sides.op("@>")([{"claim_id": b}]),
        )
        return (await self.s.execute(stmt)).scalar_one_or_none()

    async def pairs_for_project(self, user_id: UUID, project_id: UUID) -> set[frozenset[UUID]]:
        """Return the set of {claim_id_a, claim_id_b} pairs already conflicted in this project."""
        rows = await self.list_for(user_id, project_id=project_id)
        out: set[frozenset[UUID]] = set()
        for c in rows:
            ids = [UUID(s["claim_id"]) for s in (c.sides or []) if s.get("claim_id")]
            if len(ids) >= 2:
                out.add(frozenset(ids[:2]))
        return out

    async def patch(self, user_id: UUID, conflict_id: UUID, *,
                    resolution: str | None) -> Conflict:
        c = (await self.s.execute(
            select(Conflict).where(Conflict.id == conflict_id, Conflict.user_id == user_id)
        )).scalar_one_or_none()
        if not c:
            raise NotFoundError("conflict not found")
        if resolution is not None:
            c.resolution = resolution
        await self.s.flush()
        return c

    async def confirm(self, user_id: UUID, conflict_id: UUID,
                      accepted_claim_id: UUID) -> tuple["Conflict", "InboxItem"]:
        """Verify accepted claim, delete rejected claim, add to inbox, mark conflict resolved."""
        conflict = (await self.s.execute(
            select(Conflict).where(Conflict.id == conflict_id, Conflict.user_id == user_id)
        )).scalar_one_or_none()
        if not conflict:
            raise NotFoundError("conflict not found")

        if conflict.resolved_at is not None:
            raise ValidationError("conflict is already confirmed")

        side_ids = [UUID(s["claim_id"]) for s in (conflict.sides or [])]
        if accepted_claim_id not in side_ids:
            raise ValidationError("accepted_claim_id not in conflict sides")
        rejected_ids = [sid for sid in side_ids if sid != accepted_claim_id]

        # 1. Set accepted claim to verified
        accepted = (await self.s.execute(
            select(Claim).where(Claim.id == accepted_claim_id, Claim.user_id == user_id)
        )).scalar_one_or_none()
        if not accepted:
            raise NotFoundError("accepted claim not found")
        accepted.status = "verified"

        # 2. Delete rejected claims
        for rid in rejected_ids:
            await self.s.execute(
                delete(Claim).where(Claim.id == rid, Claim.user_id == user_id)
            )

        # 3. Add accepted claim to inbox (skip if already there)
        inbox_item = InboxItem(
            user_id=user_id, project_id=conflict.project_id, claim_id=accepted_claim_id
        )
        self.s.add(inbox_item)
        try:
            async with self.s.begin_nested():  # savepoint — only rolls back the insert
                await self.s.flush()
        except IntegrityError:
            inbox_item = (await self.s.execute(
                select(InboxItem).where(
                    InboxItem.claim_id == accepted_claim_id,
                    InboxItem.user_id == user_id,
                )
            )).scalar_one()

        # 4. Mark conflict resolved
        conflict.resolved_at = datetime.now(timezone.utc)
        conflict.accepted_claim_id = accepted_claim_id
        conflict.resolution = json.dumps({
            "kind": "confirmed",
            "accepted_claim_id": str(accepted_claim_id),
        })
        await self.s.flush()
        return conflict, inbox_item

    async def check_status(self, user_id: UUID, project_id: UUID) -> tuple["datetime | None", int]:
        row = (await self.s.execute(
            select(
                func.max(Claim.conflicts_checked_at),
                func.count(
                    case(
                        (
                            (Claim.status.in_(["verified", "partial"]))
                            & (Claim.conflicts_checked_at.is_(None)),
                            1,
                        ),
                    )
                ),
            ).where(Claim.user_id == user_id, Claim.project_id == project_id)
        )).one()
        return row[0], int(row[1] or 0)
