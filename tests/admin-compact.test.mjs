// Admin list: taller fixed panel, pager always visible, editor keeps common fields
// up front and puts the rest behind "更多资料".
import assert from 'node:assert/strict'
import { copyFile, mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from 'playwright-core'
import { runtimeFixture, sample, waitFor } from './helpers/runtime.mjs'

test('list panel is tall with a permanent pager and a compact editor', { timeout: 240_000 }, async (t) => {
  await mkdir('.test-artifacts', { recursive: true })
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  const browser = await chromium.launch({ channel: 'msedge' })
  const report = []
  try {
    await fx.login()
    await copyFile(sample, `${fx.media}/精简测试 (2023).mp4`)
    await fx.scan()
    await new Promise(resolve => setTimeout(resolve, 400))
    await fx.scan()
    await fx.scan()
    await waitFor(async () => {
      const data = await (await fetch(`${fx.base}/api/library/browse?pageSize=1`)).json()
      return (data.total ?? 0) >= 1 ? data : false
    }, 'film not indexed', 30_000)

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

    // The panel reaches down to the footer; its absolute height depends on how much
    // chrome sits above it, so the meaningful check is that it ends at the bottom.
    const panel = await page.locator('#admin-files-content').evaluate(node => Math.round(node.getBoundingClientRect().height))
    report.push(`list panel height: ${panel}px`)
    assert.ok(panel >= 200, `the panel should show a few rows, got ${panel}px`)

    // 2. The pager is present even with a single page.
    const pager = page.locator('[data-test="admin-files-pager"]')
    await pager.waitFor()
    const pagerInfo = (await pager.locator('.pager-info').innerText()).trim()
    report.push(`pager with one page: "${pagerInfo}"`)
    assert.match(pagerInfo, /共 \d+ 个文件/)
    const prevDisabled = await page.locator('[data-test="admin-files-prev"]').isDisabled()
    const nextDisabled = await page.locator('[data-test="admin-files-next"]').isDisabled()
    report.push(`single page buttons disabled: prev=${prevDisabled} next=${nextDisabled}`)
    assert.ok(prevDisabled && nextDisabled, 'both arrows are disabled on a single page')

    // The pager must be on screen without scrolling the page; otherwise it is not
    // "permanently visible" in any useful sense.
    const pagerBox = await page.evaluate(() => {
      const pager = document.querySelector('[data-test="admin-files-pager"]')
      const rect = pager.getBoundingClientRect()
      return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), viewport: innerHeight, pageScroll: Math.round(scrollY) }
    })
    report.push(`pager on screen: ${JSON.stringify(pagerBox)}`)
    assert.ok(pagerBox.pageScroll === 0, 'the page should not need scrolling')
    assert.ok(pagerBox.bottom <= pagerBox.viewport + 1, 'the pager must be inside the viewport')

    // The list must run all the way down to the footer, with no leftover band.
    const edges = await page.evaluate(() => {
      const content = document.querySelector('#admin-files-content').getBoundingClientRect()
      const main = document.querySelector('.site-main').getBoundingClientRect()
      const footer = document.querySelector('.footer').getBoundingClientRect()
      return {
        contentBottom: Math.round(content.bottom + scrollY),
        mainBottom: Math.round(main.bottom + scrollY),
        footerTop: Math.round(footer.top + scrollY),
      }
    })
    report.push(`bottom edges: ${JSON.stringify(edges)}`)
    assert.equal(edges.contentBottom, edges.mainBottom, 'the list must end exactly where the main area ends')
    assert.ok(edges.footerTop - edges.contentBottom <= 2, `no gap before the footer, got ${edges.footerTop - edges.contentBottom}px`)
    await page.screenshot({ path: '.test-artifacts/admin-tall-list.png', fullPage: false })

    // 3. The editor leads with the common fields.
    await page.locator('[data-test="admin-media-edit"]').first().click()
    await page.locator('[data-test="admin-media-modal"]').waitFor()
    const metrics = await page.evaluate(() => {
      const modal = document.querySelector('[data-test="admin-media-modal"]')
      const details = modal.querySelector('[data-test="admin-media-more"]')
      const visible = (selector) => {
        const node = modal.querySelector(selector)
        if (!node) return false
        const rect = node.getBoundingClientRect()
        return rect.height > 0 && rect.top < innerHeight
      }
      return {
        title: visible('[data-test="admin-media-title"]'),
        kind: visible('[data-test="admin-media-kind"]'),
        cast: visible('[data-test="admin-media-cast"]'),
        description: visible('[data-test="admin-media-description"]'),
        runtime: visible('[data-test="admin-media-runtime"]'),
        moreOpen: details?.open ?? null,
        modalHeight: Math.round(modal.getBoundingClientRect().height),
      }
    })
    report.push(`editor: ${JSON.stringify(metrics)}`)
    assert.ok(metrics.title && metrics.kind && metrics.cast, 'title, kind and cast stay visible up front')
    assert.equal(metrics.moreOpen, false, 'optional fields start collapsed for a new title')
    assert.equal(metrics.runtime, false, 'runtime moves into the optional block')

    // 4. Expanding the optional block reveals the remaining fields.
    await page.locator('[data-test="admin-media-more"] summary').click()
    await page.waitForTimeout(300)
    const afterExpand = await page.evaluate(() => {
      const modal = document.querySelector('[data-test="admin-media-modal"]')
      const node = modal.querySelector('[data-test="admin-media-runtime"]')
      return { open: modal.querySelector('[data-test="admin-media-more"]').open, runtimeVisible: node.getBoundingClientRect().height > 0 }
    })
    report.push(`after expand: ${JSON.stringify(afterExpand)}`)
    assert.equal(afterExpand.open, true)
    assert.ok(afterExpand.runtimeVisible, 'expanding reveals the optional fields')
    await page.screenshot({ path: '.test-artifacts/admin-compact-editor.png', fullPage: false })
  } finally {
    console.log(report.join('\n'))
    await browser.close()
  }
})
