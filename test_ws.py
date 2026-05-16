#!/usr/bin/env python
"""
Quick WebSocket test for Research Kit Backend
Tests all three providers: OpenAI, Groq, Gemini
"""

import asyncio
import json
import websockets
from datetime import datetime

async def test_provider(provider: str):
    """Test a single provider."""
    print(f"\n🧪 Testing {provider.upper()}...")

    uri = "ws://localhost:9000/ws"

    try:
        async with websockets.connect(uri) as websocket:
            # Send test request
            request = {
                "type": "agent:run",
                "request": "What are the main research methodologies in your page?",
                "provider": provider,
                "page_models": [
                    {
                        "site": "elicit",
                        "schemaVersion": "1.0",
                        "url": "https://www.elicit.org/",
                        "title": "Test Page",
                        "citations": [],
                        "adapterMeta": {
                            "adapterVersion": "1.0",
                            "extractionWarnings": [],
                            "selectorHits": {}
                        }
                    }
                ],
                "mode": "chat"
            }

            await websocket.send(json.dumps(request))
            print(f"   → Request sent to {provider}")

            # Receive streaming response
            response_text = ""
            message_count = 0
            start_time = datetime.now()

            async for message in websocket:
                data = json.loads(message)
                msg_type = data.get("type")

                if msg_type == "text":
                    response_text += data.get("delta", "")
                    print(".", end="", flush=True)
                elif msg_type == "done":
                    elapsed = (datetime.now() - start_time).total_seconds()
                    print(f"\n   ✅ {provider} completed in {elapsed:.1f}s")
                    print(f"   📝 Response ({len(response_text)} chars):")
                    print(f"   {response_text[:200]}..." if len(response_text) > 200 else f"   {response_text}")
                    break
                elif msg_type == "error":
                    print(f"\n   ❌ {provider} error: {data.get('message')}")
                    break

                message_count += 1
                if message_count > 500:  # Safety limit
                    print("\n   ⚠️  Max messages reached")
                    break

    except Exception as e:
        print(f"   ❌ Connection failed: {e}")

async def main():
    """Test all providers."""
    print("="*60)
    print("🚀 Research Kit Backend - WebSocket Provider Test")
    print("="*60)

    providers = ["openai", "groq", "gemini"]

    for provider in providers:
        try:
            await test_provider(provider)
        except Exception as e:
            print(f"   ❌ Exception: {e}")

    print("\n" + "="*60)
    print("✅ Test complete!")
    print("="*60)

if __name__ == "__main__":
    asyncio.run(main())
