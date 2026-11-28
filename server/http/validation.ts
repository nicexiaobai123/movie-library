import { z } from 'zod'
import type { BrowseQuery, ClassifyInput, MediaEdit } from '../../shared/types/library.ts'
import { LibraryError } from '../domain/errors.ts'
import { validUsername } from '../domain/password.ts'

const slug = z.enum(['movie', 'series'])
const sort = z.enum(['newest', 'title'])
const credentials = z.object({
  username: z.string().trim().refine(validUsername),
  password: z.string().min(1).max(256),
})
const text = (max: number) => z.string().trim().max(max)
const list = z.array(text(40)).max(20)

const editForm = z.object({
  title: z.string().trim().min(1).max(200),
  year: z.int().min(1800).max(2300).nullable(),
  description: z.string().trim().max(6000),
  posterPath: z.string().trim().min(1).max(2048).nullable(),
  runtime: z.int().min(0).max(1440).nullable().default(null),
  cast: list.default([]),
  kind: slug,
  season: z.int().min(0).max(999).nullable(),
  episode: z.int().min(1).max(9999).nullable(),
})

const classifyForm = z.object({
  ids: z.array(z.uuidv4()).min(1).max(500),
  kind: slug,
  titleId: z.uuidv4().nullable().default(null),
  title: z.string().trim().min(1).max(200).nullable().default(null),
  season: z.int().min(0).max(999).nullable().default(null),
})

export function parseClassify(input: unknown): ClassifyInput {
  const result = classifyForm.safeParse(input)
  if (!result.success) throw new LibraryError(422, '批量分类的参数无效，请检查所选文件与类型。')
  const fields = result.data
  if (fields.kind === 'series' && fields.titleId === null && fields.title === null) {
    throw new LibraryError(422, '把文件归类为剧集时，请填写剧名或选择一个已有剧集。')
  }
  return fields
}

const browseForm = z.object({  q: text(200).optional(),
  kind: slug.optional(),
  actor: text(40).optional(),
  sort: sort.optional(),
  page: z.int().min(1).max(10_000).optional(),
  pageSize: z.int().min(1).max(60).optional(),
})

const progressForm = z.object({
  titleId: z.uuidv4(),
  episodeId: z.uuidv4().nullable().default(null),
  position: z.number().min(0).max(86_400 * 7),
  duration: z.number().positive().max(86_400 * 7),
})

const passwordChange = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(1).max(256),
})

const userCredentials = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
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

export function parsePasswordChange(input: unknown) {
  const result = passwordChange.safeParse(input)
  if (!result.success) throw new LibraryError(400, '请输入当前密码和新密码。')
  return result.data
}

export function parseProgress(input: unknown) {
  const result = progressForm.safeParse(input)
  if (!result.success) throw new LibraryError(422, '播放进度无效。')
  return result.data
}

export function parseBrowseQuery(input: Record<string, unknown>): BrowseQuery {
  const result = browseForm.safeParse({
    q: typeof input.q === 'string' ? input.q : undefined,
    kind: typeof input.kind === 'string' ? input.kind : undefined,
    actor: typeof input.actor === 'string' ? input.actor : undefined,
    sort: typeof input.sort === 'string' ? input.sort : undefined,
    page: optionalNumber(input.page, 'page'),
    pageSize: optionalNumber(input.pageSize, 'pageSize'),
  })
  if (!result.success) throw new LibraryError(400, '浏览或筛选参数无效。')
  const query = result.data
  return {
    q: query.q ?? '',
    kind: query.kind ?? null,
    actor: query.actor ?? null,
    sort: query.sort ?? 'newest',
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 24,
  }
}

// An actor name arrives from the URL, so it is length-limited and trimmed.
export function parseActorName(input: unknown): string {
  const result = z.string().trim().min(1).max(40).safeParse(input)
  if (!result.success) throw new LibraryError(400, '演员名称无效。')
  return result.data
}

export function parseCatalogQuery(input: unknown) {
  const result = z.object({ q: text(200).optional(), kind: slug.optional() }).safeParse(input)
  if (!result.success) throw new LibraryError(400, '搜索或分类参数无效。')
  return { q: result.data.q ?? '', kind: result.data.kind ?? null }
}

export function parseMediaEdit(input: unknown): MediaEdit {
  const result = editForm.safeParse(input)
  if (!result.success) throw new LibraryError(422, '请检查片名、年份、简介、封面及集号的格式和长度。')
  const fields = result.data
  if (fields.kind === 'series' && (fields.season === null || fields.episode === null)) {
    throw new LibraryError(422, '请填写季号和集号。')
  }
  if (fields.kind === 'movie' && (fields.season !== null || fields.episode !== null)) {
    throw new LibraryError(422, '电影不应包含季号或集号。')
  }
  return { ...fields }
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
