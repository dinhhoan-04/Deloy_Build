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

  it('calls onSwitch when option selected', () => {
    const fn = vi.fn()
    render(<ProjectSelector projects={projects} currentId="p_default" onSwitch={fn} onCreate={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'p_2' } })
    expect(fn).toHaveBeenCalledWith('p_2')
  })

  it('calls onCreate when new project option selected', () => {
    const fn = vi.fn()
    render(<ProjectSelector projects={projects} currentId="p_default" onSwitch={vi.fn()} onCreate={fn} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '__new__' } })
    expect(fn).toHaveBeenCalled()
  })
})
