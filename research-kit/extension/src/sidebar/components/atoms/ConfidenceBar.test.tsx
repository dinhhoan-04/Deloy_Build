import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConfidenceBar } from './ConfidenceBar'

describe('ConfidenceBar', () => {
  it('renders with aria label showing percentage', () => {
    render(<ConfidenceBar value={0.85} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '85')
  })

  it('clamps value between 0 and 1', () => {
    render(<ConfidenceBar value={1.5} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  })
})
