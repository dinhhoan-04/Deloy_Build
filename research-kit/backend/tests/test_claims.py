import pytest
from datetime import datetime, timezone

from app.idempotency import RedisIdem
from app.schemas.claims import ClaimInput


@pytest.mark.asyncio
async def test_batch_idempotent(client_dev_alice, redis_url):
    r = await client_dev_alice.post("/v1/projects", json={"name": "P"})
    pid = r.json()["id"]
    body = {
        "project_id": pid,
        "claims": [{"text": "c1", "site": "elicit"}, {"text": "c2", "site": "elicit"}],
        "idempotency_key": "key-1",
    }
    r1 = await client_dev_alice.post("/v1/claims/batch", json=body)
    assert r1.status_code == 200, r1.text
    r2 = await client_dev_alice.post("/v1/claims/batch", json=body)
    assert r2.status_code == 200
    assert r1.json()["created"] == r2.json()["created"]


@pytest.mark.asyncio
async def test_batch_idem_conflict(client_dev_alice, redis_url):
    r = await client_dev_alice.post("/v1/projects", json={"name": "P2"})
    pid = r.json()["id"]
    base = {"project_id": pid, "idempotency_key": "k2"}
    a = await client_dev_alice.post(
        "/v1/claims/batch", json={**base, "claims": [{"text": "a", "site": "elicit"}]}
    )
    b = await client_dev_alice.post(
        "/v1/claims/batch", json={**base, "claims": [{"text": "b", "site": "elicit"}]}
    )
    assert a.status_code == 200 and b.status_code == 409


def test_idempotency_hash_handles_datetime_deterministically():
    payload = {
        "project_id": "p1",
        "claims": [{"text": "x", "extracted_at": datetime(2026, 5, 13, 12, 0, tzinfo=timezone.utc)}],
    }
    h1 = RedisIdem._hash(payload)
    h2 = RedisIdem._hash(payload)
    assert h1 == h2


@pytest.mark.asyncio
async def test_batch_accepts_extracted_at_datetime(client_dev_alice):
    r = await client_dev_alice.post("/v1/projects", json={"name": "P-dt"})
    pid = r.json()["id"]
    body = {
        "project_id": pid,
        "claims": [{
            "text": "claim with extracted_at",
            "site": "elicit",
            "extracted_at": "2026-05-13T12:00:00Z",
        }],
        "idempotency_key": "dt-1",
    }
    r1 = await client_dev_alice.post("/v1/claims/batch", json=body)
    assert r1.status_code == 200, r1.text
    r2 = await client_dev_alice.post("/v1/claims/batch", json=body)
    assert r2.status_code == 200
    assert r1.json()["created"] == r2.json()["created"]


@pytest.mark.asyncio
async def test_batch_accepts_extracted_at_with_non_utc_offset(client_dev_alice):
    r = await client_dev_alice.post("/v1/projects", json={"name": "P-tz"})
    pid = r.json()["id"]
    body = {
        "project_id": pid,
        "claims": [{
            "text": "claim with +07 extracted_at",
            "site": "elicit",
            "extracted_at": "2026-05-14T10:16:20+07:00",
        }],
        "idempotency_key": "dt-plus7-1",
    }
    resp = await client_dev_alice.post("/v1/claims/batch", json=body)
    assert resp.status_code == 200, resp.text
    dt = datetime.fromisoformat(resp.json()["created"][0]["extracted_at"])
    assert dt == datetime(2026, 5, 14, 3, 16, 20)


def test_claim_input_normalizes_aware_extracted_at_to_utc_naive():
    claim = ClaimInput(text="x", site="elicit", extracted_at="2026-05-14T10:16:20+07:00")
    assert claim.extracted_at == datetime(2026, 5, 14, 3, 16, 20)
