import { useEffect } from 'react'
import {
  MSG_CLAIM_RESULT, MSG_CONFLICT_DETECTED, MSG_VERIFY_DONE,
  MSG_VERIFY_PROGRESS, MSG_TAB_CHANGED,
  MSG_CLAIM_STEP, MSG_FOCUS_CLAIM,
  type MessageClaimResult,
  type MessageVerifyProgress, type MessageTabChanged, type MessageClaimStep, type MessageFocusClaim,
} from '../../shared/messages'
import { useStore } from '../state/useStore'

export function useBackgroundMessages(): void {
  const ingestClaimResult = useStore(s => s.ingestClaimResult)
  const ingestProgress = useStore(s => s.ingestProgress)
  const setCurrentTab = useStore(s => s.setCurrentTab)
  const setClaimStep = useStore(s => s.setClaimStep)
  const focusClaim = useStore(s => s.focusClaim)

  useEffect(() => {
    const handler = (msg: any) => {
      if (msg?.type === MSG_CLAIM_RESULT) {
        ingestClaimResult((msg as MessageClaimResult).result)
      } else if (msg?.type === MSG_VERIFY_PROGRESS) {
        ingestProgress((msg as MessageVerifyProgress).progress)
      } else if (msg?.type === MSG_TAB_CHANGED) {
        setCurrentTab((msg as MessageTabChanged).tabId, null)
      } else if (msg?.type === MSG_CLAIM_STEP) {
        const m = msg as MessageClaimStep
        setClaimStep(m.claimId, m.step, m.detail)
      } else if (msg?.type === MSG_FOCUS_CLAIM) {
        const m = msg as MessageFocusClaim
        if (m.tabId) setCurrentTab(m.tabId, null)
        focusClaim(m.claimId)
      } else if (msg?.type === MSG_CONFLICT_DETECTED) {
        // Conflicts are persisted by background; sidebar re-hydrates via storage listener.
      } else if (msg?.type === MSG_VERIFY_DONE) {
        // No-op in Foundation; ProgressBar derives "done" from progress.completed === total.
      }
    }
    chrome.runtime.onMessage.addListener(handler)
    return () => chrome.runtime.onMessage.removeListener(handler)
  }, [ingestClaimResult, ingestProgress, setCurrentTab, setClaimStep, focusClaim])
}
