import time
from typing import Any
import httpx
import jwt
from jwt import InvalidTokenError

from app.errors import AuthError

GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"


class JWKSCache:
    """Caches Google's JWKS for ~1h. Test path overrides via _set_for_test."""

    def __init__(self, client_id: str, ttl_sec: int = 3600):
        self.client_id = client_id
        self._ttl = ttl_sec
        self._keys: dict[str, str] = {}
        self._fetched_at: float = 0.0

    def _set_for_test(self, keys: dict[str, str]) -> None:
        self._keys = dict(keys)
        self._fetched_at = time.time()

    async def get(self, kid: str) -> str:
        if not self._keys or (time.time() - self._fetched_at) > self._ttl:
            await self._refresh()
        if kid not in self._keys:
            await self._refresh()
        if kid not in self._keys:
            raise AuthError(f"unknown kid: {kid}")
        return self._keys[kid]

    async def _refresh(self) -> None:
        from cryptography.hazmat.primitives import serialization as _ser

        async with httpx.AsyncClient(timeout=5.0) as c:
            r = await c.get(GOOGLE_JWKS_URL)
            r.raise_for_status()
            jwks = r.json()
        new: dict[str, str] = {}
        for k in jwks.get("keys", []):
            kid = k["kid"]
            new[kid] = (
                jwt.algorithms.RSAAlgorithm.from_jwk(k)
                .public_bytes(
                    encoding=_ser.Encoding.PEM,
                    format=_ser.PublicFormat.SubjectPublicKeyInfo,
                )
                .decode()
            )
        self._keys = new
        self._fetched_at = time.time()


class GoogleVerifier:
    def __init__(self, jwks: JWKSCache, *, client_id: str):
        self.jwks = jwks
        self.client_id = client_id

    async def verify(self, token: str) -> dict[str, Any]:
        try:
            unverified = jwt.get_unverified_header(token)
            kid = unverified.get("kid")
            if not kid:
                raise AuthError("missing kid")
            pub_pem = await self.jwks.get(kid)
            claims = jwt.decode(
                token,
                pub_pem,
                algorithms=["RS256"],
                audience=self.client_id,
                issuer=["https://accounts.google.com", "accounts.google.com"],
                options={"require": ["sub", "email", "exp", "iat"]},
            )
            return claims
        except InvalidTokenError as e:
            raise AuthError(f"invalid id token: {e}")
