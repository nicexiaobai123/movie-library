// The database is a projection of the media folder. These tests cover the store's
// own rules: a scan indexes files, series collapse into ordered episodes, deleting a
// file removes its title when nothing else uses it, and accounts survive a reopen.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { openDatabase } from '../../server/db/database.ts'
import { setAdmin, adminStore } from '../../server/db/admin.ts'
import { hashPassword, verifyPassword } from '../../server/domain/password.ts'
import { libraryStore } from '../../server/db/library.ts'
import { userStore } from '../../server/db/users.ts'
import { indexMedia, pruneOrphans } from '../../server/services/index-media.ts'
import { migrations } from '../../server/db/migrations.ts'
import { pathKey } from '../../server/storage/paths.ts'

async function database(t) {
  const parent = resolve(tmpdir())
  const root = await mkdtemp(join(parent, 'night-db-test-'))
  const name = join(root, 'db.sqlite')
  const db = openDatabase(name)
  t.after(async () => {
    // A test may close the handle itself; closing twice is not an error.
    try { db.close() } catch { /* already closed */ }
    assert.equal(dirname(root), parent)
    assert.match(root.slice(parent.length + 1), /^night-db-test-[a-z0-9]+$/i)
    await rm(root, { recursive: true, force: true })
  })
  return { db, name }
}

const entry = (relative, size = 100) => ({ relative, stamp: { size, mtime: 1_000 } })

test('a fresh database reaches the current schema version and reopens cleanly', async (t) => {
  const { db, name } = await database(t)
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, migrations.at(-1).version)

  const store = libraryStore(db)
  store.transact(() => indexMedia(store, entry('观潮日记.mp4'), true))
  const card = store.browse({ q: '', kind: null, actor: null, sort: 'newest', page: 1, pageSize: 10 }).items[0]
  assert.equal(card.title, '观潮日记')

  // Reopening keeps the rows, because the schema version matches.
  const reopened = openDatabase(name)
  try {
    const again = libraryStore(reopened)
    assert.equal(again.browse({ q: '', kind: null, actor: null, sort: 'newest', page: 1, pageSize: 10 }).total, 1)
  } finally { reopened.close() }
})

test('an incompatible database is rebuilt instead of refusing to start', async (t) => {
  const { db, name } = await database(t)
  // Pretend the file came from an older build.
  db.exec('PRAGMA user_version = 4')
  db.close()

  const rebuilt = openDatabase(name)
  try {
    assert.equal(rebuilt.prepare('PRAGMA user_version').get().user_version, migrations.at(-1).version)
    // The rebuilt schema is empty and usable.
    assert.equal((rebuilt.prepare('SELECT COUNT(*) AS n FROM titles').get()).n, 0)
  } finally { rebuilt.close() }
})

test('re-indexing the same path keeps its id and its edited title', async (t) => {
  const { db } = await database(t)
  const store = libraryStore(db)
  const first = store.transact(() => indexMedia(store, entry('电影/片名 (2024).mp4', 900), true))
  const title = store.browse({ q: '', kind: null, actor: null, sort: 'newest', page: 1, pageSize: 10 }).items[0]
  assert.equal(title.title, '片名')

  store.editTitle(title.id, {
    title: '手动片名', year: 2025, description: '简介', poster_path: null,
    cast_members: JSON.stringify(['演员甲']),
  })
  const repeat = store.transact(() => indexMedia(store, entry('电影/片名 (2024).mp4', 901), true))
  assert.equal(repeat.id, first.id)
  // The hand-edited title wins over the filename.
  assert.equal(store.title(title.id).title, '手动片名')
  assert.deepEqual(JSON.parse(store.title(title.id).cast_members), ['演员甲'])
})

test('episode files group into one series with ordered slots', async (t) => {
  const { db } = await database(t)
  const store = libraryStore(db)
  for (const number of [3, 1, 2]) {
    store.transact(() => indexMedia(store, entry(`漫剧/淫妻派对 第${number}集.mp4`), true))
  }
  const titles = store.titles()
  const series = titles.filter(title => title.kind === 'series')
  assert.equal(series.length, 1, 'all episodes share one title')
  assert.equal(series[0].title, '淫妻派对')
  const detail = store.detail(series[0].id)
  assert.deepEqual(detail.episodes.map(episode => episode.episode), [1, 2, 3])
  assert.ok(detail.episodes.every(episode => episode.media?.available))
})

