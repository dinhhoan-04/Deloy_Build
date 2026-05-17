"""Test that optional provider field is accepted by /verify and /extract endpoints."""

import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from app.main_openai import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def mock_verify_and_extract():
    """Prevent real LLM/network calls in tests."""
    from app.verify_service import VerifyResult, VerifyStatus

    mock_result = VerifyResult(
        status=VerifyStatus.NOT_FOUND,
        verbatim_quote=None,
        confidence=0.0,
        reason="mocked",
    )
    with (
        patch("app.main_openai.verify_claim", new=AsyncMock(return_value=mock_result)),
        patch("app.main_openai.extract_claims", new=AsyncMock(return_value=[])),
    ):
        yield


def test_verify_accepts_provider_field():
    payload = {"claim": "Sleep improves memory.", "doi": "10.1/x", "provider": "openai"}
    response = client.post("/verify", json=payload)
    assert response.status_code != 422


def test_verify_works_without_provider():
    payload = {"claim": "test", "doi": "10.1/x"}
    response = client.post("/verify", json=payload)
    assert response.status_code != 422


def test_verify_accepts_all_provider_values():
    for provider in ("anthropic", "openai", "gemini"):
        response = client.post("/verify", json={"claim": "test", "provider": provider})
        assert response.status_code != 422, f"Failed for provider={provider}"


def test_verify_rejects_unknown_provider():
    response = client.post("/verify", json={"claim": "test", "provider": "unknown_llm"})
    assert response.status_code == 422


def test_extract_accepts_provider_field():
    payload = {"page_text": "some text", "site": "elicit", "provider": "gemini"}
    response = client.post("/extract", json=payload)
    assert response.status_code != 422


def test_extract_works_without_provider():
    payload = {"page_text": "some text", "site": "elicit"}
    response = client.post("/extract", json=payload)
    assert response.status_code != 422
