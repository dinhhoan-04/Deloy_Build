import pytest
from unittest.mock import AsyncMock, patch
from uuid import uuid4


def _make_user(user_id):
    from rk_shared.models import User
    return User(id=user_id, google_sub=str(user_id), email=f"{user_id}@test.com")


@pytest.mark.asyncio
async def test_detect_conflicts_creates_conflict_when_contradiction_found(async_session):
    """_detect_conflicts creates a conflict when LLM says contradicts=True."""
    from rk_shared.models import Claim, Project
    from rk_shared.types import ClaimStatus

    user_id = uuid4()
    async_session.add(_make_user(user_id))
    await async_session.flush()

    project = Project(user_id=user_id, name="Test")
    async_session.add(project)
    await async_session.flush()

    doi = "10.1234/test"
    claim_a = Claim(
        user_id=user_id, project_id=project.id,
        text="Exercise increases depression", doi=doi, paper_title="P1",
        site="pubmed", status=ClaimStatus.VERIFIED.value, quote="quote A",
    )
    claim_b = Claim(
        user_id=user_id, project_id=project.id,
        text="Exercise reduces depression", doi=doi, paper_title="P1",
        site="pubmed", status=ClaimStatus.PENDING.value, quote="quote B",
    )
    async_session.add_all([claim_a, claim_b])
    await async_session.flush()

    mock_provider = AsyncMock()
    mock_provider.extract = AsyncMock(return_value={"contradictions": [
        {"candidate_id": str(claim_a.id), "contradicts": True}
    ]})

    with patch("app.routers.claims._make_provider", return_value=mock_provider):
        from app.routers.claims import _detect_conflicts
        await _detect_conflicts(async_session, user_id, claim_b.id, project.id)

    from sqlalchemy import select
    from rk_shared.models import Conflict
    conflicts = list((await async_session.execute(
        select(Conflict).where(Conflict.project_id == project.id)
    )).scalars())
    assert len(conflicts) == 1
    side_ids = {s["claim_id"] for s in conflicts[0].sides}
    assert str(claim_a.id) in side_ids
    assert str(claim_b.id) in side_ids


@pytest.mark.asyncio
async def test_detect_conflicts_no_conflict_when_no_contradiction(async_session):
    from rk_shared.models import Claim, Project, Conflict
    from rk_shared.types import ClaimStatus
    from sqlalchemy import select

    user_id = uuid4()
    async_session.add(_make_user(user_id))
    await async_session.flush()

    project = Project(user_id=user_id, name="Test2")
    async_session.add(project)
    await async_session.flush()

    doi = "10.9999/nodiff"
    claim_a = Claim(
        user_id=user_id, project_id=project.id,
        text="A", doi=doi, paper_title="P", site="pubmed",
        status=ClaimStatus.VERIFIED.value, quote="q",
    )
    claim_b = Claim(
        user_id=user_id, project_id=project.id,
        text="B", doi=doi, paper_title="P", site="pubmed",
        status=ClaimStatus.PENDING.value, quote="q2",
    )
    async_session.add_all([claim_a, claim_b])
    await async_session.flush()

    mock_provider = AsyncMock()
    mock_provider.extract = AsyncMock(return_value={"contradictions": [
        {"candidate_id": str(claim_a.id), "contradicts": False}
    ]})

    with patch("app.routers.claims._make_provider", return_value=mock_provider):
        from app.routers.claims import _detect_conflicts
        await _detect_conflicts(async_session, user_id, claim_b.id, project.id)

    conflicts = list((await async_session.execute(
        select(Conflict).where(Conflict.project_id == project.id)
    )).scalars())
    assert len(conflicts) == 0


