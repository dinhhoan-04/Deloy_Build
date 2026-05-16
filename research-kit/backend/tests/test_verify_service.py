import pytest
import json
from unittest.mock import AsyncMock, MagicMock, patch
from app.verify_service import verify_claim, VerifyResult, VerifyStatus
from app.openalex import PaperInfo

FAKE_PAPER = PaperInfo(
    doi="10.1234/test",
    title="Effects of sleep on memory",
    fulltext_url="https://open.example.com/paper.html",
    authors=["Walker M"],
    year=2017,
)

FAKE_FULLTEXT = """
Abstract: Sleep plays a critical role in memory consolidation.
Results: Participants who slept showed a 40% improvement in recall tasks
compared to those who remained awake (p<0.001).
"""

@pytest.mark.asyncio
async def test_verify_found_returns_verified_with_quote():
    with patch("app.verify_service.lookup_paper", new_callable=AsyncMock, return_value=FAKE_PAPER), \
         patch("app.verify_service._fetch_text", new_callable=AsyncMock, return_value=FAKE_FULLTEXT), \
         patch("app.verify_service._call_claude", new_callable=AsyncMock) as mock_claude:
        mock_claude.return_value = {
            "status": "verified",
            "verbatim_quote": "Participants who slept showed a 40% improvement in recall tasks",
            "confidence": 0.95,
            "reason": "Direct quote from results section"
        }
        result = await verify_claim(
            claim="Sleep improves memory recall by 40%",
            doi="10.1234/test",
            paper_title="Effects of sleep on memory"
        )
    assert result.status == VerifyStatus.VERIFIED
    assert "40%" in result.verbatim_quote
    assert result.confidence >= 0.9

@pytest.mark.asyncio
async def test_verify_paper_not_found_returns_not_found():
    with patch("app.verify_service.lookup_paper", new_callable=AsyncMock, return_value=None):
        result = await verify_claim(claim="Some claim", doi="10.9999/none", paper_title="Unknown")
    assert result.status == VerifyStatus.NOT_FOUND
    assert result.verbatim_quote is None

@pytest.mark.asyncio
async def test_verify_no_fulltext_returns_partial():
    paper_no_fulltext = PaperInfo(
        doi="10.1234/test", title="Effects of sleep",
        fulltext_url=None, authors=["Walker M"], year=2017
    )
    with patch("app.verify_service.lookup_paper", new_callable=AsyncMock, return_value=paper_no_fulltext):
        result = await verify_claim(claim="Sleep improves memory", doi="10.1234/test", paper_title="Effects of sleep")
    assert result.status == VerifyStatus.PARTIAL
    assert "abstract" in result.reason.lower() or "paywall" in result.reason.lower()
