import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from 'playwright-core'
import { runtimeFixture } from './helpers/runtime.mjs'

const control = id => `[data-test="${id}"]`

async function assertTransportLayout(page, label) {
  const bar = page.locator('.watch-stage .watch-transport')
  await bar.locator(control('player-track')).waitFor()
  const layout = await bar.evaluate(node => {
    const video = node.closest('.watch-stage').querySelector('video')
    const row = node.querySelector('.watch-transport-row')
    const bounds = el => el?.getBoundingClientRect().toJSON()
    const track = node.querySelector('[data-test="player-track"]')
    const ids = ['player-play', 'episode-prev', 'episode-next', 'player-volume', 'player-clock',
      'watch-speed', 'player-screenshot', 'player-settings', 'player-pip', 'player-fullscreen']
    return {
      nativeControls: video.controls,
      backgroundColor: getComputedStyle(node).backgroundColor,
      backgroundImage: getComputedStyle(node).backgroundImage,
      hasPiP: document.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function',
      stage: bounds(node.closest('.watch-stage')),
      track: bounds(track),
      row: bounds(row),
      buttons: Object.fromEntries(ids.map(id => [id, bounds(row?.querySelector(`[data-test="${id}"]`))])),
    }
  })
  assert.equal(layout.nativeControls, false, `${label}: Edge native controls never render`)
  assert.equal(layout.backgroundColor, 'rgba(0, 0, 0, 0)', `${label}: the transport has a transparent background`)
  assert.equal(layout.backgroundImage, 'none', `${label}: no gradient or image obscures the video behind the transport`)
  const { stage, track, row, buttons } = layout
  assert.ok(track && row, `${label}: progress track and control row are present`)
  assert.ok(track.height > 0 && track.width >= row.width * 0.85, `${label}: the progress line spans the row`)
  assert.ok(track.bottom <= row.top + 1, `${label}: progress track is above the buttons`)
  assert.ok(row.left >= stage.left - 1 && row.right <= stage.right + 1, `${label}: the control row fits within the player`)
  const ordered = Object.entries(buttons).filter(([id]) => id !== 'player-pip' || layout.hasPiP)
  let previousRight = row.left - 1
  for (const [id, box] of ordered) {
    assert.ok(box?.width > 0 && box.height > 0, `${label}: ${id} is displayed in the transport row`)
    assert.ok(box.left >= previousRight - 1, `${label}: ${id} follows the previous control without overlap`)
    assert.ok(box.right <= stage.right + 1, `${label}: ${id} does not overflow the stage`)
    assert.ok(box.top >= row.top - 1 && box.bottom <= row.bottom + 1, `${label}: ${id} stays in the button row`)
    assert.ok(Math.abs(box.y + box.height / 2 - (row.y + row.height / 2)) < 5,
      `${label}: ${id} is vertically aligned with the other buttons`)
    previousRight = box.right
  }
  if (!layout.hasPiP) assert.equal(buttons['player-pip'], undefined, `${label}: unsupported PiP is omitted`)
  const midpoint = stage.x + stage.width / 2
  assert.ok(buttons['episode-next'].right <= midpoint, `${label}: episode navigation is on the left`)
  assert.ok(buttons['player-settings'].left >= midpoint, `${label}: settings and fullscreen are on the right`)
  assert.match(await bar.locator(control('episode-next')).getAttribute('title') ?? '', /下一集：第 \d+ 季第 \d+ 集/)
}

test('Edge: custom transport layout across widths, volume, rate, settings, and frame download', { timeout: 240_000 }, async t => {
  await mkdir('.test-artifacts', { recursive: true })
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  const browser = await chromium.launch({ channel: 'msedge' })
  try {
    await fx.login()
    for (let i = 1; i <= 3; i++) await fx.stage(`播放控件 第${i}集.mp4`)
    await fx.scan()
    const series = (await (await fx.request('/api/library?kind=series')).json()).items[0]
    const detail = await (await fx.request(`/api/library/${series.id}`)).json()
    const middle = [...detail.episodes].sort((a, b) => a.episode - b.episode)[1]
    const url = `${fx.base}/watch/${series.id}?episode=${middle.id}`

    const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
    await desktop.goto(url, { waitUntil: 'networkidle' })
    await desktop.waitForFunction(() => document.querySelector('video')?.readyState >= 1, null, { timeout: 20_000 })
    await assertTransportLayout(desktop, '1440px desktop')
    await desktop.setViewportSize({ width: 800, height: 900 })
    await assertTransportLayout(desktop, '800px desktop')
    await desktop.setViewportSize({ width: 1440, height: 900 })

    const bar = desktop.locator('.watch-transport')
    const video = desktop.locator('video')
    const mute = bar.locator(control('player-volume'))
    await mute.click()
    await desktop.waitForFunction(() => document.querySelector('video').muted)
    await mute.click()
    await desktop.waitForFunction(() => !document.querySelector('video').muted)
    await bar.locator(control('watch-speed')).selectOption('1.5')
    assert.equal(await video.evaluate(node => node.playbackRate), 1.5, 'the speed control changes actual media playback rate')

    const settings = bar.locator(control('player-settings'))
    await settings.click()
    const volume = bar.locator('input[type="range"]:not([data-test="player-track"])')
    await volume.waitFor()
    await volume.press('Home')
    assert.equal(await video.evaluate(node => node.volume), 0, 'the volume slider can reach zero volume')
    await volume.press('End')
    assert.equal(await video.evaluate(node => node.volume), 1, 'the volume slider can restore full volume')
    await settings.click()
    await volume.waitFor({ state: 'hidden' })

    // Wait for a decoded frame, then exercise the actual browser download path.
    await video.evaluate(node => { node.currentTime = 2 })
    await desktop.waitForFunction(() => {
      const video = document.querySelector('video')
      return video.readyState >= 2 && !video.seeking
    }, null, { timeout: 20_000 })
    const [frame] = await Promise.all([
      desktop.waitForEvent('download', { timeout: 10_000 }),
      bar.locator(control('player-screenshot')).click(),
    ])
    assert.match(frame.suggestedFilename(), /\.png$/i)
    const png = await readFile(await frame.path())
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'the download is a PNG')
    assert.equal(png.subarray(12, 16).toString(), 'IHDR')
    assert.ok(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0, 'the PNG contains a nonempty frame')

    const phone = await browser.newPage({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, locale: 'zh-CN',
    })
    await phone.goto(url, { waitUntil: 'networkidle' })
    await phone.waitForFunction(() => document.querySelector('video')?.readyState >= 1, null, { timeout: 20_000 })
    await assertTransportLayout(phone, '390px touch')
    await phone.screenshot({ path: '.test-artifacts/transport-phone.png' })
    await phone.setViewportSize({ width: 320, height: 812 })
    await assertTransportLayout(phone, '320px touch')

    const track = phone.locator(control('player-track'))
    const box = await track.boundingBox()
    assert.ok(box, 'the touch track is available to tap')
    await phone.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await phone.waitForFunction(() => {
      const video = document.querySelector('video')
      return !video.seeking && Math.abs(video.currentTime - video.duration / 2) < 1
    }, null, { timeout: 10_000 })
    assert.match(await phone.locator(control('player-clock')).textContent(), /0{1,2}:24\s*\/\s*0{1,2}:48/)
    await phone.screenshot({ path: '.test-artifacts/transport-phone-seeked.png' })
  } finally {
    await browser.close()
  }
})
