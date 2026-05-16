#!/bin/bash

# ResearchKit Quick Start with Real LLM (OpenAI/Gemini/Groq)
# Run: bash START_REAL.sh

set -e

echo "🚀 ResearchKit with Real LLM - Startup"
echo "======================================"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ ! -f "FINAL_SETUP.md" ]; then
    echo "❌ Please run this from the project root directory"
    exit 1
fi

# Check API keys
if [ -z "$OPENAI_API_KEY" ] && [ -z "$GROQ_API_KEY" ] && [ -z "$GOOGLE_API_KEY" ]; then
    echo -e "${YELLOW}⚠️  WARNING: No LLM API keys detected!${NC}"
    echo ""
    echo "Set at least one:"
    echo "  export OPENAI_API_KEY='sk-...'"
    echo "  export GROQ_API_KEY='gsk-...'"
    echo "  export GOOGLE_API_KEY='AIza...'"
    echo ""
fi

# 1. Start Backend
echo -e "${BLUE}[1/3] Starting Real LLM Backend...${NC}"
cd research-kit/backend

# Kill any existing Python process on 9000
pkill -f "uvicorn.*9000" || true
sleep 1

# Use main.py (runs + worker + verify/extract routers)
python -m uvicorn app.main:app --port 9000 > /tmp/backend.log 2>&1 &
BACKEND_PID=$!
sleep 2

# Check if backend is running
if curl -s http://localhost:9000/health > /dev/null 2>&1; then
    HEALTH=$(curl -s http://localhost:9000/health)
    echo -e "${GREEN}✅ Backend running: $HEALTH${NC}"
else
    echo "❌ Backend failed to start. Check /tmp/backend.log"
    cat /tmp/backend.log
    kill $BACKEND_PID || true
    exit 1
fi

cd ../..

# 2. Build Extension
echo -e "${BLUE}[2/3] Building Extension...${NC}"
cd research-kit/extension

npm run build > /tmp/build.log 2>&1

if [ -d "dist" ]; then
    echo -e "${GREEN}✅ Extension built in dist/${NC}"
else
    echo "❌ Build failed. Check /tmp/build.log"
    cat /tmp/build.log
    exit 1
fi

cd ../..

# 3. Instructions
echo ""
echo -e "${BLUE}[3/3] Setup Complete${NC}"
echo "======================================"
echo ""
echo -e "${GREEN}✅ Backend running on: http://localhost:9000${NC}"
echo -e "${GREEN}✅ Extension built in: research-kit/extension/dist/${NC}"
echo ""
echo "📋 Next Steps:"
echo ""
echo "1. Open Chrome and go to: chrome://extensions/"
echo "2. Enable 'Developer mode' (toggle in top right)"
echo "3. Click 'Load unpacked'"
echo "4. Select: research-kit/extension/dist/"
echo ""
echo "5. Visit a research website:"
echo "   - https://www.elicit.org/"
echo "   - https://scispace.com/"
echo "   - https://consensus.app/"
echo ""
echo "6. Click the ResearchKit icon → Enable sites → Ask question"
echo ""
echo -e "${YELLOW}🔑 Active Providers:${NC}"
if [ -n "$OPENAI_API_KEY" ]; then echo "  ✓ OpenAI"; fi
if [ -n "$GROQ_API_KEY" ]; then echo "  ✓ Groq"; fi
if [ -n "$GOOGLE_API_KEY" ]; then echo "  ✓ Gemini"; fi
echo ""
echo "Backend Process ID: $BACKEND_PID"
echo "To stop: kill $BACKEND_PID"
echo ""
