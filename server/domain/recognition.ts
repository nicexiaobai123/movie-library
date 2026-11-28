// Media recognition.
//
// The library is "whatever MP4 files sit in the media folder", so recognition only
// has to answer two questions: what is this called, and is it one film or one
// episode of a series. It never refuses a file — an unreadable name still becomes an
// entry, using the filename as the title.
import type { LibraryKind } from '../../shared/types/library.ts'

export interface Identified {
  kind: LibraryKind
  title: string
  year: number | null
  actor: string | null
  season: number | null
  episode: number | null
}

// A folder that only groups seasons, never a title.
const seasonFolder = /^(?:s(?:eason)?\s*([0-9]{1,3})|第\s*([0-9]{1,3})\s*季|第\s*([零〇一二三四五六七八九十]{1,3})\s*季)$/i
// Folder names that carry no title information at all.
const genericFolder = /^(?:电影|影片|电视剧|剧集|连续剧|上传|未分类|视频|样片|新建文件夹|movies?|films?|tv|series|shows?|uploads?|video|media|sample|untitled|temp|tmp)$/i
// Quality and release tags that are never part of a title.
const qualityTag = /(?:^|[\s._-])(?:2160p|1080p|720p|480p|4k|8k|web[ ._-]?dl|webrip|blu[ ._-]?ray|brrip|hdtv|h[ ._-]?26[45]|x26[45]|hevc|aac|dts|remux|hdr|中文字幕|无字幕|原版无中文|中字|字幕|国语|粤语|日语|日文)(?=$|[\s._-])/gi

const chineseDigits: Record<string, number> = {
  零: 0, '〇': 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}

// 十二 → 12, 二十 → 20, 二十三 → 23. Anything else is not a number.
function chineseNumber(value: string): number | null {
  if (!/[十百]/.test(value)) return chineseDigits[value] ?? null
  let total = 0
  let pending: number | null = null
  for (const char of value) {
    if (char === '百') { total += (pending ?? 1) * 100; pending = null }
    else if (char === '十') { total += (pending ?? 1) * 10; pending = null }
    else {
      const digit = chineseDigits[char]
      if (digit === undefined) return null
      pending = digit
    }
  }
  return total + (pending ?? 0)
}

// Episode numbers, in the notations releases actually use:
//   S01E02, 第02集, 第2话, 第01期, EP02, E02, 第二集, and a bare trailing number.
const episodeMarker = new RegExp([
  String.raw`(?<!\p{L})s\s*(?<sseason>[0-9]{1,3})[ ._-]*e\s*(?<sepisode>[0-9]{1,4})(?![0-9])`,
  String.raw`(?<!\p{L})(?:ep|e)[ ._-]*(?<eepisode>[0-9]{1,4})(?![0-9])`,
  String.raw`第\s*(?<zhepisode>[0-9]{1,4})\s*[集话話期]`,
  String.raw`第\s*(?<cnepisode>[零〇一二三四五六七八九十百]{1,6})\s*[集话話期]`,
].join('|'), 'giu')

function episodeOf(match: RegExpMatchArray): number | null {
  const groups = match.groups ?? {}
  if (groups.sepisode !== undefined) return Number(groups.sepisode)
  if (groups.eepisode !== undefined) return Number(groups.eepisode)
  if (groups.zhepisode !== undefined) return Number(groups.zhepisode)
  if (groups.cnepisode !== undefined) return chineseNumber(groups.cnepisode)
  return null
}

function seasonOf(match: RegExpMatchArray): number | null {
  const value = match.groups?.sseason
  return value === undefined ? null : Number(value)
}

function seasonFromFolder(folder: string): number | null {
  const match = folder.match(seasonFolder)
  if (!match) return null
  const [, seasonNumber, zhNumber, cnNumber] = match
  if (seasonNumber) return Number(seasonNumber)
  if (zhNumber) return Number(zhNumber)
  return cnNumber ? chineseNumber(cnNumber) : null
}
// Strips quality/language tags and the surrounding separators.
function cleanName(value: string): string {
  let text = value.replace(/\.[a-z0-9]{2,4}$/i, '')
  // A leading bracket group is a release crew (`[字幕组]`), not a title.
  text = text.replace(/^(?:\s*[[(（][^\])）]*[\])）])+\s*/u, '')
  text = text.replace(qualityTag, ' ')
  // A trailing language note is release detail, not a title: `... ，中文字幕`.
  text = text.replace(/[\s,，。·]*(?:中文字幕|中文字慕|中字|無字幕|无字幕|原版无中文|繁體中文|繁体中文|简繁双语|内嵌字幕|外挂字幕)$/u, ' ')
  // A trailing bracket tag is a release detail (`[1080p]`, `(2019)`).
  const year = text.match(/[(（]\s*((?:18|19|20|21|22)\d{2})\s*[)）]\s*$/u)?.[1] ?? null
  text = text.replace(/\s*[[(（][^\])）]*[\])）]\s*$/u, ' ')
  text = text.replace(/[._]+/g, ' ').replace(/\s+/g, ' ')
  text = text.replace(/^[\s._-]+|[\s._-]+$/g, '')
  return text.trim()
}

