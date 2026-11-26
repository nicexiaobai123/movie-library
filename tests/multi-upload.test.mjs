// Uploads several episode files in one go and checks they land on one series.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from 'playwright-core'
import { runtimeFixture, sample } from './helpers/runtime.mjs'

test('one selection can upload every episode of a series', { timeout: 180_000 }, async (t) => {
  await mkdir('.test-artifacts', { recursive: true })
  const fixture = await runtimeFixture(t, { interval: 0, stable: 100 })
  const browser = await chromium.launch({ channel: 'msedge' })
  const report = []
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
    const page = await context.newPage()
    await page.goto(`${fixture.base}/admin/login`, { waitUntil: 'networkidle' })
    await page.locator('[data-test="admin-login-username"]').fill(fixture.username)
    await page.locator('[data-test="admin-login-password"]').fill(fixture.password)
    await Promise.all([
      page.waitForURL(`${fixture.base}/admin`),
      page.locator('[data-test="admin-login-submit"]').click(),
    ])
    await page.locator('[data-test="admin-tab-ingest"]').click()
    await page.locator('[data-test="admin-video-file"]').waitFor()

    const bytes = await import('node:fs/promises').then(fs => fs.readFile(sample))
    const files = [
      { name: '潮声来处 S01E01.mp4', mimeType: 'video/mp4', buffer: bytes },
      { name: '潮声来处 S01E02.mp4', mimeType: 'video/mp4', buffer: bytes },
      { name: '潮声来处 S01E03.mp4', mimeType: 'video/mp4', buffer: bytes },
    ]
    await page.locator('[data-test="admin-video-file"]').setInputFiles(files)
    await page.locator('[data-test="admin-upload-queue"]').waitFor()
    report.push(`queue shows ${await page.locator('[data-test="admin-upload-queue"] li').count()} files`)
    report.push(`button: "${(await page.locator('[data-test="admin-upload-submit"]').textContent()).trim()}"`)

    const done = page.waitForResponse(r => r.url().includes('/api/admin/upload'), { timeout: 120_000 })
    await page.locator('[data-test="admin-upload-submit"]').click()
    assert.equal((await done).status(), 201)
    // Wait for the whole queue to drain.
    await page.waitForFunction(() => document.querySelectorAll('[data-test="admin-upload-results"] li').length >= 3, null, { timeout: 120_000 })
    report.push(`results: ${await page.locator('[data-test="admin-upload-results"]').innerText().then(t => t.replace(/\n/g, ' | '))}`)
    report.push(`status: ${await page.locator('[data-test="admin-upload-status"]').innerText()}`)
    await page.screenshot({ path: '.test-artifacts/multi-upload.png', fullPage: false })
    // Wait for the whole queue to drain.
    await page.locator('[data-test="admin-upload-results"]').waitFor({ timeout: 120_000 })
    await page.waitForFunction(() => document.querySelectorAll('[data-test="admin-upload-results"] li').length >= 3, null, { timeout: 120_000 })
    report.push(`results: ${await page.locator('[data-test="admin-upload-results"]').innerText().then(t => t.replace(/\n/g, ' | '))}`)
    report.push(`status: ${await page.locator('[data-test="admin-upload-status"]').innerText()}`)
    await page.screenshot({ path: '.test-artifacts/multi-upload.png', fullPage: false })


    const library = (await (await fetch(`${fixture.base}/api/library`)).json()).items
    report.push(`library titles: ${library.length}`)
    const series = library.filter(item => item.kind === 'series')
    report.push(`series found: ${series.length} (${series.map(s => s.title).join(', ')})`)
    assert.equal(series.length, 1, 'the three episodes must belong to one series')

    const detail = await (await fetch(`${fixture.base}/api/library/${series[0].id}`)).json()
    report.push(`detail episodes: ${detail.episodes.length}`)
    assert.equal(detail.episodes.length, 3)
    assert.deepEqual(detail.episodes.map(e => e.episode).sort(), [1, 2, 3])

    // The detail page lists them as a compact grid of whole-tile links.
    await page.goto(`${fixture.base}/movie/${series[0].id}`, { waitUntil: 'networkidle' })
    const tiles = await page.locator('.episode-tile').count()
    report.push(`detail page episode tiles: ${tiles}`)
    assert.equal(tiles, 3)
    assert.equal(await page.locator('.episode-action').count(), 0, 'no per-episode button rows')
    await page.screenshot({ path: '.test-artifacts/series-detail.png', fullPage: false })
    await context.close()
  } finally {
    console.log(report.join('\n'))
    await browser.close()
  }
})