@pytest.mark.asyncio
async def test_detect_conflicts_no_duplicate(async_session):
    """_detect_conflicts does not create a second conflict for the same pair."""
    from rk_shared.models import Claim, Project, Conflict
    from rk_shared.types import ClaimStatus
    from sqlalchemy import select

    user_id = uuid4()
    async_session.add(_make_user(user_id))
    await async_session.flush()

    project = Project(user_id=user_id, name="Test3")
    async_session.add(project)
    await async_session.flush()

    doi = "10.0001/dup"
    claim_a = Claim(
        user_id=user_id, project_id=project.id,
        text="A", doi=doi, paper_title="P", site="pubmed",
        status=ClaimStatus.VERIFIED.value, quote="q",
    )
    claim_b = Claim(
        user_id=user_id, project_id=project.id,
        text="B", doi=doi, paper_title="P", site="pubmed",
        status=ClaimStatus.PENDING.value, quote="q2",
    )
    async_session.add_all([claim_a, claim_b])
    await async_session.flush()

    # Pre-existing conflict for the same pair
    existing = Conflict(
        user_id=user_id, project_id=project.id, group_key=doi,
        doi=doi, paper_title="P",
        sides=[{"claim_id": str(claim_a.id), "label": "A", "quote": "q"},
               {"claim_id": str(claim_b.id), "label": "B", "quote": "q2"}],
    )
    async_session.add(existing)
    await async_session.flush()

    mock_provider = AsyncMock()
    mock_provider.extract = AsyncMock(return_value={"contradictions": [
        {"candidate_id": str(claim_a.id), "contradicts": True}
    ]})

    with patch("app.routers.claims._make_provider", return_value=mock_provider):
        from app.routers.claims import _detect_conflicts
        await _detect_conflicts(async_session, user_id, claim_b.id, project.id)

    conflicts = list((await async_session.execute(
        select(Conflict).where(Conflict.project_id == project.id)
    )).scalars())
    assert len(conflicts) == 1  # still just the original


@pytest.mark.asyncio
async def test_detect_conflicts_makes_single_llm_call_for_multiple_candidates(async_session):
    """Even with N candidates, _detect_conflicts calls provider.extract exactly once."""
    from rk_shared.models import Claim, Project, Conflict
    from rk_shared.types import ClaimStatus
    from sqlalchemy import select

    user_id = uuid4()
    async_session.add(_make_user(user_id))
    await async_session.flush()

    project = Project(user_id=user_id, name="Batch")
    async_session.add(project); await async_session.flush()

    doi = "10.1/batch"
    new_claim = Claim(user_id=user_id, project_id=project.id, text="new",
                      doi=doi, paper_title="P", site="pubmed",
                      status=ClaimStatus.PENDING.value, quote="qn")
    candidates = [
        Claim(user_id=user_id, project_id=project.id, text=f"c{i}",
              doi=doi, paper_title="P", site="pubmed",
              status=ClaimStatus.VERIFIED.value, quote=f"q{i}")
        for i in range(3)
    ]
    async_session.add(new_claim); async_session.add_all(candidates); await async_session.flush()

    mock_provider = AsyncMock()
    mock_provider.extract = AsyncMock(return_value={"contradictions": [
        {"candidate_id": str(candidates[0].id), "contradicts": True},
        {"candidate_id": str(candidates[1].id), "contradicts": False},
        {"candidate_id": str(candidates[2].id), "contradicts": True},
    ]})

    with patch("app.routers.claims._make_provider", return_value=mock_provider):
        from app.routers.claims import _detect_conflicts
        await _detect_conflicts(async_session, user_id, new_claim.id, project.id)

    assert mock_provider.extract.await_count == 1
    conflicts = list((await async_session.execute(
        select(Conflict).where(Conflict.project_id == project.id)
    )).scalars())
    assert len(conflicts) == 2  # candidates[0] and candidates[2]


