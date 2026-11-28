import type { FileHandle } from 'node:fs/promises'
import { extname, posix } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AdminLibrary, AdminMedia, ClassifyInput, ClassifyResult, MediaEdit } from '../../shared/types/library.ts'
import type { AdminMediaRecord, LibraryStore } from '../db/library.ts'
import { adminMedia, parseList } from '../db/library.ts'
import { recognize } from '../domain/recognition.ts'
import type { LibraryConfig } from '../domain/config.ts'
import { errorCode, LibraryError } from '../domain/errors.ts'
import { posterMime, readDuration, validMp4, verifyPoster } from '../storage/formats.ts'
import {
  assertFileName, ensureMediaDirectory, inspectMediaFile, isMissing, openMediaFile, pathKey,
  posterFolder, resolveMediaRoot, sameStamp, uploadFolder, videoFileName,
} from '../storage/paths.ts'
import { placeFile, receiveFile } from '../storage/uploads.ts'
import type { UploadInput } from '../storage/uploads.ts'
import { indexMedia } from './index-media.ts'
import { pruneOrphans } from './index-media.ts'
import { createScanner } from './scanner.ts'

const imageLimit = 8 * 1024 ** 2
const noFile = '文件不存在或暂不可用。'

// A filename, read the same way the scanner reads it, is the fallback title.
function basename(relativePath: string): string {
  return recognize(relativePath).title
}

function transferFailure(error: unknown): never {
  if (error instanceof LibraryError) {
    if (error.status === 404) throw new LibraryError(503, '上传目录不可用，请检查目录和权限。')
    throw error
  }
  if (['ECONNRESET', 'ERR_STREAM_PREMATURE_CLOSE', 'ABORT_ERR'].includes(errorCode(error) ?? '')) {
    throw new LibraryError(400, '上传已中断，未完成的文件没有入库。')
  }
  console.warn('[library] Upload failed:', errorCode(error) ?? 'unknown')
  throw new LibraryError(503, '上传保存失败，请检查磁盘空间、共享连接或权限后重试。')
}

