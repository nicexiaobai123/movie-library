// The public browse page paginates a large library: counts, page numbers, navigation.
import assert from 'node:assert/strict'
import { copyFile, mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from 'playwright-core'
import { runtimeFixture, sample, waitFor } from './helpers/runtime.mjs'

test('browse page paginates like a catalogue', { timeout: 240_000 }, async (t) => {
  await mkdir('.test-artifacts', { recursive: true })
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  const browser = await chromium.launch({ channel: 'msedge' })
  const report = []
  try {
    await fx.login()
    for (let i = 0; i < 60; i++) {
      await copyFile(sample, `${fx.media}/分页电影${String(i + 1).padStart(2, '0')} (2021).mp4`)
    }
    await fx.scan()
    await new Promise(resolve => setTimeout(resolve, 400))
    await fx.scan()
    await fx.scan()
    await waitFor(async () => {
      const data = await (await fetch(`${fx.base}/api/library/browse?pageSize=1`)).json()
      return (data.total ?? 0) >= 60 ? data : false
    }, 'films not indexed', 90000)

    const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, locale: 'zh-CN' })
    await page.goto(`${fx.base}/browse?kind=movie`, { waitUntil: 'networkidle' })
    await page.locator('[data-test="browse-pager"]').waitFor()
    await page.waitForTimeout(400)

    // 60 films at 24 per page = 3 pages.
    const first = await page.evaluate(() => ({
      info: document.querySelector('[data-test="browse-pager"] .pager-info').textContent.trim(),
      cards: document.querySelectorAll('#browse-results .card').length,
      numbers: [...document.querySelectorAll('[data-test="browse-pager"] .pager-number')].map(n => n.textContent.trim()),
      current: document.querySelector('[data-test="browse-pager"] .pager-number.is-current')?.textContent.trim() ?? null,
      prevDisabled: document.querySelector('[data-test="browse-pager"] .pager-controls button').disabled,
    }))
    report.push(`page 1: ${JSON.stringify(first)}`)
    assert.equal(first.cards, 24, '24 cards per page')
    assert.match(first.info, /共 60 部/)
    assert.match(first.info, /第 1 \/ 3 页/)
    assert.deepEqual(first.numbers, ['1', '2', '3'])
    assert.equal(first.current, '1')
    assert.ok(first.prevDisabled, 'previous is disabled on page 1')
    await page.screenshot({ path: '.test-artifacts/browse-pager.png', fullPage: false })

    // Jump to the last page by number.
    await page.locator('[data-test="browse-pager"] .pager-number', { hasText: '3' }).click()
    await page.waitForFunction(() => location.search.includes('page=3'), null, { timeout: 10_000 })
    await page.waitForTimeout(500)
    const last = await page.evaluate(() => ({
      info: document.querySelector('[data-test="browse-pager"] .pager-info').textContent.trim(),
      cards: document.querySelectorAll('#browse-results .card').length,
      nextDisabled: [...document.querySelectorAll('[data-test="browse-pager"] .pager-controls button')].at(-1).disabled,
      scrollY: Math.round(window.scrollY),
    }))
    report.push(`page 3: ${JSON.stringify(last)}`)
    assert.match(last.info, /第 3 \/ 3 页/)
    assert.equal(last.cards, 12, 'the last page holds the remainder')
    assert.ok(last.nextDisabled, 'next is disabled on the last page')

    // Sorting resets paging back to the first page.
    await page.locator('[data-test="sort"]').selectOption('title')
    await page.waitForTimeout(400)
    report.push(`after sort: page=${new URL(page.url()).searchParams.get('page') ?? '(none)'}`)
    assert.notEqual(new URL(page.url()).searchParams.get('page'), '3', 'changing the order returns to page 1')

    // The pager must not appear when everything fits on one page.
    await page.goto(`${fx.base}/browse?kind=movie&actor=${encodeURIComponent('不存在的人')}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(400)
    assert.equal(await page.locator('[data-test="browse-pager"]').count(), 0, 'a single page has no pager')
    assert.match(await page.locator('.state-note').innerText(), /没有符合条件/)
  } finally {
    console.log(report.join('\n'))
    await browser.close()
  }
})
