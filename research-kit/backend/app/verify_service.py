import os
import json
from dataclasses import dataclass
from enum import Enum
from typing import Optional
import httpx
import anthropic

from app.openalex import lookup_paper, PaperInfo

_claude = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))

class VerifyStatus(str, Enum):
    VERIFIED = "verified"
    PARTIAL = "partial"
    NOT_FOUND = "not_found"

@dataclass
class VerifyResult:
    status: VerifyStatus
    verbatim_quote: Optional[str]
    confidence: float
    reason: str
    paper_title: Optional[str] = None
    doi: Optional[str] = None

async def verify_claim(
    claim: str,
    doi: Optional[str] = None,
    paper_url: Optional[str] = None,
    paper_title: Optional[str] = None,
) -> VerifyResult:
    paper = await lookup_paper(doi=doi, title=paper_title)
    if paper is None:
        return VerifyResult(
            status=VerifyStatus.NOT_FOUND,
            verbatim_quote=None,
            confidence=0.0,
            reason="Paper not found in OpenAlex"
        )

    fulltext = None
    if paper.fulltext_url:
        fulltext = await _fetch_text(paper.fulltext_url)

    if not fulltext:
        return VerifyResult(
            status=VerifyStatus.PARTIAL,
            verbatim_quote=None,
            confidence=0.0,
            reason="Full text unavailable (paywall or no open access)",
            paper_title=paper.title,
            doi=paper.doi,
        )

    result = await _call_claude(claim=claim, fulltext=fulltext)
    return VerifyResult(
        status=VerifyStatus(result["status"]),
        verbatim_quote=result.get("verbatim_quote"),
        confidence=result.get("confidence", 0.0),
        reason=result.get("reason", ""),
        paper_title=paper.title,
        doi=paper.doi,
    )

async def _fetch_text(url: str) -> Optional[str]:
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "ResearchKit/1.0 (mailto:research@researchkit.app)"})
            if resp.status_code != 200:
                return None
            text = resp.text
            if "<html" in text.lower():
                import re
                text = re.sub(r"<[^>]+>", " ", text)
                text = re.sub(r"\s+", " ", text)
            return text[:50000]  # Cap at 50k chars
    except Exception:
        return None

async def _call_claude(claim: str, fulltext: str) -> dict:
    prompt = f"""You are a scientific claim verifier. Given a claim and a paper's full text, determine if the claim is supported.

CLAIM: {claim}

PAPER TEXT (may be truncated):
{fulltext}

Respond with JSON only:
{{
  "status": "verified" | "not_found",
  "verbatim_quote": "<exact quote from paper that supports/refutes, or null>",
  "confidence": <0.0-1.0>,
  "reason": "<one sentence explanation>"
}}"""

    response = await _claude.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=512,
        messages=[{"role": "user", "content": prompt}],
        system="You verify scientific claims against paper text. Always respond with valid JSON only.",
    )
    text = response.content[0].text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text.strip())
