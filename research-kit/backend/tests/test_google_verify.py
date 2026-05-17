import pytest
from cryptography.hazmat.primitives import serialization
from tests.auth_fakes import make_keypair, issue_id_token


@pytest.mark.asyncio
async def test_verify_accepts_valid_token():
    key, _ = make_keypair()
    kid = "kid-1"
    token = issue_id_token(sub="g-123", email="a@b.com", aud="cid-1", kid=kid, key=key)

    from app.auth.google import GoogleVerifier, JWKSCache

    cache = JWKSCache(client_id="cid-1")
    pub_pem = (
        key.public_key()
        .public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        .decode()
    )
    cache._set_for_test({kid: pub_pem})

    verifier = GoogleVerifier(cache, client_id="cid-1")
    claims = await verifier.verify(token)
    assert claims["sub"] == "g-123"
    assert claims["email"] == "a@b.com"


@pytest.mark.asyncio
async def test_verify_rejects_wrong_aud():
    from app.auth.google import GoogleVerifier, JWKSCache
    from app.errors import AuthError

    key, _ = make_keypair()
    token = issue_id_token(sub="x", email="x@x", aud="OTHER", kid="k", key=key)
    cache = JWKSCache(client_id="cid-1")
    cache._set_for_test(
        {
            "k": key.public_key()
            .public_bytes(
                serialization.Encoding.PEM,
                serialization.PublicFormat.SubjectPublicKeyInfo,
            )
            .decode()
        }
    )
    with pytest.raises(AuthError):
        await GoogleVerifier(cache, client_id="cid-1").verify(token)
