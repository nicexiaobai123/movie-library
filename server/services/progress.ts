import type { ContinueWatching, ContinueWatchingItem, ProgressInput } from '../../shared/types/library.ts'
import { card } from '../db/library.ts'
import type { ProgressRow, UserRecord, UserStore } from '../db/users.ts'
import { LibraryError } from '../domain/errors.ts'
import type { LibraryStore } from '../db/library.ts'

// Positions closer to the end than this are treated as finished and dropped, so
// "continue watching" never shows a title the viewer already completed.
const finishedRatio = 0.97
const recentLimit = 12

export function createProgress(users: UserStore, library: LibraryStore) {
  function assertPlayable(titleId: string) {
    if (!library.detail(titleId)) throw new LibraryError(404, '未找到这部作品。')
  }

  function toItem(row: ProgressRow): ContinueWatchingItem {
    const base = card({
      id: row.title_id, kind: row.kind, title: row.title, year: row.year,
      description: '', poster_path: row.poster_path, identity_key: null, created_at: row.created_at,
      original_title: row.original_title, genres: row.genres, region: null, rating: row.rating,
      runtime: null, director: null, cast_members: '[]', backdrop_path: row.backdrop_path,
      available: 1,
    })
    const episodeLabel = row.episode_number === null
      ? null
      : `第 ${row.episode_season ?? 1} 季第 ${row.episode_number} 集${row.episode_title ? ` · ${row.episode_title}` : ''}`
    const percent = row.duration > 0 ? Math.min(100, Math.round((row.position / row.duration) * 100)) : 0
    return { ...base, episodeId: row.episode_id || null, episodeLabel, position: row.position, duration: row.duration, percent }
  }

  return {
    list(user: UserRecord): ContinueWatching {
      return { items: users.recentProgress(user.id, recentLimit).map(toItem) }
    },
    record(user: UserRecord, input: ProgressInput): { cleared: boolean } {
      assertPlayable(input.titleId)
      const episodeId = input.episodeId ?? ''
      if (input.duration > 0 && input.position / input.duration >= finishedRatio) {
        users.clearProgress(user.id, input.titleId, episodeId)
        return { cleared: true }
      }
      users.saveProgress(user.id, input.titleId, episodeId, Math.max(0, input.position), input.duration)
      return { cleared: false }
    },
    clear(user: UserRecord, titleId: string) {
      users.clearTitleProgress(user.id, titleId)
    },
  }
}

export type Progress = ReturnType<typeof createProgress>
