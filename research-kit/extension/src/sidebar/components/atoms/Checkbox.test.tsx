import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Checkbox } from './Checkbox'

describe('Checkbox', () => {
  it('renders checked state', () => {
    render(<Checkbox checked={true} onChange={vi.fn()} label="Select item" />)
    expect(screen.getByRole('checkbox')).toBeChecked()
  })

  it('renders unchecked state', () => {
    render(<Checkbox checked={false} onChange={vi.fn()} label="Select item" />)
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })

  it('calls onChange when clicked', () => {
    const fn = vi.fn()
    render(<Checkbox checked={false} onChange={fn} label="Select item" />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(fn).toHaveBeenCalledWith(true)
  })

  it('renders with visible label', () => {
    render(<Checkbox checked={false} onChange={vi.fn()} label="My label" />)
    expect(screen.getByText('My label')).toBeInTheDocument()
  })

  it('does not call onChange when disabled', () => {
    const fn = vi.fn()
    render(<Checkbox checked={false} onChange={fn} label="X" disabled />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(fn).not.toHaveBeenCalled()
  })
})
