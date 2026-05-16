import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SettingsPanel } from './SettingsPanel'
import type { SiteId } from '../../../shared/verify-types'

describe('SettingsPanel', () => {
  const activeSites: SiteId[] = ['elicit', 'scispace']

  it('renders site toggles for all sites', () => {
    // FIX: "Elicit" appears in both site label and toggle label, so use getAllByText
    render(<SettingsPanel activeSites={activeSites} provider="openai" onProviderChange={vi.fn()} onToggleSite={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getAllByText('Elicit').length).toBeGreaterThan(0)
    expect(screen.getAllByText('SciSpace').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Consensus').length).toBeGreaterThan(0)
  })

  it('shows active sites as checked', () => {
    render(<SettingsPanel activeSites={['elicit']} provider="openai" onProviderChange={vi.fn()} onToggleSite={vi.fn()} onClose={vi.fn()} />)
    const switches = screen.getAllByRole('switch')
    expect(switches[0]).toHaveAttribute('aria-checked', 'true')
  })

  it('shows inactive sites as unchecked', () => {
    render(<SettingsPanel activeSites={['elicit']} provider="openai" onProviderChange={vi.fn()} onToggleSite={vi.fn()} onClose={vi.fn()} />)
    const switches = screen.getAllByRole('switch')
    expect(switches[1]).toHaveAttribute('aria-checked', 'false')
    expect(switches[2]).toHaveAttribute('aria-checked', 'false')
  })

  it('calls onToggleSite when toggle clicked', () => {
    const fn = vi.fn()
    render(<SettingsPanel activeSites={['elicit']} provider="openai" onProviderChange={vi.fn()} onToggleSite={fn} onClose={vi.fn()} />)
    const switches = screen.getAllByRole('switch')
    fireEvent.click(switches[1])
    expect(fn).toHaveBeenCalledWith('scispace')
  })

  it('calls onClose when close button clicked', () => {
    const fn = vi.fn()
    render(<SettingsPanel activeSites={activeSites} provider="openai" onProviderChange={vi.fn()} onToggleSite={vi.fn()} onClose={fn} />)
    const closeButtons = screen.getAllByRole('button', { name: /close/i })
    fireEvent.click(closeButtons[1])
    expect(fn).toHaveBeenCalled()
  })

  it('renders as modal overlay', () => {
    render(<SettingsPanel activeSites={activeSites} provider="openai" onProviderChange={vi.fn()} onToggleSite={vi.fn()} onClose={vi.fn()} />)
    const container = screen.getByRole('heading', { name: /settings/i }).closest('.fixed')
    expect(container).toHaveClass('fixed')
  })
})