export function createCatalog(store: LibraryStore, config: LibraryConfig) {
  const uploading = new Set<string>()
  const scanner = createScanner(store, config, uploading)

  function fileForAdmin(id: string): AdminMedia {
    const row = store.adminFile(id)
    if (!row) throw new LibraryError(404, '未找到这条文件记录。')
    return adminMedia(row)
  }

  // Uploading drops the file into the media folder, exactly like copying it there;
  // the same indexing path then gives it a title.
  async function uploadVideo(input: UploadInput): Promise<AdminMedia> {
    const name = assertFileName(input.name)
    if (!videoFileName(name)) throw new LibraryError(415, '请选择 MP4 视频，且不要使用临时文件名。')
    const relative = `${uploadFolder}/${name}`
    const key = pathKey(relative)
    if (uploading.has(key)) throw new LibraryError(409, '同名文件正在上传，请稍后检查入库结果。')
    uploading.add(key)
    try {
      const root = await resolveMediaRoot(config.mediaRoot)
      const directory = await ensureMediaDirectory(root, uploadFolder)
      let duration: number | null = null
      const staged = await receiveFile(root, input, config.maxUploadBytes, async (file, size) => {
        if (!await validMp4(file, size)) throw new LibraryError(422, '文件不是完整的 MP4，无法入库。')
        duration = await readDuration(file, size)
      })
      try {
        await placeFile(root, staged.path, directory, name)
        const stamp = await inspectMediaFile(root, relative)
        const id = store.transact(() => indexMedia(store, { relative, stamp }, true, duration).id)
        return fileForAdmin(id)
      } finally {
        await staged.dispose()
      }
    } catch (error) {
      return transferFailure(error)
    } finally {
      uploading.delete(key)
    }
  }

  async function uploadPoster(input: UploadInput): Promise<string> {
    const name = assertFileName(input.name)
    if (!posterMime(name)) throw new LibraryError(415, '海报只支持 JPG、PNG 和 WebP。')
    try {
      const root = await resolveMediaRoot(config.mediaRoot)
      const directory = await ensureMediaDirectory(root, posterFolder)
      const staged = await receiveFile(root, input, imageLimit, async (file) => {
        if (!await verifyPoster(file, name)) throw new LibraryError(422, '海报内容与图片格式不符。')
      })
      try {
        const target = `${randomUUID()}${extname(name).toLowerCase()}`
        await placeFile(root, staged.path, directory, target)
        return `${posterFolder}/${target}`
      } finally {
        await staged.dispose()
      }
    } catch (error) {
      return transferFailure(error)
    }
  }

  async function openPoster(relative: string): Promise<{ file: FileHandle; size: number; mtime: number; mime: string }> {
    if (!posterMime(relative)) throw new LibraryError(404, '未找到海报。')
    const root = await resolveMediaRoot(config.mediaRoot)
    const verified = await openMediaFile(root, relative)
    try {
      if (verified.stamp.size > imageLimit) throw new LibraryError(404, '海报超过大小限制。')
      const mime = await verifyPoster(verified.file, relative)
      if (!mime) throw new LibraryError(404, '海报无效。')
      return { file: verified.file, size: verified.stamp.size, mtime: verified.stamp.mtime, mime }
    } catch (error) {
      await verified.file.close().catch(() => {})
      throw error
    }
  }

  async function poster(id: string) {
    const relative = store.posterPath(id)
    if (!relative) throw new LibraryError(404, '未找到海报。')
    try {
      return await openPoster(relative)
    } catch (error) {
      if (isMissing(error) || (error instanceof LibraryError && error.status === 400)) throw new LibraryError(404, '未找到海报。')
      if (error instanceof LibraryError) throw error
      throw new LibraryError(503, '海报暂不可用。')
    }
  }

  async function video(id: string) {
    const row = store.adminFile(id)
    if (!row?.available || !videoFileName(row.relative_path)) throw new LibraryError(404, noFile)
    return openVideoFile(row)
  }

  // Anyone with an admin session may read a file to grab its first frame.
  async function preview(id: string) {
    const row = store.adminFile(id)
    if (!row?.available || !videoFileName(row.relative_path)) throw new LibraryError(404, noFile)
    return openVideoFile(row)
  }

  async function openVideoFile(row: { relative_path: string; size: number; mtime: number }) {
    try {
      const root = await resolveMediaRoot(config.mediaRoot)
      const verified = await openMediaFile(root, row.relative_path)
      if (!sameStamp(row, verified.stamp)) {
        await verified.file.close().catch(() => {})
        throw new LibraryError(404, '文件有变化，等扫描确认后即可访问。')
      }
      return { file: verified.file, size: verified.stamp.size, mtime: verified.stamp.mtime, name: posix.basename(row.relative_path) }
    } catch (error) {
      if (isMissing(error) || (error instanceof LibraryError && error.status === 400)) throw new LibraryError(404, noFile)
      if (error instanceof LibraryError) throw error
      throw new LibraryError(503, '视频服务器暂不可用。')
    }
  }

  // Editing changes the title (and where this file sits in a series), never the file.
  async function edit(id: string, input: MediaEdit): Promise<AdminMedia> {
    const before = store.adminFile(id)
    if (!before) throw new LibraryError(404, '未找到这条文件记录。')
    if (input.posterPath !== null) {
      try {
        const image = await openPoster(input.posterPath)
        await image.file.close()
      } catch (error) {
        if (error instanceof LibraryError && error.status === 503) throw error
        throw new LibraryError(422, '封面必须是媒体目录内不大于 8 MiB 的可读 JPG、PNG 或 WebP 文件。')
      }
    }
    return store.transact(() => applyEdit(before.id, input))
  }

  function applyEdit(id: string, input: MediaEdit): AdminMedia {
    const row = store.adminFile(id)
    if (!row) throw new LibraryError(404, '未找到这条文件记录。')
    const metadata = {
      title: input.title,
      year: input.year,
      description: input.description,
      poster_path: input.posterPath,
      cast_members: JSON.stringify(input.cast),
    }
    let titleId = row.title_id
    if (titleId) {
      const current = store.title(titleId)
      if (!current) throw new LibraryError(404, '关联的影片已不存在，请刷新列表。')
      if (current.kind !== input.kind) {
        // Changing the kind of an existing title would leave its files inconsistent.
        throw new LibraryError(422, '已有条目的电影/剧集类型不能修改。')
      }
      store.editTitle(titleId, metadata)
    } else {
      titleId = store.createTitle(input.kind, metadata, null)
    }

    let episodeId: string | null = null
    if (input.kind === 'series') {
      if (input.season === null || input.episode === null) throw new LibraryError(422, '剧集需要季号和集号。')
      const slot = store.episodeAt(titleId, input.season, input.episode)
      episodeId = slot?.id ?? store.createEpisode(titleId, input.season, input.episode)
    }
    store.associate(row.id, titleId, episodeId)
    return fileForAdmin(row.id)
  }

  // Re-classifying a selection is the batch equivalent of one edit: the same title
  // record is reused (so its cover and description survive), only its kind changes.
  // For a series, files without an episode number get consecutive numbers in the
  // order they were selected, which is what "select several and make them episodes"
  // has to mean.
  function classifyMany(input: ClassifyInput): ClassifyResult {
    const chosen: AdminMediaRecord[] = []
    const skipped: ClassifyResult['skipped'] = []
    for (const id of input.ids) {
      const row = store.adminFile(id)
      if (!row) {
        skipped.push({ id, message: '未找到这条文件记录。' })
        continue
      }
      chosen.push(row)
    }
    if (!chosen.length) throw new LibraryError(422, '请选择要分类的文件。')

    return store.transact((): ClassifyResult => {
      const items: AdminMedia[] = []
      let seriesTitleId: string | null = input.kind === 'series' ? input.titleId ?? null : null
      if (input.kind === 'series' && seriesTitleId === null) {
        const first = chosen[0]!
        const current = first.title_id ? store.title(first.title_id) : undefined
        if (current?.kind === 'series') {
          seriesTitleId = current.id
        } else {
          seriesTitleId = store.createTitle('series', {
            title: input.title?.trim() || current?.title || basename(first.relative_path),
            year: current?.year ?? null,
            description: current?.description ?? '',
            poster_path: current?.poster_path ?? null,
            cast_members: current?.cast_members ?? '[]',
          }, null)
        }
      }

      // Episodes keep their own numbers; the rest are appended after the highest one
      // already in the series, in the order they were selected.
      let season = input.season ?? 1
      let nextEpisode = 1
      if (input.kind === 'series' && seriesTitleId) {
        const existing = store.episodesOf(seriesTitleId)
        if (existing.length) {
          season = input.season ?? existing[0]!.season
          nextEpisode = Math.max(...existing.filter(ep => ep.season === season).map(ep => ep.episode)) + 1
        }
      }

      for (const row of chosen) {
        if (input.kind === 'series') {
          const titleId = seriesTitleId!
          const own = row.episode_id ? store.episode(row.episode_id) : undefined
          const keep = own && own.title_id === titleId ? own : undefined
          const targetSeason = keep ? keep.season : season
          const number = keep ? keep.episode : nextEpisode++
          const slot = store.episodeAt(titleId, targetSeason, number)
          const episodeId = slot?.id ?? store.createEpisode(titleId, targetSeason, number)
          store.associate(row.id, titleId, episodeId)
        } else {
          const current = row.title_id ? store.title(row.title_id) : undefined
          if (current?.kind === 'movie') {
            store.associate(row.id, current.id, null)
          } else {
            // Splitting a series back into films must not give every file the same
            // name: the number that made them episodes is already in the filename, so
            // read the title from the file rather than from the shared series record.
            const titleId = store.createTitle('movie', {
              title: basename(row.relative_path),
              year: current?.year ?? null,
              description: current?.description ?? '',
              poster_path: null,
              cast_members: current?.cast_members ?? '[]',
            }, null)
            store.associate(row.id, titleId, null)
          }
        }
        items.push(adminMedia(store.adminFile(row.id)!))
      }
      // A title that lost all of its files to the new grouping is cleaned up.
      pruneOrphans(store)
      return { items, skipped }
    })
  }

  return {
    cards: store.browse, browse: store.browse, home: store.home, detail: store.detail,
    actors: () => ({ items: store.actors() }),
    scanner, video, preview, poster, uploadPoster, uploadVideo, edit, classifyMany,
    forAdmin: (): AdminLibrary => ({
      items: store.adminFiles().map(adminMedia),
      titles: store.titles(),
      scan: scanner.status(),
    }),
    // Used by the scanner's caller to know whether a title carries its cast.
    castOf: (titleId: string) => parseList(store.title(titleId)?.cast_members),
  }
}

export type Catalog = ReturnType<typeof createCatalog>
