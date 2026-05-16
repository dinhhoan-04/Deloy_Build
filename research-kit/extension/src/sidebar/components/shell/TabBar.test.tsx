import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TabBar } from './TabBar'

describe('TabBar', () => {
  it('renders all 6 tab buttons', () => {
    render(<TabBar activeTab="verify" onSelect={vi.fn()} />)
    expect(screen.getByRole('tab', { name: /verify/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /inbox/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /conflicts/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /chat/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /draft/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /help/i })).toBeInTheDocument()
  })

  it('marks active tab as selected', () => {
    render(<TabBar activeTab="inbox" onSelect={vi.fn()} />)
    expect(screen.getByRole('tab', { name: /inbox/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /verify/i })).toHaveAttribute('aria-selected', 'false')
  })

  it('calls onSelect when a tab is clicked', () => {
    const fn = vi.fn()
    render(<TabBar activeTab="verify" onSelect={fn} />)
    fireEvent.click(screen.getByRole('tab', { name: /inbox/i }))
    expect(fn).toHaveBeenCalledWith('inbox')
  })

  it('shows badge when inboxCount > 0', () => {
    render(<TabBar activeTab="verify" onSelect={vi.fn()} inboxCount={3} />)
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('renders active tab label with bold font weight', () => {
    const { container } = render(<TabBar activeTab="verify" onSelect={vi.fn()} />)
    const activeBtn = container.querySelector('[aria-selected="true"]')
    const label = activeBtn?.querySelector('span')
    expect(label).toHaveStyle({ fontWeight: '700' })
  })
})
