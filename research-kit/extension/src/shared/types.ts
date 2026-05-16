export interface Citation { ref_id: string; url: string }

export interface UserOut { id: string; email: string; name: string | null }

export interface Project { id: string; name: string }

export interface Claim {
  id: string
  project_id: string
  text: string
  paper_title: string | null
  doi: string | null
  paper_url: string | null
  page: string | null
  site: string
  status: string
  confidence: number | null
  quote: string | null
  reason: string | null
  page_url: string | null
  extracted_at: string | null
  created_at: string
  updated_at: string
}

export interface ClaimInput {
  text: string
  paper_title?: string | null
  doi?: string | null
  paper_url?: string | null
  page?: string | null
  site: string
  page_url?: string | null
  extracted_at?: string | null
}

export interface ClaimPatch {
  status?: string
  quote?: string
  confidence?: number
  reason?: string
  page?: string
}

export interface InboxItem {
  id: string
  project_id: string
  claim_id: string
  saved_at: string
  archived_at: string | null
}

export interface ConflictSide { claim_id: string; label: string; quote: string | null }
export interface Conflict {
  id: string
  project_id: string
  group_key: string
  doi: string | null
  paper_title: string | null
  flagged_at: string
  resolution: string | null
  sides: ConflictSide[]
}

export type ResolutionPayload =
  | { kind: 'accept_side'; side_id: string; note?: string }
  | { kind: 'reject_all'; note: string }
  | { kind: 'suggestion'; text: string; rationale: string; sides_analysis?: Array<{ side_id: string; weight: number; note: string }> }

export type RunKind = 'verify' | 'extract' | 'chat' | 'draft' | 'conflict'
export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'cancelling'

export interface RunCreate {
  kind: RunKind
  input: Record<string, unknown>
  provider?: 'openai' | 'zai' | 'gemini'
  model?: string
  project_id?: string
  idempotency_key: string
}
export interface RunCreateResponse { run_id: string; status: string; stream_url: string }
export interface Run {
  id: string; kind: RunKind; status: RunStatus
  project_id: string | null
  input: Record<string, unknown>
  result: Record<string, unknown> | null
  error: { code: string; message: string; recoverable?: boolean } | null
  created_at: string; started_at: string | null; finished_at: string | null
}

export type RunEvent =
  | { type: 'status'; payload: { status: RunStatus } }
  | { type: 'token'; payload: { text: string } }
  | { type: 'tool_call'; payload: { name: string; args: unknown; id?: string } }
  | { type: 'tool_result'; payload: { name: string; result: unknown; id?: string } }
  | { type: 'error'; payload: { code: string; message: string; recoverable?: boolean } }
  | { type: 'final'; payload: { content: string; usage: Record<string, unknown> } }

export interface ConflictCheckStatus {
  last_checked_at: string | null
  pending_count: number
}

export interface Draft {
  id: string
  project_id: string
  run_id: string | null
  title: string
  markdown: string
  sections: Array<{ title: string; claim_refs: string[] }>
  created_at: string
  updated_at: string
}
