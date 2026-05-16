from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import current_user, db
from rk_shared.models import (
    Claim,
    Conflict,
    InboxItem,
    PaperContentCache,
    Project,
    Run,
    RunEventRow,
    User,
    VerifyResultCache,
)
from rk_shared.types import RunStatus

router = APIRouter(prefix="/v1/demo", tags=["demo"])

DEMO_PROJECT_NAME = "Demo Project - Verify Inbox Conflict Draft"
DEMO_DRAFT_IDEM = "demo:draft:v1"


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _claim_hash(text: str) -> str:
    return hashlib.sha256(text.strip().lower().encode("utf-8")).hexdigest()


def _paper_key(doi: str | None, url: str | None) -> str:
    if doi:
        return f"doi:{doi.strip().lower()}"
    if url:
        return f"url:{url.strip().lower()}"
    return "paper:unknown"


@router.post("/bootstrap")
async def bootstrap_demo(u: User = Depends(current_user), s: AsyncSession = Depends(db)) -> dict:
    project = (
        await s.execute(
            select(Project).where(Project.user_id == u.id, Project.name == DEMO_PROJECT_NAME)
        )
    ).scalar_one_or_none()
    if not project:
        project = Project(user_id=u.id, name=DEMO_PROJECT_NAME)
        s.add(project)
        await s.flush()

    demo_claims = [
        {
            "text": "A Mediterranean diet reduces risk of major cardiovascular events in high-risk adults.",
            "paper_title": "Primary Prevention of Cardiovascular Disease with a Mediterranean Diet",
            "doi": "10.1056/NEJMoa1200303",
            "paper_url": "https://www.nejm.org/doi/full/10.1056/NEJMoa1200303",
            "site": "elicit",
            "status": "verified",
            "confidence": 0.93,
            "quote": "Participants assigned to Mediterranean diet groups had lower incidence of major cardiovascular events.",
            "reason": "The RCT reports a significant reduction vs control.",
        },
        {
            "text": "Vitamin C supplementation eliminates common cold incidence in the general population.",
            "paper_title": "Vitamin C for preventing and treating the common cold",
            "doi": "10.1002/14651858.CD000980.pub4",
            "paper_url": "https://doi.org/10.1002/14651858.CD000980.pub4",
            "site": "scispace",
            "status": "not_found",
            "confidence": 0.18,
            "quote": None,
            "reason": "Evidence does not support elimination of incidence in the general population.",
        },
        {
            "text": "Short sleep duration is associated with increased all-cause mortality in adults.",
            "paper_title": "Sleep duration and all-cause mortality: a systematic review and meta-analysis",
            "doi": "10.1016/S0140-6736(10)61456-9",
            "paper_url": "https://doi.org/10.1016/S0140-6736(10)61456-9",
            "site": "consensus",
            "status": "partial",
            "confidence": 0.71,
            "quote": "Both short and long sleep durations were associated with greater risk of death.",
            "reason": "Association is reported, but effect size varies by cohort and adjustment model.",
        },
    ]

    claim_rows: list[Claim] = []
    for item in demo_claims:
        row = (
            await s.execute(
                select(Claim).where(
                    Claim.user_id == u.id,
                    Claim.project_id == project.id,
                    Claim.text == item["text"],
                )
            )
        ).scalar_one_or_none()
        if not row:
            row = Claim(
                user_id=u.id,
                project_id=project.id,
                text=item["text"],
                paper_title=item["paper_title"],
                doi=item["doi"],
                paper_url=item["paper_url"],
                site=item["site"],
                status=item["status"],
                confidence=item["confidence"],
                quote=item["quote"],
                reason=item["reason"],
                page_url=None,
                extracted_at=_now(),
            )
            s.add(row)
            await s.flush()
        else:
            row.status = item["status"]
            row.confidence = item["confidence"]
            row.quote = item["quote"]
            row.reason = item["reason"]
        claim_rows.append(row)

        key = _paper_key(row.doi, row.paper_url)
        cached_text = (
            await s.execute(
                select(PaperContentCache).where(
                    PaperContentCache.user_id == u.id,
                    PaperContentCache.project_id == project.id,
                    PaperContentCache.paper_key == key,
                )
            )
        ).scalar_one_or_none()
        if not cached_text:
            s.add(
                PaperContentCache(
                    user_id=u.id,
                    project_id=project.id,
                    paper_key=key,
                    paper_title=row.paper_title,
                    doi=row.doi,
                    source_url=row.paper_url,
                    text=(
                        f"Demo cached content for {row.paper_title}. "
                        f"Used to avoid re-fetching during extension demos."
                    ),
                    chars=160,
                    fetch_source="demo_seed",
                    expires_at=_now() + timedelta(days=365),
                )
            )

        vcache = (
            await s.execute(
                select(VerifyResultCache).where(
                    VerifyResultCache.user_id == u.id,
                    VerifyResultCache.project_id == project.id,
                    VerifyResultCache.paper_key == key,
                    VerifyResultCache.claim_hash == _claim_hash(row.text),
                )
            )
        ).scalar_one_or_none()
        if not vcache:
            s.add(
                VerifyResultCache(
                    user_id=u.id,
                    project_id=project.id,
                    paper_key=key,
                    claim_hash=_claim_hash(row.text),
                    status=row.status,
                    verbatim_quote=row.quote,
                    confidence=float(row.confidence or 0.0),
                    reason=row.reason or "Seeded demo result.",
                    provider_used="demo_seed",
                    expires_at=_now() + timedelta(days=365),
                )
            )

    for c in claim_rows[:2]:
        exists = (
            await s.execute(
                select(InboxItem).where(
                    InboxItem.user_id == u.id,
                    InboxItem.project_id == project.id,
                    InboxItem.claim_id == c.id,
                )
            )
        ).scalar_one_or_none()
        if not exists:
            s.add(InboxItem(user_id=u.id, project_id=project.id, claim_id=c.id))

    conflict_key = "vitamin-c-incidence-vs-mortality"
    conflict = (
        await s.execute(
            select(Conflict).where(
                Conflict.user_id == u.id,
                Conflict.project_id == project.id,
                Conflict.group_key == conflict_key,
            )
        )
    ).scalar_one_or_none()
    if not conflict:
        s.add(
            Conflict(
                user_id=u.id,
                project_id=project.id,
                doi=None,
                group_key=conflict_key,
                paper_title="Vitamin C evidence interpretation",
                resolution=None,
                sides=[
                    {
                        "claim_id": str(claim_rows[0].id),
                        "label": "Supports reduction",
                        "quote": claim_rows[0].quote,
                    },
                    {
                        "claim_id": str(claim_rows[1].id),
                        "label": "Does not support elimination",
                        "quote": claim_rows[1].reason,
                    },
                ],
            )
        )

    draft_run = (
        await s.execute(
            select(Run).where(
                Run.user_id == u.id,
                Run.project_id == project.id,
                Run.idempotency_key == DEMO_DRAFT_IDEM,
            )
        )
    ).scalar_one_or_none()
    if not draft_run:
        draft_markdown = (
            "# Demo Draft\n\n"
            "## Key Takeaways\n"
            "- Mediterranean diet: strong supportive evidence for reduced major CV events.\n"
            "- Vitamin C and common cold: no support for eliminating incidence.\n"
            "- Short sleep duration: associated with increased mortality risk.\n\n"
            "## Suggested Narrative\n"
            "Current evidence supports lifestyle-focused cardiovascular prevention, "
            "while broad claims about vitamin C eliminating common cold incidence are not supported."
        )
        draft_run = Run(
            user_id=u.id,
            project_id=project.id,
            kind="draft",
            status=RunStatus.SUCCEEDED.value,
            input={
                "claims": [{"id": str(c.id), "text": c.text, "verdict": c.status} for c in claim_rows[:2]],
                "style": "short",
            },
            result={"markdown": draft_markdown},
            idempotency_key=DEMO_DRAFT_IDEM,
            started_at=_now(),
            finished_at=_now(),
        )
        s.add(draft_run)
        await s.flush()
        s.add(
            RunEventRow(
                run_id=draft_run.id,
                seq=1,
                type="status",
                payload={"status": "running"},
            )
        )
        s.add(
            RunEventRow(
                run_id=draft_run.id,
                seq=2,
                type="final",
                payload={"content": json.dumps({"markdown": draft_markdown}), "usage": {"mode": "demo_seed"}},
            )
        )
        s.add(
            RunEventRow(
                run_id=draft_run.id,
                seq=3,
                type="status",
                payload={"status": "succeeded"},
            )
        )

    await s.commit()
    return {"project_id": str(project.id), "draft_run_id": str(draft_run.id)}
