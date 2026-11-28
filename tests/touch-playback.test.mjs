// Touch playback rules:
//  1. Tapping the picture no longer pauses; only the transport button does.
//  2. Swiping previews the seek and applies it on release, showing the pending
//     position in the bottom-left corner.
//  3. A paused picture shows a pause mark in the middle.
//  4. The next-episode button lives on the left of the transport, not the right.
//  5. Side seeking needs a double tap; a single tap only reveals the controls.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from 'playwright-core'
import { runtimeFixture } from './helpers/runtime.mjs'

async function touchDrag(cdp, box, fromX, toX, y, steps = 6) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: fromX, y, button: 'left', clickCount: 1, buttons: 1, pointerType: 'touch' })
  for (let step = 1; step <= steps; step++) {
    const x = fromX + ((toX - fromX) * step) / steps
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1, pointerType: 'touch' })
    await new Promise(resolve => setTimeout(resolve, 16))
  }
  const samples = []
  return { samples, finish: async () => {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: toX, y, button: 'left', clickCount: 1, buttons: 0, pointerType: 'touch' })
  }, box }
}

test('touch playback: tap does not pause, swipe previews, pause mark, next on the left', { timeout: 240_000 }, async (t) => {
  await mkdir('.test-artifacts', { recursive: true })
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  const browser = await chromium.launch({ channel: 'msedge' })
  const report = []
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
    await page.locator('video').waitFor()
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1, null, { timeout: 20_000 })
    await page.locator('[data-test="touch-play"]').tap()
    await page.waitForFunction(() => !document.querySelector('video').paused, null, { timeout: 10_000 })

    const stage = await page.locator('.watch-stage').boundingBox()
    const midX = stage.x + stage.width / 2
    const midY = stage.y + stage.height * 0.45

    // 1. Tapping the middle must not pause.
    await page.touchscreen.tap(midX, midY)
    await page.waitForTimeout(400)
    const stillPlaying = await page.evaluate(() => !document.querySelector('video').paused)
    report.push(`tap middle keeps playing: ${stillPlaying}`)
    assert.equal(stillPlaying, true, 'a tap must not pause playback')

    // 5. A single tap on a side zone must not seek; a double tap must.
    const beforeSingle = await page.evaluate(() => document.querySelector('video').currentTime)
    await page.touchscreen.tap(stage.x + stage.width * 0.85, midY)
    await page.waitForTimeout(500)
    const afterSingle = await page.evaluate(() => document.querySelector('video').currentTime)
    report.push(`single right tap: ${beforeSingle.toFixed(1)} -> ${afterSingle.toFixed(1)}`)
    assert.ok(Math.abs(afterSingle - beforeSingle) < 3, 'one tap on a side must not seek')

    await page.touchscreen.tap(stage.x + stage.width * 0.85, midY)
    await page.touchscreen.tap(stage.x + stage.width * 0.85, midY)
    await page.waitForTimeout(500)
    const afterDouble = await page.evaluate(() => document.querySelector('video').currentTime)
    report.push(`double right tap: ${afterSingle.toFixed(1)} -> ${afterDouble.toFixed(1)}`)
    assert.ok(afterDouble - afterSingle >= 4, 'a double tap on the right seeks forward by 5s')

    // 4. The next-episode button sits on the left side of the transport.
    const nextBox = await page.locator('[data-test="touch-next"]').boundingBox()
    const playBox = await page.locator('[data-test="touch-play"]').boundingBox()
    const trackBox = await page.locator('[data-test="touch-track"]').boundingBox()
    report.push(`next x=${Math.round(nextBox.x)} play x=${Math.round(playBox.x)} track x=${Math.round(trackBox.x)}`)
    assert.ok(nextBox.x < trackBox.x, 'the next button is left of the scrubber')
    assert.ok(nextBox.x < stage.x + stage.width * 0.5, 'the next button is on the left half')
    // 2. Swiping shows a pending position in the bottom-left and commits on release.
    const cdp = await phone.newCDPSession(page)
    const y = stage.y + stage.height * 0.45
    const startTime = await page.evaluate(() => document.querySelector('video').currentTime)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: stage.x + stage.width * 0.35, y, button: 'left', clickCount: 1, buttons: 1, pointerType: 'touch' })
    for (const ratio of [0.45, 0.55, 0.65, 0.75]) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: stage.x + stage.width * ratio, y, button: 'left', buttons: 1, pointerType: 'touch' })
      await page.waitForTimeout(20)
    }
    const preview = await page.locator('[data-test="scrub-preview"]')
    await preview.waitFor({ timeout: 5000 })
    const previewBox = await preview.boundingBox()
    const previewText = (await preview.innerText()).replace(/\s+/g, ' ').trim()
    report.push(`preview: "${previewText}" at x=${Math.round(previewBox.x)}`)
    assert.ok(previewBox.x < stage.x + stage.width * 0.5, 'the pending position is in the left half')
    // It must sit inside the picture and clear of the transport bar along the bottom.
    assert.ok(previewBox.y >= stage.y, 'the preview stays inside the picture')
    assert.ok(previewBox.y + previewBox.height <= stage.y + stage.height - 40, 'the preview clears the transport bar')
    assert.match(previewText, /\+\d+ 秒|−\d+ 秒/, 'the preview shows the delta')
    // The video must not have jumped yet, so playback stays smooth.
    const duringSwipe = await page.evaluate(() => document.querySelector('video').currentTime)
    report.push(`during swipe: ${duringSwipe.toFixed(1)} (started ${startTime.toFixed(1)})`)
    assert.ok(Math.abs(duringSwipe - startTime) < 12, 'the seek is not committed mid-swipe')
    await page.screenshot({ path: '.test-artifacts/touch-swipe-preview.png' })

    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: stage.x + stage.width * 0.75, y, button: 'left', clickCount: 1, buttons: 0, pointerType: 'touch' })
    await page.waitForTimeout(600)
    const afterSwipe = await page.evaluate(() => document.querySelector('video').currentTime)
    report.push(`after release: ${afterSwipe.toFixed(1)}`)
    assert.ok(afterSwipe > startTime + 8, 'releasing the swipe commits the seek')
    assert.equal(await page.locator('[data-test="scrub-preview"]').count(), 0, 'the preview disappears')
    await cdp.detach()

    // 3. Pausing (via the button only) shows a mark in the middle.
    await page.locator('[data-test="touch-play"]').tap()
    await page.waitForFunction(() => document.querySelector('video').paused, null, { timeout: 10_000 })
    await page.waitForTimeout(400)
    const mark = await page.locator('[data-test="paused-mark"]').boundingBox()
    report.push(`paused mark: ${JSON.stringify(mark ? { x: Math.round(mark.x), y: Math.round(mark.y) } : null)}`)
    assert.ok(mark, 'a paused picture shows a pause mark')
    const markCentreX = mark.x + mark.width / 2
    const markCentreY = mark.y + mark.height / 2
    assert.ok(Math.abs(markCentreX - (stage.x + stage.width / 2)) < 40, 'the mark is centred horizontally')
    assert.ok(Math.abs(markCentreY - (stage.y + stage.height / 2)) < 40, 'the mark is centred vertically')
    await page.screenshot({ path: '.test-artifacts/touch-paused.png' })

    await phone.close()
  } finally {
    console.log(report.join('\n'))
    await browser.close()
  }
})
