// The editor dialog: no inner scrollbar on the panel itself, a footer that is always
// visible, and the year field is gone from the common fields.
import assert from 'node:assert/strict'
import { copyFile, mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from 'playwright-core'
import { runtimeFixture, sample, waitFor } from './helpers/runtime.mjs'

test('editor dialog has no scrollbar and keeps its actions visible', { timeout: 180_000 }, async (t) => {
  await mkdir('.test-artifacts', { recursive: true })
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  const browser = await chromium.launch({ channel: 'msedge' })
  const report = []
  try {
    await fx.login()
    await copyFile(sample, `${fx.media}/弹窗测试 (2022).mp4`)
    await fx.scan()
    await new Promise(resolve => setTimeout(resolve, 400))
    await fx.scan()
    await fx.scan()
    await waitFor(async () => {
      const data = await (await fetch(`${fx.base}/api/library/browse?pageSize=1`)).json()
      return (data.total ?? 0) >= 1 ? data : false
    }, 'not indexed', 30_000)

    const page = await browser.newPage({ viewport: { width: 1440, height: 800 }, locale: 'zh-CN' })
    await page.goto(`${fx.base}/admin/login`, { waitUntil: 'networkidle' })
    await page.locator('[data-test="admin-login-username"]').fill(fx.username)
    await page.locator('[data-test="admin-login-password"]').fill(fx.password)
    await Promise.all([
      page.waitForURL(`${fx.base}/admin`),
      page.locator('[data-test="admin-login-submit"]').click(),
    ])
    await page.locator('[data-test="admin-tab-files"]').click()
    // The default filter is "pending", so switch to "all" to reach a published row.
    await page.locator('[data-test="admin-filter-all"]').click()
    await page.locator('[data-test="admin-media-edit"]').first().click()
    await page.locator('[data-test="admin-media-modal"]').waitFor()

    const shape = await page.evaluate(() => {
      const panel = document.querySelector('[data-test="admin-media-editor"]')
      const footer = panel.querySelector('.editor-footer')
      const save = panel.querySelector('[data-test="admin-media-save"]')
      const p = panel.getBoundingClientRect()
      const s = save.getBoundingClientRect()
      // `scrollTop` can be assigned even on an overflow:hidden element, so it does not
      // prove a scrollbar. A rendered scrollbar reduces clientHeight below the border
      // box; a 2px border alone does not.
      return {
        panelOverflowY: getComputedStyle(panel).overflowY,
        panelScrollbarInset: Math.round(panel.offsetHeight - panel.clientHeight),
        footerVisible: footer.getBoundingClientRect().bottom <= innerHeight + 1,
        saveVisible: s.top >= 0 && s.bottom <= innerHeight,
        saveInsidePanel: s.bottom <= p.bottom + 1,
        panelHeight: Math.round(p.height),
      }
    })
    report.push(`dialog: ${JSON.stringify(shape)}`)
    assert.equal(shape.panelOverflowY, 'hidden', 'the panel clips instead of scrolling')
    assert.ok(shape.panelScrollbarInset <= 2, `no scrollbar inset on the dialog, got ${shape.panelScrollbarInset}px`)
    assert.ok(shape.saveVisible, 'the save button must be visible without scrolling')

    // The year field moved into the optional block, so it is absent up front.
    const upfront = await page.evaluate(() => {
      const panel = document.querySelector('[data-test="admin-media-editor"]')
      const year = panel.querySelector('[data-test="admin-media-year"]')
      const cast = panel.querySelector('[data-test="admin-media-cast"]')
      const kind = panel.querySelector('[data-test="admin-media-kind"]')
      return {
        yearPresent: Boolean(year),
        yearInDetails: year ? Boolean(year.closest('details')) : null,
        castVisible: cast.getBoundingClientRect().height > 0,
        kindVisible: kind.getBoundingClientRect().height > 0,
      }
    })
    report.push(`fields: ${JSON.stringify(upfront)}`)
    assert.ok(upfront.castVisible && upfront.kindVisible, 'cast and kind stay in the common area')
    await page.screenshot({ path: '.test-artifacts/editor-dialog.png', fullPage: false })

    // Expanding "more" keeps the footer pinned and introduces no panel scrollbar.
    await page.locator('[data-test="admin-media-more"] summary').click()
    await page.waitForTimeout(400)
    const expanded = await page.evaluate(() => {
      const panel = document.querySelector('[data-test="admin-media-editor"]')
      const save = panel.querySelector('[data-test="admin-media-save"]')
      const fields = panel.querySelector('.editor-fields')
      const s = save.getBoundingClientRect()
      return {
        // The panel keeps its size; only the field list absorbs the extra content.
        panelScrollbarInset: Math.round(panel.offsetHeight - panel.clientHeight),
        panelHeight: Math.round(panel.getBoundingClientRect().height),
        fieldsScroll: fields.scrollHeight > fields.clientHeight + 1,
        fieldsScrollable: getComputedStyle(fields).overflowY,
        saveVisible: s.top >= 0 && s.bottom <= innerHeight,
      }
    })
    report.push(`expanded: ${JSON.stringify(expanded)}`)
    assert.ok(expanded.panelScrollbarInset <= 2, 'the panel gains no scrollbar when expanded')
    // The panel may grow up to its max height, but never beyond the viewport.
    assert.ok(expanded.panelHeight <= 900, 'the panel stays inside the viewport')
    assert.equal(expanded.fieldsScrollable, 'auto', 'the field list owns the scrolling')
    assert.ok(expanded.fieldsScroll, 'the field list scrolls once the optional block is open')
    assert.ok(expanded.saveVisible, 'the save button stays visible after expanding')
    await page.screenshot({ path: '.test-artifacts/editor-dialog-expanded.png', fullPage: false })
  } finally {
    console.log(report.join('\n'))
    await browser.close()
  }
})
