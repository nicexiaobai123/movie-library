import { getCookie, getHeader, setCookie, deleteCookie } from 'h3'
import type { H3Event } from 'h3'
import type { TLSSocket } from 'node:tls'
import type { LibraryRuntime } from '../services/runtime.ts'
import type { UserRecord } from '../db/users.ts'
import { LibraryError } from '../domain/errors.ts'

const cookieName = 'night_library_session'
const userCookieName = 'night_library_user'
const encrypted = (event: H3Event) => Boolean((event.node.req.socket as TLSSocket).encrypted)
export const sessionToken = (event: H3Event) => getCookie(event, cookieName)
export const userToken = (event: H3Event) => getCookie(event, userCookieName)

function cookieSettings(event: H3Event, runtime: LibraryRuntime) {
  return {
    path: '/', httpOnly: true, sameSite: 'strict' as const,
    secure: runtime.config.secureCookies || encrypted(event),
  }
}

export function writeSession(event: H3Event, runtime: LibraryRuntime, token: string, maxAge: number): void {
  setCookie(event, cookieName, token, { ...cookieSettings(event, runtime), maxAge })
}

export function clearSession(event: H3Event, runtime: LibraryRuntime): void {
  deleteCookie(event, cookieName, cookieSettings(event, runtime))
}

export function writeUserSession(event: H3Event, runtime: LibraryRuntime, token: string, maxAge: number): void {
  // A visitor session is deliberately kept in its own cookie so it can never be
  // mistaken for the administrator's.
  setCookie(event, userCookieName, token, { ...cookieSettings(event, runtime), maxAge })
}

export function clearUserSession(event: H3Event, runtime: LibraryRuntime): void {
  deleteCookie(event, userCookieName, cookieSettings(event, runtime))
}

export function requireAdmin(event: H3Event, runtime: LibraryRuntime): { username: string } {
  const admin = runtime.auth.session(sessionToken(event))
  if (!admin) throw new LibraryError(401, '请先登录管理后台。')
  return admin
}

export function currentUser(event: H3Event, runtime: LibraryRuntime): UserRecord | null {
  return runtime.userAuth.session(userToken(event))
}

export function requireUser(event: H3Event, runtime: LibraryRuntime): UserRecord {
  const user = currentUser(event, runtime)
  if (!user) throw new LibraryError(401, '请先登录。')
  return user
}

export function requestOrigin(event: H3Event): string | null {
  const host = getHeader(event, 'host')
  // Do not trust forwarded host/protocol on a directly exposed LAN listener.
  if (!host || !/^[a-z0-9.:[\]-]+$/i.test(host)) return null
  try {
    return new URL(`${encrypted(event) ? 'https' : 'http'}://${host}`).origin
  } catch {
    return null
  }
}

export function requireSameOrigin(event: H3Event, runtime: LibraryRuntime): void {
  const origin = getHeader(event, 'origin')
  const destination = requestOrigin(event)
  const allowed = runtime.config.allowedOrigins
  if (!origin || origin !== destination || (allowed.length && !allowed.includes(origin)) || getHeader(event, 'sec-fetch-site') === 'cross-site') {
    throw new LibraryError(403, '写入请求必须从本站页面发起。')
  }
}
