import { createError, defineEventHandler, getHeader, getRouterParam, setHeader } from 'h3'
import type { H3Event } from 'h3'
import { getLibraryRuntime } from '../services/runtime.ts'
import type { LibraryRuntime } from '../services/runtime.ts'
import type { UserRecord } from '../db/users.ts'
import type { UploadInput } from '../storage/uploads.ts'
import { errorCode, LibraryError } from '../domain/errors.ts'
import { requireAdmin, requireSameOrigin, requireUser, currentUser } from './access.ts'

const statusText: Record<LibraryError['status'], string> = {
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed',
  409: 'Conflict', 413: 'Payload Too Large', 415: 'Unsupported Media Type', 422: 'Unprocessable Content',
  429: 'Too Many Requests', 500: 'Internal Server Error', 503: 'Service Unavailable',
}

type Endpoint<T> = (event: H3Event, runtime: LibraryRuntime) => T | Promise<T>

export function endpoint<T>(handler: Endpoint<T>) {
  return defineEventHandler(async (event) => {
    try {
      return await handler(event, getLibraryRuntime(useRuntimeConfig(event).library))
    } catch (error) {
      if (event.node.res.destroyed || event.node.res.writableEnded) return
      if (event.node.res.headersSent) {
        event.node.res.destroy()
        return
      }
      if (!(error instanceof LibraryError)) console.error('[library] Request failed:', errorCode(error) ?? 'unexpected error')
      const safe = error instanceof LibraryError ? error : new LibraryError(500, '服务暂时无法处理请求，请稍后再试。')
      throw createError({
        statusCode: safe.status, statusMessage: statusText[safe.status],
        data: { message: safe.message, ...(safe.code ? { code: safe.code } : {}) },
      })
    }
  })
}

export function adminEndpoint<T>(handler: Endpoint<T>, options: { write?: boolean; login?: boolean } = {}) {
  return endpoint((event, runtime) => {
    setHeader(event, 'Cache-Control', 'no-store')
    if (!options.login) requireAdmin(event, runtime)
    if (options.write) requireSameOrigin(event, runtime)
    return handler(event, runtime)
  })
}

type UserHandler<T> = (event: H3Event, runtime: LibraryRuntime, user: UserRecord) => T | Promise<T>
type MaybeUserHandler<T> = (event: H3Event, runtime: LibraryRuntime, user: UserRecord | null) => T | Promise<T>

function visitorEndpoint<T>(handler: MaybeUserHandler<T>, write: boolean) {
  return endpoint((event, runtime) => {
    setHeader(event, 'Cache-Control', 'no-store')
    if (write) requireSameOrigin(event, runtime)
    return handler(event, runtime, currentUser(event, runtime))
  })
}

// Visitor endpoints: never admin-guarded, always require a signed-in user.
export function userEndpoint<T>(handler: UserHandler<T>, options: { write?: boolean } = {}) {
  return visitorEndpoint((event, runtime, user) => {
    if (!user) throw new LibraryError(401, '请先登录。')
    return handler(event, runtime, user)
  }, Boolean(options.write))
}

// Same, but tolerated for anonymous visitors so a page can render signed-out state.
export function optionalUserEndpoint<T>(handler: MaybeUserHandler<T>, options: { write?: boolean } = {}) {
  return visitorEndpoint(handler, Boolean(options.write))
}

export function routeId(event: H3Event): string {
  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    throw new LibraryError(404, '未找到该资源。')
  }
  return id
}

function lengthOfBody(event: H3Event): number | null {
  const value = getHeader(event, 'content-length')
  if (value === undefined) return null
  const number = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number)) throw new LibraryError(400, '请求体长度无效。')
  return number
}

export async function smallJson(event: H3Event): Promise<unknown> {
  const contentType = getHeader(event, 'content-type')?.split(';')[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') throw new LibraryError(415, '请求必须使用 JSON。')
  const limit = 32 * 1024
  const length = lengthOfBody(event)
  if (length !== null && length > limit) throw new LibraryError(413, '表单数据过大。')
  const buffers: Buffer[] = []
  let size = 0
  for await (const chunk of event.node.req.iterator({ destroyOnReturn: false })) {
    size += chunk.length
    if (size > limit) {
      event.node.req.resume()
      throw new LibraryError(413, '表单数据过大。')
    }
    buffers.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(buffers).toString('utf8'))
  } catch {
    throw new LibraryError(400, '请求中的 JSON 无效。')
  }
}

export function uploadInput(event: H3Event, name: unknown): UploadInput {
  if (typeof name !== 'string' || !name) throw new LibraryError(400, '请选择文件并提供原文件名。')
  const req = event.node.req
  const encoding = getHeader(event, 'content-encoding')
  if (encoding && encoding !== 'identity') throw new LibraryError(415, '不支持压缩过的上传请求。')
  return { name, length: lengthOfBody(event), body: req.iterator({ destroyOnReturn: false }) }
}
