import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_collect_endpoint_accepts_request(client):
    payload = {
        "user_id": "test-user",
        "run_verify": False,
        "output_format": "markdown",
        "tools": [
            {
                "tool_name": "elicit",
                "captured_at": "2026-04-30T10:00:00Z",
                "raw_text": "Raw text from Elicit",
                "claims": [
                    {
                        "text": "Sleep helps memory consolidation",
                        "citations": [{"ref_id": "1", "url": "https://doi.org/10.1234/example"}],
                    }
                ],
            }
        ],
    }
    response = client.post("/api/v1/collect", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["topic"]
    assert data["summary"]
    assert data["markdown"]
    assert data["output_format_used"] == "markdown"


def test_collect_endpoint_docx_format(client):
    payload = {
        "user_id": "test-user",
        "run_verify": False,
        "output_format": "docx",
        "tools": [
            {
                "tool_name": "chatgpt",
                "captured_at": "2026-04-30T10:00:00Z",
                "raw_text": "Raw text from ChatGPT",
                "claims": [
                    {
                        "text": "AI systems can learn patterns",
                        "citations": [{"ref_id": "1", "url": "https://example.com/paper"}],
                    }
                ],
            }
        ],
    }
    response = client.post("/api/v1/collect", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["docx_base64"] is not None
    assert data["output_format_used"] == "docx"
