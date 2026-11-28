<script setup lang="ts">
import type { HomeData } from '#shared/types/library'
import HeroBanner from '~/components/public/HeroBanner.vue'
import MovieRail from '~/components/public/MovieRail.vue'
import EmptyHero from '~/components/public/EmptyHero.vue'
import ContinueWatching from '~/components/public/ContinueWatching.vue'
import { useContinueWatching } from '~/composables/useProgress'
import { useUserSession } from '~/composables/useUser'

useSeoMeta({
  title: '夜灯 · 私人影视库',
  description: '在局域网内浏览、播放和下载自己的电影馆藏。',
})

const { data, status, refresh } = await useFetch<HomeData>('/api/library/home', { deep: false })
const home = computed(() => data.value)
const rails = computed(() => home.value?.rails ?? [])
const heroes = computed(() => home.value?.heroes ?? [])
const empty = computed(() => status.value === 'success' && !rails.value.length)

// Resume points only exist for signed-in visitors, so the row stays hidden otherwise.
const { signedIn } = await useUserSession()
const { items: resumeItems } = await useContinueWatching()
const resumable = computed(() => signedIn.value ? resumeItems.value : [])
</script>

<template>
  <div class="home">
    <HeroBanner v-if="heroes.length" :items="heroes" />
    <EmptyHero v-else-if="empty" />
    <div v-else class="hero-skeleton" aria-hidden="true">
      <div class="skeleton" />
    </div>

    <div v-if="status === 'pending' || status === 'idle'" class="rails-loading" role="status">
      <p class="visually-hidden">正在读取影视库…</p>
      <div v-for="n in 2" :key="n" class="rail-skeleton">
        <div class="skeleton skeleton--title" />
        <div class="skeleton-row">
          <div v-for="i in 6" :key="i" class="skeleton skeleton--card" />
        </div>
      </div>
    </div>

    <div v-else-if="status === 'error'" class="shell load-error" role="alert">
      <p>暂时无法读取影视库，请检查连接后重试。</p>
      <button class="btn btn--ghost" type="button" @click="refresh()">重试</button>
    </div>

    <template v-else>
      <ContinueWatching v-if="resumable.length" :items="resumable" />
      <MovieRail
        v-for="(rail, index) in rails"
        :key="rail.id"
        :title="rail.title"
        :subtitle="rail.subtitle"
        :href="rail.href"
        :items="rail.items"
        :wide="rail.presentation === 'wide'"
        :priority="index === 0"
      />
    </template>
  </div>
</template>

<style scoped>
.home { padding-block-end: clamp(2rem, 5vw, 3.5rem); }
.hero-skeleton { block-size: clamp(30rem, 76vh, 46rem); padding-inline: var(--shell-pad); padding-block: calc(var(--header-h) + 3rem) 3rem; }
.skeleton {
  border-radius: var(--radius-sm);
  background: linear-gradient(100deg, #15171b 20%, #1d2026 40%, #15171b 60%);
  background-size: 220% 100%;
  animation: shimmer 1.5s linear infinite;
}
.skeleton--title { inline-size: clamp(8rem, 18vw, 14rem); block-size: 1.2rem; margin-block-end: 1rem; }
.skeleton--card { aspect-ratio: 2 / 3; }
.skeleton-row { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: clamp(0.8rem, 1.4vw, 1.2rem); }
@media (max-width: 68rem) { .skeleton-row { grid-template-columns: repeat(5, minmax(0, 1fr)); } }
@media (max-width: 48rem) { .skeleton-row { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (max-width: 34rem) { .skeleton-row { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.rails-loading { display: grid; gap: 2rem; padding-inline: var(--shell-pad); }
.rail-skeleton { display: grid; gap: 0.8rem; }
.load-error { display: grid; justify-items: start; gap: 1rem; padding-block: 3rem; color: var(--text-secondary); }
@keyframes shimmer { to { background-position: -220% 0; } }
</style>
