import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { migrations } from './migrations.ts'

export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = work()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function openDatabase(configuredPath: string): DatabaseSync {
  const filename = resolve(configuredPath)
  if (process.platform === 'win32' && /^\\\\(?:\?\\UNC\\)?[^\\]/i.test(filename)) {
    throw new Error('SQLite must use a local persistent Windows drive, not a network share')
  }
  mkdirSync(dirname(filename), { recursive: true })
  const db = new DatabaseSync(filename, { enableForeignKeyConstraints: true })
  try {
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
    transaction(db, () => {
      let { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number }
      if (current > (migrations.at(-1)?.version ?? 0)) {
        throw new Error('Database was created by a newer version of the application')
      }
      for (const migration of migrations) {
        if (migration.version <= current) continue
        if (migration.version !== current + 1) throw new Error('Missing database migration')
        db.exec(migration.sql)
        db.exec(`PRAGMA user_version = ${migration.version}`)
        current = migration.version
      }
    })
    return db
  } catch (error) {
    db.close()
    throw error
  }
}
