# Comprehensive UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish all remaining unbranded components — ConflictResolutionPanel, PaperGroup, StatusBadge, Toast, Checkbox, empty states — add CSS-only motion (skeleton shimmer, stagger, hover lift, toast slide-in), and normalize typography across the app.

**Architecture:** 13 sequential tasks ordered foundation → atoms → overlays → tabs → shell. Tokens added first (all animation keyframes), then new Checkbox atom (used by Tasks 5 & 11), then each component fixed independently. No layout changes, no new dependencies — only CSS custom properties, inline styles, and the keyframes added in Task 1.

**Tech Stack:** React 18 + TypeScript + Tailwind CSS + CSS custom properties (`tokens.css`) + Vitest + React Testing Library (`@testing-library/react`)

**Test runner:** `npx vitest run --reporter=verbose <path>` from `research-kit/extension/`

**Spec:** `docs/superpowers/specs/2026-05-15-comprehensive-ui-polish.md`

---

## File Map

| Task | File | Action |
|------|------|--------|
| 1 | `src/sidebar/styles/tokens.css` | Modify — add 3 keyframes + 3 utility classes |
| 2 | `src/sidebar/components/atoms/Checkbox.tsx` | **Create new** |
| 3 | `src/sidebar/components/atoms/StatusBadge.tsx` | Modify — fix pending + inaccessible |
| 4 | `src/sidebar/components/atoms/Toast.tsx` | Modify — add icons + slide-in |
| 5 | `src/sidebar/components/atoms/PaperGroup.tsx` | Modify — warm tokens, SVG chevrons, folder icon, Checkbox |
| 6 | `src/sidebar/components/atoms/ConflictResolutionPanel.tsx` | Modify — full redesign |
| 7 | `src/sidebar/components/atoms/ClaimCard.tsx` | Modify — hover lift + typography |
| 8 | `src/sidebar/components/tabs/VerifyTab.tsx` | Modify — skeleton shimmer + stagger + empty state |
| 9 | `src/sidebar/components/tabs/InboxTab.tsx` | Modify — branded empty state |
| 10 | `src/sidebar/components/tabs/ConflictsTab.tsx` | Modify — branded empty state |
| 11 | `src/sidebar/components/tabs/DraftTab.tsx` | Modify — Checkbox atom + empty state minor |
| 12 | `src/sidebar/components/shell/TabBar.tsx` | Modify — active label font-weight |
| 13 | Build verify | `npm run build` — confirm 0 TS errors |

---

## Task 1: tokens.css — animation keyframes

**Files:**
- Modify: `research-kit/extension/src/sidebar/styles/tokens.css`

- [ ] **Step 1: Add keyframes and utility classes** — append to the end of `tokens.css` (after the existing `.animate-conflictPulse` line):

```css
@keyframes shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position:  400px 0; }
}

@keyframes staggerIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes toastSlide {
  from { opacity: 0; transform: translateY(-10px) scale(0.96); }
  to   { opacity: 1; transform: translateY(0)    scale(1); }
}

.animate-shimmer    { animation: shimmer    1.4s ease-in-out infinite; }
.animate-staggerIn  { animation: staggerIn  0.22s ease-out both; }
.animate-toastSlide { animation: toastSlide 0.22s ease-out both; }
```

- [ ] **Step 2: Verify no build error**

```bash
cd research-kit/extension && npx tsc --noEmit
```

Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add research-kit/extension/src/sidebar/styles/tokens.css
git commit -m "style: add shimmer/staggerIn/toastSlide keyframes to tokens.css"
```

---

## Task 2: Checkbox.tsx — new custom checkbox atom

**Files:**
- Create: `research-kit/extension/src/sidebar/components/atoms/Checkbox.tsx`
- Test: `research-kit/extension/src/sidebar/components/atoms/Checkbox.test.tsx` (already exists — read it before implementing)

The existing test (`Checkbox.test.tsx`) expects:
- `role="checkbox"` on the interactive element
- `aria-checked` reflects `checked` prop (so `toBeChecked()` works)
- `onChange(true)` called when unchecked item is clicked (passes new value)
- `onChange(false)` called when checked item is clicked
- `disabled` prop prevents `onChange` from firing
- Optional `label` rendered as visible text

- [ ] **Step 1: Run existing test to see it fail** (Checkbox.tsx doesn't exist yet)

```bash
cd research-kit/extension && npx vitest run --reporter=verbose src/sidebar/components/atoms/Checkbox.test.tsx
```

Expected: FAIL — "Cannot find module './Checkbox'"

- [ ] **Step 2: Create `Checkbox.tsx`**

```tsx
interface CheckboxProps {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
  disabled?: boolean
}

