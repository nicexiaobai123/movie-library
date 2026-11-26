export interface ByteRange { start: number; end: number }

export function byteRange(header: string, size: number): ByteRange | null {
  const parts = /^bytes=(\d*)-(\d*)$/i.exec(header.trim())
  if (!parts || (!parts[1] && !parts[2]) || size <= 0) return null
  const length = BigInt(size)
  const last = length - BigInt(1)
  if (!parts[1]) {
    const suffix = BigInt(parts[2]!)
    if (suffix === BigInt(0)) return null
    return { start: suffix >= length ? 0 : Number(length - suffix), end: Number(last) }
  }
  const start = BigInt(parts[1])
  const end = parts[2] ? BigInt(parts[2]) : last
  if (start >= length || end < start) return null
  return { start: Number(start), end: Number(end > last ? last : end) }
}

export function disposition(name: string, attachment: boolean): string {
  const ascii = /^[\x20-\x7e]+$/.test(name) ? name.replace(/["\\]/g, '_') : 'video.mp4'
  const encoded = encodeURIComponent(name).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${attachment ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encoded}`
}
