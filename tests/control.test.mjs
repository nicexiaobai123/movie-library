import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFile, cp, mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { project, within } from './helpers/runtime.mjs'

async function unusedPort() {
  const server = createServer()
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  const port = server.address().port
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return port
}

async function launch(file, args, { cwd, env, captureDir }) {
  // Use regular files instead of pipes: the detached server may inherit handles
  // and must not keep a pipe open after the controller has exited.
  const id = randomUUID()
  const outPath = join(captureDir, `${id}.out`)
  const errPath = join(captureDir, `${id}.err`)
  const out = await open(outPath, 'w')
  const err = await open(errPath, 'w')
  let code
  try {
    const child = spawn(file, args, { cwd, env, windowsHide: true, stdio: ['ignore', out.fd, err.fd] })
    code = await new Promise((resolve, reject) => child.once('error', reject).once('close', resolve))
  } finally {
    await out.close()
    await err.close()
  }
  const stdout = await readFile(outPath, 'utf8')
  const stderr = await readFile(errPath, 'utf8')
  return { code, stdout, stderr, text: `${stdout}\n${stderr}` }
}

async function waitUntil(check, message) {
  const deadline = Date.now() + 8000
  do {
    if (await check()) return
    await setTimeout(100)
  } while (Date.now() < deadline)
  assert.fail(message)
}

const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

