import { closeLibraryRuntime, getLibraryRuntime } from '../services/runtime.ts'

export default defineNitroPlugin(nitro => {
  const { catalog, config } = getLibraryRuntime(useRuntimeConfig().library)
  // Schedule the first observation without making starting the site depend on a NAS.
  const initial = config.scanIntervalMs > 0 ? setTimeout(() => catalog.scanner.start(), 500).unref() : undefined
  const timer = config.scanIntervalMs > 0 ? setInterval(() => catalog.scanner.start(), config.scanIntervalMs).unref() : undefined
  nitro.hooks.hook('close', async () => {
    clearTimeout(initial)
    clearInterval(timer)
    await closeLibraryRuntime()
  })
})
