import type { RunKind } from '../../../shared/types'

export interface TrackedRun {
  runId: string
  kind: RunKind
  claimId?: string
  conflictId?: string
}

export interface RunsSlice {
  runs: Map<string, TrackedRun>
  trackRun(t: TrackedRun): void
  untrackRun(runId: string): void
}

export function createRunsSlice(set: any, _get: any): RunsSlice {
  return {
    runs: new Map(),
    trackRun(t) { set((s: any) => { const m = new Map(s.runs); m.set(t.runId, t); return { runs: m } }) },
    untrackRun(id) { set((s: any) => { const m = new Map(s.runs); m.delete(id); return { runs: m } }) },
  }
}
