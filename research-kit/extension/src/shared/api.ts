import { authHeader, signOut } from './auth'
import { ApiError, AuthExpiredError } from './errors'
export { ApiError } from './errors'
import { API_URL } from './config'
import { parseSSE } from './sse'
import type {
  Project, Claim, ClaimInput, ClaimPatch, InboxItem, Conflict,
  ConflictCheckStatus,
  ResolutionPayload, RunCreate, RunCreateResponse, Run, RunEvent, Draft,
} from './types'

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData
  const headers: Record<string, string> = {
    ...authHeader(),
    ...(init.headers as Record<string, string> || {}),
  }
  if (!isFormData) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${API_URL}${path}`, { ...init, headers })
  if (res.status === 401) { await signOut(); throw new AuthExpiredError() }
  if (!res.ok) throw await ApiError.fromResponse(res)
  return res
}

// Projects
export async function listProjects(): Promise<Project[]> {
  return (await apiFetch('/projects')).json()
}
export async function createProject(name: string): Promise<Project> {
  return (await apiFetch('/projects', { method: 'POST', body: JSON.stringify({ name }) })).json()
}
export async function updateProject(id: string, name: string): Promise<Project> {
  return (await apiFetch(`/projects/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })).json()
}
export async function deleteProject(id: string): Promise<void> {
  await apiFetch(`/projects/${id}`, { method: 'DELETE' })
}

// Claims
export async function listClaims(projectId: string, status?: string, limit = 50): Promise<Claim[]> {
  const qs = new URLSearchParams({ project_id: projectId, limit: String(limit) })
  if (status) qs.set('status', status)
  return (await apiFetch(`/claims?${qs}`)).json()
}
export async function batchCreateClaims(
  projectId: string, claims: ClaimInput[], idempotencyKey?: string,
): Promise<{ created: Claim[] }> {
  return (await apiFetch('/claims/batch', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, claims, idempotency_key: idempotencyKey }),
  })).json()
}
export async function patchClaim(claimId: string, patch: ClaimPatch): Promise<Claim> {
  return (await apiFetch(`/claims/${claimId}`, { method: 'PATCH', body: JSON.stringify(patch) })).json()
}

// Inbox
export async function listInbox(projectId: string): Promise<InboxItem[]> {
  return (await apiFetch(`/inbox?project_id=${projectId}`)).json()
}
export async function addToInbox(projectId: string, claimId: string): Promise<InboxItem> {
  return (await apiFetch('/inbox', {
    method: 'POST', body: JSON.stringify({ project_id: projectId, claim_id: claimId }),
  })).json()
}
export async function removeFromInbox(inboxId: string): Promise<void> {
  await apiFetch(`/inbox/${inboxId}`, { method: 'DELETE' })
}
export async function patchInboxItem(
  inboxId: string,
  patch: { archived_at: string | null },
): Promise<InboxItem> {
  return (await apiFetch(`/inbox/${inboxId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })).json()
}
export async function bulkPatchInbox(
  ids: string[],
  archived_at: string | null,
): Promise<InboxItem[]> {
  return (await apiFetch('/inbox/bulk', {
    method: 'PATCH',
    body: JSON.stringify({ ids, archived_at }),
  })).json()
}

// Conflicts
export async function listConflicts(projectId: string): Promise<Conflict[]> {
  return (await apiFetch(`/conflicts?project_id=${projectId}`)).json()
}
export async function patchConflict(
  conflictId: string, resolution: ResolutionPayload,
): Promise<Conflict> {
  return (await apiFetch(`/conflicts/${conflictId}`, {
    method: 'PATCH',
    body: JSON.stringify({ resolution: JSON.stringify(resolution) }),
  })).json()
}

export async function getConflictCheckStatus(projectId: string): Promise<ConflictCheckStatus> {
  return (await apiFetch(`/conflicts/check-status?project_id=${projectId}`)).json()
}

export async function confirmConflict(
  conflictId: string,
  acceptedClaimId: string,
): Promise<{ conflict: Conflict; inbox_item: InboxItem }> {
  return (await apiFetch(`/conflicts/${conflictId}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ accepted_claim_id: acceptedClaimId }),
  })).json()
}

