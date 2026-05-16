import pytest
import uuid
from rk_shared.models import User, Project, Claim
from rk_shared.types import ClaimStatus


@pytest.mark.asyncio
async def test_inbox_add_list_delete(db_engine):
    from app.repos.inbox import InboxRepo
    async with db_engine() as s:
        u = User(google_sub="g1", email="g1@x"); s.add(u); await s.flush()
        p = Project(user_id=u.id, name="P"); s.add(p); await s.flush()
        c = Claim(user_id=u.id, project_id=p.id, text="t",
                  site="elicit", status=ClaimStatus.PENDING.value)
        s.add(c); await s.commit(); await s.refresh(c)

        repo = InboxRepo(s)
        item = await repo.add(u.id, project_id=p.id, claim_id=c.id)
        await s.commit()
        items = await repo.list_for(u.id, project_id=p.id)
        assert [i.id for i in items] == [item.id]

        await repo.remove(u.id, item.id); await s.commit()
        assert await repo.list_for(u.id, project_id=p.id) == []


@pytest.mark.asyncio
async def test_inbox_endpoint_roundtrip(client_dev_alice):
    r = await client_dev_alice.post("/v1/projects", json={"name": "P"})
    pid = r.json()["id"]
    r = await client_dev_alice.post("/v1/claims/batch", json={
        "project_id": pid, "claims": [{"text": "c", "site": "elicit"}]})
    cid = r.json()["created"][0]["id"]

    r = await client_dev_alice.post("/v1/inbox", json={"project_id": pid, "claim_id": cid})
    assert r.status_code == 201
    iid = r.json()["id"]

    r = await client_dev_alice.get("/v1/inbox", params={"project_id": pid})
    assert [i["id"] for i in r.json()] == [iid]

    r = await client_dev_alice.delete(f"/v1/inbox/{iid}")
    assert r.status_code == 204


@pytest.mark.asyncio
async def test_inbox_cascade_on_project_delete(client_dev_alice):
    r = await client_dev_alice.post("/v1/projects", json={"name": "P"})
    pid = r.json()["id"]
    r = await client_dev_alice.post("/v1/claims/batch", json={
        "project_id": pid, "claims": [{"text": "c", "site": "elicit"}]})
    cid = r.json()["created"][0]["id"]
    await client_dev_alice.post("/v1/inbox", json={"project_id": pid, "claim_id": cid})

    r = await client_dev_alice.delete(f"/v1/projects/{pid}")
    assert r.status_code == 204

    r = await client_dev_alice.get("/v1/inbox", params={"project_id": pid})
    assert r.json() == []


@pytest.mark.asyncio
async def test_inbox_archive_unarchive(client_dev_alice):
    # Setup: project + claim + inbox item
    r = await client_dev_alice.post("/v1/projects", json={"name": "P"})
    pid = r.json()["id"]
    r = await client_dev_alice.post("/v1/claims/batch", json={
        "project_id": pid, "claims": [{"text": "c", "site": "elicit"}]})
    cid = r.json()["created"][0]["id"]
    r = await client_dev_alice.post("/v1/inbox", json={"project_id": pid, "claim_id": cid})
    iid = r.json()["id"]

    # List: archived_at is null by default
    r = await client_dev_alice.get("/v1/inbox", params={"project_id": pid})
    item = r.json()[0]
    assert item["archived_at"] is None

    # Archive
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    r = await client_dev_alice.patch(f"/v1/inbox/{iid}", json={"archived_at": now})
    assert r.status_code == 200
    assert r.json()["archived_at"] is not None

    # List still returns item (frontend filters)
    r = await client_dev_alice.get("/v1/inbox", params={"project_id": pid})
    assert len(r.json()) == 1
    assert r.json()[0]["archived_at"] is not None

    # Unarchive
    r = await client_dev_alice.patch(f"/v1/inbox/{iid}", json={"archived_at": None})
    assert r.status_code == 200
    assert r.json()["archived_at"] is None


