import { randomUUID } from 'node:crypto'
import type { FileHandle } from 'node:fs/promises'
import { extname, posix } from 'node:path'
import type { AdminLibrary, AdminMedia, AdminSettings, BulkEditItem, BulkEditResult, MediaEdit } from '../../shared/types/library.ts'
import type { AdminMediaRecord, LibraryStore, MediaRecord } from '../db/library.ts'
import { parseList, serializeList } from '../db/library.ts'
import type { LibraryConfig } from '../domain/config.ts'
import { errorCode, LibraryError } from '../domain/errors.ts'
import { recognize, titleIdentity } from '../domain/recognition.ts'
import { posterMime, validMp4, verifyPoster } from '../storage/formats.ts'
import { assertFileName, ensureMediaDirectory, inspectMediaFile, isMissing, openMediaFile, pathKey, posterFolder, resolveMediaRoot, sameStamp, uploadFolder, videoFileName } from '../storage/paths.ts'
import { placeFile, receiveFile } from '../storage/uploads.ts'
import type { UploadInput } from '../storage/uploads.ts'
import { indexMedia, pendingClaims } from './index-media.ts'
import { createScanner } from './scanner.ts'
import { readSettings, saveSettings } from './settings.ts'

const imageLimit = 8 * 1024 ** 2
const noFile = '文件不存在或暂不可用。'

