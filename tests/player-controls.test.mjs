// Two player fixes:
//  1. Touch devices must not show the native control bar, whose scrubber knob and
//     double-tap ripple draw a white dot over the middle of the picture.
//  2. The desktop seek message belongs in the bottom-right corner, never mid-picture.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from 'playwright-core'
import { runtimeFixture } from './helpers/runtime.mjs'

test('touch playback uses our transport, and the desktop notice sits bottom-right', { timeout: 240_000 }, async (t) => {
  await mkdir('.test-artifacts', { recursive: true })
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  const browser = await chromium.launch({ channel: 'msedge' })
  const report = []
  try {
    await fx.login()
    await fx.stage('播放控件.mp4')
    await fx.scan()
    const id = (await (await fx.request('/api/library?kind=movie')).json()).items[0].id

    // --- A phone: our own transport, no native controls ---------------------
    const phone = await browser.newContext({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, locale: 'zh-CN',
    })
    const page = await phone.newPage()
    await page.goto(`${fx.base}/watch/${id}`, { waitUntil: 'networkidle' })
    await page.locator('video').waitFor()
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1, null, { timeout: 20_000 })

    const phoneState = await page.evaluate(() => {
      const video = document.querySelector('video')
      return {
        nativeControls: video.controls,
        transport: document.querySelectorAll('.watch-transport').length,
        track: document.querySelectorAll('[data-test="touch-track"]').length,
      }
    })
    report.push(`phone: ${JSON.stringify(phoneState)}`)
    assert.equal(phoneState.nativeControls, false, 'the native control bar is off on touch')
    assert.equal(phoneState.transport, 1, 'our transport bar is present')
    assert.equal(phoneState.track, 1, 'our scrubber is present')
    await page.screenshot({ path: '.test-artifacts/transport-phone.png' })

    // Playing toggles through our own button and the bar hides itself again.
    await page.locator('[data-test="touch-play"]').tap()
    await page.waitForFunction(() => !document.querySelector('video').paused, null, { timeout: 10_000 })
    report.push('phone play works')
    await page.locator('[data-test="touch-play"]').tap()
    await page.waitForFunction(() => document.querySelector('video').paused, null, { timeout: 10_000 })
    report.push('phone pause works')

    // Tapping the scrubber seeks, and no native knob is drawn.
    const box = await page.locator('[data-test="touch-track"]').boundingBox()
    await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height / 2)
    await page.waitForTimeout(400)
    const seeked = await page.evaluate(() => Number(document.querySelector('video').currentTime.toFixed(1)))
    report.push(`phone scrub -> ${seeked}s of ${await page.evaluate(() => Math.round(document.querySelector('video').duration))}s`)
    assert.ok(seeked > 15, 'tapping the middle of the scrubber seeks forward')
    await page.screenshot({ path: '.test-artifacts/transport-phone-seeked.png' })


    // --- Desktop: the notice is anchored bottom-right, not centred -----------
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
    const desk = await desktop.newPage()
    await desk.goto(`${fx.base}/watch/${id}`, { waitUntil: 'networkidle' })
    await desk.locator('video').waitFor()
    await desk.waitForFunction(() => document.querySelector('video')?.readyState >= 1, null, { timeout: 20_000 })
    const deskState = await desk.evaluate(() => ({
      nativeControls: document.querySelector('video').controls,
      transport: document.querySelectorAll('.watch-transport').length,
    }))
    report.push(`desktop: ${JSON.stringify(deskState)}`)
    assert.equal(deskState.nativeControls, true, 'the desktop keeps the native controls')
    assert.equal(deskState.transport, 0, 'the desktop has no touch transport')

    await desk.locator('body').click({ position: { x: 4, y: 4 } })
    await desk.keyboard.press('ArrowRight')
    await desk.waitForTimeout(300)
    const notice = await desk.evaluate(() => {
      const node = document.querySelector('.watch-seek')
      const stage = document.querySelector('.watch-stage').getBoundingClientRect()
      const rect = node.getBoundingClientRect()
      return {
        text: node.textContent.trim(),
        centreX: rect.x + rect.width / 2,
        centreY: rect.y + rect.height / 2,
        stageCentreX: stage.x + stage.width / 2,
        stageCentreY: stage.y + stage.height / 2,
        rightGap: Math.round(stage.right - rect.right),
        bottomGap: Math.round(stage.bottom - rect.bottom),
      }
    })
    report.push(`desktop notice: ${JSON.stringify(notice)}`)
    assert.match(notice.text, /快进 5 秒/)
    // The critical property: it is nowhere near the middle of the picture.
    const dx = Math.abs(notice.centreX - notice.stageCentreX)
    const dy = Math.abs(notice.centreY - notice.stageCentreY)
    report.push(`offset from centre: ${Math.round(dx)}px, ${Math.round(dy)}px`)
    assert.ok(dx > 150 || dy > 100, `the notice must leave the centre, offset ${Math.round(dx)}/${Math.round(dy)}`)
    assert.ok(notice.rightGap <= 24, `hugs the right edge, gap ${notice.rightGap}px`)
    // It sits above the native control bar rather than on top of it.
    assert.ok(notice.bottomGap >= 40 && notice.bottomGap <= 90, `clears the control bar, gap ${notice.bottomGap}px`)
    await desk.screenshot({ path: '.test-artifacts/notice-bottom-right.png' })

    await phone.close()
    await desktop.close()
  } finally {
    console.log(report.join('\n'))
    await browser.close()
  }
})
