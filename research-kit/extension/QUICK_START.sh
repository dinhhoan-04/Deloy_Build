#!/bin/bash
# ResearchKit Phase 2 - Quick Start Script

echo "🔬 ResearchKit Phase 2 - Quick Start"
echo "===================================="

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found. Please install Node.js 18+"
  exit 1
fi

echo "✅ Node.js $(node --version)"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# Run tests
echo ""
echo "🧪 Running tests..."
npm test -- --run

# Check TypeScript
echo ""
echo "📋 Checking TypeScript..."
npx tsc --noEmit

# Build extension
echo ""
echo "🔨 Building extension..."
npm run build

# Summary
echo ""
echo "===================================="
echo "✅ Setup Complete!"
echo ""
echo "Next steps:"
echo "1. Go to chrome://extensions"
echo "2. Enable 'Developer mode'"
echo "3. Click 'Load unpacked'"
echo "4. Select: $(pwd)/dist"
echo ""
echo "Then visit:"
echo "  - https://elicit.com/notebook"
echo "  - https://scispace.com/papers"
echo "  - https://consensus.app"
echo ""
echo "Click the ResearchKit icon to open the sidebar!"
echo "===================================="