test('Windows controller safely starts, stops and restarts an isolated project', { timeout: 180_000, skip: process.platform !== 'win32' }, async t => {
  const parent = resolve(tmpdir())
  const scratch = await mkdtemp(join(parent, 'night-control-test-'))
  const root = within(scratch, '测试 & 影院')
  const scripts = within(root, 'scripts')
  const media = within(root, 'media')
  const captureDir = within(scratch, 'captured')
  const control = within(scripts, 'site-control.ps1')
  const state = within(root, '.data', 'site-manager.json')
  const port = await unusedPort()
  const base = `http://127.0.0.1:${port}`
  const env = {
    ...process.env,
    NIGHT_LIBRARY_NODE: process.execPath,
    NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port),
    NITRO_UNIX_SOCKET: '', NITRO_SSL_CERT: '', NITRO_SSL_KEY: '',
    NUXT_LIBRARY_DB_PATH: within(root, '.data', 'library.sqlite'), NUXT_LIBRARY_MEDIA_ROOT: media,
    NUXT_LIBRARY_SCAN_INTERVAL_MS: '0', NUXT_LIBRARY_STABLE_MS: '100',
    NUXT_LIBRARY_ALLOWED_ORIGINS: base,
  }
  let lastRealRecord
  let foreign
  let blocker
  const run = (action, extra = {}) => launch(powershell, [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', control, action, '-NoBrowser',
  ], { cwd: parent, env: { ...env, ...extra }, captureDir })
  const readState = async () => JSON.parse(await readFile(state, 'utf8'))
  t.after(async () => {
    if (blocker?.listening) await new Promise(resolve => blocker.close(resolve))
    if (lastRealRecord) {
      // Restore the test's own record before asking the controller to validate and stop it.
      await writeFile(state, JSON.stringify(lastRealRecord), 'utf8')
    }
    if (await readFile(state).then(() => true, () => false)) await run('stop')
    if (foreign && foreign.exitCode === null) {
      foreign.kill()
      await new Promise(resolve => foreign.once('exit', resolve))
    }
    assert.equal(dirname(resolve(scratch)), parent)
    assert.match(scratch.slice(parent.length + 1), /^night-control-test-[a-z0-9]+$/i)
    await rm(scratch, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 })
  })

  await mkdir(scripts, { recursive: true })
  await mkdir(media)
  await mkdir(captureDir)
  for (const file of ['start.mjs', 'env.mjs', 'site-control.ps1']) await copyFile(within(project, 'scripts', file), within(scripts, file))
  const launcherPath = within(root, '影视库管理.cmd')
  await copyFile(within(project, '影视库管理.cmd'), launcherPath)
  await cp(within(project, '.output'), within(root, '.output'), { recursive: true })
  // These values should lose to the environment supplied to the launcher.
  await writeFile(within(root, '.env'), 'NITRO_HOST=127.0.0.1\nNITRO_PORT=1\n', 'utf8')

  const initially = await run('status')
  assert.equal(initially.code, 0, initially.text)
  // Concurrent clicks must never create two competing instances.
  const [first, overlapping] = await Promise.all([run('start'), run('start')])
  assert.ok(first.code === 0 || overlapping.code === 0, `${first.text}\n${overlapping.text}`)
  lastRealRecord = await readState()
  assert.equal(lastRealRecord.port, port)
  assert.equal(lastRealRecord.url, base)
  assert.equal((await fetch(`${base}/api/library`)).status, 200)
  assert.ok((await readFile(lastRealRecord.stdout, 'utf8')).includes('Listening'))

  const duplicate = await run('start')
  assert.equal(duplicate.code, 0, duplicate.text)
  assert.equal((await readState()).processId, lastRealRecord.processId)
  const status = await run('status')
  assert.equal(status.code, 0, status.text)
  assert.ok(status.text.includes(base), status.text)
  const quotedLauncher = launcherPath.replaceAll("'", "''")
  const launcher = await launch(powershell, ['-NoProfile', '-NonInteractive', '-Command',
    `& '${quotedLauncher}' status -NoBrowser; exit $LASTEXITCODE`], { cwd: parent, env, captureDir })
  assert.equal(launcher.code, 0, launcher.text)
  assert.ok(launcher.text.includes(base), launcher.text)

  const originalId = lastRealRecord.processId
  const restart = await run('restart')
  assert.equal(restart.code, 0, restart.text)
  lastRealRecord = await readState()
  assert.notEqual(lastRealRecord.processId, originalId)
  assert.equal((await fetch(`${base}/api/library`)).status, 200)
  const stop = await run('stop')
  assert.equal(stop.code, 0, stop.text)
  await waitUntil(async () => {
    try { await fetch(`${base}/api/library`, { signal: AbortSignal.timeout(500) }); return false } catch { return true }
  }, 'the stopped service still answers')
  const alreadyStopped = await run('stop')
  assert.equal(alreadyStopped.code, 0, alreadyStopped.text)

  blocker = createServer(socket => socket.end())
  await new Promise((resolve, reject) => blocker.listen(port, '127.0.0.1', resolve).once('error', reject))
  const collision = await run('start')
  assert.notEqual(collision.code, 0, collision.text)
  assert.equal(blocker.listening, true, 'a foreign listener must not be stopped')
  await new Promise(resolve => blocker.close(resolve))

  foreign = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true })
  await new Promise((resolve, reject) => foreign.once('spawn', resolve).once('error', reject))
  const stampResult = await launch(powershell, ['-NoProfile', '-NonInteractive', '-Command',
    `(Get-Process -Id ${foreign.pid}).StartTime.ToUniversalTime().ToFileTimeUtc().ToString()`], { cwd: parent, env, captureDir })
  assert.equal(stampResult.code, 0, stampResult.text)
  const forged = { ...lastRealRecord, processId: foreign.pid, created: stampResult.stdout.trim(), executable: process.execPath }
  await writeFile(state, JSON.stringify(forged), 'utf8')
  const unsafeStop = await run('stop')
  assert.notEqual(unsafeStop.code, 0, unsafeStop.text)
  assert.equal(foreign.exitCode, null, 'an unrelated process must not be stopped')

  await writeFile(state, '{not valid json', 'utf8')
  const corrupt = await run('stop')
  assert.notEqual(corrupt.code, 0, corrupt.text)
  assert.equal(foreign.exitCode, null)
  await writeFile(state, JSON.stringify(lastRealRecord), 'utf8')
  const wildcard = await run('start', { NITRO_HOST: '0.0.0.0' })
  assert.notEqual(wildcard.code, 0, wildcard.text)
  const tls = await run('start', { NITRO_SSL_CERT: 'unexpected-test-value' })
  assert.notEqual(tls.code, 0, tls.text)
})
