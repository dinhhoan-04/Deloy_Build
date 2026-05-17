import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HelpTab } from './HelpTab'

describe('HelpTab', () => {
  it('renders help title', () => {
    render(<HelpTab />)
    expect(screen.getByText(/how to use researchkit/i)).toBeInTheDocument()
  })

  it('shows all feature sections', () => {
    render(<HelpTab />)
    // Component renders feature names as separate text nodes (icons are SVGs)
    expect(screen.getByText('Verify')).toBeInTheDocument()
    expect(screen.getByText('Inbox')).toBeInTheDocument()
    expect(screen.getByText('Conflicts')).toBeInTheDocument()
    expect(screen.getByText('Chat')).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()
  })
})
