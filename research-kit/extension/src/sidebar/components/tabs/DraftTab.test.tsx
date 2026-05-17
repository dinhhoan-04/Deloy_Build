import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DraftTab } from './DraftTab'

vi.mock('../../../shared/api', () => ({
  createRun: vi.fn().mockResolvedValue({ run_id: 'r1', status: 'queued', stream_url: '' }),
}))
vi.mock('../../hooks/useRunStream', () => ({
  useRunStream: () => ({ status: 'queued', tokens: '', toolCalls: [], error: null, finalContent: null }),
}))
vi.mock('../../state/useStore', () => ({
  useStore: (sel: any) => sel({
    currentProjectId: 'p1',
    inbox: { data: [] },
    claims: { data: [] },
    provider: 'openai',
    draft: { data: null, saving: false, dirty: false },
    loadDraft: vi.fn(),
    saveDraft: vi.fn(),
    updateDraftField: vi.fn(),
    deleteDraft: vi.fn(),
    showToast: vi.fn(),
  }),
}))

describe('DraftTab', () => {
  it('renders generate button', () => {
    render(<DraftTab />)
    expect(screen.getByText('Generate')).toBeInTheDocument()
  })

  it('renders custom checkboxes (not native input[type=checkbox]) in claim selector', () => {
    const { container } = render(<DraftTab />)
    const nativeCheckboxes = container.querySelectorAll('input[type="checkbox"]')
    expect(nativeCheckboxes.length).toBe(0)
  })
})
