import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from 'playwright-core'
import { runtimeFixture } from './helpers/runtime.mjs'

const control = id => `[data-test="${id}"]`

function waitForTransport(page, visible) {
  return page.waitForFunction(expected => {
    const bar = document.querySelector('.watch-transport')
    if (!bar) return false
    const style = getComputedStyle(bar)
    const visible = style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) > 0.9
    const hidden = style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.1
    return expected ? visible : hidden
  }, visible, { timeout: 10_000 })
}

test('Edge touch: tap reveals controls, double tap seeks, swipe previews, and fullscreen keeps the custom player', { timeout: 240_000 }, async t => {
  await mkdir('.test-artifacts', { recursive: true })
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  const browser = await chromium.launch({ channel: 'msedge' })
  try {
    await fx.login()
    for (let i = 1; i <= 2; i++) await fx.stage(`触屏规则 第${i}集.mp4`)
    await fx.scan()
    const series = (await (await fx.request('/api/library?kind=series')).json()).items[0]
    const detail = await (await fx.request(`/api/library/${series.id}`)).json()
    const first = [...detail.episodes].sort((a, b) => a.episode - b.episode)[0]

    const phone = await browser.newContext({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, locale: 'zh-CN',
    })
    const page = await phone.newPage()
    await page.goto(`${fx.base}/watch/${series.id}?episode=${first.id}`, { waitUntil: 'networkidle' })
    const video = page.locator('video')
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1, null, { timeout: 20_000 })
    const stage = page.locator('.watch-stage')
    const box = await stage.boundingBox()
    assert.ok(box, 'the stage is visible')
    const x = ratio => box.x + box.width * ratio
    const y = box.y + box.height * 0.45
    const play = stage.locator(control('player-play'))
    await play.tap()
    await page.waitForFunction(() => !document.querySelector('video').paused)
    await waitForTransport(page, false)

    // A lone tap on a side zone brings back the transport without pausing or seeking.
    const beforeSingle = await video.evaluate(node => node.currentTime)
    await page.touchscreen.tap(x(0.85), y)
    await waitForTransport(page, true)
    const afterSingle = await video.evaluate(node => ({ paused: node.paused, time: node.currentTime }))
    assert.equal(afterSingle.paused, false, 'a touch on the picture does not pause playback')
    assert.ok(Math.abs(afterSingle.time - beforeSingle) < 3, 'one tap on a side zone does not seek')
    assert.equal(await stage.locator('.watch-seek').filter({ hasText: '快进' }).count(), 0)

    await waitForTransport(page, false)
    const beforeDouble = await video.evaluate(node => node.currentTime)
    const bar = stage.locator('.watch-transport')
    await page.touchscreen.tap(x(0.85), y)
    assert.ok(await bar.evaluate(node => node.classList.contains('is-hidden')), 'the first tap of a possible double tap does not wake the bar')
    await page.touchscreen.tap(x(0.85), y)
    const forward = stage.locator('.watch-seek').filter({ hasText: /快进\s*5\s*秒/ })
    await forward.locator('svg').waitFor({ timeout: 5000 })
    assert.ok(await bar.evaluate(node => node.classList.contains('is-hidden')), 'double tap seeks without revealing the transport')
    const afterDouble = await video.evaluate(node => node.currentTime)
    assert.ok(afterDouble - beforeDouble >= 4.8 && afterDouble - beforeDouble <= 6.5,
      `double tap advances five seconds (${beforeDouble.toFixed(2)} -> ${afterDouble.toFixed(2)})`)

    // On touch, Next stays next to play in the left group underneath the track.
    const next = stage.locator(`.watch-transport-row ${control('episode-next')}`)
    const [nextBox, playBox, trackBox] = await Promise.all([
      next.boundingBox(), play.boundingBox(), stage.locator(control('player-track')).boundingBox(),
    ])
    assert.ok(nextBox && playBox && trackBox, 'transport controls are present')
    assert.ok(nextBox.x >= playBox.x + playBox.width - 1 && nextBox.x + nextBox.width <= x(0.5), 'Next sits after play in the left group')
    assert.ok(nextBox.y >= trackBox.y + trackBox.height - 1, 'Next is below the progress track')

    // Send a genuine horizontal touch gesture and keep the finger down while checking the preview.
    const cdp = await phone.newCDPSession(page)
    const startTime = await video.evaluate(node => node.currentTime)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x(0.25), y }] })
    for (const ratio of [0.35, 0.45, 0.55, 0.65, 0.75]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x(ratio), y }] })
    }
    const preview = stage.locator(control('scrub-preview'))
    await preview.waitFor({ timeout: 5000 })
    assert.ok(await bar.evaluate(node => node.classList.contains('is-hidden')), 'swiping previews without revealing the transport')
    const previewBox = await preview.boundingBox()
    assert.ok(previewBox && previewBox.x < x(0.5) && previewBox.y >= box.y, 'the pending position appears inside the left half')
    assert.ok(previewBox.y + previewBox.height <= trackBox.y + 1, 'the preview clears the transport')
    assert.match((await preview.innerText()).replace(/\s+/g, ' '), /\+\d+ 秒/, 'the preview shows a forward delta')
    const duringSwipe = await video.evaluate(node => node.currentTime)
    assert.ok(Math.abs(duringSwipe - startTime) < 5, 'the seek is not committed while swiping')
    await page.screenshot({ path: '.test-artifacts/touch-swipe-preview.png' })

    const beforeRelease = await video.evaluate(node => node.currentTime)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await preview.waitFor({ state: 'hidden' })
    const afterSwipe = await video.evaluate(node => node.currentTime)
    assert.ok(afterSwipe - beforeRelease >= 8 && afterSwipe - beforeRelease <= 13, 'releasing the swipe commits its seek')
    assert.ok(await bar.evaluate(node => node.classList.contains('is-hidden')), 'releasing the swipe keeps the transport hidden')
    await cdp.detach()

    await page.touchscreen.tap(x(0.5), y)
    await waitForTransport(page, true)
    await play.tap()
    await page.waitForFunction(() => document.querySelector('video').paused)
    const mark = stage.locator(`.watch-paused-mark${control('paused-mark')}`)
    await mark.locator('svg').waitFor()
    const markBox = await mark.boundingBox()
    assert.ok(markBox && Math.abs(markBox.x + markBox.width / 2 - x(0.5)) < 20
      && Math.abs(markBox.y + markBox.height / 2 - (box.y + box.height / 2)) < 20, 'the touch play overlay is centred')
    await page.screenshot({ path: '.test-artifacts/touch-paused.png' })

    const fullscreen = stage.locator(`.watch-transport ${control('player-fullscreen')}`)
    await fullscreen.tap()
    await page.waitForFunction(() => document.fullscreenElement === document.querySelector('.watch-stage'))
    await waitForTransport(page, true)
    assert.ok(await mark.isVisible(), 'the paused overlay remains visible in fullscreen')
    await fullscreen.tap()
    await page.waitForFunction(() => document.fullscreenElement === null)
    await phone.close()
  } finally {
    await browser.close()
  }
})
