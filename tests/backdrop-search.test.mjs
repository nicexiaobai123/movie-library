// Covers the two batch-1 fixes: a backdrop can be assigned from the admin editor,
// and search results page instead of silently truncating at 24.
import assert from 'node:assert/strict'
import { copyFile } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from 'playwright-core'
import { assertStatus, runtimeFixture, sample, waitFor } from './helpers/runtime.mjs'

test('admin can set a backdrop and search pages through every result', { timeout: 240_000 }, async (t) => {
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  const report = []
  // Thirty films sharing a word so one search spans two pages.
  const names = Array.from({ length: 30 }, (_, i) => `分页测试${String(i + 1).padStart(2, '0')} (2020).mp4`)
  for (const name of names) await copyFile(sample, `${fx.media}/${name}`)

  const browser = await chromium.launch({ channel: 'msedge' })
  try {
    await fx.login()
    await fx.scan()
    await new Promise(resolve => setTimeout(resolve, 400))
    await fx.scan()
    await fx.scan()
    await waitFor(async () => {
      const items = (await (await fetch(`${fx.base}/api/library`)).json()).items
      return items.length >= names.length ? items : false
    }, 'indexed films did not appear', 30_000)

    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
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
    await page.locator('[data-test="admin-media-edit"]').first().click()

    // The backdrop field must exist and be wired to the saved value.
    const backdropInput = page.locator('[data-test="admin-media-backdrop-path"]')
    assert.equal(await backdropInput.count(), 1, 'the editor must expose a backdrop path field')
    await backdropInput.fill('背景/横版.jpg')
    report.push('backdrop field present and filled')

    const saveResponse = page.waitForResponse(r => r.url().includes('/api/admin/media/') && r.request().method() === 'PATCH')
    await page.locator('[data-test="admin-media-save"]').click()
    const saved = await saveResponse
    report.push(`patch status: ${saved.status()}`)
    assert.equal(saved.status(), 200)

    // The value must survive a reload of the public catalog.
    const titles = (await (await fetch(`${fx.base}/api/library/browse?pageSize=60`)).json()).items
    const withBackdrop = titles.filter(item => item.backdropUrl)
    report.push(`titles with a backdrop: ${withBackdrop.length}`)
    assert.ok(withBackdrop.length >= 1, 'the saved backdrop must be exposed to the site')

    // Search paging: the summary counts every hit, and the pager reaches the last one.
    await page.goto(`${fx.base}/search?q=${encodeURIComponent('分页测试')}`, { waitUntil: 'networkidle' })
    await page.locator('.search-grid .card').first().waitFor()
    const firstCount = await page.locator('.search-grid .card').count()
    const summary = await page.locator('.search-summary').innerText()
    report.push(`page 1 cards: ${firstCount}, summary: ${summary.trim()}`)
    assert.equal(firstCount, 24, 'first page shows a full page')
    assert.match(summary, /30 个结果/)

    const pager = page.locator('[data-test="search-pager"]')
    await pager.waitFor()
    await page.locator('[data-test="search-next"]').click()
    await page.waitForURL(url => url.searchParams.get('page') === '2')
    await page.waitForFunction(() => document.querySelectorAll('.search-grid .card').length === 6, null, { timeout: 15_000 })
    const secondCount = await page.locator('.search-grid .card').count()
    report.push(`page 2 cards: ${secondCount}`)
    assert.equal(secondCount, 6, 'the remaining six results are on page 2')
    assert.equal(await page.locator('[data-test="search-next"]').isDisabled(), true)

    // Typing a new keyword must fall back to page 1.
    await page.locator('[data-test="search-input"]').fill('分页测试1')
    await page.waitForURL(url => !url.searchParams.has('page'), { timeout: 10_000 })
    report.push('new keyword resets to page 1')
    await page.screenshot({ path: '.test-artifacts/search-paged.png', fullPage: false })
  } finally {
    console.log(report.join('\n'))
    await browser.close()
  }
})
