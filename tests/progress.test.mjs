// Continue watching: a position is saved, resumed on return, and cleared once the
// film is effectively finished.
import assert from 'node:assert/strict'
import { copyFile, mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from 'playwright-core'
import { runtimeFixture, sample, waitFor } from './helpers/runtime.mjs'

test('playback position resumes and clears when finished', { timeout: 180_000 }, async (t) => {
  await mkdir('.test-artifacts', { recursive: true })
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  const browser = await chromium.launch({ channel: 'msedge' })
  const report = []
  try {
    await fx.login()
    await copyFile(sample, `${fx.media}/进度测试 (2024).mp4`)
    await fx.scan()
    await new Promise(resolve => setTimeout(resolve, 400))
    await fx.scan()
    await fx.scan()
    const film = await waitFor(async () => {
      const items = (await (await fetch(`${fx.base}/api/library`)).json()).items
      return items[0] ?? false
    }, 'film was not indexed', 30_000)
    report.push(`film: ${film.title}`)

    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })
    const page = await context.newPage()

    // Register a visitor so progress has an owner.
    await page.goto(`${fx.base}/user`, { waitUntil: 'networkidle' })
    await page.locator('[data-test="user-mode-register"]').click()
    await page.locator('[data-test="user-username"]').fill('进度用户')
    await page.locator('[data-test="user-password"]').fill('123456')
    await page.locator('[data-test="user-submit"]').click()
    await page.waitForFunction(() => document.querySelector('.nav-account-label')?.textContent?.includes('进度用户'), null, { timeout: 15_000 })
    report.push('visitor registered')

    // Signed in but nothing watched yet: the row must stay hidden.
    await page.goto(fx.base, { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    assert.equal(await page.locator('[data-test="resume-row"]').count(), 0, 'no resume row before watching')

    // Write a position through the API, then confirm the home row appears.
    const cookie = await context.cookies()
    const cookieHeader = cookie.map(c => `${c.name}=${c.value}`).join('; ')
    const put = await fetch(`${fx.base}/api/user/progress`, {
      method: 'PUT',
      headers: { origin: fx.base, cookie: cookieHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ titleId: film.id, episodeId: null, position: 20, duration: 48 }),
    })
    assert.equal(put.status, 200)
    report.push(`saved position, response: ${JSON.stringify(await put.json())}`)

    const list = await (await fetch(`${fx.base}/api/user/progress`, { headers: { cookie: cookieHeader } })).json()
    report.push(`progress rows: ${list.items.length}, percent: ${list.items[0]?.percent}`)
    assert.equal(list.items.length, 1)
    assert.equal(list.items[0].percent, 42)

    await page.goto(fx.base, { waitUntil: 'networkidle' })
    await page.locator('[data-test="resume-row"]').waitFor()
    const resumeTitle = await page.locator('.resume-name').first().innerText()
    report.push(`resume row shows: ${resumeTitle}`)
    assert.match(resumeTitle, /进度测试/)
    await page.screenshot({ path: '.test-artifacts/continue-watching.png', fullPage: false })

    // Opening the watch page must jump to the saved position and say so.
    await page.locator('.resume-card').first().click()
    await page.waitForURL(url => url.pathname.startsWith('/watch/'))
    await page.locator('video').waitFor()
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1, null, { timeout: 20_000 })
    await page.waitForFunction(() => (document.querySelector('video')?.currentTime ?? 0) > 15, null, { timeout: 20_000 })
    const resumedAt = await page.locator('video').evaluate(video => video.currentTime)
    report.push(`resumed at ${resumedAt.toFixed(1)}s`)
    assert.ok(resumedAt > 15 && resumedAt < 30, `expected to resume near 20s, got ${resumedAt}`)

    // A finished position removes the row instead of leaving it at 100%.
    const finish = await fetch(`${fx.base}/api/user/progress`, {
      method: 'PUT',
      headers: { origin: fx.base, cookie: cookieHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ titleId: film.id, episodeId: null, position: 47.9, duration: 48 }),
    })
    assert.equal((await finish.json()).cleared, true)
    const after = await (await fetch(`${fx.base}/api/user/progress`, { headers: { cookie: cookieHeader } })).json()
    report.push(`after finishing: ${after.items.length} rows`)
    assert.equal(after.items.length, 0)

    await context.close()
  } finally {
    console.log(report.join('\n'))
    await browser.close()
  }
})
