import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { LibraryCard } from '../../shared/types/library.ts'
import { transaction } from './database.ts'
import { parseList } from './library.ts'

export interface UserRecord {
  id: string
  username: string
  password_hash: string
  created_at: string
}

export interface ProgressRow {
  title_id: string
  episode_id: string
  position: number
  duration: number
  updated_at: string
  title: string
  kind: 'movie' | 'series'
  poster_path: string | null
  year: number | null
  created_at: string
  cast_members: string
  episode_season: number | null
  episode_number: number | null
}

export function userStore(db: DatabaseSync) {
  const cardOf = (row: { id: string; kind: 'movie' | 'series'; title: string; year: number | null; poster_path: string | null; cast_members: string; created_at: string }): LibraryCard => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    year: row.year,
    posterUrl: row.poster_path ? `/api/posters/${row.id}` : null,
    runtime: null,
    cast: parseList(row.cast_members),
    addedAt: row.created_at,
  })

  const sql = {
    byName: db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE'),
    byId: db.prepare('SELECT * FROM users WHERE id = ?'),
    insert: db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)'),
    purgeSessionsByName: db.prepare('DELETE FROM user_sessions WHERE user_id = ?'),
    setPassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
    session: db.prepare(`SELECT u.* FROM user_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`),
    addSession: db.prepare('INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    removeSession: db.prepare('DELETE FROM user_sessions WHERE token_hash = ?'),
    expireSessions: db.prepare('DELETE FROM user_sessions WHERE expires_at <= ?'),
    addFavorite: db.prepare(`INSERT INTO favorites (user_id, title_id, created_at) VALUES (?, ?, ?)
      ON CONFLICT (user_id, title_id) DO NOTHING`),
    removeFavorite: db.prepare('DELETE FROM favorites WHERE user_id = ? AND title_id = ?'),
    favoriteIds: db.prepare('SELECT title_id FROM favorites WHERE user_id = ? ORDER BY created_at DESC'),
    hasFavorite: db.prepare('SELECT 1 AS hit FROM favorites WHERE user_id = ? AND title_id = ?'),
    catalog: db.prepare(`SELECT t.id, t.kind, t.title, t.year, t.poster_path, t.cast_members, t.created_at
      FROM favorites f JOIN titles t ON t.id = f.title_id
      WHERE f.user_id = ? AND EXISTS (SELECT 1 FROM media_files m WHERE m.title_id = t.id)
      ORDER BY f.created_at DESC`),
    available: db.prepare(`SELECT EXISTS (SELECT 1 FROM media_files p WHERE p.title_id = ?
      AND p.available = 1) AS available`),
    saveProgress: db.prepare(`INSERT INTO playback_progress (user_id, title_id, episode_id, position, duration, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, title_id, episode_id) DO UPDATE SET
        position = excluded.position, duration = excluded.duration, updated_at = excluded.updated_at`),
    clearProgress: db.prepare('DELETE FROM playback_progress WHERE user_id = ? AND title_id = ? AND episode_id = ?'),
    clearTitleProgress: db.prepare('DELETE FROM playback_progress WHERE user_id = ? AND title_id = ?'),
    // Only rows whose title still has a playable file are worth resuming.
    recentProgress: db.prepare(`SELECT p.title_id, p.episode_id, p.position, p.duration, p.updated_at,
        t.title, t.kind, t.poster_path, t.year, t.created_at, t.cast_members,
        e.season AS episode_season, e.episode AS episode_number
      FROM playback_progress p
      JOIN titles t ON t.id = p.title_id
      LEFT JOIN episodes e ON e.id = p.episode_id AND p.episode_id <> ''
      WHERE p.user_id = ? AND EXISTS (
        SELECT 1 FROM media_files m WHERE m.title_id = t.id AND m.available = 1)
      ORDER BY p.updated_at DESC LIMIT ?`),
  }

  return {
    byName: (username: string) => sql.byName.get(username) as unknown as UserRecord | undefined,
    byId: (id: string) => sql.byId.get(id) as unknown as UserRecord | undefined,
    // A name is unique per library, and the first registration wins.
    create(username: string, passwordHash: string): UserRecord | null {
      return transaction(db, () => {
        const id = randomUUID()
        try {
          sql.insert.run(id, username, passwordHash, new Date().toISOString())
        } catch {
          return null
        }
        return sql.byId.get(id) as unknown as UserRecord
      })
    },
    session: (tokenHash: string, now: number) => sql.session.get(tokenHash, now) as unknown as UserRecord | undefined,
    addSession: (tokenHash: string, userId: string, expiresAt: number) => { sql.addSession.run(tokenHash, userId, expiresAt) },
    removeSession: (tokenHash: string) => { sql.removeSession.run(tokenHash) },
    // A password change invalidates every session for that account.
    setPassword(userId: string, passwordHash: string) {
      transaction(db, () => {
        sql.setPassword.run(passwordHash, userId)
        sql.purgeSessionsByName.run(userId)
      })
    },
    expireSessions: (now: number) => { sql.expireSessions.run(now) },
    addFavorite: (userId: string, titleId: string) => {
      sql.addFavorite.run(userId, titleId, new Date().toISOString())
    },
    removeFavorite: (userId: string, titleId: string) => {
      sql.removeFavorite.run(userId, titleId)
    },
    hasFavorite: (userId: string, titleId: string) => Boolean(sql.hasFavorite.get(userId, titleId)),
    favoriteIds: (userId: string) => (sql.favoriteIds.all(userId) as unknown as { title_id: string }[]).map(row => row.title_id),
    favorites: (userId: string): LibraryCard[] =>
      (sql.catalog.all(userId) as unknown as Parameters<typeof cardOf>[0][]).map(row => ({
        ...cardOf(row),
        available: Boolean((sql.available.get(row.id) as unknown as { available: 0 | 1 }).available),
      })),
    // Saving a finished title clears its progress instead of leaving a 100% row.
    saveProgress(userId: string, titleId: string, episodeId: string, position: number, duration: number) {
      sql.saveProgress.run(userId, titleId, episodeId, position, duration, new Date().toISOString())
    },
    clearProgress: (userId: string, titleId: string, episodeId: string) => {
      sql.clearProgress.run(userId, titleId, episodeId)
    },
    clearTitleProgress: (userId: string, titleId: string) => { sql.clearTitleProgress.run(userId, titleId) },
    recentProgress: (userId: string, limit: number): ProgressRow[] => sql.recentProgress.all(userId, limit) as unknown as ProgressRow[],
    cardOf,
  }
}

export type UserStore = ReturnType<typeof userStore>
