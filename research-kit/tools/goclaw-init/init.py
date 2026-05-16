"""One-shot container that seeds GoClaw agent context files via WebSocket."""
import asyncio
import json
import os
import pathlib
import sys

import websockets


AGENTS_DIR = pathlib.Path("/agents")
WS_URL = os.environ["GOCLAW_WS_URL"]
TOKEN = os.environ["GOCLAW_GATEWAY_TOKEN"]

# Provider/model passed to every agents.create call. GoClaw's `agents.create`
# does NOT read config.json's `agents.defaults` block at RPC time — those
# defaults are only used by the dashboard UI. Without explicit values here,
# agents fall back to a hard-coded anthropic default.
DEFAULT_PROVIDER = "openai"
DEFAULT_MODEL = "gpt-4o-mini"

# Per-agent overrides (rare — only when an agent must differ from the default).
AGENT_OVERRIDES: dict[str, dict] = {}

# TOOLS.md is intentionally excluded — GoClaw's agents.files.set RPC does not
# accept it (allowed list: AGENTS.md, SOUL.md, IDENTITY.md, USER.md,
# USER_PREDEFINED.md, CAPABILITIES.md, BOOTSTRAP.md, MEMORY.json, HEARTBEAT.md).
FILE_NAMES = [
    "AGENTS.md",
    "SOUL.md",
    "CAPABILITIES.md",
    "IDENTITY.md",
    "USER_PREDEFINED.md",
]

_req_id = 0


def next_id() -> str:
    global _req_id
    _req_id += 1
    return str(_req_id)


async def send_recv(ws, method: str, params: dict) -> dict:
    req_id = next_id()
    msg = json.dumps({"type": "req", "id": req_id, "method": method, "params": params})
    await ws.send(msg)
    raw = await ws.recv()
    resp = json.loads(raw)
    if not resp.get("ok", False):
        raise RuntimeError(f"GoClaw error on {method}: {resp.get('error')} (raw={raw[:300]})")
    return resp


async def main() -> None:
    ws_url = WS_URL.rstrip("/") + "/ws"
    print(f"[goclaw-init] connecting to {ws_url}", flush=True)

    async with websockets.connect(ws_url) as ws:
        # Authenticate (must be first request after WS upgrade)
        await send_recv(ws, "connect", {
            "token": TOKEN,
            "user_id": "system",
        })
        print("[goclaw-init] connected", flush=True)

        agent_dirs = sorted(d for d in AGENTS_DIR.iterdir() if d.is_dir())
        if not agent_dirs:
            print("[goclaw-init] WARNING: no agent directories found in /agents", flush=True)

        # Discover existing agents. Per-agent provider/model overrides live in
        # config.json (agents.list.<key>) and are applied automatically when an
        # agent is created by that key — we only pass `name` here.
        list_resp = await send_recv(ws, "agents.list", {})
        list_payload = list_resp.get("payload", {})
        existing_items = (
            list_payload.get("agents")
            or list_payload.get("items")
            or (list_payload if isinstance(list_payload, list) else [])
        )
        existing_keys = {
            (a.get("agent_key") or a.get("agentKey") or a.get("key") or a.get("name") or "")
            for a in existing_items if isinstance(a, dict)
        }
        print(f"[goclaw-init] existing agents: {sorted(k for k in existing_keys if k)}", flush=True)

        for agent_dir in agent_dirs:
            agent_id = agent_dir.name
            if agent_id not in existing_keys:
                create_params = {
                    "name": agent_id,
                    "provider": DEFAULT_PROVIDER,
                    "model": DEFAULT_MODEL,
                    **AGENT_OVERRIDES.get(agent_id, {}),
                }
                await send_recv(ws, "agents.create", create_params)
                existing_keys.add(agent_id)
                print(f"[goclaw-init] created agent {agent_id} ({create_params})", flush=True)
            for file_name in FILE_NAMES:
                file_path = agent_dir / file_name
                if not file_path.exists():
                    print(f"[goclaw-init] WARNING: missing {file_path}", flush=True)
                    continue
                content = file_path.read_text(encoding="utf-8")
                await send_recv(ws, "agents.files.set", {
                    "agentId": agent_id,
                    "name": file_name,
                    "content": content,
                    "propagate": True,
                })
                print(f"[goclaw-init] seeded {agent_id}/{file_name}", flush=True)

    print("[goclaw-init] done", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
