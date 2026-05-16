"""FastMCP server exposing RK inbox tools over streamable HTTP."""
from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from app.mcp.tools import search_inbox, get_inbox_items, fetch_paper


def create_mcp_server() -> FastMCP:
    mcp = FastMCP(name="rk-inbox", stateless_http=True)
    mcp.tool()(search_inbox)
    mcp.tool()(get_inbox_items)
    mcp.tool()(fetch_paper)
    return mcp
