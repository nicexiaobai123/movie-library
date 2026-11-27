// The admin result message must be a transient overlay: it never pushes the file
// list down, and it clears itself. One file row must also stay compact.
import assert from 'node:assert/strict'
import { copyFile, mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from 'playwright-core'
import { runtimeFixture, sample, waitFor } from './helpers/runtime.mjs'

test('admin notices overlay the list and one row stays compact', { timeout: 180_000 }, async (t) => {
  await mkdir('.test-artifacts', { recursive: true })
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  const browser = await chromium.launch({ channel: 'msedge' })
  try {
    await fx.login()
    for (let i = 0; i < 6; i++) await copyFile(sample, `${fx.media}/紧凑测试${i + 1} (2024).mp4`)
    await fx.scan()
    await new Promise(resolve => setTimeout(resolve, 400))
    await fx.scan()
    await fx.scan()
    await waitFor(async () => {
      const items = (await (await fetch(`${fx.base}/api/library/browse?pageSize=60`)).json()).items
      return items.length >= 6 ? items : false
    }, 'films were not indexed', 30_000)

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
    await page.locator('[data-test="admin-media-form"]').waitFor()
    await page.locator('[data-test="admin-media-save"]').click()
    const notice = page.locator('[data-test="admin-save-status"]')
    await page.waitForFunction(() => {
      const node = document.querySelector('[data-test="admin-save-status"]')
      return node && node.textContent.trim().length > 0
    }, null, { timeout: 20_000 })
    const noticeText = (await notice.innerText()).trim()
    console.log('notice:', noticeText)
    assert.ok(noticeText.length > 0)

    // A fixed overlay is the whole point: it must not occupy layout space. Compare
    // the document height with and without the message instead of row positions,
    // which legitimately move when the editor closes.
    const box = await notice.evaluate((node) => {
      const style = getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return { position: style.position, bottomGap: Math.round(innerHeight - rect.bottom), height: Math.round(rect.height) }
    })
    console.log('notice box:', JSON.stringify(box))
    assert.equal(box.position, 'fixed', 'the notice must not take part in layout')
    assert.ok(box.bottomGap >= 0 && box.bottomGap < 200, `the notice should sit near the bottom, gap ${box.bottomGap}`)

    const heightWithNotice = await page.evaluate(() => document.documentElement.scrollHeight)
    // Hide it temporarily: the document height must not change.
    await notice.evaluate(node => { node.style.display = 'none' })
    const heightWithout = await page.evaluate(() => document.documentElement.scrollHeight)
    await notice.evaluate(node => { node.style.display = '' })
    console.log(`document height with=${heightWithNotice} without=${heightWithout}`)
    assert.equal(heightWithNotice, heightWithout, 'the notice must not add to the page height')

    const rowHeight = await page.locator('[data-test="admin-media-row"]').first().evaluate(node => Math.round(node.getBoundingClientRect().height))
    console.log('row height:', rowHeight, 'px')
    assert.ok(rowHeight <= 110, `one row should stay compact, got ${rowHeight}px`)

    const runtimes = await page.locator('[data-test="admin-media-runtime"]').allTextContents()
    console.log('runtimes shown:', runtimes.join(', '))
    assert.ok(runtimes.length > 0, 'the detected runtime should appear in the list')
    await page.screenshot({ path: '.test-artifacts/admin-notice.png', fullPage: false })

    // A stale banner at the bottom of a long page would be just as bad.
    await page.waitForTimeout(7000)
    const remaining = (await notice.innerText()).trim()
    console.log('notice after 7s:', remaining.length === 0 ? '(cleared)' : `still "${remaining}"`)
    assert.equal(remaining.length, 0, 'the notice must clear itself')
    await page.screenshot({ path: '.test-artifacts/admin-list-compact.png', fullPage: false })
  } finally {
    await browser.close()
  }
})