@pytest.mark.asyncio
async def test_detect_conflicts_caps_candidates_at_max(async_session, caplog):
    from rk_shared.models import Claim, Project
    from rk_shared.types import ClaimStatus
    import json

    user_id = uuid4()
    async_session.add(_make_user(user_id))
    await async_session.flush()

    project = Project(user_id=user_id, name="Cap")
    async_session.add(project); await async_session.flush()

    doi = "10.1/cap"
    new_claim = Claim(user_id=user_id, project_id=project.id, text="new",
                      doi=doi, paper_title="P", site="pubmed",
                      status=ClaimStatus.PENDING.value, quote="qn")
    cands = [
        Claim(user_id=user_id, project_id=project.id, text=f"c{i}",
              doi=doi, paper_title="P", site="pubmed",
              status=ClaimStatus.VERIFIED.value, quote=f"q{i}")
        for i in range(15)
    ]
    async_session.add(new_claim); async_session.add_all(cands); await async_session.flush()

    mock_provider = AsyncMock()
    mock_provider.extract = AsyncMock(return_value={"contradictions": []})

    with patch("app.routers.claims._make_provider", return_value=mock_provider):
        from app.routers.claims import _detect_conflicts
        await _detect_conflicts(async_session, user_id, new_claim.id, project.id)

    user_msg = mock_provider.extract.await_args.args[1]
    payload = json.loads(user_msg)
    assert len(payload["candidates"]) == 10


@pytest.mark.asyncio
async def test_detect_conflicts_ignores_hallucinated_candidate_ids(async_session):
    from rk_shared.models import Claim, Project, Conflict
    from rk_shared.types import ClaimStatus
    from sqlalchemy import select

    user_id = uuid4()
    async_session.add(_make_user(user_id))
    await async_session.flush()

    project = Project(user_id=user_id, name="Hallu")
    async_session.add(project); await async_session.flush()

    doi = "10.1/hallu"
    new_claim = Claim(user_id=user_id, project_id=project.id, text="new",
                      doi=doi, paper_title="P", site="pubmed",
                      status=ClaimStatus.PENDING.value, quote="qn")
    cand = Claim(user_id=user_id, project_id=project.id, text="c",
                 doi=doi, paper_title="P", site="pubmed",
                 status=ClaimStatus.VERIFIED.value, quote="q")
    async_session.add_all([new_claim, cand]); await async_session.flush()

    mock_provider = AsyncMock()
    mock_provider.extract = AsyncMock(return_value={"contradictions": [
        {"candidate_id": str(uuid4()), "contradicts": True},  # not in input
    ]})

    with patch("app.routers.claims._make_provider", return_value=mock_provider):
        from app.routers.claims import _detect_conflicts
        await _detect_conflicts(async_session, user_id, new_claim.id, project.id)

    conflicts = list((await async_session.execute(
        select(Conflict).where(Conflict.project_id == project.id)
    )).scalars())
    assert conflicts == []


@pytest.mark.asyncio
async def test_detect_conflicts_sets_checked_at_on_llm_success(async_session):
    """After a successful LLM call, the new claim's conflicts_checked_at is set."""
    from rk_shared.models import Claim, Project
    from rk_shared.types import ClaimStatus
    from sqlalchemy import select

    user_id = uuid4()
    async_session.add(_make_user(user_id))
    await async_session.flush()

    project = Project(user_id=user_id, name="TS-Happy")
    async_session.add(project); await async_session.flush()

    doi = "10.42/happy"
    claim_a = Claim(user_id=user_id, project_id=project.id,
                    text="A", doi=doi, paper_title="P", site="pubmed",
                    status=ClaimStatus.VERIFIED.value, quote="qa")
    claim_b = Claim(user_id=user_id, project_id=project.id,
                    text="B", doi=doi, paper_title="P", site="pubmed",
                    status=ClaimStatus.PENDING.value, quote="qb")
    async_session.add_all([claim_a, claim_b]); await async_session.flush()

    mock_provider = AsyncMock()
    mock_provider.extract = AsyncMock(return_value={"contradictions": []})

    with patch("app.routers.claims._make_provider", return_value=mock_provider):
        from app.routers.claims import _detect_conflicts
        await _detect_conflicts(async_session, user_id, claim_b.id, project.id)

    refreshed = (await async_session.execute(
        select(Claim).where(Claim.id == claim_b.id)
    )).scalar_one()
    assert refreshed.conflicts_checked_at is not None


