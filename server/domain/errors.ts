export class LibraryError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 405 | 409 | 413 | 415 | 422 | 429 | 500 | 503

  readonly code?: string

  constructor(status: LibraryError['status'], message: string, code?: string) {
    super(message)
    this.name = 'LibraryError'
    this.status = status
    this.code = code
  }
}

export function errorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code
  }
}
