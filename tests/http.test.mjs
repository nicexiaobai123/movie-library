import assert from 'node:assert/strict'
import { access, copyFile, mkdir, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import {
  assertStatus, checksum, checksumFile, mediaEdit, runtimeFixture, sample, tinyPng, userApi, waitFor, within,
} from './helpers/runtime.mjs'

const fixture = await readFile(sample)
const queryName = (endpoint, name) => `/api/admin/${endpoint}?name=${encodeURIComponent(name)}`
const bytes = res => res.arrayBuffer().then(body => Buffer.from(body))

function operations(fx) {
  return {
    async catalog(q = '') { return (await (await assertStatus(await fx.request(`/api/library${q}`), 200)).json()).items },
    async admin() { return (await assertStatus(await fx.request('/api/admin/library', { auth: true }), 200)).json() },
    async title(id) { return (await assertStatus(await fx.request(`/api/library/${id}`), 200)).json() },
    async upload(name, expected = 201, body = fixture, init = {}) {
      return assertStatus(await fx.request(queryName('upload', name), {
        auth: true, method: 'POST', body, headers: { 'content-type': 'application/octet-stream' }, ...init,
      }), expected)
    },
    async edit(id, input, expected = 200) {
      return assertStatus(await fx.request(`/api/admin/media/${id}`, { auth: true, method: 'PATCH', json: input }), expected)
    },
  }
}

test('authentication, upload, streaming, Range and Chinese filenames', { timeout: 90_000 }, async t => {
  const fx = await runtimeFixture(t)
  const op = operations(fx)
  assert.deepEqual(await op.catalog(), [])

  // Admin access is separate from visitors and needs a real session.
  const anonymous = await assertStatus(await fx.request('/api/admin/library'), 401)
  assert.match((await anonymous.json()).data.message, /登录/)
  const adminHtml = await assertStatus(await fx.request('/admin', { redirect: 'manual' }), 302)
  assert.equal(adminHtml.headers.get('location'), '/admin/login')
  const loginRequest = { method: 'POST', json: { username: fx.username, password: fx.password } }
  await assertStatus(await fx.request('/api/admin/login', { ...loginRequest, headers: { origin: 'http://untrusted.invalid' } }), 403)
  await assertStatus(await fx.request('/api/admin/login', { ...loginRequest, json: { username: fx.username, password: 'wrong' } }), 401)
  await fx.login()
  assert.equal((await (await assertStatus(await fx.request('/api/admin/session', { auth: true }), 200)).json()).username, fx.username)
  await assertStatus(await fx.request('/api/admin/scan', { auth: true, method: 'POST', headers: { origin: 'http://untrusted.invalid' } }), 403)

  // An upload lands in the media folder and is indexed by its filename.
  const filename = '远山来信 (2024).mp4'
  const { item } = await (await op.upload(filename)).json()
  assert.equal(item.fileName, filename)
  assert.equal(item.kind, 'movie')
  assert.equal(item.title, '远山来信')
  await op.upload(filename, 409)
  await op.upload('../越界.mp4', 400)
  await op.upload('无效容器.mp4', 422, Buffer.alloc(64))

  const [card] = await op.catalog('?q=%E8%BF%9C%E5%B1%B1&kind=movie')
  assert.equal(card.title, '远山来信')
  assert.equal(card.year, 2024)
  // A card carries only what the tiles render.
  assert.deepEqual(Object.keys(card).sort(),
    ['addedAt', 'cast', 'id', 'kind', 'posterUrl', 'runtime', 'title', 'year'])
  const detail = await op.title(card.id)
  assert.equal(detail.movie.id, item.id)

  // The video streams with Range support and a stable validator.
  const bodyURL = `/api/media/${item.id}`
  const full = await assertStatus(await fx.request(bodyURL), 200)
  assert.equal(full.headers.get('accept-ranges'), 'bytes')
  assert.equal(full.headers.get('content-type'), 'video/mp4')
  assert.equal(Number(full.headers.get('content-length')), fixture.length)
  const etag = full.headers.get('etag')
  assert.deepEqual(await bytes(full), fixture)

  const head = await assertStatus(await fx.request(bodyURL, { method: 'HEAD' }), 200)
  assert.equal(Number(head.headers.get('content-length')), fixture.length)
  assert.equal((await bytes(head)).length, 0)
  const bounded = await assertStatus(await fx.request(bodyURL, { headers: { range: 'bytes=123-456', 'if-range': etag } }), 206)
  assert.equal(bounded.headers.get('content-range'), `bytes 123-456/${fixture.length}`)
  assert.deepEqual(await bytes(bounded), fixture.subarray(123, 457))
  const suffix = await assertStatus(await fx.request(bodyURL, { headers: { range: 'bytes=-64' } }), 206)
  assert.deepEqual(await bytes(suffix), fixture.subarray(-64))
  for (const range of [`bytes=${fixture.length}-`, 'bytes=3-0', 'bytes=0-12,31-41']) {
    const bad = await assertStatus(await fx.request(bodyURL, { headers: { range } }), 416)
    assert.equal(bad.headers.get('content-range'), `bytes */${fixture.length}`)
    assert.equal((await bytes(bad)).length, 0)
  }
  // A download is the same bytes with an attachment disposition.
  const download = await assertStatus(await fx.request(`/api/media/${item.id}/download`), 200)
  assert.match(download.headers.get('content-disposition') ?? '', /^attachment/)
  assert.deepEqual(await bytes(download), fixture)

  // Editing rewrites the title, never the file.
  const edited = await op.edit(item.id, mediaEdit({
    title: '远山来信（校订）', year: 2024, description: '一封寄往山里的信。', cast: ['演员甲', '演员乙'],
  }))
  const updated = (await edited.json()).item
  assert.equal(updated.title, '远山来信（校订）')
  const reread = await op.title(card.id)
  assert.equal(reread.description, '一封寄往山里的信。')
  assert.deepEqual(reread.cast, ['演员甲', '演员乙'])
  // The bytes on disk are untouched by the edit.
  const stored = await readFile(within(fx.media, '上传', filename))
  assert.equal(stored.length, fixture.length)
})

test('scanning indexes films and groups episodes into one series in order', { timeout: 90_000 }, async t => {
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  const op = operations(fx)
  await fx.login()

  // The naming people actually use, including the star-title convention.
  await fx.stage('七海蒂娜-ADN-619 一個在已故丈夫面前尿尿的女人.mp4')
  await fx.stage('散装电影 (2021).mp4')
  for (const number of [3, 1, 10, 2]) {
    await fx.stage(`漫剧/淫妻派对 第${number}集.mp4`)
  }

  const first = await fx.scan()
  assert.equal(first.state, 'success')
  assert.equal(first.discovered, 6)
  assert.equal(first.indexed, 6)

  const admin = await op.admin()
  assert.equal(admin.items.length, 6)
  // Everything is published immediately: there is no pending state.
  assert.ok(admin.items.every(item => item.titleId))

  const actors = (await (await fx.request('/api/library/actors')).json()).items
  assert.ok(actors.some(actor => actor.name === '七海蒂娜'), 'the star prefix becomes cast')

  // The ten episodes collapse into one series whose episodes are ordered.
  const series = admin.titles.find(title => title.kind === 'series')
  assert.equal(series.title, '淫妻派对')
  const detail = await op.title(series.id)
  assert.deepEqual(detail.episodes.map(episode => episode.episode), [1, 2, 3, 10])
  assert.equal(detail.episodes[0].media.available, true)

  // Scanning again changes nothing.
  const again = await fx.scan()
  assert.equal(again.indexed, 0)
  assert.equal((await op.admin()).items.length, 6)
})

test('deleting a file from the folder removes it from the library on the next scan', { timeout: 90_000 }, async t => {
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  const op = operations(fx)
  await fx.login()
  await fx.stage('会消失的电影 (2022).mp4')
  await fx.stage('留存的作品 (2020).mp4')
  await fx.scan()
  assert.equal((await op.admin()).items.length, 2)
  const [card] = await op.catalog('?q=%E4%BC%9A%E6%B6%88%E5%A4%B1')
  assert.equal(card.title, '会消失的电影')

  // Removing the bytes is the delete action; the scan is the only bookkeeping.
  const { rm } = await import('node:fs/promises')
  await rm(within(fx.media, '会消失的电影 (2022).mp4'))
  const result = await fx.scan()
  assert.equal(result.removed, 1)
  const left = await op.admin()
  assert.equal(left.items.length, 1)
  assert.equal(left.items[0].title, '留存的作品')
  // The title that lost its only file is gone with it.
  assert.equal((await fx.request(`/api/library/${card.id}`)).status, 404)
})

test('an unreadable media root keeps the library and reports the failure', { timeout: 60_000 }, async t => {
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  const op = operations(fx)
  await fx.login()
  await fx.stage('离线前的作品.mp4')
  await fx.scan()
  const [card] = await op.catalog()

  const moved = within(fx.root, 'off-line-root')
  await rename(fx.media, moved)
  const offline = await fx.scan()
  assert.equal(offline.state, 'failed')
  assert.match(offline.message, /媒体目录|共享/)
  // The catalog is untouched while the folder cannot be read.
  assert.equal((await op.catalog()).length, 1)
  await rename(moved, fx.media)
  assert.equal((await fx.scan()).state, 'success')
  assert.equal((await op.title(card.id)).title, '离线前的作品')
})

test('visitors register, favourite a film and never reach the admin API', { timeout: 60_000 }, async t => {
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  await fx.login()
  await fx.stage('收藏目标 (2023).mp4')
  await fx.scan()
  const items = (await (await fx.request('/api/admin/library', { auth: true })).json()).items
  const target = items[0]

  const visitor = userApi(fx, { username: '影迷', password: '123456' })
  await assertStatus(await visitor.call('/api/user/register', { method: 'POST', json: { username: '影迷', password: '123456' } }), 200)
  await visitor.signIn()
  assert.deepEqual(await (await visitor.call('/api/user/session')).json(), { username: '影迷' })

  await assertStatus(await visitor.call(`/api/user/favorites/${target.titleId}`, { method: 'PUT' }), 200)
  const favorites = await (await visitor.call('/api/user/favorites')).json()
  assert.equal(favorites.items.length, 1)
  assert.equal(favorites.items[0].title, '收藏目标')

  // A favourite disappears while its title has no file, because the catalog only
  // shows titles that still exist. Re-indexing creates a fresh title, so the old
  // favourite stays attached to the row that was removed.
  const { rm } = await import('node:fs/promises')
  const relative = items[0].relativePath
  await rm(within(fx.media, relative))
  await fx.scan()
  assert.deepEqual((await (await visitor.call('/api/user/favorites')).json()).items, [])
  await fx.stage(relative)
  await fx.scan()
  const back = (await (await fx.request('/api/admin/library', { auth: true })).json()).items
  assert.equal(back.length, 1, 'the file is in the library again')
  // The new title can be favourited again, which is the user-visible recovery.
  await assertStatus(await visitor.call(`/api/user/favorites/${back[0].titleId}`, { method: 'PUT' }), 200)
  assert.equal((await (await visitor.call('/api/user/favorites')).json()).items.length, 1)

  assertStatus(await fx.request('/api/admin/library'), 401)
  await assertStatus(await visitor.call('/api/admin/library'), 401)
})

test('uploads survive a broken connection and staging is cleaned up', { timeout: 120_000 }, async t => {
  const fx = await runtimeFixture(t)
  await fx.login()
  const staging = within(fx.media, '.night-library-staging')
  // A truncated body never becomes a library entry...
  const response = await fx.request(queryName('upload', '半截.mp4'), {
    auth: true, method: 'POST', body: fixture.subarray(0, 1024),
    headers: { 'content-type': 'application/octet-stream', 'content-length': String(fixture.length) },
  }).catch(() => null)
  assert.ok(response === null || response.status >= 400)
  // ...and nothing is left behind once the sweep runs.
  await fx.scan()
  await delay(100)
  const left = await readdir(staging).catch(() => [])
  assert.deepEqual(left, [])
  const admin = await (await fx.request('/api/admin/library', { auth: true })).json()
  assert.equal(admin.items.length, 0)
})

test('a periodic interval keeps the library in sync on its own', { timeout: 60_000 }, async t => {
  const fx = await runtimeFixture(t, { interval: 250, stable: 100 })
  const op = operations(fx)
  await fx.login()
  await fx.stage('定时发现 (2021).mp4')
  const title = await waitFor(async () => (await op.catalog())[0], 'periodic scanner did not find the film')
  assert.equal(title.title, '定时发现')
})

test('posters are served as images and reject non-images', { timeout: 60_000 }, async t => {
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  const op = operations(fx)
  await fx.login()
  await fx.stage('有封面的作品 (2020).mp4')
  await fx.scan()
  const [item] = (await op.admin()).items

  const poster = await assertStatus(await fx.request(queryName('posters', 'cover.png'), {
    auth: true, method: 'POST', body: tinyPng, headers: { 'content-type': 'image/png' },
  }), 201)
  const { path } = await poster.json()
  assert.match(path, /^_海报\//)

  await op.edit(item.id, mediaEdit({ title: item.title, posterPath: path, kind: 'movie' }))
  const served = await assertStatus(await fx.request(`/api/posters/${item.titleId}`), 200)
  assert.match(served.headers.get('content-type') ?? '', /^image\//)
  assert.deepEqual(await bytes(served), tinyPng)
  // A604: an invalid image is refused rather than stored.
  await assertStatus(await fx.request(queryName('posters', 'bad.png'), {
    auth: true, method: 'POST', body: Buffer.from('not an image'), headers: { 'content-type': 'image/png' },
  }), 422)
})

test('LAN binding only accepts a private address', {
  timeout: 30_000, skip: !process.env.TEST_LAN_HOST,
}, async t => {
  const fx = await runtimeFixture(t, { host: process.env.TEST_LAN_HOST })
  assert.deepEqual(operations(fx).catalog ? [] : [], [])
  await assert.rejects(fetch(`http://127.0.0.1:${fx.port}/api/library`, { signal: AbortSignal.timeout(2000) }), { name: 'TypeError' })
})
