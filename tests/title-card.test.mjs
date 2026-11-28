// Entering the player names what is playing in the top-left corner for a few seconds,
// and a series also says which episode, then the card fades away.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from 'playwright-core'
import { runtimeFixture } from './helpers/runtime.mjs'

async function cardBox(page) {
  const node = page.locator('[data-test="title-card"]')
  if (!(await node.count())) return null
  const box = await node.boundingBox()
  const stage = await page.locator('.watch-stage').boundingBox()
  return {
    text: (await node.innerText()).replace(/\s+/g, ' ').trim(),
    leftGap: box ? Math.round(box.x - stage.x) : null,
    topGap: box ? Math.round(box.y - stage.y) : null,
  }
}

test('the title card appears top-left on load and fades out', { timeout: 240_000 }, async (t) => {
  await mkdir('.test-artifacts', { recursive: true })
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  const browser = await chromium.launch({ channel: 'msedge' })
  const report = []
  try {
    await fx.login()
    await fx.stage('独立电影.mp4')
    for (let i = 1; i <= 2; i++) await fx.stage(`浮层剧集 第${i}集.mp4`)
    await fx.scan()
    const movie = (await (await fx.request('/api/library?kind=movie')).json()).items[0]
    const series = (await (await fx.request('/api/library?kind=series')).json()).items[0]
    const detail = await (await fx.request(`/api/library/${series.id}`)).json()
    const second = [...detail.episodes].sort((a, b) => a.episode - b.episode)[1]

    const [name, value] = fx.cookie().split('=')
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
    await context.addCookies([{ name, value, url: fx.base, httpOnly: true, sameSite: 'Strict' }])

    // --- A film: just its name ---------------------------------------------
    const page = await context.newPage()
    await page.goto(`${fx.base}/watch/${movie.id}`, { waitUntil: 'networkidle' })
    await page.locator('video').waitFor()
    await page.locator('[data-test="title-card"]').waitFor({ timeout: 20_000 })
    const filmCard = await cardBox(page)
    report.push(`film card: ${JSON.stringify(filmCard)}`)
    assert.ok(filmCard, 'the film shows a title card')
    assert.match(filmCard.text, /独立电影/)
    assert.ok(filmCard.leftGap <= 40, `hugs the left edge, gap ${filmCard.leftGap}px`)
    assert.ok(filmCard.topGap <= 40, `hugs the top edge, gap ${filmCard.topGap}px`)
    await page.screenshot({ path: '.test-artifacts/title-card-film.png' })

    // It goes away by itself; nothing stays over the picture.
    await page.waitForFunction(() => !document.querySelector('[data-test="title-card"]'), null, { timeout: 15_000 })
    report.push('film card faded out')
    assert.equal(await page.locator('[data-test="title-card"]').count(), 0)

    // --- A series: name plus the episode ------------------------------------
    const episode = await context.newPage()
    await episode.goto(`${fx.base}/watch/${series.id}`, { waitUntil: 'networkidle' })
    await episode.locator('video').waitFor()
    await episode.locator('[data-test="title-card"]').waitFor({ timeout: 20_000 })
    const seriesCard = await cardBox(episode)
    report.push(`series card: ${JSON.stringify(seriesCard)}`)
    assert.match(seriesCard.text, /浮层剧集/)
    assert.match(seriesCard.text, /第 1 季第 1 集/, 'the episode number is named')
    assert.match(seriesCard.text, /剧集/, 'the kind tag marks it as a series')
    await episode.screenshot({ path: '.test-artifacts/title-card-series.png' })
    await episode.waitForFunction(() => !document.querySelector('[data-test="title-card"]'), null, { timeout: 15_000 })
    report.push('series card faded out')

    // Jumping to another episode names that episode instead.
    await episode.goto(`${fx.base}/watch/${series.id}?episode=${second.id}`, { waitUntil: 'networkidle' })
    await episode.locator('video').waitFor()
    await episode.locator('[data-test="title-card"]').waitFor({ timeout: 20_000 })
    const secondCard = await cardBox(episode)
    report.push(`episode 2 card: ${JSON.stringify(secondCard)}`)
    assert.match(secondCard.text, /第 1 季第 2 集/)
    assert.doesNotMatch(secondCard.text, /第 1 季第 1 集/)

    await context.close()
  } finally {
    console.log(report.join('\n'))
    await browser.close()
  }
})
