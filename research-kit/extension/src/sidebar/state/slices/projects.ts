import * as api from '../../../shared/api'
import type { Project } from '../../../shared/types'
import { idle } from './_slice'
import type { Slice } from './_slice'

export interface ProjectsSlice {
  projects: Slice<Project[]>
  loadProjects(): Promise<void>
  createProject(name: string): Promise<Project>
  updateProject(id: string, name: string): Promise<void>
  deleteProject(id: string): Promise<void>
}

export function createProjectsSlice(set: any, get: any): ProjectsSlice {
  return {
    projects: idle<Project[]>([]),
    async loadProjects() {
      set((s: any) => ({ projects: { ...s.projects, status: 'loading' } }))
      try {
        const data = await api.listProjects()
        set({ projects: { data, status: 'ready', lastFetched: Date.now() } })
      } catch (e: any) {
        set((s: any) => ({ projects: { ...s.projects, status: 'error', error: e.message } }))
      }
    },
    async createProject(name) {
      const p = await api.createProject(name)
      await get().loadProjects()
      return p
    },
    async updateProject(id, name) {
      await api.updateProject(id, name)
      await get().loadProjects()
    },
    async deleteProject(id) {
      await api.deleteProject(id)
      set((s: any) => {
        const remaining = s.projects.data.filter((p: Project) => p.id !== id)
        const nextId = s.currentProjectId === id
          ? (remaining[0]?.id ?? null)
          : s.currentProjectId
        return {
          projects: { ...s.projects, data: remaining },
          currentProjectId: nextId,
        }
      })
    },
  }
}
