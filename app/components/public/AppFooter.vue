<template>
  <footer class="footer">
    <div class="shell footer-inner">
      <div class="footer-brand">
        <p class="footer-logo">夜灯</p>
        <p class="footer-tagline">私人影视库 · 在局域网内观看</p>
      </div>
      <nav class="footer-links" aria-label="站点信息">
        <NuxtLink to="/browse?kind=movie">电影</NuxtLink>
        <NuxtLink to="/browse?kind=series">剧集</NuxtLink>
        <NuxtLink to="/my-list">我的收藏</NuxtLink>
        <NuxtLink to="/user">我的账户</NuxtLink>
        <NuxtLink to="/admin">管理后台</NuxtLink>
      </nav>
      <p class="footer-legal">仅供本地自建使用 · 请只上传和观看你有权使用的影片</p>
    </div>
  </footer>
</template>

<style scoped>
.footer {
  margin-block-start: clamp(3rem, 7vw, 6rem);
  padding-block: 2.6rem;
  border-block-start: 1px solid var(--border);
  background: linear-gradient(180deg, transparent, rgb(255 255 255 / 0.02));
}
.footer-inner { display: grid; gap: 1.6rem; }
.footer-logo { margin: 0; font-size: 1.1rem; font-weight: 700; letter-spacing: 0.16em; }
.footer-tagline { margin: 0.3rem 0 0; color: var(--text-muted); font-size: 0.82rem; }
.footer-links { display: flex; flex-wrap: wrap; gap: 0.4rem 1.6rem; }
.footer-links a { color: var(--text-secondary); font-size: 0.85rem; text-decoration: none; transition: color var(--dur-fast) var(--ease); }
.footer-links a:hover { color: var(--accent); }
.footer-legal { margin: 0; color: var(--text-muted); font-size: 0.76rem; }
</style>
