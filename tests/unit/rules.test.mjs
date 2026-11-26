import assert from 'node:assert/strict'
import { test } from 'node:test'
import { recognize, titleIdentity } from '../../server/domain/recognition.ts'
import { byteRange, disposition } from '../../server/http/range.ts'
import { assertFileName, relativeSegments, videoFileName } from '../../server/storage/paths.ts'

const movie = (title, year = null) => ({ kind: 'movie', title, year, season: null, episode: null })
const episode = (title, season, episodeNumber) => ({ kind: 'series', title, year: null, season, episode: episodeNumber })

test('movie and episode recognition from ordinary Chinese and structured names', () => {
  assert.deepEqual(recognize('电影/远山来信 (2024).mp4').match, movie('远山来信', 2024))
  assert.deepEqual(recognize('上传/观潮日记.mp4').match, movie('观潮日记'))
  assert.deepEqual(recognize('观潮日记.S01E02.MP4').match, episode('观潮日记', 1, 2))
  assert.deepEqual(recognize('观潮日记 第02集.mp4').match, episode('观潮日记', 1, 2))
  assert.deepEqual(recognize('电视剧/观潮日记/第二季/第02集.mp4').match, episode('观潮日记', 2, 2))
  assert.deepEqual(recognize('剧集/观潮日记/Season 10/02.mp4').match, episode('观潮日记', 10, 2))
  assert.equal(titleIdentity('series', 'Ｆｉｌｍ　Lab', null), titleIdentity('series', 'film lab', null))
})

test('ambiguous names, multi-episode releases and conflicting seasons are not published', () => {
  for (const name of ['01.mp4', '未命名.mp4', '第02集.mp4', '剧名 第02-03集.mp4',
    '剧名.S01E01-E03.mp4', '剧名.S01E01E03.mp4', '剧名.S01E00.mp4', '剧集/未分集.mp4',
    '剧名/第二季/剧名.S01E02.mp4']) {
    const result = recognize(name)
    assert.equal(result.match, null, name)
    assert.ok(result.reason, name)
  }
})

test('path checks reject Windows ADS, reserved names, traversal and temporary video names', () => {
  assert.deepEqual(relativeSegments('电视剧/第二季/第01集.mp4'), ['电视剧', '第二季', '第01集.mp4'])
  for (const name of ['../a.mp4', 'C:/a.mp4', '/a.mp4', 'x\\a.mp4', 'file.mp4:ads', 'a//b.mp4', '.hidden/x.mp4', 'COM1.mp4', 'a /x.mp4', 'bad\u0000.mp4']) {
    assert.throws(() => relativeSegments(name), { status: 400 }, name)
  }
  assert.throws(() => assertFileName('root/合法名.mp4'), { status: 400 })
  assert.equal(videoFileName('待复制.part.mp4'), false)
  assert.equal(videoFileName('已复制.MP4'), true)
})

test('inclusive, open, suffix and bounded single ranges; reject invalid and unsatisfiable ranges', () => {
  assert.deepEqual(byteRange('bytes=0-0', 120), { start: 0, end: 0 })
  assert.deepEqual(byteRange('bytes=15-', 120), { start: 15, end: 119 })
  assert.deepEqual(byteRange('bytes=-10', 120), { start: 110, end: 119 })
  assert.deepEqual(byteRange('bytes=-9999999999999999999999999999', 120), { start: 0, end: 119 })
  assert.deepEqual(byteRange('bytes=20-9999999999999999999999999999', 120), { start: 20, end: 119 })
  for (const header of ['bytes=-', 'bytes=-0', 'bytes=120-', 'bytes=30-10', 'items=0-9', 'bytes=0-1,4-7', 'bytes=0-NaN']) {
    assert.equal(byteRange(header, 120), null, header)
  }
  assert.equal(byteRange('bytes=0-', 0), null)
  const name = '片名 (2024).mp4'
  const header = disposition(name, true)
  assert.match(header, /^attachment; filename="video\.mp4"; filename\*=UTF-8''/)
  assert.equal(decodeURIComponent(header.split("UTF-8''")[1]), name)
})
