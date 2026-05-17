"""
Research Kit Backend - Real LLM Integration
Multi-provider support: OpenAI, Google Gemini, Z.ai (GLM)
"""

import os
import json
import logging
from contextlib import asynccontextmanager
from typing import Any, Dict, Literal, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Import official SDKs
from openai import AsyncOpenAI
from pydantic import BaseModel

# Note: Google's SDK requires HTTP-based streaming which is handled differently
import httpx

# Import verify and extract services
from app.verify_service import verify_claim
# Legacy module — extract_service.py has been removed.
# Use `from app.llm import extract_via_llm` if you need the new pipeline here.

ProviderType = Literal["anthropic", "openai", "gemini"]


# Pydantic models for API
class VerifyRequest(BaseModel):
    claim: str
    doi: Optional[str] = None
    paper_url: Optional[str] = None
    paper_title: Optional[str] = None
    provider: Optional[ProviderType] = None


class ExtractRequest(BaseModel):
    page_text: str
    site: str  # "elicit" | "consensus" | "scispace"
    provider: Optional[ProviderType] = None


# In-memory DOI cache — key: doi, value: VerifyResult
_verify_cache: Dict[str, Any] = {}

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# API Keys
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
GEMINI_API_KEY = os.getenv("GOOGLE_API_KEY", "")
ZAI_API_KEY = os.getenv("ZAI_API_KEY", "")

# Provider model mapping
PROVIDER_MODELS = {
    "openai": "gpt-4o-mini",
    "gemini": "gemini-2.5-flash",
    "zai": "glm-4.7",
}

# Initialize clients
openai_client: Optional[AsyncOpenAI] = None
zai_client: Optional[AsyncOpenAI] = None
http_client: Optional[httpx.AsyncClient] = None

SYSTEM_PROMPT = """You are ResearchKit Agent, an AI assistant specialized in analyzing academic research pages.

You receive page content from research platforms (Elicit, SciSpace, Consensus).

Instructions:
1. Read and analyze the provided page content carefully
2. Extract relevant information: methodology, findings, conclusions, citations
3. Answer the user's question based on what's actually on the page
4. If the answer is on the page, provide it with context
5. If the answer is not on the page, say "This information is not available on this page"
6. Highlight key methodologies, results, and important details

Format: Be concise and direct. Use bullet points for clarity.
Source: Always indicate if you're quoting directly from the page.
"""


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize clients on startup."""
    global openai_client, zai_client, http_client

    logger.info("[Server] Starting Research Kit Backend (Real LLM Mode)...")

    # Initialize OpenAI
    if OPENAI_API_KEY:
        openai_client = AsyncOpenAI(api_key=OPENAI_API_KEY)
        logger.info("[Server] ✅ OpenAI initialized")
    else:
        logger.warning("[Server] ⚠️  OPENAI_API_KEY not set")

    # Initialize Z.ai
    if ZAI_API_KEY:
        zai_client = AsyncOpenAI(api_key=ZAI_API_KEY, base_url="https://api.z.ai/api/paas/v4/")
        logger.info("[Server] ✅ Z.ai initialized")
    else:
        logger.warning("[Server] ⚠️  ZAI_API_KEY not set")

    # Initialize HTTP client for Gemini (raw API)
    if GEMINI_API_KEY:
        http_client = httpx.AsyncClient(timeout=60.0)
        logger.info("[Server] ✅ Gemini API initialized")
    else:
        logger.warning("[Server] ⚠️  GOOGLE_API_KEY not set")

    yield

    # Cleanup
    if http_client:
        await http_client.aclose()
    logger.info("[Server] Shutdown complete")


app = FastAPI(
    title="Research Kit — Real LLM API",
    description="WebSocket API for extension with real LLM providers",
    version="4.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> Dict[str, Any]:
    """Health check endpoint."""
    available_providers = []
    if openai_client:
        available_providers.append("openai")
    if zai_client:
        available_providers.append("zai")
    if http_client and GEMINI_API_KEY:
        available_providers.append("gemini")

    if available_providers:
        return {
            "status": "ok",
            "service": "research-kit-openai",
            "available_providers": available_providers,
            "models": {p: PROVIDER_MODELS[p] for p in available_providers},
        }
    else:
        return {
            "status": "degraded",
            "service": "research-kit-openai",
            "error": "No LLM provider available. Set OPENAI_API_KEY, ZAI_API_KEY, or GOOGLE_API_KEY",
        }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for the extension sidebar."""
    await websocket.accept()
    logger.info(f"[WS] New connection from {websocket.client}")

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type", "unknown")
            logger.info(f"[WS] Received: {msg_type}")

            if msg_type == "agent:run":
                await handle_agent_run(websocket, data)
            else:
                await websocket.send_json(
                    {
                        "type": "error",
                        "message": f"Unknown message type: {msg_type}",
                    }
                )

    except WebSocketDisconnect:
        logger.info(f"[WS] Connection closed from {websocket.client}")
    except Exception as e:
        logger.exception(f"[WS] Error: {e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except:
            pass


async def handle_agent_run(websocket: WebSocket, data: Dict[str, Any]) -> None:
    """Handle agent:run requests with multi-provider support."""
    request = data.get("request", "")
    page_models = data.get("page_models", [])
    provider = data.get("provider", "openai").lower()

    if not request:
        await websocket.send_json({"type": "error", "message": "Missing 'request' field"})
        return

    if provider not in PROVIDER_MODELS:
        await websocket.send_json(
            {
                "type": "error",
                "message": f"Unknown provider '{provider}'. Available: {list(PROVIDER_MODELS.keys())}",
            }
        )
        return

    model = PROVIDER_MODELS[provider]
    logger.info(f"[Agent] Running: provider={provider}, model={model}")

    # Build context from PageModels - highlight page content
    context_parts = []
    for i, pm in enumerate(page_models):
        context_parts.append(f"=== Page {i + 1}: {pm.get('site', 'unknown')} ===")
        context_parts.append(f"Title: {pm.get('title', 'N/A')}")
        context_parts.append(f"URL: {pm.get('url', 'N/A')}")
        if pm.get("content"):
            context_parts.append(f"\nPage Content ({pm.get('contentLength', 0)} chars):")
            context_parts.append(pm["content"])
        context_parts.append("")

    context_str = (
        "\n".join(context_parts)
        if context_parts
        else json.dumps({"page_models": page_models}, indent=2)
    )
    full_query = f"User Question: {request}\n\n<page_context>\n{context_str}\n</page_context>"

    try:
        if provider == "openai":
            await stream_openai(websocket, full_query, model)
        elif provider == "zai":
            await stream_zai(websocket, full_query, model)
        elif provider == "gemini":
            await stream_gemini(websocket, full_query, model)
        else:
            await websocket.send_json(
                {
                    "type": "error",
                    "message": f"Provider {provider} not implemented",
                }
            )
    except Exception as e:
        logger.exception(f"[Agent] Error with {provider}")
        await websocket.send_json({"type": "error", "message": str(e)})


async def stream_openai(websocket: WebSocket, query: str, model: str) -> None:
    """Stream from OpenAI API."""
    if not openai_client:
        await websocket.send_json({"type": "error", "message": "OpenAI not configured"})
        return

    stream = await openai_client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": query},
        ],
        stream=True,
        temperature=0.7,
    )

    async for chunk in stream:
        if chunk.choices[0].delta.content:
            await websocket.send_json(
                {
                    "type": "text",
                    "delta": chunk.choices[0].delta.content,
                }
            )

    await websocket.send_json({"type": "done", "stop_reason": "end_turn"})
    logger.info("[Agent] OpenAI stream complete")


