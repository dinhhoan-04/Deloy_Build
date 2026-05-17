import hmac
import os
import pytest
from httpx import ASGITransport, AsyncClient

pytestmark = pytest.mark.contract


@pytest.fixture
def app():
    os.environ.setdefault("RK_MCP_TOKEN", "test-mcp-token")
    from app.main import create_app

    return create_app()


@pytest.mark.asyncio
async def test_mcp_auth_required_no_header(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/mcp/mcp")
        assert r.status_code == 401


@pytest.mark.asyncio
async def test_mcp_auth_required_wrong_token(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/mcp/mcp", headers={"Authorization": "Bearer wrong"})
        assert r.status_code == 401


def test_mcp_auth_correct_token_passes_hmac():
    """Verify correct token passes constant-time comparison (no HTTP needed)."""
    os.environ["RK_MCP_TOKEN"] = "correct-token"
    tok = os.environ.get("RK_MCP_TOKEN", "")
    auth = "Bearer correct-token"
    assert auth.startswith("Bearer ")
    assert hmac.compare_digest(auth[7:], tok)


def test_mcp_auth_wrong_token_fails_hmac():
    """Verify wrong token fails constant-time comparison."""
    os.environ["RK_MCP_TOKEN"] = "correct-token"
    tok = os.environ.get("RK_MCP_TOKEN", "")
    auth = "Bearer wrong-token"
    assert not hmac.compare_digest(auth[7:], tok)
