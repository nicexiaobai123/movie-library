import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout } from 'node:timers/promises'

export const project = fileURLToPath(new URL('../../', import.meta.url))
export const sample = fileURLToPath(new URL('../fixtures/seek.mp4', import.meta.url))
export const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jrWQAAAAASUVORK5CYII=', 'base64')

export function within(root, ...parts) {
  const result = resolve(root, ...parts)
  const remainder = relative(root, result)
  assert.ok(remainder && !isAbsolute(remainder) && remainder !== '..' && !remainder.startsWith(`..${sep}`))
  return result
}

export async function waitFor(check, detail, timeout = 12_000) {
  const until = Date.now() + timeout
  do {
    const value = await check()
    if (value) return value
    await setTimeout(50)
  } while (Date.now() < until)
  assert.fail(detail)
}

async function availablePort(host) {
  const server = createServer()
  await new Promise((resolve, reject) => server.listen(0, host, resolve).once('error', reject))
  const port = server.address().port
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return port
}

export async function assertStatus(response, expected) {
  if (response.status !== expected) assert.fail(`${response.url} expected ${expected}, got ${response.status}: ${await response.text()}`)
  return response
}

export async function runtimeFixture(t, options = {}) {
  const temp = resolve(tmpdir())
  const root = await mkdtemp(join(temp, 'night-lib-test-'))
  const media = within(root, 'media')
  const db = within(root, 'library.sqlite')
  await mkdir(media)
  const username = '夜灯管理员'
  const password = randomBytes(24).toString('base64url')
  const host = options.host ?? '127.0.0.1'
  const port = await availablePort(host)
  const base = `http://${host}:${port}`
  const logs = []
  const env = {
    ...process.env,
    NITRO_HOST: host, NITRO_PORT: String(port),
    NUXT_LIBRARY_DB_PATH: db, NUXT_LIBRARY_MEDIA_ROOT: media,
    NUXT_LIBRARY_SCAN_INTERVAL_MS: String(options.interval ?? 0), NUXT_LIBRARY_STABLE_MS: String(options.stable ?? 100),
    NUXT_LIBRARY_MAX_UPLOAD_BYTES: String(options.maxUpload ?? 150 * 1024 ** 2),
    NUXT_LIBRARY_ALLOWED_ORIGINS: base, NUXT_LIBRARY_SECURE_COOKIES: 'false',
  }
  let service
  t.after(async () => {
    if (service && service.exitCode === null && service.signalCode === null) {
      service.kill()
      await new Promise(resolve => service.once('exit', resolve))
    }
    assert.equal(dirname(resolve(root)), temp)
    assert.match(root.slice(temp.length + 1), /^night-lib-test-[a-z0-9]+$/i)
    await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 })
  })
  const admin = spawn(process.execPath, ['scripts/create-admin.mjs', '--username', username, '--password-stdin'], { cwd: project, env, windowsHide: true })
  admin.stdin.end(`${password}\n`)
  let cliOutput = ''
  admin.stdout.on('data', data => { cliOutput += data })
  admin.stderr.on('data', data => { cliOutput += data })
  const adminStatus = await new Promise((resolve, reject) => admin.once('close', resolve).once('error', reject))
  assert.equal(adminStatus, 0, cliOutput)
  service = spawn(process.execPath, ['scripts/start.mjs'], { cwd: project, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  for (const stream of [service.stdout, service.stderr]) stream.on('data', data => logs.push(String(data)))
  await waitFor(async () => {
    assert.equal(service.exitCode, null, logs.join(''))
    if (!logs.join('').includes('Listening')) return false
    try {
      const res = await fetch(`${base}/api/library`)
      if (!res.ok) throw new Error(`Startup API returned ${res.status}: ${await res.text()}`)
      await res.json()
      return true
    } catch (error) {
      if (error instanceof TypeError) return false
      throw error
    }
  }, 'production server did not start')

  let cookie = ''
  function request(path, { auth = false, method = 'GET', json, body, headers = {}, ...init } = {}) {
    if (auth && cookie) headers = { cookie, ...headers }
    if (method !== 'GET' && method !== 'HEAD') headers = { origin: base, ...headers }
    if (json !== undefined) { headers = { 'content-type': 'application/json', ...headers }; body = JSON.stringify(json) }
    return fetch(`${base}${path}`, { method, body, headers, ...init })
  }
  async function login() {
    const res = await assertStatus(await request('/api/admin/login', { method: 'POST', json: { username, password } }), 200)
    assert.equal((await res.json()).username, username)
    const header = res.headers.getSetCookie()[0]
    assert.match(header, /;\s*HttpOnly/i)
    assert.match(header, /;\s*SameSite=Strict/i)
    cookie = header.split(';', 1)[0]
    return cookie
  }
  async function scan() {
    const response = await assertStatus(await request('/api/admin/scan', { auth: true, method: 'POST' }), 202)
    await response.json()
    return waitFor(async () => {
      const res = await assertStatus(await request('/api/admin/scan', { auth: true }), 200)
      const status = await res.json()
      return !status.running && status.last
    }, 'scan did not complete')
  }
  async function stage(relativePath, source = sample) {
    const path = within(media, relativePath)
    await mkdir(dirname(path), { recursive: true })
    await copyFile(source, path)
    return path
  }
  return { root, media, db, base, port, username, password, login, scan, stage, request, logs, cookie: () => cookie }
}

// Visitor accounts live in their own cookie, so tests keep that separately from
// the administrator session above.
export function userApi(fx, credentials) {
  let cookie = ''
  async function call(path, { method = 'GET', json, auth = true } = {}) {
    const headers = {}
    if (auth && cookie) headers.cookie = cookie
    let body
    if (method !== 'GET' && method !== 'HEAD') headers.origin = fx.base
    if (json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(json) }
    const response = await fetch(`${fx.base}${path}`, { method, headers, body })
    const setCookie = response.headers.getSetCookie?.()[0]
    if (setCookie) cookie = setCookie.split(';', 1)[0]
    return response
  }
  async function signIn() {
    const response = await call('/api/user/login', { method: 'POST', json: credentials })
    assertStatus(response, 200)
    return cookie
  }
  async function signInBrowser(context) {
    const [name, value] = cookie.split('=')
    await context.addCookies([{ name, value, url: fx.base, httpOnly: true, sameSite: 'Strict' }])
  }
  return { call, signIn, signInBrowser, cookie: () => cookie }
}

export async function checksum(stream) {
  const hash = createHash('sha256')
  let length = 0
  for await (const chunk of stream) { length += chunk.length; hash.update(chunk) }
  return { length, sha256: hash.digest('hex') }
}

export const checksumFile = path => checksum(createReadStream(path))

export function mediaEdit(fields = {}) {
  return {
    title: '已整理的影片', year: null, description: '', posterPath: null, runtime: null, cast: [],
    kind: 'movie', season: null, episode: null, ...fields,
  }
}
