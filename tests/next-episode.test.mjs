// The custom transport steps through a series without returning to the episode list.
// Finishing an episode starts actual playback of the next one after two seconds.
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
    const video = page.locator('.watch-stage video')
    const play = page.locator('[data-test="player-play"]')
    const nextUp = page.locator('[data-test="next-up"]')
    const fullscreen = page.locator('[data-test="player-fullscreen"]')
    async function waitForEpisode(episode, playing = false) {
      await page.waitForURL(url => url.searchParams.get('episode') === episode.id)
      await page.waitForFunction(({ source, playing }) => {
        const player = document.querySelector('.watch-stage video')
        return player && player.currentSrc === new URL(source, location.href).href
          && player.readyState >= 1 && (!playing || (!player.paused && player.currentTime > 0.2))
      }, { source: `/api/media/${encodeURIComponent(episode.media.id)}`, playing }, { timeout: 20_000 })
    }
    async function reachEnd() {
      if (await video.evaluate(node => node.paused)) await play.click()
      await video.evaluate(node => { node.currentTime = node.duration - 0.3 })
      await page.waitForFunction(() => document.querySelector('.watch-stage video')?.ended)
    }
    await waitForEpisode(first)
    assert.equal(await video.evaluate(node => node.paused), true, 'a direct watch link does not autoplay')

    const next = page.locator('.watch-transport-row [data-test="episode-next"]')
    await next.waitFor()
    assert.match(await next.getAttribute('title') ?? '', /下一集/)
    await page.screenshot({ path: '.test-artifacts/episode-nav.png' })

    // Clicking it moves to the second episode; the first episode has no "previous".
    assert.equal(await page.locator('[data-test="episode-prev"]').count(), 0, 'no previous on the first episode')
    const firstVideo = await video.elementHandle()
    await next.click()
    await waitForEpisode(episodes[1], true)
    assert.equal(await firstVideo.evaluate(node => node === document.querySelector('.watch-stage video')), true,
      'switching episodes reuses the video element')
    await firstVideo.dispose()
    report.push('the transport next button started episode 2')
    // On a middle episode both directions are offered.
    await page.locator('[data-test="episode-prev"]').waitFor()
    await page.locator('[data-test="episode-next"]').waitFor()

    // The last episode offers no "next".
    await page.goto(`${fx.base}/watch/${series.id}?episode=${episodes[2].id}`, { waitUntil: 'networkidle' })
    await waitForEpisode(episodes[2])
    assert.equal(await next.count(), 0, 'no next on the last episode')
    await page.locator('[data-test="episode-prev"]').waitFor()
    report.push('last episode: previous only')

    // Finishing an episode offers the next with a two-second countdown.
    await page.goto(`${fx.base}/watch/${series.id}?episode=${first.id}`, { waitUntil: 'networkidle' })
    await waitForEpisode(first)
    await reachEnd()
    await nextUp.waitFor()
    assert.equal((await nextUp.locator('.watch-next-seconds').innerText()).trim(), '2 秒')

    // Cancelling prevents navigation even after the original deadline.
    await page.locator('[data-test="next-up-cancel"]').click()
    await page.waitForTimeout(2200)
    assert.equal(await nextUp.count(), 0, 'cancel dismisses the card')
    assert.equal(new URL(page.url()).searchParams.get('episode'), first.id, 'cancel stays on the finished episode')

    // The next source starts playing automatically without leaving fullscreen.
    await fullscreen.click()
    await page.waitForFunction(() => document.fullscreenElement?.classList.contains('watch-stage'))
    await reachEnd()
    await nextUp.waitFor()
    await page.screenshot({ path: '.test-artifacts/next-up-card.png' })
    await waitForEpisode(episodes[1], true)
    assert.equal(await page.evaluate(() => document.fullscreenElement?.classList.contains('watch-stage')), true)
    report.push('two-second countdown advanced to a playing episode 2 in fullscreen')

    // The "play now" button has the same continuation behavior without waiting.
    await reachEnd()
    await page.locator('[data-test="next-up-play"]').click()
    await waitForEpisode(episodes[2], true)
    await reachEnd()
    assert.equal(await nextUp.count(), 0, 'the last episode stops with no countdown')
    assert.equal(new URL(page.url()).searchParams.get('episode'), episodes[2].id)

    await context.close()
  } finally {
    console.log(report.join('\n'))
    await browser.close()
  }
})
