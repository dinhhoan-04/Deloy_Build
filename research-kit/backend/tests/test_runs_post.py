import pytest


@pytest.mark.asyncio
async def test_post_runs_returns_201_and_enqueues(client_dev_alice, monkeypatch):
    """Invariant §4.2 #4: idempotent POST returns same run_id; enqueue called once."""
    from app import queue as q
    calls: list[str] = []
    async def fake_enqueue(redis, run_id):
        calls.append(str(run_id))
    monkeypatch.setattr(q, "enqueue_run", fake_enqueue)

    body = {"kind": "verify", "input": {"claim_id": "c1"}, "idempotency_key": "k1"}
    r1 = await client_dev_alice.post("/v1/runs", json=body)
    assert r1.status_code == 201
    rid = r1.json()["run_id"]
    assert r1.json()["status"] == "queued"
    assert r1.json()["stream_url"] == f"/v1/runs/{rid}/stream"

    r2 = await client_dev_alice.post("/v1/runs", json=body)
    assert r2.status_code == 201
    assert r2.json()["run_id"] == rid

    assert calls == [rid]


@pytest.mark.asyncio
async def test_post_runs_persists_provider_model_in_meta(client_dev_alice, monkeypatch):
    from app import queue as q
    from app.db import sessionmaker
    from rk_shared.models import Run
    from sqlalchemy import select
    from uuid import UUID

    async def noop(*a, **k): pass
    monkeypatch.setattr(q, "enqueue_run", noop)

    body = {
        "kind": "chat",
        "input": {"messages": [{"role": "user", "content": "hi"}]},
        "provider": "zai",
        "model": "glm-4.7",
        "idempotency_key": "k-meta",
    }
    r = await client_dev_alice.post("/v1/runs", json=body)
    assert r.status_code == 201
    run_id = UUID(r.json()["run_id"])

    async with sessionmaker() as s:
        run = (await s.execute(select(Run).where(Run.id == run_id))).scalar_one()
        assert run.input["meta"]["provider"] == "zai"
        assert run.input["meta"]["model"] == "llama-3.3-70b-versatile"


@pytest.mark.asyncio
async def test_post_runs_idem_conflict(client_dev_alice, monkeypatch):
    from app import queue as q
    async def noop(*a, **k): pass
    monkeypatch.setattr(q, "enqueue_run", noop)
    body1 = {"kind": "verify", "input": {"a": 1}, "idempotency_key": "kk"}
    body2 = {"kind": "verify", "input": {"a": 2}, "idempotency_key": "kk"}
    assert (await client_dev_alice.post("/v1/runs", json=body1)).status_code == 201
    r = await client_dev_alice.post("/v1/runs", json=body2)
    assert r.status_code == 409
