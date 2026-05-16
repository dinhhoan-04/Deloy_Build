import { useEffect, useState } from 'react'
import { useAuth } from './hooks/useAuth'
import { LoginGate } from './components/atoms/LoginGate'
import { useStore } from './state/useStore'
import { useChromeStorage } from './hooks/useChromeStorage'
import { useBackgroundMessages } from './hooks/useBackgroundMessages'
import type { VerifyProgress } from '../shared/verify-types'
import { Header } from './components/shell/Header'
import { ProgressBar } from './components/shell/ProgressBar'
import { TabBar } from './components/shell/TabBar'
import { Footer } from './components/shell/Footer'
import { VerifyTab } from './components/tabs/VerifyTab'
import { InboxTab } from './components/tabs/InboxTab'
import { ConflictsTab } from './components/tabs/ConflictsTab'
import { ChatTab } from './components/tabs/ChatTab'
import { DraftTab } from './components/tabs/DraftTab'
import { HelpTab } from './components/tabs/HelpTab'
import { SettingsPanel } from './components/overlays/SettingsPanel'
import { OnboardingOverlay } from './components/overlays/OnboardingOverlay'
import { ProjectCreateModal } from './components/atoms/ProjectCreateModal'
import { ProjectPickerModal } from './components/atoms/ProjectPickerModal'
import { ProjectEditModal } from './components/atoms/ProjectEditModal'
import { Toast } from './components/atoms/Toast'
import { createRun, batchCreateClaims, bootstrapDemoProject } from '../shared/api'
import { writeStorage } from './state/storage'
import type { Claim, Conflict } from '../shared/types'
import type { InboxItem as InboxViewItem } from '../shared/verify-types'

