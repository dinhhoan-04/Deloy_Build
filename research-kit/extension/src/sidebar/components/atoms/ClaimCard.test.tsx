import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ClaimCard } from './ClaimCard'
import type { ClaimItem } from '../../../shared/verify-types'

const fakeClaim: ClaimItem = {
  id: 'c1', text: 'Sleep improves memory consolidation.',
  paperTitle: 'Why We Sleep', doi: '10.1/ws', paperUrl: null,
  page: 'p.42', site: 'elicit', status: 'verified', confidence: 0.92,
  quote: 'Sleep...consolidation.', reason: 'Exact match found',
  saved: false, domAnchor: '', tabId: 1, pageUrl: '', extractedAt: 0,
}

describe('ClaimCard', () => {
  it('renders claim text', () => {
    render(<ClaimCard claim={fakeClaim} expanded={false} onToggleExpand={vi.fn()} onSave={vi.fn()} />)
    expect(screen.getByText(/Sleep improves memory/)).toBeInTheDocument()
  })

  it('shows StatusBadge', () => {
    render(<ClaimCard claim={fakeClaim} expanded={false} onToggleExpand={vi.fn()} onSave={vi.fn()} />)
    expect(screen.getByText('Verified')).toBeInTheDocument()
  })

  it('shows paper title', () => {
    render(<ClaimCard claim={fakeClaim} expanded={false} onToggleExpand={vi.fn()} onSave={vi.fn()} />)
    expect(screen.getByText('Why We Sleep')).toBeInTheDocument()
  })

  it('calls onToggleExpand when header clicked', () => {
    const fn = vi.fn()
    render(<ClaimCard claim={fakeClaim} expanded={false} onToggleExpand={fn} onSave={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /expand/i }))
    expect(fn).toHaveBeenCalledWith('c1')
  })

  it('shows quote and reason when expanded', () => {
    render(<ClaimCard claim={fakeClaim} expanded={true} onToggleExpand={vi.fn()} onSave={vi.fn()} />)
    expect(screen.getByText(/Sleep...consolidation/)).toBeInTheDocument()
    expect(screen.getByText(/Exact match/)).toBeInTheDocument()
  })

  it('calls onSave when save button clicked', () => {
    const fn = vi.fn()
    render(<ClaimCard claim={fakeClaim} expanded={true} onToggleExpand={vi.fn()} onSave={fn} />)
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(fn).toHaveBeenCalledWith('c1')
  })

  it('applies lift style on mouse enter', () => {
    const { container } = render(
      <ClaimCard claim={fakeClaim} expanded={false} onToggleExpand={vi.fn()} onSave={vi.fn()} />
    )
    const card = container.firstChild as HTMLElement
    fireEvent.mouseEnter(card)
    expect(card.style.transform).toBe('translateY(-2px)')
  })
})