@pytest.mark.asyncio
async def test_inbox_patch_not_found(client_dev_alice):
    fake_id = str(uuid.uuid4())
    from datetime import datetime, timezone
    r = await client_dev_alice.patch(
        f"/v1/inbox/{fake_id}",
        json={"archived_at": datetime.now(timezone.utc).isoformat()}
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_inbox_bulk_patch_archives_multiple(client_dev_alice):
    r = await client_dev_alice.post("/v1/projects", json={"name": "P"})
    pid = r.json()["id"]
    r = await client_dev_alice.post("/v1/claims/batch", json={
        "project_id": pid,
        "claims": [{"text": "c1", "site": "elicit"}, {"text": "c2", "site": "elicit"}],
    })
    cid1 = r.json()["created"][0]["id"]
    cid2 = r.json()["created"][1]["id"]

    r1 = await client_dev_alice.post("/v1/inbox", json={"project_id": pid, "claim_id": cid1})
    r2 = await client_dev_alice.post("/v1/inbox", json={"project_id": pid, "claim_id": cid2})
    iid1, iid2 = r1.json()["id"], r2.json()["id"]

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    r = await client_dev_alice.patch(
        "/v1/inbox/bulk",
        json={"ids": [iid1, iid2], "archived_at": now},
    )
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 2
    assert all(i["archived_at"] is not None for i in items)


@pytest.mark.asyncio
async def test_inbox_bulk_patch_unarchives(client_dev_alice):
    r = await client_dev_alice.post("/v1/projects", json={"name": "P2"})
    pid = r.json()["id"]
    r = await client_dev_alice.post("/v1/claims/batch", json={
        "project_id": pid,
        "claims": [{"text": "c1", "site": "elicit"}],
    })
    cid = r.json()["created"][0]["id"]
    r = await client_dev_alice.post("/v1/inbox", json={"project_id": pid, "claim_id": cid})
    iid = r.json()["id"]

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    await client_dev_alice.patch("/v1/inbox/bulk", json={"ids": [iid], "archived_at": now})

    r = await client_dev_alice.patch("/v1/inbox/bulk", json={"ids": [iid], "archived_at": None})
    assert r.status_code == 200
    assert r.json()[0]["archived_at"] is None


@pytest.mark.asyncio
async def test_inbox_bulk_patch_ignores_other_users_items(client_dev_alice, client_dev_bob):
    # Bob creates a project + claim + inbox item
    r = await client_dev_bob.post("/v1/projects", json={"name": "Bob"})
    pid = r.json()["id"]
    r = await client_dev_bob.post("/v1/claims/batch", json={
        "project_id": pid,
        "claims": [{"text": "c", "site": "elicit"}],
    })
    cid = r.json()["created"][0]["id"]
    r = await client_dev_bob.post("/v1/inbox", json={"project_id": pid, "claim_id": cid})
    bob_iid = r.json()["id"]

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    # Alice sends Bob's inbox ID — should return empty list (silently skipped)
    r = await client_dev_alice.patch("/v1/inbox/bulk", json={"ids": [bob_iid], "archived_at": now})
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_inbox_remove_keeps_claim(db_engine):
    """DELETE /inbox/{id} must NOT delete the underlying claim."""
    from app.repos.inbox import InboxRepo
    from sqlalchemy import select

    async with db_engine() as s:
        u = User(google_sub="g_keep", email="g_keep@x"); s.add(u); await s.flush()
        p = Project(user_id=u.id, name="P"); s.add(p); await s.flush()
        c = Claim(user_id=u.id, project_id=p.id, text="t",
                  site="elicit", status=ClaimStatus.PENDING.value)
        s.add(c); await s.commit(); await s.refresh(c)
        claim_id = c.id

        repo = InboxRepo(s)
        item = await repo.add(u.id, project_id=p.id, claim_id=c.id)
        await s.commit()

        await repo.remove(u.id, item.id); await s.commit()

        # Claim must still exist
        survivor = (await s.execute(select(Claim).where(Claim.id == claim_id))).scalar_one_or_none()
        assert survivor is not None


@pytest.mark.asyncio
async def test_inbox_bulk_patch_preserves_input_order(client_dev_alice):
    r = await client_dev_alice.post("/v1/projects", json={"name": "Order"})
    pid = r.json()["id"]
    r = await client_dev_alice.post("/v1/claims/batch", json={
        "project_id": pid,
        "claims": [{"text": f"c{i}", "site": "elicit"} for i in range(3)],
    })
    cids = [c["id"] for c in r.json()["created"]]
    iids = []
    for cid in cids:
        r = await client_dev_alice.post("/v1/inbox", json={"project_id": pid, "claim_id": cid})
        iids.append(r.json()["id"])

    reversed_ids = list(reversed(iids))
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    r = await client_dev_alice.patch("/v1/inbox/bulk", json={"ids": reversed_ids, "archived_at": now})
    assert r.status_code == 200
    assert [i["id"] for i in r.json()] == reversed_ids
