export class ApiError extends Error {
  status: number
  body: string
  code?: string

  constructor(status: number, body: string, code?: string) {
    super(`HTTP ${status}: ${body}`)
    this.status = status
    this.body = body
    this.code = code
    this.name = 'ApiError'
  }

  static async fromResponse(res: Response): Promise<ApiError> {
    const text = await res.text()
    let code: string | undefined
    if (res.headers.get('content-type')?.includes('application/json')) {
      try { code = JSON.parse(text)?.error?.code } catch { /* ignore */ }
    }
    return new ApiError(res.status, text, code)
  }
}

export class AuthExpiredError extends Error {
  constructor() { super('Auth expired'); this.name = 'AuthExpiredError' }
}
