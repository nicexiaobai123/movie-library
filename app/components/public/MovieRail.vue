<script setup lang="ts">
import type { LibraryCard } from '#shared/types/library'
import MovieCard from './MovieCard.vue'

// Horizontally scrolling rail. Buttons scroll by a page so mouse users are not
// forced to use shift+wheel; native swipe keeps working on touch devices.
const props = withDefaults(defineProps<{
  title: string
  subtitle?: string | null
  items: LibraryCard[]
  wide?: boolean
  priority?: boolean
}>(), { subtitle: null, wide: false, priority: false })

const track = ref<HTMLElement | null>(null)
const atStart = ref(true)
const atEnd = ref(false)

function measure() {
  const element = track.value
  if (!element) return
  atStart.value = element.scrollLeft <= 2
  atEnd.value = element.scrollLeft + element.clientWidth >= element.scrollWidth - 2
}

function scrollByPage(direction: 1 | -1) {
  const element = track.value
  if (!element) return
  element.scrollBy({ left: direction * element.clientWidth * 0.86, behavior: 'smooth' })
}

onMounted(() => {
  measure()
  window.addEventListener('resize', measure, { passive: true })
})
onBeforeUnmount(() => window.removeEventListener('resize', measure))
watch(() => props.items, () => nextTick(measure))
</script>

<template>
  <section class="rail" :aria-label="title">
    <header class="rail-head">
      <div class="rail-titles">
        <h2 class="section-title">{{ title }}</h2>
        <p v-if="subtitle" class="rail-sub">{{ subtitle }}</p>
      </div>
      <div class="rail-nav">
        <button type="button" class="rail-btn" :disabled="atStart" :aria-label="`向左滚动：${title}`" @click="scrollByPage(-1)">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m14.5 6-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
        <button type="button" class="rail-btn" :disabled="atEnd" :aria-label="`向右滚动：${title}`" @click="scrollByPage(1)">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m9.5 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
      </div>
    </header>
    <ul ref="track" class="rail-track" :class="{ 'rail-track--wide': wide }" role="list" @scroll.passive="measure">
      <li v-for="(item, index) in items" :key="item.id" class="rail-item">
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
  inline-size: min(100%, var(--shell-max));
  margin-inline: auto;
  padding-inline: var(--shell-pad);
  padding-block-end: 0.85rem;
}
.rail-titles { display: grid; gap: 0.2rem; min-inline-size: 0; }
.rail-sub { margin: 0; color: var(--text-muted); font-size: 0.8rem; }
.rail-nav { display: flex; gap: 0.4rem; }
.rail-btn {
  display: inline-grid;
  place-items: center;
  inline-size: 34px;
  block-size: 34px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: rgb(255 255 255 / 0.05);
  color: var(--text-secondary);
  transition: background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), opacity var(--dur-fast) var(--ease);
}
.rail-btn svg { inline-size: 1.05rem; block-size: 1.05rem; }
.rail-btn:not(:disabled):hover { background: rgb(255 255 255 / 0.14); color: var(--text); }
.rail-btn:disabled { opacity: 0.3; }

.rail-track {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: clamp(8.2rem, 12.4vw, 11.5rem);
  gap: clamp(0.6rem, 1.1vw, 1rem);
  margin: 0;
  padding: 0.6rem var(--shell-pad) 1.4rem;
  list-style: none;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-snap-type: x proximity;
  scrollbar-width: none;
  overscroll-behavior-inline: contain;
  /* The clip keeps the hover lift from bleeding past the row edges. */
  scroll-padding-inline: var(--shell-pad);
}
.rail-track::-webkit-scrollbar { display: none; }
.rail-track--wide { grid-auto-columns: clamp(15rem, 24vw, 22rem); }
.rail-item { min-inline-size: 0; scroll-snap-align: start; }

@media (max-width: 48rem) {
  .rail-nav { display: none; }
  .rail-track { grid-auto-columns: 8.4rem; }
  .rail-track--wide { grid-auto-columns: 15rem; }
}
</style>
