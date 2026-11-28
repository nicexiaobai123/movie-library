<script setup lang="ts">
import type { LibraryCard } from '#shared/types/library'
import MovieCard from './MovieCard.vue'

// A plain grid of cards, one screenful per section. The whole collection lives on
// the catalogue page, which "more" links to, so there is nothing to scroll sideways.
const props = withDefaults(defineProps<{
  title: string
  subtitle?: string | null
  href: string
  items: LibraryCard[]
  wide?: boolean
  priority?: boolean
  // How many cards this section shows before the "more" link takes over.
  limit?: number
}>(), { subtitle: null, wide: false, priority: false, limit: 7 })

const shown = computed(() => props.items.slice(0, props.limit))
</script>

<template>
  <section class="rail" :aria-label="title">
    <header class="rail-head">
      <div class="rail-titles">
        <h2 class="section-title">{{ title }}</h2>
        <p v-if="subtitle" class="rail-sub">{{ subtitle }}</p>
      </div>
      <NuxtLink class="rail-more" :to="href" :aria-label="`查看全部${title}`" data-test="rail-more">
        更多
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m9.5 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </NuxtLink>
    </header>
    <ul class="rail-grid" :class="{ 'rail-grid--wide': wide }" role="list">
      <li v-for="(item, index) in shown" :key="item.id" class="rail-item">
        <MovieCard :item="item" :wide="wide" :priority="priority && index < 4" />
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
/* The heading text and the "more" link share the grid's content edges, so the link
   lines up with the last card rather than the with padded shell edge. */
.rail-head > * { inline-size: auto; }
.rail-titles { display: grid; gap: 0.2rem; min-inline-size: 0; }
.rail-sub { margin: 0; color: var(--text-muted); font-size: 0.8rem; }
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

/* A flat grid: the same cards as the catalogue, in one row of seven that reflows
   to fewer columns as the viewport narrows. A short section keeps its column widths
   and stays left-aligned, so its cards are the same size as a full row's. */
.rail-grid {
  display: grid;
  grid-template-columns: repeat(var(--rail-columns, 7), minmax(0, 1fr));
  grid-auto-rows: auto;
  gap: clamp(0.8rem, 1.4vw, 1.2rem);
  margin: 0;
  padding-inline: var(--shell-pad);
  list-style: none;
}
.rail-grid--wide { --rail-columns: 4; }
.rail-item { min-inline-size: 0; }

@media (max-width: 68rem) {
  .rail-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .rail-grid--wide { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 48rem) {
  .rail-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .rail-grid--wide { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 34rem) {
  .rail-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .rail-grid--wide { grid-template-columns: repeat(1, minmax(0, 1fr)); }
}
</style>
