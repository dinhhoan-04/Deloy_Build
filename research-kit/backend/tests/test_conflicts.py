import pytest


@pytest.mark.asyncio
async def test_conflicts_crud_and_cascade(client_dev_alice, client_dev_bob):
    r = await client_dev_alice.post("/v1/projects", json={"name": "P"})
    pid = r.json()["id"]
    r = await client_dev_alice.post(
        "/v1/claims/batch",
        json={
            "project_id": pid,
            "claims": [{"text": "x", "site": "elicit"}, {"text": "y", "site": "scispace"}],
        },
    )
    c1, c2 = [c["id"] for c in r.json()["created"]]

    body = {
        "project_id": pid,
        "group_key": "g1",
        "doi": "10.1/abc",
        "sides": [
            {"claim_id": c1, "label": "positive"},
            {"claim_id": c2, "label": "negative"},
        ],
    }
    r = await client_dev_alice.post("/v1/conflicts", json=body)
    assert r.status_code == 201
    cid = r.json()["id"]

    r = await client_dev_alice.get("/v1/conflicts", params={"project_id": pid})
    assert any(c["id"] == cid for c in r.json())

    r = await client_dev_bob.get("/v1/conflicts", params={"project_id": pid})
    assert all(c["id"] != cid for c in r.json())

    r = await client_dev_alice.patch(f"/v1/conflicts/{cid}", json={"resolution": "kept first"})
    assert r.json()["resolution"] == "kept first"

    # cascade
    await client_dev_alice.delete(f"/v1/projects/{pid}")
    r = await client_dev_alice.get("/v1/conflicts", params={"project_id": pid})
    assert r.json() == []


@pytest.mark.asyncio
async def test_find_by_claim_pair_only_matches_when_both_present(async_session):
    from rk_shared.models import Project, Conflict
    from app.repos.conflicts import ConflictRepo
    from uuid import uuid4

    from rk_shared.models import User

    user_id = uuid4()
    user = User(id=user_id, google_sub=str(user_id), email="test@example.com")
    async_session.add(user)
    await async_session.flush()
    p = Project(user_id=user_id, name="P")
    async_session.add(p)
    await async_session.flush()

    a, b, c = uuid4(), uuid4(), uuid4()
    overlap_one = Conflict(
        user_id=user_id,
        project_id=p.id,
        group_key="g1",
        sides=[
            {"claim_id": str(a), "label": "A", "quote": "x"},
            {"claim_id": str(c), "label": "C", "quote": "y"},
        ],
    )
    match = Conflict(
        user_id=user_id,
        project_id=p.id,
        group_key="g2",
        sides=[
            {"claim_id": str(a), "label": "A", "quote": "x"},
            {"claim_id": str(b), "label": "B", "quote": "y"},
        ],
    )
    async_session.add_all([overlap_one, match])
    await async_session.flush()

    repo = ConflictRepo(async_session)
    found = await repo.find_by_claim_pair(user_id, p.id, a, b)
    assert found is not None and found.id == match.id

    pairs = await repo.pairs_for_project(user_id, p.id)
    assert frozenset({a, b}) in pairs
    assert frozenset({a, c}) in pairs


@pytest.mark.asyncio
async def test_check_status_returns_max_timestamp_and_pending_count(async_session):
    from rk_shared.models import Project, Claim, User
    from app.repos.conflicts import ConflictRepo
    from datetime import datetime, timedelta, timezone
    from uuid import uuid4

    uid = uuid4()
    async_session.add(User(id=uid, google_sub=str(uid), email="t@e.com"))
    await async_session.flush()
    p = Project(user_id=uid, name="P")
    async_session.add(p)
    await async_session.flush()

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    older = now - timedelta(minutes=5)

    # 1 verified, checked recently
    async_session.add(
        Claim(
            user_id=uid,
            project_id=p.id,
            text="x1",
            site="pubmed",
            status="verified",
            conflicts_checked_at=now,
        )
    )
    # 1 verified, checked earlier
    async_session.add(
        Claim(
            user_id=uid,
            project_id=p.id,
            text="x2",
            site="pubmed",
            status="verified",
            conflicts_checked_at=older,
        )
    )
    # 1 verified, NOT yet checked -> pending
    async_session.add(
        Claim(
            user_id=uid,
            project_id=p.id,
            text="x3",
            site="pubmed",
            status="verified",
            conflicts_checked_at=None,
        )
    )
    # 1 partial, NOT yet checked -> pending
    async_session.add(
        Claim(
            user_id=uid,
            project_id=p.id,
            text="x4",
            site="pubmed",
            status="partial",
            conflicts_checked_at=None,
        )
    )
    # 1 pending status (NOT eligible for pending check) -> ignored
    async_session.add(
        Claim(
            user_id=uid,
            project_id=p.id,
            text="x5",
            site="pubmed",
            status="pending",
            conflicts_checked_at=None,
        )
    )
    await async_session.flush()

    last_at, pending = await ConflictRepo(async_session).check_status(uid, p.id)
    assert last_at == now
    assert pending == 2


