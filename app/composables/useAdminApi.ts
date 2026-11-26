import type { AdminLibrary, AdminMedia, AdminSettings, BulkEditItem, BulkEditResult, MediaEdit, ScanStatus } from '#shared/types/library'

interface AdminSession {
  username: string
}

export function useAdminApi() {
  const request = useRequestFetch()
  const readOptions = { cache: 'no-store', retry: 0, timeout: 20_000 } as const

  return {
    session: () => request<AdminSession>('/api/admin/session', readOptions),
    library: () => request<AdminLibrary>('/api/admin/library', readOptions),
    scanStatus: () => request<ScanStatus>('/api/admin/scan', readOptions),
    login: (body: { username: string; password: string }) => request<AdminSession>('/api/admin/login', {
      method: 'POST', body, retry: 0, timeout: 20_000,
    }),
    logout: () => request<{ ok: true }>('/api/admin/logout', {
      method: 'POST', retry: 0, timeout: 20_000,
    }),
    startScan: () => request<ScanStatus>('/api/admin/scan', {
      method: 'POST', retry: 0, timeout: 20_000,
    }),
    editMedia: (id: string, body: MediaEdit) => request<{ item: AdminMedia }>(`/api/admin/media/${encodeURIComponent(id)}`, {
      method: 'PATCH', body, retry: 0, timeout: 20_000,
    }),
    publishMany: (items: BulkEditItem[]) => request<BulkEditResult>('/api/admin/media/bulk', {
      method: 'POST', body: { items }, retry: 0, timeout: 120_000,
    }),
    saveSettings: (body: AdminSettings) => request<AdminSettings>('/api/admin/settings', {
      method: 'PUT', body, retry: 0, timeout: 20_000,
    }),
  }
}

function errorRecord(value: unknown) {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

function errorDetails(error: unknown) {
  const outer = errorRecord(error)
  const response = errorRecord(outer?.response)
  const body = errorRecord(response?._data) ?? errorRecord(outer?.data)
  const data = errorRecord(body?.data)
  return { outer, response, body, data }
}

export function adminErrorStatus(error: unknown): number | undefined {
  const { outer, response, body } = errorDetails(error)
  const status = outer?.statusCode ?? outer?.status ?? response?.status ?? body?.statusCode
  return typeof status === 'number' ? status : undefined
}

export function adminErrorCode(error: unknown): string | undefined {
  const { body, data } = errorDetails(error)
  const code = data?.code ?? body?.code
  return typeof code === 'string' ? code : undefined
}

export function adminErrorMessage(error: unknown, fallback: string): string {
  const { outer, body, data } = errorDetails(error)
  const candidates = [data?.message, body?.message, data?.statusMessage, body?.statusMessage, outer?.statusMessage]
  return candidates.find((value): value is string => typeof value === 'string' && /\p{Script=Han}/u.test(value)) ?? fallback
}

export function formatAdminBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value)} ${units[unit]}`
}
