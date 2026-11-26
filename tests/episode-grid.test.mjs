// Renders the episode grid with named episodes, multiple seasons and many
// episodes to confirm the compact layout holds up in real conditions.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from 'playwright-core'
import { runtimeFixture, sample } from './helpers/runtime.mjs'

test('episode grid stays compact with names, multiple seasons and many episodes', { timeout: 180_000 }, async (t) => {
  await mkdir('.test-artifacts', { recursive: true })
  const fixture = await runtimeFixture(t, { interval: 0, stable: 100 })
  const browser = await chromium.launch({ channel: 'msedge' })
  const report = []
  try {
    await fixture.login()
    const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: 'zh-CN' })
    const page = await context.newPage()
    await page.goto(`${fixture.base}/admin/login`, { waitUntil: 'networkidle' })
    await page.locator('[data-test="admin-login-username"]').fill(fixture.username)
    await page.locator('[data-test="admin-login-password"]').fill(fixture.password)
    await Promise.all([
      page.waitForURL(`${fixture.base}/admin`),
      page.locator('[data-test="admin-login-submit"]').click(),
    ])
    await page.locator('[data-test="admin-tab-ingest"]').click()

    // Two seasons, ten named episodes: enough to need several rows.
    const bytes = await import('node:fs/promises').then(fs => fs.readFile(sample))
    const names = []
    for (const season of [1, 2]) {
      for (let episode = 1; episode <= 5; episode++) {
        names.push({ name: `潮声来处 S0${season}E0${episode}.mp4`, mimeType: 'video/mp4', buffer: bytes })
      }
    }
    await page.locator('[data-test="admin-video-file"]').setInputFiles(names)
    await page.locator('[data-test="admin-upload-submit"]').click()
    await page.waitForFunction(() => document.querySelectorAll('[data-test="admin-upload-results"] li').length >= 10, null, { timeout: 180_000 })
    report.push('uploaded 10 episodes across 2 seasons')

    const library = (await (await fetch(`${fixture.base}/api/library`)).json()).items
    const series = library.find(item => item.kind === 'series')
    report.push(`series: ${series?.title} (${library.length} titles)`)

    // Give episodes real names through the admin editor so the grid is exercised.
    const detail = await (await fetch(`${fixture.base}/api/library/${series.id}`)).json()
    report.push(`episodes: ${detail.episodes.length}, seasons: ${new Set(detail.episodes.map(e => e.season)).size}`)

    const fileIds = new Set()
    for (const episode of detail.episodes) fileIds.add(episode.media.id)
    const admin = await (await fetch(`${fixture.base}/api/admin/library`, { headers: { cookie: fixture.cookie() } })).json()
    const titles = ['潮起', '归港', '旧船', '灯塔', '夜航']
    for (const item of admin.items) {
      const match = item.fileName.match(/S0(\d)E0(\d)\.mp4/)
      if (!match) continue
      const body = {
        titleId: detail.id, kind: 'series', title: series.title,
        originalTitle: null, year: null, description: '海边的故事。',
        genres: [], region: null, rating: null, runtime: null, director: null, cast: [],
        posterPath: null, backdropPath: null,
        season: Number(match[1]), episode: Number(match[2]),
        episodeTitle: titles[Number(match[2]) - 1] ?? null,
        replaceExisting: true,
      }
      const response = await fetch(`${fixture.base}/api/admin/media/${item.id}`, {
        method: 'PATCH',
        headers: { origin: fixture.base, cookie: fixture.cookie(), 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) report.push(`patch ${item.fileName}: ${response.status} ${await response.text()}`)
      await response.body?.cancel()
    }

    const named = await (await fetch(`${fixture.base}/api/library/${series.id}`)).json()
    report.push(`named episodes: ${named.episodes.filter(e => e.title).length}`)

    await page.goto(`${fixture.base}/movie/${series.id}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    const metrics = await page.evaluate(() => {
      const grid = document.querySelector('.episode-grid')
      const tiles = [...document.querySelectorAll('.episode-tile')]
      const columns = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0
      const rows = new Set(tiles.map(tile => Math.round(tile.getBoundingClientRect().top))).size
      const clipped = tiles.filter(tile => {
        const label = tile.querySelector('.tile-label')
        return label ? label.scrollWidth > label.clientWidth + 1 : false
      }).length
      const buttons = document.querySelectorAll('.episode-action').length
      return { columns, rows, tiles: tiles.length, clipped, buttons, height: grid ? Math.round(grid.getBoundingClientRect().height) : 0 }
    })
    report.push(`grid: ${metrics.columns} columns x ${metrics.rows} rows, ${metrics.tiles} tiles, ${metrics.height}px tall`)
    report.push(`clipped labels: ${metrics.clipped}, per-episode buttons: ${metrics.buttons}`)
    // The grid must flow horizontally, never clip a name, and stay button-free.
    assert.ok(metrics.columns >= 4, `expected a horizontal grid, got ${metrics.columns} column(s)`)
    assert.ok(metrics.rows <= 2, `10 episodes should fit in at most 2 rows, got ${metrics.rows}`)
    assert.equal(metrics.tiles, 10)
    assert.equal(metrics.clipped, 0, 'episode names must not be truncated')
    assert.equal(metrics.buttons, 0, 'episodes must not repeat play/download buttons')
    await page.screenshot({ path: '.test-artifacts/episodes-desktop.png', fullPage: false })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(500)
    const mobile = await page.evaluate(() => {
      const grid = document.querySelector('.episode-grid')
      return {
        columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
        overflow: document.documentElement.scrollWidth - innerWidth,
      }
    })
    report.push(`mobile: ${mobile.columns} columns, page overflow ${mobile.overflow}px`)
    assert.ok(mobile.columns >= 2, `phones should still show a horizontal grid, got ${mobile.columns}`)
    assert.ok(mobile.overflow <= 1, `no horizontal overflow on phones, got ${mobile.overflow}px`)
    await page.screenshot({ path: '.test-artifacts/episodes-mobile.png', fullPage: false })
    await context.close()
  } finally {
    console.log(report.join('\n'))
    await browser.close()
  }
})
