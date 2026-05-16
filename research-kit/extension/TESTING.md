# Testing Research Kit Extension (Phase A)

## Setup

1. **Backend running?** Check `http://localhost:8000/docs` — should return Swagger UI
2. **Extension built?** Run `npm run build` — creates `dist/` folder

## Load Unpacked Extension

1. Open Chrome
2. Go to `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked"
5. Select the `dist/` folder
6. Extension icon should appear in toolbar

## Test Verify Tab

1. Click extension icon → popup opens
2. Paste this claim: "BERT achieves 91.2% F1 on SQuAD 1.1"
3. Add citation URL: `https://arxiv.org/abs/1810.04805`
4. Click "Verify"
5. Check DevTools (F12 → Console) for errors
6. Result should show document_score (or N/A if connection fails)

## Troubleshooting

- **CORS error?** Backend CORS not configured for extension origin
- **Network error?** Backend not running or unreachable
- **Popup blank?** Check DevTools console for JavaScript errors

