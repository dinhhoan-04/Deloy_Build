export function genId(prefix: 'p' | 'inb' | 'cf'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

export function normalizeTitle(title: string | null): string {
  if (!title) return ''
  return title.toLowerCase().replace(/\s+/g, ' ').trim()
}
