import type { LibraryStore, MediaRecord } from '../db/library.ts'
import { recognize, titleIdentity } from '../domain/recognition.ts'
import { pathKey } from '../storage/paths.ts'
import type { FoundFile } from '../storage/paths.ts'

// Indexing is now unconditional: a file that scans successfully is in the library.
// There is no pending state to resolve, no duplicate bookkeeping, and no reason to
// ask the administrator anything — the filename decides the title and the kind.
export function indexMedia(
  store: LibraryStore,
  entry: FoundFile,
  available: boolean,
  durationSeconds?: number | null,
): { id: string; titleId: string | null } {
  const key = pathKey(entry.relative)
  const existing = store.fileAt(key)
  const identified = recognize(entry.relative)

  let titleId = existing?.title_id ?? null
  let episodeId = existing?.episode_id ?? null

  // An existing row keeps its hand-edited title; only a new file creates one.
  if (!titleId) {
    const identity = titleIdentity(identified.kind, identified.title, identified.year)
    const found = store.findIdentity(identity)
    if (found) {
      titleId = found.id
    } else {
      titleId = store.createTitle(identified.kind, {
        title: identified.title,
        year: identified.year,
        description: '',
        poster_path: null,
        cast_members: identified.actor ? JSON.stringify([identified.actor]) : '[]',
      }, identity)
    }
  }

  if (identified.kind === 'series' && identified.episode !== null && titleId) {
    const season = identified.season ?? 1
    const slot = store.episodeAt(titleId, season, identified.episode)
    episodeId = slot?.id ?? store.createEpisode(titleId, season, identified.episode)
  } else {
    episodeId = null
  }

  if (existing) {
    store.observe(existing.id, {
      relative_path: entry.relative, size: entry.stamp.size, mtime: entry.stamp.mtime,
      available: available ? 1 : 0,
    })
    store.associate(existing.id, titleId, episodeId)
    return { id: existing.id, titleId }
  }

  const id = store.createFile({
    relative_path: entry.relative, path_key: key, size: entry.stamp.size, mtime: entry.stamp.mtime,
    available: available ? 1 : 0, title_id: titleId, episode_id: episodeId,
  })
  return { id, titleId }
}

// Titles left without any file are removed, so the admin list never shows orphans.
export function pruneOrphans(store: LibraryStore): number {
  const rows = store.files()
  const live = new Set<string>()
  for (const row of rows) {
    if (row.title_id) live.add(row.title_id)
  }
  let removed = 0
  for (const title of store.titles()) {
    if (live.has(title.id)) continue
    store.deleteTitle(title.id)
    removed++
  }
  return removed
}

export type IndexedMedia = MediaRecord
