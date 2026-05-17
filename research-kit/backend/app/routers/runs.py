import asyncio
from uuid import UUID
import json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Header, Query, Response
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.deps import current_user, db
from app.config import get_settings
from app.db import sessionmaker as get_sessionmaker
from app.events.replay import replay_then_tail
from app.llm.providers import (
    GeminiProvider,
    ZaiProvider,
    OpenAIProvider,
    ProviderError,
    RateLimitError,
)
from app.redis_pool import get_redis
from app.repos.runs import RunRepo
from app.schemas.runs import RunCreate, RunCreateResponse, RunOut
from rk_shared.models import Run, RunEventRow, User
from rk_shared.types import RunKind

router = APIRouter(prefix="/v1/runs", tags=["runs"])
_inline_tasks: set[asyncio.Task] = set()


def _out(r) -> RunOut:
    return RunOut(
        id=r.id,
        kind=r.kind,
        status=r.status,
        project_id=r.project_id,
        input=r.input,
        result=r.result,
        error=r.error,
        created_at=r.created_at,
        started_at=r.started_at,
        finished_at=r.finished_at,
    )


def _spawn_inline_execute(run_id: UUID) -> None:
    async def _job() -> None:
        sm = get_sessionmaker()
        rds = await get_redis()
        async with sm() as s:
            run = (await s.execute(select(Run).where(Run.id == run_id))).scalar_one_or_none()
            if not run:
                return
            run.status = "running"
            run.started_at = datetime.now(timezone.utc).replace(tzinfo=None)
            await s.commit()

        await _publish_event(sm, rds, run_id, {"type": "status", "payload": {"status": "running"}})
        try:
            result_payload, final_text = await _execute_inline_run(sm, run_id)
            async with sm() as s:
                run = (await s.execute(select(Run).where(Run.id == run_id))).scalar_one()
                run.status = "succeeded"
                run.result = result_payload
                run.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
                await s.commit()
            await _publish_event(
                sm, rds, run_id, {"type": "final", "payload": {"content": final_text, "usage": {}}}
            )
            await _publish_event(
                sm, rds, run_id, {"type": "status", "payload": {"status": "succeeded"}}
            )
        except Exception as e:
            err = {"code": "internal", "message": str(e)[:500], "recoverable": False}
            async with sm() as s:
                run = (await s.execute(select(Run).where(Run.id == run_id))).scalar_one()
                run.status = "failed"
                run.error = err
                run.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
                await s.commit()
            await _publish_event(sm, rds, run_id, {"type": "error", "payload": err})
            await _publish_event(
                sm, rds, run_id, {"type": "status", "payload": {"status": "failed"}}
            )

    task = asyncio.create_task(_job())
    _inline_tasks.add(task)
    task.add_done_callback(_inline_tasks.discard)


async def _publish_event(sm, redis, run_id: UUID, event: dict) -> int:
    async with sm() as s:
        async with s.begin():
            await s.execute(
                text("SELECT pg_advisory_xact_lock(hashtext(:rid))"),
                {"rid": str(run_id)},
            )
            cur_max = (
                await s.execute(
                    select(func.coalesce(func.max(RunEventRow.seq), 0)).where(
                        RunEventRow.run_id == run_id
                    )
                )
            ).scalar_one()
            seq = int(cur_max) + 1
            s.add(RunEventRow(run_id=run_id, seq=seq, type=event["type"], payload=event["payload"]))
    await redis.publish(
        f"run:{run_id}",
        json.dumps(
            {
                "seq": seq,
                "type": event["type"],
                "payload": event["payload"],
                "ts": datetime.now(tz=timezone.utc).isoformat(),
            }
        ),
    )
    return seq


def _provider_chain(provider: str | None, model: str | None):
    s = get_settings()
    selected = provider or s.llm_primary_provider
    if selected == "gemini":
        if not s.gemini_api_key:
            raise ValueError("gemini not configured")
        return GeminiProvider(api_key=s.gemini_api_key, model=model or s.llm_gemini_model)
    if selected == "zai":
        if not s.zai_api_key:
            raise ValueError("zai not configured")
        return ZaiProvider(api_key=s.zai_api_key, model=model or s.llm_zai_model)
    if not s.openai_api_key:
        raise ValueError("openai not configured")
    return OpenAIProvider(api_key=s.openai_api_key, model=model or s.llm_openai_model)


