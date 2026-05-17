from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from app.main import app
from app.schemas import (
    LinkResult, LinkComponents, SentenceResult, SentenceComponents,
    LLMAssessment
)

client = TestClient(app)

MOCK_LINK = LinkResult(
    ref_id="1",
    url="https://arxiv.org/abs/1810.04805",
    score=100,
    components=LinkComponents(http_ok=True, resolvable=True, trusted_domain=True),
    status="ok",
)

MOCK_SENTENCE = SentenceResult(
    text="BERT achieves an F1 score of 93.2 on SQuAD.",
    score=93.0,
    components=SentenceComponents(verbatim=95.0, fact_match=100.0, semantic=78.0),
    llm_assessment=LLMAssessment(score=88, label="likely_supported", reason="Facts match."),
    citation_ref="1",
    status="verified",
)


def test_verify_returns_200_with_valid_input():
    with patch("app.api.verify.validate_link", new_callable=AsyncMock, return_value=MOCK_LINK), \
         patch("app.api.verify.fetch_paper", new_callable=AsyncMock, return_value=("paper text here", "open_access")), \
         patch("app.api.verify.verify_sentence", new_callable=AsyncMock, return_value=MOCK_SENTENCE):

        response = client.post("/api/v1/verify", json={
            "text": "BERT achieves an F1 score of 93.2 on SQuAD [1].",
            "citations": [{"ref_id": "1", "url": "https://arxiv.org/abs/1810.04805"}]
        })

    assert response.status_code == 200
    data = response.json()
    assert "document_score" in data
    assert "paragraphs" in data
    assert "summary" in data
    assert data["summary"]["total_sentences"] >= 1


def test_verify_returns_400_on_empty_text():
    response = client.post("/api/v1/verify", json={
        "text": "",
        "citations": []
    })
    assert response.status_code == 422   # Pydantic min_length validation


def test_verify_no_citations_all_na():
    response_data = client.post("/api/v1/verify", json={
        "text": "Some claim with no citations.",
        "citations": []
    }).json()

    sentences = response_data["paragraphs"][0]["sentences"]
    assert all(s["status"] == "na_no_citation" for s in sentences)


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
