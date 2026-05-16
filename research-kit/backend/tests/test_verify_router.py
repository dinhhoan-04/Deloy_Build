import pytest
from sqlalchemy import select

from rk_shared.models import Project


@pytest.mark.asyncio
async def test_verify_scoped_cache_hit(client_dev_alice, db_engine, monkeypatch):
    created = await client_dev_alice.post("/v1/projects", json={"name": "cache-proj"})
    pid = created.json()["id"]

    async with db_engine() as s:
        p = (await s.execute(select(Project).where(Project.id == pid))).scalar_one()
        uid = str(p.user_id)

    calls = {"fetch": 0, "llm": 0}

    async def fake_fetch_paper_content(doi, paper_url, paper_title):
        calls["fetch"] += 1
        return "paper text " * 100, "ok_via_test"

    async def fake_llm_verify(claim, doi, title, paper_text):
        calls["llm"] += 1
        from app.routers.verify import VerifyResponse
        return VerifyResponse(status="verified", verbatim_quote="paper text", confidence=0.9, reason="ok", paper_title=title, doi=doi), "openai"

    monkeypatch.setattr("app.routers.verify.fetch_paper_content", fake_fetch_paper_content)
    monkeypatch.setattr("app.routers.verify._llm_verify", fake_llm_verify)

    headers = {"X-RK-User-Id": uid, "X-RK-Project-Id": pid}
    payload = {"claim": "a claim", "doi": "10.1093/bioinformatics/btad410", "paper_title": "T"}
    r1 = await client_dev_alice.post("/v1/verify", json=payload, headers=headers)
    assert r1.status_code == 200, r1.text
    r2 = await client_dev_alice.post("/v1/verify", json=payload, headers=headers)
    assert r2.status_code == 200, r2.text
    assert calls["fetch"] == 1
    assert calls["llm"] == 1


@pytest.mark.asyncio
async def test_verify_upload_fallback_from_payload_too_large(client, monkeypatch):
    from app.llm.providers import PayloadTooLargeError

    class _Provider:
        def __init__(self, name):
            self.name = name
            self.calls = 0

        async def extract(self, system, user, schema):
            self.calls += 1
            if self.name == "zai":
                raise PayloadTooLargeError("413")
            return {"status": "partial", "verbatim_quote": None, "confidence": 0.4, "reason": "fallback"}

    providers = [_Provider("zai"), _Provider("openai")]
    monkeypatch.setattr("app.routers.verify._provider_chain", lambda: providers)
    monkeypatch.setattr("app.routers.verify._parse_pdf", lambda b: "x" * 50000)

    files = {"pdf": ("t.pdf", b"%PDF-1.4 fake", "application/pdf")}
    data = {"claim": "test claim", "doi": "10.1/x", "paper_title": "T"}
    r = await client.post("/v1/verify/upload", files=files, data=data)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "partial"
    assert providers[0].calls >= 1
    assert providers[1].calls >= 1
