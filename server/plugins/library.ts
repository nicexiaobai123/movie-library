import { closeLibraryRuntime, getLibraryRuntime } from '../services/runtime.ts'

export default defineNitroPlugin(nitro => {
  const { catalog, config } = getLibraryRuntime(useRuntimeConfig().library)
  // Schedule the first observation without making starting the site depend on a NAS.
  const initial = config.scanIntervalMs > 0 ? setTimeout(() => catalog.scanner.start(), 500).unref() : undefined
  // A slow share can make one sweep take longer than the interval. The next tick
  // is scheduled only after the previous sweep settles, so scans never stack up.
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const schedule = () => {
    if (stopped || config.scanIntervalMs <= 0) return
    timer = setTimeout(async () => {
      try {
        catalog.scanner.start()
        // `finish` resolves when the sweep that was just started completes.
        await catalog.scanner.finish()
      } catch {
        // A failed sweep is recorded by the scanner; the loop keeps going.
      } finally {
        schedule()
      }
    }, config.scanIntervalMs)
    timer.unref?.()
  }
  if (config.scanIntervalMs > 0) schedule()
  nitro.hooks.hook('close', async () => {
    stopped = true
    clearTimeout(initial)
    if (timer !== undefined) clearTimeout(timer)
    await closeLibraryRuntime()
  })
})
