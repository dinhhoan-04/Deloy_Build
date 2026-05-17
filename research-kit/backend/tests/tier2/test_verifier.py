import pytest
from unittest.mock import AsyncMock, patch
from app.schemas import ExtractedFacts
from app.services.tier2.verifier import (
    verify_sentence,
    _verbatim_score,
    _fact_match_score,
    _chunk_text,
)

PAPER_TEXT = (
    "BERT achieves an F1 score of 93.2 on the SQuAD v1.1 dev set using fine-tuning. "
    "The model was trained on a large corpus and demonstrates strong transfer learning. "
    "Results show significant improvements over prior baselines on multiple benchmarks."
)

CLAIM_EXACT = "BERT achieves an F1 score of 93.2 on the SQuAD v1.1 dev set."
CLAIM_FABRICATED = "BERT achieved 99.9% accuracy on ImageNet using zero-shot learning."


# ── Unit tests for deterministic helpers ────────────────────────────────────

def test_verbatim_score_exact_match():
    chunks = _chunk_text(PAPER_TEXT, window=100, stride=50)
    score = _verbatim_score(CLAIM_EXACT.lower(), chunks)
    assert score > 80, f"Expected >80 for near-exact match, got {score}"


def test_verbatim_score_fabricated_low():
    chunks = _chunk_text(PAPER_TEXT, window=100, stride=50)
    score = _verbatim_score(CLAIM_FABRICATED.lower(), chunks)
    assert score < 30, f"Expected <30 for fabricated claim, got {score}"


def test_fact_match_score_all_found():
    facts = ExtractedFacts(numbers=["93.2"], named_entities=["BERT", "SQuAD v1.1"], key_terms=["F1 score"])
    score = _fact_match_score(facts, PAPER_TEXT)
    assert score == 100.0


def test_fact_match_score_none_found():
    facts = ExtractedFacts(numbers=["99.9%"], named_entities=["ImageNet"], key_terms=["zero-shot"])
    score = _fact_match_score(facts, PAPER_TEXT)
    assert score == 0.0


def test_fact_match_score_empty_facts():
    facts = ExtractedFacts()
    score = _fact_match_score(facts, PAPER_TEXT)
    assert score == 0.0


def test_chunk_text_returns_non_empty_chunks():
    chunks = _chunk_text(PAPER_TEXT, window=10, stride=5)
    assert len(chunks) >= 1
    for chunk in chunks:
        assert len(chunk.strip()) > 0


# ── Integration tests with mocked Z.ai and semantic scoring ─────────────────

@pytest.mark.asyncio
async def test_verify_sentence_supported():
    facts = ExtractedFacts(numbers=["93.2"], named_entities=["BERT", "SQuAD v1.1"], key_terms=["F1 score"])
    llm_resp = {"score": 90, "label": "likely_supported", "reason": "Facts match."}

    with patch("app.services.tier2.verifier.extract_facts", new_callable=AsyncMock, return_value=facts), \
         patch("app.services.tier2.verifier._semantic_score", return_value=78.0), \
         patch("app.agents.zai_client.complete_json", new_callable=AsyncMock, return_value=llm_resp):
        result = await verify_sentence(
            claim=CLAIM_EXACT,
            paper_text=PAPER_TEXT,
            citation_ref="1",
            link_score=100,
        )

    assert result.status == "verified"
    assert result.score is not None
    assert result.score > 60
    assert result.components is not None
    assert result.llm_assessment is not None
    assert result.llm_assessment.label == "likely_supported"


@pytest.mark.asyncio
async def test_verify_sentence_extraction_failure():
    with patch("app.services.tier2.verifier.extract_facts", new_callable=AsyncMock, return_value=None):
        result = await verify_sentence(
            claim=CLAIM_EXACT,
            paper_text=PAPER_TEXT,
            citation_ref="1",
            link_score=100,
        )

    assert result.status == "na_extraction_failed"
    assert result.score is None


@pytest.mark.asyncio
async def test_verify_sentence_llm_failure_still_returns_score():
    facts = ExtractedFacts(numbers=["93.2"], named_entities=["BERT"], key_terms=["F1"])

    with patch("app.services.tier2.verifier.extract_facts", new_callable=AsyncMock, return_value=facts), \
         patch("app.services.tier2.verifier._semantic_score", return_value=78.0), \
         patch("app.agents.zai_client.complete_json", new_callable=AsyncMock, side_effect=Exception("zai down")):
        result = await verify_sentence(
            claim=CLAIM_EXACT,
            paper_text=PAPER_TEXT,
            citation_ref="1",
            link_score=100,
        )

    assert result.status == "verified"
    assert result.score is not None
    assert result.llm_assessment is None   # graceful degradation
