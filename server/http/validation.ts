import { z } from 'zod'
import type { BrowseQuery, BulkEditItem, MediaEdit } from '../../shared/types/library.ts'
import { LibraryError } from '../domain/errors.ts'
import { validUsername } from '../domain/password.ts'

const slug = z.enum(['movie', 'series'])
const sort = z.enum(['newest', 'rating', 'year', 'title'])
const credentials = z.object({
  username: z.string().trim().refine(validUsername),
  password: z.string().min(1).max(256),
})
const text = (max: number) => z.string().trim().max(max)
const list = z.array(text(40)).max(20)
const editForm = z.object({
  titleId: z.uuidv4().nullable(),
  kind: slug,
  title: z.string().trim().min(1).max(200),
  originalTitle: text(200).nullable().default(null),
  year: z.int().min(1800).max(2300).nullable(),
  description: z.string().trim().max(6000),
  genres: list.default([]),
  region: text(40).nullable().default(null),
  rating: z.number().min(0).max(10).nullable().default(null),
  runtime: z.int().min(0).max(1440).nullable().default(null),
  director: text(120).nullable().default(null),
  cast: list.default([]),
  posterPath: z.string().trim().min(1).max(2048).nullable(),
  backdropPath: z.string().trim().min(1).max(2048).nullable().default(null),
  season: z.int().min(0).max(999).nullable(),
  episode: z.int().min(1).max(9999).nullable(),
  episodeTitle: z.string().trim().min(1).max(200).nullable(),
  replaceExisting: z.boolean().optional(),
})
const bulkItem = z.object({
  id: z.uuidv4(),
  mode: z.enum(['publish', 'complete']).default('publish'),
  titleId: z.uuidv4().nullable().default(null),
  kind: slug.nullable().default(null),
  title: text(200).nullable().default(null),
  year: z.int().min(1800).max(2300).nullable().default(null),
  description: z.string().trim().max(6000).nullable().default(null),
  posterPath: z.string().trim().min(1).max(2048).nullable().default(null),
  season: z.int().min(0).max(999).nullable().default(null),
  episode: z.int().min(1).max(9999).nullable().default(null),
  episodeTitle: text(200).nullable().default(null),
  replaceExisting: z.boolean().default(false),
  overwrite: z.boolean().default(false),
})
const bulkForm = z.object({ items: z.array(bulkItem).min(1).max(500) })
const settingsForm = z.object({ defaultDescription: z.string().trim().max(6000) })
const userCredentials = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
})
const browseForm = z.object({
  q: text(200).optional(),
  kind: slug.optional(),
  genre: text(40).optional(),
  region: text(40).optional(),
  yearFrom: z.int().min(1800).max(2300).optional(),
  yearTo: z.int().min(1800).max(2300).optional(),
  minRating: z.number().min(0).max(10).optional(),
  sort: sort.optional(),
  page: z.int().min(1).max(10_000).optional(),
  pageSize: z.int().min(1).max(60).optional(),
})

export function parseCredentials(input: unknown) {
  const result = credentials.safeParse(input)
  if (!result.success) throw new LibraryError(400, '请输入有效的用户名和密码。')
  return result.data
}

// A single number for a single-value query string; repeated keys are rejected
// rather than silently guessed.
function optionalNumber(value: unknown, name: string): number | undefined {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string') throw new LibraryError(400, `筛选参数 ${name} 只能出现一次。`)
  const number = Number(value)
  if (!Number.isFinite(number)) throw new LibraryError(400, `筛选参数 ${name} 无效。`)
  return number
}

export function parseBrowseQuery(input: Record<string, unknown>): BrowseQuery {
  const result = browseForm.safeParse({
    q: typeof input.q === 'string' ? input.q : undefined,
    kind: typeof input.kind === 'string' ? input.kind : undefined,
    genre: typeof input.genre === 'string' ? input.genre : undefined,
    region: typeof input.region === 'string' ? input.region : undefined,
    yearFrom: optionalNumber(input.yearFrom, 'yearFrom'),
    yearTo: optionalNumber(input.yearTo, 'yearTo'),
    minRating: optionalNumber(input.minRating, 'minRating'),
    sort: typeof input.sort === 'string' ? input.sort : undefined,
    page: optionalNumber(input.page, 'page'),
    pageSize: optionalNumber(input.pageSize, 'pageSize'),
  })
  if (!result.success) throw new LibraryError(400, '浏览或筛选参数无效。')
  const query = result.data
  if (query.yearFrom !== undefined && query.yearTo !== undefined && query.yearFrom > query.yearTo) {
    throw new LibraryError(400, '起始年份不能晚于结束年份。')
  }
  return {
    q: query.q ?? '',
    kind: query.kind ?? null,
    genre: query.genre ?? null,
    region: query.region ?? null,
    yearFrom: query.yearFrom ?? null,
    yearTo: query.yearTo ?? null,
    minRating: query.minRating ?? null,
    sort: query.sort ?? 'newest',
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 24,
  }
}

export function parseCatalogQuery(input: unknown) {
  const result = z.object({ q: text(200).optional(), kind: slug.optional() }).safeParse(input)
  if (!result.success) throw new LibraryError(400, '搜索或分类参数无效。')
  return { q: result.data.q ?? '', kind: result.data.kind ?? null }
}

export function parseMediaEdit(input: unknown): MediaEdit {
  const result = editForm.safeParse(input)
  if (!result.success) throw new LibraryError(422, '请检查片名、年份、简介、分类、评分、海报路径及剧集编号的格式和长度。')
  const fields = result.data
  if (fields.kind === 'series' && (fields.season === null || fields.episode === null)) {
    throw new LibraryError(422, '请填写季号和集号。')
  }
  if (fields.kind === 'movie' && (fields.season !== null || fields.episode !== null || fields.episodeTitle !== null)) {
    throw new LibraryError(422, '电影不应包含季号、集号或单集标题。')
  }
  return { ...fields }
}

export function parseBulkEdit(input: unknown): BulkEditItem[] {
  const result = bulkForm.safeParse(input)
  if (!result.success) throw new LibraryError(422, '批量整理的参数无效，请检查片名、年份和集号。')
  const seen = new Set<string>()
  for (const item of result.data.items) {
    if (seen.has(item.id)) throw new LibraryError(422, '同一文件在批量请求中出现了多次。')
    seen.add(item.id)
  }
  return result.data.items
}

export function parseSettings(input: unknown) {
  const result = settingsForm.safeParse(input)
  if (!result.success) throw new LibraryError(422, '默认简介最长 6000 个字符。')
  return result.data
}

// Registration validates the 6-character floor again in the service layer.
export function parseUserRegister(input: unknown) {
  const result = userCredentials.safeParse(input)
  if (!result.success) throw new LibraryError(400, '请输入用户名和密码。')
  return result.data
}

export function parseUserLogin(input: unknown) {
  const result = userCredentials.safeParse(input)
  if (!result.success) throw new LibraryError(400, '请输入用户名和密码。')
  return result.data
}
