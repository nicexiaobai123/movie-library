import { lstat, mkdir, open, readdir, realpath, stat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { LibraryError, errorCode } from '../domain/errors.ts'

export const stagingFolder = '.night-library-staging'
export const uploadFolder = '上传'
export const posterFolder = '_海报'
const invalidNamedPath = '文件路径无效，需使用媒体根目录内的相对路径。'
const rootUnavailable = '无法访问媒体目录，请检查目录、共享连接及运行账户的权限。'
const missingFile = '文件不存在或暂不可用。'

export interface Stamp { size: number; mtime: number }
export interface MediaRoot { path: string; stat: Stats }
export interface FoundFile { relative: string; stamp: Stamp }

export function validSegment(segment: string): boolean {
  return segment.length > 0 && segment.length <= 240 && !/^[.]|[.\s]$|[<>:"/\\|?*\p{Cc}]/u.test(segment)
    && !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(segment)
}

export function relativeSegments(input: string): string[] {
  const parts = input.split('/')
  if (input.length > 2048 || !parts.every(validSegment)) throw new LibraryError(400, invalidNamedPath)
  return parts
}

export function assertFileName(input: string): string {
  if (!validSegment(input)) throw new LibraryError(400, '文件名无效，请使用不含路径或特殊字符的原文件名。')
  return input
}

export function videoFileName(name: string): boolean {
  return /\.mp4$/i.test(name) && !/(?:\.part|\.tmp|\.download|\.crdownload|\.incomplete|\.partial)\.mp4$/i.test(name)
}

export function pathKey(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

export function within(root: string, candidate: string): boolean {
  const remainder = relative(root, candidate)
  return remainder !== '' && remainder !== '..' && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder)
}

function sameFile(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino
}

export function fileStamp(info: Stats): Stamp {
  return { size: info.size, mtime: Math.trunc(info.mtimeMs) }
}

export function sameStamp(a: Stamp, b: Stamp): boolean {
  return a.size === b.size && a.mtime === b.mtime
}

export function isMissing(error: unknown): boolean {
  return ['ENOENT', 'ENOTDIR'].includes(errorCode(error) ?? '')
}

export async function resolveMediaRoot(configured: string): Promise<MediaRoot> {
  try {
    const path = await realpath(resolve(configured))
    const info = await lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('not a directory')
    return { path, stat: info }
  } catch {
    throw new LibraryError(503, rootUnavailable)
  }
}

export async function assertRootUnchanged(root: MediaRoot, configured: string): Promise<void> {
  const current = await resolveMediaRoot(configured)
  if (pathKey(root.path) !== pathKey(current.path) || !sameFile(root.stat, current.stat)) {
    throw new LibraryError(503, rootUnavailable)
  }
}

async function checkedPath(root: MediaRoot, parts: string[], asDirectory: boolean): Promise<{ path: string; info: Stats }> {
  let candidate = root.path
  let info = root.stat
  for (const [index, part] of parts.entries()) {
    candidate = join(candidate, part)
    info = await lstat(candidate)
    // Junctions on Windows are reported as symbolic links by lstat as well.
    if (info.isSymbolicLink()) throw new LibraryError(404, missingFile)
    if (index < parts.length - 1 || asDirectory) {
      if (!info.isDirectory()) throw new LibraryError(404, missingFile)
    } else if (!info.isFile()) throw new LibraryError(404, missingFile)
  }
  const path = await realpath(candidate)
  if (!within(root.path, path)) throw new LibraryError(404, missingFile)
  return { path, info }
}

export async function ensureMediaDirectory(root: MediaRoot, folder: typeof stagingFolder | typeof uploadFolder | typeof posterFolder): Promise<string> {
  const folderPath = join(root.path, folder)
  try {
    await mkdir(folderPath)
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') throw error
  }
  return (await checkedPath(root, [folder], true)).path
}

export async function inspectMediaFile(root: MediaRoot, relativePath: string): Promise<Stamp> {
  const { info } = await checkedPath(root, relativeSegments(relativePath), false)
  return fileStamp(info)
}

export async function openMediaFile(root: MediaRoot, relativePath: string): Promise<{ file: FileHandle; stamp: Stamp }> {
  const parts = relativeSegments(relativePath)
  const before = await checkedPath(root, parts, false)
  const file = await open(before.path, 'r')
  try {
    const info = await file.stat()
    const after = await checkedPath(root, parts, false)
    if (!info.isFile() || !sameFile(before.info, info) || !sameFile(after.info, info)
      || pathKey(before.path) !== pathKey(after.path) || !sameStamp(fileStamp(after.info), fileStamp(info))) {
      throw new LibraryError(404, missingFile)
    }
    return { file, stamp: fileStamp(info) }
  } catch (error) {
    await file.close().catch(() => {})
    throw error
  }
}

export async function inventory(root: MediaRoot): Promise<Map<string, FoundFile>> {
  const result = new Map<string, FoundFile>()
  const directories: string[][] = [[]]
  while (directories.length) {
    const parts = directories.pop()!
    const path = parts.length ? (await checkedPath(root, parts, true)).path : root.path
    const entries = await readdir(path, { withFileTypes: true })
    for (const entry of entries) {
      if (!validSegment(entry.name) || entry.isSymbolicLink()) continue
      const next = [...parts, entry.name]
      const relative = next.join('/')
      if (relative.length > 2048) continue
      if (entry.isDirectory()) {
        if (pathKey(entry.name) !== pathKey(posterFolder)) directories.push(next)
      } else if (entry.isFile() && videoFileName(entry.name)) {
        // If a listed file cannot be stat-ed, this is not a complete snapshot.
        // Try again on the next scan instead of treating an I/O fault as removal.
        const { info } = await checkedPath(root, next, false)
        const key = pathKey(relative)
        if (result.has(key)) throw new LibraryError(503, '目录存在无法区分的文件路径，请检查路径大小写。')
        result.set(key, { relative, stamp: fileStamp(info) })
      }
    }
  }
  return result
}

export async function verifyDirectoryIdentity(path: string, root: MediaRoot): Promise<void> {
  const [resolved, info, rootInfo] = await Promise.all([realpath(path), lstat(path), stat(root.path)])
  if (!info.isDirectory() || info.isSymbolicLink() || !within(root.path, resolved)
    || pathKey(path) !== pathKey(resolved) || !sameFile(rootInfo, root.stat)) {
    throw new LibraryError(503, rootUnavailable)
  }
}
