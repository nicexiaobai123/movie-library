// Each admin tab must not repeat its own name as a heading under the tab bar.
import assert from 'node:assert/strict'
import { copyFile, mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from 'playwright-core'
import { runtimeFixture, sample, waitFor } from './helpers/runtime.mjs'

test('admin tabs do not repeat their titles', { timeout: 180_000 }, async (t) => {
  await mkdir('.test-artifacts', { recursive: true })
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  const browser = await chromium.launch({ channel: 'msedge' })
  const report = []
  try {
    await fx.login()
    for (let i = 0; i < 4; i++) await copyFile(sample, `${fx.media}/清理${i + 1} (2022).mp4`)
    await fx.scan()
    await new Promise(resolve => setTimeout(resolve, 400))
    await fx.scan()
    await fx.scan()
    await waitFor(async () => {
      const data = await (await fetch(`${fx.base}/api/library/browse?pageSize=1`)).json()
      return (data.total ?? 0) >= 4 ? data : false
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

    const labels = { files: '文件清单', ingest: '上传与扫描', bulk: '批量处理' }
    for (const tab of ['files', 'ingest', 'bulk']) {
      await page.locator(`[data-test="admin-tab-${tab}"]`).click()
      await page.waitForTimeout(400)
      const seen = await page.evaluate((activeTab) => {
        const panel = document.querySelector(`#admin-panel-${activeTab}`)
        // Only section-level headings matter; row filenames sit in h3 elements inside
        // the list, and the accessible title is visually hidden on purpose.
        const headings = [...panel.querySelectorAll('h2')]
          .filter(node => !node.classList.contains('visually-hidden'))
          .filter((node) => {
            const rect = node.getBoundingClientRect()
            return rect.height > 1 && getComputedStyle(node).position !== 'absolute'
          })
          .map(node => node.textContent.trim())
        return { headings }
      }, tab)
      report.push(`${tab}: headings=${JSON.stringify(seen.headings)}`)
      // Sub-sections may keep their own headings; repeating the tab's own name is the
      // redundancy being removed.
      assert.ok(
        !seen.headings.includes(labels[tab]),
        `tab ${tab} must not repeat its own label as a heading, saw ${JSON.stringify(seen.headings)}`,
      )
    }

    // The count summary is still there, so nothing useful was lost.
    await page.locator('[data-test="admin-tab-files"]').click()
    await page.waitForTimeout(300)
    const summary = (await page.locator('.files-summary').innerText()).trim()
    report.push(`files summary: ${summary}`)
    assert.match(summary, /共 \d+ 个文件/)
    await page.screenshot({ path: '.test-artifacts/admin-cleaned.png', fullPage: false })
  } finally {
    console.log(report.join('\n'))
    await browser.close()
  }
})
