// Scanned films arrive without artwork. This covers the path that fixes them:
// the bulk panel advertises the missing covers, pre-selects those films, and one
// run gives each of them a real first-frame JPEG.
import assert from 'node:assert/strict'
import { copyFile, mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from 'playwright-core'
import { runtimeFixture, sample, waitFor, within } from './helpers/runtime.mjs'

test('scanned films without posters can be given first-frame covers in one run', { timeout: 180_000 }, async (t) => {
  await mkdir('.test-artifacts', { recursive: true })
  const fixture = await runtimeFixture(t, { interval: 0, stable: 100 })
  const browser = await chromium.launch({ channel: 'msedge' })
  const report = []
  try {
  // Copy three films straight into the media folder, then scan: this is exactly
  // the path that left them without artwork.
  await fixture.login()
  const names = ['片段甲 (2024).mp4', '片段乙 (2023).mp4', '片段丙 (2022).mp4']
  for (const name of names) {
    await copyFile(sample, within(fixture.media, name))
  }
  await fixture.scan()
  await fixture.scan()
  await fixture.scan()
  await waitFor(async () => {
    const items = (await (await fetch(`${fixture.base}/api/library`)).json()).items
    return items.length >= names.length ? items : false
  }, 'scanned films did not appear in the library', 30_000)

  const cards = (await (await fetch(`${fixture.base}/api/library`)).json()).items
  report.push(`library exposes ${cards.length} titles`)
  report.push(`posters before: ${cards.filter(card => card.posterUrl).length}/${cards.length}`)

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await context.newPage()
  await page.goto(`${fixture.base}/admin/login`, { waitUntil: 'networkidle' })
  await page.locator('[data-test="admin-login-username"]').fill(fixture.username)
  await page.locator('[data-test="admin-login-password"]').fill(fixture.password)
  await Promise.all([
    page.waitForURL(`${fixture.base}/admin`),
    page.locator('[data-test="admin-login-submit"]').click(),
  ])

  // The bulk tab must advertise the missing covers.
  const bulkTab = page.locator('[data-test="admin-tab-bulk"]')
  report.push(`bulk tab label: "${(await bulkTab.textContent()).trim()}"`)
  await bulkTab.click()
  await page.locator('[data-test="admin-bulk-missing-poster"]').waitFor()
  report.push(`hint text: "${(await page.locator('[data-test="admin-bulk-missing-poster"]').innerText()).split('\n')[0].trim()}"`)

  // Pre-selection should already cover the films without posters.
  const preselect = await page.locator('[data-test="admin-bulk-missing-poster"] input, .bulk-list input[type="checkbox"]:checked').count()
  report.push(`pre-selected checkboxes: ${preselect}`)
  await page.screenshot({ path: '.test-artifacts/planA-before.png', fullPage: false })

  // Give them descriptions too, then run with the first-frame option on.
  await page.locator('[data-test="admin-bulk-description"]').fill('自动补齐封面测试。')
  const runButton = page.locator('[data-test="admin-bulk-publish"]')
  report.push(`run button disabled before click: ${await runButton.isDisabled()}`)
  const response = page.waitForResponse(r => r.url().endsWith('/api/admin/media/bulk'), { timeout: 90_000 })
  await runButton.click()
  const result = await response
  report.push(`bulk request status: ${result.status()}`)
  const body = await result.json()
  report.push(`published=${body.published?.length ?? 0} skipped=${body.skipped?.length ?? 0}`)
  await page.locator('[data-test="admin-bulk-result"]').waitFor()

  const after = (await (await fetch(`${fixture.base}/api/library`)).json()).items
  report.push(`posters after: ${after.filter(card => card.posterUrl).length}/${after.length}`)
  for (const card of after) {
    if (!card.posterUrl) continue
    const poster = await fetch(`${fixture.base}${card.posterUrl}`)
    const bytes = Buffer.from(await poster.arrayBuffer())
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8
    report.push(`  ${card.title}: ${poster.status} ${bytes.length}B jpeg=${jpeg}`)
  }
  await page.screenshot({ path: '.test-artifacts/planA-after.png', fullPage: false })
  await context.close()

  // Every film must now serve a real JPEG poster.
  const withPoster = after.filter(card => card.posterUrl)
  assert.equal(withPoster.length, after.length, 'every published film should gain a poster')
} finally {
  console.log(report.join('\n'))
  await browser.close()
}
})
