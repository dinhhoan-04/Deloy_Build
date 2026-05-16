import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge } from './StatusBadge'

describe('StatusBadge', () => {
  it('shows "Verified" for verified status', () => {
    render(<StatusBadge status="verified" />)
    expect(screen.getByText('Verified')).toBeInTheDocument()
  })

  it('shows "Not Found" for not_found status', () => {
    render(<StatusBadge status="not_found" />)
    expect(screen.getByText('Not Found')).toBeInTheDocument()
  })

  it('shows "Partial" for partial status', () => {
    render(<StatusBadge status="partial" />)
    expect(screen.getByText('Partial')).toBeInTheDocument()
  })

  it('shows "⏳ Pending" with brand purple for pending status', () => {
    const { container } = render(<StatusBadge status="pending" />)
    expect(screen.getByText('⏳ Pending')).toBeInTheDocument()
    expect(container.firstChild).not.toHaveClass('text-[var(--rk-blue)]')
  })

  it('shows "🔒 Locked" for inaccessible status', () => {
    render(<StatusBadge status="inaccessible" />)
    expect(screen.getByText('🔒 Locked')).toBeInTheDocument()
  })
})