function AppContent({ userId }: { userId: string }) {
  const {
    tab, setTab,
    projects, loadProjects, currentProjectId, switchProject,
    inbox, loadClaims, loadInbox, loadConflicts,
    claims,
    conflicts,
    activeSites, setActiveSite,
    progressByTab, currentTabId,
    globalPaused, setGlobalPaused,
    claimStepsById, focusedClaimId, focusClaim,
    toast, showToast, clearToast,
    claimsByTab,
    inboxSelectedIds, clearInboxSelection, toggleInboxSelect,
    settingsOpen, openSettings, closeSettings,
    provider, setProvider,
    onboardingDone, setOnboardingDone,
    expandedClaimIds, toggleClaimExpand,
    createProject,
    updateProject,
    deleteProject,
    archiveMany,
    unarchiveMany,
    addToInbox,
    patchClaim,
    removeFromInbox,
    confirmConflict,
    bumpPendingCheck,
  } = useStore()

  const [showCreateProject, setShowCreateProject] = useState(false)
  const [showAddToProject, setShowAddToProject] = useState<string[] | null>(null)
  const [editingProject, setEditingProject] = useState<{ id: string; name: string } | null>(null)
  const [savingClaimIds, setSavingClaimIds] = useState<Set<string>>(new Set())
  const [demoDraftRunByProject, setDemoDraftRunByProject] = useState<Record<string, string>>({})

  useChromeStorage()
  useBackgroundMessages()

  useEffect(() => {
    loadProjects()
  }, [userId])

  useEffect(() => {
    if (!currentProjectId) return
    loadClaims(currentProjectId)
    loadInbox(currentProjectId)
    loadConflicts(currentProjectId)
  }, [currentProjectId])

  useEffect(() => {
    if (projects.data.length === 0) return
    const valid = projects.data.some(p => p.id === currentProjectId)
    if (!valid) {
      useStore.setState({ currentProjectId: projects.data[0].id })
      writeStorage('currentProjectId', projects.data[0].id)
    }
  }, [projects.data, currentProjectId])

  useEffect(() => {
    if (!focusedClaimId) return
    if (!expandedClaimIds.has(focusedClaimId)) toggleClaimExpand(focusedClaimId)
    setTab('verify')
    focusClaim(null)
  }, [focusedClaimId, expandedClaimIds, toggleClaimExpand, setTab, focusClaim])

  const inboxError = inbox.status === 'error' ? ((inbox as any).error ?? 'Unknown error') : null
  const inboxCount = inbox.data.length
  const conflictsCount = conflicts.data.length

  // FIX: Ensure default perSite has all three sites and handle undefined case
  const defaultProgress: VerifyProgress = {
    tabId: currentTabId ?? 0,
    total: 0,
    completed: 0,
    running: 0,
    paused: false,
    pausedSites: [],
    perSite: {
      elicit: { total: 0, completed: 0, running: 0 },
      scispace: { total: 0, completed: 0, running: 0 },
      consensus: { total: 0, completed: 0, running: 0 },
    },
  }
  const verifyProgress = currentTabId
    ? (progressByTab.get(currentTabId) ?? defaultProgress)
    : defaultProgress
  const showSettings = settingsOpen
  const showOnboarding = !onboardingDone

  const handleToggleSite = (site: 'elicit' | 'scispace' | 'consensus') => {
    const isActive = activeSites.has(site)
    setActiveSite(site, !isActive)
  }

  const handleArchive = async (ids: string[]) => {
    try {
      await archiveMany(ids)
    } catch {
      showToast('Archive failed. Please retry.', 'error')
    }
  }

  const handleUnarchive = async (ids: string[]) => {
    try {
      await unarchiveMany(ids)
    } catch {
      showToast('Unarchive failed. Please retry.', 'error')
    }
  }

  const handleEditProject = (project: { id: string; name: string }) => {
    setEditingProject(project)
  }

  const handleRenameProject = async (name: string) => {
    if (!editingProject) return
    await updateProject(editingProject.id, name)
  }

  const handleDeleteProject = async () => {
    if (!editingProject) return
    await deleteProject(editingProject.id)
  }

  const handleAddToProject = (ids: string[]) => setShowAddToProject(ids)

  const onSave = async (claimId: string) => {
    if (!currentProjectId) return
    if (savingClaimIds.has(claimId)) return
    setSavingClaimIds(prev => new Set(prev).add(claimId))

    // Local claim IDs (e.g. "c6::p1") are content-script generated, not backend UUIDs.
    // Create the claim on the backend first to get a real UUID, then patch + inbox.
    const localClaim = (currentTabId ? (claimsByTab.get(currentTabId) ?? []) : [])
      .find(c => c.id === claimId)
    if (!localClaim) {
      setSavingClaimIds(prev => {
        const next = new Set(prev)
        next.delete(claimId)
        return next
      })
      return
    }
    if (!['verified', 'partial'].includes(localClaim.status)) {
      setSavingClaimIds(prev => {
        const next = new Set(prev)
        next.delete(claimId)
        return next
      })
      return
    }

    try {
      const { created } = await batchCreateClaims(
        currentProjectId,
        [{
          text: localClaim.text,
          paper_title: localClaim.paperTitle,
          doi: localClaim.doi,
          paper_url: localClaim.paperUrl,
          page: localClaim.page,
          site: localClaim.site,
          page_url: localClaim.pageUrl,
          extracted_at: localClaim.extractedAt
            ? new Date(localClaim.extractedAt).toISOString()
            : null,
        }],
        `save:${currentProjectId}:${claimId}:${localClaim.extractedAt ?? 0}`,
      )
      const backendId = created[0]?.id
      if (!backendId) return
      await patchClaim(backendId, {
        status: localClaim.status,
        confidence: localClaim.confidence,
        quote: localClaim.quote ?? undefined,
        reason: localClaim.reason || undefined,
      })
      if (localClaim.status === 'verified' || localClaim.status === 'partial') {
        bumpPendingCheck()
      }
      await addToInbox(currentProjectId, backendId)
      showToast('Saved to inbox', 'success')
    } catch (e) {
      showToast(`Save failed — ${e instanceof Error ? e.message : 'network error'}. Please retry.`, 'error')
    } finally {
      setSavingClaimIds(prev => {
        const next = new Set(prev)
        next.delete(claimId)
        return next
      })
    }
  }

  const handleConfirmConflict = async (conflictId: string, acceptedClaimId: string) => {
    await confirmConflict(conflictId, acceptedClaimId)
    showToast('Claim added to inbox', 'success')
  }

  const handleSuggestConflict = async (c: Conflict) => {
    const idem = `conflict:${c.id}:${Date.now()}`
    await createRun({
      kind: 'conflict', project_id: c.project_id, idempotency_key: idem,
      provider,
      input: {
        conflict_id: c.id, group_key: c.group_key,
        sides: c.sides.map(s => ({ side_id: s.claim_id, label: s.label, quote: s.quote })),
      },
    })
  }

  const handleOpenDemo = async () => {
    const { project_id, draft_run_id } = await bootstrapDemoProject()
    await loadProjects()
    await switchProject(project_id)
    await Promise.all([loadClaims(project_id), loadInbox(project_id), loadConflicts(project_id)])
    setTab('verify')
    setDemoDraftRunByProject(prev => ({ ...prev, [project_id]: draft_run_id }))
  }

  const claimRows = claims.data as Claim[]
  const claimsById = new Map(claimRows.map(c => [c.id, c] as const))
  const inboxViewItems: InboxViewItem[] = inbox.data
    .map(i => {
      const c = claimsById.get(i.claim_id)
      if (!c) return null
      const normalizedStatus = c.status === 'saved' ? 'verified' : c.status
      return {
        id: i.id,
        claimId: c.id,
        text: c.text,
        paperTitle: c.paper_title,
        doi: c.doi,
        paperUrl: c.paper_url,
        page: c.page ?? '',
        site: (c.site as InboxViewItem['site']),
        status: (normalizedStatus as InboxViewItem['status']),
        confidence: c.confidence ?? 0,
        quote: c.quote,
        reason: c.reason ?? '',
        projectId: c.project_id,
        savedAtMs: new Date(i.saved_at).getTime(),
        archived_at: i.archived_at ?? null,
      }
    })
    .filter((x): x is InboxViewItem => x !== null && (x.status === 'verified' || x.status === 'partial'))

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-[var(--rk-bg)]">
      {/* Header with site toggles and settings */}
      <Header
        activeSites={activeSites}
        onToggleSite={handleToggleSite}
        onOpenSettings={openSettings}
      />

      {/* Progress bar */}
      <ProgressBar progress={verifyProgress} onTogglePause={() => { void setGlobalPaused(!globalPaused) }} />

      {/* Tab bar for navigation */}
      <TabBar
        activeTab={tab}
        onSelect={setTab}
        inboxCount={inboxCount}
        conflictsCount={conflictsCount}
      />

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {tab === 'verify' && (
          <VerifyTab
            claims={currentTabId ? (claimsByTab.get(currentTabId) ?? []) : []}
            expandedIds={expandedClaimIds}
            onToggleExpand={toggleClaimExpand}
            onSave={onSave}
            savingIds={savingClaimIds}
            liveStepsByClaim={claimStepsById}
          />
        )}
        {tab === 'inbox' && (
          <InboxTab
            items={inboxViewItems}
            selectedIds={inboxSelectedIds}
            onToggleSelect={toggleInboxSelect}
            onArchive={handleArchive}
            onUnarchive={handleUnarchive}
            onAddToProject={handleAddToProject}
            onClearSelection={clearInboxSelection}
            onRemove={(id: string) => removeFromInbox(id)}
            loadError={inboxError}
            onRetry={() => currentProjectId && loadInbox(currentProjectId)}
          />
        )}
        {tab === 'conflicts' && (
          <ConflictsTab
            conflicts={conflicts.data}
            onConfirm={handleConfirmConflict}
            onSuggest={handleSuggestConflict}
          />
        )}
        {tab === 'chat' && <ChatTab />}
        {tab === 'draft' && <DraftTab demoRunId={currentProjectId ? demoDraftRunByProject[currentProjectId] : null} />}
        {tab === 'help' && <HelpTab />}
      </div>

      {/* Footer with project selector */}
      <Footer
        projects={projects.data}
        currentProjectId={currentProjectId ?? ''}
        onSwitchProject={switchProject}
        onCreateProject={() => setShowCreateProject(true)}
        onOpenDemo={() => { void handleOpenDemo() }}
        inboxSelectedCount={inboxSelectedIds.size}
        onClearSelection={clearInboxSelection}
        onEditProject={handleEditProject}
      />

      {/* Settings panel overlay */}
      {showSettings && (
        <SettingsPanel
          activeSites={Array.from(activeSites)}
          provider={provider}
          onToggleSite={handleToggleSite}
          onProviderChange={(p) => { void setProvider(p) }}
          onClose={closeSettings}
        />
      )}

      {/* Onboarding overlay */}
      {showOnboarding && (
        <OnboardingOverlay onComplete={() => setOnboardingDone(true)} />
      )}

      {/* Project creation modal */}
      {showCreateProject && (
        <ProjectCreateModal
          onCreate={async (name) => { await createProject(name) }}
          onClose={() => setShowCreateProject(false)}
        />
      )}

      {/* Add to project modal */}
      {showAddToProject && (
        <ProjectPickerModal
          projects={projects.data}
          selectedCount={showAddToProject.length}
          onSelect={async (projectId) => {
            const inboxData = useStore.getState().inbox.data
            const claimIds = (showAddToProject ?? [])
              .map(invId => inboxData.find(i => i.id === invId)?.claim_id)
              .filter((x): x is string => Boolean(x))
            await Promise.all(claimIds.map(id => addToInbox(projectId, id)))
            await archiveMany(showAddToProject ?? [])
            setShowAddToProject(null)
          }}
          onClose={() => setShowAddToProject(null)}
        />
      )}
      {editingProject && (
        <ProjectEditModal
          project={editingProject}
          onRename={handleRenameProject}
          onDelete={handleDeleteProject}
          onClose={() => setEditingProject(null)}
          deleteDisabled={useStore.getState().runs.size > 0}
        />
      )}
      {toast && (
        <div className="fixed right-3 bottom-3 z-[70] animate-toastIn">
          <Toast message={toast.message} tone={toast.tone} onDismiss={clearToast} />
        </div>
      )}
    </div>
  )
}

export function App() {
  const { user, loading, signIn } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen">Loading…</div>
  if (!user) return <LoginGate onSignIn={signIn} />
  return <AppContent userId={user.id} />
}
