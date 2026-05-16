import hashlib
import json
from datetime import datetime, timezone
from uuid import UUID

import redis.asyncio as aioredis


class RedisIdem:
    def __init__(self, redis: aioredis.Redis):
        self.r = redis

    @staticmethod
    def _hash(payload: dict) -> str:
        def _default(value: object) -> str:
            if isinstance(value, datetime):
                dt = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
                return dt.astimezone(timezone.utc).isoformat(timespec="microseconds")
            if isinstance(value, UUID):
                return str(value)
            return str(value)

        serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=_default)
        return hashlib.sha256(serialized.encode()).hexdigest()

    async def get_or_set(
        self,
        *,
        user_id,
        key: str,
        payload_hash: str,
        value: str | None = None,
        ttl_sec: int = 86400,
    ) -> str | None:
        rkey = f"idem:{user_id}:{key}"
        existing = await self.r.get(rkey)
        if existing:
            stored = json.loads(existing)
            if stored["hash"] != payload_hash:
                from app.errors import ConflictError
                raise ConflictError("idempotency_key reused with different payload")
            return stored.get("value")
        if value is not None:
            await self.r.set(
                rkey,
                json.dumps({"hash": payload_hash, "value": value}),
                ex=ttl_sec,
            )
        return None
