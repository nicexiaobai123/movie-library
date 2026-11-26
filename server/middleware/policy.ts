import { defineEventHandler, sendRedirect, setHeader } from 'h3'
import { posix } from 'node:path'
import { getLibraryRuntime } from '../services/runtime.ts'
import { sessionToken } from '../http/access.ts'

export default defineEventHandler((event) => {
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'Referrer-Policy', 'same-origin')
  setHeader(event, 'X-Frame-Options', 'DENY')
  // Server-bound check protects direct HTML requests, not just client navigation.
  let route = event.path.split('?')[0] ?? '/'
  try { route = decodeURIComponent(route) } catch { /* malformed URLs do not match a page */ }
  route = posix.normalize(`/${route.replace(/\\/g, '/')}`).replace(/\/+$/, '').toLowerCase()
  if (route === '/admin' || route.startsWith('/admin/')) {
    setHeader(event, 'Cache-Control', 'no-store')
    if (route !== '/admin/login') {
      const runtime = getLibraryRuntime(useRuntimeConfig(event).library)
      if (!runtime.auth.session(sessionToken(event))) return sendRedirect(event, '/admin/login', 302)
    }
  }
})
