import pytest
from cryptography.hazmat.primitives import serialization
from tests.auth_fakes import make_keypair, issue_id_token


@pytest.mark.asyncio
async def test_login_me_logout(client, monkeypatch, db_engine):
    # set GOOGLE_CLIENT_ID to match what we sign with
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "cid")
    from app.config import get_settings

    get_settings.cache_clear()

    key, _ = make_keypair()
    from app.deps import google_verifier

    # reset cached verifier so it picks up new client_id
    import app.deps as _deps

    _deps._google_verifier = None
    get_settings.cache_clear()

    gv = google_verifier()
    pub_pem = (
        key.public_key()
        .public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        .decode()
    )
    gv.jwks._set_for_test({"k1": pub_pem})

    token = issue_id_token(sub="g-x", email="t@x", aud="cid", kid="k1", key=key)

    # login
    r = await client.post("/v1/auth/login", json={"google_id_token": token})
    assert r.status_code == 200, r.text
    body = r.json()
    sess = body["session_token"]
    assert body["user"]["email"] == "t@x"

    # me
    r2 = await client.get("/v1/auth/me", headers={"Authorization": f"Bearer {sess}"})
    assert r2.status_code == 200
    assert r2.json()["user"]["email"] == "t@x"

    # logout
    r3 = await client.post("/v1/auth/logout", headers={"Authorization": f"Bearer {sess}"})
    assert r3.status_code == 204

    # me after logout
    r4 = await client.get("/v1/auth/me", headers={"Authorization": f"Bearer {sess}"})
    assert r4.status_code == 401
