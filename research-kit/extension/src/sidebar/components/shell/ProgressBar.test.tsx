import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProgressBar } from './ProgressBar'
import type { VerifyProgress } from '../../../shared/verify-types'

const prog = (overrides: Partial<VerifyProgress> = {}): VerifyProgress => ({
  tabId: 1, total: 10, completed: 4, running: 2, paused: false, pausedSites: [],
  perSite: { elicit: { total: 3, completed: 1, running: 1 }, scispace: { total: 4, completed: 2, running: 1 }, consensus: { total: 3, completed: 1, running: 0 } },
  ...overrides,
})

describe('ProgressBar', () => {
  it('shows progress fraction', () => {
    render(<ProgressBar progress={prog()} onTogglePause={vi.fn()} />)
    expect(screen.getByText('4 / 10')).toBeInTheDocument()
  })

  it('shows pause button when running', () => {
    render(<ProgressBar progress={prog({ perSite: { elicit: { total: 3, completed: 1, running: 1 }, scispace: { total: 0, completed: 0, running: 0 }, consensus: { total: 0, completed: 0, running: 0 } } })} onTogglePause={vi.fn()} />)
    expect(screen.getByText(/pause/i)).toBeInTheDocument()
  })

  it('shows resume button when paused', () => {
    render(<ProgressBar progress={prog({ paused: true, perSite: { elicit: { total: 3, completed: 1, running: 1 }, scispace: { total: 0, completed: 0, running: 0 }, consensus: { total: 0, completed: 0, running: 0 } } })} onTogglePause={vi.fn()} />)
    expect(screen.getByText(/resume/i)).toBeInTheDocument()
  })

  it('calls onTogglePause when pause clicked', () => {
    const fn = vi.fn()
    render(<ProgressBar progress={prog({ perSite: { elicit: { total: 3, completed: 1, running: 1 }, scispace: { total: 0, completed: 0, running: 0 }, consensus: { total: 0, completed: 0, running: 0 } } })} onTogglePause={fn} />)
    // The pause button uses aria-label="pause"
    const pauseBtn = screen.getByLabelText('pause')
    fireEvent.click(pauseBtn)
    expect(fn).toHaveBeenCalled()
  })

  it('shows "Done" when completed equals total', () => {
    render(<ProgressBar progress={prog({ total: 5, completed: 5, running: 0 })} onTogglePause={vi.fn()} />)
    expect(screen.getByText(/done/i)).toBeInTheDocument()
  })

  it('renders null when total is 0', () => {
    const { container } = render(<ProgressBar progress={prog({ total: 0 })} onTogglePause={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders per-site chips when multiple sites have claims', () => {
    const p = prog({ perSite: {
      elicit: { total: 3, completed: 1, running: 1 },
      scispace: { total: 4, completed: 2, running: 1 },
      consensus: { total: 0, completed: 0, running: 0 },
    }})
    render(<ProgressBar progress={p} onTogglePause={vi.fn()} />)
    expect(screen.getByLabelText(/pause elicit/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/pause scispace/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/pause consensus/i)).toBeNull()
  })

  it('does not render per-site chips when only 1 site has claims', () => {
    const p = prog({ perSite: {
      elicit: { total: 3, completed: 1, running: 1 },
      scispace: { total: 0, completed: 0, running: 0 },
      consensus: { total: 0, completed: 0, running: 0 },
    }})
    render(<ProgressBar progress={p} onTogglePause={vi.fn()} />)
    expect(screen.queryByLabelText(/pause elicit/i)).toBeNull()
  })
})
