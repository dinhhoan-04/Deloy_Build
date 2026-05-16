import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConflictsCheckHeader } from './ConflictsCheckHeader'

describe('ConflictsCheckHeader', () => {
  it('renders nothing when pending=0 and last_checked_at=null', () => {
    const { container } = render(
      <ConflictsCheckHeader status={{ last_checked_at: null, pending_count: 0 }} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders pending message when pending_count > 0', () => {
    render(
      <ConflictsCheckHeader status={{ last_checked_at: null, pending_count: 2 }} />,
    )
    expect(screen.getByText(/checking 2 claims/i)).toBeInTheDocument()
  })

  it('uses singular form when pending_count === 1', () => {
    render(
      <ConflictsCheckHeader status={{ last_checked_at: null, pending_count: 1 }} />,
    )
    expect(screen.getByText(/checking 1 claim\b/i)).toBeInTheDocument()
  })

  it('renders last-checked relative time when pending=0 and timestamp present', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    render(
      <ConflictsCheckHeader status={{ last_checked_at: fiveMinAgo, pending_count: 0 }} />,
    )
    expect(screen.getByText(/last checked.*ago/i)).toBeInTheDocument()
  })

  it('renders nothing when status is null', () => {
    const { container } = render(<ConflictsCheckHeader status={null} />)
    expect(container.firstChild).toBeNull()
  })
})