function adminMedia(row: AdminMediaRecord): AdminMedia {
  return {
    id: row.id, fileName: posix.basename(row.relative_path), relativePath: row.relative_path, state: row.state,
    available: Boolean(row.available), reason: row.reason ?? (row.available ? null : noFile), size: row.size,
    source: row.source, addedAt: row.added_at, titleId: row.title_id, season: row.season, episode: row.episode,
    episodeTitle: row.episode_title, suggestion: recognize(row.relative_path).suggestion,
  }
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
      const staged = await receiveFile(root, input, config.maxUploadBytes, async (file, size) => {
        if (!await validMp4(file, size)) throw new LibraryError(422, '文件不是完整的 MP4，无法入库。')
      })
      try {
        await placeFile(root, staged.path, directory, name)
        const stamp = await inspectMediaFile(root, relative)
        const id = store.transact(() => indexMedia(store, { relative, stamp }, true, 'upload', pendingClaims(store.files())).id)
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

  async function poster(id: string, variant: 'poster' | 'backdrop' = 'poster') {
    const relative = variant === 'backdrop' ? store.backdropPath(id) : store.posterPath(id)
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
    const row = store.publishedFile(id)
    if (!row?.available || !videoFileName(row.relative_path)) throw new LibraryError(404, noFile)
    return openVideoFile(row)
  }

  // Anyone with an admin session may read a pending file to grab its first frame.
  async function preview(id: string) {
    const row = store.adminFile(id)
    if (!row?.available || !row.valid_mp4 || !videoFileName(row.relative_path)) throw new LibraryError(404, noFile)
    return openVideoFile(row)
  }

  async function openVideoFile(row: Pick<MediaRecord, 'relative_path' | 'size' | 'mtime' | 'file_version'>) {
    try {
      const root = await resolveMediaRoot(config.mediaRoot)
      const verified = await openMediaFile(root, row.relative_path)
      if (!sameStamp(row, verified.stamp)) {
        await verified.file.close().catch(() => {})
        throw new LibraryError(404, '文件有变化，等扫描确认后即可访问。')
      }
      return { file: verified.file, size: verified.stamp.size, mtime: verified.stamp.mtime, version: row.file_version, name: posix.basename(row.relative_path) }
    } catch (error) {
      if (isMissing(error) || (error instanceof LibraryError && error.status === 400)) throw new LibraryError(404, noFile)
      if (error instanceof LibraryError) throw error
      throw new LibraryError(503, '视频服务器暂不可用。')
    }
  }

  async function edit(id: string, input: MediaEdit): Promise<AdminMedia> {
    const before = store.adminFile(id)
    if (!before) throw new LibraryError(404, '未找到这条文件记录。')
    if (input.posterPath !== null) {
      try {
        const image = await openPoster(input.posterPath)
        await image.file.close()
      } catch (error) {
        if (error instanceof LibraryError && error.status === 503) throw error
        throw new LibraryError(422, '海报必须是媒体目录内不大于 8 MiB 的可读 JPG、PNG 或 WebP 文件。')
      }
    }
    if (before.state === 'pending') {
      if (!before.available || !before.valid_mp4) throw new LibraryError(422, '请先恢复或替换媒体文件，再扫描并整理。')
      const root = await resolveMediaRoot(config.mediaRoot)
      try {
        const stamp = await inspectMediaFile(root, before.relative_path)
        if (!sameStamp(before, stamp)) throw new LibraryError(409, '文件有变化，请重新扫描后整理。')
      } catch (error) {
        if (isMissing(error)) throw new LibraryError(409, '文件已不在该位置，请重新扫描。')
        if (error instanceof LibraryError) throw error
        throw new LibraryError(503, '无法复查这个媒体文件，请检查媒体目录。')
      }
    }
    return store.transact(() => applyEdit(before, input))
  }

  // Shared by single and bulk publishing so both obey exactly the same rules.
  function applyEdit(before: AdminMediaRecord, input: MediaEdit): AdminMedia {
    const row = store.adminFile(before.id)
    if (!row || before.file_version !== row.file_version || before.state !== row.state) {
      throw new LibraryError(409, '入库状态已变化，请刷新后重试。')
    }
    const metadata = {
      title: input.title, year: input.year, description: input.description, poster_path: input.posterPath,
      original_title: input.originalTitle, genres: serializeList(input.genres), region: input.region,
      rating: input.rating, runtime: input.runtime, director: input.director,
      cast_members: serializeList(input.cast), backdrop_path: input.backdropPath,
    }
    let titleId = input.titleId
    if (!titleId && row.title_id) {
      const current = store.title(row.title_id)
      if (current?.kind === input.kind && current.title === input.title && current.year === input.year) titleId = current.id
    }
    if (titleId) {
      const current = store.title(titleId)
      if (!current) throw new LibraryError(404, '要关联的影片不存在，请刷新列表。')
      if (current.kind !== input.kind) throw new LibraryError(422, '已有条目的类型不能修改，请选择相符条目或新建。')
      store.editTitle(titleId, metadata)
    } else {
      const key = titleIdentity(input.kind, input.title, input.year)
      titleId = store.createTitle(input.kind, metadata, store.findIdentity(key) ? null : key)
    }
    let episodeId: string | null = null
    if (input.kind === 'series') {
      if (input.season === null || input.episode === null) throw new LibraryError(422, '剧集需要季号和集号。')
      const target = store.episodeAt(titleId, input.season, input.episode)
      if (target) episodeId = target.id
      else if (row.title_id === titleId && row.episode_id) episodeId = row.episode_id
      else episodeId = store.createEpisode(titleId, input.season, input.episode, input.episodeTitle)
    }
    const occupied = store.publishedFor(titleId, episodeId)
    if (occupied && occupied.id !== row.id) {
      if (!input.replaceExisting) throw new LibraryError(409, '该影片或集号已有文件，请改选位置，或明确选择替换。', 'SLOT_OCCUPIED')
      store.associate(occupied.id, { state: 'pending', title_id: null, episode_id: null, reason: '管理员将另一个文件关联到该位置，原文件已转入待整理。' })
    }
    if (episodeId && input.season !== null && input.episode !== null) {
      store.editEpisode(episodeId, input.season, input.episode, input.episodeTitle)
    }
    store.associate(row.id, { state: 'published', title_id: titleId, episode_id: episodeId, reason: row.valid_mp4 ? null : row.reason })
    return fileForAdmin(before.id)
  }

  // Bulk work is best-effort: each file commits or fails on its own so one
  // conflict never undoes the files that were already handled.
  async function publishMany(items: BulkEditItem[]): Promise<BulkEditResult> {
    const fallbackDescription = readSettings(store).defaultDescription
    const published: AdminMedia[] = []
    const skipped: BulkEditResult['skipped'] = []
    for (const item of items) {
      const before = store.adminFile(item.id)
      if (!before) {
        skipped.push({ id: item.id, fileName: '', message: '未找到这条文件记录。' })
        continue
      }
      try {
        if (item.mode === 'complete') {
          await completeEntry(before, item, fallbackDescription)
        } else {
          if (before.state !== 'pending') throw new LibraryError(422, '这条文件已经发布，不需要再整理。')
          if (!before.available || !before.valid_mp4) throw new LibraryError(422, '媒体文件暂不可用，请先恢复文件并扫描。')
          const suggestion = recognize(before.relative_path).suggestion
          const title = item.title ?? suggestion.title
          if (!title) throw new LibraryError(422, '无法确定片名，请先填写片名。')
          const kind = item.kind ?? suggestion.kind ?? 'movie'
          const season = item.season ?? suggestion.season
          const episode = item.episode ?? suggestion.episode
          if (kind === 'series' && (season === null || episode === null)) {
            throw new LibraryError(422, '无法确定季号或集号，请先手动整理这一集。')
          }
          const existing = before.title_id ? store.title(before.title_id) : undefined
          await edit(before.id, {
            titleId: item.titleId,
            kind,
            title,
            year: item.year ?? suggestion.year,
            description: item.description ?? fallbackDescription,
            originalTitle: existing?.original_title ?? null,
            genres: existing ? parseList(existing.genres) : [],
            region: existing?.region ?? null,
            rating: existing?.rating ?? null,
            runtime: existing?.runtime ?? null,
            director: existing?.director ?? null,
            cast: existing ? parseList(existing.cast_members) : [],
            posterPath: item.posterPath,
            backdropPath: existing?.backdrop_path ?? null,
            season: kind === 'series' ? season : null,
            episode: kind === 'series' ? episode : null,
            episodeTitle: item.episodeTitle ?? null,
            replaceExisting: item.replaceExisting,
          })
        }
        published.push(fileForAdmin(before.id))
      } catch (error) {
        skipped.push({
          id: before.id, fileName: posix.basename(before.relative_path),
          message: error instanceof LibraryError ? error.message : '保存失败，请稍后重试。',
        })
      }
    }
    return { published, skipped }
  }

  // Fills in only what is still missing unless the caller explicitly overwrites,
  // so a description or cover typed by hand is never silently replaced.
  async function completeEntry(before: AdminMediaRecord, item: BulkEditItem, fallbackDescription: string) {
    if (before.state !== 'published' || !before.title_id) throw new LibraryError(422, '这条文件还没有发布，无法补齐资料。')
    const title = store.title(before.title_id)
    if (!title) throw new LibraryError(404, '关联的影片已不存在，请刷新列表。')
    const description = item.description ?? fallbackDescription
    const nextDescription = title.description.trim() || item.overwrite ? description : title.description
    const nextPoster = item.overwrite || !title.poster_path ? item.posterPath ?? title.poster_path : title.poster_path
    if ((nextDescription === title.description) && (nextPoster === title.poster_path)) {
      throw new LibraryError(422, '已有简介和封面，未做改动。')
    }
    store.transact(() => {
      store.editTitle(title.id, {
        title: title.title, year: title.year, description: nextDescription, poster_path: nextPoster,
        original_title: title.original_title, genres: title.genres, region: title.region, rating: title.rating,
        runtime: title.runtime, director: title.director, cast_members: title.cast_members,
        backdrop_path: title.backdrop_path,
      })
    })
  }

  return {
    cards: store.cards, browse: store.browse, home: store.home, detail: store.detail,
    scanner, video, preview, poster, uploadPoster, uploadVideo, edit, publishMany,
    settings: () => readSettings(store),
    saveSettings: (input: { defaultDescription: string }) => store.transact(() => saveSettings(store, input)),
    forAdmin: (): AdminLibrary => ({
      items: store.adminFiles().map(adminMedia), titles: store.titles(), scan: scanner.status(), settings: readSettings(store),
    }),
  }
}