export async function bootstrapDemoProject(): Promise<{ project_id: string; draft_run_id: string }> {
  return (await apiFetch('/demo/bootstrap', { method: 'POST' })).json()
}

// Runs
export async function createRun(body: RunCreate): Promise<RunCreateResponse> {
  return (await apiFetch('/runs', { method: 'POST', body: JSON.stringify(body) })).json()
}
export async function getRun(runId: string): Promise<Run> {
  return (await apiFetch(`/runs/${runId}`)).json()
}
export async function cancelRun(runId: string): Promise<void> {
  await apiFetch(`/runs/${runId}/cancel`, { method: 'POST' })
}

// Verify with uploaded PDF (for inaccessible claims)
export interface VerifyWithPdfOptions {
  file: File
  claim: string
  doi?: string
  paperTitle?: string
}

export interface VerifyUploadResponse {
  status: 'verified' | 'partial' | 'not_found' | 'inaccessible' | 'error'
  verbatim_quote: string | null
  confidence: number
  reason: string
  paper_title: string | null
  doi: string | null
}

export async function verifyWithPdf(opts: VerifyWithPdfOptions): Promise<VerifyUploadResponse> {
  const form = new FormData()
  form.append('pdf', opts.file)
  form.append('claim', opts.claim)
  if (opts.doi) form.append('doi', opts.doi)
  if (opts.paperTitle) form.append('paper_title', opts.paperTitle)
  const res = await apiFetch('/verify/upload', { method: 'POST', body: form })
  return res.json()
}

// SSE stream with reconnect
export async function* streamRun(
  runId: string,
  { lastSeq = 0, signal }: { lastSeq?: number; signal?: AbortSignal } = {},
): AsyncIterable<RunEvent> {
  let seq = lastSeq
  let backoff = 500
  while (!signal?.aborted) {
    try {
      const res = await fetch(`${API_URL}/runs/${runId}/stream`, {
        headers: { ...authHeader(), 'Last-Event-ID': String(seq) },
        signal,
      })
      if (res.status === 401) { await signOut(); throw new AuthExpiredError() }
      if (!res.ok) throw new ApiError(res.status, await res.text())
      backoff = 500
      for await (const f of parseSSE(res.body!)) {
        if (f.id) seq = parseInt(f.id, 10)
        const evt = JSON.parse(f.data) as RunEvent
        yield evt
        if (evt.type === 'error') return
        if (evt.type === 'status' &&
          ['succeeded', 'failed', 'cancelled'].includes(evt.payload.status)) return
      }
      // Stream closed without terminal event — wait before reconnect to avoid log spam
      await new Promise(r => setTimeout(r, Math.min(backoff, 3000)))
      backoff = Math.min(backoff * 1.5, 10000)
    } catch (e) {
      if (signal?.aborted || e instanceof AuthExpiredError) throw e
      await new Promise(r => setTimeout(r, backoff))
      backoff = Math.min(backoff * 2, 10000)
    }
  }
}

// Drafts
export async function getDraft(projectId: string): Promise<Draft | null> {
  try {
    return await (await apiFetch(`/drafts?project_id=${projectId}`)).json()
  } catch (e: any) {
    if (e?.status === 404) return null
    throw e
  }
}

export async function upsertDraft(body: {
  project_id: string
  run_id?: string | null
  title?: string
  markdown: string
  sections?: Array<{ title: string; claim_refs: string[] }>
}): Promise<Draft> {
  return (await apiFetch('/drafts', { method: 'POST', body: JSON.stringify(body) })).json()
}

export async function patchDraft(draftId: string, patch: { title?: string; markdown?: string }): Promise<Draft> {
  return (await apiFetch(`/drafts/${draftId}`, { method: 'PATCH', body: JSON.stringify(patch) })).json()
}

export async function deleteDraft(draftId: string): Promise<void> {
  await apiFetch(`/drafts/${draftId}`, { method: 'DELETE' })
}

export function draftExportUrl(draftId: string, format: 'md' | 'docx'): string {
  return `${API_URL}/drafts/${draftId}/export?format=${format}`
}
