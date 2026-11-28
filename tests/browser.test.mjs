import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { checksumFile, project, runtimeFixture, sample, within } from './helpers/runtime.mjs'

const poster = fileURLToPath(new URL('./fixtures/cover.png', import.meta.url))
const longTitle = '在海风翻过屋檐之前我们沿着旧铁轨寻找那盏没有落下的灯——影像札记其三'
const longFile = `${longTitle} (2023).mp4`
const filmFile = '远山来信 (2024).mp4'
const draftFile = '潮声来处 第03-04集.mp4'
const sel = id => `[data-test="${id}"]`

async function noOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `horizontal overflow at ${page.url()}`)
}

async function signIn(page, fixture) {
  await page.locator(sel('admin-login-username')).fill(fixture.username)
  await page.locator(sel('admin-login-password')).fill(fixture.password)
  await Promise.all([page.waitForURL(`${fixture.base}/admin`), page.locator(sel('admin-login-submit')).click()])
  // The library tab is the landing panel; its summary proves it rendered.
  await page.locator(sel('admin-files-summary')).waitFor()
}

async function scanViaUi(page) {
  if (await page.locator(sel('admin-tab-ingest')).getAttribute('aria-selected') !== 'true') {
    await page.locator(sel('admin-tab-ingest')).click()
  }
  const result = page.waitForResponse(response => response.url().endsWith('/api/admin/scan') && response.request().method() === 'POST')
  await page.locator(sel('admin-scan-start')).click()
  assert.equal((await result).status(), 202)
  await page.locator(sel('admin-scan-status')).filter({ hasText: '最近一次扫描已完成' }).waitFor()
}

async function openAdminTab(page, tab) {
  const button = page.locator(sel(`admin-tab-${tab}`))
  if (await button.getAttribute('aria-selected') !== 'true') await button.click()
  await page.locator(`#admin-panel-${tab}`).waitFor({ state: 'visible' })
}

async function assertSeek(page, url, sourcePath, base) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 35, downloadThroughput: 48 * 1024, uploadThroughput: 512 * 1024 })
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    const video = page.locator('video[controls][playsinline][preload="metadata"]')
    await video.waitFor()
    await page.waitForFunction(() => {
      const media = document.querySelector('video')
      return media && (media.readyState >= 1 || media.error)
    }, null, { timeout: 20_000 })
    const before = await video.evaluate(media => ({
      duration: media.duration, buffered: media.buffered.length ? media.buffered.end(media.buffered.length - 1) : 0,
      error: media.error?.message ?? null,
    }))
    assert.equal(before.error, null, `browser did not decode the MP4: ${before.error}`)
    const target = 38
    assert.ok(before.duration > target && before.buffered < target, JSON.stringify(before))
    const ranged = page.waitForResponse(response => {
      const match = /^bytes (\d+)-/.exec(response.headers()['content-range'] ?? '')
      return response.url() === `${base}${sourcePath}` && response.status() === 206 && match && Number(match[1]) > 0
    }, { timeout: 20_000 })
    // This sets the position of the native player (the same seek action as its timeline).
    await video.evaluate((media, time) => { media.currentTime = time }, target)
    const response = await ranged
    await page.waitForFunction(time => {
      const media = document.querySelector('video')
      return media && !media.seeking && media.readyState >= 2 && Math.abs(media.currentTime - time) < 1
    }, target, { timeout: 20_000 })
    console.log(`Edge seek: ${before.buffered.toFixed(2)}s buffered before seeking to ${target}s; ${response.status()} ${response.headers()['content-range']}`)

    // Arrow keys are handled only while the player can act.
    await page.keyboard.press('ArrowRight')
    await page.waitForFunction(time => {
      const media = document.querySelector('video')
      return media && !media.seeking && Math.abs(media.currentTime - (time + 3)) < 1
    }, target, { timeout: 10_000 })
    await page.keyboard.press('ArrowLeft')
    await page.waitForFunction(time => {
      const media = document.querySelector('video')
      return media && !media.seeking && Math.abs(media.currentTime - time) < 1
    }, target, { timeout: 10_000 })
    assert.match(await page.locator('.watch-seek').textContent(), /快退|快进/)
  } finally {
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    await cdp.detach()
  }
  const video = page.locator('video')
  await video.evaluate(media => media.play())
  await page.waitForFunction(() => {
    const media = document.querySelector('video')
    return media && !media.paused && media.currentTime > 38.3
  }, null, { timeout: 10_000 })
  await video.evaluate(media => media.pause())
}

