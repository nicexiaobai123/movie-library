<script setup lang="ts">
import type { BrowseResult, ActorList } from '#shared/types/library'
import MovieCard from '~/components/public/MovieCard.vue'

const route = useRoute()
const name = computed(() => {
  const value = route.params.name
  return typeof value === 'string' ? decodeURIComponent(value) : ''
})

const { data, status, refresh } = await useFetch<BrowseResult>('/api/library/browse', {
  query: computed(() => ({ actor: name.value || undefined, pageSize: 60 })),
  deep: false,
})
const titles = computed(() => data.value?.items ?? [])

// The total count comes from the actor index so the heading is right even when
// the browse page caps its page size.
const { data: actors } = await useFetch<ActorList>('/api/library/actors', { deep: false })
const summary = computed(() => actors.value?.items.find(actor => actor.name === name.value) ?? null)

useSeoMeta({
  title: () => `${name.value || '演员'} · 夜灯`,
  description: () => `${name.value}在片库中的电影与剧集。`,
})
</script>

<template>
  <div class="actor-page">
    <header class="shell actor-head">
      <NuxtLink to="/actors" class="actor-back">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m14.5 6-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
        全部演员
      </NuxtLink>
      <p class="eyebrow">明星</p>
      <h1>{{ name }}</h1>
      <p v-if="summary" class="actor-lede">{{ summary.count }} 部作品</p>
    </header>

    <div class="shell">
      <div v-if="status === 'pending' || status === 'idle'" class="grid" aria-hidden="true">
        <div v-for="n in 6" :key="n" class="skeleton-card" />
      </div>
      <div v-else-if="status === 'error'" class="actor-empty" role="alert">
        <p>暂时无法读取这位演员的作品。</p>
        <button class="btn btn--ghost" type="button" @click="refresh()">重试</button>
      </div>
      <div v-else-if="!titles.length" class="actor-empty">
        <h2>还没有这位演员的作品</h2>
        <p>片库中暂时没有归属到「{{ name }}」的影片。</p>
        <NuxtLink to="/actors" class="btn">看看其他演员</NuxtLink>
      </div>
      <ul v-else class="grid" role="list" data-test="actor-titles">
        <li v-for="item in titles" :key="item.id">
          <MovieCard :item="item" />
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.actor-page { padding-block: calc(var(--header-h) + clamp(1.2rem, 3vw, 2.2rem)) clamp(2rem, 5vw, 4rem); }
.actor-head { display: grid; gap: 0.5rem; padding-block-end: clamp(1.4rem, 3vw, 2.2rem); }
.actor-head h1 { font-size: clamp(1.9rem, 4vw, 3rem); font-weight: 700; }
.actor-lede { margin: 0; color: var(--text-muted); font-size: 0.9rem; font-variant-numeric: tabular-nums; }
.actor-back {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-block-end: 0.4rem;
  color: var(--text-secondary);
  font-size: 0.85rem;
  text-decoration: none;
  transition: color var(--dur-fast) var(--ease);
}
.actor-back svg { inline-size: 1rem; block-size: 1rem; }
.actor-back:hover { color: var(--text); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr)); gap: clamp(0.8rem, 1.6vw, 1.35rem) clamp(0.7rem, 1.2vw, 1.1rem); margin: 0; padding: 0; list-style: none; }
.grid li { min-inline-size: 0; }
.actor-empty { display: grid; justify-items: start; gap: 0.9rem; max-inline-size: 34rem; padding-block: 2.5rem; color: var(--text-secondary); }
.actor-empty h2 { font-size: 1.2rem; color: var(--text); }
.skeleton-card { aspect-ratio: 2 / 3; border-radius: var(--radius-sm); background: linear-gradient(100deg, #15171b 20%, #1d2026 40%, #15171b 60%); background-size: 220% 100%; animation: shimmer 1.5s linear infinite; }
@keyframes shimmer { to { background-position: -220% 0; } }
@media (max-width: 34rem) {
  .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
