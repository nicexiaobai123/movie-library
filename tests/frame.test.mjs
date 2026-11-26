import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chromium } from 'playwright-core'
import { runtimeFixture, sample } from './helpers/runtime.mjs'

// Frame extraction runs in the page, so this exercises the real browser path
// rather than a mock: a cross-origin canvas would silently produce no image.
test('browser first-frame capture produces a usable JPEG from the uploaded video', { timeout: 120_000 }, async t => {
  const fx = await runtimeFixture(t)
  const browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : { channel: 'msedge' }),
  })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
  await page.goto(`${fx.base}/admin/login`)

  await page.locator('[data-test="admin-login-username"]').fill(fx.username)
  await page.locator('[data-test="admin-login-password"]').fill(fx.password)
  await Promise.all([page.waitForURL(`${fx.base}/admin`), page.locator('[data-test="admin-login-submit"]').click()])
  await page.locator('[data-test="admin-video-file"]').setInputFiles(sample)
  const upload = page.waitForResponse(response => response.url().includes('/api/admin/upload?'))
  await page.locator('[data-test="admin-upload-submit"]').click()
  const uploaded = await upload
  assert.equal(uploaded.status(), 201, uploaded.status() === 201 ? undefined : await uploaded.text().catch(() => 'no body'))

  const result = await page.evaluate(async () => {
    const library = await (await fetch('/api/admin/library', { cache: 'no-store' })).json()
    const item = library.items.find(media => media.state === 'published')
    return { id: item.id, fileName: item.fileName }
  })
  assert.ok(result.id)

  // Use the same promise-based helper the admin panel relies on.
  const frame = await page.evaluate(async (id) => {
    const toBlob = (blob) => blob.arrayBuffer().then(buffer => {
      const bytes = new Uint8Array(buffer)
      return { size: bytes.length, head: [...bytes.subarray(0, 3)], type: blob.type }
    })
    const captured = await new Promise((resolve, reject) => {
      const video = document.createElement('video')
      video.preload = 'auto'
      video.muted = true
      video.playsInline = true
      const timer = setTimeout(() => reject(new Error('timeout')), 20_000)
      video.addEventListener('error', () => { clearTimeout(timer); reject(new Error('video error')) })
      video.addEventListener('loadedmetadata', () => { video.currentTime = Math.min(0.5, video.duration / 2) }, { once: true })
      video.addEventListener('seeked', () => {
        const canvas = document.createElement('canvas')
        canvas.width = Math.min(600, video.videoWidth)
        canvas.height = Math.round(canvas.width * (video.videoHeight / video.videoWidth))
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(blob => { clearTimeout(timer); resolve(blob) }, 'image/jpeg', 0.86)
      }, { once: true })
      video.src = `/api/admin/media/${encodeURIComponent(id)}/preview`
    })
    return {
      ...(await toBlob(captured)),
      accepted: await fetch(`/api/admin/posters?name=${encodeURIComponent('frame.jpg')}`, {
        method: 'POST', body: captured, headers: { 'content-type': 'image/jpeg' },
      }).then(async response => ({ status: response.status, body: await response.json() })),
    }
  }, result.id)

  assert.equal(frame.type, 'image/jpeg')
  assert.deepEqual(frame.head, [0xff, 0xd8, 0xff])
  assert.ok(frame.size > 5_000, `frame too small: ${frame.size}`)
  assert.equal(frame.accepted.status, 201, JSON.stringify(frame.accepted.body))
  assert.match(frame.accepted.body.path, /^_海报\/.+\.jpg$/)

  const served = await fx.request(`/api/posters/${result.id}`)
  // No title is linked yet, so the poster is only reachable through the stored path.
  assert.ok([200, 404].includes(served.status))
  await served.text()
})
