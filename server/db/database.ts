import { mkdirSync, rmSync } from 'node:fs'
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

const schemaVersion = migrations.at(-1)?.version ?? 0

// The library is derived from the media folder, so an unreadable or outdated
// database is simply replaced: a scan rebuilds everything it holds.
function rebuild(filename: string): void {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${filename}${suffix}`, { force: true })
}

export function openDatabase(configuredPath: string): DatabaseSync {
  const filename = resolve(configuredPath)
  if (process.platform === 'win32' && /^\\\\(?:\?\\UNC\\)?[^\\]/i.test(filename)) {
    throw new Error('SQLite must use a local persistent Windows drive, not a network share')
  }
  mkdirSync(dirname(filename), { recursive: true })

  const adopt = (): DatabaseSync => {
    const db = new DatabaseSync(filename, { enableForeignKeyConstraints: true })
    try {
      db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
      transaction(db, () => {
        const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number }
        // A brand-new file is fine: the migrations below build it. Any other
        // version that does not match this build is replaced by the caller.
        if (current !== 0 && current !== schemaVersion) {
          throw new Error(`Schema ${current} is not ${schemaVersion}`)
        }
        let version = current
        for (const migration of migrations) {
          if (migration.version <= version) continue
          if (migration.version !== version + 1) throw new Error('Missing database migration')
          db.exec(migration.sql)
          db.exec(`PRAGMA user_version = ${migration.version}`)
          version = migration.version
        }
      })
      return db
    } catch (error) {
      db.close()
      throw error
    }
  }

  try {
    return adopt()
  } catch (error) {
    // Only an incompatible database is rebuilt; a real I/O error must surface.
    if (!(error instanceof Error) || !/^Schema .* is not /.test(error.message)) throw error
    console.warn('[library] Rebuilding the database: the stored schema is out of date.')
    rebuild(filename)
    return adopt()
  }
}
