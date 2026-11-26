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
