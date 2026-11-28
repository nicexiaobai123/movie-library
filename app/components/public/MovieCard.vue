<script setup lang="ts">
import type { LibraryCard } from '#shared/types/library'
import MovieArt from './MovieArt.vue'

// Poster tile with a hover/focus overlay. The overlay is absolutely positioned so
// scaling it never pushes neighbouring cards around.
withDefaults(defineProps<{
  item: LibraryCard
  priority?: boolean
}>(), { priority: false })
</script>

<template>
  <NuxtLink :to="`/movie/${encodeURIComponent(item.id)}`" class="card">
    <span class="card-frame">
      <MovieArt
        :src="item.posterUrl"
        :title="item.title"
        :year="item.year"
        :kind="item.kind"
        ratio="poster"
        :priority="priority"
      />
      <span class="card-overlay" aria-hidden="true">
        <span class="card-overlay-top">
          <span v-if="item.year" class="card-year">{{ item.year }}</span>
          <span v-if="item.kind === 'series'" class="card-year">剧集</span>
        </span>
        <span class="card-overlay-body">
          <span class="card-overlay-title">{{ item.title }}</span>
          <span v-if="item.cast.length" class="card-genres">{{ item.cast.slice(0, 2).join(' · ') }}</span>
        </span>
        <span class="card-play">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8.5 5.5 18.5 12l-10 6.5z" fill="currentColor" /></svg>
          <span>播放</span>
        </span>
      </span>
    </span>
    <span class="card-meta">
      <!-- The title is always shown: a first-frame cover is just a picture of the
           video, so it cannot stand in for the name the way a designed poster can. -->
      <span class="card-title" :title="item.title">{{ item.title }}</span>
      <span class="card-sub">
        <span v-if="item.kind === 'series'" class="card-kind">剧集</span>
        <span v-if="item.year">{{ item.year }}</span>
        <span v-if="item.runtime">{{ item.runtime }} 分钟</span>
      </span>
    </span>
  </NuxtLink>
</template>

<style scoped>
.card {
  display: block;
  min-inline-size: 0;
  color: inherit;
  text-decoration: none;
}
/* A fixed row height keeps every tile in a rail aligned, whether or not the
   artwork carries its own title. */
.card-frame {
  position: relative;
  display: block;
  overflow: hidden;
  aspect-ratio: 2 / 3;
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  box-shadow: 0 1px 0 rgb(255 255 255 / 0.04);
  transform: translateZ(0);
  transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}
.card-frame > :deep(.art) { block-size: 100%; aspect-ratio: auto; }
.card-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 0.4rem;
  padding: 0.7rem;
  box-sizing: border-box;
  background: linear-gradient(180deg, rgb(8 9 11 / 0.15) 0%, rgb(8 9 11 / 0.35) 45%, rgb(8 9 11 / 0.92) 100%);
  opacity: 0;
  transition: opacity var(--dur) var(--ease);
}
.card-overlay-top { display: flex; align-items: center; gap: 0.4rem; }
.card-score {
  padding: 0.1rem 0.4rem;
  border-radius: var(--radius-xs);
  background: var(--accent);
  color: var(--on-accent);
  font-size: 0.7rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.card-year { color: var(--text-secondary); font-size: 0.72rem; }
.card-overlay-body { display: grid; gap: 0.2rem; }
.card-overlay-title {
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  color: #fff;
  font-size: 0.86rem;
  font-weight: 600;
  line-height: 1.3;
}
.card-genres { color: var(--text-secondary); font-size: 0.7rem; }
.card-play {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: #fff;
  font-size: 0.74rem;
  font-weight: 600;
}
.card-play svg { inline-size: 0.85rem; block-size: 0.85rem; color: var(--accent); }
.card-badge {
  position: absolute;
  inset-block-start: 0.5rem;
  inset-inline-start: 0.5rem;
  padding: 0.1rem 0.4rem;
  border-radius: var(--radius-xs);
  background: rgb(8 9 11 / 0.78);
  color: var(--text-secondary);
  font-size: 0.68rem;
}
.card-meta { display: grid; gap: 0.15rem; padding-block-start: 0.7rem; }
/* Two lines, so a long title is readable instead of vanishing into an ellipsis. */
.card-title {
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  font-size: 0.88rem;
  font-weight: 600;
  line-height: 1.35;
  overflow-wrap: anywhere;
  transition: color var(--dur-fast) var(--ease);
}
.card-sub { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; min-block-size: 1.15rem; color: var(--text-muted); font-size: 0.76rem; font-variant-numeric: tabular-nums; }
/* The kind tag leads the metadata line so a series is identifiable at a glance. */
.card-kind {
  padding: 0.02rem 0.35rem;
  border-radius: var(--radius-pill);
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.7rem;
  font-weight: 600;
}
.card:focus-visible .card-frame { outline: 2px solid var(--accent-strong); outline-offset: 3px; }

@media (hover: hover) and (pointer: fine) {
  .card:hover .card-frame { transform: scale(1.045); box-shadow: var(--shadow-card); z-index: 2; }
  .card:hover .card-overlay { opacity: 1; }
  .card:hover .card-title { color: var(--accent-strong); }
}
.card:focus-visible .card-overlay { opacity: 1; }
</style>
