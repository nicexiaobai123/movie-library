import type { DatabaseSync } from 'node:sqlite'
import { transaction } from './database.ts'

export function setAdmin(db: DatabaseSync, username: string, passwordHash: string) {
  transaction(db, () => {
    db.prepare(`INSERT INTO admin_account (id, username, password_hash) VALUES (1, ?, ?)
      ON CONFLICT (id) DO UPDATE SET username = excluded.username, password_hash = excluded.password_hash`).run(username, passwordHash)
    db.exec('DELETE FROM admin_sessions')
  })
}

export function adminStore(db: DatabaseSync) {
  const account = db.prepare('SELECT username, password_hash FROM admin_account WHERE id = 1')
  const find = db.prepare(`SELECT a.username FROM admin_sessions s JOIN admin_account a ON a.id = 1
    WHERE s.token_hash = ? AND s.expires_at > ?`)
  const insert = db.prepare('INSERT INTO admin_sessions (token_hash, expires_at) VALUES (?, ?)')
  const remove = db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?')
  const expire = db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?')

  return {
    account: () => account.get() as { username: string; password_hash: string } | undefined,
    find: (tokenHash: string, now: number) => find.get(tokenHash, now) as { username: string } | undefined,
    add: (tokenHash: string, expiresAt: number) => { insert.run(tokenHash, expiresAt) },
    remove: (tokenHash: string) => { remove.run(tokenHash) },
    expire: (now: number) => { expire.run(now) },
  }
}
