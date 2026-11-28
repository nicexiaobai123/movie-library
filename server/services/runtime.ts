import { adminStore } from '../db/admin.ts'
import { openDatabase } from '../db/database.ts'
import { libraryStore } from '../db/library.ts'
import { userStore } from '../db/users.ts'
import { libraryConfig } from '../domain/config.ts'
import type { LibraryConfigInput } from '../domain/config.ts'
import { createAuth } from './auth.ts'
import { createCatalog } from './catalog.ts'
import { createFavorites } from './favorites.ts'
import { createProgress } from './progress.ts'
import { createUserAuth } from './user-auth.ts'

function createRuntime(input: LibraryConfigInput) {
  const config = libraryConfig(input)
  const db = openDatabase(config.dbPath)
  const library = libraryStore(db)
  const users = userStore(db)
  const catalog = createCatalog(library, config)
  const auth = createAuth(adminStore(db))
  return {
    config, db, catalog, auth, users,
    userAuth: createUserAuth(users),
    favorites: createFavorites(users, library),
    progress: createProgress(users, library),
  }
}
export type LibraryRuntime = ReturnType<typeof createRuntime>
let runtime: LibraryRuntime | undefined

export function getLibraryRuntime(input: LibraryConfigInput): LibraryRuntime {
  return runtime ??= createRuntime(input)
}

export async function closeLibraryRuntime(): Promise<void> {
  if (!runtime) return
  await runtime.catalog.scanner.finish()
  runtime.db.close()
  runtime = undefined
}