// `演员-片名` / `演员-编号 片名`: the part before the first dash is the performer.
// The rule is absolute (a dash-joined name always means star-title), and a tail that
// starts with a digit is not a star, so `[组名] 片名 - 01` keeps its title.
function splitActor(stem: string): { actor: string | null; rest: string } {
  const index = stem.search(/[-–—]/)
  if (index <= 0) return { actor: null, rest: stem }
  const actor = stem.slice(0, index).trim()
  const rest = stem.slice(index + 1).trim()
  if (!actor || !rest) return { actor: null, rest: stem }
  if (actor.length > 40 || !/[\p{L}]/u.test(actor) || genericFolder.test(actor)) return { actor: null, rest: stem }
  if (/^[0-9]/.test(rest)) return { actor: null, rest: stem }
  return { actor, rest }
}

// A trailing standalone number (`片名 01`, `片名-01`) is an episode number when the
// name also looks like a release. Two things are never episodes: a four-digit year,
// and a large catalogue number such as `WAAA-501`, which is a release id.
function trailingEpisode(stem: string): { title: string; episode: number } | null {
  // A trailing bracket tag is release detail, not part of the title or the number.
  const trimmed = stem.replace(/(?:\s*[[(（][^\])）]*[\])）])+\s*$/u, '').trim()
  const match = trimmed.match(/^(?<title>.+?)\s*(?:[-–—_]\s*|\s+)(?<number>[0-9]{1,4})$/u)
  const rawTitle = match?.groups?.title
  const rawNumber = match?.groups?.number
  if (!rawTitle || !rawNumber) return null
  const number = Number(rawNumber)
  if (!Number.isSafeInteger(number) || number < 1 || number > 200) return null
  // A year is metadata: `片名 2021` is not episode 2021.
  if (/^(?:18|19|20|21|22)\d{2}$/.test(rawNumber)) return null
  const title = cleanName(rawTitle)
  return title ? { title, episode: number } : null
}

export function recognize(relativePath: string): Identified {
  const parts = relativePath.split('/').map(part => part.normalize('NFC').trim())
  const fileName = parts.pop() ?? ''
  const stem = fileName.replace(/\.mp4$/i, '')
  const folders = parts.filter(part => !genericFolder.test(part))
  // A folder may be a bare season (`第二季`), or carry the season in its name
  // (`山海旧事 第二季`); both tell us which season the files inside belong to.
  const folderSeasons = folders.map(folder => seasonFromFolder(folder) ?? seasonInText(folder))
    .filter((value): value is number => value !== null)
  const folderSeason = folderSeasons.at(-1) ?? null
  const folderTitle = [...folders].reverse()
    .filter(folder => seasonFromFolder(folder) === null)
    .map(folder => stripSeasonWords(folder))
    .find(folder => folder && !genericFolder.test(folder))

  const { actor, rest: afterActor } = splitActor(stem)
  // `演员-片名-dx123`: an ASCII-only tail after the star is a release id, not part
  // of the title. Chinese tails are kept, because titles are often dash-joined. A
  // tail that begins with a digit (`WAAA-501`) is a catalogue id and stays put.
  const rest = actor ? afterActor.replace(/[-–—_]\s*(?![0-9])[A-Za-z0-9_.]{2,40}\s*$/u, '').trim() : afterActor
  const markers = [...rest.matchAll(episodeMarker)]

  if (markers.length > 0) {
    const first = markers[0]!
    // A season may be written in the filename (`第02集` inside `第二季` folder is
    // not enough), so both the marker and the name are checked.
    const season = seasonOf(first) ?? seasonInText(rest) ?? folderSeason ?? 1
    const episode = episodeOf(first)
    const beforeMarker = cleanName(rest.slice(0, first.index))
    const title = beforeMarker || cleanName(folderTitle ?? '') || cleanName(rest) || stem
    if (episode !== null && episode >= 1) {
      return { kind: 'series', title: stripSeasonWords(title), year: yearIn(rest), actor, season, episode }
    }
  }

  const trailing = trailingEpisode(rest)
  if (trailing) {
    return {
      kind: 'series',
      title: stripSeasonWords(trailing.title),
      year: yearIn(rest),
      actor,
      season: seasonInText(rest) ?? folderSeason ?? 1,
      episode: trailing.episode,
    }
  }

  // No episode number: a film. It may still live in a season folder, in which case
  // the folder is only a location, not evidence of a series.
  const title = cleanName(rest) || cleanName(folderTitle ?? '') || stem
  return { kind: 'movie', title, year: yearIn(rest), actor, season: null, episode: null }
}

// `第二季` / `S02` inside a name: the season a series belongs to. It is removed from
// the title separately, because `山海旧事 第二季` is still the show 山海旧事.
const seasonInName = /(?:第\s*([0-9]{1,3}|[零〇一二三四五六七八九十]{1,3})\s*季)|(?:(?<!\p{L})s(?:eason)?\s*([0-9]{1,3})(?![0-9]))/iu

function seasonInText(value: string): number | null {
  const match = value.match(seasonInName)
  if (!match) return null
  const [, zh, digits] = match
  if (zh) return /^[0-9]+$/.test(zh) ? Number(zh) : chineseNumber(zh)
  return digits ? Number(digits) : null
}

function stripSeasonWords(value: string): string {
  return value.replace(seasonInName, ' ').replace(/\s+/g, ' ').trim()
}

function yearIn(value: string): number | null {
  const match = value.match(/[(（]\s*((?:18|19|20|21|22)\d{2})\s*[)）]/u) ?? value.match(/(?:^|[\s._-])((?:18|19|20|21|22)\d{2})(?=$|[\s._-])/u)
  const found = match?.[1]
  return found ? Number(found) : null
}

// The identity used to tell "the same film" apart from a different one.
export function titleIdentity(kind: LibraryKind, title: string, year: number | null): string {
  return JSON.stringify([kind, title.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim(), year])
}
