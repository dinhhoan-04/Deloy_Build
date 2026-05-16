import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Toggle } from './Toggle'

describe('Toggle', () => {
  it('renders checked state', () => {
    render(<Toggle checked={true} onChange={vi.fn()} label="Verify" />)
    expect(screen.getByRole('switch')).toBeChecked()
    expect(screen.getByText('Verify')).toBeInTheDocument()
  })

  it('renders unchecked state', () => {
    render(<Toggle checked={false} onChange={vi.fn()} label="Verify" />)
    expect(screen.getByRole('switch')).not.toBeChecked()
  })

  it('calls onChange when clicked', () => {
    const fn = vi.fn()
    render(<Toggle checked={false} onChange={fn} label="Test" />)
    fireEvent.click(screen.getByRole('switch'))
    expect(fn).toHaveBeenCalledWith(true)
  })

  it('does not call onChange when disabled', () => {
    const fn = vi.fn()
    render(<Toggle checked={false} onChange={fn} label="Test" disabled />)
    fireEvent.click(screen.getByRole('switch'))
    expect(fn).not.toHaveBeenCalled()
  })
})