export function Checkbox({ checked, onChange, label, disabled = false }: CheckboxProps) {
  return (
    <label
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 8,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <button
        role="checkbox"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        style={{
          width: 16, height: 16, borderRadius: 5, flexShrink: 0,
          border: checked ? 'none' : '2px solid var(--rk-border-warm)',
          background: checked ? 'var(--rk-brand-gradient)' : 'white',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 0, cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {checked && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1.5,5 4,7.5 8.5,2.5" />
          </svg>
        )}
      </button>
      {label && (
        <span style={{
          fontSize: 12,
          color: checked ? 'var(--rk-text-brand)' : 'var(--rk-text)',
          fontWeight: checked ? 600 : 400,
        }}>
          {label}
        </span>
      )}
    </label>
  )
}
```

- [ ] **Step 3: Run test to verify it passes**

```bash
cd research-kit/extension && npx vitest run --reporter=verbose src/sidebar/components/atoms/Checkbox.test.tsx
```

Expected: all 5 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add research-kit/extension/src/sidebar/components/atoms/Checkbox.tsx
git commit -m "feat: add custom Checkbox atom with brand gradient checked state"
```

---

## Task 3: StatusBadge.tsx — fix pending + inaccessible colors

**Files:**
- Modify: `research-kit/extension/src/sidebar/components/atoms/StatusBadge.tsx`
- Test: `research-kit/extension/src/sidebar/components/atoms/StatusBadge.test.tsx`

Current issues: `pending` uses `--rk-blue` (old token). `inaccessible` uses hardcoded Tailwind `orange-*` classes and label "Inaccessible".

- [ ] **Step 1: Add failing test for new pending label format**

Append to `StatusBadge.test.tsx`:

```tsx
  it('shows "⏳ Pending" with brand purple for pending status', () => {
    const { container } = render(<StatusBadge status="pending" />)
    expect(screen.getByText('⏳ Pending')).toBeInTheDocument()
    // must NOT use the old blue token
    expect(container.firstChild).not.toHaveClass('text-[var(--rk-blue)]')
  })

  it('shows "🔒 Locked" for inaccessible status', () => {
    render(<StatusBadge status="inaccessible" />)
    expect(screen.getByText('🔒 Locked')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run tests to see new ones fail**

```bash
cd research-kit/extension && npx vitest run --reporter=verbose src/sidebar/components/atoms/StatusBadge.test.tsx
```

Expected: 2 new tests FAIL (text "⏳ Pending" not found, "🔒 Locked" not found).

- [ ] **Step 3: Update `StatusBadge.tsx`**

Replace the entire file content:

```tsx
import type { VerifyStatus } from '../../../shared/verify-types'

const LABELS: Record<VerifyStatus, string> = {
  verified:     'Verified',
  partial:      'Partial',
  not_found:    'Not Found',
  inaccessible: '🔒 Locked',
  pending:      '⏳ Pending',
  error:        'Error',
}

const COLORS: Record<VerifyStatus, string> = {
  verified:     'bg-[var(--rk-green-subtle)] text-[var(--rk-green)] border border-[color:rgba(15,138,86,0.25)]',
  partial:      'bg-[var(--rk-yellow-subtle)] text-[var(--rk-yellow)] border border-[color:rgba(168,101,0,0.25)]',
  not_found:    'bg-[var(--rk-grey-subtle)] text-[var(--rk-grey)] border border-[color:rgba(94,111,143,0.25)]',
  inaccessible: 'border border-[color:rgba(234,88,12,0.25)]',
  pending:      'border border-[color:rgba(124,58,237,0.25)]',
  error:        'bg-[var(--rk-red-subtle)] text-[var(--rk-red)] border border-[color:rgba(196,63,50,0.25)]',
}

const INLINE_COLORS: Partial<Record<VerifyStatus, React.CSSProperties>> = {
  inaccessible: { background: 'rgba(234,88,12,0.10)', color: '#c2410c' },
  pending:      { background: 'rgba(124,58,237,0.10)', color: 'var(--rk-brand)' },
}

export function StatusBadge({ status }: { status: VerifyStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${COLORS[status]}`}
      style={INLINE_COLORS[status]}
    >
      {LABELS[status]}
    </span>
  )
}
```

- [ ] **Step 4: Run all StatusBadge tests**

```bash
cd research-kit/extension && npx vitest run --reporter=verbose src/sidebar/components/atoms/StatusBadge.test.tsx
```

Expected: all 6 tests PASS (4 original + 2 new).

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/sidebar/components/atoms/StatusBadge.tsx research-kit/extension/src/sidebar/components/atoms/StatusBadge.test.tsx
git commit -m "fix: StatusBadge pending→brand purple, inaccessible→orange tokens, rename to Locked"
```

---

## Task 4: Toast.tsx — SVG icons + slide-in animation

**Files:**
- Modify: `research-kit/extension/src/sidebar/components/atoms/Toast.tsx`
- Test: `research-kit/extension/src/sidebar/components/atoms/Toast.test.tsx`

- [ ] **Step 1: Add failing tests for icons and animation class**

Append to `Toast.test.tsx`:

```tsx
  it('renders an svg icon for success tone', () => {
    const { container } = render(<Toast message="ok" tone="success" onDismiss={vi.fn()} />)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('renders an svg icon for error tone', () => {
    const { container } = render(<Toast message="err" tone="error" onDismiss={vi.fn()} />)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('applies slide-in animation class', () => {
    const { container } = render(<Toast message="ok" tone="success" onDismiss={vi.fn()} />)
    expect(container.firstChild).toHaveClass('animate-toastSlide')
  })
```

- [ ] **Step 2: Run tests to see new ones fail**

```bash
cd research-kit/extension && npx vitest run --reporter=verbose src/sidebar/components/atoms/Toast.test.tsx
```

Expected: 3 new tests FAIL.

- [ ] **Step 3: Replace `Toast.tsx`**

```tsx
type Tone = 'success' | 'warning' | 'error'

interface ToastProps {
  message: string
  tone: Tone
  onDismiss: () => void
}

const TONE_CLASS: Record<Tone, string> = {
  success: 'bg-[var(--rk-green-subtle)] text-[var(--rk-green)] border-[var(--rk-green)]',
  warning: 'bg-[var(--rk-yellow-subtle)] text-[var(--rk-yellow)] border-[var(--rk-yellow)]',
  error:   'bg-[var(--rk-red-subtle)] text-[var(--rk-red)] border-[var(--rk-red)]',
}

function SuccessIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="8,12 11,15 16,9" />
    </svg>
  )
}

function WarningIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

function ErrorIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  )
}

const ICON: Record<Tone, React.FC> = {
  success: SuccessIcon,
  warning: WarningIcon,
  error:   ErrorIcon,
}

export function Toast({ message, tone, onDismiss }: ToastProps) {
  const Icon = ICON[tone]
  return (
    <div
      className={`toast--${tone} animate-toastSlide flex items-center gap-2 px-3 py-2 border text-sm ${TONE_CLASS[tone]}`}
      style={{ borderRadius: 10, boxShadow: 'var(--rk-shadow-sm)' }}
    >
      <Icon />
      <span className="flex-1">{message}</span>
      <button aria-label="dismiss" onClick={onDismiss} className="opacity-60 hover:opacity-100 ml-1 text-inherit">✕</button>
    </div>
  )
}
```

- [ ] **Step 4: Run all Toast tests**

```bash
cd research-kit/extension && npx vitest run --reporter=verbose src/sidebar/components/atoms/Toast.test.tsx
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/sidebar/components/atoms/Toast.tsx research-kit/extension/src/sidebar/components/atoms/Toast.test.tsx
git commit -m "feat: Toast — SVG tone icons + slide-in animation"
```

---

## Task 5: PaperGroup.tsx — warm tokens, folder icon, SVG chevrons, Checkbox

**Files:**
- Modify: `research-kit/extension/src/sidebar/components/atoms/PaperGroup.tsx`
- Test: `research-kit/extension/src/sidebar/components/atoms/PaperGroup.test.tsx`

- [ ] **Step 1: Add failing test for SVG chevron (no emoji)**

Append to `PaperGroup.test.tsx`:

```tsx
  it('does not render emoji chevrons ▲ or ▼', () => {
    const { container } = render(
      <PaperGroup group={group} expanded={false} onToggleExpand={vi.fn()} onRemoveItem={vi.fn()} selectedIds={new Set()} onToggleSelect={vi.fn()} />
    )
    expect(container.textContent).not.toContain('▲')
    expect(container.textContent).not.toContain('▼')
  })

  it('renders folder icon svg in header', () => {
    const { container } = render(
      <PaperGroup group={group} expanded={false} onToggleExpand={vi.fn()} onRemoveItem={vi.fn()} selectedIds={new Set()} onToggleSelect={vi.fn()} />
    )
    expect(container.querySelector('svg')).toBeTruthy()
  })
```

- [ ] **Step 2: Run tests to see new ones fail**

```bash
cd research-kit/extension && npx vitest run --reporter=verbose src/sidebar/components/atoms/PaperGroup.test.tsx
```

Expected: 2 new tests FAIL (emoji ▼ found, no SVG found).

- [ ] **Step 3: Replace `PaperGroup.tsx`**

```tsx
import type { PaperGroup as PaperGroupType } from '../../selectors/inbox'
import type { InboxItem } from '../../../shared/verify-types'
import { StatusBadge } from './StatusBadge'
import { Checkbox } from './Checkbox'

interface PaperGroupProps {
  group: PaperGroupType
  expanded: boolean
  onToggleExpand: (key: string) => void
  onRemoveItem: (id: string) => void
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
}

function FolderIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function ChevronUp() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  )
}

function ChevronDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

export function PaperGroup({ group, expanded, onToggleExpand, onRemoveItem, selectedIds, onToggleSelect }: PaperGroupProps) {
  return (
    <div
      className="overflow-hidden bg-[var(--rk-surface)]"
      style={{
        border: '1px solid var(--rk-border-warm)',
        borderRadius: 12,
        boxShadow: 'var(--rk-shadow-sm)',
      }}
    >
      <button
        aria-label="expand group"
        onClick={() => onToggleExpand(group.groupKey)}
        className="w-full flex items-center justify-between px-3 py-3 text-left transition-colors hover:bg-[var(--rk-surface-warm)]"
        style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.04), rgba(37,99,235,0.04))' }}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div style={{
            width: 28, height: 28, borderRadius: 8, flexShrink: 0,
            background: 'var(--rk-brand-gradient)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <FolderIcon />
          </div>
          <div className="min-w-0">
            <span className="block truncate" style={{ fontSize: 12, fontWeight: 600, color: 'var(--rk-text-brand)' }}>
              {group.paperTitle}
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              <span style={{ fontSize: 10, color: 'var(--rk-brand)', fontWeight: 500 }}>
                {group.claims.length} claim{group.claims.length !== 1 ? 's' : ''}
              </span>
              {group.hasUnknownDoi && (
                <span className="text-xs text-[var(--rk-yellow)] bg-[var(--rk-yellow-subtle)] px-1.5 py-0.5 rounded-full">No DOI</span>
              )}
              {group.hasAbstractOnly && (
                <span className="text-xs text-[var(--rk-blue)] bg-[var(--rk-blue-subtle)] px-1.5 py-0.5 rounded-full">Abstract only</span>
              )}
            </div>
          </div>
        </div>
        <span style={{ color: 'var(--rk-brand)', marginLeft: 8, flexShrink: 0 }}>
          {expanded ? <ChevronUp /> : <ChevronDown />}
        </span>
      </button>

      {expanded && (
        <ul className="divide-y divide-[var(--rk-border-warm)]">
          {group.claims.map((item: InboxItem) => (
            <li key={item.id} className="flex items-start gap-2 px-3 py-3 bg-[var(--rk-surface)]">
              <Checkbox
                checked={selectedIds.has(item.id)}
                onChange={() => onToggleSelect(item.id)}
              />
              <div className="flex-1 min-w-0">
                <p className="text-[var(--rk-text)] line-clamp-2" style={{ fontSize: 13 }}>{item.text}</p>
                <div className="flex items-center gap-2 mt-1">
                  <StatusBadge status={item.status} />
                  <span className="text-xs text-[var(--rk-text-3)]">{item.site}</span>
                </div>
              </div>
              <button
                aria-label="remove"
                onClick={() => onRemoveItem(item.id)}
                className="shrink-0 text-xs text-[var(--rk-text-3)] hover:text-[var(--rk-red)] p-1"
              >✕</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run all PaperGroup tests**

```bash
cd research-kit/extension && npx vitest run --reporter=verbose src/sidebar/components/atoms/PaperGroup.test.tsx
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/sidebar/components/atoms/PaperGroup.tsx research-kit/extension/src/sidebar/components/atoms/PaperGroup.test.tsx
git commit -m "feat: PaperGroup — warm border, gradient folder icon, SVG chevrons, Checkbox atom"
```

---

## Task 6: ConflictResolutionPanel.tsx — full brand redesign

**Files:**
- Modify: `research-kit/extension/src/sidebar/components/atoms/ConflictResolutionPanel.tsx`

No existing test file for this component — skip TDD, implement directly (purely visual, no logic change).

- [ ] **Step 1: Replace `ConflictResolutionPanel.tsx`**

```tsx
import { useState } from 'react'
import type { Conflict, ResolutionPayload } from '../../../shared/types'

interface Props {
  conflict: Conflict
  onResolve(p: ResolutionPayload): Promise<void>
  onSuggest(): Promise<void>
}

function LightningIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}

export function ConflictResolutionPanel({ conflict, onResolve, onSuggest }: Props) {
  const [busy, setBusy] = useState(false)
  const suggestion = (() => {
    if (!conflict.resolution) return null
    try { return JSON.parse(conflict.resolution) } catch { return null }
  })()

  return (
    <div
      className="overflow-hidden"
      style={{
        border: '1px solid var(--rk-border-warm)',
        borderRadius: 12,
        boxShadow: 'var(--rk-shadow-sm)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2.5"
        style={{
          background: 'linear-gradient(135deg, rgba(124,58,237,0.06), rgba(37,99,235,0.06))',
          borderBottom: '1px solid var(--rk-border-warm)',
        }}
      >
        <div style={{
          width: 22, height: 22, borderRadius: 6, flexShrink: 0,
          background: 'var(--rk-brand-gradient)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <LightningIcon />
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--rk-text-brand)' }}>
          Conflict · {conflict.paper_title ?? conflict.group_key}
        </span>
      </div>

      {/* Diff grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
        {conflict.sides.map((s, i) => (
          <div
            key={s.claim_id}
            style={{
              padding: '10px 12px',
              borderRight: i === 0 ? '1px solid var(--rk-border-warm)' : undefined,
            }}
          >
            <div style={{
              fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '.05em', color: 'var(--rk-brand)', marginBottom: 4,
            }}>
              {s.label}
            </div>
            <p style={{ fontSize: 11, color: 'var(--rk-text)', lineHeight: 1.5, marginBottom: 8 }}>
              {s.quote}
            </p>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try { await onResolve({ kind: 'accept_side', side_id: s.claim_id }) }
                finally { setBusy(false) }
              }}
              style={{
                fontSize: 10, padding: '3px 10px',
                background: 'var(--rk-brand-gradient)',
                color: 'white', borderRadius: 99, border: 'none',
                fontWeight: 600, opacity: busy ? 0.5 : 1,
                cursor: busy ? 'not-allowed' : 'pointer',
              }}
            >
              Accept →
            </button>
          </div>
        ))}
      </div>

      {/* Suggestion footer */}
      <div style={{
        padding: '8px 12px',
        borderTop: '1px solid var(--rk-border-warm)',
        background: 'var(--rk-surface-warm)',
      }}>
        {suggestion?.kind === 'suggestion' ? (
          <div>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--rk-text-brand)' }}>Suggestion: </span>
            <span style={{ fontSize: 11, color: 'var(--rk-text-2)' }}>{suggestion.text}</span>
          </div>
        ) : (
          <button
            disabled={busy}
            onClick={async () => { setBusy(true); try { await onSuggest() } finally { setBusy(false) } }}
            style={{
              fontSize: 10, padding: '4px 12px',
              background: 'white', color: 'var(--rk-brand)',
              border: '1px solid var(--rk-border-warm)',
              borderRadius: 99, fontWeight: 600,
              opacity: busy ? 0.5 : 1,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            ✦ Get AI Suggestion
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd research-kit/extension && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add research-kit/extension/src/sidebar/components/atoms/ConflictResolutionPanel.tsx
git commit -m "feat: ConflictResolutionPanel — full brand redesign with diff grid and AI suggestion footer"
```

---

## Task 7: ClaimCard.tsx — hover lift + typography

**Files:**
- Modify: `research-kit/extension/src/sidebar/components/atoms/ClaimCard.tsx`
- Test: `research-kit/extension/src/sidebar/components/atoms/ClaimCard.test.tsx`

- [ ] **Step 1: Add failing test for hover state**

Append to `ClaimCard.test.tsx` (add necessary imports if missing — `fireEvent` from `@testing-library/react`):

```tsx
  it('applies lift style on mouse enter', () => {
    const claim = makeClaim('verified')  // use whatever helper the test file already defines
    const { container } = render(
      <ClaimCard claim={claim} expanded={false} onToggleExpand={vi.fn()} onSave={vi.fn()} />
    )
    const card = container.firstChild as HTMLElement
    fireEvent.mouseEnter(card)
    expect(card.style.transform).toBe('translateY(-2px)')
  })
```

> Note: read `ClaimCard.test.tsx` first to find the existing claim factory function name and use it here.

- [ ] **Step 2: Run to verify failure**

```bash
cd research-kit/extension && npx vitest run --reporter=verbose src/sidebar/components/atoms/ClaimCard.test.tsx
```

Expected: new test FAIL — transform not set.

- [ ] **Step 3: Update `ClaimCard.tsx` outer div**

Add `useState` import, add `hovered` state, and update the outer `<div>`:

```tsx
// At top of component, after other useState calls:
const [hovered, setHovered] = useState(false)
```

Change the outer `<div>`:
```tsx
<div
  className="w-full shrink-0 bg-[var(--rk-surface)] overflow-hidden"
  onMouseEnter={() => setHovered(true)}
  onMouseLeave={() => setHovered(false)}
  style={{
    border: `1px solid ${hovered ? '#c4b5fd' : 'var(--rk-border-warm)'}`,
    borderLeftWidth: 3,
    borderLeftColor: accentColor,
    borderRadius: 'var(--rk-r-md)',
    boxShadow: hovered ? '0 6px 16px rgba(124,58,237,0.14)' : 'var(--rk-shadow-sm)',
    transform: hovered ? 'translateY(-2px)' : 'none',
    transition: 'transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease',
  }}
>
```

- [ ] **Step 4: Fix typography in `ClaimCard.tsx`**

Find and update:
- Claim text `<p>`: change `className="text-sm ..."` → add `style={{ fontSize: 13 }}` (keep other classes)
- Paper title `<p>`: change `style={{ color: 'var(--rk-brand)', fontSize: 9 }}` → `style={{ color: 'var(--rk-brand)', fontSize: 10, fontWeight: 500 }}`

- [ ] **Step 5: Run all ClaimCard tests**

```bash
cd research-kit/extension && npx vitest run --reporter=verbose src/sidebar/components/atoms/ClaimCard.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add research-kit/extension/src/sidebar/components/atoms/ClaimCard.tsx research-kit/extension/src/sidebar/components/atoms/ClaimCard.test.tsx
git commit -m "feat: ClaimCard — hover lift animation + typography normalization"
```

---

## Task 8: VerifyTab.tsx — skeleton shimmer + stagger + branded empty state

**Files:**
- Modify: `research-kit/extension/src/sidebar/components/tabs/VerifyTab.tsx`
- Test: `research-kit/extension/src/sidebar/components/tabs/VerifyTab.test.tsx`

- [ ] **Step 1: Add failing tests**

Append to `VerifyTab.test.tsx`:

```tsx
  it('shows skeleton cards instead of spinner when isDetecting', () => {
    const { container } = render(
      <VerifyTab claims={[]} expandedIds={new Set()} onToggleExpand={vi.fn()} onSave={vi.fn()} isDetecting={true} />
    )
    // skeleton cards have animate-shimmer class
    expect(container.querySelector('.animate-shimmer')).toBeTruthy()
    // no spinner ring
    expect(container.querySelector('.animate-spinRing')).toBeNull()
  })

  it('shows branded empty state when no claims and not detecting', () => {
    render(
      <VerifyTab claims={[]} expandedIds={new Set()} onToggleExpand={vi.fn()} onSave={vi.fn()} isDetecting={false} />
    )
    expect(screen.getByText('No claims yet')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run to see failures**

```bash
cd research-kit/extension && npx vitest run --reporter=verbose src/sidebar/components/tabs/VerifyTab.test.tsx
```

Expected: 2 new tests FAIL.

- [ ] **Step 3: Add `SkeletonCard` function inside `VerifyTab.tsx`** (before the `VerifyTab` component function):

```tsx
function SkeletonCard() {
  const shimmerStyle: React.CSSProperties = {
    background: 'linear-gradient(90deg, #f0e8ff 25%, #e9d5ff 50%, #f0e8ff 75%)',
    backgroundSize: '800px 100%',
    borderRadius: 6,
  }
  return (
    <div style={{ border: '1px solid var(--rk-border-warm)', borderRadius: 10, padding: 12 }}>
      <div className="animate-shimmer" style={{ ...shimmerStyle, height: 10, marginBottom: 8, width: '100%' }} />
      <div className="animate-shimmer" style={{ ...shimmerStyle, height: 10, marginBottom: 10, width: '60%' }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <div className="animate-shimmer" style={{ ...shimmerStyle, height: 18, width: 56, borderRadius: 99 }} />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Replace detecting state block in `VerifyTab.tsx`**

Find and replace the `if (isDetecting)` return block:

```tsx
  if (isDetecting) {
    return (
      <div className="flex flex-col gap-2 p-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    )
  }
```

- [ ] **Step 5: Replace "no claims" empty state**

Find and replace the `if (claims.length === 0)` return block:

```tsx
  if (claims.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
        <div style={{
          width: 48, height: 48, borderRadius: 14,
          background: 'linear-gradient(135deg, rgba(124,58,237,0.12), rgba(37,99,235,0.12))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--rk-brand)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--rk-text-brand)' }}>No claims yet</p>
        <p style={{ fontSize: 12, color: 'var(--rk-text-3)', lineHeight: 1.5 }}>
          Open Elicit, SciSpace or Consensus and run a search to start.
        </p>
      </div>
    )
  }
```

- [ ] **Step 6: Add stagger animation to claim list**

In the `filtered.map(...)` section, wrap each `<ClaimCard>` in a stagger div:

```tsx
{filtered.map((claim, index) => (
  <div
    key={claim.id}
    className="animate-staggerIn"
    style={{ animationDelay: `${index * 60}ms` }}
  >
    <ClaimCard
      claim={claim}
      expanded={expandedIds.has(claim.id)}
      onToggleExpand={onToggleExpand}
      onSave={onSave}
      savePending={savingIds.has(claim.id)}
      onUploadPdf={handleUploadPdf}
      uploadPending={uploadingIds.has(claim.id)}
      liveStep={liveStepsByClaim.get(claim.id)?.step}
      liveDetail={liveStepsByClaim.get(claim.id)?.detail}
    />
  </div>
))}
```

> Remove the `key={claim.id}` from `<ClaimCard>` — it's now on the wrapper `<div>`.

- [ ] **Step 7: Run all VerifyTab tests**

```bash
cd research-kit/extension && npx vitest run --reporter=verbose src/sidebar/components/tabs/VerifyTab.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add research-kit/extension/src/sidebar/components/tabs/VerifyTab.tsx research-kit/extension/src/sidebar/components/tabs/VerifyTab.test.tsx
git commit -m "feat: VerifyTab — skeleton shimmer loading state, stagger animation, branded empty state"
```

---

## Task 9: InboxTab.tsx — branded empty state

**Files:**
- Modify: `research-kit/extension/src/sidebar/components/tabs/InboxTab.tsx`
- Test: `research-kit/extension/src/sidebar/components/tabs/InboxTab.test.tsx`

- [ ] **Step 1: Add failing test**

Append to `InboxTab.test.tsx`:

```tsx
  it('shows branded empty state with title when inbox is empty', () => {
    render(
      <InboxTab items={[]} selectedIds={new Set()} onToggleSelect={vi.fn()} onArchive={vi.fn()} onAddToProject={vi.fn()} onClearSelection={vi.fn()} />
    )
    expect(screen.getByText('Inbox is empty')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run to see it fail**

```bash
cd research-kit/extension && npx vitest run --reporter=verbose src/sidebar/components/tabs/InboxTab.test.tsx
```

Expected: new test FAIL — "Inbox is empty" not found.

- [ ] **Step 3: Replace empty state block in `InboxTab.tsx`**

Find and replace the `if (items.length === 0)` return block:

```tsx
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
        <div style={{
          width: 48, height: 48, borderRadius: 14,
          background: 'linear-gradient(135deg, rgba(124,58,237,0.12), rgba(37,99,235,0.12))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--rk-brand)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
            <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
          </svg>
        </div>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--rk-text-brand)' }}>Inbox is empty</p>
        <p style={{ fontSize: 12, color: 'var(--rk-text-3)', lineHeight: 1.5 }}>
          Verified claims will appear here for review and organization.
        </p>
      </div>
    )
  }
```

- [ ] **Step 4: Run all InboxTab tests**

```bash
cd research-kit/extension && npx vitest run --reporter=verbose src/sidebar/components/tabs/InboxTab.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/sidebar/components/tabs/InboxTab.tsx research-kit/extension/src/sidebar/components/tabs/InboxTab.test.tsx
git commit -m "feat: InboxTab — branded empty state with inbox icon"
```

---

## Task 10: ConflictsTab.tsx — branded empty state

**Files:**
- Modify: `research-kit/extension/src/sidebar/components/tabs/ConflictsTab.tsx`
- Test: `research-kit/extension/src/sidebar/components/tabs/ConflictsTab.test.tsx`

- [ ] **Step 1: Add failing test**

Append to `ConflictsTab.test.tsx`:

```tsx
  it('shows branded empty state with title when no conflicts', () => {
    render(<ConflictsTab conflicts={[]} onResolve={vi.fn()} onSuggest={vi.fn()} />)
    expect(screen.getByText('No conflicts')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run to see it fail**

```bash
cd research-kit/extension && npx vitest run --reporter=verbose src/sidebar/components/tabs/ConflictsTab.test.tsx
```

Expected: new test FAIL.

- [ ] **Step 3: Replace empty state in `ConflictsTab.tsx`**

Find the `conflicts.length === 0` block and replace with:

```tsx
      {conflicts.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
          <div style={{
            width: 48, height: 48, borderRadius: 14,
            background: 'linear-gradient(135deg, rgba(124,58,237,0.12), rgba(37,99,235,0.12))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--rk-brand)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--rk-text-brand)' }}>No conflicts</p>
          <p style={{ fontSize: 12, color: 'var(--rk-text-3)', lineHeight: 1.5 }}>
            Conflicting claims from different sources will appear here.
          </p>
        </div>
      )}
```

- [ ] **Step 4: Run all ConflictsTab tests**

```bash
cd research-kit/extension && npx vitest run --reporter=verbose src/sidebar/components/tabs/ConflictsTab.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/sidebar/components/tabs/ConflictsTab.tsx research-kit/extension/src/sidebar/components/tabs/ConflictsTab.test.tsx
git commit -m "feat: ConflictsTab — branded empty state with lightning icon"
```

---

## Task 11: DraftTab.tsx — Checkbox atom + empty state

**Files:**
- Modify: `research-kit/extension/src/sidebar/components/tabs/DraftTab.tsx`
- Test: `research-kit/extension/src/sidebar/components/tabs/DraftTab.test.tsx`

- [ ] **Step 1: Add failing test for Checkbox in claim selector**

Append to `DraftTab.test.tsx`:

```tsx
  it('renders custom checkboxes (not native input[type=checkbox]) in claim selector', () => {
    // populate store with inbox items if needed — check existing test setup in this file
    const { container } = render(<DraftTab />)
    // native inputs should be gone; custom checkbox buttons with role=checkbox remain
    const nativeCheckboxes = container.querySelectorAll('input[type="checkbox"]')
    expect(nativeCheckboxes.length).toBe(0)
  })
```

> Note: read `DraftTab.test.tsx` first to understand its store mock setup, and adapt the render call accordingly.

- [ ] **Step 2: Run to see failure**

```bash
cd research-kit/extension && npx vitest run --reporter=verbose src/sidebar/components/tabs/DraftTab.test.tsx
```

Expected: new test FAIL (native checkboxes found).

- [ ] **Step 3: Add `Checkbox` import and replace native checkbox in `DraftTab.tsx`**

Add import at top:
```tsx
import { Checkbox } from '../atoms/Checkbox'
```

Find the claim selector `<label>` block with `<input type="checkbox">` and replace:
```tsx
// Before:
<input
  type="checkbox"
  checked={selected.has(i.id)}
  onChange={() => toggle(i.id)}
  style={{ accentColor: 'var(--rk-brand)', marginTop: 2, flexShrink: 0 }}
/>

// After:
<Checkbox
  checked={selected.has(i.id)}
  onChange={() => toggle(i.id)}
/>
```

- [ ] **Step 4: Verify empty draft output state icon color**

In the empty output state block (when `!markdown`), find the icon `stroke` color and ensure it is `var(--rk-brand)` not hardcoded. The existing code already has `stroke="var(--rk-brand)"` — no change needed if so.

- [ ] **Step 5: Run all DraftTab tests**

```bash
cd research-kit/extension && npx vitest run --reporter=verbose src/sidebar/components/tabs/DraftTab.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add research-kit/extension/src/sidebar/components/tabs/DraftTab.tsx research-kit/extension/src/sidebar/components/tabs/DraftTab.test.tsx
git commit -m "feat: DraftTab — replace native checkbox with Checkbox atom"
```

---

## Task 12: TabBar.tsx — active label font-weight

**Files:**
- Modify: `research-kit/extension/src/sidebar/components/shell/TabBar.tsx`
- Test: `research-kit/extension/src/sidebar/components/shell/TabBar.test.tsx`

- [ ] **Step 1: Add failing test for active label weight**

Append to `TabBar.test.tsx`:

```tsx
  it('renders active tab label with bold font weight', () => {
    const { container } = render(<TabBar activeTab="verify" onSelect={vi.fn()} />)
    // Find the active button
    const activeBtn = container.querySelector('[aria-selected="true"]')
    const label = activeBtn?.querySelector('span')
    expect(label).toHaveStyle({ fontWeight: '700' })
  })
```

- [ ] **Step 2: Run to see failure**

```bash
cd research-kit/extension && npx vitest run --reporter=verbose src/sidebar/components/shell/TabBar.test.tsx
```

Expected: new test FAIL — fontWeight not 700.

- [ ] **Step 3: Update label `<span>` in `TabBar.tsx`**

Find the `<span>{tab.label}</span>` line inside the tab button and replace:

```tsx
<span style={isActive ? { fontWeight: 700 } : undefined}>{tab.label}</span>
```

- [ ] **Step 4: Run all TabBar tests**

```bash
cd research-kit/extension && npx vitest run --reporter=verbose src/sidebar/components/shell/TabBar.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add research-kit/extension/src/sidebar/components/shell/TabBar.tsx research-kit/extension/src/sidebar/components/shell/TabBar.test.tsx
git commit -m "feat: TabBar — active tab label font-weight 700"
```

---

## Task 13: Final build verification

**Files:** none modified

- [ ] **Step 1: Run full build**

```bash
cd research-kit/extension && npm run build
```

Expected output: `✓ built in <N>ms` — no TypeScript errors, no red lines.

- [ ] **Step 2: Run all tests**

```bash
cd research-kit/extension && npx vitest run --reporter=verbose
```

Expected: all test suites PASS, 0 failures.

- [ ] **Step 3: Final commit if any last fixups were made**

```bash
git add -A
git commit -m "fix: post-build cleanup" # only if needed
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Covered by task |
|---|---|
| tokens.css: shimmer/staggerIn/toastSlide keyframes | Task 1 |
| Checkbox.tsx — new atom, brand gradient, disabled | Task 2 |
| StatusBadge — pending→brand, inaccessible→Locked | Task 3 |
| Toast — SVG icons + slide-in animation | Task 4 |
| PaperGroup — warm border, folder icon, SVG chevrons, Checkbox | Task 5 |
| ConflictResolutionPanel — full redesign | Task 6 |
| ClaimCard — hover lift + typography | Task 7 |
| VerifyTab — skeleton shimmer + stagger + empty state | Task 8 |
| InboxTab — branded empty state | Task 9 |
| ConflictsTab — branded empty state | Task 10 |
| DraftTab — Checkbox + empty state | Task 11 |
| TabBar — active label font-weight | Task 12 |

All spec sections covered. No gaps.
