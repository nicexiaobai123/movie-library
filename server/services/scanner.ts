import { randomUUID } from 'node:crypto'
import type { ScanResult, ScanStatus } from '../../shared/types/library.ts'
import type { LibraryStore } from '../db/library.ts'
import type { LibraryConfig } from '../domain/config.ts'
import { errorCode, LibraryError } from '../domain/errors.ts'
import { readDuration, validMp4 } from '../storage/formats.ts'
import { assertRootUnchanged, fileStamp, inspectMediaFile, inventory, isMissing, openMediaFile, resolveMediaRoot, sameStamp } from '../storage/paths.ts'
import type { FoundFile } from '../storage/paths.ts'
import { sweepStaging } from '../storage/uploads.ts'
import { indexMedia, pruneOrphans } from './index-media.ts'

// A sweep reads the folder and makes the library match it. Nothing here waits for
// the administrator: a file that is not yet a complete MP4 is stored as unavailable
// and becomes available on the next sweep that can read it.
export function createScanner(store: LibraryStore, config: LibraryConfig, uploadInProgress: ReadonlySet<string>) {
  let active: Promise<void> | null = null

  const status = (): ScanStatus => ({ running: active !== null, last: store.lastScan() })

  async function run(): Promise<void> {
    const startedAt = new Date().toISOString()
    const id = randomUUID()
    try {
      const root = await resolveMediaRoot(config.mediaRoot)
      const found = await inventory(root)
      const stable = new Map<string, { entry: FoundFile; valid: boolean; duration: number | null }>()

      for (const [key, entry] of found) {
        if (uploadInProgress.has(key)) continue
        let file: Awaited<ReturnType<typeof openMediaFile>> | undefined
        try {
          file = await openMediaFile(root, entry.relative)
          const valid = sameStamp(file.stamp, entry.stamp) && await validMp4(file.file, file.stamp.size)
          const duration = valid ? await readDuration(file.file, file.stamp.size) : null
          stable.set(key, { entry, valid, duration })
        } catch (error) {
          // A file that vanished or cannot be read between listing and opening is
          // simply not part of this snapshot; the next sweep will see it again.
          if (!isMissing(error) && !(error instanceof LibraryError && error.status === 404)) throw error
        } finally {
          await file?.file.close()
        }
      }

      await assertRootUnchanged(root, config.mediaRoot)

      let indexed = 0
      let removed = 0
      store.transact(() => {
        const snapshot = new Map(store.files().map(row => [row.path_key, row]))
        for (const [key, value] of stable) {
          if (uploadInProgress.has(key)) continue
          const before = snapshot.get(key)
          const unchanged = before && before.size === value.entry.stamp.size
            && before.mtime === value.entry.stamp.mtime && before.available === (value.valid ? 1 : 0)
          if (unchanged && before.title_id) continue
          indexMedia(store, value.entry, value.valid, value.duration)
          indexed++
        }
        // Anything indexed that the folder no longer contains is deleted with it.
        for (const [key, row] of snapshot) {
          if (uploadInProgress.has(key) || stable.has(key)) continue
          store.deleteFile(row.id)
          removed++
        }
        pruneOrphans(store)
        const result: ScanResult = {
          id, state: 'success', startedAt, finishedAt: new Date().toISOString(),
          discovered: found.size, indexed, removed, message: null,
        }
        store.recordScan(result)
      })
      void sweepStaging(root)
    } catch (error) {
      const message = error instanceof LibraryError && error.status === 503 ? error.message
        : '扫描未完成。请检查媒体目录和共享连接后重试。'
      console.warn('[library] Scan did not complete:', errorCode(error) ?? message)
      store.recordScan({
        id, state: 'failed', startedAt, finishedAt: new Date().toISOString(),
        discovered: 0, indexed: 0, removed: 0, message,
      })
    }
  }

  function start(): ScanStatus {
    if (!active) {
      active = run().catch(error => {
        console.error('[library] Could not save scan result:', errorCode(error) ?? 'database error')
      }).finally(() => { active = null })
    }
    return status()
  }

  return { status, start, async finish() { await active } }
}

export type Scanner = ReturnType<typeof createScanner>
