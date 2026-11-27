// Duration is read from the MP4 header (no tool needed), and the admin list stays
// navigable when the library holds many titles.
import assert from 'node:assert/strict'
import { copyFile, mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from 'playwright-core'
import { runtimeFixture, sample, waitFor } from './helpers/runtime.mjs'

test('duration is auto-detected and a large file list stays usable', { timeout: 240_000 }, async (t) => {
  await mkdir('.test-artifacts', { recursive: true })
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  const browser = await chromium.launch({ channel: 'msedge' })
  const report = []
  try {
    await fx.login()
    // 60 files: more than one page of the admin list.
    const names = Array.from({ length: 60 }, (_, i) => `分页影片${String(i + 1).padStart(2, '0')} (2020).mp4`)
    for (const name of names) await copyFile(sample, `${fx.media}/${name}`)
    await fx.scan()
    await new Promise(resolve => setTimeout(resolve, 400))
    await fx.scan()
    await fx.scan()
    await waitFor(async () => {
      const items = (await (await fetch(`${fx.base}/api/library/browse?pageSize=60`)).json()).items
      return items.length >= 60 ? items : false
    }, 'files were not indexed', 40_000)
    report.push(`indexed ${names.length} films`)

    // The sample clip is 48 seconds, so its runtime is one minute.
    const detail = (await (await fetch(`${fx.base}/api/library/browse?pageSize=60`)).json()).items[0]
    const full = await (await fetch(`${fx.base}/api/library/${detail.id}`)).json()
    report.push(`runtime for "${full.title}": ${full.runtime} minute(s)`)
    assert.equal(full.runtime, 1, 'a 48s clip becomes 1 minute without any manual input')

    // A title indexed before duration detection gets its runtime on the next scan.
    const { DatabaseSync } = await import('node:sqlite')
    const raw = new DatabaseSync(fx.db)
    try {
      raw.prepare('UPDATE titles SET runtime = NULL').run()
    } finally { raw.close() }
    await fx.scan()
    await new Promise(resolve => setTimeout(resolve, 300))
    await fx.scan()
    const backfilled = await (await fetch(`${fx.base}/api/library/browse?pageSize=60`)).json()
    const withRuntime = (await Promise.all(backfilled.items.map(async (item) => {
      const one = await (await fetch(`${fx.base}/api/library/${item.id}`)).json()
      return one.runtime === null ? null : item.title
    }))).filter(Boolean)
    report.push(`runtimes backfilled: ${withRuntime.length}/${backfilled.items.length}`)
    assert.ok(withRuntime.length >= 55, `most titles should regain a runtime, got ${withRuntime.length}`)

    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
    const page = await context.newPage()
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

    const rendered = await page.locator('[data-test="admin-media-row"]').count()
    report.push(`rows rendered on page 1: ${rendered}`)
    assert.equal(rendered, 40, `one page of 40 should render, got ${rendered}`)

    // Numbered pagination replaces the old "show more" button.
    const pager = page.locator('[data-test="admin-files-pager"]')
    await pager.waitFor()
    report.push(`pager: ${(await pager.locator('.pager-info').innerText()).trim()}`)
    const pageButtons = await pager.locator('.pager-number').allTextContents()
    report.push(`page buttons: ${pageButtons.join(', ')}`)
    assert.ok(pageButtons.includes('2'), 'a second page must be offered')

    await pager.locator('[data-test="admin-files-next"]').click()
    await page.waitForFunction(() => {
      const node = document.querySelector('[data-test="admin-files-pager"] .pager-info')
      return node?.textContent?.includes('第 2 /')
    }, null, { timeout: 10_000 })
    const page2 = await page.locator('[data-test="admin-media-row"]').count()
    report.push(`page 2 rows: ${page2}`)
    assert.equal(page2, 20, 'the second page holds the remaining 20')

    // Jumping straight to a page number works as well.
    await pager.locator('[data-test="admin-files-page-1"]').click()
    await page.waitForFunction(() => {
      const node = document.querySelector('[data-test="admin-files-pager"] .pager-info')
      return node?.textContent?.includes('第 1 /')
    }, null, { timeout: 10_000 })
    report.push(`back to page 1: ${await page.locator('[data-test="admin-media-row"]').count()} rows`)
    await page.screenshot({ path: '.test-artifacts/admin-pager.png', fullPage: false })

    // Searching narrows the list without scrolling.
    const search = page.locator('[data-test="admin-files-query"]')
    await search.fill('分页影片07')
    await page.waitForTimeout(400)
    const filtered = await page.locator('[data-test="admin-media-row"]').count()
    report.push(`search "分页影片07" → ${filtered} row(s)`)
    assert.equal(filtered, 1)
    await page.screenshot({ path: '.test-artifacts/admin-search.png', fullPage: false })

    // The title picker filters a long list of titles instead of scrolling.
    await page.locator('[data-test="admin-files-query"]').fill('')
    await page.waitForTimeout(300)
    await page.locator('[data-test="admin-media-edit"]').first().click()
    const picker = page.locator('[data-test="admin-media-title-filter"]')
    await picker.waitFor()
    await picker.fill('分页影片42')
    await page.waitForTimeout(300)
    const options = await page.locator('[data-test="admin-media-title-id"] option').count()
    report.push(`title options after filter: ${options}`)
    // "new" + the match + the row's own title, which is kept so the select is not blank.
    assert.ok(options <= 3, `the picker should narrow to at most 3 options, got ${options}`)
    // Filtering must never blank out the current selection.
    const selectedLabel = await page.locator('[data-test="admin-media-title-id"]').evaluate(node => node.selectedOptions[0]?.textContent?.trim() ?? '')
    report.push(`selected option stays: "${selectedLabel}"`)
    assert.ok(selectedLabel.length > 0, 'the selected title must survive filtering')
    await page.screenshot({ path: '.test-artifacts/admin-title-picker.png', fullPage: false })

    await context.close()
  } finally {
    console.log(report.join('\n'))
    await browser.close()
  }
})
