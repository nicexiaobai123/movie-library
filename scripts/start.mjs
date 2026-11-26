import { isIPv4 } from 'node:net'
import { loadLocalEnvironment } from './env.mjs'

loadLocalEnvironment()
const host = process.env.NITRO_HOST || '127.0.0.1'
const [, b] = host.split('.').map(Number)
const privateAddress = /^(?:10\.|192\.168\.)/.test(host) || (host.startsWith('172.') && b >= 16 && b <= 31)
if (!isIPv4(host) || (!privateAddress && host !== '127.0.0.1')) {
  console.error('NITRO_HOST 请使用 127.0.0.1 或本机的私有局域网 IPv4（不要使用 0.0.0.0、公网地址或隧道）。')
  process.exit(1)
}
const port = Number(process.env.NITRO_PORT || 3000)
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
  console.error('NITRO_PORT 须为 1–65535 的有效端口。')
  process.exit(1)
}
process.env.NITRO_HOST = host
process.env.NITRO_PORT = String(port)
process.env.NODE_ENV = 'production'
try {
  await import('../.output/server/index.mjs')
} catch (error) {
  if (error.code === 'ERR_MODULE_NOT_FOUND') console.error('未找到构建产物：请先运行 pnpm build。')
  else console.error('启动出错：', error.message)
  process.exitCode = 1
}
