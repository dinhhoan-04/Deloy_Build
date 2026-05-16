import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PaperGroup } from './PaperGroup'
import type { PaperGroup as PaperGroupType } from '../../selectors/inbox'
import type { InboxItem } from '../../../shared/verify-types'

const fakeItem = (id: string): InboxItem => ({
  id, claimId: id, text: `claim ${id}`, paperTitle: 'X',
  doi: '10.1/x', paperUrl: null, page: '', site: 'elicit',
  status: 'verified', confidence: 0.9, quote: null, reason: '',
  projectId: 'p_default', savedAtMs: 0, archived_at: null,
})

const group: PaperGroupType = {
  groupKey: '10.1/x',
  doi: '10.1/x',
  paperTitle: 'Why We Sleep',
  claims: [fakeItem('a'), fakeItem('b')],
  hasUnknownDoi: false,
  hasAbstractOnly: false,
}

describe('PaperGroup', () => {
  it('renders paper title', () => {
    render(<PaperGroup group={group} expanded={false} onToggleExpand={vi.fn()} onRemoveItem={vi.fn()} selectedIds={new Set()} onToggleSelect={vi.fn()} />)
    expect(screen.getByText('Why We Sleep')).toBeInTheDocument()
  })

  it('renders claim count', () => {
    render(<PaperGroup group={group} expanded={false} onToggleExpand={vi.fn()} onRemoveItem={vi.fn()} selectedIds={new Set()} onToggleSelect={vi.fn()} />)
    expect(screen.getByText(/2/)).toBeInTheDocument()
  })

  it('calls onToggleExpand when header clicked', () => {
    const fn = vi.fn()
    render(<PaperGroup group={group} expanded={false} onToggleExpand={fn} onRemoveItem={vi.fn()} selectedIds={new Set()} onToggleSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /expand group/i }))
    expect(fn).toHaveBeenCalledWith('10.1/x')
  })

  it('shows claims list when expanded', () => {
    render(<PaperGroup group={group} expanded={true} onToggleExpand={vi.fn()} onRemoveItem={vi.fn()} selectedIds={new Set()} onToggleSelect={vi.fn()} />)
    expect(screen.getByText('claim a')).toBeInTheDocument()
    expect(screen.getByText('claim b')).toBeInTheDocument()
  })

  it('shows unknown DOI badge when hasUnknownDoi=true', () => {
    const g = { ...group, hasUnknownDoi: true }
    render(<PaperGroup group={g} expanded={false} onToggleExpand={vi.fn()} onRemoveItem={vi.fn()} selectedIds={new Set()} onToggleSelect={vi.fn()} />)
    expect(screen.getByText(/no doi/i)).toBeInTheDocument()
  })

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
})
