import pytest

pytestmark = pytest.mark.contract

EXPECTED_TOOLS = {"search_inbox", "get_inbox_items", "fetch_paper"}


def test_mcp_tools_list_exposes_three():
    """MCP server should register exactly 3 tools."""
    from app.mcp.server import create_mcp_server

    mcp = create_mcp_server()
    # FastMCP stores tools in _tool_manager
    tools = mcp._tool_manager.list_tools()
    tool_names = {t.name for t in tools}
    assert tool_names == EXPECTED_TOOLS
