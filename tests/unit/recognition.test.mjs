// Recognition is the whole point of the library: a filename decides the title, the
// actor, and whether it is a film or one episode of a series.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { recognize, titleIdentity } from '../../server/domain/recognition.ts'

const movie = (title, actor = null, year = null) =>
  ({ kind: 'movie', title, year, actor, season: null, episode: null })
const episode = (title, season, number, actor = null) =>
  ({ kind: 'series', title, year: null, actor, season, episode: number })

test('a plain filename is a film named after the file', () => {
  assert.deepEqual(recognize('观潮日记.mp4'), movie('观潮日记'))
  assert.deepEqual(recognize('散装电影 (2021).mp4'), movie('散装电影', null, 2021))
  assert.deepEqual(recognize('电影/远山来信 (2024).mp4'), movie('远山来信', null, 2024))
})

test('演员-片名 puts the star in the cast and keeps the title clean', () => {
  // The real library naming: `演员-编号 标题 - 字幕`.
  assert.deepEqual(
    recognize('七海蒂娜-ADN-619 一個在已故丈夫面前尿尿的女人 - 中文字幕.mp4'),
    movie('ADN-619 一個在已故丈夫面前尿尿的女人', '七海蒂娜'),
  )
  assert.deepEqual(
    recognize('佐山愛-MEYD-986-落入房地產詐騙犯的圈.mp4'),
    movie('MEYD-986-落入房地產詐騙犯的圈', '佐山愛'),
  )
  // A double dash is still one separator.
  assert.deepEqual(recognize('橘玛丽--搜查官-5星巅峰.mp4'), movie('搜查官-5星巅峰', '橘玛丽'))
})

test('episode numbers are recognised in the usual notations', () => {
  assert.deepEqual(recognize('山海旧事 第01集.mp4'), episode('山海旧事', 1, 1))
  assert.deepEqual(recognize('山海旧事.S01E02.mp4'), episode('山海旧事', 1, 2))
  assert.deepEqual(recognize('山海旧事 EP03.mp4'), episode('山海旧事', 1, 3))
  assert.deepEqual(recognize('山海旧事 第四集.mp4'), episode('山海旧事', 1, 4))
  assert.deepEqual(recognize('山海旧事-05.mp4'), episode('山海旧事', 1, 5))
  assert.deepEqual(recognize('[字幕组] 临江仙 - 06 [1080p].mp4'), episode('临江仙', 1, 6))
  // A season folder supplies the season, and the folder name supplies the title.
  assert.deepEqual(recognize('剧集/山海旧事/第07集.mp4'), episode('山海旧事', 1, 7))
  assert.deepEqual(recognize('山海旧事 第二季/山海旧事 第01话.mp4'), episode('山海旧事', 2, 1))
})

test('the real series in the library groups into one title with ordered episodes', () => {
  const names = Array.from({ length: 10 }, (_, index) => `漫剧/淫妻派对 第${index + 1}集.mp4`)
  const identified = names.map(name => recognize(name))
  assert.ok(identified.every(item => item.kind === 'series'))
  assert.ok(identified.every(item => item.title === '淫妻派对'))
  assert.deepEqual(identified.map(item => item.episode), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
})

test('release ids and years are not episode numbers', () => {
  // WAAA-501 is a catalogue number, not episode 501 of anything.
  assert.equal(recognize('五日一芽衣-代替负债累累的主人-WAAA-501.mp4').kind, 'movie')
  assert.equal(recognize('散装电影 2021.mp4').kind, 'movie')
})

test('the identity key ignores case and width so the same film merges', () => {
  assert.equal(titleIdentity('movie', 'Ｆｉｌｍ　Lab', null), titleIdentity('movie', 'film lab', null))
  assert.notEqual(titleIdentity('movie', '片名', 2020), titleIdentity('movie', '片名', 2021))
})
