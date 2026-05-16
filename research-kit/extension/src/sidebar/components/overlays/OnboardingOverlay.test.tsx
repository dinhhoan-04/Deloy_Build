import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OnboardingOverlay } from './OnboardingOverlay'

describe('OnboardingOverlay', () => {
  it('renders onboarding content', () => {
    render(<OnboardingOverlay onComplete={vi.fn()} />)
    expect(screen.getByText(/welcome to researchkit/i)).toBeInTheDocument()
  })

  it('shows step 1 initially', () => {
    render(<OnboardingOverlay onComplete={vi.fn()} />)
    expect(screen.getByText(/extract claims from research papers/i)).toBeInTheDocument()
  })

  it('navigates to next step when next button clicked', () => {
    render(<OnboardingOverlay onComplete={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText(/verify claims across multiple sources/i)).toBeInTheDocument()
  })

  it('navigates to previous step when back button clicked', () => {
    render(<OnboardingOverlay onComplete={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(screen.getByText(/extract claims from research papers/i)).toBeInTheDocument()
  })

  it('calls onComplete when finish button clicked on last step', () => {
    const fn = vi.fn()
    render(<OnboardingOverlay onComplete={fn} />)
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    fireEvent.click(screen.getByRole('button', { name: /finish/i }))
    expect(fn).toHaveBeenCalled()
  })

  it('shows progress indicator', () => {
    render(<OnboardingOverlay onComplete={vi.fn()} />)
    expect(screen.getByText(/1 of 3/i)).toBeInTheDocument()
  })
})
