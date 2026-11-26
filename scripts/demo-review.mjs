// Starts a throwaway demo server, screenshots the real pages at three widths,
// then shuts it down. A single process avoids stale servers confusing the review.
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const port = process.env.DEMO_PORT ?? '3102'
const base = `http://127.0.0.1:${port}`
const outDir = '.test-artifacts/visual'
await mkdir(outDir, { recursive: true })

const server = spawn(process.execPath, ['.output/server/index.mjs'], {
  env: {
    ...process.env,
    NITRO_HOST: '127.0.0.1',
    NITRO_PORT: port,
    NODE_ENV: 'production',
    NUXT_LIBRARY_DB_PATH: '.demo/library.sqlite',
    NUXT_LIBRARY_MEDIA_ROOT: '.demo/media',
  },
  stdio: 'ignore',
})

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`${base}/api/library/home`, { signal: AbortSignal.timeout(1500) })
      if (response.ok) { await response.body?.cancel(); return }
    } catch { /* not ready yet */ }
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  throw new Error('demo server did not start')
}

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'wide', width: 1920, height: 1080 },
  { name: 'mobile', width: 390, height: 844 },
]

// Waits for every visible image to actually decode, so screenshots never show
// half-faded artwork.
async function settle(page) {
  await page.evaluate(async () => {
    const images = [...document.querySelectorAll('img')]
    await Promise.all(images.map(img => (img.complete && img.naturalWidth > 0)
      ? Promise.resolve()
      : new Promise(resolve => {
        img.addEventListener('load', resolve, { once: true })
        img.addEventListener('error', resolve, { once: true })
        setTimeout(resolve, 8000)
      })))
  })
  await page.waitForTimeout(500)
}

const problems = []
try {
  await waitForServer()
  const browser = await chromium.launch({ channel: 'msedge' })
  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, locale: 'zh-CN' })
      const page = await context.newPage()
      page.on('console', message => {
        // Browser hints about lazy-image placeholders are not site defects.
        if (message.type() === 'error' && !message.text().includes('Images loaded lazily')) {
          problems.push(`[${viewport.name}] ${message.text()}`)
        }
      })
      page.on('pageerror', error => problems.push(`[${viewport.name}] ${error.message}`))

      for (const [label, path] of [['home', '/'], ['browse', '/browse'], ['search', '/search?q=%E5%B1%B1'], ['my-list', '/my-list']]) {
        const response = await page.goto(`${base}${path}`, { waitUntil: 'networkidle' })
        await settle(page)
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
        if (overflow > 1) problems.push(`[overflow:${viewport.name}] ${path} +${overflow}px`)
        await page.screenshot({ path: join(outDir, `${viewport.name}-${label}.png`) })
        console.log(`${viewport.name.padEnd(8)} ${label.padEnd(8)} ${response?.status()}`)
      }

      await page.goto(base, { waitUntil: 'networkidle' })
      const href = await page.locator('a[href^="/movie/"]').first().getAttribute('href').catch(() => null)
      if (href) {
        await page.goto(`${base}${href}`, { waitUntil: 'networkidle' })
        await settle(page)
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
        if (overflow > 1) problems.push(`[overflow:${viewport.name}] ${href} +${overflow}px`)
        await page.screenshot({ path: join(outDir, `${viewport.name}-detail.png`) })
        console.log(`${viewport.name.padEnd(8)} ${'detail'.padEnd(8)} 200`)
      }

      // Scrolled view proves the rails and their hover targets.
      await page.goto(base, { waitUntil: 'networkidle' })
      await page.evaluate(() => window.scrollTo(0, 620))
      await settle(page)
      await page.screenshot({ path: join(outDir, `${viewport.name}-rails.png`) })
      await context.close()
    }
  } finally {
    await browser.close()
  }
} finally {
  server.kill()
}

if (problems.length) {
  console.log('\nproblems:')
  for (const problem of [...new Set(problems)]) console.log(' -', problem)
} else {
  console.log('\nclean: no console errors, no horizontal overflow')
}
