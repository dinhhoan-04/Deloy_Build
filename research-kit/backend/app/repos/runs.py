from __future__ import annotations
import hashlib
import json
from uuid import UUID
from datetime import datetime
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ConflictError, NotFoundError
from rk_shared.models import Run
from rk_shared.types import RunKind, RunStatus


def _hash_input(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


class RunRepo:
    def __init__(self, s: AsyncSession):
        self.s = s

    async def create_or_get(
        self,
        *,
        user_id: UUID,
        kind: RunKind,
        project_id: UUID | None,
        input: dict,
        idempotency_key: str,
    ) -> tuple[Run, bool]:
        existing = (
            await self.s.execute(
                select(Run).where(Run.user_id == user_id, Run.idempotency_key == idempotency_key)
            )
        ).scalar_one_or_none()
        if existing:
            if _hash_input(existing.input) != _hash_input(input):
                raise ConflictError("idempotency_key reused with different payload")
            return existing, False

        run = Run(
            user_id=user_id,
            project_id=project_id,
            kind=kind.value,
            status=RunStatus.QUEUED.value,
            input=input,
            idempotency_key=idempotency_key,
        )
        self.s.add(run)
        await self.s.flush()
        return run, True

    async def get(self, user_id: UUID, run_id: UUID) -> Run:
        run = (
            await self.s.execute(select(Run).where(Run.id == run_id, Run.user_id == user_id))
        ).scalar_one_or_none()
        if not run:
            raise NotFoundError("run not found")
        return run

    async def mark_cancelling(self, user_id: UUID, run_id: UUID) -> Run:
        run = await self.get(user_id, run_id)
        if run.status in {
            RunStatus.SUCCEEDED.value,
            RunStatus.FAILED.value,
            RunStatus.CANCELLED.value,
        }:
            return run
        run.status = RunStatus.CANCELLING.value
        await self.s.flush()
        return run

    async def transition(
        self,
        run_id: UUID,
        *,
        status: RunStatus,
        result: dict | None = None,
        error: dict | None = None,
        started_at: datetime | None = None,
        finished_at: datetime | None = None,
    ) -> None:
        run = (await self.s.execute(select(Run).where(Run.id == run_id))).scalar_one()
        run.status = status.value
        if result is not None:
            run.result = result
        if error is not None:
            run.error = error
        if started_at is not None:
            run.started_at = started_at
        if finished_at is not None:
            run.finished_at = finished_at
