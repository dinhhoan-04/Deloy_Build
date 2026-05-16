import pytest


@pytest.mark.asyncio
async def test_error_envelope(client):
    r = await client.get("/v1/__nope__")
    assert r.status_code == 404
    assert r.json() == {"error": {"code": "not_found", "message": "Not Found"}}
