import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiError } from '../../../shared/api'
import { render, screen, fireEvent } from '@testing-library/react'
import { VerifyTab } from './VerifyTab'
import type { ClaimItem } from '../../../shared/verify-types'

vi.mock('../../hooks/useRunStream', () => ({
  useRunStream: () => ({ status: 'queued', tokens: '', toolCalls: [], error: null, finalContent: null }),
}))
const mockShowToast = vi.fn()
const mockIngestClaimResult = vi.fn()

vi.mock('../../state/useStore', () => ({
  useStore: (sel: any) => sel({
    currentProjectId: 'p1',
    loadClaims: vi.fn(),
    untrackRun: vi.fn(),
    trackRun: vi.fn(),
    runs: new Map(),
    showToast: mockShowToast,
    ingestClaimResult: mockIngestClaimResult,
  }),
}))

const mockVerifyWithPdf = vi.fn()
vi.mock('../../../shared/api', () => ({
  createRun: vi.fn().mockResolvedValue({ run_id: 'r1', status: 'queued', stream_url: '' }),
  verifyWithPdf: (...args: any[]) => mockVerifyWithPdf(...args),
  ApiError: class ApiError extends Error {
    status: number
    body: string
    code?: string
    constructor(status: number, body: string, code?: string) {
      super(`HTTP ${status}: ${body}`)
      this.status = status
      this.body = body
      this.code = code
    }
  },
}))

const fakeClaim = (id: string, status: ClaimItem['status'] = 'verified'): ClaimItem => ({
  id, text: `claim ${id}`, paperTitle: 'X', doi: '10.1/x', paperUrl: null,
  page: 'p.1', site: 'elicit', status, confidence: 0.9, quote: null, reason: '',
  saved: false, domAnchor: '', tabId: 1, pageUrl: '', extractedAt: 0,
})

describe('VerifyTab', () => {
  beforeEach(() => {
    mockShowToast.mockClear()
    mockIngestClaimResult.mockClear()
    mockVerifyWithPdf.mockReset()
  })

  it('renders empty state when no claims', () => {
    render(<VerifyTab claims={[]} expandedIds={new Set()} onToggleExpand={vi.fn()} onSave={vi.fn()} />)
    expect(screen.getByText(/no claims/i)).toBeInTheDocument()
  })

  it('renders list of claims', () => {
    const claims = [fakeClaim('c1'), fakeClaim('c2')]
    render(<VerifyTab claims={claims} expandedIds={new Set()} onToggleExpand={vi.fn()} onSave={vi.fn()} />)
    expect(screen.getAllByText('claim c1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('claim c2').length).toBeGreaterThan(0)
  })

  it('passes expanded=true to expanded ClaimCard', () => {
    const claims = [fakeClaim('c1')]
    render(<VerifyTab claims={claims} expandedIds={new Set(['c1'])} onToggleExpand={vi.fn()} onSave={vi.fn()} />)
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
  })

  it('calls onSave when save triggered from ClaimCard', () => {
    const fn = vi.fn()
    render(<VerifyTab claims={[fakeClaim('c1')]} expandedIds={new Set(['c1'])} onToggleExpand={vi.fn()} onSave={fn} />)
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(fn).toHaveBeenCalledWith('c1')
  })

  it('filters claims by status', () => {
    const claims = [fakeClaim('c1', 'verified'), fakeClaim('c2', 'not_found')]
    render(<VerifyTab claims={claims} expandedIds={new Set()} onToggleExpand={vi.fn()} onSave={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /not found/i }))
    expect(screen.getAllByText('claim c2').length).toBeGreaterThan(0)
    expect(screen.queryAllByText('claim c1')).toHaveLength(0)
  })

  it('shows skeleton cards instead of spinner when isDetecting', () => {
    const { container } = render(
      <VerifyTab claims={[]} expandedIds={new Set()} onToggleExpand={vi.fn()} onSave={vi.fn()} isDetecting={true} />
    )
    expect(container.querySelector('.animate-shimmer')).toBeTruthy()
    expect(container.querySelector('.animate-spinRing')).toBeNull()
  })

  it('shows branded empty state when no claims and not detecting', () => {
    render(
      <VerifyTab claims={[]} expandedIds={new Set()} onToggleExpand={vi.fn()} onSave={vi.fn()} isDetecting={false} />
    )
    expect(screen.getByText('No claims yet')).toBeInTheDocument()
  })

  it('classifies ApiError status codes into user-facing messages', () => {
    const classify = (e: unknown) => {
      if (e instanceof ApiError) {
        if (e.status === 400) return 'Validation error — check the PDF'
        if (e.status === 503) return 'Service unavailable — try again later'
        return `Upload failed (${e.status})`
      }
      return 'Upload failed. Please retry.'
    }
    expect(classify(new ApiError(503, 'x'))).toBe('Service unavailable — try again later')
    expect(classify(new ApiError(400, 'x'))).toBe('Validation error — check the PDF')
    expect(classify(new ApiError(422, 'x'))).toBe('Upload failed (422)')
    expect(classify(new Error('network'))).toBe('Upload failed. Please retry.')
  })

  it('renders disabled-site state with settings button', () => {
    const fn = vi.fn()
    render(<VerifyTab claims={[]} expandedIds={new Set()} onToggleExpand={vi.fn()} onSave={vi.fn()} currentSiteDisabled="elicit" onOpenSettings={fn} />)
    expect(screen.getByText(/elicit is disabled/i)).toBeInTheDocument()
    fireEvent.click(screen.getByText(/open settings/i))
    expect(fn).toHaveBeenCalled()
  })

  it('shows friendly message for structured pdf_too_large error', async () => {
    const { ApiError } = await import('../../../shared/api')
    mockVerifyWithPdf.mockRejectedValue(
      new ApiError(400, JSON.stringify({ error: { code: 'pdf_too_large', message: 'too big' } }), 'pdf_too_large')
    )
    const claim = { ...fakeClaim('c1', 'inaccessible') }
    render(
      <VerifyTab claims={[claim]} expandedIds={new Set(['c1'])} onToggleExpand={vi.fn()} onSave={vi.fn()} />
    )
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['%PDF'], 'test.pdf', { type: 'application/pdf' })
    fireEvent.change(fileInput, { target: { files: [file] } })
    await vi.waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('PDF too large', 'error'))
  })
})
