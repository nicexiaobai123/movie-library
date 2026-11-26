import assert from 'node:assert/strict'
import { createReadStream } from 'node:fs'
import { access, mkdir, readFile, readdir, rename, stat, symlink, truncate, writeFile, copyFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { assertStatus, checksum, checksumFile, mediaEdit, runtimeFixture, sample, tinyPng, userApi, waitFor, within } from './helpers/runtime.mjs'

const fixture = await readFile(sample)
const stageDir = '.night-library-staging'
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

test('production HTTP: authentication, upload/edit, streaming, Chinese filenames and Range', { timeout: 90_000 }, async t => {
  const fx = await runtimeFixture(t)
  const op = operations(fx)
  assert.deepEqual(await op.catalog(), [])
  const anonymous = await assertStatus(await fx.request('/api/admin/library'), 401)
  assert.match((await anonymous.json()).data.message, /登录/)
  const adminHtml = await assertStatus(await fx.request('/admin', { redirect: 'manual' }), 302)
  assert.equal(adminHtml.headers.get('location'), '/admin/login')
  assert.equal((await fx.request('/admin/login')).status, 200)
  const loginRequest = { method: 'POST', json: { username: fx.username, password: fx.password } }
  await assertStatus(await fx.request('/api/admin/login', { ...loginRequest, headers: { origin: 'http://untrusted.invalid' } }), 403)
  await assertStatus(await fx.request('/api/admin/login', { ...loginRequest, json: { username: fx.username, password: 'wrong' } }), 401)
  await fx.login()
  assert.equal((await (await assertStatus(await fx.request('/api/admin/session', { auth: true }), 200)).json()).username, fx.username)
  const admin = await assertStatus(await fx.request('/admin', { auth: true, redirect: 'manual' }), 200)
  assert.match(admin.headers.get('cache-control'), /no-store/)
  await admin.text()
  await assertStatus(await fx.request('/api/admin/scan', { auth: true, method: 'POST', headers: { origin: 'http://untrusted.invalid' } }), 403)
  await assertStatus(await fetch(`${fx.base}/api/admin/scan`, { method: 'POST', headers: { cookie: fx.cookie() } }), 403)

  const filename = '远山来信 (2024).mp4'
  const { item } = await (await op.upload(filename)).json()
  assert.equal(item.state, 'published')
  assert.equal(item.fileName, filename)
  await op.upload(filename, 409)
  await op.upload('../越界.mp4', 400)
  await op.upload('无效容器.mp4', 422, Buffer.alloc(64))
  assert.equal((await op.admin()).items.length, 1)
  const [card] = await op.catalog('?q=%E8%BF%9C%E5%B1%B1&kind=movie')
  assert.equal(card.title, '远山来信')
  assert.equal(card.year, 2024)
  assert.deepEqual(Object.keys(card).sort(),
    ['addedAt', 'available', 'backdropUrl', 'genres', 'id', 'kind', 'originalTitle', 'posterUrl', 'rating', 'title', 'year'])
  const detail = await op.title(card.id)
  assert.equal(detail.movie.id, item.id)
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
  const open = await assertStatus(await fx.request(bodyURL, { method: 'HEAD', headers: { range: 'bytes=123-' } }), 206)
  assert.equal(open.headers.get('content-range'), `bytes 123-${fixture.length - 1}/${fixture.length}`)
  assert.equal(Number(open.headers.get('content-length')), fixture.length - 123)
  for (const range of [`bytes=${fixture.length}-`, 'bytes=3-0', 'bytes=0-12,31-41']) {
    const bad = await assertStatus(await fx.request(bodyURL, { headers: { range } }), 416)
    assert.equal(bad.headers.get('content-range'), `bytes */${fixture.length}`)
    assert.equal((await bytes(bad)).length, 0)
  }
  const staleValidator = await assertStatus(await fx.request(bodyURL, { headers: { range: 'bytes=0-5', 'if-range': '"stale"' } }), 200)
  await staleValidator.body.cancel()
  const download = await assertStatus(await fx.request(`${bodyURL}/download`), 200)
  const header = download.headers.get('content-disposition')
  assert.match(header, /^attachment;/)
  assert.equal(decodeURIComponent(header.split("UTF-8''")[1]), filename)
  assert.deepEqual(await bytes(download), fixture)

  await op.edit(item.id, mediaEdit({ titleId: card.id, title: '未授权海报', posterPath: '../秘密.png' }), 422)
  const image = await assertStatus(await fx.request(queryName('posters', '海报.png'), {
    auth: true, method: 'POST', body: tinyPng, headers: { 'content-type': 'image/png' },
  }), 201)
  const { path } = await image.json()
  await op.edit(item.id, mediaEdit({ titleId: card.id, title: '编辑后的手工片名', description: '这段简介应当被保留。', year: 2025, posterPath: path }))
  const updated = await op.title(card.id)
  assert.equal(updated.description, '这段简介应当被保留。')
  assert.equal(updated.title, '编辑后的手工片名')
  assert.ok(updated.posterUrl.startsWith('/api/posters/'))
  assert.notEqual(updated.posterUrl, path)
  const poster = await assertStatus(await fx.request(updated.posterUrl), 200)
  assert.equal(poster.headers.get('content-type'), 'image/png')
  assert.deepEqual(await bytes(poster), tinyPng)
  await fx.scan()
  assert.equal((await op.title(card.id)).title, '编辑后的手工片名')
  assert.equal((await op.admin()).items.length, 1)
  await assertStatus(await fx.request('/api/media/%2e%2e%2fsecret'), 404)
  await assertStatus(await fx.request('/api/admin/logout', { auth: true, method: 'POST' }), 200)
  await assertStatus(await fx.request('/api/admin/library', { auth: true }), 401)
})

test('copy scanning: stability, ambiguity, conflicts, repeat runs, offline root and junctions', { timeout: 90_000 }, async t => {
  const fx = await runtimeFixture(t, { stable: 150 })
  const op = operations(fx)
  await fx.login()
  const moving = within(fx.media, '正在复制的电影 (2025).mp4')
  await writeFile(moving, fixture.subarray(0, 128 * 1024))
  await fx.stage('电影/旧胶片 (2023).mp4')
  await fx.stage('电视剧/窗边日记/第二季/第02集.mp4')
  await fx.stage('电视剧/窗边日记/第二季/第01集.mp4')
  await fx.stage('夹层 第01-02集.mp4')
  await fx.stage('相册.S01E05.mp4')
  await fx.stage('相册 第05集.mp4')
  await fx.stage('临时文件.part.mp4')
  await fx.stage('.hidden/不应展示.mp4')
  const initial = await fx.scan()
  assert.equal(initial.state, 'success')
  assert.equal(initial.discovered, 7)
  assert.equal(initial.unstable, 7)
  assert.deepEqual(await op.catalog(), [])
  await delay(180)
  const indexed = await fx.scan()
  assert.equal(indexed.published, 3)
  assert.equal(indexed.pending, 4)
  const settled = await op.catalog()
  assert.equal(settled.length, 2)
  const series = settled.find(item => item.kind === 'series')
  const previous = await op.title(series.id)
  assert.deepEqual(previous.episodes.map(episode => [episode.season, episode.episode]), [[2, 1], [2, 2]])
  const items = (await op.admin()).items
  const partial = items.find(item => item.fileName.startsWith('正在复制'))
  assert.equal(partial.available, false)
  await writeFile(moving, fixture)
  await fx.scan()
  assert.equal((await op.catalog()).length, 2)
  await delay(180)
  await fx.scan()
  const recovered = (await op.admin()).items.find(item => item.id === partial.id)
  assert.equal(recovered.state, 'published')
  assert.equal(recovered.available, true)

  const ambiguous = items.find(item => item.fileName.includes('夹层'))
  assert.match(ambiguous.reason, /多个集号|集号范围/)
  const conflict = items.filter(item => item.fileName.startsWith('相册'))
  assert.equal(conflict.length, 2)
  assert.ok(conflict.every(item => item.state === 'pending' && item.reason.includes('多份文件')))
  await op.edit(ambiguous.id, mediaEdit({ kind: 'series', title: '窗边日记 · 校订', titleId: series.id,
    season: 2, episode: 3, episodeTitle: '夹层', description: '人工整理。' }))
  const moved = await op.title(series.id)
  assert.equal(moved.description, '人工整理。')
  assert.deepEqual(moved.episodes.map(ep => ep.episode), [1, 2, 3])
  const position = mediaEdit({ kind: 'series', title: moved.title, titleId: series.id, season: 2, episode: 2 })
  const occupied = await op.edit(conflict[0].id, position, 409)
  assert.equal((await occupied.json()).data.code, 'SLOT_OCCUPIED')
  await op.edit(conflict[0].id, { ...position, description: '人工整理。', replaceExisting: true })
  assert.equal((await op.title(series.id)).episodes[1].media.id, conflict[0].id)
  await assertStatus(await fx.request(`/api/media/${previous.episodes[1].media.id}`), 404)
  const again = await fx.scan()
  assert.equal(again.indexed, 0)
  assert.equal((await op.admin()).items.length, 7)

  const unavailableRoot = within(fx.root, 'off-line-root')
  await rename(fx.media, unavailableRoot)
  const offline = await fx.scan()
  assert.equal(offline.state, 'failed')
  assert.match(offline.message, /媒体目录|共享/)
  assert.equal((await op.title(series.id)).available, true)
  await assertStatus(await fx.request(`/api/media/${conflict[0].id}`), 503)
  await rename(unavailableRoot, fx.media)

  const protectedDir = within(fx.root, 'no-upload-here')
  await mkdir(protectedDir)
  await symlink(protectedDir, within(fx.media, '上传'), process.platform === 'win32' ? 'junction' : 'dir')
  await op.upload('不可写入目录联接.mp4', 503)
  assert.deepEqual(await readdir(protectedDir), [])

  const film = settled.find(item => item.kind === 'movie')
  const video = (await op.title(film.id)).movie
  const oldFolder = within(fx.media, '电影')
  const outer = within(fx.root, 'outside')
  await rename(oldFolder, outer)
  await symlink(outer, oldFolder, process.platform === 'win32' ? 'junction' : 'dir')
  const escaped = await assertStatus(await fx.request(`/api/media/${video.id}`), 404)
  const response = await escaped.text()
  assert.ok(!response.includes(fx.root.replaceAll('\\', '\\\\')))
  const marked = await fx.scan()
  assert.equal(marked.state, 'success')
  assert.equal(marked.missing, 1)
  const missing = await op.title(film.id)
  assert.equal(missing.title, film.title)
  assert.equal(missing.movie.available, false)
  assert.equal(missing.movie.id, video.id)
})

test('disk staging is streamed, disconnected uploads are cleaned, 96 MiB round-trip matches bytes', { timeout: 120_000 }, async t => {
  const fx = await runtimeFixture(t)
  const op = operations(fx)
  await fx.login()
  const interruptedName = '中断的上传.mp4'
  const staging = within(fx.media, stageDir)
  const partial = httpRequest(`${fx.base}${queryName('upload', interruptedName)}`, {
    method: 'POST', headers: { cookie: fx.cookie(), origin: fx.base, 'content-length': fixture.length, 'content-type': 'video/mp4' },
  })
  t.after(() => partial.destroy())
  partial.on('error', () => {})
  partial.write(fixture.subarray(0, 128 * 1024))
  await waitFor(async () => {
    const names = await readdir(staging).catch(() => [])
    const size = names.length ? (await stat(within(staging, names[0])).catch(() => ({ size: 0 }))).size : 0
    return size >= 128 * 1024
  }, 'partial upload bytes were not streamed to disk')
  assert.equal((await fx.scan()).discovered, 0)
  assert.deepEqual(await op.catalog(), [])
  partial.destroy()
  await waitFor(async () => (await readdir(staging)).length === 0, 'interrupted temporary upload was not removed')
  await assert.rejects(access(within(fx.media, '上传', interruptedName)), { code: 'ENOENT' })

  const big = within(fx.root, 'large.mp4')
  const size = 96 * 1024 ** 2
  await copyFile(sample, big)
  await truncate(big, size)
  const normal = await op.upload('大文件流式传输.mp4', 201, createReadStream(big), {
    duplex: 'half', headers: { 'content-length': String(size), 'content-type': 'application/octet-stream' },
  })
  const { item } = await normal.json()
  assert.equal(item.size, size)
  const downloaded = await assertStatus(await fx.request(`/api/media/${item.id}/download`), 200)
  assert.equal(Number(downloaded.headers.get('content-length')), size)
  assert.deepEqual(await checksum(downloaded.body), await checksumFile(big))
  assert.deepEqual(await readdir(staging), [])
  const tooBig = 151 * 1024 ** 2
  const excess = await new Promise((resolve, reject) => {
    const req = httpRequest(`${fx.base}${queryName('upload', '超过上限.mp4')}`, {
      method: 'POST', headers: { cookie: fx.cookie(), origin: fx.base, 'content-length': tooBig, 'content-type': 'video/mp4', connection: 'close' },
    }, resolve).once('error', reject)
    req.end()
  })
  assert.equal(excess.statusCode, 413)
  excess.resume()
})

test('bulk publishing and default description: partial success, conflicts, and scan defaults', { timeout: 60_000 }, async t => {
  const fx = await runtimeFixture(t, { stable: 100 })
  const op = operations(fx)
  await fx.login()
  const missingAuth = await fx.request('/api/admin/media/bulk', { method: 'POST', json: { items: [] }, headers: { origin: fx.base } })
  assert.equal(missingAuth.status, 401)
  await missingAuth.text()
  const noItems = await fx.request('/api/admin/media/bulk', { auth: true, method: 'POST', json: { items: [] } })
  assert.equal(noItems.status, 422)
  await noItems.text()

  const admin = await op.admin()
  assert.deepEqual(admin.settings, { defaultDescription: '' })
  const saved = await assertStatus(await fx.request('/api/admin/settings', {
    auth: true, method: 'PUT', json: { defaultDescription: '这是默认简介。' },
  }), 200)
  assert.equal((await saved.json()).defaultDescription, '这是默认简介。')

  await fx.stage('01.mp4')
  await fx.stage('02.mp4')
  await fx.stage('夹层 第01-02集.mp4')
  await fx.stage('批量电影扫入 (2022).mp4')
  await fx.scan()
  await delay(150)
  await fx.scan()
  const pending = (await op.admin()).items.filter(item => item.state === 'pending')
  const a = pending.find(item => item.fileName === '01.mp4')
  const b = pending.find(item => item.fileName === '02.mp4')
  const ambiguous = pending.find(item => item.fileName.startsWith('夹层'))
  assert.ok(a && b && ambiguous)
  assert.equal(a.suggestion.title, null)

  // One row intentionally conflicts by claiming a slot another file already holds.
  const published = (await op.admin()).items.find(item => item.fileName.startsWith('批量电影扫入'))
  const bulk = await fx.request('/api/admin/media/bulk', {
    auth: true, method: 'POST',
    json: { items: [
      { id: a.id, title: '批量甲', year: 2020 },
      { id: b.id, title: '批量乙', year: 2021 },
      { id: ambiguous.id, kind: 'series', titleId: published.titleId, title: '批量电影扫入', season: 9, episode: 9 },
    ] },
  })
  assert.equal(bulk.status, 200)
  const result = await bulk.json()
  assert.equal(result.published.length, 2)
  assert.equal(result.skipped.length, 1)
  const bulkPublished = result.published.map(item => item.fileName).sort()
  assert.deepEqual(bulkPublished, ['01.mp4', '02.mp4'])
  const films = [...(await op.catalog('?q=%E6%89%B9%E9%87%8F%E7%94%B2')), ...(await op.catalog('?q=%E6%89%B9%E9%87%8F%E4%B9%99'))]
  assert.equal(films.length, 2)
  for (const film of films) assert.equal((await op.title(film.id)).description, '这是默认简介。')
  const conflict = result.skipped[0]
  assert.equal(conflict.id, ambiguous.id)
  assert.match(conflict.message, /已有文件|已有/)
  assert.equal((await op.admin()).items.find(item => item.id === ambiguous.id).state, 'pending')

  // A newly scanned, auto-published film also inherits the default description.
  await fx.stage('默认简介新片 (2019).mp4')
  await fx.scan()
  await delay(150)
  await fx.scan()
  const fresh = (await op.catalog('?q=%E9%BB%98%E8%AE%A4%E7%AE%80%E4%BB%8B'))[0]
  assert.equal((await op.title(fresh.id)).description, '这是默认简介。')

  // A pending file may be previewed to extract its first frame, but never anonymously.
  const preview = await fx.request(`/api/admin/media/${ambiguous.id}/preview`, { method: 'HEAD' })
  assert.equal(preview.status, 401)
  await preview.text()
  assert.equal((await fx.request(`/api/admin/media/${ambiguous.id}/preview`, { auth: true, method: 'HEAD' })).status, 200)
})

test('visitors: register, sign in, favourites, and no admin access', { timeout: 60_000 }, async t => {
  const fx = await runtimeFixture(t)
  const op = operations(fx)
  await fx.login()
  const { item } = await (await op.upload('收藏测试 (2024).mp4')).json()
  const card = (await op.catalog())[0]
  assert.ok(card && item.id)

  const visitor = userApi(fx, { username: '影迷小张', password: '123456' })
  const anonymous = await fetch(`${fx.base}/api/user/session`)
  assert.deepEqual(await anonymous.json(), { username: null })
  const anonymousFavorites = await (await assertStatus(await fetch(`${fx.base}/api/user/favorites`), 200)).json()
  assert.deepEqual(anonymousFavorites, { items: [] })
  const guarded = await fetch(`${fx.base}/api/user/favorites/${card.id}`, { method: 'PUT', headers: { origin: fx.base } })
  assert.equal(guarded.status, 401)
  await guarded.text()

  const short = await visitor.call('/api/user/register', { method: 'POST', json: { username: '短密码', password: '12345' } })
  assert.equal(short.status, 422)
  assert.match((await short.json()).data.message, /6/)
  const rejected = await visitor.call('/api/user/register', { method: 'POST', json: { username: '影迷小张', password: '123456' } })
  assert.equal(rejected.status, 200)
  const cookieHeader = rejected.headers.getSetCookie()[0]
  assert.match(cookieHeader, /HttpOnly/i)
  assert.match(cookieHeader, /SameSite=Strict/i)
  assert.match(cookieHeader, /night_library_user=/)
  const duplicate = await visitor.call('/api/user/register', { method: 'POST', json: { username: '影迷小张', password: 'abcdef' } })
  assert.equal(duplicate.status, 409)
  await duplicate.text()

  await visitor.signIn()
  const session = await (await assertStatus(await visitor.call('/api/user/session'), 200)).json()
  assert.equal(session.username, '影迷小张')
  const wrongPassword = await fetch(`${fx.base}/api/user/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: fx.base },
    body: JSON.stringify({ username: '影迷小张', password: 'wrong-password' }),
  })
  assert.equal(wrongPassword.status, 401)
  await wrongPassword.text()

  const added = await assertStatus(await visitor.call(`/api/user/favorites/${card.id}`, { method: 'PUT' }), 200)
  assert.deepEqual(await added.json(), { favorited: true })
  assert.deepEqual(await (await assertStatus(await visitor.call(`/api/user/favorites/${card.id}`), 200)).json(), { favorited: true })
  const listed = await (await assertStatus(await visitor.call('/api/user/favorites'), 200)).json()
  assert.equal(listed.items.length, 1)
  assert.equal(listed.items[0].title, '收藏测试')
  assert.deepEqual(Object.keys(listed.items[0]).sort(),
    ['addedAt', 'available', 'backdropUrl', 'genres', 'id', 'kind', 'originalTitle', 'posterUrl', 'rating', 'title', 'year'])

  // A missing title cannot be favourited, and visitors never reach admin APIs.
  const missing = await visitor.call('/api/user/favorites/00000000-0000-4000-8000-000000000000', { method: 'PUT' })
  assert.equal(missing.status, 404)
  await missing.text()
  const adminAsVisitor = await visitor.call('/api/admin/library')
  assert.equal(adminAsVisitor.status, 401)
  await adminAsVisitor.text()
  const userUpload = await fetch(`${fx.base}/api/admin/upload?name=x.mp4`, {
    method: 'POST', headers: { origin: fx.base, cookie: visitor.cookie() },
  })
  assert.equal(userUpload.status, 401)
  await userUpload.text()

  assert.deepEqual(await (await assertStatus(await visitor.call(`/api/user/favorites/${card.id}`, { method: 'DELETE' }), 200)).json(), { favorited: false })
  assert.deepEqual(await (await assertStatus(await visitor.call('/api/user/favorites'), 200)).json(), { items: [] })

  // Logging out ends the session instead of leaving it valid.
  await assertStatus(await visitor.call('/api/user/logout', { method: 'POST' }), 200)
  assert.deepEqual(await (await assertStatus(await visitor.call('/api/user/favorites'), 200)).json(), { items: [] })
  assert.deepEqual(await (await assertStatus(await visitor.call('/api/user/session'), 200)).json(), { username: null })
})

test('periodic scans discover copied films and repeated manual requests do not duplicate rows', { timeout: 30_000 }, async t => {
  const fx = await runtimeFixture(t, { interval: 175, stable: 100 })
  const op = operations(fx)
  await fx.login()
  await fx.stage('定时发现 (2021).mp4')
  const title = await waitFor(async () => (await op.catalog())[0], 'periodic scanner did not find the film')
  assert.equal(title.title, '定时发现')
  await Promise.all(Array.from({ length: 5 }, () => fx.scan()))
  assert.equal((await op.catalog()).length, 1)
  assert.equal((await op.admin()).items.length, 1)
})

test('production can bind only the selected LAN interface', {
  timeout: 30_000, skip: !process.env.TEST_LAN_HOST,
}, async t => {
  const fx = await runtimeFixture(t, { host: process.env.TEST_LAN_HOST })
  assert.deepEqual(await operations(fx).catalog(), [])
  await assert.rejects(fetch(`http://127.0.0.1:${fx.port}/api/library`, { signal: AbortSignal.timeout(2000) }), { name: 'TypeError' })
})