@pytest.mark.asyncio
async def test_check_status_empty_project(async_session):
    from rk_shared.models import Project, User
    from app.repos.conflicts import ConflictRepo
    from uuid import uuid4

    uid = uuid4()
    async_session.add(User(id=uid, google_sub=str(uid), email="t@e.com"))
    await async_session.flush()
    p = Project(user_id=uid, name="Empty")
    async_session.add(p)
    await async_session.flush()

    last_at, pending = await ConflictRepo(async_session).check_status(uid, p.id)
    assert last_at is None
    assert pending == 0


@pytest.mark.asyncio
async def test_check_status_isolates_users_and_projects(async_session):
    from rk_shared.models import Project, Claim, User
    from app.repos.conflicts import ConflictRepo
    from datetime import datetime, timezone
    from uuid import uuid4

    u1, u2 = uuid4(), uuid4()
    async_session.add_all(
        [
            User(id=u1, google_sub=str(u1), email="a@e.com"),
            User(id=u2, google_sub=str(u2), email="b@e.com"),
        ]
    )
    await async_session.flush()
    p1a = Project(user_id=u1, name="P1A")
    p1b = Project(user_id=u1, name="P1B")
    p2 = Project(user_id=u2, name="P2")
    async_session.add_all([p1a, p1b, p2])
    await async_session.flush()

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    async_session.add(
        Claim(
            user_id=u1,
            project_id=p1b.id,
            text="other-proj",
            site="pubmed",
            status="verified",
            conflicts_checked_at=now,
        )
    )
    async_session.add(
        Claim(
            user_id=u2,
            project_id=p2.id,
            text="other-user",
            site="pubmed",
            status="verified",
            conflicts_checked_at=now,
        )
    )
    await async_session.flush()

    last_at, pending = await ConflictRepo(async_session).check_status(u1, p1a.id)
    assert last_at is None
    assert pending == 0


@pytest.mark.asyncio
async def test_check_status_endpoint_reports_pending_and_last(client_dev_alice):
    """End-to-end: PATCH a claim to verified, then GET /check-status reports pending or last."""
    r = await client_dev_alice.post("/v1/projects", json={"name": "CSE"})
    pid = r.json()["id"]

    # Empty project -> zeros
    r = await client_dev_alice.get("/v1/conflicts/check-status", params={"project_id": pid})
    assert r.status_code == 200
    body = r.json()
    assert body == {"last_checked_at": None, "pending_count": 0}

    # Add a verified claim directly (skip background); pending should be 1
    r = await client_dev_alice.post(
        "/v1/claims/batch",
        json={
            "project_id": pid,
            "claims": [{"text": "x", "site": "elicit", "doi": "10.1/x", "paper_title": "P"}],
        },
    )
    cid = r.json()["created"][0]["id"]
    await client_dev_alice.patch(f"/v1/claims/{cid}", json={"status": "verified"})

    r = await client_dev_alice.get("/v1/conflicts/check-status", params={"project_id": pid})
    assert r.status_code == 200
    body = r.json()
    # Either background ran (last_checked_at set, pending 0) or it didn't (pending 1).
    assert body["pending_count"] + (1 if body["last_checked_at"] else 0) >= 1


@pytest.mark.asyncio
async def test_check_status_endpoint_returns_zeros_for_other_users_project(
    client_dev_alice,
    client_dev_bob,
):
    """Bob asks about Alice's project -> safe zeros, no leak, no 404."""
    r = await client_dev_alice.post("/v1/projects", json={"name": "Private"})
    pid = r.json()["id"]
    await client_dev_alice.post(
        "/v1/claims/batch", json={"project_id": pid, "claims": [{"text": "x", "site": "elicit"}]}
    )

    r = await client_dev_bob.get("/v1/conflicts/check-status", params={"project_id": pid})
    assert r.status_code == 200
    assert r.json() == {"last_checked_at": None, "pending_count": 0}
