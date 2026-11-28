// Exercises the interactive paths end to end: filters, search, playback, favourites.
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const port = '3112'
const base = `http://127.0.0.1:${port}`
const outDir = '.test-artifacts/visual'
await mkdir(outDir, { recursive: true })

const server = spawn(process.execPath, ['.output/server/index.mjs'], {
  env: {
    ...process.env, NITRO_HOST: '127.0.0.1', NITRO_PORT: port, NODE_ENV: 'production',
    NUXT_LIBRARY_DB_PATH: '.demo/library.sqlite', NUXT_LIBRARY_MEDIA_ROOT: '.demo/media',
  },
  stdio: 'ignore',
})
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch(`${base}/api/library/home`, { signal: AbortSignal.timeout(1200) })
    if (r.ok) { await r.body?.cancel(); break }
  } catch { /* not ready */ }
  await new Promise(r => setTimeout(r, 400))
}

const browser = await chromium.launch({ channel: 'msedge' })
const results = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))

  // 1. Genre filter actually narrows the grid and updates the URL.
  await page.goto(`${base}/browse`, { waitUntil: 'networkidle' })
  const allCount = await page.locator('.grid .card').count()
  await page.locator('.chip', { hasText: '科幻' }).first().click()
  await page.waitForTimeout(900)
  const genreCount = await page.locator('.grid .card').count()
  results.push(`genre filter: ${allCount} → ${genreCount}, url=${new URL(page.url()).search}`)
  await page.screenshot({ path: join(outDir, 'flow-browse-filtered.png') })

  // 2. Search returns matches and reports a count.
  await page.goto(`${base}/search?q=%E6%B5%B7`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  const searchCards = await page.locator('.search-grid .card').count()
  const summary = await page.locator('.search-summary').textContent().catch(() => '')
  results.push(`search 海: ${searchCards} cards, summary="${summary?.trim()}"`)
  await page.screenshot({ path: join(outDir, 'flow-search.png') })

  // 3. Playback page loads a real video element and starts.
  const home = await (await fetch(`${base}/api/library/home`)).json()
  const film = home.movies[0]
  if (!film) throw new Error('The demo library does not contain a film to play')
  await page.goto(`${base}/watch/${film.id}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('video', { timeout: 15000 })
  const videoInfo = await page.evaluate(async () => {
    const video = document.querySelector('video')
    try { await video.play() } catch { /* autoplay may be blocked */ }
    await new Promise(resolve => setTimeout(resolve, 1200))
    return { duration: video.duration, paused: video.paused, readyState: video.readyState, w: video.videoWidth }
  })
  results.push(`watch: duration=${videoInfo.duration} paused=${videoInfo.paused} ready=${videoInfo.readyState} ${videoInfo.w}x?`)
  await page.screenshot({ path: join(outDir, 'flow-watch.png') })

  // 4. Register, favourite, verify on my-list, then unfavourite.
  await page.goto(`${base}/user`, { waitUntil: 'networkidle' })
  await page.locator('[data-test="user-mode-register"]').click()
  const name = `观影人${Date.now() % 10000}`
  await page.locator('[data-test="user-username"]').fill(name)
  await page.locator('[data-test="user-password"]').fill('123456')
  await page.locator('[data-test="user-submit"]').click()
  await page.waitForTimeout(2200)
  const headerName = await page.locator('.nav-account-label').textContent()
  await page.goto(`${base}/movie/${film.id}`, { waitUntil: 'networkidle' })
  await page.locator('[data-test="title-favorite"]').click()
  await page.waitForFunction(() => document.querySelector('[data-test="title-favorite"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 15000 })
  await page.goto(`${base}/my-list`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  const listCount = await page.locator('.list-grid .card').count()
  await page.screenshot({ path: join(outDir, 'flow-my-list.png') })
  await page.locator('[data-test="favorite-remove"]').first().click()
  await page.waitForTimeout(1200)
  const emptyState = await page.getByRole('heading', { name: '收藏夹还是空的' }).count()
  results.push(`visitor "${name}": header="${headerName?.trim()}" favourites=${listCount} afterRemove empty=${emptyState}`)

  results.push(`page errors: ${errors.length ? errors.join('; ') : 'none'}`)
} finally {
  await browser.close()
  server.kill()
}
console.log(results.join('\n'))
