import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Toast } from './Toast'

describe('Toast', () => {
  it('renders message', () => {
    render(<Toast message="Saved to inbox" tone="success" onDismiss={vi.fn()} />)
    expect(screen.getByText('Saved to inbox')).toBeInTheDocument()
  })

  it('calls onDismiss on close click', () => {
    const fn = vi.fn()
    render(<Toast message="X" tone="error" onDismiss={fn} />)
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(fn).toHaveBeenCalled()
  })

  it('applies success styling class', () => {
    const { container } = render(<Toast message="ok" tone="success" onDismiss={vi.fn()} />)
    expect(container.firstChild).toHaveClass('toast--success')
  })

  it('renders an svg icon for success tone', () => {
    const { container } = render(<Toast message="ok" tone="success" onDismiss={vi.fn()} />)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('renders an svg icon for error tone', () => {
    const { container } = render(<Toast message="err" tone="error" onDismiss={vi.fn()} />)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('applies slide-in animation class', () => {
    const { container } = render(<Toast message="ok" tone="success" onDismiss={vi.fn()} />)
    expect(container.firstChild).toHaveClass('animate-toastSlide')
  })
})
