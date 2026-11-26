import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, link, lstat, open, readdir, unlink } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { LibraryError, errorCode } from '../domain/errors.ts'
import { ensureMediaDirectory, stagingFolder, verifyDirectoryIdentity } from './paths.ts'
import type { MediaRoot } from './paths.ts'

export interface UploadInput {
  name: string
  length: number | null
  body: AsyncIterable<Uint8Array>
}

const activeFiles = new Set<string>()
const expiredAfter = 24 * 60 * 60 * 1000
const fallbackCopy = new Set(['EPERM', 'EACCES', 'EXDEV', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EINVAL', 'EMLINK', 'UNKNOWN'])

export async function receiveFile(
  root: MediaRoot,
  input: UploadInput,
  limit: number,
  validate: (file: FileHandle, size: number) => Promise<void>,
): Promise<{ path: string; dispose: () => Promise<void> }> {
  if (input.length !== null && input.length > limit) throw new LibraryError(413, '文件超过允许的上传大小。')
  const directory = await ensureMediaDirectory(root, stagingFolder)
  const path = join(directory, `${randomUUID()}.part`)
  activeFiles.add(path)
  let created = false
  const dispose = async () => {
    try {
      if (created) {
        await verifyDirectoryIdentity(directory, root)
        await unlink(path)
      }
    } catch (error) {
      // A disconnected share can prevent immediate cleanup; a later scan sweeps stale parts.
      if (errorCode(error) !== 'ENOENT') console.warn('[library] Could not remove staged upload:', errorCode(error) ?? 'unknown')
    } finally {
      activeFiles.delete(path)
    }
  }

  let file: FileHandle | undefined
  let complete = false
  try {
    await verifyDirectoryIdentity(directory, root)
    file = await open(path, 'wx+')
    created = true
    let size = 0
    for await (const chunk of input.body) {
      if (size + chunk.byteLength > limit) throw new LibraryError(413, '文件超过允许的上传大小。')
      let offset = 0
      while (offset < chunk.byteLength) {
        const { bytesWritten } = await file.write(chunk, offset, chunk.byteLength - offset, null)
        if (bytesWritten <= 0) throw new LibraryError(503, '媒体目录写入失败。')
        offset += bytesWritten
      }
      size += chunk.byteLength
    }
    if (!size || (input.length !== null && size !== input.length)) throw new LibraryError(400, '上传数据不完整，请重试。')
    await validate(file, size)
    await file.sync()
    await file.close()
    file = undefined
    complete = true
    return { path, dispose }
  } finally {
    await file?.close().catch(() => {})
    if (!complete) await dispose()
  }
}

export async function placeFile(root: MediaRoot, staged: string, directory: string, name: string): Promise<void> {
  const sourceDirectory = dirname(staged)
  await Promise.all([verifyDirectoryIdentity(directory, root), verifyDirectoryIdentity(sourceDirectory, root)])
  if (!(await lstat(staged)).isFile()) throw new LibraryError(503, '暂存文件已变化，请重新上传。')
  const target = join(directory, name)
  try {
    // A same-volume hard link gives an atomic no-overwrite move when supported.
    await link(staged, target)
  } catch (error) {
    if (errorCode(error) === 'EEXIST') throw new LibraryError(409, '上传目录已有同名文件。请先改名，原文件没有被覆盖。')
    if (!fallbackCopy.has(errorCode(error) ?? '')) throw error
    // Some SMB shares do not support hard links. The service keeps this target
    // out of scans while the already-validated temporary file is copied.
    try {
      await copyFile(staged, target, constants.COPYFILE_EXCL)
    } catch (copyError) {
      if (errorCode(copyError) === 'EEXIST') throw new LibraryError(409, '上传目录已有同名文件。请先改名，原文件没有被覆盖。')
      throw copyError
    }
  }
}

export async function sweepStaging(root: MediaRoot): Promise<void> {
  const directory = join(root.path, stagingFolder)
  try {
    await verifyDirectoryIdentity(directory, root)
    const cutoff = Date.now() - expiredAfter
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[0-9a-f-]{36}\.part$/i.test(entry.name)) continue
      const path = join(directory, entry.name)
      if (activeFiles.has(path)) continue
      const stat = await lstat(path).catch(() => null)
      if (stat?.isFile() && stat.mtimeMs < cutoff) await unlink(path).catch(() => {})
    }
  } catch {
    // No staging directory yet, or the share is temporarily unavailable.
  }
}
