# ResearchKit Phase 2 - Setup & Testing Guide

## Quick Start

### 1. Install Dependencies
```bash
cd research-kit/extension
npm install
```

### 2. Run Tests
```bash
# Run all tests
npm test

# Watch mode during development
npm test -- --watch

# Specific test file
npm test src/sidebar/components/
```

**Expected Result:** 109+ tests passing ✓

### 3. Build Extension
```bash
npm run build
```

This generates:
- `dist/` - Bundled extension files
- `dist/manifest.json` - Extension manifest
- `dist/service-worker-loader.js` - Background service worker

### 4. Load in Chrome

1. Open `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select: `research-kit/extension/dist/`

**You should see:**
- Extension icon in toolbar (🔬 or custom icon)
- "ResearchKit" appears in extension list

### 5. Test the Sidebar

#### 5.1 Open Sidebar
1. Visit: https://elicit.com/notebook (or scispace.com/papers or consensus.app)
2. Click extension icon in toolbar
3. Sidebar opens on the right side of the page

#### 5.2 Test Verify Tab (First Tab)
- **Expected:** Empty state message "No claims detected on this page yet"
- **Check the UI:**
  - Header shows "ResearchKit" brand
  - Live indicator (pulsing dot when verification running)
  - 3 site pills (Elicit ✓ / SciSpace / Consensus)
  - Progress bar (initially empty)
  - Tab bar with 6 tabs (Verify, Inbox, Conflicts, Chat, Draft, Help)

#### 5.3 Test Settings
1. Click settings icon (⚙️) in header
2. **Expected:** Settings modal opens with 3 site toggles
3. Toggle sites on/off
4. Click close button
5. **Verify:** Selected sites persist in sidebar

#### 5.4 Test Tab Navigation
1. Click each tab in the tab bar:
   - **Verify:** Shows empty state + filter pills
   - **Inbox:** Shows empty state message
   - **Conflicts:** Shows empty state message
   - **Chat:** Shows "Coming soon" placeholder
   - **Draft:** Shows "Coming soon" placeholder
   - **Help:** Shows feature descriptions + version info

#### 5.5 Test Onboarding (First Run)
- On first install, onboarding overlay should appear
- 3-step tutorial showing:
  1. Extract Claims
  2. Verify Claims
  3. Organize & Synthesize
- Click "Finish" to dismiss

### 6. TypeScript Type Checking
```bash
npm run type-check
# or
npx tsc --noEmit
```

**Expected:** No TypeScript errors

### 7. Lint Check
```bash
npm run lint
```

**Expected:** No linting issues

## Component Testing Checklist

### Sidebar Shell ✓
- [ ] Header renders correctly
- [ ] All 3 site pills visible
- [ ] Live indicator pulses when active
- [ ] Settings button opens panel
- [ ] Progress bar visible below header
- [ ] TabBar shows all 6 tabs
- [ ] Footer shows project selector
- [ ] Footer shows "0 selected" when no items selected

### Tab Content ✓
- [ ] VerifyTab filters work (All/Verified/Partial/Not Found)
- [ ] InboxTab shows empty state
- [ ] ConflictsTab shows empty state
- [ ] ChatTab/DraftTab show placeholders
- [ ] HelpTab displays all feature descriptions

### Overlays ✓
- [ ] SettingsPanel opens/closes
- [ ] Settings toggles are clickable
- [ ] OnboardingOverlay displays correctly
- [ ] Step navigation works (Next/Back/Finish)

### Design System ✓
- [ ] Colors render correctly (CSS variables)
- [ ] Animations smooth (fadeSlideIn, slideInRight, etc.)
- [ ] Responsive layout (handles sidebar width changes)
- [ ] Dark mode ready (uses CSS custom properties)

## File Structure to Verify

```
research-kit/extension/src/
├── sidebar/
│   ├── App.tsx ✓
│   ├── index.tsx ✓
│   ├── components/
│   │   ├── atoms/ (15 components) ✓
│   │   ├── shell/ (5 components) ✓
│   │   ├── tabs/ (6 components) ✓
│   │   └── overlays/ (2 components) ✓
│   ├── state/
│   │   ├── useStore.ts ✓
│   │   ├── storage.ts ✓
│   │   ├── migration.ts ✓
│   │   └── selectors/ ✓
│   ├── hooks/ ✓
│   └── styles/tokens.css ✓
├── shared/
│   ├── verify-types.ts ✓
│   └── messages.ts ✓
├── adapters/
│   └── hybrid.ts ✓ (fixed Phase 2 compatibility)
└── background_minimal.ts ✓ (fixed Phase 2 compatibility)
```

## Testing Data

To test with sample data, modify `src/test/setup.ts`:

```typescript
// Mock storage with sample data
chrome.storage.local.get = vi.fn((keys, cb) => {
  cb({
    inbox: [
      { id: 'i1', text: 'Sample claim', paperTitle: 'Sample Paper', ... },
    ],
    activeSites: new Set(['elicit', 'scispace']),
  })
})
```

## Debugging

### View Console
1. Right-click extension icon → Inspect popup
2. Or: `chrome://extensions` → ResearchKit → Inspect views

### Check Chrome Storage
1. DevTools → Application → Chrome Storage → Local Storage
2. Look for keys: `projects`, `inbox`, `conflicts`, etc.

### Test Messages
1. DevTools Console, run:
```javascript
chrome.runtime.sendMessage(
  { type: 'MSG_VERIFY_PROGRESS', progress: {...} },
  response => console.log(response)
)
```

## Known Limitations (Phase 2 Foundation)

✋ **Not Yet Implemented (Phases H-J):**
- Backend API integration
- Real claim extraction (using sample data)
- Verification service
- Conflict resolution logic
- Archive & save functionality
- Project creation

✅ **Fully Working:**
- UI/UX layout and navigation
- State management
- Component communication
- Type safety
- Design system
- Test suite

## Success Criteria

Your extension works correctly when:

1. ✅ Extension loads without errors
2. ✅ Sidebar opens on Elicit/SciSpace/Consensus
3. ✅ All 6 tabs visible and clickable
4. ✅ Settings panel opens/closes smoothly
5. ✅ No console errors
6. ✅ All 109 tests pass
7. ✅ No TypeScript errors
8. ✅ Layout responsive and animations smooth

## Next Steps (Phases H-J)

- **Phase H:** Add backend provider field to storage schema
- **Phase I:** Create integration tests connecting sidebar ↔ background
- **Phase J:** Production build, minification, extension packaging

---

**Built with:** React 19 • Vite • Tailwind 4 • Zustand • TypeScript • Vitest
**Status:** Phase 2 UI/UX Foundation Complete ✓
