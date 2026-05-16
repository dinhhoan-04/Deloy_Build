// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Session = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Capture = any

export interface StorageSchema {
  active_session_id: string | null
  sessions: { [id: string]: Session }
  captures: { [id: string]: Capture }
}

async function getStorage(): Promise<StorageSchema> {
  const result = (await chrome.storage.local.get()) as Record<string, any>
  return {
    active_session_id: (result.active_session_id as string | null) ?? null,
    sessions: (result.sessions as { [id: string]: Session }) ?? {},
    captures: (result.captures as { [id: string]: Capture }) ?? {}
  }
}

async function setStorage(schema: StorageSchema): Promise<void> {
  await chrome.storage.local.set(schema)
}

export async function getActiveSession(): Promise<Session | null> {
  const storage = await getStorage()
  if (!storage.active_session_id) return null
  return storage.sessions[storage.active_session_id] ?? null
}

export async function setActiveSession(sessionId: string | null): Promise<void> {
  const storage = await getStorage()
  storage.active_session_id = sessionId
  await setStorage(storage)
}

export async function createSession(name: string): Promise<Session> {
  const storage = await getStorage()
  const id = crypto.randomUUID()
  const session: Session = {
    id,
    name,
    created_at: new Date().toISOString(),
    capture_ids: [],
  }
  storage.sessions[id] = session
  if (!storage.active_session_id) {
    storage.active_session_id = id
  }
  await setStorage(storage)
  return session
}

export async function renameSession(sessionId: string, newName: string): Promise<void> {
  const storage = await getStorage()
  if (storage.sessions[sessionId]) {
    storage.sessions[sessionId].name = newName
    await setStorage(storage)
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  const storage = await getStorage()
  delete storage.sessions[sessionId]

  const captureIds = Object.keys(storage.captures).filter(
    (id) => storage.captures[id].session_id === sessionId
  )
  captureIds.forEach((id) => delete storage.captures[id])

  if (storage.active_session_id === sessionId) {
    const remainingSessions = Object.keys(storage.sessions)
    storage.active_session_id = remainingSessions.length > 0 ? remainingSessions[0] : null
  }

  await setStorage(storage)
}

export async function addCapture(capture: Capture): Promise<void> {
  const storage = await getStorage()
  storage.captures[capture.id] = capture

  if (capture.session_id && storage.sessions[capture.session_id]) {
    const session = storage.sessions[capture.session_id]
    if (!session.capture_ids.includes(capture.id)) {
      session.capture_ids.unshift(capture.id)
    }
  }

  await setStorage(storage)
}

export async function updateCapture(captureId: string, patch: Partial<Capture>): Promise<void> {
  const storage = await getStorage()
  if (storage.captures[captureId]) {
    storage.captures[captureId] = {
      ...storage.captures[captureId],
      ...patch,
    }
    await setStorage(storage)
  }
}

export async function deleteCapture(captureId: string): Promise<void> {
  const storage = await getStorage()
  const capture = storage.captures[captureId]

  delete storage.captures[captureId]

  if (capture && capture.session_id && storage.sessions[capture.session_id]) {
    const session = storage.sessions[capture.session_id]
    session.capture_ids = session.capture_ids.filter((id: string) => id !== captureId)
  }

  await setStorage(storage)
}

export async function listSessionsWithCounts(): Promise<
  Array<Session & { capture_count: number }>
> {
  const storage = await getStorage()
  return Object.values(storage.sessions).map((session) => ({
    ...session,
    capture_count: session.capture_ids.length,
  }))
}

export async function getSessionCaptures(sessionId: string): Promise<Capture[]> {
  const storage = await getStorage()
  const session = storage.sessions[sessionId]
  if (!session) return []
  return session.capture_ids
    .map((id: string) => storage.captures[id])
    .filter((c: Capture): c is Capture => !!c)
}

export async function getCapture(captureId: string): Promise<Capture | null> {
  const storage = await getStorage()
  return storage.captures[captureId] ?? null
}

export async function clearAllStorage(): Promise<void> {
  await chrome.storage.local.clear()
}
