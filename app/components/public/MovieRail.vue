<script setup lang="ts">
import type { LibraryCard, LibraryKind } from '#shared/types/library'
import MovieCard from './MovieCard.vue'

const props = withDefaults(defineProps<{
  kind: LibraryKind
  items: LibraryCard[]
  priority?: boolean
}>(), { priority: false })

const title = computed(() => props.kind === 'movie' ? '电影' : '剧集')
</script>

<template>
  <section class="rail" :aria-label="title">
    <header class="rail-head">
      <h2 class="section-title">{{ title }}</h2>
      <NuxtLink class="rail-more" :to="{ path: '/browse', query: { kind } }" :aria-label="`查看全部${title}`" data-test="rail-more">
        更多
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m9.5 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </NuxtLink>
    </header>
    <ul class="rail-grid" role="list">
      <li v-for="(item, index) in items" :key="item.id" class="rail-item">
        <MovieCard :item="item" :priority="priority && index < 4" />
      </li>
    </ul>
  </section>
</template>

<style scoped>
.rail { position: relative; padding-block: clamp(1.1rem, 2.2vw, 1.9rem) 0; }
.rail-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  margin-block-end: 0.9rem;
  padding-inline: var(--shell-pad);
}
.rail-more {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 0.15rem;
  min-block-size: 34px;
  padding-inline: 0.55rem;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 0.82rem;
  transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}
.rail-more svg { inline-size: 0.95rem; block-size: 0.95rem; }
.rail-more:hover { background: var(--bg-hover); color: var(--text); }
.rail-more:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px; }

/* CSS handles both columns and the two-row cap without guessing the viewport
   during SSR. Hidden cards are removed from the layout and keyboard navigation. */
.rail-grid {
  --rail-columns: 7;
  display: grid;
  grid-template-columns: repeat(var(--rail-columns), minmax(0, 1fr));
  gap: clamp(0.8rem, 1.4vw, 1.2rem);
  margin: 0;
  padding-inline: var(--shell-pad);
  list-style: none;
}
.rail-item { min-inline-size: 0; }
.rail-item:nth-child(n + 15) { display: none; }

@media (max-width: 68rem) {
  .rail-grid { --rail-columns: 5; }
  .rail-item:nth-child(n + 11) { display: none; }
}
@media (max-width: 48rem) {
  .rail-grid { --rail-columns: 4; }
  .rail-item:nth-child(n + 9) { display: none; }
}
@media (max-width: 34rem) {
  .rail-grid { --rail-columns: 2; }
  .rail-item:nth-child(n + 5) { display: none; }
}
</style>
