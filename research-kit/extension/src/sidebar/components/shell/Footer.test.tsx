import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Footer } from './Footer'

describe('Footer', () => {
  it('renders project name', () => {
    render(<Footer
      projects={[{ id: 'p_default', name: 'Default Project' }]}
      currentProjectId="p_default"
      onSwitchProject={vi.fn()}
      onCreateProject={vi.fn()}
      onOpenDemo={vi.fn()}
      inboxSelectedCount={0}
      onClearSelection={vi.fn()}
    />)
    expect(screen.getByText('Default Project')).toBeInTheDocument()
  })

  it('shows selection count when items selected', () => {
    render(<Footer
      projects={[{ id: 'p_default', name: 'Default Project' }]}
      currentProjectId="p_default"
      onSwitchProject={vi.fn()}
      onCreateProject={vi.fn()}
      onOpenDemo={vi.fn()}
      inboxSelectedCount={3}
      onClearSelection={vi.fn()}
    />)
    expect(screen.getByText(/3 selected/i)).toBeInTheDocument()
  })

  it('calls onClearSelection when clear clicked', () => {
    const fn = vi.fn()
    render(<Footer
      projects={[{ id: 'p_default', name: 'Default Project' }]}
      currentProjectId="p_default"
      onSwitchProject={vi.fn()}
      onCreateProject={vi.fn()}
      onOpenDemo={vi.fn()}
      inboxSelectedCount={2}
      onClearSelection={fn}
    />)
    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(fn).toHaveBeenCalled()
  })
})
