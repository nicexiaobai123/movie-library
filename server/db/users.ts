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

// Display-only card for a favourite; the catalog's own visibility rules are
// applied by the caller before this is used.
export interface FavoriteRow extends UserRecord {
  title_id: string
}

export function userStore(db: DatabaseSync) {
  const sql = {
    byName: db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE'),
    byId: db.prepare('SELECT * FROM users WHERE id = ?'),
    insert: db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)'),
    purgeSessionsByName: db.prepare('DELETE FROM user_sessions WHERE user_id = ?'),
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
    catalog: db.prepare(`SELECT t.* FROM favorites f JOIN titles t ON t.id = f.title_id
      WHERE f.user_id = ? AND EXISTS (SELECT 1 FROM media_files m WHERE m.title_id = t.id AND m.state = 'published')
      ORDER BY f.created_at DESC`),    available: db.prepare(`SELECT EXISTS (SELECT 1 FROM media_files p WHERE p.title_id = ?
      AND p.state = 'published' AND p.available = 1) AS available`),
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
    expireSessions: (now: number) => { sql.expireSessions.run(now) },
    addFavorite: (userId: string, titleId: string) => {
      sql.addFavorite.run(userId, titleId, new Date().toISOString())
    },
    removeFavorite: (userId: string, titleId: string) => {
      sql.removeFavorite.run(userId, titleId)
    },
    hasFavorite: (userId: string, titleId: string) => Boolean(sql.hasFavorite.get(userId, titleId)),
    favoriteIds: (userId: string) => (sql.favoriteIds.all(userId) as unknown as { title_id: string }[]).map(row => row.title_id),
    favorites: (userId: string): LibraryCard[] => (sql.catalog.all(userId) as unknown as {
      id: string; kind: 'movie' | 'series'; title: string; year: number | null; poster_path: string | null
      backdrop_path: string | null; rating: number | null; genres: string; created_at: string; original_title: string | null
    }[]).map(row => ({
      id: row.id, kind: row.kind, title: row.title, originalTitle: row.original_title, year: row.year,
      posterUrl: row.poster_path ? `/api/posters/${row.id}` : null,
      backdropUrl: row.backdrop_path ? `/api/posters/${row.id}?variant=backdrop` : null,
      rating: row.rating, genres: parseList(row.genres), addedAt: row.created_at,
      available: Boolean((sql.available.get(row.id) as unknown as { available: 0 | 1 }).available),
    })),
  }
}

export type UserStore = ReturnType<typeof userStore>
