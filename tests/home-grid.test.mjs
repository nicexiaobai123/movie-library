import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from 'playwright-core'
import { assertStatus, runtimeFixture } from './helpers/runtime.mjs'

const sections = [
  { title: '电影', kind: 'movie', field: 'movies' },
  { title: '剧集', kind: 'series', field: 'series' },
]

test('home previews only movies and series in up to two rows and links to their tabs', { timeout: 240_000 }, async (t) => {
  await mkdir('.test-artifacts', { recursive: true })
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  const browser = await chromium.launch({ channel: 'msedge' })
  try {
    await fx.login()
    // Both sections have enough titles to exceed even the widest preview.
    for (let i = 1; i <= 16; i++) {
      const ordinal = String(i).padStart(2, '0')
      await fx.stage(`首页电影${ordinal}.mp4`)
      await fx.stage(`首页剧集${ordinal} 第1集.mp4`)
    }
    await fx.scan()
    const home = await (await assertStatus(await fx.request('/api/library/home'), 200)).json()

    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
    await page.goto(fx.base, { waitUntil: 'networkidle' })
    await page.getByRole('region', { name: '推荐影片' }).waitFor()
    const rails = page.locator('.home .rail')
    assert.deepEqual(await rails.getByRole('heading', { level: 2 }).allTextContents(), ['电影', '剧集'])
    for (const title of ['最新入库', '全部馆藏']) {
      assert.equal(await page.getByRole('heading', { name: title, exact: true }).count(), 0)
    }

    for (const [width, columns] of [[1440, 7], [900, 5], [700, 4], [390, 2]]) {
      await page.setViewportSize({ width, height: 1000 })
      const summaries = await rails.evaluateAll(rails => rails.map((rail) => {
        const more = rail.querySelector('.rail-more')
        const grid = rail.querySelector('.rail-grid')
        const cards = [...grid.querySelectorAll('.card')].filter(card => card.getClientRects().length)
        const rows = new Map()
        for (const card of cards) {
          const top = Math.round(card.getBoundingClientRect().top)
          rows.set(top, (rows.get(top) ?? 0) + 1)
        }
        return {
          rows: [...rows.values()],
          hrefs: cards.map(card => card.getAttribute('href')),
          overflows: grid.scrollWidth > grid.clientWidth + 2,
          moreRightAligned: Math.abs(more.getBoundingClientRect().right - (
            grid.getBoundingClientRect().right - parseFloat(getComputedStyle(grid).paddingRight)
          )) < 4,
        }
      }))
      assert.equal(summaries.length, sections.length)
      for (const [i, { title, field }] of sections.entries()) {
        const summary = summaries[i]
        assert.deepEqual(summary.rows, [columns, columns], `${title} at ${width}px`)
        assert.deepEqual(summary.hrefs, home[field].slice(0, columns * 2).map(item => `/movie/${encodeURIComponent(item.id)}`))
        assert.equal(summary.overflows, false, `${title} does not scroll sideways at ${width}px`)
        assert.equal(summary.moreRightAligned, true, `${title} link aligns with the grid at ${width}px`)
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no page overflow at ${width}px`)
      if (width === 1440 || width === 390) {
        await page.screenshot({ path: `.test-artifacts/home-grid${width === 390 ? '-phone' : ''}.png` })
      }
    }

    await page.setViewportSize({ width: 1440, height: 1000 })
    for (const { title, kind } of sections) {
      await page.goto(fx.base, { waitUntil: 'networkidle' })
      const section = page.getByRole('region', { name: title, exact: true })
      const more = section.getByRole('link', { name: `查看全部${title}` })
      assert.equal((await more.textContent()).trim(), '更多')
      assert.equal(await more.getAttribute('href'), `/browse?kind=${kind}`)
      await Promise.all([page.waitForURL(`${fx.base}/browse?kind=${kind}`), more.click()])
      await page.getByRole('heading', { name: title, level: 1, exact: true }).waitFor()
      assert.equal(await page.locator('.nav-links .nav-link.is-active').textContent(), title)
    }
  } finally {
    await browser.close()
  }
})
