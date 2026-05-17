from __future__ import annotations
import json
from uuid import UUID
from typing import AsyncIterator

import redis.asyncio as aioredis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession

from rk_shared.models import RunEventRow

TERMINAL_TYPES = {"final", "error"}


async def replay_then_tail(
    *,
    run_id: UUID,
    last_seq: int,
    sessionmaker: async_sessionmaker[AsyncSession],
    redis: aioredis.Redis,
    initial_status: str,
) -> AsyncIterator[dict]:
    """Yield events with seq > last_seq from PG, then tail Redis pub/sub.

    Invariant #3: events delivered exactly once across the PG/Redis boundary.
    """
    pubsub = redis.pubsub()
    await pubsub.subscribe(f"run:{run_id}")
    max_seq_sent = last_seq
    try:
        # Phase 1: replay from PG strictly > last_seq, ascending.
        async with sessionmaker() as s:
            rows = list(
                (
                    await s.execute(
                        select(RunEventRow)
                        .where(RunEventRow.run_id == run_id, RunEventRow.seq > last_seq)
                        .order_by(RunEventRow.seq)
                    )
                ).scalars()
            )
        for row in rows:
            payload = {
                "seq": row.seq,
                "type": row.type,
                "payload": row.payload,
                "ts": row.ts.isoformat(),
            }
            yield payload
            max_seq_sent = row.seq
            if row.type in TERMINAL_TYPES:
                return

        if initial_status in {"succeeded", "failed", "cancelled"}:
            async with sessionmaker() as s:
                rows = list(
                    (
                        await s.execute(
                            select(RunEventRow)
                            .where(RunEventRow.run_id == run_id, RunEventRow.seq > max_seq_sent)
                            .order_by(RunEventRow.seq)
                        )
                    ).scalars()
                )
            for row in rows:
                payload = {
                    "seq": row.seq,
                    "type": row.type,
                    "payload": row.payload,
                    "ts": row.ts.isoformat(),
                }
                yield payload
                max_seq_sent = row.seq
            return

        # Phase 2: tail Redis. Drop anything <= max_seq_sent (overlap with replay).
        async for msg in pubsub.listen():
            if msg.get("type") != "message":
                continue
            data = json.loads(msg["data"])
            if data["seq"] <= max_seq_sent:
                continue
            yield data
            max_seq_sent = data["seq"]
            if data["type"] in TERMINAL_TYPES:
                return
    finally:
        try:
            await pubsub.unsubscribe(f"run:{run_id}")
        except Exception:
            pass
        try:
            await pubsub.aclose()
        except Exception:
            pass
