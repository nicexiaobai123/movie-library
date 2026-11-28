// Cards must always show their name: a first-frame cover is a picture of the video,
// so it cannot stand in for the title the way a designed poster does.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from 'playwright-core'
import { runtimeFixture } from './helpers/runtime.mjs'

test('every card shows its title, including series with a first-frame cover', { timeout: 180_000 }, async (t) => {
  await mkdir('.test-artifacts', { recursive: true })
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  const browser = await chromium.launch({ channel: 'msedge' })
  const report = []
  try {
    await fx.login()
    for (const name of ['谋一世锦绣 第1集.mp4', '谋一世锦绣 第2集.mp4', '无声的片名 (2021).mp4']) {
      await fx.stage(name)
    }
    await fx.scan()

    const [name, value] = fx.cookie().split('=')
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
    await context.addCookies([{ name, value, url: fx.base, httpOnly: true, sameSite: 'Strict' }])
    const page = await context.newPage()

    for (const path of ['/browse?kind=movie', '/browse?kind=series', '/']) {
      await page.goto(`${fx.base}${path}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(600)
      const cards = await page.evaluate(() => [...document.querySelectorAll('.card')].map((card) => {
        const title = card.querySelector('.card-title')
        const rect = title?.getBoundingClientRect()
        return {
          title: title?.textContent?.trim() ?? '',
          visible: Boolean(rect && rect.height > 2 && rect.width > 2),
          poster: Boolean(card.querySelector('.card-frame img')),
        }
      }))
      const withTitle = cards.filter(card => card.title && card.visible)
      report.push(`${path}: ${withTitle.length}/${cards.length} cards show a title`)
      if (cards.length) assert.equal(withTitle.length, cards.length, `every card needs its title on ${path}`)
      if (path === '/browse?kind=series') {
        assert.ok(cards.some(card => card.title === '谋一世锦绣'), 'the series name is shown')
        // The series tag still marks the kind.
        const kinds = await page.locator('.card-kind').allTextContents()
        assert.ok(kinds.includes('剧集'))
      }
    }

    await page.goto(`${fx.base}/browse?kind=series`, { waitUntil: 'networkidle' })
    await page.screenshot({ path: '.test-artifacts/cards-with-titles.png' })
    await context.close()
  } finally {
    console.log(report.join('\n'))
    await browser.close()
  }
})
