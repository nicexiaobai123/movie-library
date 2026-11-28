// Desktop player rules:
//   - episode stepping is a button in the action bar, not a floating overlay;
//   - a paused video shows the pause mark in the middle;
//   - the arrow keys step five seconds.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from 'playwright-core'
import { runtimeFixture } from './helpers/runtime.mjs'

test('desktop: action-bar episode buttons, centred pause mark, 5s arrow keys', { timeout: 240_000 }, async (t) => {
  await mkdir('.test-artifacts', { recursive: true })
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  const browser = await chromium.launch({ channel: 'msedge' })
  const report = []
  try {
    await fx.login()
    for (let i = 1; i <= 3; i++) await fx.stage(`桌面控件 第${i}集.mp4`)
    await fx.scan()
    const series = (await (await fx.request('/api/library?kind=series')).json()).items[0]
    const detail = await (await fx.request(`/api/library/${series.id}`)).json()
    const middle = [...detail.episodes].sort((a, b) => a.episode - b.episode)[1]

    const [name, value] = fx.cookie().split('=')
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
    await context.addCookies([{ name, value, url: fx.base, httpOnly: true, sameSite: 'Strict' }])
    const page = await context.newPage()
    await page.goto(`${fx.base}/watch/${series.id}?episode=${middle.id}`, { waitUntil: 'networkidle' })
    await page.locator('video').waitFor()
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1, null, { timeout: 20_000 })

    // 1. Both step buttons float over the picture's bottom-left corner, above the
    //    native control bar, rather than sitting in the action row.
    const prevBox = await page.locator('[data-test="episode-prev"]').boundingBox()
    const nextBox = await page.locator('[data-test="episode-next"]').boundingBox()
    const stageBox = await page.locator('.watch-stage').boundingBox()
    report.push(`prev=${JSON.stringify(prevBox && { x: Math.round(prevBox.x), y: Math.round(prevBox.y) })} next=${JSON.stringify(nextBox && { x: Math.round(nextBox.x), y: Math.round(nextBox.y) })}`)
    assert.ok(prevBox && nextBox, 'both step buttons exist on a middle episode')
    for (const [label, box] of [['previous', prevBox], ['next', nextBox]]) {
      assert.ok(box.x - stageBox.x < 140, `the ${label} button hugs the left edge`)
      assert.ok(stageBox.y + stageBox.height - (box.y + box.height) < 140, `the ${label} button floats near the bottom`)
      assert.ok(box.y > stageBox.y, `the ${label} button sits over the picture`)
    }
    // It is an overlay, not a row in the action bar.
    assert.equal(await page.locator('.watch-actions [data-test="episode-next"]').count(), 0, 'it is not in the action bar')
    assert.equal(await page.locator('.watch-step-overlay').count(), 1, 'it is rendered as an overlay')

    // The label is a tooltip, not visible text on the control.
    const title = await page.locator('[data-test="episode-next"]').getAttribute('title')
    report.push(`next tooltip: ${title}`)
    assert.match(title ?? '', /下一集：第 \d+ 季第 \d+ 集/)

    // 3. The pause mark is centred while paused, on desktop too.
    await page.evaluate(() => document.querySelector('video').play())
    await page.waitForFunction(() => !document.querySelector('video').paused, null, { timeout: 10_000 })
    await page.waitForTimeout(300)
    assert.equal(await page.locator('[data-test="paused-mark"]').count(), 0, 'no mark while playing')
    await page.evaluate(() => document.querySelector('video').pause())
    await page.locator('[data-test="paused-mark"]').waitFor({ timeout: 10_000 })
    const mark = await page.locator('[data-test="paused-mark"]').boundingBox()
    const stage = await page.locator('.watch-stage').boundingBox()
    const dx = Math.abs(mark.x + mark.width / 2 - (stage.x + stage.width / 2))
    const dy = Math.abs(mark.y + mark.height / 2 - (stage.y + stage.height / 2))
    report.push(`pause mark offset from centre: ${Math.round(dx)}px, ${Math.round(dy)}px`)
    assert.ok(dx < 30 && dy < 30, 'the pause mark is centred on the picture')
    await page.screenshot({ path: '.test-artifacts/desktop-paused.png' })

    // 4. The arrow keys step five seconds.
    await page.locator('body').click({ position: { x: 4, y: 4 } })
    const before = await page.evaluate(() => document.querySelector('video').currentTime)
    await page.keyboard.press('ArrowRight')
    await page.waitForFunction(base => document.querySelector('video').currentTime > base + 3, before, { timeout: 5_000 })
    const afterRight = await page.evaluate(() => document.querySelector('video').currentTime)
    report.push(`ArrowRight: ${before.toFixed(1)} -> ${afterRight.toFixed(1)}`)
    assert.ok(afterRight - before >= 4 && afterRight - before <= 6, 'the key steps five seconds')
    await page.keyboard.press('ArrowLeft')
    await page.waitForFunction(base => document.querySelector('video').currentTime < base - 3, afterRight, { timeout: 5_000 })
    const afterLeft = await page.evaluate(() => document.querySelector('video').currentTime)
    report.push(`ArrowLeft: ${afterRight.toFixed(1)} -> ${afterLeft.toFixed(1)}`)
    assert.ok(afterRight - afterLeft >= 4 && afterRight - afterLeft <= 6, 'the key steps back five seconds')

    await context.close()
  } finally {
    console.log(report.join('\n'))
    await browser.close()
  }
})
