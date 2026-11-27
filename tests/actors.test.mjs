// The documented naming convention end to end: upload `star-title-tag`, confirm the
// title is clean, the star becomes cast, and the actor pages list the work.
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from 'playwright-core'
import { runtimeFixture, sample, waitFor } from './helpers/runtime.mjs'

test('star-title-tag filenames create actors without polluting titles', { timeout: 240_000 }, async (t) => {
  await mkdir('.test-artifacts', { recursive: true })
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  const browser = await chromium.launch({ channel: 'msedge' })
  const report = []
  try {
    await fx.login()
    const bytes = await readFile(sample)
    for (const name of ['杨幂-古剑奇谭-dx123.mp4', '杨幂-宫锁心玉-dx456.mp4', '胡歌-琅琊榜-dx789.mp4']) {
      const response = await fx.request(`/api/admin/upload?name=${encodeURIComponent(name)}`, {
        auth: true, method: 'POST', body: bytes, headers: { 'content-type': 'application/octet-stream' },
      })
      const text = await response.text()
      assert.equal(response.status, 201, `${name}: ${text.slice(0, 200)}`)
    }
    await fx.scan()
    await fx.scan()

    const titles = await waitFor(async () => {
      const items = (await (await fetch(`${fx.base}/api/library/browse?pageSize=60`)).json()).items
      return items.length >= 3 ? items : false
    }, 'uploaded titles did not appear', 30_000)
    report.push(`titles: ${titles.map(item => item.title).join(' / ')}`)

    // Titles must be the real names, never the star or the release tag.
    const names = titles.map(item => item.title).sort()
    assert.deepEqual(names, ['古剑奇谭', '宫锁心玉', '琅琊榜'])
    assert.ok(!names.some(name => name.includes('杨幂') || name.includes('dx')))

    // The actor index is derived from those titles.
    const actors = (await (await fetch(`${fx.base}/api/library/actors`)).json()).items
    report.push(`actors: ${actors.map(a => `${a.name}(${a.count})`).join(', ')}`)
    const yang = actors.find(actor => actor.name === '杨幂')
    assert.ok(yang, '杨幂 must be indexed')
    assert.equal(yang.count, 2)
    assert.ok(actors.some(actor => actor.name === '胡歌'))

    const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: 'zh-CN' })
    const page = await context.newPage()

    // The 明星 tab is reachable from the header and lists both actors.
    await page.goto(fx.base, { waitUntil: 'networkidle' })
    await page.locator('.nav-links').getByRole('link', { name: '明星' }).click()
    await page.waitForURL(`${fx.base}/actors`)
    await page.locator('[data-test="actor-grid"]').waitFor()
    assert.equal(await page.locator('.actor-card').count(), 2)
    report.push('actor list page shows 2 actors')
    await page.screenshot({ path: '.test-artifacts/actors-list.png', fullPage: false })

    // Opening one actor shows exactly their films.
    await page.locator('.actor-card', { hasText: '杨幂' }).click()
    await page.waitForURL(url => url.pathname.startsWith('/actors/'))
    await page.locator('[data-test="actor-titles"]').waitFor()
    const films = await page.locator('.actor-titles .card, [data-test="actor-titles"] .card').count().catch(() => 0)
    const cardCount = await page.locator('[data-test="actor-titles"] .card').count()
    report.push(`actor detail cards: ${cardCount} (fallback ${films})`)
    assert.equal(cardCount, 2)
    assert.match(await page.locator('h1').innerText(), /杨幂/)
    await page.screenshot({ path: '.test-artifacts/actor-detail.png', fullPage: false })

    // The browse page offers an actor filter and no year filter anymore.
    await page.goto(`${fx.base}/browse?kind=movie`, { waitUntil: 'networkidle' })
    await page.locator('.filter-group').first().waitFor()
    const legends = await page.locator('.filter-group legend').allTextContents()
    report.push(`filter groups: ${legends.join(' / ')}`)
    assert.ok(!legends.includes('年份'), 'the year filter must be gone')
    assert.ok(legends.includes('明星'), 'the actor filter must be present')

    // Filtering by actor narrows the grid.
    const before = await page.locator('.grid .card').count()
    await page.locator('.filter-group', { hasText: '明星' }).locator('.chip', { hasText: '杨幂' }).click()
    await page.waitForURL(url => url.searchParams.get('actor') === '杨幂')
    await page.waitForFunction(expected => document.querySelectorAll('.grid .card').length < expected, before)
    report.push(`actor filter: ${before} → ${await page.locator('.grid .card').count()}`)
    await page.screenshot({ path: '.test-artifacts/browse-actor-filter.png', fullPage: false })

    await context.close()
  } finally {
    console.log(report.join('\n'))
    await browser.close()
  }
})