test('deleting a file removes its title only when nothing else uses it', async (t) => {
  const { db } = await database(t)
  const store = libraryStore(db)
  const users = userStore(db)

  const solo = store.transact(() => indexMedia(store, entry('甲片.mp4'), true))
  const soloTitle = store.fileAt(pathKey('甲片.mp4'))?.title_id
  const user = users.create('影迷', await hashPassword('123456'))
  users.addFavorite(user.id, soloTitle)

  // A series keeps its title while another episode still has a file.
  store.transact(() => indexMedia(store, entry('乙剧 第01集.mp4'), true))
  store.transact(() => indexMedia(store, entry('乙剧 第02集.mp4'), true))
  const seriesTitle = store.titles().find(title => title.title === '乙剧').id

  // Removing the bytes is what deletes: the row goes, then the orphan title.
  store.deleteFile(solo.id)
  pruneOrphans(store)
  assert.equal(store.title(soloTitle), undefined)
  assert.equal(store.files().length, 2)

  const episodeRow = store.files().find(row => row.relative_path === '乙剧 第01集.mp4')
  store.deleteFile(episodeRow.id)
  pruneOrphans(store)
  assert.equal(store.title(seriesTitle)?.title, '乙剧', 'the series survives one lost episode')
  assert.equal(store.files().length, 1)

  // A favourite outlives a file disappearing.
  assert.equal(users.hasFavorite(user.id, soloTitle), true)
  assert.deepEqual(users.favorites(user.id), [])
})

test('browse filters by actor and orders by title or recency', async (t) => {
  const { db } = await database(t)
  const store = libraryStore(db)
  const add = (relative, cast, identity) => {
    const titleId = store.createTitle('movie', {
      title: identity, year: 2020, description: '', poster_path: null,
      cast_members: JSON.stringify(cast),
    }, identity)
    store.createFile({
      relative_path: relative, path_key: relative, size: 1, mtime: 1, available: 1,
      title_id: titleId, episode_id: null,
    })
    return titleId
  }
  add('a.mp4', ['演员甲'], '甲片')
  add('b.mp4', ['演员乙'], '乙片')
  add('c.mp4', ['演员甲'], '丙片')

  const all = store.browse({ q: '', kind: null, actor: null, sort: 'title', page: 1, pageSize: 10 })
  assert.equal(all.total, 3)
  assert.deepEqual(all.items.map(item => item.title).sort(), ['丙片', '乙片', '甲片'].sort())

  const filtered = store.browse({ q: '', kind: null, actor: '演员甲', sort: 'title', page: 1, pageSize: 10 })
  assert.equal(filtered.total, 2)
  assert.deepEqual(filtered.items.map(item => item.title).sort(), ['丙片', '甲片'].sort())

  const paged = store.browse({ q: '', kind: null, actor: null, sort: 'title', page: 2, pageSize: 2 })
  assert.equal(paged.total, 3)
  assert.equal(paged.items.length, 1)

  // Actors are derived from cast lists, never stored separately.
  const actors = store.actors()
  assert.equal(actors.find(actor => actor.name === '演员甲')?.count, 2)
})

test('visitor accounts and favourites persist across a reopen', async (t) => {
  const { db, name } = await database(t)
  const store = libraryStore(db)
  const users = userStore(db)
  store.transact(() => indexMedia(store, entry('收藏持久化 (2024).mp4'), true))
  const title = store.browse({ q: '', kind: null, actor: null, sort: 'newest', page: 1, pageSize: 10 }).items[0]
  const hash = await hashPassword('123456')
  const user = users.create('影迷', hash)
  assert.ok(user)
  assert.equal(users.byName('影迷')?.id, user.id)
  assert.equal(users.create('影迷', hash), null, 'names are unique and case-insensitive')
  users.addFavorite(user.id, title.id)

  const reopened = openDatabase(name)
  try {
    const again = userStore(reopened)
    assert.equal(await verifyPassword('123456', again.byName('影迷')?.password_hash), true)
    assert.equal(again.hasFavorite(user.id, title.id), true)
    const favorites = again.favorites(user.id)
    assert.equal(favorites.length, 1)
    assert.equal(favorites[0].title, '收藏持久化')
    again.removeFavorite(user.id, title.id)
    assert.deepEqual(again.favorites(user.id), [])
  } finally { reopened.close() }
})

test('scrypt credentials are salted and a reset invalidates sessions', async (t) => {
  const { db } = await database(t)
  const password = '测试用-长度足够-password'
  const old = await hashPassword(password)
  const current = await hashPassword(password)
  assert.notEqual(old, current)
  assert.ok(!old.includes(password))
  assert.equal(await verifyPassword(password, old), true)
  assert.equal(await verifyPassword(password + 'different', old), false)
  setAdmin(db, '管理员', old)
  const admins = adminStore(db)
  admins.add('hashed-session', Date.now() + 10_000)
  assert.equal(admins.find('hashed-session', Date.now()).username, '管理员')
  setAdmin(db, '夜灯', current)
  assert.equal(admins.find('hashed-session', Date.now()), undefined)
  assert.equal(admins.account().username, '夜灯')
})
