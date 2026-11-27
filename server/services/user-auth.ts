import { createHash, randomBytes } from 'node:crypto'
import type { UserRecord, UserStore } from '../db/users.ts'
import { LibraryError } from '../domain/errors.ts'
import { hashPassword, validPassword, validUsername, verifyPassword } from '../domain/password.ts'

const sessionLifetimeSeconds = 30 * 24 * 60 * 60
const rateWindow = 60_000
const attemptsAllowed = 12
const tokenPattern = /^[a-zA-Z0-9_-]{43}$/
const digest = (token: string) => createHash('sha256').update(token).digest('hex')

// Visitors may register and sign in; this never grants admin capability.
export function createUserAuth(users: UserStore) {
  const attempts = new Map<string, { expires: number; count: number }>()
  let verifying = 0
  let pruneAfter = 0

  function limit(ip: string) {
    const now = Date.now()
    if (now >= pruneAfter) {
      for (const [key, value] of attempts) if (now >= value.expires) attempts.delete(key)
      users.expireSessions(now)
      pruneAfter = now + rateWindow
    }
    let record = attempts.get(ip)
    if (!record || now >= record.expires) {
      record = { expires: now + rateWindow, count: 0 }
      attempts.set(ip, record)
    }
    if (record.count >= attemptsAllowed || verifying >= 2) throw new LibraryError(429, '尝试次数过多，请稍后再试。')
    record.count++
    return () => { attempts.delete(ip) }
  }

  function issue(user: UserRecord, previousToken: string | undefined) {
    if (previousToken && tokenPattern.test(previousToken)) users.removeSession(digest(previousToken))
    const token = randomBytes(32).toString('base64url')
    users.addSession(digest(token), user.id, Date.now() + sessionLifetimeSeconds * 1000)
    return { token, maxAge: sessionLifetimeSeconds, username: user.username }
  }

  return {
    session(token: string | undefined): UserRecord | null {
      if (!token || !tokenPattern.test(token)) return null
      return users.session(digest(token), Date.now()) ?? null
    },
    end(token: string | undefined) {
      if (token && tokenPattern.test(token)) users.removeSession(digest(token))
    },
    async register(username: string, password: string, ip: string, previousToken: string | undefined) {
      if (!validUsername(username)) throw new LibraryError(422, '用户名只能包含文字、数字、点、下划线和连字符，最多 64 个字符。')
      if (!validPassword(password)) throw new LibraryError(422, '密码至少 6 位。')
      const reset = limit(ip)
      if (users.byName(username)) throw new LibraryError(409, '这个用户名已被使用，请换一个。')
      const user = users.create(username, await hashPassword(password))
      if (!user) throw new LibraryError(409, '这个用户名已被使用，请换一个。')
      reset()
      return issue(user, previousToken)
    },
    async login(username: string, password: string, ip: string, previousToken: string | undefined) {
      const reset = limit(ip)
      const user = users.byName(username)
      verifying++
      try {
        const valid = await verifyPassword(password, user?.password_hash)
        const current = users.byId(user?.id ?? '')
        if (!valid || !user || !current || current.password_hash !== user.password_hash) {
          throw new LibraryError(401, '用户名或密码不正确。')
        }
        reset()
        return issue(current, previousToken)
      } finally {
        verifying--
      }
    },
    // Changing a password ends every other session so a leaked cookie stops working.
    async changePassword(user: UserRecord, current: string, next: string, ip: string) {
      if (!validPassword(next)) throw new LibraryError(422, '新密码至少 6 位。')
      const reset = limit(ip)
      verifying++
      try {
        if (!await verifyPassword(current, user.password_hash)) throw new LibraryError(403, '当前密码不正确。')
        reset()
        users.setPassword(user.id, await hashPassword(next))
      } finally {
        verifying--
      }
    },
  }
}

export type UserAuth = ReturnType<typeof createUserAuth>
