import os
import json
import pytest

pytestmark = pytest.mark.contract

requires_goclaw = pytest.mark.skipif(
    not os.environ.get("GOCLAW_WS_URL"),
    reason="GOCLAW_WS_URL not set; smoke test skipped",
)


@requires_goclaw
@pytest.mark.asyncio
async def test_goclaw_streams_chat_completion():
    """HALT POINT for L7: connect via WS, send a chat message, expect chunk events."""
    import websockets

    ws_url = os.environ["GOCLAW_WS_URL"].rstrip("/") + "/ws"
    token = os.environ["GOCLAW_GATEWAY_TOKEN"]

    chunks = []
    got_completed = False

    async with websockets.connect(ws_url) as ws:
        # Auth — GoClaw RPC: req/res with method+params
        await ws.send(
            json.dumps(
                {
                    "type": "req",
                    "id": "1",
                    "method": "connect",
                    "params": {"token": token, "user_id": "smoke-test"},
                }
            )
        )
        resp = json.loads(await ws.recv())
        assert resp.get("ok") is True, f"Auth failed: {resp}"

        # Send message
        await ws.send(
            json.dumps(
                {
                    "type": "req",
                    "id": "2",
                    "method": "chat.send",
                    "params": {
                        "message": "Reply with the single word OK.",
                        "sessionKey": "rk:smoke:test",
                        "agentId": "rk-verify",
                    },
                }
            )
        )

        # Collect events
        async for raw in ws:
            frame = json.loads(raw)
            if frame.get("type") != "event" or frame.get("event") != "agent":
                continue
            env = frame.get("payload", {})
            sub = env.get("type", "")
            inner = env.get("payload", {}) or {}

            if sub == "chunk":
                chunks.append(inner.get("content", ""))
            elif sub == "run.completed":
                got_completed = True
                break
            elif sub == "run.failed":
                pytest.fail(f"run.failed: {env}")

    full = "".join(chunks).strip().lower()
    assert got_completed, "No run.completed event received"
    assert "ok" in full or len(full) > 0, f"Expected content, got: {full!r}"