@pytest.mark.asyncio
async def test_detect_conflicts_sets_checked_at_when_no_doi_no_title(async_session):
    """No DOI and no paper_title -> still mark as checked (nothing to group on)."""
    from rk_shared.models import Claim, Project
    from rk_shared.types import ClaimStatus
    from sqlalchemy import select

    user_id = uuid4()
    async_session.add(_make_user(user_id)); await async_session.flush()
    project = Project(user_id=user_id, name="NoMeta")
    async_session.add(project); await async_session.flush()

    c = Claim(user_id=user_id, project_id=project.id,
              text="orphan", doi=None, paper_title=None, site="pubmed",
              status=ClaimStatus.PENDING.value, quote="q")
    async_session.add(c); await async_session.flush()

    with patch("app.routers.claims._make_provider", return_value=AsyncMock()):
        from app.routers.claims import _detect_conflicts
        await _detect_conflicts(async_session, user_id, c.id, project.id)

    refreshed = (await async_session.execute(select(Claim).where(Claim.id == c.id))).scalar_one()
    assert refreshed.conflicts_checked_at is not None


@pytest.mark.asyncio
async def test_detect_conflicts_sets_checked_at_when_no_candidates(async_session):
    """When no same-paper candidates exist, mark as checked anyway."""
    from rk_shared.models import Claim, Project
    from rk_shared.types import ClaimStatus
    from sqlalchemy import select

    user_id = uuid4()
    async_session.add(_make_user(user_id)); await async_session.flush()
    project = Project(user_id=user_id, name="Lonely")
    async_session.add(project); await async_session.flush()

    c = Claim(user_id=user_id, project_id=project.id,
              text="alone", doi="10.1/alone", paper_title="P", site="pubmed",
              status=ClaimStatus.PENDING.value, quote="q")
    async_session.add(c); await async_session.flush()

    with patch("app.routers.claims._make_provider", return_value=AsyncMock()):
        from app.routers.claims import _detect_conflicts
        await _detect_conflicts(async_session, user_id, c.id, project.id)

    refreshed = (await async_session.execute(select(Claim).where(Claim.id == c.id))).scalar_one()
    assert refreshed.conflicts_checked_at is not None


@pytest.mark.asyncio
async def test_detect_conflicts_sets_checked_at_when_all_pairs_already_exist(async_session):
    """When every candidate is already conflict-paired with the new claim, still mark checked."""
    from rk_shared.models import Claim, Project, Conflict
    from rk_shared.types import ClaimStatus
    from sqlalchemy import select

    user_id = uuid4()
    async_session.add(_make_user(user_id)); await async_session.flush()
    project = Project(user_id=user_id, name="AllPaired")
    async_session.add(project); await async_session.flush()

    doi = "10.1/paired"
    new_claim = Claim(user_id=user_id, project_id=project.id,
                      text="new", doi=doi, paper_title="P", site="pubmed",
                      status=ClaimStatus.PENDING.value, quote="qn")
    cand = Claim(user_id=user_id, project_id=project.id,
                 text="cand", doi=doi, paper_title="P", site="pubmed",
                 status=ClaimStatus.VERIFIED.value, quote="qc")
    async_session.add_all([new_claim, cand]); await async_session.flush()

    existing = Conflict(
        user_id=user_id, project_id=project.id, group_key=doi,
        doi=doi, paper_title="P",
        sides=[{"claim_id": str(new_claim.id), "label": "A", "quote": "qn"},
               {"claim_id": str(cand.id), "label": "B", "quote": "qc"}],
    )
    async_session.add(existing); await async_session.flush()

    with patch("app.routers.claims._make_provider", return_value=AsyncMock()):
        from app.routers.claims import _detect_conflicts
        await _detect_conflicts(async_session, user_id, new_claim.id, project.id)

    refreshed = (await async_session.execute(
        select(Claim).where(Claim.id == new_claim.id))).scalar_one()
    assert refreshed.conflicts_checked_at is not None


