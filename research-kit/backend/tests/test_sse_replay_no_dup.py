import pytest
import asyncio
import json
import redis.asyncio as aioredis
from sqlalchemy import select

from rk_shared.models import User, Run, RunEventRow
from rk_shared.types import RunKind, RunStatus


async def _seed_run_with_events(db_engine, n_pre: int) -> tuple[str, str]:
    async with db_engine() as s:
        u = User(google_sub="g", email="g")
        s.add(u)
        await s.flush()
        run = Run(user_id=u.id, kind=RunKind.VERIFY.value, status=RunStatus.RUNNING.value, input={})
        s.add(run)
        await s.commit()
        await s.refresh(run)
        for i in range(1, n_pre + 1):
            s.add(RunEventRow(run_id=run.id, seq=i, type="token", payload={"i": i}))
        await s.commit()
        return str(run.id), str(u.id)


@pytest.mark.asyncio
async def test_sse_no_dup_in_overlap_window(client, db_engine, redis_container, monkeypatch):
    """Ensure events seq=10..15 (in PG) are not also delivered when redis publishes them
    again concurrently during the replay phase."""
    monkeypatch.setenv("DEV_AUTH_BYPASS", "true")
    rid, uid = await _seed_run_with_events(db_engine, n_pre=15)
    rds = aioredis.from_url(redis_container.url, decode_responses=True)

    async with db_engine() as s:
        u = (await s.execute(select(User).where(User.id == uid))).scalar_one()
        u.email = "alice@example.com"
        await s.commit()

    seen: list[int] = []

    async def consume():
        headers = {"X-Dev-User": "alice@example.com", "Accept": "text/event-stream"}
        async with client.stream(
            "GET", f"/v1/runs/{rid}/stream", headers=headers, params={"last_seq": 5}
        ) as r:
            assert r.status_code == 200
            async for line in r.aiter_lines():
                if line.startswith("data: "):
                    data = json.loads(line[6:])
                    seen.append(data["seq"])
                    if data["type"] == "final":
                        return

    async def chaos_publish_overlap():
        await asyncio.sleep(0.05)
        for i in range(10, 16):
            await rds.publish(
                f"run:{rid}",
                json.dumps(
                    {"seq": i, "type": "token", "payload": {"i": i}, "ts": "2026-05-08T00:00:00Z"}
                ),
            )
        async with db_engine() as s:
            s.add(RunEventRow(run_id=rid, seq=16, type="final", payload={"verdict": "ok"}))
            await s.commit()
        await rds.publish(
            f"run:{rid}",
            json.dumps(
                {
                    "seq": 16,
                    "type": "final",
                    "payload": {"verdict": "ok"},
                    "ts": "2026-05-08T00:00:00Z",
                }
            ),
        )

    await asyncio.gather(consume(), chaos_publish_overlap())
    await rds.aclose()

    assert seen == sorted(set(seen)), "duplicates detected"
    assert seen == list(range(6, 17))
