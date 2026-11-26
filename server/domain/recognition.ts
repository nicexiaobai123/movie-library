import type { LibraryKind, MediaSuggestion } from '../../shared/types/library.ts'

export type IdentifiedMedia =
  | { kind: 'movie'; title: string; year: number | null; season: null; episode: null }
  | { kind: 'series'; title: string; year: number | null; season: number; episode: number }

export interface Recognition {
  match: IdentifiedMedia | null
  reason: string | null
  suggestion: MediaSuggestion
}

const generic = /^(?:电影|影片|电视剧|剧集|连续剧|上传|未分类|视频|样片|新建文件夹|movies?|films?|tv|series|shows?|uploads?|video|media|sample|untitled|temp|tmp)$/i
const seriesFolder = /^(?:电视剧|剧集|连续剧|tv|series|shows?)$/i
const commonTag = /[ ._-]+(?:2160p|1080p|720p|480p|4k|web[ ._-]?dl|webrip|blu[ ._-]?ray|h[ ._-]?26[45]|x26[45]|hevc|aac)(?=$|[ ._-])/i
const emptySuggestion: MediaSuggestion = { kind: null, title: null, year: null, season: null, episode: null }

function pending(reason: string, suggestion: Partial<MediaSuggestion> = {}): Recognition {
  return { match: null, reason, suggestion: { ...emptySuggestion, ...suggestion } }
}

function found(match: IdentifiedMedia): Recognition {
  return { match, reason: null, suggestion: match }
}

function seasonNumber(folder: string): number | null {
  const numeric = folder.match(/^(?:s(?:eason)?[ ._-]*([0-9]{1,3})|第\s*([0-9]{1,3})\s*季)$/i)
  if (numeric) return Number(numeric[1] ?? numeric[2])
  const chinese = folder.match(/^第\s*([零〇一二两三四五六七八九十]{1,3})\s*季$/)?.[1]
  if (!chinese) return null
  const digits: Record<string, number> = { 零: 0, '〇': 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  if (chinese.includes('十')) {
    const [tens, ones] = chinese.split('十')
    if (tens === undefined || ones === undefined || tens.length > 1 || ones.length > 1 || chinese.split('十').length !== 2) return null
    return (tens ? (digits[tens] ?? 0) : 1) * 10 + (ones ? (digits[ones] ?? 0) : 0)
  }
  return digits[chinese] ?? null
}

function readName(value: string): { title: string; year: number | null } | null {
  const cleaned = value.trim().split(commonTag)[0]?.replace(/^[\s._-]+|[\s._-]+$/g, '') ?? ''
  const suffix = cleaned.match(/\s*[(（]((?:18|19|20|21|22)\d{2}|2300)[)）]$/)
  const title = (suffix ? cleaned.slice(0, suffix.index).trim() : cleaned)
    .replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!title || title.length > 200 || generic.test(title) || /^\p{N}+$/u.test(title) || !/[\p{L}\p{N}]/u.test(title)) return null
  // Camera-generated names are not film titles.
  if (/^(?:(?:VID|IMG|DSC|MOV|MVI|VTS)[ -]*\d|(?:未命名|无标题)(?:\s*\d+)?$)/i.test(title)) return null
  return { title, year: suffix ? Number(suffix[1]) : null }
}

export function titleIdentity(kind: LibraryKind, title: string, year: number | null): string {
  return JSON.stringify([kind, title.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim(), year])
}

export function recognize(relativePath: string): Recognition {
  const parts = relativePath.split('/')
  const basename = parts.pop() ?? ''
  const stem = basename.replace(/\.mp4$/i, '').normalize('NFC').trim()
  const folders = parts.map(folder => folder.normalize('NFKC').trim())
  const seasons = folders.map(seasonNumber).filter((season): season is number => season !== null)
  const folderSeason = seasons.at(-1) ?? null
  const folderTitle = [...folders].reverse().find(folder => seasonNumber(folder) === null && !generic.test(folder))
  const hintedSeries = seasons.length > 0 || folders.some(folder => seriesFolder.test(folder))
  const tokens = [...stem.matchAll(/s\s*([0-9]{1,3})[ ._-]*e\s*([0-9]{1,4})(?![0-9])|第\s*([0-9]{1,4})\s*[集话話]/gi)]
  const token = tokens[0]
  const range = /(?:第\s*)?[0-9]{1,4}\s*[-~–—至到、+&]\s*(?:第\s*)?[0-9]{1,4}\s*[集话話]/u.test(stem)
  const trailing = token ? stem.slice(token.index + token[0].length) : ''
  if (tokens.length > 1 || range || /^[\s._~-]*(?:e\s*\d|[-~–—至到+&]\s*(?:e|第)?\s*\d)/i.test(trailing)) {
    return pending('文件名包含多个集号或集号范围，请确认对应哪一集。', { kind: 'series' })
  }
  if (token || (hintedSeries && /^[0-9]{1,4}$/.test(stem))) {
    const explicitSeason = token?.[1] === undefined ? null : Number(token[1])
    const season = explicitSeason ?? folderSeason ?? 1
    const episode = token ? Number(token[2] ?? token[3]) : Number(stem)
    const nameBefore = token ? stem.slice(0, token.index).trim().replace(/[\s._-]+$/, '') : ''
    const name = readName(nameBefore || folderTitle || '')
    const suggestion = { kind: 'series' as const, title: name?.title ?? null, year: name?.year ?? null, season, episode: episode || null }
    if (new Set(seasons).size > 1 || (explicitSeason !== null && folderSeason !== null && explicitSeason !== folderSeason)) {
      return pending('文件名和所在目录的季号冲突。', { ...suggestion, season: null })
    }
    if (episode < 1) return pending('集号必须大于零。', suggestion)
    if (!name) return pending('提取到集号，但无法确定剧名。', suggestion)
    return found({ kind: 'series', ...name, season, episode })
  }
  if (hintedSeries || /(?:^|[\s._-])(?:s\d+|e\d+|ep\d+)(?=$|[\s._-])|第[^\s]{0,8}[集话話]/i.test(stem)) {
    const name = folderTitle ? readName(folderTitle) : null
    return pending('像是剧集文件，但没有可确认的集号。', { kind: 'series', title: name?.title ?? null, year: name?.year ?? null, season: folderSeason })
  }
  const name = readName(stem)
  if (!name) return pending('无法从文件名可靠识别片名。')
  return found({ kind: 'movie', ...name, season: null, episode: null })
}