async def stream_zai(websocket: WebSocket, query: str, model: str) -> None:
    """Stream from Z.ai API."""
    if not zai_client:
        await websocket.send_json({"type": "error", "message": "Z.ai not configured"})
        return

    stream = await zai_client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": query},
        ],
        stream=True,
        temperature=0.7,
    )

    async for chunk in stream:
        if chunk.choices[0].delta.content:
            await websocket.send_json(
                {
                    "type": "text",
                    "delta": chunk.choices[0].delta.content,
                }
            )

    await websocket.send_json({"type": "done", "stop_reason": "end_turn"})
    logger.info("[Agent] Z.ai stream complete")


async def stream_gemini(websocket: WebSocket, query: str, model: str) -> None:
    """Stream from Google Gemini API via REST."""
    if not http_client or not GEMINI_API_KEY:
        await websocket.send_json({"type": "error", "message": "Gemini not configured"})
        return

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent"

    try:
        response = await http_client.post(
            url,
            params={"key": GEMINI_API_KEY},
            json={
                "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
                "contents": [{"parts": [{"text": query}]}],
                "generation_config": {
                    "temperature": 0.7,
                },
            },
        )

        if response.status_code != 200:
            error_text = response.text
            logger.error(f"Gemini error {response.status_code}: {error_text}")
            await websocket.send_json(
                {
                    "type": "error",
                    "message": f"Gemini API error: {error_text}",
                }
            )
            return

        try:
            # Gemini API returns full response at once (not streaming)
            data = response.json()
            if "candidates" in data:
                for candidate in data["candidates"]:
                    if "content" in candidate:
                        for part in candidate["content"].get("parts", []):
                            if "text" in part:
                                await websocket.send_json(
                                    {
                                        "type": "text",
                                        "delta": part["text"],
                                    }
                                )
        except json.JSONDecodeError:
            logger.error(f"Failed to parse Gemini response: {response.text}")
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Failed to parse Gemini response",
                }
            )
            return

        await websocket.send_json({"type": "done", "stop_reason": "end_turn"})
        logger.info("[Agent] Gemini stream complete")

    except Exception as e:
        logger.exception("Gemini streaming error")
        await websocket.send_json({"type": "error", "message": str(e)})


@app.post("/verify")
async def verify_endpoint(req: VerifyRequest):
    """Verify a claim against a paper."""
    if req.provider:
        logger.info("provider=%s", req.provider)
    cache_key = req.doi or req.paper_title or req.claim[:80]
    if cache_key in _verify_cache:
        return _verify_cache[cache_key]

    result = await verify_claim(
        claim=req.claim,
        doi=req.doi,
        paper_url=req.paper_url,
        paper_title=req.paper_title,
    )

    if result.status.value != "not_found":
        _verify_cache[cache_key] = {
            "status": result.status.value,
            "verbatim_quote": result.verbatim_quote,
            "confidence": result.confidence,
            "reason": result.reason,
            "paper_title": result.paper_title,
            "doi": result.doi,
        }

    return {
        "status": result.status.value,
        "verbatim_quote": result.verbatim_quote,
        "confidence": result.confidence,
        "reason": result.reason,
        "paper_title": result.paper_title,
        "doi": result.doi,
    }


@app.post("/extract")
async def extract_endpoint(_req: ExtractRequest):
    """Extract claims from page text.

    NOTE: extract_service.py has been removed. This endpoint is part of the
    legacy main_openai.py app (not mounted by main.py). The new pipeline lives
    in app.routers.extract (POST /v1/extract) via app.llm.extract_via_llm.
    """
    from fastapi import HTTPException

    raise HTTPException(
        status_code=410,
        detail="extract_service has been removed. Use POST /v1/extract via the main app.",
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main_openai:app", host="0.0.0.0", port=9000, reload=False)
