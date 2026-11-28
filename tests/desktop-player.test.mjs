import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from 'playwright-core'
import { runtimeFixture } from './helpers/runtime.mjs'

const control = id => `[data-test="${id}"]`

async function assertSeekNotice(page, text) {
  const notice = page.locator('.watch-stage .watch-seek').filter({ hasText: text })
  await notice.locator('svg').waitFor({ timeout: 5000 })
  const position = await notice.evaluate(node => {
    const stage = node.closest('.watch-stage')
    const bounds = stage.getBoundingClientRect()
    const box = node.getBoundingClientRect()
    const style = getComputedStyle(node)
    return {
      fullscreen: document.fullscreenElement === stage,
      visible: style.visibility === 'visible' && Number(style.opacity) > 0 && box.width > 0 && box.height > 0,
      rightGap: bounds.right - box.right,
      bottomGap: bounds.bottom - box.bottom,
      belowMidpoint: box.top > bounds.top + bounds.height / 2,
    }
  })
  assert.ok(position.fullscreen && position.visible, 'the SVG seek notice is visible inside the fullscreen stage')
  assert.ok(position.rightGap >= -1 && position.rightGap <= 40 && position.bottomGap >= 0 && position.belowMidpoint,
    `the notice sits at the bottom right: ${JSON.stringify(position)}`)
}

test('Edge: fullscreen contains the custom transport, centred play button, and 5s seek notices', { timeout: 240_000 }, async t => {
  await mkdir('.test-artifacts', { recursive: true })
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  const browser = await chromium.launch({ channel: 'msedge' })
  try {
    await fx.login()
    await fx.stage('全屏控件.mp4')
    await fx.scan()
    const movie = (await (await fx.request('/api/library?kind=movie')).json()).items[0]
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
    const page = await context.newPage()
    await page.goto(`${fx.base}/watch/${movie.id}`, { waitUntil: 'networkidle' })
    const video = page.locator('.watch-stage video')
    await page.waitForFunction(() => document.querySelector('.watch-stage video')?.readyState >= 1, null, { timeout: 20_000 })
    assert.equal(await video.evaluate(node => node.controls), false, 'fullscreen starts from the same custom player as inline')

    const stage = page.locator('.watch-stage')
    const transport = stage.locator('.watch-transport')
    const fullscreen = transport.locator(control('player-fullscreen'))
    const play = transport.locator(control('player-play'))
    const mark = stage.locator(`.watch-paused-mark${control('paused-mark')}`)

    // Start and pause through the transport so this also exercises its real event handlers.
    await play.click()
    await page.waitForFunction(() => !document.querySelector('video').paused)
    await mark.waitFor({ state: 'hidden' })
    await stage.hover({ position: { x: 20, y: 64 } })
    await play.click()
    await page.waitForFunction(() => document.querySelector('video').paused)
    await mark.waitFor()

    await fullscreen.click()
    await page.waitForFunction(() => document.fullscreenElement === document.querySelector('.watch-stage'))
    await page.waitForFunction(() => {
      const bar = document.fullscreenElement?.querySelector('.watch-transport')
      return bar && Number(getComputedStyle(bar).opacity) > 0 && bar.getBoundingClientRect().height > 0
    })
    assert.ok(await fullscreen.isVisible(), 'the fullscreen toggle remains in the visible custom bar')
    assert.match(await fullscreen.getAttribute('aria-label') ?? '', /退出全屏/)

    // The paused overlay must be a real, keyboard-accessible button over the picture.
    const centrePlay = stage.getByRole('button', { name: /^(播放|继续播放)$/ }).and(mark)
    await centrePlay.locator('svg').waitFor()
    const [markBox, stageBox] = await Promise.all([centrePlay.boundingBox(), stage.boundingBox()])
    assert.ok(markBox && stageBox, 'the TV-shaped play button and stage are visible in fullscreen')
    const dx = Math.abs(markBox.x + markBox.width / 2 - (stageBox.x + stageBox.width / 2))
    const dy = Math.abs(markBox.y + markBox.height / 2 - (stageBox.y + stageBox.height / 2))
    assert.ok(dx < 16 && dy < 16, `the play button is centred (${dx}px, ${dy}px)`)
    await page.screenshot({ path: '.test-artifacts/desktop-paused.png' })
    await centrePlay.click()
    await page.waitForFunction(() => !document.querySelector('video').paused)
    await mark.waitFor({ state: 'hidden' })
    await stage.hover({ position: { x: 20, y: 64 } })
    await play.click()
    await page.waitForFunction(() => document.querySelector('video').paused)

    // Keyboard seeking must update both the native media time and the SVG notice in fullscreen.
    await video.evaluate(node => { node.currentTime = 12 })
    await video.focus()
    await page.keyboard.press('ArrowRight')
    await assertSeekNotice(page, /快进\s*5\s*秒/)
    assert.ok(Math.abs(await video.evaluate(node => node.currentTime) - 17) < 0.5, 'ArrowRight advances exactly five seconds')
    await page.screenshot({ path: '.test-artifacts/notice-bottom-right.png' })
    await page.keyboard.press('ArrowLeft')
    await assertSeekNotice(page, /快退\s*5\s*秒/)
    assert.ok(Math.abs(await video.evaluate(node => node.currentTime) - 12) < 0.5, 'ArrowLeft goes back exactly five seconds')

    // After playing via the mouse, the play button may retain focus. Keyboard
    // seeking still must not wake the auto-hidden bar, even with that focus.
    await play.click()
    await page.waitForFunction(() => {
      const stage = document.fullscreenElement
      const bar = stage?.querySelector('.watch-transport')
      return bar?.classList.contains('is-hidden') && Number(getComputedStyle(bar).opacity) === 0
    })
    for (const [key, label] of [['ArrowRight', /快进\s*5\s*秒/], ['ArrowLeft', /快退\s*5\s*秒/]]) {
      await page.keyboard.press(key)
      await assertSeekNotice(page, label)
      assert.deepEqual(await transport.evaluate(node => ({
        hidden: node.classList.contains('is-hidden'),
        opacity: getComputedStyle(node).opacity,
        pointerEvents: getComputedStyle(node).pointerEvents,
      })), { hidden: true, opacity: '0', pointerEvents: 'none' }, `${key} shows only the seek notice`)
    }
    await page.screenshot({ path: '.test-artifacts/seek-controls-hidden.png' })
    await stage.hover({ position: { x: 20, y: 64 } })
    await play.click()
    await page.waitForFunction(() => document.querySelector('video').paused)

    await fullscreen.click()
    await page.waitForFunction(() => document.fullscreenElement === null)

    // In browsers that deny container fullscreen, the in-page expansion still
    // hosts the same controls and feedback instead of fullscreening only video.
    await stage.evaluate(node => { node.requestFullscreen = () => Promise.reject(new Error('Fullscreen unavailable')) })
    await fullscreen.click()
    await page.waitForFunction(() => document.querySelector('.watch-stage').classList.contains('is-expanded-fallback'))
    const expanded = await stage.boundingBox()
    assert.ok(expanded && expanded.x === 0 && expanded.y === 0 && expanded.width === 1440 && expanded.height === 900)
    assert.ok(await mark.isVisible(), 'the centre play button also stays visible in the expanded player')
    await page.keyboard.press('ArrowRight')
    await stage.locator('.watch-seek').filter({ hasText: /快进\s*5\s*秒/ }).locator('svg').waitFor()
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.watch-stage').classList.contains('is-expanded-fallback'))
    await context.close()
  } finally {
    await browser.close()
  }
})
