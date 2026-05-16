#!/bin/bash

# ResearchKit Quick Start Script
# Run: bash START.sh

set -e

echo "🚀 ResearchKit Startup Script"
echo "=============================="

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if running from correct directory
if [ ! -f "FINAL_SETUP.md" ]; then
    echo "❌ Please run this from the project root directory"
    exit 1
fi

# 1. Start Backend
echo -e "${BLUE}[1/3] Starting Backend...${NC}"
cd research-kit/backend

# Kill any existing Python process on 9000
pkill -f "uvicorn.*9000" || true
sleep 1

python -m uvicorn app.main_mock_fast:app --port 9000 > /tmp/backend.log 2>&1 &
BACKEND_PID=$!
sleep 2

# Check if backend is running
if curl -s http://localhost:9000/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Backend running on http://localhost:9000${NC}"
else
    echo "❌ Backend failed to start. Check /tmp/backend.log"
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
    exit 1
fi

cd ../..

# 3. Instructions
echo ""
echo -e "${BLUE}[3/3] Setup Instructions${NC}"
echo "=============================="
echo ""
echo -e "${GREEN}✅ Backend is running on: http://localhost:9000${NC}"
echo -e "${GREEN}✅ Extension is built in: research-kit/extension/dist/${NC}"
echo ""
echo "📋 Next Steps:"
echo ""
echo "1. Open Chrome and go to: chrome://extensions/"
echo "2. Enable 'Developer mode' (toggle in top right)"
echo "3. Click 'Load unpacked'"
echo "4. Select: research-kit/extension/dist/"
echo ""
echo "5. Visit any research website:"
echo "   - https://www.elicit.org/"
echo "   - https://scispace.com/"
echo "   - https://consensus.app/"
echo ""
echo "6. Click the ResearchKit icon (appears in top right)"
echo "7. Type a question and click 'Ask Agent'"
echo ""
echo -e "${GREEN}🎉 You're ready to test!${NC}"
echo ""
echo "Backend Process ID: $BACKEND_PID"
echo "To stop: kill $BACKEND_PID"
echo ""
