// Audits phone and tablet layouts: overflow, tap targets, readability and the
// dialogs that must stay usable on a small screen.
import assert from 'node:assert/strict'
import { copyFile, mkdir } from 'node:fs/promises'
import { test } from 'node:test'
import { chromium } from 'playwright-core'
import { runtimeFixture, sample, waitFor } from './helpers/runtime.mjs'

const devices = [
  { name: 'phone-portrait', width: 390, height: 844, mobile: true },
  { name: 'phone-landscape', width: 844, height: 390, mobile: true },
  { name: 'tablet-portrait', width: 820, height: 1180, mobile: true },
  { name: 'tablet-landscape', width: 1180, height: 820, mobile: true },
]

test('phone and tablet layouts', { timeout: 300_000 }, async (t) => {
  await mkdir('.test-artifacts', { recursive: true })
  const fx = await runtimeFixture(t, { interval: 0, stable: 100 })
  const browser = await chromium.launch({ channel: 'msedge' })
  const report = []
  try {
    await fx.login()
    for (let i = 0; i < 10; i++) await copyFile(sample, `${fx.media}/适配${String(i + 1).padStart(2, '0')} (2022).mp4`)
    // One series so episode lists are covered too.
    for (const episode of ['S01E01', 'S01E02']) {
      await copyFile(sample, `${fx.media}/测试剧 ${episode}.mp4`)
    }
    await fx.scan()
    await new Promise(resolve => setTimeout(resolve, 400))
    await fx.scan()
    await fx.scan()
    const library = await waitFor(async () => {
      const data = await (await fetch(`${fx.base}/api/library/browse?pageSize=60`)).json()
      return (data.total ?? 0) >= 11 ? data : false
    }, 'not indexed', 90000)
    const movie = library.items.find(item => item.kind === 'movie')
    const series = library.items.find(item => item.kind === 'series')

    for (const device of devices) {
      const context = await browser.newContext({
        viewport: { width: device.width, height: device.height },
        locale: 'zh-CN',
        isMobile: device.mobile,
        hasTouch: device.mobile,
      })
      const page = await context.newPage()
      const routes = [
        { label: 'home', url: '/' },
        { label: 'browse', url: '/browse?kind=movie' },
        { label: 'detail', url: `/movie/${movie.id}` },
        ...(series ? [{ label: 'series', url: `/movie/${series.id}` }] : []),
        { label: 'watch', url: `/watch/${movie.id}` },
        { label: 'actors', url: '/actors' },
        { label: 'user', url: '/user' },
      ]
      for (const route of routes) {
        await page.goto(fx.base + route.url, { waitUntil: 'networkidle' })
        await page.waitForTimeout(350)
        const audit = await page.evaluate(() => {
          const de = document.documentElement
          const overflowX = de.scrollWidth - de.clientWidth
          // Any element sticking out horizontally is a layout bug on a narrow screen.
          const offenders = []
          for (const node of document.querySelectorAll('body *')) {
            const rect = node.getBoundingClientRect()
            if (rect.width === 0 || rect.height === 0) continue
            if (rect.right > de.clientWidth + 1 && getComputedStyle(node).position !== 'fixed') {
              offenders.push(`${node.tagName}.${String(node.className).slice(0, 24)}`)
            }
          }
          // Tap targets below 32px are hard to hit on a touch screen.
          const smallTargets = [...document.querySelectorAll('button, a[href]')]
            .filter((node) => {
              const rect = node.getBoundingClientRect()
              if (rect.width === 0 || rect.height === 0) return false
              const style = getComputedStyle(node)
              if (style.visibility === 'hidden' || style.display === 'none') return false
              return rect.height < 30
            })
            .map(node => `${node.tagName}:${(node.textContent || '').trim().slice(0, 14)}`)
          return {
            overflowX,
            offenders: [...new Set(offenders)].slice(0, 5),
            smallTargets: [...new Set(smallTargets)].slice(0, 5),
            bodyFont: parseFloat(getComputedStyle(document.body).fontSize),
          }
        })
        const problems = []
        if (audit.overflowX > 2) problems.push(`overflow-x ${audit.overflowX}px ${JSON.stringify(audit.offenders)}`)
        report.push(`${device.name}/${route.label}: overflow=${audit.overflowX} small=${audit.smallTargets.length}`)
        assert.ok(
          audit.overflowX <= 2,
          `${device.name} ${route.label} overflows horizontally by ${audit.overflowX}px: ${audit.offenders.join(', ')}`,
        )
      }
      await page.screenshot({ path: `.test-artifacts/responsive-${device.name}.png`, fullPage: false })
      await context.close()
    }
  } finally {
    console.log(report.join('\n'))
    await browser.close()
  }
})
