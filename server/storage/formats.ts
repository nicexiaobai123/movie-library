import type { FileHandle } from 'node:fs/promises'
import { extname } from 'node:path'

export async function validMp4(file: FileHandle, size: number): Promise<boolean> {
  // Inspect only top-level box headers. This is not a decoder or codec check.
  let offset = 0
  let ftyp = false
  let moov = false
  let mdat = false
  const header = Buffer.alloc(16)
  for (let i = 0; i < 128 && offset + 8 <= size; i++) {
    if ((await file.read(header, 0, 8, offset)).bytesRead !== 8) return false
    const type = header.toString('ascii', 4, 8)
    let length = header.readUInt32BE(0)
    let headerLength = 8
    if (length === 1) {
      if ((await file.read(header, 8, 8, offset + 8)).bytesRead !== 8) return false
      const large = header.readBigUInt64BE(8)
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) return false
      length = Number(large)
      headerLength = 16
    } else if (length === 0) length = size - offset
    if (length < headerLength || offset + length > size) return false
    if (type === 'ftyp' && length >= headerLength + 8) ftyp = true
    if (type === 'moov' && length > headerLength) moov = true
    if (type === 'mdat' && length > headerLength) mdat = true
    if (ftyp && moov && mdat) return true
    offset += length
  }
  return false
}

/**
 * Reads the duration from the movie header (`moov/mvhd`) without decoding the
 * video, so no FFmpeg is needed. Returns null when the box cannot be found.
 */
export async function readDuration(file: FileHandle, size: number): Promise<number | null> {
  const header = Buffer.alloc(16)
  let offset = 0
  // Find `moov` among the top-level boxes first.
  for (let i = 0; i < 128 && offset + 8 <= size; i++) {
    if ((await file.read(header, 0, 8, offset)).bytesRead !== 8) return null
    const type = header.toString('ascii', 4, 8)
    let length = header.readUInt32BE(0)
    let headerLength = 8
    if (length === 1) {
      if ((await file.read(header, 8, 8, offset + 8)).bytesRead !== 8) return null
      const large = header.readBigUInt64BE(8)
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null
      length = Number(large)
      headerLength = 16
    } else if (length === 0) length = size - offset
    if (length < headerLength || offset + length > size) return null
    if (type === 'moov') return readMvhd(file, offset + headerLength, length - headerLength)
    offset += length
  }
  return null
}

// `mvhd` sits directly inside `moov` and holds timescale + duration.
async function readMvhd(file: FileHandle, start: number, span: number): Promise<number | null> {
  const header = Buffer.alloc(8)
  let offset = start
  const end = start + span
  for (let i = 0; i < 64 && offset + 8 <= end; i++) {
    if ((await file.read(header, 0, 8, offset)).bytesRead !== 8) return null
    const type = header.toString('ascii', 4, 8)
    let length = header.readUInt32BE(0)
    let headerLength = 8
    if (length === 1) {
      const largeBuffer = Buffer.alloc(8)
      if ((await file.read(largeBuffer, 0, 8, offset + 8)).bytesRead !== 8) return null
      const large = largeBuffer.readBigUInt64BE(0)
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null
      length = Number(large)
      headerLength = 16
    } else if (length === 0) length = end - offset
    if (length < headerLength || offset + length > end) return null
    if (type === 'mvhd') {
      // version(1) + flags(3) then either 32-bit or 64-bit timescale/duration.
      const body = Buffer.alloc(Math.min(length - headerLength, 32))
      if ((await file.read(body, 0, body.length, offset + headerLength)).bytesRead < 20) return null
      const version = body.readUInt8(0)
      let timescale: number
      let units: number
      if (version === 1) {
        if (body.length < 28) return null
        timescale = body.readUInt32BE(20)
        const high = body.readUInt32BE(24)
        const low = body.length >= 32 ? body.readUInt32BE(28) : 0
        units = high * 2 ** 32 + low
      } else {
        timescale = body.readUInt32BE(12)
        units = body.readUInt32BE(16)
      }
      if (!timescale) return null
      const seconds = units / timescale
      return Number.isFinite(seconds) && seconds > 0 ? seconds : null
    }
    offset += length
  }
  return null
}

const images = new Map([['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'], ['.webp', 'image/webp']])
export const posterMime = (path: string): string | undefined => images.get(extname(path).toLowerCase())

export async function verifyPoster(file: FileHandle, path: string): Promise<string | null> {
  const type = posterMime(path)
  const bytes = Buffer.alloc(12)
  if (!type || (await file.read(bytes, 0, bytes.length, 0)).bytesRead !== bytes.length) return null
  const valid = (
    (type === 'image/jpeg' && bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])))
    || (type === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
    || (type === 'image/webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
  )
  return valid ? type : null
}
