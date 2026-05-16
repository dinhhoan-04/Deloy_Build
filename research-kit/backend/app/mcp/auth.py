import hmac
import os
from fastapi import Request, HTTPException


_TOKEN = os.environ.get("RK_MCP_TOKEN", "")


async def verify_bearer(request: Request) -> None:
    """Raise 401 if Authorization header does not match RK_MCP_TOKEN."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = auth[len("Bearer "):]
    if not hmac.compare_digest(token, _TOKEN):
        raise HTTPException(status_code=401, detail="invalid token")
