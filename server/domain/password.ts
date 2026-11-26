import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

// 局域网小站按实际使用习惯放宽到 6 位，其余哈希参数保持不变。
export const minPasswordLength = 6
export const maxPasswordLength = 256

const hashOptions = { N: 2 ** 15, r: 8, p: 3, maxmem: 64 * 1024 ** 2 }
const hashPrefix = 'scrypt$32768$8$3'
const dummy = `${hashPrefix}$00000000000000000000000000000000$${'0'.repeat(128)}`

function key(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, hashOptions, (error, derivedKey) => {
      if (error) reject(error)
      else resolve(derivedKey)
    })
  })
}

export function validUsername(value: string): boolean {
  return /^[\p{L}\p{N}_.-]{1,64}$/u.test(value)
}

export function validPassword(value: string): boolean {
  return value.length >= minPasswordLength && value.length <= maxPasswordLength
}

export async function hashPassword(password: string): Promise<string> {
  if (!validPassword(password)) {
    throw new Error(`密码须为 ${minPasswordLength}–${maxPasswordLength} 个字符。`)
  }
  const salt = randomBytes(16)
  return `${hashPrefix}$${salt.toString('hex')}$${(await key(password, salt)).toString('hex')}`
}

export async function verifyPassword(password: string, stored?: string): Promise<boolean> {
  const valid = stored?.match(/^scrypt\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{128})$/)
  const [, , , , salt, expected] = (valid ? stored! : dummy).split('$') as [string, string, string, string, string, string]
  const derived = await key(password, Buffer.from(salt, 'hex'))
  const equal = timingSafeEqual(derived, Buffer.from(expected, 'hex'))
  return Boolean(valid && equal)
}
