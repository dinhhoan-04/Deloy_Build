import hashlib
import secrets
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import AuthError
from rk_shared.models import Session as SessionRow


def _hash(t: str) -> str:
    return hashlib.sha256(t.encode()).hexdigest()


class SessionService:
    def __init__(self, *, secret: str, ttl: timedelta):
        self.secret = secret
        self.ttl = ttl

    @staticmethod
    def _now() -> datetime:
        from datetime import timezone
        return datetime.now(timezone.utc).replace(tzinfo=None)

    async def issue(self, s: AsyncSession, *, user_id: UUID) -> str:
        token = secrets.token_urlsafe(32)
        now = self._now()
        s.add(
            SessionRow(
                token_hash=_hash(token),
                user_id=user_id,
                created_at=now,
                expires_at=now + self.ttl,
                last_used_at=now,
            )
        )
        return token

    async def validate(self, s: AsyncSession, token: str) -> UUID:
        if not token:
            raise AuthError("missing token")
        row = (
            await s.execute(select(SessionRow).where(SessionRow.token_hash == _hash(token)))
        ).scalar_one_or_none()
        now = self._now()
        if not row or row.expires_at < now:
            raise AuthError("invalid or expired session")
        await s.execute(
            update(SessionRow)
            .where(SessionRow.token_hash == row.token_hash)
            .values(last_used_at=now, expires_at=now + self.ttl)
        )
        return row.user_id

    async def revoke(self, s: AsyncSession, token: str) -> None:
        await s.execute(delete(SessionRow).where(SessionRow.token_hash == _hash(token)))
