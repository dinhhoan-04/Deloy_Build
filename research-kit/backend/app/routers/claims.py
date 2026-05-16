import asyncio
import json
import logging
from uuid import UUID
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timezone
from sqlalchemy import select, update

from app.config import get_settings
from app.deps import current_user, db
from app.idempotency import RedisIdem
from app.llm.providers import GeminiProvider, ZaiProvider, OpenAIProvider
from app.redis_pool import get_redis
from app.repos.claims import ClaimRepo
from app.repos.conflicts import ConflictRepo
from app.schemas.claims import ClaimsBatchRequest, ClaimsBatchResponse, ClaimOut, ClaimPatch
from rk_shared.models import Claim, User

logger = logging.getLogger(__name__)

_CONFLICT_DETECT_MAX_CANDIDATES = 10
_CONFLICT_DETECT_LLM_TIMEOUT_S = 30.0

_CONFLICT_DETECT_BATCH_SYSTEM = (
    "You are checking whether a new scientific claim contradicts any of several "
    "existing claims from the same paper. For each candidate in the input list, "
    "output `contradicts: true` ONLY when the two claims make incompatible factual "
    "statements about the same quantity, direction, or outcome. Output exactly one "
    "entry per candidate id provided. Do not invent ids."
)

_CONFLICT_DETECT_BATCH_SCHEMA = {
    "type": "object",
    "properties": {
        "contradictions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "candidate_id": {"type": "string"},
                    "contradicts": {"type": "boolean"},
                    "rationale": {"type": "string"},
                },
                "required": ["candidate_id", "contradicts"],
            },
        },
    },
    "required": ["contradictions"],
}


def _make_provider():
    s = get_settings()
    if s.llm_primary_provider == "gemini" and s.gemini_api_key:
        return GeminiProvider(api_key=s.gemini_api_key, model=s.llm_gemini_model)
    if s.llm_primary_provider == "zai" and s.zai_api_key:
        return ZaiProvider(api_key=s.zai_api_key, model=s.llm_zai_model)
    if s.openai_api_key:
        return OpenAIProvider(api_key=s.openai_api_key, model=s.llm_openai_model)
    return None


