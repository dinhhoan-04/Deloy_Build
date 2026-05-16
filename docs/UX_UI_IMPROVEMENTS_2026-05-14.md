# ResearchKit UX/UI Improvements (May 14, 2026)

## 1) UX improvements implemented in extension

### Processing progress is now step-based, not only percentage
- Added explicit processing steps: `queueing`, `verifying`, `done`, and failure path.
- Progress bar now shows step text (`stepMessage`) so users know what is happening, not just `completed / total`.
- Claim-level live states are shown in Verify cards: `queued`, `verifying`, `retrying`, `failed`.

### Better interaction between web pages and sidebar
- Content badges now support realtime step updates (`queued`, `verifying`, `retrying`, `done`, `failed`).
- Clicking a badge opens the sidebar and focuses the exact claim.
- Sidebar auto-switches to Verify tab and expands the focused claim for faster resolution.

### Action feedback is explicit
- Save-to-inbox now surfaces success/failure toasts.
- Upload-PDF verification now surfaces success/failure toasts.
- Global pause/resume is connected to the progress bar action.

## 2) Backend additions required for UX to be fully effective

Current UX works with current backend, but to be accurate and robust at scale, backend should expose richer run/claim execution signals.

### A. Step-level event contract (required)
- Emit canonical events for each claim:
  - `claim.queued`
  - `claim.started`
  - `claim.fetching_source`
  - `claim.model_verifying`
  - `claim.retry_scheduled`
  - `claim.completed`
  - `claim.failed`
- Each event should include:
  - `run_id`, `claim_id`, `project_id`, `tab_id` (if available)
  - `step`, `attempt`, `max_attempts`
  - `timestamp` (server time)
  - `detail` (short user-facing text)

### B. Retry semantics and stable error taxonomy (required)
- Standardize backend error codes for UX:
  - `network_timeout`, `source_inaccessible`, `rate_limited`, `provider_error`, `internal_error`
- Return `recoverable: true/false`.
- Return `retry_after_ms` when recoverable.
- Include `attempt` and `max_attempts` for each retry.

### C. Run-level progress model (required)
- Return run progress with explicit fields:
  - `total`, `queued`, `running`, `completed`, `failed`, `paused`
  - per-site breakdown: `site_total`, `site_running`, `site_completed`, `site_failed`
- Provide `phase` + `phase_message` from backend as source of truth.
- Optional but useful: `eta_ms` and `avg_claim_latency_ms`.

### D. State replay and reconnect (required for reliability)
- On SSE reconnect, backend should support replay from `last_event_id`.
- Ensure monotonic sequence number per run so UI can deduplicate and keep ordering.
- Add endpoint for latest snapshot:
  - `GET /runs/{run_id}/progress`
  - `GET /runs/{run_id}/claims/{claim_id}/status`

### E. Idempotency and duplicate protection (required)
- Accept idempotency key at claim verify creation.
- Ensure duplicate claim submits do not produce duplicate work/events.
- Return existing in-flight result metadata if same key is reused.

### F. Performance and load controls (recommended)
- Server-side concurrency limits by tenant/project/run.
- Queue depth visibility for UI (`position_in_queue` if possible).
- Backpressure signal for extension (`throttled`, `retry_after_ms`).

### G. Auditability and supportability (recommended)
- Correlation IDs in all responses/events.
- Store minimal run timeline for support troubleshooting.
- Structured event logs for dropped claims and replay failures.

## 3) Suggested backend rollout order
1. Step-level events + error taxonomy.
2. Run snapshot + SSE replay with sequence IDs.
3. Retry metadata + ETA.
4. Queue visibility + throttling/backpressure metadata.

## 4) Acceptance criteria for UX/backend integration
- User can always answer: "System is doing what right now?"
- No ambiguous spinner longer than 2s without a step message.
- Reconnect does not lose progress context.
- Clicking a page badge always lands user on the corresponding claim in sidebar.
- Retry/failure states are distinguishable and actionable.
