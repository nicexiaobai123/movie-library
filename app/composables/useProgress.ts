import type { ContinueWatching, ContinueWatchingItem, ProgressInput } from '#shared/types/library'

// Resume points are per visitor, so this hook is only useful once signed in.
export async function useContinueWatching() {
  const request = useRequestFetch()
  const { data, refresh } = await useAsyncData<ContinueWatching>('continue-watching',
    () => request<ContinueWatching>('/api/user/progress', { headers: useRequestHeaders(['cookie']) }),
    { default: () => ({ items: [] }) })
  const items = computed<ContinueWatchingItem[]>(() => data.value?.items ?? [])
  return { items, refresh }
}

// Writes are fire-and-forget: a dropped progress update must never disturb playback.
export function recordPlaybackProgress(input: ProgressInput): Promise<void> {
  return $fetch('/api/user/progress', { method: 'PUT', body: input }).then(() => undefined).catch(() => undefined)
}

export function watchResumeUrl(item: ContinueWatchingItem): { path: string; query?: Record<string, string> } {
  return item.episodeId
    ? { path: `/watch/${encodeURIComponent(item.id)}`, query: { episode: item.episodeId } }
    : { path: `/watch/${encodeURIComponent(item.id)}` }
}

export function progressPercent(item: { position: number; duration: number }): number {
  if (!(item.duration > 0)) return 0
  return Math.max(0, Math.min(100, Math.round((item.position / item.duration) * 100)))
}
