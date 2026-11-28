// One pager on the whole site: the catalogue's. It shows at most five page numbers
// and slides as the reader moves, so the bar is the same shape on every list and on
// every page of a list.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from 'playwright-core'
import { runtimeFixture } from './helpers/runtime.mjs'

async function shape(page, selector) {
  return page.evaluate((sel) => {
    const nav = document.querySelector(sel)
    if (!nav) return null
    const buttons = [...nav.querySelectorAll('.pager-controls .btn')]
    const current = nav.querySelector('.pager-number.is-current')
    const style = current ? getComputedStyle(current) : null
    const rect = nav.getBoundingClientRect()
    const controls = nav.querySelector('.pager-controls').getBoundingClientRect()
    return {
      labels: buttons.map(button => button.textContent.trim()),
      frame: [buttons[0]?.textContent.trim(), buttons[1]?.textContent.trim(), 'pages', buttons.at(-2)?.textContent.trim(), buttons.at(-1)?.textContent.trim()],
      numbers: [...nav.querySelectorAll('.pager-number')].map(node => Number(node.textContent.trim())),
      current: current ? Number(current.textContent.trim()) : null,
      currentBg: style?.backgroundColor ?? null,
      currentColor: style?.color ?? null,
      currentWeight: style?.fontWeight ?? null,
      ellipsis: nav.querySelectorAll('.pager-gap').length,
      rightGap: Math.round(rect.right - controls.right),
      heights: [...new Set(buttons.map(button => Math.round(button.getBoundingClientRect().height)))],
    }
  }, selector)
}

test('every list uses the catalogue pager with a five-number sliding window', { timeout: 300_000 }, async (t) => {
  await mkdir('.test-artifacts', { recursive: true })
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  const browser = await chromium.launch({ channel: 'msedge' })
  const report = []
  try {
    await fx.login()
    // 130 films and 130 separate series: the catalogue pages 24 at a time, so each
    // list has enough pages to exercise the five-number window.
    for (let i = 1; i <= 130; i++) await fx.stage(`统一分页${String(i).padStart(3, '0')}.mp4`)
    for (let i = 1; i <= 130; i++) await fx.stage(`连续剧集${String(i).padStart(3, '0')} 第1集.mp4`)
    await fx.scan()

    const [name, value] = fx.cookie().split('=')
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
    await context.addCookies([{ name, value, url: fx.base, httpOnly: true, sameSite: 'Strict' }])
    const page = await context.newPage()

    const LISTS = [
      ['电影', '/browse?kind=movie', '[data-test="browse-pager"]'],
      ['剧集', '/browse?kind=series', '[data-test="browse-pager"]'],
      ['后台-全部', '/admin', '[data-test="admin-files-pager"]'],
      ['搜索', '/search?q=%E7%BB%9F%E4%B8%80', '[data-test="search-pager"]'],
    ]

    const shapes = []
    for (const [label, url, selector] of LISTS) {
      await page.goto(`${fx.base}${url}`, { waitUntil: 'networkidle' })
      await page.waitForSelector(selector, { timeout: 15_000 })
      await page.waitForTimeout(250)
      const first = await shape(page, selector)
      report.push(`${label} p1: ${JSON.stringify(first)}`)
      assert.equal(first.ellipsis, 0, `${label} has no ellipsis`)
      assert.equal(first.numbers.length, 5, `${label} shows five pages`)
      assert.deepEqual(first.numbers, [1, 2, 3, 4, 5], `${label} starts at page 1`)
      assert.equal(first.current, 1)
      shapes.push([label, first, url, selector])
    }

    // Every list is the same control, pixel for pixel.
    const [, reference] = shapes[0]
    for (const [label, item] of shapes.slice(1)) {
      assert.deepEqual(item.frame, reference.frame, `${label} matches the 电影 frame`)
      assert.equal(item.currentBg, reference.currentBg, `${label} current fill`)
      assert.equal(item.currentColor, reference.currentColor, `${label} current colour`)
      assert.equal(item.currentWeight, reference.currentWeight, `${label} current weight`)
      assert.deepEqual(item.heights, reference.heights, `${label} button height`)
    }

    // The window slides: the demo shows 1 2 3 4 5 → 2 3 4 5 6 as you move forward.
    await page.goto(`${fx.base}/browse?kind=movie`, { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-test="browse-pager"]')
    const strip = async () => (await shape(page, '[data-test="browse-pager"]')).numbers
    await page.locator('[data-test="browse-page-2"]').click()
    await page.waitForFunction(() => location.search.includes('page=2'))
    await page.waitForTimeout(300)
    report.push(`page 2: ${JSON.stringify(await strip())}`)
    assert.deepEqual(await strip(), [1, 2, 3, 4, 5], 'the window still starts at 1 on page 2')

    await page.locator('[data-test="browse-next"]').click()
    await page.waitForFunction(() => location.search.includes('page=3'))
    await page.waitForTimeout(300)
    report.push(`page 3: ${JSON.stringify(await strip())}`)
    assert.deepEqual(await strip(), [1, 2, 3, 4, 5])

    await page.locator('[data-test="browse-next"]').click()
    await page.waitForFunction(() => location.search.includes('page=4'))
    await page.waitForTimeout(300)
    report.push(`page 4: ${JSON.stringify(await strip())}`)
    // Sliding begins: the demo's second image is 2 3 4 5 6.
    assert.deepEqual(await strip(), [2, 3, 4, 5, 6], 'the window slides on page 4')

    // The last page keeps a full window rather than shrinking.
    const filmPages = Number((await page.locator('[data-test="browse-pager"] .pager-info').innerText()).match(/\/ (\d+) 页/)?.[1] ?? 0)
    await page.locator('[data-test="browse-last"]').click()
    await page.waitForFunction(expected => location.search.includes(`page=${expected}`), filmPages)
    await page.waitForTimeout(300)
    const lastNumbers = await strip()
    report.push(`last page (${filmPages}): ${JSON.stringify(lastNumbers)}`)
    assert.equal(lastNumbers.length, 5, 'the last page still shows five numbers')
    assert.equal(lastNumbers.at(-1), filmPages, 'the last page is included')
    await page.screenshot({ path: '.test-artifacts/pager-final.png' })

    await context.close()
  } finally {
    console.log(report.join('\n'))
    await browser.close()
  }
})
