import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { openDatabase } from '../../server/db/database.ts'
import { setAdmin, adminStore } from '../../server/db/admin.ts'
import { hashPassword, verifyPassword } from '../../server/domain/password.ts'
import { libraryStore } from '../../server/db/library.ts'
import { userStore } from '../../server/db/users.ts'
import { indexMedia } from '../../server/services/index-media.ts'

async function database(t) {
  const parent = resolve(tmpdir())
  const root = await mkdtemp(join(parent, 'night-db-test-'))
  const name = join(root, 'db.sqlite')
  const db = openDatabase(name)
  t.after(async () => {
    db.close()
    assert.equal(dirname(root), parent)
    assert.match(root.slice(parent.length + 1), /^night-db-test-[a-z0-9]+$/i)
    await rm(root, { recursive: true, force: true })
  })
  return { db, name }
}

test('migration version persists on reopen and repeat indexing keeps IDs and edited title', async (t) => {
  const { db, name } = await database(t)
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 4)
  const store = libraryStore(db)
  // Settings survive a reopen and default to an empty value when never written.
  assert.equal(store.setting('default_description'), null)
  store.saveSetting('default_description', '默认简介测试')
  const entry = { relative: '电影/片名 (2024).mp4', stamp: { size: 900, mtime: 100 } }
  const first = store.transact(() => indexMedia(store, entry, true, 'scan', new Set()))
  const title = store.cards('', null)[0]
  assert.equal(title.title, '片名')
  store.editTitle(title.id, { title: '手动片名', description: '简介', year: 2025, poster_path: null })
  const repeat = store.transact(() => indexMedia(store, { ...entry, stamp: { size: 901, mtime: 200 } }, true, 'scan', new Set()))
  assert.equal(repeat.id, first.id)
  assert.equal(repeat.added, false)
  const other = openDatabase(name)
  try {
    const reopened = libraryStore(other)
    assert.equal(reopened.setting('default_description'), '默认简介测试')
    const persisted = reopened.detail(title.id)
    assert.equal(persisted.description, '简介')
    assert.equal(persisted.year, 2025)
    assert.equal(persisted.title, '手动片名')
    assert.equal(persisted.movie.id, first.id)
  } finally { other.close() }
})

test('rich metadata drives browse filters, sorting and home rails', async (t) => {
  const { db } = await database(t)
  const store = libraryStore(db)
  const base = {
    description: '简介', poster_path: null, original_title: null, genres: '[]', region: null,
    rating: null, runtime: null, director: null, cast_members: '[]', backdrop_path: null,
  }
  const add = (metadata, key) => {
    const titleId = store.createTitle('movie', { ...base, ...metadata }, key)
    store.createFile({
      relative_path: `${key}.mp4`, path_key: `${key}.mp4`, size: 10, mtime: 1, state: 'published',
      available: 1, valid_mp4: 1, reason: null, source: 'scan', title_id: titleId, episode_id: null,
    })
    return titleId
  }
  const sciFi = add({ title: '甲片', year: 2023, rating: 8.6, region: '中国', genres: '["科幻"]' }, 'a')
  add({ title: '乙片', year: 2019, rating: 7.2, region: '日本', genres: '["剧情"]' }, 'b')
  add({ title: '丙片', year: 2025, rating: 9.1, region: '中国', genres: '["科幻","剧情"]' }, 'c')

  const all = store.browse({ q: '', kind: null, genre: null, region: null, yearFrom: null, yearTo: null, minRating: null, sort: 'newest', page: 1, pageSize: 24 })
  assert.equal(all.total, 3)
  assert.deepEqual(all.facets.genres.sort(), ['剧情', '科幻'].sort())
  assert.deepEqual(all.facets.regions.sort(), ['中国', '日本'].sort())

  const onlySciFi = store.browse({ q: '', kind: null, genre: '科幻', region: null, yearFrom: null, yearTo: null, minRating: null, sort: 'newest', page: 1, pageSize: 24 })
  assert.equal(onlySciFi.total, 2)

  const china = store.browse({ q: '', kind: null, genre: null, region: '中国', yearFrom: 2020, yearTo: null, minRating: 8, sort: 'rating', page: 1, pageSize: 24 })
  assert.deepEqual(china.items.map(item => item.title), ['丙片', '甲片'])

  const paged = store.browse({ q: '', kind: null, genre: null, region: null, yearFrom: null, yearTo: null, minRating: null, sort: 'title', page: 2, pageSize: 2 })
  assert.equal(paged.total, 3)
  assert.equal(paged.items.length, 1)

  const home = store.home()
  assert.equal(home.total, 3)
  assert.equal(home.heroes[0].rating, 9.1, 'the best rated title leads the hero')
  assert.ok(home.rails.some(rail => rail.id === 'genre-科幻'))
  const detail = store.detail(sciFi)
  assert.deepEqual(detail.genres, ['科幻'])
  assert.equal(detail.region, '中国')
})

test('visitor accounts and favourites persist across a reopen', async (t) => {
  const { db, name } = await database(t)
  const store = libraryStore(db)
  const users = userStore(db)
  const entry = { relative: '收藏持久化 (2024).mp4', stamp: { size: 500, mtime: 10 } }
  store.transact(() => indexMedia(store, entry, true, 'scan', new Set()))
  const title = store.cards('', null)[0]
  const hash = await hashPassword('123456')
  const user = users.create('影迷', hash)
  assert.ok(user)
  // Names are compared case-insensitively and cannot be registered twice.
  assert.equal(users.byName('影迷')?.id, user.id)
  assert.equal(users.create('影迷', hash), null)
  users.addFavorite(user.id, title.id)

  const reopened = openDatabase(name)
  try {
    const again = userStore(reopened)
    // A 6-character password is accepted by the new policy and still verifies.
    assert.equal(await verifyPassword('123456', again.byName('影迷')?.password_hash), true)
    assert.equal(again.hasFavorite(user.id, title.id), true)
    const favorites = again.favorites(user.id)
    assert.equal(favorites.length, 1)
    assert.equal(favorites[0].title, '收藏持久化')
    again.removeFavorite(user.id, title.id)
    assert.deepEqual(again.favorites(user.id), [])
  } finally { reopened.close() }
})

test('scrypt credentials are salted and reset invalidates existing sessions', async (t) => {
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
  admins.add('hashed-session', Date.now() + 10000)
  assert.equal(admins.find('hashed-session', Date.now()).username, '管理员')
  setAdmin(db, '夜灯', current)
  assert.equal(admins.find('hashed-session', Date.now()), undefined)
  assert.equal(admins.account().username, '夜灯')
})
