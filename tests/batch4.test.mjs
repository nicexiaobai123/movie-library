// Batch 4: poster revalidation, password change revoking sessions, backup script.
import assert from 'node:assert/strict'
import { mkdir, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { runtimeFixture, tinyPng } from './helpers/runtime.mjs'

test('posters revalidate, passwords change, and the backup script runs', { timeout: 120_000 }, async (t) => {
  const fx = await runtimeFixture(t)
  const report = []
  await fx.login()

  // Upload a film and give it a real poster so the endpoint has something to serve.
  const uploaded = await (await fx.request(`/api/admin/upload?name=${encodeURIComponent('缓存测试 (2024).mp4')}`, {
    auth: true, method: 'POST', body: await import('node:fs/promises').then(fs => fs.readFile(new URL('./fixtures/seek.mp4', import.meta.url))),
    headers: { 'content-type': 'application/octet-stream' },
  })).json()
  await fx.scan()
  const poster = await fx.request('/api/admin/posters?name=cover.png', {
    auth: true, method: 'POST', body: tinyPng, headers: { 'content-type': 'image/png' },
  })
  assert.equal(poster.status, 201)
  const posterPath = (await poster.json()).path

  const detail = await fx.request(`/api/library/${uploaded.item.titleId}`)
  const detailBody = await detail.json()
  await fx.request(`/api/admin/media/${uploaded.item.id}`, {
    auth: true, method: 'PATCH',
    json: {
      titleId: uploaded.item.titleId, kind: 'movie', title: '缓存测试', originalTitle: null, year: 2024,
      description: '', genres: [], region: null, rating: null, runtime: null, director: null, cast: [],
      posterPath, backdropPath: null, season: null, episode: null, episodeTitle: null,
    },
  })
  void detailBody

  // First response carries a validator; the next request with it gets a 304.
  const first = await fx.request(`/api/posters/${uploaded.item.titleId}`)
  assert.equal(first.status, 200)
  const etag = first.headers.get('etag')
  report.push(`poster etag: ${etag}`)
  assert.ok(etag, 'posters must expose an ETag')
  await first.body?.cancel()

  const cached = await fx.request(`/api/posters/${uploaded.item.titleId}`, { headers: { 'if-none-match': etag } })
  report.push(`revalidation status: ${cached.status}`)
  assert.equal(cached.status, 304)
  await cached.body?.cancel()

  // A password change must end every existing session.
  const user = { username: '改密用户', password: '123456' }
  const register = await fx.request('/api/user/register', {
    method: 'POST', json: user, headers: {},
  })
  assert.equal(register.status, 200)
  const userCookie = register.headers.getSetCookie()[0].split(';', 1)[0]
  const sessionBefore = await fx.request('/api/user/session', { headers: { cookie: userCookie } })
  assert.equal((await sessionBefore.json()).username, user.username)

  const wrong = await fx.request('/api/user/password', {
    method: 'PUT', json: { currentPassword: 'nope', newPassword: 'abcdef' }, headers: { cookie: userCookie },
  })
  report.push(`wrong current password: ${wrong.status}`)
  assert.equal(wrong.status, 403)
  await wrong.text()

  const changed = await fx.request('/api/user/password', {
    method: 'PUT', json: { currentPassword: '123456', newPassword: 'abcdef' }, headers: { cookie: userCookie },
  })
  report.push(`password change: ${changed.status}`)
  assert.equal(changed.status, 200)
  await changed.text()

  const afterChange = await fx.request('/api/user/session', { headers: { cookie: userCookie } })
  report.push(`old session after change: ${JSON.stringify(await afterChange.json())}`)
  assert.equal((await fx.request('/api/user/session', { headers: { cookie: userCookie } }).then(r => r.json())).username, null)

  const oldLogin = await fx.request('/api/user/login', { method: 'POST', json: user })
  assert.equal(oldLogin.status, 401)
  await oldLogin.text()
  const newLogin = await fx.request('/api/user/login', { method: 'POST', json: { ...user, password: 'abcdef' } })
  report.push(`login with new password: ${newLogin.status}`)
  assert.equal(newLogin.status, 200)
  await newLogin.text()

  // The backup script produces a readable copy of the database.
  const backupDir = resolve('.test-artifacts', 'backup-check')
  await mkdir(backupDir, { recursive: true })
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  const child = await run(process.execPath, ['scripts/backup.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, NUXT_LIBRARY_DB_PATH: fx.db, NUXT_LIBRARY_MEDIA_ROOT: fx.media, NUXT_LIBRARY_BACKUP_DIR: backupDir },
  })
  report.push(child.stdout.trim().split('\n')[0])
  const backups = (await readdir(backupDir)).filter(name => name.endsWith('.sqlite'))
  report.push(`backups written: ${backups.length}`)
  assert.ok(backups.length >= 1)
  console.log(report.join('\n'))
})