async def _detect_conflicts(s: AsyncSession, user_id: UUID, new_claim_id: UUID,
                             project_id: UUID) -> None:
    """Check new_claim against same-paper claims via a single batched LLM call."""
    logger.info("conflict detect start claim_id=%s project_id=%s", new_claim_id, project_id)
    new_claim = (await s.execute(
        select(Claim).where(Claim.id == new_claim_id, Claim.user_id == user_id)
    )).scalar_one_or_none()
    if not new_claim:
        logger.info("conflict detect skip missing-claim claim_id=%s", new_claim_id)
        return

    async def _mark_checked() -> None:
        await s.execute(
            update(Claim)
            .where(Claim.id == new_claim_id, Claim.user_id == user_id)
            .values(conflicts_checked_at=datetime.now(timezone.utc).replace(tzinfo=None))
        )
        await s.commit()

    q = select(Claim).where(
        Claim.user_id == user_id,
        Claim.project_id == project_id,
        Claim.id != new_claim_id,
        Claim.status.in_(["verified", "partial"]),
    )
    if new_claim.doi:
        q = q.where(Claim.doi == new_claim.doi)
    elif new_claim.paper_title:
        q = q.where(Claim.paper_title == new_claim.paper_title)
    else:
        logger.info("conflict detect skip no-paper-identity claim_id=%s", new_claim_id)
        await _mark_checked(); return
    q = q.order_by(Claim.created_at.desc())

    all_candidates = list((await s.execute(q)).scalars())
    if not all_candidates:
        logger.info("conflict detect done no-candidates claim_id=%s", new_claim_id)
        await _mark_checked(); return
    if len(all_candidates) > _CONFLICT_DETECT_MAX_CANDIDATES:
        logger.info("conflict detect truncated %d candidates to %d",
                    len(all_candidates), _CONFLICT_DETECT_MAX_CANDIDATES)
    candidates = all_candidates[:_CONFLICT_DETECT_MAX_CANDIDATES]

    conflict_repo = ConflictRepo(s)
    existing_pairs = await conflict_repo.pairs_for_project(user_id, project_id)
    candidates = [c for c in candidates
                  if frozenset({new_claim_id, c.id}) not in existing_pairs]
    if not candidates:
        logger.info("conflict detect done all-pairs-existing claim_id=%s", new_claim_id)
        await _mark_checked(); return

    provider = _make_provider()
    if not provider:
        logger.warning("conflict detect no-provider claim_id=%s", new_claim_id)
        await _mark_checked()
        return

    user_msg = json.dumps({
        "claim_new": {"id": str(new_claim_id), "text": new_claim.text},
        "candidates": [{"id": str(c.id), "text": c.text} for c in candidates],
        "paper_title": new_claim.paper_title,
        "doi": new_claim.doi,
    })
    try:
        result = await asyncio.wait_for(
            provider.extract(
                _CONFLICT_DETECT_BATCH_SYSTEM, user_msg, _CONFLICT_DETECT_BATCH_SCHEMA,
            ),
            timeout=_CONFLICT_DETECT_LLM_TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        logger.warning("batch conflict detect timeout claim_id=%s after %.1fs",
                       new_claim_id, _CONFLICT_DETECT_LLM_TIMEOUT_S)
        await _mark_checked()
        return
    except Exception as exc:
        logger.warning("batch conflict detect failed claim_id=%s: %s", new_claim_id, exc)
        await _mark_checked()
        return

    created_count = 0
    by_id = {str(c.id): c for c in candidates}
    for entry in result.get("contradictions", []):
        if not entry.get("contradicts"):
            continue
        existing = by_id.get(entry.get("candidate_id"))
        if not existing:
            continue
        group_key = new_claim.doi or new_claim.paper_title or str(project_id)
        await conflict_repo.create(
            user_id,
            project_id=project_id,
            group_key=group_key,
            doi=new_claim.doi,
            paper_title=new_claim.paper_title,
            sides=[
                {"claim_id": str(new_claim_id), "label": "Claim A", "quote": new_claim.quote},
                {"claim_id": str(existing.id), "label": "Claim B", "quote": existing.quote},
            ],
        )
        created_count += 1
    await s.commit()
    await _mark_checked()
    logger.info(
        "conflict detect done claim_id=%s candidates=%d conflicts_created=%d",
        new_claim_id, len(candidates), created_count
    )


router = APIRouter(prefix="/v1/claims", tags=["claims"])


def _out(c) -> ClaimOut:
    return ClaimOut.model_validate(c, from_attributes=True)


@router.post("/batch", response_model=ClaimsBatchResponse)
async def batch_create(
    body: ClaimsBatchRequest,
    u: User = Depends(current_user),
    s: AsyncSession = Depends(db),
):
    items = [c.model_dump() for c in body.claims]

    if body.idempotency_key:
        r = await get_redis()
        idem = RedisIdem(r)
        payload_hash = RedisIdem._hash({"project_id": str(body.project_id), "claims": items})
        cached_ids = await idem.get_or_set(
            user_id=u.id, key=body.idempotency_key, payload_hash=payload_hash
        )
        if cached_ids:
            ids = [UUID(x) for x in cached_ids.split(",")]
            rows = list((await s.execute(select(Claim).where(Claim.id.in_(ids)))).scalars())
            return ClaimsBatchResponse(created=[_out(c) for c in rows])

    rows = await ClaimRepo(s).batch_create(u.id, body.project_id, items)
    await s.commit()

    if body.idempotency_key:
        r = await get_redis()
        idem = RedisIdem(r)
        payload_hash = RedisIdem._hash({"project_id": str(body.project_id), "claims": items})
        await idem.get_or_set(
            user_id=u.id,
            key=body.idempotency_key,
            payload_hash=payload_hash,
            value=",".join(str(c.id) for c in rows),
        )

    return ClaimsBatchResponse(created=[_out(c) for c in rows])


@router.get("", response_model=list[ClaimOut])
async def list_claims(
    project_id: UUID,
    status: str | None = Query(default=None),
    limit: int = Query(default=50, le=200),
    u: User = Depends(current_user),
    s: AsyncSession = Depends(db),
):
    rows = await ClaimRepo(s).list(u.id, project_id=project_id, status=status, limit=limit)
    return [_out(c) for c in rows]


@router.patch("/{claim_id}", response_model=ClaimOut)
async def patch_claim(
    claim_id: UUID,
    body: ClaimPatch,
    u: User = Depends(current_user),
    s: AsyncSession = Depends(db),
):
    c = await ClaimRepo(s).patch(
        u.id,
        claim_id,
        status=body.status,
        quote=body.quote,
        confidence=body.confidence,
        reason=body.reason,
        page=body.page,
    )
    await s.commit()

    if body.status in ("verified", "partial"):
        from app.db import sessionmaker as get_sessionmaker  # deferred import to avoid circular dependency
        sm = get_sessionmaker()
        async def _bg():
            try:
                async with sm() as bg_s:
                    await _detect_conflicts(bg_s, u.id, claim_id, c.project_id)
            except Exception as exc:
                logger.warning("conflict detection failed for claim %s: %s", claim_id, exc)
        asyncio.create_task(_bg())

    return _out(c)
