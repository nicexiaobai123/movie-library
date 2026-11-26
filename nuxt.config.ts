import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2025-10-01',
  devtools: { enabled: false },
  typescript: { strict: true },
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },
  sourcemap: { server: false, client: false },
  nitro: { preset: 'node-server' },
  app: {
    head: {
      htmlAttrs: { lang: 'zh-CN' },
      title: '夜灯 · 私人影视库',
      meta: [
        { name: 'description', content: '在局域网内浏览、播放和下载馆藏电影与剧集。' },
        { name: 'theme-color', content: '#181715' },
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
  runtimeConfig: {
    library: {
      dbPath: '.data/library.sqlite',
      mediaRoot: 'media',
      scanIntervalMs: 15_000,
      stableMs: 8_000,
      maxUploadBytes: 32 * 1024 ** 3,
      allowedOrigins: '',
      secureCookies: false,
    },
  },
})
