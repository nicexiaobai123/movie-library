// The home page lists sections as flat grids with a "more" link to the catalogue,
// instead of sideways-scrolling rails.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from 'playwright-core'
import { runtimeFixture } from './helpers/runtime.mjs'

test('home shows grid sections with a more link instead of scroll rails', { timeout: 240_000 }, async (t) => {
  await mkdir('.test-artifacts', { recursive: true })
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  const browser = await chromium.launch({ channel: 'msedge' })
  const report = []
  try {
    await fx.login()
    for (let i = 1; i <= 9; i++) await fx.stage(`首页网格${String(i).padStart(2, '0')}.mp4`)
    for (let i = 1; i <= 4; i++) await fx.stage(`首页剧集${String(i).padStart(2, '0')} 第1集.mp4`)
    await fx.scan()

    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
    const page = await context.newPage()
    await page.goto(fx.base, { waitUntil: 'networkidle' })
    await page.locator('.rail-grid').first().waitFor({ timeout: 20_000 })

    // No horizontal scroller anywhere: the old rails are gone.
    const scrolling = await page.evaluate(() => [...document.querySelectorAll('.rail-track, .rail-btn')].length)
    report.push(`leftover scroll elements: ${scrolling}`)
    assert.equal(scrolling, 0, 'the scrolling rail is gone')

    const rails = await page.evaluate(() => [...document.querySelectorAll('.rail')].map((rail) => {
      const head = rail.querySelector('.rail-head')
      const more = rail.querySelector('.rail-more')
      const grid = rail.querySelector('.rail-grid')
      const cards = [...grid.querySelectorAll('.card')]
      const tops = new Set(cards.map(card => Math.round(card.getBoundingClientRect().top)))
      const firstRow = cards.filter(card => Math.round(card.getBoundingClientRect().top) === [...tops][0])
      const overflows = grid.scrollWidth > grid.clientWidth + 2
      // A short section keeps its cards left-aligned, so check the link against the
      // rightmost column of the grid rather than the last card present.
      const gridStyle = getComputedStyle(grid)
      const columns = gridStyle.gridTemplateColumns.trim().split(/\s+/).length
      const gridRect = grid.getBoundingClientRect()
      const padRight = parseFloat(gridStyle.paddingRight)
      return {
        title: rail.querySelector('.section-title')?.textContent?.trim(),
        moreText: more?.textContent?.replace(/\s+/g, ' ').trim(),
        moreHref: more?.getAttribute('href'),
        cards: cards.length,
        columns: firstRow.length,
        gridColumns: columns,
        overflows,
        moreRightAligned: Math.abs(more.getBoundingClientRect().right - (gridRect.right - padRight)) < 4,
      }
    }))
    for (const rail of rails) report.push(JSON.stringify(rail))
    assert.ok(rails.length >= 2, 'the page has sections')
    for (const rail of rails) {
      assert.ok(rail.cards > 0, `${rail.title} shows cards`)
      assert.equal(rail.overflows, false, `${rail.title} does not scroll sideways`)
      assert.ok(rail.columns >= 2, `${rail.title} lays cards out in columns, saw ${rail.columns}`)
      assert.match(rail.moreText ?? '', /更多/, `${rail.title} has a more link`)
      assert.ok(rail.moreHref, `${rail.title} more link has a destination`)
      assert.ok(rail.moreRightAligned, `${rail.title} more link is on the right`)
    }
    // The series section must have the 4 series, and link to the series tab.
    const seriesRail = rails.find(rail => rail.title?.includes('剧集'))
    report.push(`series rail: ${JSON.stringify(seriesRail)}`)
    assert.ok(seriesRail, 'the series section exists')
    assert.match(seriesRail.moreHref ?? '', /kind=series/)
    await page.screenshot({ path: '.test-artifacts/home-grid.png' })

    // "更多" navigates to the catalogue.
    await page.locator('[data-test="rail-more"]').nth(1).click()
    await page.waitForURL(url => url.pathname === '/browse', { timeout: 15_000 })
    report.push(`more went to: ${new URL(page.url()).pathname}${new URL(page.url()).search}`)
    assert.match(page.url(), /\/browse/)

    // And the narrow viewport still reflows without overflow.
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(fx.base, { waitUntil: 'networkidle' })
    await page.locator('.rail-grid').first().waitFor({ timeout: 20_000 })
    const narrow = await page.evaluate(() => {
      const grid = document.querySelector('.rail-grid')
      const cards = [...grid.querySelectorAll('.card')]
      const tops = new Set(cards.map(card => Math.round(card.getBoundingClientRect().top)))
      return {
        columns: cards.filter(card => Math.round(card.getBoundingClientRect().top) === [...tops][0]).length,
        overflowX: document.documentElement.scrollWidth > innerWidth + 1,
        gridOverflow: grid.scrollWidth > grid.clientWidth + 2,
      }
    })
    report.push(`narrow: ${JSON.stringify(narrow)}`)
    assert.equal(narrow.overflowX, false, 'no horizontal page overflow on a phone')
    assert.equal(narrow.gridOverflow, false, 'the grid itself does not overflow')
    assert.ok(narrow.columns >= 2, 'cards still sit in columns on a phone')
    await page.screenshot({ path: '.test-artifacts/home-grid-phone.png' })

    await context.close()
  } finally {
    console.log(report.join('\n'))
    await browser.close()
  }
})
