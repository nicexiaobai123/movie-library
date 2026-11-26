import { randomUUID } from 'node:crypto'
import type { ScanResult, ScanStatus } from '../../shared/types/library.ts'
import type { LibraryStore } from '../db/library.ts'
import type { LibraryConfig } from '../domain/config.ts'
import { errorCode, LibraryError } from '../domain/errors.ts'
import { validMp4 } from '../storage/formats.ts'
import { assertRootUnchanged, fileStamp, inspectMediaFile, inventory, isMissing, openMediaFile, resolveMediaRoot, sameStamp } from '../storage/paths.ts'
import type { FoundFile, Stamp } from '../storage/paths.ts'
import { sweepStaging } from '../storage/uploads.ts'
import { canAutoIndex, indexMedia, pendingClaims, recognizedSlot } from './index-media.ts'

interface Observation { stamp: Stamp; since: number }

export function createScanner(store: LibraryStore, config: LibraryConfig, uploadInProgress: ReadonlySet<string>) {
  let seen = new Map<string, Observation>()
  let active: Promise<void> | null = null

  const status = (): ScanStatus => ({ running: active !== null, last: store.lastScan() })

  async function run(): Promise<void> {
    const startedAt = new Date().toISOString()
    const id = randomUUID()
    try {
      const root = await resolveMediaRoot(config.mediaRoot)
      const snapshot = new Map(store.files().map(row => [row.path_key, row]))
      const files = await inventory(root)
      const now = performance.now()
      const nextSeen = new Map<string, Observation>()
      const stable = new Map<string, { entry: FoundFile; valid: boolean }>()
      const waiting = new Set<string>()
      for (const [key, entry] of files) {
        if (uploadInProgress.has(key)) continue
        const previous = seen.get(key)
        const since = previous && sameStamp(previous.stamp, entry.stamp) ? previous.since : now
        nextSeen.set(key, { since, stamp: entry.stamp })
        const indexed = snapshot.get(key)
        if (indexed && indexed.relative_path === entry.relative && sameStamp(indexed, entry.stamp)
          && (indexed.available || !indexed.valid_mp4)) continue
        if (now - since < config.stableMs) {
          waiting.add(key)
          continue
        }
        let verified: Awaited<ReturnType<typeof openMediaFile>> | undefined
        try {
          verified = await openMediaFile(root, entry.relative)
          const valid = sameStamp(verified.stamp, entry.stamp) && await validMp4(verified.file, verified.stamp.size)
          const after = await inspectMediaFile(root, entry.relative)
          if (!sameStamp(verified.stamp, entry.stamp) || !sameStamp(after, entry.stamp)
            || !sameStamp(fileStamp(await verified.file.stat()), entry.stamp)) {
            waiting.add(key)
            nextSeen.set(key, { since: performance.now(), stamp: after })
            continue
          }
          stable.set(key, { entry, valid })
        } catch (error) {
          if (!isMissing(error) && !(error instanceof LibraryError && error.status === 404)) throw error
          waiting.add(key)
          nextSeen.delete(key)
        } finally {
          await verified?.file.close()
        }
      }
      await assertRootUnchanged(root, config.mediaRoot)
      store.transact(() => {
        const counts = { indexed: 0, published: 0, pending: 0, missing: 0 }
        const conflicts = pendingClaims(store.files().filter(row => files.has(row.path_key)))
        const fresh = new Set<string>()
        for (const [key, value] of stable) {
          const current = store.fileAt(key)
          if (current?.file_version !== snapshot.get(key)?.file_version || uploadInProgress.has(key) || !canAutoIndex(current, value.valid)) continue
          const claim = recognizedSlot(value.entry.relative)
          if (!claim) continue
          if (fresh.has(claim)) conflicts.add(claim)
          fresh.add(claim)
        }
        for (const [key, value] of stable) {
          if (uploadInProgress.has(key) || store.fileAt(key)?.file_version !== snapshot.get(key)?.file_version) continue
          const indexed = indexMedia(store, value.entry, value.valid, 'scan', conflicts)
          counts.indexed++
          counts[indexed.state]++
        }
        for (const [key, before] of snapshot) {
          if (uploadInProgress.has(key) || stable.has(key)) continue
          if (!files.has(key)) {
            if (store.unavailable(before.id, before.file_version)) counts.missing++
          } else if (waiting.has(key)) {
            // An existing path is being overwritten or copied back. Preserve its
            // metadata but do not stream the changed bytes while it settles.
            store.unavailable(before.id, before.file_version)
          }
        }
        const result: ScanResult = {
          id, state: 'success', startedAt, finishedAt: new Date().toISOString(), discovered: files.size,
          ...counts, unstable: waiting.size, message: null,
        }
        store.recordScan(result)
      })
      seen = nextSeen
      // The sweep is bounded to the dedicated directory and does not affect results.
      void sweepStaging(root)
    } catch (error) {
      seen.clear()
      const message = error instanceof LibraryError && error.status === 503 ? error.message
        : '扫描未完成，已保留原有入库和可用状态。请检查媒体目录和共享连接后重试。'
      console.warn('[library] Scan did not complete:', errorCode(error) ?? message)
      store.recordScan({
        id, state: 'failed', startedAt, finishedAt: new Date().toISOString(), discovered: 0,
        indexed: 0, published: 0, pending: 0, unstable: 0, missing: 0, message,
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