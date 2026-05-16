import logging
import pytest


@pytest.mark.asyncio
async def test_request_id_in_log(client, caplog):
    caplog.set_level(logging.INFO)
    r = await client.get("/health", headers={"X-Request-Id": "test-rid-1"})
    assert r.status_code == 200
    assert r.headers.get("X-Request-Id") == "test-rid-1"
