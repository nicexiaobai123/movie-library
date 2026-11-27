// The admin list must keep a stable shape: fixed row height, a pager pinned to the
// bottom of a bounded list, and an editor that opens as a modal instead of growing
// the document.
import assert from 'node:assert/strict'
import { copyFile, mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from 'playwright-core'
import { runtimeFixture, sample, waitFor } from './helpers/runtime.mjs'

test('admin list has fixed rows, pinned pager and modal editor', { timeout: 240_000 }, async (t) => {
  await mkdir('.test-artifacts', { recursive: true })
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  const browser = await chromium.launch({ channel: 'msedge' })
  const report = []
  try {
    await fx.login()
    for (let i = 0; i < 70; i++) {
      await copyFile(sample, `${fx.media}/版式${String(i + 1).padStart(2, '0')} (2022).mp4`)
    }
    await fx.scan()
    await new Promise(resolve => setTimeout(resolve, 400))
    await fx.scan()
    await fx.scan()
    await waitFor(async () => {
      const data = await (await fetch(`${fx.base}/api/library/browse?pageSize=1`)).json()
      return (data.total ?? 0) >= 70 ? data : false
    }, 'films were not indexed', 60_000)

    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
    await page.goto(`${fx.base}/admin/login`, { waitUntil: 'networkidle' })
    await page.locator('[data-test="admin-login-username"]').fill(fx.username)
    await page.locator('[data-test="admin-login-password"]').fill(fx.password)
    await Promise.all([
      page.waitForURL(`${fx.base}/admin`),
      page.locator('[data-test="admin-login-submit"]').click(),
    ])
    await page.locator('[data-test="admin-tab-files"]').click()
    await page.locator('[data-test="admin-filter-all"]').click()
    await page.locator('[data-test="admin-media-row"]').first().waitFor()

    // 1. Every row has the same height.
    const heights = await page.locator('[data-test="admin-media-row"]').evaluateAll(nodes =>
      nodes.map(node => Math.round(node.getBoundingClientRect().height)))
    const unique = [...new Set(heights)]
    report.push(`row heights: ${unique.join(', ')} px across ${heights.length} rows`)
    assert.equal(unique.length, 1, `all rows must share one height, saw ${unique.join('/')}`)

    // 2. The page does not grow when the editor opens.
    const pageHeight = () => page.evaluate(() => document.documentElement.scrollHeight)
    const before = await pageHeight()
    await page.locator('[data-test="admin-media-edit"]').first().click()
    await page.locator('[data-test="admin-media-modal"]').waitFor()
    await page.waitForTimeout(400)
    const during = await pageHeight()
    report.push(`document height closed=${before} open=${during}`)
    assert.equal(before, during, 'the modal must not add to the page height')

    // 3. The editor is a real dialog and the list pager is still in place.
    const modal = await page.locator('[data-test="admin-media-editor"]').evaluate(node => {
      const style = getComputedStyle(node)
      return { role: node.getAttribute('role'), ariaModal: node.getAttribute('aria-modal'), position: style.position }
    })
    report.push(`editor: ${JSON.stringify(modal)}`)
    assert.equal(modal.role, 'dialog')
    assert.equal(modal.ariaModal, 'true')
    await page.screenshot({ path: '.test-artifacts/admin-modal.png', fullPage: false })

    // Escape closes it and focus returns to the row's edit button.
    await page.keyboard.press('Escape')
    await page.locator('[data-test="admin-media-modal"]').waitFor({ state: 'detached' })
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-test') ?? '')
    report.push(`after Escape, focus on: ${focused}`)
    assert.equal(focused, 'admin-media-edit', 'focus should return to the trigger')
    const after = await pageHeight()
    report.push(`document height after close=${after}`)
    assert.equal(after, before)

    // 4. The pager sits inside the bounded list and stays reachable.
    const layout = await page.evaluate(() => {
      const content = document.querySelector('#admin-files-content')
      const list = document.querySelector('#admin-files-content .file-list')
      const pager = document.querySelector('[data-test="admin-files-pager"]')
      if (!content || !list || !pager) return null
      const c = content.getBoundingClientRect()
      const p = pager.getBoundingClientRect()
      return {
        contentHeight: Math.round(c.height),
        listScrolls: list.scrollHeight > list.clientHeight + 1,
        pagerInsideContent: p.bottom <= c.bottom + 1 && p.top >= c.top,
        pagerVisible: p.top >= 0 && p.bottom <= innerHeight,
      }
    })
    report.push(`layout: ${JSON.stringify(layout)}`)
    assert.ok(layout, 'the list container must exist')
    assert.ok(layout.listScrolls, 'the rows area should scroll instead of the page')
    assert.ok(layout.pagerInsideContent, 'the pager must be pinned inside the list box')

    // Scroll the list box into view once: from then on the pager stays put while the
    // rows scroll internally, which is the point of the bounded container.
    await page.locator('#admin-files-content').scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    const stable = await page.evaluate(() => {
      const pager = document.querySelector('[data-test="admin-files-pager"]')
      const list = document.querySelector('#admin-files-content .file-list')
      const before = pager.getBoundingClientRect().top
      list.scrollTop = list.scrollHeight
      const after = pager.getBoundingClientRect().top
      const rect = pager.getBoundingClientRect()
      return {
        before: Math.round(before),
        after: Math.round(after),
        pagerTop: Math.round(rect.top),
        pagerBottom: Math.round(rect.bottom),
        viewport: innerHeight,
        pageScroll: Math.round(scrollY),
        listClient: list.clientHeight,
        listScroll: list.scrollHeight,
      }
    })
    report.push(`pager stays put while rows scroll: ${JSON.stringify(stable)}`)
    assert.equal(stable.before, stable.after, 'scrolling the rows must not move the pager')
    // It may sit flush against the bottom edge, so allow a small tolerance.
    assert.ok(stable.pagerTop >= 0 && stable.pagerBottom <= stable.viewport + 2, 'the pager must be on screen')

    await page.screenshot({ path: '.test-artifacts/admin-bounded-list.png', fullPage: false })
  } finally {
    console.log(report.join('\n'))
    await browser.close()
  }
})
