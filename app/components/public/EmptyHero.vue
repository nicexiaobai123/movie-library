<template>
  <section class="empty-hero">
    <div class="empty-inner">
      <p class="eyebrow">私人影视库</p>
      <h1>把电影放进来，<br>这里就是你的放映厅</h1>
      <p class="empty-copy">还没有影片入库。把视频复制到媒体目录，或从管理后台上传，系统会自动识别片名、整理成可以播放和收藏的影片。</p>
      <div class="empty-actions">
        <NuxtLink to="/admin" class="btn btn--primary">进入管理后台</NuxtLink>
        <NuxtLink to="/browse?kind=movie" class="btn btn--ghost">浏览电影</NuxtLink>
      </div>
      <ul class="empty-steps">
        <li><span>01</span>上传或复制 MP4 到媒体目录</li>
        <li><span>02</span>扫描入库并补充海报与简介</li>
        <li><span>03</span>在局域网内随时播放</li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.empty-hero {
  display: flex;
  align-items: center;
  min-block-size: clamp(32rem, 78vh, 48rem);
  padding-block: calc(var(--header-h) + 2rem) 3rem;
  background:
    radial-gradient(80% 60% at 78% 12%, rgb(214 184 117 / 0.12), transparent 62%),
    radial-gradient(60% 50% at 12% 90%, rgb(255 255 255 / 0.05), transparent 70%),
    var(--bg);
}
.empty-inner {
  inline-size: min(100%, var(--shell-max));
  margin-inline: auto;
  padding-inline: var(--shell-pad);
  max-inline-size: 54rem;
}
.empty-inner h1 {
  margin: 1.1rem 0 0;
  font-size: clamp(2rem, 4.6vw, 3.6rem);
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.1;
  text-wrap: balance;
}
.empty-copy { max-inline-size: 34rem; margin: 1.2rem 0 0; color: var(--text-secondary); font-size: 0.98rem; line-height: 1.8; }
.empty-actions { display: flex; flex-wrap: wrap; gap: 0.7rem; margin-block-start: 1.8rem; }
.empty-steps {
  display: grid;
  gap: 0.55rem;
  margin: 2.6rem 0 0;
  padding: 0;
  list-style: none;
  color: var(--text-muted);
  font-size: 0.85rem;
}
.empty-steps li { display: flex; align-items: baseline; gap: 0.7rem; }
.empty-steps span { color: var(--accent); font-variant-numeric: tabular-nums; font-size: 0.78rem; letter-spacing: 0.1em; }
</style>
