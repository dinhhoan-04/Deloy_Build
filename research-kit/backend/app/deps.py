from collections.abc import AsyncIterator
from datetime import timedelta
from fastapi import Depends, Header, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.errors import AuthError
from app.auth.google import GoogleVerifier, JWKSCache
from app.auth.session import SessionService
from app.db import get_session
from app.logging import user_id_ctx
from rk_shared.models import User


_session_service: SessionService | None = None
_google_verifier: GoogleVerifier | None = None


def session_service() -> SessionService:
    global _session_service
    if _session_service is None:
        s = get_settings()
        _session_service = SessionService(secret=s.session_secret, ttl=timedelta(hours=24))
    return _session_service


def google_verifier() -> GoogleVerifier:
    global _google_verifier
    if _google_verifier is None:
        s = get_settings()
        _google_verifier = GoogleVerifier(
            JWKSCache(client_id=s.google_client_id), client_id=s.google_client_id
        )
    return _google_verifier


async def db() -> AsyncIterator[AsyncSession]:
    async for s in get_session():
        yield s


async def current_user(
    request: Request,
    authorization: str | None = Header(default=None),
    x_dev_user: str | None = Header(default=None, alias="X-Dev-User"),
    s: AsyncSession = Depends(db),
) -> User:
    settings = get_settings()
    if settings.env == "development" and settings.dev_auth_bypass and x_dev_user:
        u = (await s.execute(select(User).where(User.email == x_dev_user))).scalar_one_or_none()
        if not u:
            u = User(google_sub=f"dev|{x_dev_user}", email=x_dev_user, name=x_dev_user)
            s.add(u)
            await s.commit()
            await s.refresh(u)
        user_id_ctx.set(str(u.id))
        return u

    if not authorization or not authorization.lower().startswith("bearer "):
        raise AuthError("missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    user_id = await session_service().validate(s, token)
    await s.commit()
    u = (await s.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not u:
        raise AuthError("user not found")
    user_id_ctx.set(str(u.id))
    return u
