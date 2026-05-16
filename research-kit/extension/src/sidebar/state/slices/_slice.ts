export interface Slice<T> {
  data: T
  status: 'idle' | 'loading' | 'ready' | 'error'
  error?: string
  lastFetched?: number
}
export const idle = <T>(data: T): Slice<T> => ({ data, status: 'idle' })
