import type { AdminSettings } from '../../shared/types/library.ts'
import type { LibraryStore } from '../db/library.ts'

export const defaultDescriptionKey = 'default_description'
export const descriptionLimit = 6000

// A single row of library-wide defaults; blank values are stored as empty strings.
export function readSettings(store: LibraryStore): AdminSettings {
  return { defaultDescription: store.setting(defaultDescriptionKey) ?? '' }
}

export function saveSettings(store: LibraryStore, input: { defaultDescription: string }): AdminSettings {
  store.saveSetting(defaultDescriptionKey, input.defaultDescription)
  return readSettings(store)
}
