// A series must be steppable without going back to the episode list: a next-episode
// control sits in the bottom-left corner of the picture, and finishing an episode
// offers the next one with a countdown.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from 'playwright-core'
import { runtimeFixture } from './helpers/runtime.mjs'

test('the next episode is reachable from the player and plays itself', { timeout: 240_000 }, async (t) => {
  await mkdir('.test-artifacts', { recursive: true })
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  const browser = await chromium.launch({ channel: 'msedge' })
  const report = []
  try {
    await fx.login()
    for (let i = 1; i <= 3; i++) await fx.stage(`连播测试 第${i}集.mp4`)
    await fx.scan()
    const series = (await (await fx.request('/api/library?kind=series')).json()).items[0]
    const detail = await (await fx.request(`/api/library/${series.id}`)).json()
    const episodes = [...detail.episodes].sort((a, b) => a.season - b.season || a.episode - b.episode)
    assert.equal(episodes.length, 3)
    const first = episodes[0]

    const [name, value] = fx.cookie().split('=')
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
    await context.addCookies([{ name, value, url: fx.base, httpOnly: true, sameSite: 'Strict' }])
    const page = await context.newPage()
    await page.goto(`${fx.base}/watch/${series.id}?episode=${first.id}`, { waitUntil: 'networkidle' })
    await page.locator('video').waitFor()
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1, null, { timeout: 20_000 })

    // The buttons float over the picture's bottom-left corner, above the control bar.
    const stageBox = await page.locator('.watch-stage').boundingBox()
    const nextBox = await page.locator('[data-test="episode-next"]').boundingBox()
    report.push(`next button: ${JSON.stringify(nextBox && { x: Math.round(nextBox.x), y: Math.round(nextBox.y) })}`)
    assert.ok(nextBox, 'the next-episode button is present')
    assert.ok(nextBox.x - stageBox.x < 140, 'the button hugs the left edge of the picture')
    assert.ok(stageBox.y + stageBox.height - (nextBox.y + nextBox.height) < 140, 'the button floats near the bottom')
    // Its name is a tooltip rather than visible text.
    assert.match(await page.locator('[data-test="episode-next"]').getAttribute('title') ?? '', /下一集/)
    await page.screenshot({ path: '.test-artifacts/episode-nav.png' })

    // Clicking it moves to the second episode; the first episode has no "previous".
    assert.equal(await page.locator('[data-test="episode-prev"]').count(), 0, 'no previous on the first episode')
    await page.locator('[data-test="episode-next"]').click()
    await page.waitForFunction(second => location.search.includes(second), episodes[1].id, { timeout: 15_000 })
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1, null, { timeout: 20_000 })
    report.push(`after next: ${new URL(page.url()).searchParams.get('episode') === episodes[1].id ? 'episode 2' : 'wrong'}`)
    // On a middle episode both directions are offered.
    await page.locator('[data-test="episode-prev"]').waitFor()
    await page.locator('[data-test="episode-next"]').waitFor()

    // The last episode offers no "next".
    await page.goto(`${fx.base}/watch/${series.id}?episode=${episodes[2].id}`, { waitUntil: 'networkidle' })
    await page.locator('video').waitFor()
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1, null, { timeout: 20_000 })
    assert.equal(await page.locator('[data-test="episode-next"]').count(), 0, 'no next on the last episode')
    await page.locator('[data-test="episode-prev"]').waitFor()
    report.push('last episode: previous only')

    // Finishing an episode offers the next with a countdown.
    await page.goto(`${fx.base}/watch/${series.id}?episode=${first.id}`, { waitUntil: 'networkidle' })
    await page.locator('video').waitFor()
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1, null, { timeout: 20_000 })
    await page.evaluate(() => {
      const video = document.querySelector('video')
      video.currentTime = Math.max(video.duration - 0.3, 0)
      void video.play()
    })
    await page.locator('[data-test="next-up"]').waitFor({ timeout: 20_000 })
    report.push(`next-up card: ${(await page.locator('[data-test="next-up"]').innerText()).replace(/\s+/g, ' ')}`)
    await page.screenshot({ path: '.test-artifacts/next-up-card.png' })

    // Cancelling keeps the viewer where they are.
    await page.locator('[data-test="next-up-cancel"]').click()
    await page.waitForTimeout(300)
    assert.equal(await page.locator('[data-test="next-up"]').count(), 0, 'cancel dismisses the card')
    assert.ok(new URL(page.url()).searchParams.get('episode') === first.id, 'cancel stays on the finished episode')

    // Letting it run advances to the next episode on its own.
    await page.evaluate(() => {
      const video = document.querySelector('video')
      video.currentTime = Math.max(video.duration - 0.3, 0)
      void video.play()
    })
    await page.locator('[data-test="next-up"]').waitFor({ timeout: 20_000 })
    await page.waitForFunction(second => location.search.includes(second), episodes[1].id, { timeout: 20_000 })
    report.push('countdown advanced to episode 2 by itself')

    await context.close()
  } finally {
    console.log(report.join('\n'))
    await browser.close()
  }
})
