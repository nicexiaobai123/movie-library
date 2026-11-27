// Guards the detail action row: the play button and the favourite button must sit
// on one baseline at desktop width, with the signed-out hint underneath them.
import assert from 'node:assert/strict'
import { copyFile, mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from 'playwright-core'
import { runtimeFixture, sample, waitFor } from './helpers/runtime.mjs'

test('detail action buttons share one baseline', { timeout: 120_000 }, async (t) => {
  await mkdir('.test-artifacts', { recursive: true })
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  const browser = await chromium.launch({ channel: 'msedge' })
  try {
    await fx.login()
    await copyFile(sample, `${fx.media}/对齐测试 (2024).mp4`)
    await fx.scan()
    await new Promise(resolve => setTimeout(resolve, 400))
    await fx.scan()
    await fx.scan()
    const film = await waitFor(async () => {
      const items = (await (await fetch(`${fx.base}/api/library`)).json()).items
      return items[0] ?? false
    }, 'film was not indexed', 30_000)

    const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, locale: 'zh-CN' })
    await page.goto(`${fx.base}/movie/${film.id}`, { waitUntil: 'networkidle' })
    await page.locator('[data-test="title-favorite"]').waitFor()
    await page.waitForTimeout(400)

    const metrics = await page.evaluate(() => {
      const box = (selector) => {
        const node = document.querySelector(selector)
        if (!node) return null
        const rect = node.getBoundingClientRect()
        return { top: rect.top, height: rect.height, bottom: rect.bottom }
      }
      return { play: box('.detail-btn'), favorite: box('[data-test="title-favorite"]'), note: box('.favorite-note') }
    })

    assert.ok(metrics.play && metrics.favorite, 'both actions must render')
    const topDelta = Math.abs(metrics.play.top - metrics.favorite.top)
    const heightDelta = Math.abs(metrics.play.height - metrics.favorite.height)
    console.log(`top delta ${topDelta.toFixed(2)}px, height delta ${heightDelta.toFixed(2)}px`)
    assert.ok(topDelta <= 0.5, `buttons must share a baseline, off by ${topDelta.toFixed(2)}px`)
    assert.ok(heightDelta <= 0.5, `buttons must share a height, off by ${heightDelta.toFixed(2)}px`)

    // The hint belongs below the row, not floating beside the buttons.
    if (metrics.note) {
      assert.ok(metrics.note.top >= metrics.play.bottom - 0.5, 'the hint must sit under the buttons')
    }
    await page.screenshot({ path: '.test-artifacts/detail-actions.png', clip: { x: 0, y: 0, width: 1200, height: 700 } })
  } finally {
    await browser.close()
  }
})
