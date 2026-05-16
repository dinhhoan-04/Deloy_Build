import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Header } from './Header'

describe('Header', () => {
  // FIX: Updated tests to match simplified Header component (Phase 2 Foundation)
  // Removed verifyEnabled, globalPaused, onToggleVerify, currentSite props

  it('renders ResearchKit brand text', () => {
    render(<Header activeSites={new Set(['elicit', 'scispace', 'consensus'])} onToggleSite={vi.fn()} onOpenSettings={vi.fn()} />)
    expect(screen.getByText(/ResearchKit/i)).toBeInTheDocument()
  })

  it('calls onOpenSettings when settings button clicked', () => {
    const fn = vi.fn()
    render(<Header activeSites={new Set(['elicit', 'scispace', 'consensus'])} onToggleSite={vi.fn()} onOpenSettings={fn} />)
    fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    expect(fn).toHaveBeenCalled()
  })

  it('renders site pill for each site', () => {
    render(<Header activeSites={new Set(['elicit'])} onToggleSite={vi.fn()} onOpenSettings={vi.fn()} />)
    expect(screen.getByRole('button', { name: /toggle elicit/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /toggle scispace/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /toggle consensus/i })).toBeInTheDocument()
  })

  it('calls onToggleSite when site pill clicked', () => {
    const fn = vi.fn()
    render(<Header activeSites={new Set(['elicit', 'scispace', 'consensus'])} onToggleSite={fn} onOpenSettings={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /toggle elicit/i }))
    expect(fn).toHaveBeenCalledWith('elicit', false)
  })

  it('highlights active sites with blue styling', () => {
    render(<Header activeSites={new Set(['elicit'])} onToggleSite={vi.fn()} onOpenSettings={vi.fn()} />)
    const elicitBtn = screen.getByRole('button', { name: /toggle elicit/i })
    expect(elicitBtn).toHaveAttribute('aria-pressed', 'true')
    const scispacBtn = screen.getByRole('button', { name: /toggle scispace/i })
    expect(scispacBtn).toHaveAttribute('aria-pressed', 'false')
  })

  it('renders settings button', () => {
    render(<Header activeSites={new Set(['elicit'])} onToggleSite={vi.fn()} onOpenSettings={vi.fn()} />)
    expect(screen.getByRole('button', { name: /settings/i })).toBeInTheDocument()
  })
})
