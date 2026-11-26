import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { parseArgs } from 'node:util'
import { setAdmin } from '../server/db/admin.ts'
import { openDatabase } from '../server/db/database.ts'
import { hashPassword, validUsername } from '../server/domain/password.ts'
import { loadLocalEnvironment } from './env.mjs'

function promptSecret(prompt) {
  if (!process.stdin.isTTY) throw new Error('请在终端中输入密码，或通过 --password-stdin 从受保护的管道读取。')
  process.stdout.write(prompt)
  const muted = new Writable({ write(_chunk, _encoding, callback) { callback() } })
  const terminal = createInterface({ input: process.stdin, output: muted, terminal: true, historySize: 0 })
  return new Promise((resolve, reject) => {
    terminal.once('close', () => reject(new Error('已取消。')))
    terminal.once('SIGINT', () => terminal.close())
    terminal.question('', (answer) => {
      resolve(answer)
      terminal.close()
    })
  }).finally(() => process.stdout.write('\n'))
}

async function passwordFromStdin() {
  const chunks = []
  let length = 0
  for await (const chunk of process.stdin) {
    length += chunk.length
    if (length > 4096) throw new Error('密码输入过长。')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '')
}

try {
  const { values } = parseArgs({ options: { username: { type: 'string' }, 'password-stdin': { type: 'boolean' }, help: { type: 'boolean' } } })
  if (values.help) {
    console.log('pnpm admin:create --username <用户名> [--password-stdin]')
  } else {
    loadLocalEnvironment()
    const username = values.username?.trim()
    if (!username || !validUsername(username)) throw new Error('请指定 1–64 个字母、汉字、数字、点、下划线或连字符的用户名，例如 --username admin。')
    const password = values['password-stdin'] ? await passwordFromStdin() : await promptSecret('管理员密码（至少 6 位，不回显）：')
    if (!values['password-stdin'] && password !== await promptSecret('再次输入管理员密码：')) throw new Error('两次输入不一致，未更改管理员。')
    const hash = await hashPassword(password)
    const db = openDatabase(process.env.NUXT_LIBRARY_DB_PATH || '.data/library.sqlite')
    try { setAdmin(db, username, hash) } finally { db.close() }
    console.log('管理员已创建或重置，旧会话已失效。')
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