@pytest.mark.asyncio
async def test_detect_conflicts_marks_checked_when_no_provider(async_session):
    """No provider configured -> still mark checked (best-effort detection)."""
    from rk_shared.models import Claim, Project
    from rk_shared.types import ClaimStatus
    from sqlalchemy import select

    user_id = uuid4()
    async_session.add(_make_user(user_id)); await async_session.flush()
    project = Project(user_id=user_id, name="NoProv")
    async_session.add(project); await async_session.flush()

    doi = "10.1/noprov"
    a = Claim(user_id=user_id, project_id=project.id,
              text="A", doi=doi, paper_title="P", site="pubmed",
              status=ClaimStatus.VERIFIED.value, quote="qa")
    b = Claim(user_id=user_id, project_id=project.id,
              text="B", doi=doi, paper_title="P", site="pubmed",
              status=ClaimStatus.PENDING.value, quote="qb")
    async_session.add_all([a, b]); await async_session.flush()

    with patch("app.routers.claims._make_provider", return_value=None):
        from app.routers.claims import _detect_conflicts
        await _detect_conflicts(async_session, user_id, b.id, project.id)

    refreshed = (await async_session.execute(select(Claim).where(Claim.id == b.id))).scalar_one()
    assert refreshed.conflicts_checked_at is not None


@pytest.mark.asyncio
async def test_detect_conflicts_marks_checked_when_llm_raises(async_session):
    """LLM exception -> still mark checked (best-effort detection)."""
    from rk_shared.models import Claim, Project
    from rk_shared.types import ClaimStatus
    from sqlalchemy import select

    user_id = uuid4()
    async_session.add(_make_user(user_id)); await async_session.flush()
    project = Project(user_id=user_id, name="Raise")
    async_session.add(project); await async_session.flush()

    doi = "10.1/raise"
    a = Claim(user_id=user_id, project_id=project.id,
              text="A", doi=doi, paper_title="P", site="pubmed",
              status=ClaimStatus.VERIFIED.value, quote="qa")
    b = Claim(user_id=user_id, project_id=project.id,
              text="B", doi=doi, paper_title="P", site="pubmed",
              status=ClaimStatus.PENDING.value, quote="qb")
    async_session.add_all([a, b]); await async_session.flush()

    mock_provider = AsyncMock()
    mock_provider.extract = AsyncMock(side_effect=RuntimeError("boom"))

    with patch("app.routers.claims._make_provider", return_value=mock_provider):
        from app.routers.claims import _detect_conflicts
        await _detect_conflicts(async_session, user_id, b.id, project.id)

    refreshed = (await async_session.execute(select(Claim).where(Claim.id == b.id))).scalar_one()
    assert refreshed.conflicts_checked_at is not None


@pytest.mark.asyncio
async def test_detect_conflicts_marks_checked_on_llm_timeout(async_session):
    """LLM call exceeding timeout -> still mark checked (no infinite pending)."""
    import asyncio
    from rk_shared.models import Claim, Project
    from rk_shared.types import ClaimStatus
    from sqlalchemy import select

    user_id = uuid4()
    async_session.add(_make_user(user_id)); await async_session.flush()
    project = Project(user_id=user_id, name="Timeout")
    async_session.add(project); await async_session.flush()

    doi = "10.1/timeout"
    a = Claim(user_id=user_id, project_id=project.id,
              text="A", doi=doi, paper_title="P", site="pubmed",
              status=ClaimStatus.VERIFIED.value, quote="qa")
    b = Claim(user_id=user_id, project_id=project.id,
              text="B", doi=doi, paper_title="P", site="pubmed",
              status=ClaimStatus.PENDING.value, quote="qb")
    async_session.add_all([a, b]); await async_session.flush()

    async def _hang(*args, **kwargs):
        await asyncio.sleep(100)

    mock_provider = AsyncMock()
    mock_provider.extract = AsyncMock(side_effect=_hang)

    with patch("app.routers.claims._make_provider", return_value=mock_provider), \
         patch("app.routers.claims._CONFLICT_DETECT_LLM_TIMEOUT_S", 0.05):
        from app.routers.claims import _detect_conflicts
        await _detect_conflicts(async_session, user_id, b.id, project.id)

    refreshed = (await async_session.execute(select(Claim).where(Claim.id == b.id))).scalar_one()
    assert refreshed.conflicts_checked_at is not None
