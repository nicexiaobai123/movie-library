// Confirms the admin page keeps breathing room between its bands and that the bulk
// panel no longer carries an introductory paragraph.
import assert from 'node:assert/strict'
import { copyFile, mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from 'playwright-core'
import { runtimeFixture, sample, waitFor } from './helpers/runtime.mjs'

test('admin spacing and bulk panel copy', { timeout: 180_000 }, async (t) => {
  await mkdir('.test-artifacts', { recursive: true })
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  const browser = await chromium.launch({ channel: 'msedge' })
  const report = []
  try {
    await fx.login()
    for (let i = 0; i < 8; i++) await copyFile(sample, `${fx.media}/间距${i + 1} (2022).mp4`)
    await fx.scan()
    await new Promise(resolve => setTimeout(resolve, 400))
    await fx.scan()
    await fx.scan()
    await waitFor(async () => {
      const data = await (await fetch(`${fx.base}/api/library/browse?pageSize=1`)).json()
      return (data.total ?? 0) >= 8 ? data : false
    }, 'not indexed', 60000)

    const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, locale: 'zh-CN' })
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
    await page.waitForTimeout(300)

    // Gaps between the page bands: title, tabs, summary, filters, list.
    const gaps = await page.evaluate(() => {
      const rect = (selector) => {
        const node = document.querySelector(selector)
        return node ? node.getBoundingClientRect() : null
      }
      const heading = rect('.admin-heading')
      const tabs = rect('.admin-tabs')
      const summary = rect('.files-heading')
      const filters = rect('.files-filters')
      const content = rect('#admin-files-content')
      return {
        titleToTabs: Math.round(tabs.top - heading.bottom),
        tabsToSummary: Math.round(summary.top - tabs.bottom),
        summaryToFilters: Math.round(filters.top - summary.bottom),
        filtersToList: Math.round(content.top - filters.bottom),
      }
    })
    report.push(`gaps: ${JSON.stringify(gaps)}`)
    // Every band needs visible separation, not a hairline.
    assert.ok(gaps.titleToTabs >= 8, `title to tabs gap too small: ${gaps.titleToTabs}`)
    assert.ok(gaps.tabsToSummary >= 12, `tabs to summary gap too small: ${gaps.tabsToSummary}`)
    assert.ok(gaps.summaryToFilters >= 10, `summary to filters gap too small: ${gaps.summaryToFilters}`)
    assert.ok(gaps.filtersToList >= 20, `filters to list gap too small: ${gaps.filtersToList}`)

    // The bulk panel should open with its modes, not an intro paragraph.
    await page.locator('[data-test="admin-tab-bulk"]').click()
    await page.waitForTimeout(400)
    const bulk = await page.evaluate(() => {
      const panel = document.querySelector('#admin-panel-bulk')
      const firstChild = panel.querySelector('.bulk-panel')?.firstElementChild
      return {
        paragraphs: [...panel.querySelectorAll('p')].map(node => node.textContent.trim()).filter(Boolean),
        firstTag: firstChild?.tagName ?? null,
        firstClass: firstChild?.className ?? null,
        text: panel.innerText.trim().slice(0, 80),
      }
    })
    report.push(`bulk first: ${bulk.firstTag}.${bulk.firstClass} | text: ${bulk.text}`)
    assert.ok(!bulk.text.includes('每一项单独提交'), 'the long intro paragraph must be gone')
    await page.screenshot({ path: '.test-artifacts/admin-spacing.png', fullPage: false })

    await page.locator('[data-test="admin-tab-files"]').click()
    await page.waitForTimeout(300)
    await page.screenshot({ path: '.test-artifacts/admin-spacing-list.png', fullPage: false })
  } finally {
    console.log(report.join('\n'))
    await browser.close()
  }
})
