import { getHeader, setHeader, setResponseStatus } from 'h3'
import type { H3Event } from 'h3'
import type { FileHandle } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { LibraryError } from '../domain/errors.ts'
import { byteRange, disposition } from './range.ts'
import type { LibraryRuntime } from '../services/runtime.ts'
import { routeId } from './handlers.ts'

function checkReadMethod(event: H3Event): void {
  if (event.method !== 'GET' && event.method !== 'HEAD') {
    setHeader(event, 'Allow', 'GET, HEAD')
    throw new LibraryError(405, '此资源只支持读取。')
  }
}

async function stream(event: H3Event, file: FileHandle, range?: { start: number; end: number }): Promise<void> {
  if (event.node.res.destroyed || event.node.res.writableEnded) {
    await file.close()
    return
  }
  const readable = file.createReadStream({ ...range, autoClose: true, highWaterMark: 128 * 1024 })
  try {
    // pipeline tears down the file descriptor even if a player cancels a previous Range request.
    await pipeline(readable, event.node.res)
  } finally {
    readable.destroy()
  }
}

type VideoOpener = (id: string) => Promise<{ file: FileHandle; size: number; mtime: number; name: string }>

export async function sendVideo(event: H3Event, runtime: LibraryRuntime, attachment: boolean, open: VideoOpener = id => runtime.catalog.video(id)): Promise<void> {
  checkReadMethod(event)
  const id = routeId(event)
  const video = await open(id)
  let ownsFile = true
  try {
    // The file's own mtime and size identify the version; there is no separate column.
    const etag = `"${id}-${video.mtime}-${video.size}"`
    const modified = new Date(video.mtime).toUTCString()
    setHeader(event, 'Accept-Ranges', 'bytes')
    setHeader(event, 'Cache-Control', 'private, no-cache')
    setHeader(event, 'ETag', etag)
    setHeader(event, 'Last-Modified', modified)
    const ifRange = getHeader(event, 'if-range')
    const rangeHeader = !ifRange || ifRange === etag || ifRange === modified ? getHeader(event, 'range') : undefined
    const range = rangeHeader === undefined ? undefined : byteRange(rangeHeader, video.size)
    if (range === null) {
      setHeader(event, 'Content-Range', `bytes */${video.size}`)
      setHeader(event, 'Content-Length', 0)
      setResponseStatus(event, 416)
      event.node.res.end()
      return
    }
    setHeader(event, 'Content-Type', 'video/mp4')
    setHeader(event, 'Content-Disposition', disposition(video.name, attachment))
    if (range) {
      setResponseStatus(event, 206)
      setHeader(event, 'Content-Range', `bytes ${range.start}-${range.end}/${video.size}`)
      setHeader(event, 'Content-Length', range.end - range.start + 1)
    } else {
      setHeader(event, 'Content-Length', video.size)
    }
    if (event.method === 'HEAD') {
      event.node.res.end()
      return
    }
    ownsFile = false
    await stream(event, video.file, range)
  } finally {
    if (ownsFile) await video.file.close()
  }
}

export async function sendPoster(event: H3Event, runtime: LibraryRuntime, id = routeId(event)): Promise<void> {
  checkReadMethod(event)
  const poster = await runtime.catalog.poster(id)
  // The validator follows the file, so a replaced cover invalidates it naturally
  // while an unchanged one costs only a 304 on every later request.
  const etag = `"poster-${id}-${poster.mtime}-${poster.size}"`
  const modified = new Date(poster.mtime).toUTCString()
  setHeader(event, 'ETag', etag)
  setHeader(event, 'Last-Modified', modified)
  setHeader(event, 'Cache-Control', 'private, no-cache')
  const ifNoneMatch = getHeader(event, 'if-none-match')
  if (ifNoneMatch === etag) {
    await poster.file.close()
    setResponseStatus(event, 304)
    event.node.res.end()
    return
  }
  setHeader(event, 'Content-Type', poster.mime)
  setHeader(event, 'Content-Length', poster.size)
  if (event.method === 'HEAD') {
    await poster.file.close()
    event.node.res.end()
    return
  }
  await stream(event, poster.file)
}
