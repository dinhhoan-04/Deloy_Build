import pytest
import redis.asyncio as aioredis


@pytest.mark.asyncio
async def test_cancel_writes_redis_key_and_status(client_dev_alice, monkeypatch, redis_container):
    from app import queue as q
    async def noop(*a, **k): pass
    monkeypatch.setattr(q, "enqueue_run", noop)

    body = {"kind": "verify", "input": {}, "idempotency_key": "kc"}
    r = await client_dev_alice.post("/v1/runs", json=body)
    rid = r.json()["run_id"]

    r2 = await client_dev_alice.post(f"/v1/runs/{rid}/cancel")
    assert r2.status_code == 202

    r3 = await client_dev_alice.get(f"/v1/runs/{rid}")
    assert r3.json()["status"] == "cancelling"

    rds = aioredis.from_url(redis_container.url, decode_responses=True)
    val = await rds.get(f"cancel:{rid}")
    assert val == "1"
    ttl = await rds.ttl(f"cancel:{rid}")
    assert 0 < ttl <= 300
    await rds.aclose()
