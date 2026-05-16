import pytest
from uuid import uuid4
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_confirm_sets_resolved_columns_and_rejects_double_confirm(client_dev_alice):
    # Setup: project + two contradicting claims + conflict
    r = await client_dev_alice.post("/v1/projects", json={"name": "P"})
    pid = r.json()["id"]
    r = await client_dev_alice.post("/v1/claims/batch", json={
        "project_id": pid,
        "claims": [{"text": "A", "site": "elicit"}, {"text": "B", "site": "elicit"}],
    })
    cid_a = r.json()["created"][0]["id"]
    cid_b = r.json()["created"][1]["id"]

    r = await client_dev_alice.post("/v1/conflicts", json={
        "project_id": pid, "group_key": "g", "doi": None, "paper_title": "P",
        "sides": [
            {"claim_id": cid_a, "label": "A", "quote": "qa"},
            {"claim_id": cid_b, "label": "B", "quote": "qb"},
        ],
    })
    conflict_id = r.json()["id"]

    r = await client_dev_alice.post(f"/v1/conflicts/{conflict_id}/confirm",
                                    json={"accepted_claim_id": cid_a})
    assert r.status_code == 200
    body = r.json()
    assert body["conflict"]["resolved_at"] is not None
    assert body["conflict"]["accepted_claim_id"] == cid_a

    # Second confirm must reject
    r = await client_dev_alice.post(f"/v1/conflicts/{conflict_id}/confirm",
                                    json={"accepted_claim_id": cid_a})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_confirm_conflict_accepts_side_and_cleans_up(client: AsyncClient, auth_headers):
    """POST /v1/conflicts/:id/confirm verifies accepted claim, deletes rejected, adds to inbox."""
    from rk_shared.models import Claim, Project, Conflict, InboxItem
    from rk_shared.types import ClaimStatus
    from sqlalchemy import select
    from app.db import sessionmaker as get_sessionmaker

    sm = get_sessionmaker()
    async with sm() as s:
        # Get user_id from auth headers (assumes fixture sets up user)
        from rk_shared.models import User
        user = (await s.execute(select(User).limit(1))).scalar_one()
        user_id = user.id

        project = Project(user_id=user_id, name="ConfirmTest")
        s.add(project)
        await s.flush()

        claim_a = Claim(
            user_id=user_id, project_id=project.id,
            text="Claim A", doi="10.test/confirm", paper_title="P",
            site="pubmed", status=ClaimStatus.PARTIAL.value, quote="qa",
        )
        claim_b = Claim(
            user_id=user_id, project_id=project.id,
            text="Claim B", doi="10.test/confirm", paper_title="P",
            site="pubmed", status=ClaimStatus.PARTIAL.value, quote="qb",
        )
        s.add_all([claim_a, claim_b])
        await s.flush()

        conflict = Conflict(
            user_id=user_id, project_id=project.id,
            group_key="10.test/confirm", doi="10.test/confirm", paper_title="P",
            sides=[
                {"claim_id": str(claim_a.id), "label": "Claim A", "quote": "qa"},
                {"claim_id": str(claim_b.id), "label": "Claim B", "quote": "qb"},
            ],
        )
        s.add(conflict)
        await s.commit()

        conflict_id = conflict.id
        claim_a_id = claim_a.id
        claim_b_id = claim_b.id

    resp = await client.post(
        f"/v1/conflicts/{conflict_id}/confirm",
        json={"accepted_claim_id": str(claim_a_id)},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["conflict"]["id"] == str(conflict_id)
    assert body["inbox_item"]["claim_id"] == str(claim_a_id)

    async with sm() as s:
        # accepted claim is verified
        accepted = (await s.execute(select(Claim).where(Claim.id == claim_a_id))).scalar_one()
        assert accepted.status == ClaimStatus.VERIFIED.value

        # rejected claim is deleted
        rejected = (await s.execute(select(Claim).where(Claim.id == claim_b_id))).scalar_one_or_none()
        assert rejected is None

        # inbox item exists
        inbox = (await s.execute(
            select(InboxItem).where(InboxItem.claim_id == claim_a_id)
        )).scalar_one_or_none()
        assert inbox is not None

        # conflict resolution updated
        conf = (await s.execute(select(Conflict).where(Conflict.id == conflict_id))).scalar_one()
        import json
        res = json.loads(conf.resolution)
        assert res["kind"] == "confirmed"
        assert res["accepted_claim_id"] == str(claim_a_id)
