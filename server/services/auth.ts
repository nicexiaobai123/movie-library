import { createHash, randomBytes } from 'node:crypto'
import type { adminStore } from '../db/admin.ts'
import { LibraryError } from '../domain/errors.ts'
import { verifyPassword } from '../domain/password.ts'

const sessionLifetimeSeconds = 12 * 60 * 60
const rateWindow = 60_000
const attemptsAllowed = 10
const tokenPattern = /^[a-zA-Z0-9_-]{43}$/
const digest = (token: string) => createHash('sha256').update(token).digest('hex')

export function createAuth(db: ReturnType<typeof adminStore>) {
  const attempts = new Map<string, { expires: number; count: number }>()
  let verifying = 0
  let pruneAfter = 0
  return {
    session(token: string | undefined) {
      if (!token || !tokenPattern.test(token)) return null
      return db.find(digest(token), Date.now()) ?? null
    },
    end(token: string | undefined) {
      if (token && tokenPattern.test(token)) db.remove(digest(token))
    },
    async login(username: string, password: string, ip: string, previousToken: string | undefined) {
      const now = Date.now()
      if (now >= pruneAfter) {
        for (const [key, value] of attempts) if (now >= value.expires) attempts.delete(key)
        db.expire(now)
        pruneAfter = now + rateWindow
      }
      let record = attempts.get(ip)
      if (!record || now >= record.expires) {
        record = { expires: now + rateWindow, count: 0 }
        attempts.set(ip, record)
      }
      if (record.count >= attemptsAllowed || verifying >= 2) throw new LibraryError(429, '登录尝试过多，请稍后重试。')
      record.count++
      const account = db.account()
      if (!account) throw new LibraryError(503, '尚未初始化管理员，请先在服务主机创建账号。')
      verifying++
      try {
        const valid = await verifyPassword(password, account.username === username ? account.password_hash : undefined)
        const current = db.account()
        if (!valid || current?.username !== account.username || current.password_hash !== account.password_hash) {
          throw new LibraryError(401, '用户名或密码不正确。')
        }
        attempts.delete(ip)
        if (previousToken && tokenPattern.test(previousToken)) db.remove(digest(previousToken))
        const token = randomBytes(32).toString('base64url')
        db.add(digest(token), now + sessionLifetimeSeconds * 1000)
        return { token, maxAge: sessionLifetimeSeconds, username: account.username }
      } finally {
        verifying--
      }
    },
  }
}
