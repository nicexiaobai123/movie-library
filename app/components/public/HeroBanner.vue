<script setup lang="ts">
import type { LibraryCard } from '#shared/types/library'
import MovieArt from './MovieArt.vue'

// The hero rotates through a few titles from the real library. Backdrops cross-fade
// behind fixed text so the layout never reflows between slides.
const props = defineProps<{ items: LibraryCard[] }>()

const index = ref(0)
const current = computed(() => props.items[index.value] ?? null)
const paused = ref(false)
let timer: ReturnType<typeof setInterval> | undefined

function go(step: number) {
  if (!props.items.length) return
  index.value = (index.value + step + props.items.length) % props.items.length
}

function start() {
  stop()
  if (props.items.length < 2) return
  timer = setInterval(() => {
    if (!paused.value && !document.hidden) go(1)
  }, 9000)
}
function stop() {
  if (timer !== undefined) clearInterval(timer)
  timer = undefined
}

onMounted(start)
onBeforeUnmount(stop)
watch(() => props.items.length, start)
watch(index, start)

const rating = computed(() => current.value?.rating ? current.value.rating.toFixed(1) : null)
const meta = computed(() => {
  const item = current.value
  if (!item) return []
  return [item.year ? String(item.year) : null, item.kind === 'series' ? '剧集' : '电影', ...item.genres.slice(0, 2)].filter(Boolean) as string[]
})
</script>

<template>
  <section v-if="current" class="hero" aria-label="推荐影片" @mouseenter="paused = true" @mouseleave="paused = false" @focusin="paused = true" @focusout="paused = false">
    <div class="hero-stage">
      <div
        v-for="(item, i) in items"
        :key="item.id"
        class="hero-slide"
        :class="{ 'is-active': i === index }"
        :aria-hidden="i !== index"
      >
        <MovieArt :src="item.backdropUrl ?? item.posterUrl" :title="item.title" ratio="wide" :priority="i === 0" :show-caption="false" />
      </div>
      <div class="hero-scrim" aria-hidden="true" />
    </div>

    <div class="hero-content">
      <p class="hero-eyebrow">
        <span class="hero-dot" aria-hidden="true" />本周精选
      </p>
      <h1 class="hero-title">{{ current.title }}</h1>
      <p v-if="current.originalTitle" class="hero-original">{{ current.originalTitle }}</p>
      <p class="hero-meta">
        <span v-if="rating" class="hero-rating">★ {{ rating }}</span>
        <template v-for="(part, i) in meta" :key="part">
          <span v-if="i > 0 || rating" class="hero-sep" aria-hidden="true">·</span>
          <span>{{ part }}</span>
        </template>
      </p>
      <p class="hero-actions">
        <NuxtLink :to="`/watch/${encodeURIComponent(current.id)}`" class="btn btn--primary hero-btn">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8.5 5.5 18.5 12l-10 6.5z" fill="currentColor" /></svg>
          {{ current.available ? '立即播放' : '查看详情' }}
        </NuxtLink>
        <NuxtLink :to="`/movie/${encodeURIComponent(current.id)}`" class="btn btn--ghost hero-btn">
          查看详情
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m9.5 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </NuxtLink>
      </p>
    </div>

    <div v-if="items.length > 1" class="hero-dots" role="tablist" aria-label="切换精选影片">
      <button
        v-for="(item, i) in items"
        :key="item.id"
        type="button"
        role="tab"
        class="hero-dot-btn"
        :class="{ 'is-active': i === index }"
        :aria-selected="i === index"
        :aria-label="`显示第 ${i + 1} 部：${item.title}`"
        @click="index = i"
      />
    </div>
  </section>
</template>

