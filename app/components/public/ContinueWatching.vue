<script setup lang="ts">
import type { ContinueWatchingItem } from '#shared/types/library'
import MovieArt from './MovieArt.vue'
import { progressPercent, watchResumeUrl } from '~/composables/useProgress'

// A single horizontal row of resumable titles with a progress bar per card.
defineProps<{ items: ContinueWatchingItem[] }>()
</script>

<template>
  <section class="resume" aria-labelledby="resume-title">
    <header class="resume-head">
      <h2 id="resume-title" class="section-title">继续观看</h2>
      <p class="resume-sub">接着上次的位置播放</p>
    </header>
    <ul class="resume-track" role="list" data-test="resume-row">
      <li v-for="item in items" :key="`${item.id}-${item.episodeId ?? ''}`" class="resume-item">
        <NuxtLink :to="watchResumeUrl(item)" class="resume-card">
          <span class="resume-art">
            <MovieArt :src="item.backdropUrl ?? item.posterUrl" :title="item.title" ratio="wide" :show-caption="false" />
            <span class="resume-play" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false"><path d="M8.5 5.5 18.5 12l-10 6.5z" fill="currentColor" /></svg>
            </span>
            <span class="resume-bar" aria-hidden="true">
              <span class="resume-fill" :style="{ inlineSize: `${progressPercent(item)}%` }" />
            </span>
          </span>
          <span class="resume-meta">
            <span class="resume-name">{{ item.title }}</span>
            <span class="resume-detail">
              <template v-if="item.episodeLabel">{{ item.episodeLabel }}</template>
              <template v-else>电影</template>
              <span class="resume-percent">已看 {{ progressPercent(item) }}%</span>
            </span>
          </span>
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.resume { padding-block: clamp(1.1rem, 2.2vw, 1.9rem) 0; }
.resume-head {
  inline-size: min(100%, var(--shell-max));
  margin-inline: auto;
  padding-inline: var(--shell-pad);
  padding-block-end: 0.85rem;
}
.resume-sub { margin: 0.2rem 0 0; color: var(--text-muted); font-size: 0.8rem; }
.resume-track {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: clamp(13rem, 20vw, 18rem);
  gap: clamp(0.6rem, 1.1vw, 1rem);
  margin: 0;
  padding: 0.5rem var(--shell-pad) 1.2rem;
  list-style: none;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  scroll-snap-type: x proximity;
}
.resume-track::-webkit-scrollbar { display: none; }
.resume-item { min-inline-size: 0; scroll-snap-align: start; }
.resume-card { display: block; color: inherit; text-decoration: none; }
.resume-art {
  position: relative;
  display: block;
  overflow: hidden;
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}
.resume-play {
  position: absolute;
  inset-block-start: 50%;
  inset-inline-start: 50%;
  display: grid;
  place-items: center;
  inline-size: 2.4rem;
  block-size: 2.4rem;
  border-radius: 50%;
  background: rgb(8 9 11 / 0.62);
  color: #fff;
  transform: translate(-50%, -50%);
  opacity: 0;
  transition: opacity var(--dur) var(--ease);
}
.resume-play svg { inline-size: 1rem; block-size: 1rem; }
/* The bar sits on the artwork's bottom edge, like a player scrubber. */
.resume-bar {
  position: absolute;
  inset-inline: 0;
  inset-block-end: 0;
  block-size: 3px;
  background: rgb(255 255 255 / 0.22);
}
.resume-fill { display: block; block-size: 100%; background: var(--accent); }
.resume-meta { display: grid; gap: 0.15rem; padding-block-start: 0.6rem; }
.resume-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 0.88rem;
  font-weight: 600;
}
.resume-detail { display: flex; flex-wrap: wrap; gap: 0.5rem; color: var(--text-muted); font-size: 0.74rem; }
.resume-percent { color: var(--accent); font-variant-numeric: tabular-nums; }
.resume-card:focus-visible .resume-art { outline: 2px solid var(--accent-strong); outline-offset: 2px; }
@media (hover: hover) and (pointer: fine) {
  .resume-card:hover .resume-art { transform: scale(1.03); box-shadow: var(--shadow-card); }
  .resume-card:hover .resume-play { opacity: 1; }
}
.resume-card:focus-visible .resume-play { opacity: 1; }
@media (max-width: 34rem) {
  .resume-track { grid-auto-columns: 13rem; }
}
</style>
