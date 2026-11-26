import type { LibraryStore, MediaRecord } from '../db/library.ts'
import { recognize, titleIdentity } from '../domain/recognition.ts'
import type { IdentifiedMedia } from '../domain/recognition.ts'
import type { FoundFile } from '../storage/paths.ts'
import { pathKey } from '../storage/paths.ts'
import { defaultDescriptionKey } from './settings.ts'

export const invalidMedia = '未检测到完整的 MP4 视频结构，文件暂不可用。'
export const duplicateSlot = '同一影片或同一集有多份文件，请在后台选择要发布的文件。'

export function slotKey(match: IdentifiedMedia): string {
  return JSON.stringify([titleIdentity(match.kind, match.title, match.year), match.season, match.episode])
}

export function recognizedSlot(relative: string): string | null {
  const { match } = recognize(relative)
  return match ? slotKey(match) : null
}

export function pendingClaims(rows: MediaRecord[]): Set<string> {
  const slots = new Set<string>()
  for (const row of rows) {
    if (row.state !== 'pending' || !row.available || row.reason !== duplicateSlot) continue
    const slot = recognizedSlot(row.relative_path)
    if (slot) slots.add(slot)
  }
  return slots
}

export function canAutoIndex(existing: MediaRecord | undefined, valid: boolean): boolean {
  return valid && (!existing || (!existing.valid_mp4 && existing.state === 'pending' && existing.reason === invalidMedia))
}

// Both scan and upload call this inside a database transaction. A path with an
// established state refreshes only its file facts, never its edited association.
export function indexMedia(
  store: LibraryStore,
  entry: FoundFile,
  valid: boolean,
  source: 'scan' | 'upload',
  conflicts: ReadonlySet<string>,
): { id: string; state: MediaRecord['state']; added: boolean } {
  const key = pathKey(entry.relative)
  const existing = store.fileAt(key)
  const observation = {
    relative_path: entry.relative, size: entry.stamp.size, mtime: entry.stamp.mtime,
    available: (valid ? 1 : 0) as 0 | 1, valid_mp4: (valid ? 1 : 0) as 0 | 1,
  }
  if (existing && !canAutoIndex(existing, valid)) {
    const reason = valid ? (existing.reason === invalidMedia ? null : existing.reason) : (existing.reason ?? invalidMedia)
    store.observe(existing.id, { ...observation, reason })
    return { id: existing.id, state: existing.state, added: false }
  }

  const recognition = recognize(entry.relative)
  const match = valid ? recognition.match : null
  let reason = valid ? recognition.reason : invalidMedia
  let titleId: string | null = null
  let episodeId: string | null = null
  if (match) {
    const identity = titleIdentity(match.kind, match.title, match.year)
    const existingTitle = store.findIdentity(identity)
    const existingEpisode = match.kind === 'series' && existingTitle
      ? store.episodeAt(existingTitle.id, match.season, match.episode) : undefined
    const occupied = existingTitle && (match.kind === 'movie' || existingEpisode)
      ? store.publishedFor(existingTitle.id, existingEpisode?.id ?? null) : undefined
    if (occupied || conflicts.has(slotKey(match))) reason = duplicateSlot
    else {
      titleId = existingTitle?.id ?? store.createTitle(match.kind, {
        title: match.title, year: match.year, description: store.setting(defaultDescriptionKey) ?? '', poster_path: null,
        original_title: null, genres: '[]', region: null, rating: null, runtime: null, director: null,
        cast_members: '[]', backdrop_path: null,
      }, identity)
      if (match.kind === 'series') episodeId = existingEpisode?.id ?? store.createEpisode(titleId, match.season, match.episode, null)
    }
  }
  const state = titleId ? 'published' : 'pending'
  if (existing) {
    store.observe(existing.id, { ...observation, reason })
    store.associate(existing.id, { state, reason, title_id: titleId, episode_id: episodeId })
    return { id: existing.id, state, added: false }
  }
  const id = store.createFile({
    ...observation, path_key: key, source, state, reason, title_id: titleId, episode_id: episodeId,
  })
  return { id, state, added: true }
}