<style scoped>
.hero {
  position: relative;
  display: flex;
  align-items: flex-end;
  min-block-size: clamp(30rem, 76vh, 46rem);
  padding-block-end: clamp(2.2rem, 6vw, 5rem);
  overflow: hidden;
  isolation: isolate;
}
.hero-stage { position: absolute; inset: 0; z-index: -1; }
.hero-slide {
  position: absolute;
  inset: 0;
  opacity: 0;
  transition: opacity 1.1s var(--ease);
}
.hero-slide.is-active { opacity: 1; }
.hero-slide :deep(.art) { block-size: 100%; aspect-ratio: auto; }
.hero-slide :deep(.art-fallback) { justify-content: center; align-items: flex-start; padding-inline: var(--shell-pad); }
/* Left and bottom scrims keep text legible without flattening the still. */
.hero-scrim {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(90deg, rgb(8 9 11 / 0.94) 0%, rgb(8 9 11 / 0.72) 32%, rgb(8 9 11 / 0.15) 62%, transparent 100%),
    linear-gradient(0deg, var(--bg) 2%, rgb(8 9 11 / 0.6) 26%, transparent 60%),
    linear-gradient(180deg, rgb(8 9 11 / 0.65) 0%, transparent 22%);
}
.hero-content {
  position: relative;
  inline-size: min(100%, var(--shell-max));
  margin-inline: auto;
  padding-inline: var(--shell-pad);
  max-inline-size: min(100%, 46rem);
  margin-inline-start: max(calc((100% - var(--shell-max)) / 2), 0px);
  padding-inline-start: max(var(--shell-pad), calc((100% - var(--shell-max)) / 2 + var(--shell-pad)));
  animation: rise-in 720ms var(--ease) both;
}
.hero-eyebrow { display: inline-flex; align-items: center; gap: 0.45rem; margin: 0 0 0.9rem; color: var(--accent); font-size: 0.74rem; font-weight: 600; letter-spacing: 0.16em; }
.hero-dot { inline-size: 6px; block-size: 6px; border-radius: 50%; background: currentColor; }
.hero-title {
  margin: 0;
  font-size: clamp(2.1rem, 5.2vw, 4.1rem);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.05;
  text-wrap: balance;
  text-shadow: 0 2px 18px rgb(0 0 0 / 0.45);
}
.hero-original { margin: 0.5rem 0 0; color: var(--text-secondary); font-size: clamp(0.85rem, 1.3vw, 1rem); letter-spacing: 0.02em; }
.hero-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin: 1rem 0 0; color: var(--text-secondary); font-size: 0.86rem; }
.hero-rating { padding: 0.1rem 0.45rem; border-radius: var(--radius-xs); background: var(--accent); color: var(--on-accent); font-weight: 700; font-variant-numeric: tabular-nums; }
.hero-sep { color: var(--text-muted); }
.hero-actions { display: flex; flex-wrap: wrap; gap: 0.7rem; margin: 1.6rem 0 0; }
.hero-btn { min-block-size: 46px; padding-inline: 1.35rem; font-size: 0.92rem; }
.hero-btn svg { inline-size: 1rem; block-size: 1rem; }
.hero-dots { position: absolute; inset-inline-end: var(--shell-pad); inset-block-end: clamp(2.2rem, 6vw, 5rem); display: flex; gap: 0.45rem; }
.hero-dot-btn {
  inline-size: 26px;
  block-size: 3px;
  padding: 0;
  border: 0;
  border-radius: 2px;
  background: rgb(255 255 255 / 0.24);
  transition: background-color var(--dur-fast) var(--ease), inline-size var(--dur) var(--ease);
}
.hero-dot-btn.is-active { inline-size: 40px; background: var(--accent); }

@media (max-width: 48rem) {
  /* A phone screen should reveal the first rail, not spend itself on one title. */
  .hero { min-block-size: 62svh; padding-block-end: 2.6rem; }
  .hero-content { margin-inline-start: auto; padding-inline-start: var(--shell-pad); max-inline-size: none; }
  .hero-title { font-size: clamp(1.7rem, 8vw, 2.4rem); }
  .hero-eyebrow { margin-block-end: 0.55rem; }
  .hero-meta { margin-block-start: 0.7rem; }
  .hero-actions { margin-block-start: 1.1rem; }
  .hero-dots { inset-inline-end: auto; inset-inline-start: var(--shell-pad); inset-block-end: 1.1rem; }
  .hero-scrim {
    background:
      linear-gradient(0deg, var(--bg) 4%, rgb(8 9 11 / 0.82) 34%, rgb(8 9 11 / 0.15) 70%, rgb(8 9 11 / 0.5) 100%);
  }
}
</style>