_DRAFT_SYSTEM_PROMPT = """You are RK-Draft, an academic writing assistant that produces journal-quality drafts.

You receive verified research claims with optional metadata (verbatim quote, paper
title, authors, year, DOI). Synthesize them into a structured academic draft in
markdown following the specified template and citation style.

TEMPLATE STRUCTURES:

literature_review:
  ## Abstract (2-3 sentences summarizing the scope)
  ## Introduction (context and purpose)
  ## [Thematic Section Title] (one section per major topic cluster in claims)
  ## Discussion (cross-claim synthesis and implications)
  ## Conclusion (1 paragraph)
  ## References

research_summary:
  ## Abstract (2-3 sentences)
  ## Key Findings (one subsection per major finding cluster)
  ## Implications (practical and theoretical)
  ## Conclusion (1 paragraph)
  ## References

CITATION STYLE:

apa:
  - Inline: (Smith & Doe, 2023) or (Smith et al., 2023) for 3+ authors
  - If only title available: (Short Title, year) or (Short Title) if year unknown
  - References section: Smith, J., & Doe, A. (2023). Title. https://doi.org/...

vancouver or ieee:
  - Inline: [1], [2] in order of first appearance
  - References section: numbered list — 1. Smith J, Doe A. Title. DOI.

RULES:
1. FIDELITY: Only assert what the claims explicitly state. Do not add background
   knowledge, statistics, or conclusions not present in the input.
2. OUTLINE: If outline_hint is provided, use it to guide section and theme grouping.
3. LENGTH: Abstract 2-3 sentences. Each section body 3-5 sentences. Concise over verbose.
4. REFERENCES: Always emit a ## References section at the end using all cited papers.
5. OUTPUT: Return valid JSON. markdown = full draft. sections = heading structure."""


def _draft_schema() -> dict:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "markdown": {"type": "string", "minLength": 1},
            "sections": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "title": {"type": "string"},
                        "claim_refs": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["title", "claim_refs"],
                },
            },
        },
        "required": ["markdown", "sections"],
    }


async def _execute_inline_run(sm, run_id: UUID) -> tuple[dict, str]:
    async with sm() as s:
        run = (await s.execute(select(Run).where(Run.id == run_id))).scalar_one()
        kind = RunKind(run.kind)
        run_input = run.input
        run_user_id = run.user_id
        provider_name = (run_input.get("meta") or {}).get("provider")
        model_name = (run_input.get("meta") or {}).get("model")
    provider = _provider_chain(provider_name, model_name)

    if kind == RunKind.DRAFT:
        user = json.dumps(
            {
                "claims": run_input.get("claims", []),
                "template": run_input.get("template", "research_summary"),
                "citation_style": run_input.get("citation_style", "apa"),
                "outline_hint": run_input.get("outline_hint", ""),
                "meta": run_input.get("meta", {}),
            }
        )
        try:
            out = await provider.extract(_DRAFT_SYSTEM_PROMPT, user, _draft_schema())
        except (ProviderError, RateLimitError) as e:
            raise RuntimeError(str(e)) from e
        return out, json.dumps(out)

    if kind == RunKind.CHAT:
        context = run_input.get("context")
        system = "You are RK-Chat, a research assistant."
        if context:
            system += f"\n\nUse the following extracted content to answer the user's question:\n\n{context}"
        system += '\n\nReturn ONLY JSON: {"text":"..."}.'
        user = json.dumps(
            {"messages": run_input.get("messages", []), "meta": run_input.get("meta", {})}
        )
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {"text": {"type": "string", "minLength": 1}},
            "required": ["text"],
        }
        try:
            out = await provider.extract(system, user, schema)
        except (ProviderError, RateLimitError) as e:
            raise RuntimeError(str(e)) from e
        return out, json.dumps(out)

    if kind == RunKind.CONFLICT:
        _CONFLICT_SYSTEM = """\
You are RK-Conflict, an academic research assistant that analyzes contradictions \
between two claims from the same paper.

You receive two conflicting claims with their verbatim quotes. Analyze each side \
and recommend which claim better represents the paper's findings.

RULES:
1. EVIDENCE: Base your analysis only on the verbatim quotes provided.
2. SIDES: For each side, assess how strongly the quote supports the claim (0.0-1.0).
3. SYNTHESIS: If both sides are partially valid, suggest a reconciliation sentence.
4. RECOMMENDATION: Pick "side_a", "side_b", or "neither" with a rationale.
5. OUTPUT: Return valid JSON matching the schema."""

        user = json.dumps(
            {
                "group_key": run_input.get("group_key"),
                "sides": run_input.get("sides", []),
            }
        )
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "recommendation": {"type": "string", "enum": ["side_a", "side_b", "neither"]},
                "rationale": {"type": "string"},
                "synthesis": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                "sides_analysis": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "side_id": {"type": "string"},
                            "weight": {"type": "number"},
                            "note": {"type": "string"},
                        },
                        "required": ["side_id", "weight", "note"],
                    },
                },
            },
            "required": ["recommendation", "rationale", "synthesis", "sides_analysis"],
        }
        try:
            out = await provider.extract(_CONFLICT_SYSTEM, user, schema)
        except (ProviderError, RateLimitError) as e:
            raise RuntimeError(str(e)) from e

        # Auto-save suggestion back to conflict.resolution
        conflict_id = run_input.get("conflict_id")
        if conflict_id:
            from app.repos.conflicts import ConflictRepo

            resolution = json.dumps({"kind": "suggestion", **out})
            async with sm() as bg_s:
                repo = ConflictRepo(bg_s)
                try:
                    await repo.patch(run_user_id, UUID(conflict_id), resolution=resolution)
                    await bg_s.commit()
                except Exception:
                    pass  # best-effort: don't fail the run if save fails

        return out, json.dumps(out)

    raise RuntimeError(f"inline mode does not support kind={kind.value} without worker")


