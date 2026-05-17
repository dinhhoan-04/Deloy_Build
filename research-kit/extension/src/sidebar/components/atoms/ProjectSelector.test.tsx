import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProjectSelector } from './ProjectSelector'

const projects = [
  { id: 'p_default', name: 'Default Project' },
  { id: 'p_2', name: 'Climate Research' },
]

describe('ProjectSelector', () => {
  it('renders current project name', () => {
    render(<ProjectSelector projects={projects} currentId="p_default" onSwitch={vi.fn()} onCreate={vi.fn()} />)
    expect(screen.getByText('Default Project')).toBeInTheDocument()
  })

  it('shows dropdown when clicked', () => {
    render(<ProjectSelector projects={projects} currentId="p_default" onSwitch={vi.fn()} onCreate={vi.fn()} />)
    // Click the project button to open dropdown
    fireEvent.click(screen.getByText('Default Project'))
    expect(screen.getByText('Climate Research')).toBeInTheDocument()
  })

  it('calls onCreate when new project button clicked', () => {
    const fn = vi.fn()
    render(<ProjectSelector projects={projects} currentId="p_default" onSwitch={vi.fn()} onCreate={fn} />)
    // Click the "+" button
    fireEvent.click(screen.getByTitle('New project'))
    expect(fn).toHaveBeenCalled()
  })
})
