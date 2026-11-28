// The admin list must let several rows be re-classified in one action, and the
// catalogue pager must be right-aligned with first/last shortcuts.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from 'playwright-core'
import { runtimeFixture } from './helpers/runtime.mjs'

test('the list batch-classifies a selection and both pagers sit bottom-right', { timeout: 240_000 }, async (t) => {
  await mkdir('.test-artifacts', { recursive: true })
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  const browser = await chromium.launch({ channel: 'msedge' })
  const report = []
  try {
    await fx.login()
    // 40 films so both the admin list and the catalogue paginate.
    for (let i = 1; i <= 40; i++) {
      await fx.stage(`批量分类${String(i).padStart(2, '0')}.mp4`)
    }
    await fx.scan()

    const [name, value] = fx.cookie().split('=')
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
    await context.addCookies([{ name, value, url: fx.base, httpOnly: true, sameSite: 'Strict' }])
    const page = await context.newPage()
    await page.goto(`${fx.base}/admin`, { waitUntil: 'networkidle' })
    await page.locator('[data-test="admin-media-row"]').first().waitFor()

    // Grid: the list page holds a fixed page of rows.
    assert.equal(await page.locator('[data-test="admin-media-row"]').count(), 7)
    // Select the whole first page and turn it into one series.
    await page.locator('[data-test="admin-select-page"]').check()
    await page.locator('[data-test="admin-batch-bar"]').waitFor()
    report.push(`batch bar: ${(await page.locator('[data-test="admin-batch-bar"]').innerText()).replace(/\s+/g, ' ')}`)
    await page.locator('[data-test="admin-batch-kind"]').selectOption('series')
    await page.locator('[data-test="admin-batch-title"]').fill('批量归剧')
    await page.locator('[data-test="admin-batch-apply"]').click()
    // Either a success banner or an inline error appears.
    await page.locator('[data-test="admin-batch-message"], [data-test="admin-batch-error"]').first().waitFor()
    const errorText = await page.locator('[data-test="admin-batch-error"]').count()
      ? await page.locator('[data-test="admin-batch-error"]').innerText()
      : ''
    report.push(`apply error: ${errorText || '(none)'}`)
    assert.equal(errorText, '', `the batch must apply, got "${errorText}"`)
    report.push(`apply: ${await page.locator('[data-test="admin-batch-message"]').innerText()}`)
    await page.waitForTimeout(600)

    const library = (await (await fx.request('/api/admin/library', { auth: true })).json())
    const series = library.titles.filter(title => title.kind === 'series')
    report.push(`series after: ${series.map(title => title.title).join(', ')}`)
    assert.equal(series.length, 1)
    assert.equal(series[0].title, '批量归剧')
    const detail = await (await fx.request(`/api/library/${series[0].id}`)).json()
    report.push(`episodes: ${detail.episodes.map(e => e.episode).join(',')}`)
    assert.equal(detail.episodes.length, 7)
    await page.screenshot({ path: '.test-artifacts/admin-batch.png' })

    // The admin pager is right-aligned and offers first/last.
    const adminPager = await page.evaluate(() => {
      const bar = document.querySelector('[data-test="admin-files-pager"]')
      const info = bar.querySelector('.pager-info').getBoundingClientRect()
      const controls = bar.querySelector('.pager-controls').getBoundingClientRect()
      return {
        infoLeft: Math.round(info.left),
        controlsRight: Math.round(controls.right),
        barRight: Math.round(bar.getBoundingClientRect().right),
        hasFirst: Boolean(bar.querySelector('[data-test="admin-files-first"]')),
        hasLast: Boolean(bar.querySelector('[data-test="admin-files-last"]')),
      }
    })
    report.push(`admin pager: ${JSON.stringify(adminPager)}`)
    assert.ok(adminPager.hasFirst && adminPager.hasLast)
    assert.ok(adminPager.controlsRight >= adminPager.barRight - 20, 'the controls hug the right edge')
    assert.ok(adminPager.infoLeft < adminPager.controlsRight, 'the count sits to the left')

    // The catalogue lists several cards per row and paginates at the bottom right.
    // Only the films are catalogued, so make sure more than one page remains.
    const published = (await (await fx.request('/api/library/browse?kind=movie&pageSize=60')).json()).total
    report.push(`films in catalogue: ${published}`)
    await page.goto(`${fx.base}/browse?kind=movie`, { waitUntil: 'networkidle' })
    await page.locator('.grid .card').first().waitFor()
    const grid = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.grid .card')]
      const tops = new Set(cards.map(card => Math.round(card.getBoundingClientRect().top)))
      const firstRow = cards.filter(card => Math.round(card.getBoundingClientRect().top) === [...tops][0])
      return { cards: cards.length, columns: firstRow.length }
    })
    report.push(`catalogue grid: ${JSON.stringify(grid)}`)
    assert.ok(grid.columns >= 3, `cards should flow in several columns, got ${grid.columns}`)
    await page.screenshot({ path: '.test-artifacts/browse-grid.png' })

    const pager = await page.evaluate(() => {
      const nav = document.querySelector('[data-test="browse-pager"]')
      if (!nav) return null
      const controls = nav.querySelector('.pager-controls').getBoundingClientRect()
      const navRect = nav.getBoundingClientRect()
      return {
        hasFirst: Boolean(nav.querySelector('[data-test="browse-first"]')),
        hasLast: Boolean(nav.querySelector('[data-test="browse-last"]')),
        hasPrevArrow: Boolean(nav.querySelector('[data-test="browse-prev"]')),
        prevText: nav.querySelector('[data-test="browse-prev"]')?.textContent.trim() ?? '',
        currentBg: getComputedStyle(nav.querySelector('.pager-number.is-current')).backgroundColor,
        rightGap: Math.round(navRect.right - controls.right),
      }
    })
    report.push(`catalogue pager: ${JSON.stringify(pager)}`)
    assert.ok(pager, 'the catalogue pager exists')
    assert.ok(pager.hasFirst && pager.hasLast, 'first/last shortcuts are present')
    assert.equal(pager.prevText, '‹', 'the step is a single arrow')
    assert.ok(pager.rightGap <= 24, `the pager is right-aligned, gap ${pager.rightGap}px`)
    await page.screenshot({ path: '.test-artifacts/browse-pager-new.png' })

    await context.close()
  } finally {
    console.log(report.join('\n'))
    await browser.close()
  }
})