@router.post("", response_model=RunCreateResponse, status_code=201)
async def create_run(
    body: RunCreate, u: User = Depends(current_user), s: AsyncSession = Depends(db)
):
    run_input = dict(body.input)
    run_input["meta"] = {
        **(run_input.get("meta") or {}),
        "provider": body.provider,
        "model": body.model,
    }
    repo = RunRepo(s)
    run, created = await repo.create_or_get(
        user_id=u.id,
        kind=RunKind(body.kind),
        project_id=body.project_id,
        input=run_input,
        idempotency_key=body.idempotency_key,
    )
    await s.commit()
    if created:
        _spawn_inline_execute(run.id)
    return RunCreateResponse(
        run_id=run.id,
        status=run.status,
        stream_url=f"/v1/runs/{run.id}/stream",
    )


@router.get("/{run_id}", response_model=RunOut)
async def get_run(run_id: UUID, u: User = Depends(current_user), s: AsyncSession = Depends(db)):
    return _out(await RunRepo(s).get(u.id, run_id))


@router.post("/{run_id}/cancel", status_code=202)
async def cancel_run(
    run_id: UUID, u: User = Depends(current_user), s: AsyncSession = Depends(db)
) -> Response:
    await RunRepo(s).mark_cancelling(u.id, run_id)
    await s.commit()
    rds = await get_redis()
    await rds.set(f"cancel:{run_id}", "1", ex=300)
    return Response(status_code=202)


@router.get("/{run_id}/stream")
async def stream_run(
    run_id: UUID,
    last_seq: int = Query(default=0, ge=0),
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
    u: User = Depends(current_user),
    s: AsyncSession = Depends(db),
) -> EventSourceResponse:
    run = await RunRepo(s).get(u.id, run_id)
    effective = max(last_seq, int(last_event_id) if last_event_id else 0)

    rds = await get_redis()
    sm = get_sessionmaker()

    async def gen():
        async for ev in replay_then_tail(
            run_id=run_id,
            last_seq=effective,
            sessionmaker=sm,
            redis=rds,
            initial_status=run.status,
        ):
            yield {
                "event": "run_event",
                "id": str(ev["seq"]),
                "data": json.dumps(ev, default=str),
            }

    return EventSourceResponse(gen())
