export interface LibraryConfigInput {
  dbPath?: unknown
  mediaRoot?: unknown
  scanIntervalMs?: unknown
  stableMs?: unknown
  maxUploadBytes?: unknown
  allowedOrigins?: unknown
  secureCookies?: unknown
}

export interface LibraryConfig {
  dbPath: string
  mediaRoot: string
  scanIntervalMs: number
  stableMs: number
  maxUploadBytes: number
  allowedOrigins: string[]
  secureCookies: boolean
}

function integer(value: unknown, name: string, minimum: number, maximum: number, fallback: number): number {
  if (value === undefined || value === '') return fallback
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`Invalid setting ${name}: expected an integer in ${minimum}..${maximum}`)
  }
  return number
}

export function libraryConfig(input: LibraryConfigInput): LibraryConfig {
  const paths = {
    dbPath: typeof input.dbPath === 'string' && input.dbPath ? input.dbPath : '.data/library.sqlite',
    mediaRoot: typeof input.mediaRoot === 'string' && input.mediaRoot ? input.mediaRoot : 'media',
  }
  const allowedOrigins = typeof input.allowedOrigins === 'string' ? input.allowedOrigins.split(',').map(value => value.trim()).filter(Boolean) : []
  for (const value of allowedOrigins) {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value) {
      throw new Error('NUXT_LIBRARY_ALLOWED_ORIGINS must contain exact HTTP(S) origins without trailing slashes')
    }
  }
  if (![undefined, '', false, true, 'false', 'true'].includes(input.secureCookies as boolean | string | undefined)) {
    throw new Error('NUXT_LIBRARY_SECURE_COOKIES must be true or false')
  }
  return {
    ...paths,
    // Scans are on demand by default: nothing appears in the admin file list until
    // someone asks for a sweep. A periodic sweep is opt-in via the environment.
    scanIntervalMs: integer(input.scanIntervalMs, 'NUXT_LIBRARY_SCAN_INTERVAL_MS', 0, 2 ** 31 - 1, 0),
    stableMs: integer(input.stableMs, 'NUXT_LIBRARY_STABLE_MS', 100, 2 ** 31 - 1, 8_000),
    maxUploadBytes: integer(input.maxUploadBytes, 'NUXT_LIBRARY_MAX_UPLOAD_BYTES', 16, Number.MAX_SAFE_INTEGER, 32 * 1024 ** 3),
    allowedOrigins,
    secureCookies: input.secureCookies === true || input.secureCookies === 'true',
  }
}
