import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InboxTab } from './InboxTab'
import type { InboxItem } from '../../../shared/verify-types'

// FIX: Removed domAnchor, tabId, pageUrl, extractedAt from InboxItem factory
// (these don't exist in InboxItem interface - they're in ClaimItem)
// Added missing claimId and projectId properties required by InboxItem
const fakeInboxItem = (id: string, doi: string | null = '10.1/x', paperTitle: string = 'Paper A', status: 'partial' | 'verified' | 'not_found' = 'verified', archived_at: string | null = null): InboxItem => ({
  id, claimId: `claim-${id}`, text: `claim ${id}`, paperTitle, doi, paperUrl: null, status,
  page: 'p.1', site: 'elicit', confidence: 0.9, quote: null, reason: '',
  projectId: 'p_default', savedAtMs: Date.now(), archived_at,
})

const baseProps = {
  selectedIds: new Set<string>(),
  onToggleSelect: vi.fn(),
  onArchive: vi.fn(),
  onUnarchive: vi.fn(),
  onAddToProject: vi.fn(),
  onClearSelection: vi.fn(),
}

describe('InboxTab', () => {
  it('renders empty state when no items', () => {
    render(<InboxTab items={[]} {...baseProps} />)
    expect(screen.getByText(/No active claims/i)).toBeInTheDocument()
  })

  it('shows branded empty state with title when inbox is empty', () => {
    render(<InboxTab items={[]} {...baseProps} />)
    expect(screen.getByText(/No active claims/i)).toBeInTheDocument()
  })

  it('shows Active/Archived toggle buttons', () => {
    render(<InboxTab items={[]} {...baseProps} />)
    expect(screen.getByRole('button', { name: /active/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /archived/i })).toBeInTheDocument()
  })

  it('Active view shows only non-archived items count in archived badge', () => {
    const items = [
      fakeInboxItem('i1', '10.1/a', 'Paper A', 'verified', null),
      fakeInboxItem('i2', '10.1/b', 'Paper B', 'verified', '2026-05-15T00:00:00Z'),
    ]
    render(<InboxTab items={items} {...baseProps} />)
    expect(screen.getByRole('button', { name: /archived \(1\)/i })).toBeInTheDocument()
  })

  it('Archived view shows Unarchive button in bulk bar', () => {
    const items = [fakeInboxItem('i1', '10.1/a', 'Paper A', 'verified', '2026-05-15T00:00:00Z')]
    render(<InboxTab items={items} {...baseProps} selectedIds={new Set(['i1'])} />)
    fireEvent.click(screen.getByRole('button', { name: /archived/i }))
    expect(screen.getByRole('button', { name: /unarchive/i })).toBeInTheDocument()
  })

  it('renders grouped papers', () => {
    const items = [
      fakeInboxItem('i1', '10.1/a', 'Paper A'),
      fakeInboxItem('i2', '10.1/a', 'Paper A'),
      fakeInboxItem('i3', '10.1/b', 'Paper B'),
    ]
    render(<InboxTab items={items} {...baseProps} />)
    expect(screen.getByText('Paper A')).toBeInTheDocument()
    expect(screen.getByText('Paper B')).toBeInTheDocument()
  })

  it('toggles paper selection when checkbox clicked', () => {
    const fn = vi.fn()
    const items = [fakeInboxItem('i1', '10.1/a', 'Paper A')]
    render(<InboxTab items={items} {...baseProps} onToggleSelect={fn} />)
    // Expand group first to show checkbox
    fireEvent.click(screen.getByRole('button', { name: /expand group/i }))
    fireEvent.click(screen.getByRole('checkbox'))
    expect(fn).toHaveBeenCalledWith('i1')
  })

  it('shows action bar when items selected', () => {
    const items = [fakeInboxItem('i1', '10.1/a', 'Paper A')]
    render(<InboxTab items={items} {...baseProps} selectedIds={new Set(['i1'])} />)
    expect(screen.getByText(/1 selected/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^archive$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add to project/i })).toBeInTheDocument()
  })

  it('calls onArchive when archive button clicked', () => {
    const fn = vi.fn()
    const items = [fakeInboxItem('i1', '10.1/a', 'Paper A')]
    render(<InboxTab items={items} {...baseProps} selectedIds={new Set(['i1'])} onArchive={fn} />)
    fireEvent.click(screen.getByRole('button', { name: /^archive$/i }))
    expect(fn).toHaveBeenCalledWith(['i1'])
  })

  it('calls onAddToProject when add to project button clicked', () => {
    const fn = vi.fn()
    const items = [fakeInboxItem('i1', '10.1/a', 'Paper A')]
    render(<InboxTab items={items} {...baseProps} selectedIds={new Set(['i1'])} onAddToProject={fn} />)
    fireEvent.click(screen.getByRole('button', { name: /add to project/i }))
    expect(fn).toHaveBeenCalledWith(['i1'])
  })

  it('calls onClearSelection when clear button clicked', () => {
    const fn = vi.fn()
    const items = [fakeInboxItem('i1', '10.1/a', 'Paper A')]
    render(<InboxTab items={items} {...baseProps} selectedIds={new Set(['i1'])} onClearSelection={fn} />)
    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(fn).toHaveBeenCalled()
  })
})