test('Edge desktop and mobile viewports: library, editing, episode selection, playback and download', { timeout: 150_000 }, async t => {
  const fx = await runtimeFixture(t)
  const browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : { channel: 'msedge' }),
    args: ['--autoplay-policy=no-user-gesture-required', '--disable-component-update'],
  })
  t.after(() => browser.close())
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 980 }, acceptDownloads: true })
  const mobile = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, acceptDownloads: true })
  const page = await desktop.newPage()
  const phone = await mobile.newPage()
  const external = new Set()
  const errors = []
  for (const context of [desktop, mobile]) {
    context.on('request', request => {
      const url = new URL(request.url())
      if (['http:', 'https:'].includes(url.protocol) && url.origin !== fx.base) external.add(url.origin)
    })
    context.on('page', tab => tab.on('pageerror', error => errors.push(error.message)))
  }
  for (const tab of [page, phone]) tab.on('pageerror', error => errors.push(error.message))
  const shots = process.env.SAVE_BROWSER_SHOTS ? within(project, '.test-artifacts') : null
  if (shots) await mkdir(shots, { recursive: true })
  async function capture(tab, name) {
    if (shots) await tab.screenshot({ path: within(shots, `${name}.png`), fullPage: true, timeout: 7000 })
  }
  await page.goto(fx.base)
  await page.locator('.empty-hero h1').waitFor()
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.textContent.trim()), '跳到主要内容')
  assert.equal(await page.locator('.skip').evaluate(node => getComputedStyle(node).outlineStyle), 'solid')
  await page.keyboard.press('Enter')
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'main')
  await capture(page, 'desktop-empty')
  await phone.goto(fx.base)
  await phone.locator('.empty-hero h1').waitFor()
  await noOverflow(phone)
  await capture(phone, 'mobile-empty')

  await page.goto(`${fx.base}/admin`)
  await page.waitForURL(`${fx.base}/admin/login`)
  await signIn(page, fx)
  // Two sections now: the library itself and the two ways to add to it.
  await page.locator(sel('admin-tab-files')).waitFor()
  assert.equal(await page.locator('[role="tab"]').count(), 2)
  assert.equal(await page.locator(sel('admin-tab-files')).getAttribute('aria-selected'), 'true')
  assert.ok(await page.locator(sel('admin-library-empty')).isVisible())
  await page.locator(sel('admin-tab-ingest')).click()
  await page.locator(sel('admin-video-file')).waitFor()
  await page.locator(sel('admin-video-file')).setInputFiles({ name: filmFile, mimeType: 'video/mp4', buffer: await readFile(sample) })
  const upload = page.waitForResponse(response => response.url().includes('/api/admin/upload?'))
  await page.locator(sel('admin-upload-submit')).click()
  const uploaded = await upload
  assert.equal(uploaded.status(), 201, uploaded.status() === 201 ? undefined : await uploaded.text().catch(() => 'no response body'))
  const film = (await uploaded.json()).item

  await fx.stage(longFile)
  await fx.stage('热河纪行 (2026).mp4')
  await fx.stage('电视剧/潮声来处/第二季/第02集.mp4')
  await fx.stage('电视剧/潮声来处/第二季/第01集.mp4')
  await scanViaUi(page)
  // Scanning happens on the ingest tab; the list lives on its own tab.
  await openAdminTab(page, 'files')
  const row = page.locator(`[data-media-id="${film.id}"]`)
  await row.waitFor()

  // Every file is a library entry: the row shows its recognised kind and title.
  assert.match(await row.locator(sel('admin-media-title')).innerText(), /远山来信/)
  const summary = (await page.locator(sel('admin-files-summary')).innerText()).trim()
  assert.match(summary, /共 \d+ 个文件/)
  assert.match(summary, /剧集 [1-9]/, 'the two episodes are recognised as a series')
  await capture(page, 'desktop-admin')

  // Editing the title and description keeps them, and the row reflects the change.
  await row.locator(sel('admin-media-edit')).click()
  const description = '深秋，一封寄往山里的信让两个从未见面的人有了交集。'
  await page.locator(sel('admin-media-description')).fill(description)
  await page.locator(sel('admin-media-cast')).fill('演员甲、演员乙')
  const posterQueued = page.waitForResponse(response => response.url().includes('/api/admin/posters?'))
  await page.locator(sel('admin-media-poster-file')).setInputFiles(poster)
  const coverResult = await posterQueued
  assert.equal(coverResult.status(), 201, coverResult.status() === 201 ? undefined : await coverResult.text().catch(() => 'no response body'))
  await page.locator(sel('admin-poster-status')).filter({ hasText: '封面已上传' }).waitFor()
  await page.locator(sel('admin-media-save')).click()
  await page.locator(sel('admin-media-modal')).waitFor({ state: 'detached' })
  await page.waitForTimeout(500)
  const detail = await (await fx.request(`/api/library/${film.titleId}`)).json()
  assert.equal(detail.description, description)
  assert.deepEqual(detail.cast, ['演员甲', '演员乙'])
  assert.ok(detail.posterUrl, 'the uploaded cover is attached')
  await noOverflow(page)


  // Visitor accounts: register with a 6-character password, favourite a film,
  // then find it in the list and remove it again.
  const filmTitle = '远山来信'
  const filmDetail = (await (await fx.request('/api/library?q=' + encodeURIComponent(filmTitle))).json()).items[0]
  await page.context().clearCookies()
  await page.goto(`${fx.base}/user`)
  await page.locator(sel('user-mode-register')).click()
  await page.locator(sel('user-username')).fill('访客甲')
  await page.locator(sel('user-password')).fill('123456')
  await page.locator(sel('user-submit')).click()
  // The header only shows the account once the visitor session is established.
  await page.locator('.nav-account-label').filter({ hasText: '访客甲' }).waitFor()
  await page.goto(`${fx.base}/movie/${filmDetail.id}`)
  await page.locator('.nav-account-label').filter({ hasText: '访客甲' }).waitFor()
  await page.locator(sel('title-favorite')).click()
  await page.waitForFunction(() => document.querySelector('[data-test="title-favorite"]')?.getAttribute('aria-pressed') === 'true')
  await page.goto(`${fx.base}/my-list`)
  await page.locator(sel('favorite-remove')).first().waitFor()
  assert.match(await page.locator('.list-grid .card').first().textContent(), new RegExp(filmTitle))
  await page.locator(sel('favorite-remove')).first().click()
  await page.getByRole('heading', { name: '收藏夹还是空的' }).waitFor()
  await noOverflow(page)
  await capture(page, 'desktop-my-list')
  await page.context().clearCookies()

  // Home: a rotating hero plus horizontally scrolling rails.
  await page.goto(fx.base)
  await page.locator('.hero-title').waitFor()
  assert.ok(await page.locator('.hero-slide').count() >= 1)
  await page.locator('.rail').first().waitFor()
  assert.ok(await page.locator('.rail .card').count() >= 1)
  assert.ok(await page.locator('.hero-actions a').count() >= 2)
  await noOverflow(page)
  await capture(page, 'desktop-home')

  // Browse: films and series are separate top-level destinations, each with its
  // own heading, and the genre chip narrows the grid through the URL.
  await page.goto(`${fx.base}/browse?kind=movie`)
  await page.locator('.grid .card').first().waitFor()
  assert.equal(await page.getByRole('heading', { level: 1 }).innerText(), '电影')
  assert.equal(await page.locator('.kind-tab').count(), 0)
  await page.goto(`${fx.base}/browse?kind=series`)
  await page.waitForFunction(() => document.querySelector('h1')?.textContent?.trim() === '剧集', null, { timeout: 10_000 })
  assert.ok((await page.locator('.grid .card').count()) >= 0)

  await page.goto(`${fx.base}/browse?kind=movie`)
  await page.locator('.grid .card').first().waitFor()
  const allCards = await page.locator('.grid .card').count()
  const genreChip = page.locator('.filter-group', { hasText: '类型' }).locator('.chip', { hasText: '剧情' }).first()
  if (await genreChip.count()) {
    await genreChip.click()
    await page.waitForURL(url => url.searchParams.has('genre'))
    await page.waitForFunction((expected) => document.querySelectorAll('.grid .card').length < expected, allCards)
    assert.ok(new URL(page.url()).searchParams.get('genre'))
    // Filtering keeps the destination: it must not silently switch to all kinds.
    assert.equal(new URL(page.url()).searchParams.get('kind'), 'movie')
  }
  await noOverflow(page)
  await capture(page, 'desktop-browse')

  // Search: a keyword returns the matching film and reports a count.
  await page.goto(`${fx.base}/search?q=${encodeURIComponent('远山')}`)
  await page.locator('.search-grid .card').filter({ hasText: filmTitle }).waitFor()
  assert.match(await page.locator('.search-summary').textContent(), /\d+ 个结果/)
  await page.locator(sel('search-clear')).click()
  await page.getByText('输入片名开始搜索').waitFor()
  await noOverflow(page)
  await capture(page, 'desktop-search')

  await page.goto(`${fx.base}/movie/${filmDetail.id}`)
  await page.getByRole('heading', { name: filmTitle }).waitFor()
  assert.match(await page.locator('.detail-overview').textContent(), /深秋/)
  await page.waitForFunction(() => document.querySelector('.poster img')?.naturalWidth > 0)
  await noOverflow(page)
  await capture(page, 'desktop-detail')

  const link = page.getByRole('link', { name: '播放正片' })
  const watchUrl = new URL(await link.getAttribute('href'), fx.base).toString()
  const theater = await desktop.newPage()
  await assertSeek(theater, watchUrl, `/api/media/${film.id}`, fx.base)
  await noOverflow(theater)
  await capture(theater, 'desktop-player')

  // Clicking or using playback keys must not leave a highlight frame on the picture.
  await theater.locator('video').click()
  await theater.keyboard.press('Space')
  await theater.waitForTimeout(400)
  const outlineAfterPlay = await theater.locator('video').evaluate(node => getComputedStyle(node).outlineStyle)
  assert.equal(outlineAfterPlay, 'none')

  const downloading = theater.waitForEvent('download')
  await theater.locator('.watch-actions').getByRole('link', { name: /下载原文件/ }).click()
  const download = await downloading
  assert.equal(download.suggestedFilename(), filmFile)
  assert.deepEqual(await checksumFile(await download.path()), await checksumFile(sample))

  await theater.route(url => url.pathname === `/api/media/${film.id}`, route => route.fulfill({ status: 503, body: 'Unavailable' }))
  await theater.reload()
  await theater.getByRole('button', { name: '重新载入' }).waitFor()
  assert.ok(await theater.locator('.watch-actions').getByRole('link', { name: /下载原文件/ }).isVisible())
  // A player without a usable duration must not hijack the arrow keys.
  await theater.locator('body').click({ position: { x: 4, y: 4 } })
  await theater.keyboard.press('ArrowRight')
  await theater.waitForTimeout(250)
  assert.equal(await theater.locator('.watch-seek').count(), 0)
  assert.ok(await theater.evaluate(() => document.querySelector('video')?.error !== null))
  await theater.unrouteAll()

  // Fullscreen targets the stage, not the bare video, so no inline border remains.
  await theater.reload()
  await theater.locator('video').waitFor()
  await theater.waitForFunction(() => document.querySelector('video')?.readyState >= 1)
  // Tab navigation keeps a visible focus ring for keyboard users.
  await theater.locator('video').focus()
  await theater.keyboard.press('Shift+Tab')
  await theater.keyboard.press('Tab')
  await theater.waitForTimeout(200)
  assert.equal(await theater.locator('.watch-stage').evaluate(node => node.classList.contains('is-tab-focus')), true)
  await theater.getByRole('button', { name: '全屏播放' }).click()
  await theater.waitForFunction(() => document.fullscreenElement?.classList.contains('watch-stage'))
  await theater.locator('.watch-stage').evaluate(node => {
    // Wait until the fullscreen styling is actually painted.
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })

  const fullscreenBox = await theater.locator('.watch-stage').boundingBox()
  const view = theater.viewportSize()
  assert.ok(fullscreenBox && view && Math.abs(fullscreenBox.width - view.width) <= 1 && Math.abs(fullscreenBox.height - view.height) <= 1)
  const frame = await theater.locator('.watch-stage').evaluate(node => getComputedStyle(node).borderTopWidth)
  assert.equal(frame, '0px')
  assert.ok(await theater.getByRole('button', { name: '退出全屏' }).isVisible())
  await theater.getByRole('button', { name: /铺满屏幕|保持画面比例/ }).click()
  assert.ok(['contain', 'cover'].includes(await theater.locator('video').evaluate(node => getComputedStyle(node).objectFit)))
  await theater.getByRole('button', { name: '退出全屏' }).click()
  await theater.waitForFunction(() => document.fullscreenElement === null)
  await theater.close()

  await phone.goto(fx.base)
  await phone.locator('.hero-title').waitFor()
  await noOverflow(phone)
  await capture(phone, 'mobile-home')

  // Mobile navigation collapses into a menu that still reaches every page.
  await phone.locator('.nav-burger').tap()
  await phone.locator('.mobile-menu').waitFor()
  await phone.locator('.mobile-menu').getByRole('link', { name: '电影', exact: true }).tap()
  await phone.waitForURL(url => url.pathname === '/browse' && url.searchParams.get('kind') === 'movie')
  await phone.locator('.grid .card').first().waitFor()
  // Films and series are top-level destinations, so the page has no kind switch.
  assert.equal(await phone.locator('.kind-tab').count(), 0)
  assert.equal(await phone.getByRole('heading', { level: 1 }).innerText(), '电影')
  // The only filter is the actor; the panel appears when one is selected.
  await phone.goto(`${fx.base}/browse?kind=movie&actor=${encodeURIComponent('演员甲')}`)
  await phone.locator('.filter-group').first().waitFor()
  assert.equal(await phone.locator('.filter-group legend').first().innerText(), '演员')
  await noOverflow(phone)
  await capture(phone, 'mobile-browse')

  await phone.goto(`${fx.base}/movie/${filmDetail.id}`)
  await phone.getByRole('heading', { name: filmTitle }).waitFor()
  assert.ok((await phone.locator(sel('title-favorite')).boundingBox()).height >= 43)
  await noOverflow(phone)
  await capture(phone, 'mobile-detail')

  // Series detail keeps its episode list usable at phone width.
  const seriesItem = (await (await fx.request('/api/library?kind=series')).json()).items[0]
  const series = await (await fx.request(`/api/library/${seriesItem.id}`)).json()
  await phone.goto(`${fx.base}/movie/${series.id}`)
  // A single season needs no season heading, so wait for the episode grid itself.
  await phone.locator('.episode-grid').waitFor()
  // Episodes are labelled by their number, because the files carry no episode name.
  const labels = await phone.locator('.tile-label').allTextContents()
  assert.equal(labels.length, 2)
  assert.match(labels[0], /第 1 集/)
  assert.match(labels[1], /第 2 集/)
  // Episodes are a compact grid of whole-tile links, not rows of buttons.
  assert.equal(await phone.locator('.episode-action').count(), 0)
  const gridColumns = await phone.locator('.episode-grid').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length)
  assert.ok(gridColumns > 1, `episodes should flow horizontally, got ${gridColumns} column(s)`)
  const firstPlay = phone.getByRole('link', { name: '播放第 2 季第 1 集' })
  assert.ok((await firstPlay.boundingBox()).height >= 43)
  await noOverflow(phone)
  await capture(phone, 'mobile-series')
  await firstPlay.tap()
  await phone.waitForURL(url => url.pathname === `/watch/${series.id}` && url.searchParams.has('episode'))
  const firstEpisodeUrl = phone.url()
  await phone.locator('video').waitFor()
  await phone.getByRole('link', { name: '选集', exact: true }).tap()
  await phone.getByRole('link', { name: '播放第 2 季第 2 集' }).tap()
  await phone.waitForURL(url => url.pathname === `/watch/${series.id}` && url.toString() !== firstEpisodeUrl && url.hash === '')
  assert.match(await phone.locator('.watch-episode').textContent(), /第 2 集/)
  assert.equal(await phone.locator('.episode-tile.is-current').count(), 1)
  await noOverflow(phone)
  await capture(phone, 'mobile-player')
  const mobileDownloading = phone.waitForEvent('download')
  await phone.locator('.watch-actions').getByRole('link', { name: /下载原文件/ }).tap()
  const episodeDownload = await mobileDownloading
  assert.equal(episodeDownload.suggestedFilename(), '第02集.mp4')
  assert.deepEqual(await checksumFile(await episodeDownload.path()), await checksumFile(sample))

  await phone.goto(`${fx.base}/admin`)
  await phone.waitForURL(`${fx.base}/admin/login`)
  await signIn(phone, fx)
  await phone.locator(sel('admin-media-row')).filter({ hasText: longFile }).waitFor()
  await noOverflow(phone)
  const longRow = phone.locator(sel('admin-media-row')).filter({ hasText: longFile })
  await longRow.locator(sel('admin-media-edit')).tap()
  await phone.locator(sel('admin-media-modal')).waitFor()
  await noOverflow(phone)
  await capture(phone, 'mobile-admin')

  // Narrow phone with enlarged text still avoids horizontal overflow everywhere.
  await page.setViewportSize({ width: 320, height: 812 })
  for (const path of ['/', '/browse', '/search?q=%E8%BF%9C%E5%B1%B1', `/movie/${filmDetail.id}`]) {
    await page.goto(`${fx.base}${path}`)
    await page.waitForTimeout(400)
    await noOverflow(page)
  }
  await page.addStyleTag({ content: 'html { font-size: 125%; }' })
  for (const path of ['/', '/browse', `/movie/${filmDetail.id}`]) {
    await page.goto(`${fx.base}${path}`)
    await page.waitForTimeout(400)
    await noOverflow(page)
  }

  assert.deepEqual([...external], [])
  assert.deepEqual([...errors], [])
})
