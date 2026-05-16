import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConflictsTab } from './ConflictsTab'
import { useStore } from '../../state/useStore'
import type { Conflict } from '../../../shared/types'

const fakeConflict = (id: string, paper_title: string = 'Paper A', doi: string | null = '10.1/a'): Conflict => ({
  id, doi, group_key: doi || paper_title, paper_title,
  flagged_at: new Date().toISOString(), project_id: 'p_default',
  resolution: null,
  sides: [
    { claim_id: `${id}_elicit`, label: 'elicit', quote: `Claim ${id} from Elicit` },
    { claim_id: `${id}_scispace`, label: 'scispace', quote: `Claim ${id} from SciSpace` },
  ],
})

describe('ConflictsTab', () => {
  beforeEach(() => {
    useStore.setState({
      conflictCheckStatus: { data: null, status: 'idle' } as any,
    })
  })

  it('renders empty state when no conflicts', () => {
    render(<ConflictsTab conflicts={[]} onConfirm={vi.fn()} onSuggest={vi.fn()} />)
    expect(screen.getByText(/no conflicts/i)).toBeInTheDocument()
  })

  it('renders conflict items', () => {
    render(<ConflictsTab conflicts={[fakeConflict('conf1')]} onConfirm={vi.fn()} onSuggest={vi.fn()} />)
    expect(screen.getByText(/paper a/i)).toBeInTheDocument()
  })

  it('shows both sides of conflict', () => {
    render(<ConflictsTab conflicts={[fakeConflict('conf1')]} onConfirm={vi.fn()} onSuggest={vi.fn()} />)
    expect(screen.getAllByText(/elicit|scispace/i).length).toBeGreaterThanOrEqual(2)
  })

  it('calls onConfirm when Confirm clicked after selecting a side', () => {
    const fn = vi.fn().mockResolvedValue(undefined)
    render(<ConflictsTab conflicts={[fakeConflict('conf1')]} onConfirm={fn} onSuggest={vi.fn()} />)
    fireEvent.click(screen.getByText('Claim conf1 from Elicit'))
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    expect(fn).toHaveBeenCalledWith('conf1', 'conf1_elicit')
  })

  it('renders ConflictsCheckHeader pending state when pending_count > 0', () => {
    useStore.setState({
      conflictCheckStatus: {
        data: { last_checked_at: null, pending_count: 2 },
        status: 'ready', lastFetched: Date.now(),
      } as any,
    })
    render(<ConflictsTab conflicts={[]} onConfirm={vi.fn()} onSuggest={vi.fn()} />)
    expect(screen.getByText(/checking 2 claims/i)).toBeInTheDocument()
  })

  it('renders ConflictsCheckHeader last-checked when pending=0 and timestamp set', () => {
    useStore.setState({
      conflictCheckStatus: {
        data: { last_checked_at: new Date(Date.now() - 60_000).toISOString(), pending_count: 0 },
        status: 'ready', lastFetched: Date.now(),
      } as any,
    })
    render(<ConflictsTab conflicts={[]} onConfirm={vi.fn()} onSuggest={vi.fn()} />)
    expect(screen.getByText(/last checked.*ago/i)).toBeInTheDocument()
  })
})
