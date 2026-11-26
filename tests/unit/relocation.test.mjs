import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { openDatabase } from '../../server/db/database.ts'
import { libraryStore } from '../../server/db/library.ts'
import { libraryConfig } from '../../server/domain/config.ts'
import { createCatalog } from '../../server/services/catalog.ts'
import { indexMedia } from '../../server/services/index-media.ts'

test('changing the media root preserves the original catalog and addresses', async t => {
  const parent = resolve(tmpdir())
  const temp = await mkdtemp(join(parent, 'night-lib-move-'))
  const dbPath = join(temp, 'library.sqlite')
  const before = join(temp, 'original')
  const after = join(temp, 'relocated')
  const folder = '电影'
  const name = '异地放映 (2024).mp4'
  const path = join(before, folder, name)
  t.after(async () => {
    assert.equal(dirname(temp), parent)
    assert.match(temp.slice(parent.length + 1), /^night-lib-move-[a-z0-9]+$/i)
    await rm(temp, { recursive: true, force: true })
  })
  await mkdir(dirname(path), { recursive: true })
  await copyFile(new URL('../fixtures/seek.mp4', import.meta.url), path)
  const file = await stat(path)
  const db = openDatabase(dbPath)
  let title, mediaId
  try {
    const store = libraryStore(db)
    mediaId = store.transact(() => indexMedia(store, {
      relative: `${folder}/${name}`, stamp: { size: file.size, mtime: Math.trunc(file.mtimeMs) },
    }, true, 'scan', new Set())).id
    title = store.cards('', null)[0]
  } finally { db.close() }
  assert.equal(dirname(before), temp)
  assert.equal(dirname(after), temp)
  await rename(before, after)
  const reopened = openDatabase(dbPath)
  try {
    const catalog = createCatalog(libraryStore(reopened), libraryConfig({ dbPath, mediaRoot: after }))
    assert.equal(catalog.detail(title.id).movie.id, mediaId)
    const opened = await catalog.video(mediaId)
    try {
      assert.equal(opened.name, name)
      assert.equal(opened.size, file.size)
    } finally { await opened.file.close() }
  } finally { reopened.close() }
})
