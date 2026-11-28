<script setup lang="ts">
import type { BrowseResult, LibraryKind } from '#shared/types/library'
import AppPager from '~/components/public/AppPager.vue'
import MovieCard from '~/components/public/MovieCard.vue'

const route = useRoute()
const router = useRouter()

const sorts = [
  { value: 'newest', label: '最新入库' },
  { value: 'title', label: '按片名' },
] as const

function readQuery() {
  const value = (key: string) => typeof route.query[key] === 'string' ? String(route.query[key]) : ''
  return {
    q: value('q'),
    kind: value('kind') === 'movie' || value('kind') === 'series' ? value('kind') as LibraryKind : '',
    actor: value('actor'),
    sort: value('sort') || 'newest',
    page: Math.max(1, Number(value('page')) || 1),
  }
}

const filters = computed(readQuery)
const isSeries = computed(() => filters.value.kind === 'series')
const heading = computed(() => {
  if (filters.value.actor) return { eyebrow: '演员', title: filters.value.actor, lede: `${filters.value.actor}在片库中的作品。` }
  if (isSeries.value) return { eyebrow: '剧集', title: '剧集', lede: '多集连续播放的作品，按季与集展开。' }
  if (filters.value.kind === 'movie') return { eyebrow: '电影', title: '电影', lede: '片库中的单部作品。' }
  return { eyebrow: '片库', title: '全部作品', lede: '浏览整座片库。' }
})
useSeoMeta({
  title: () => `${heading.value.title} · 夜灯`,
  description: () => heading.value.lede,
})

const apiQuery = computed(() => ({
  q: filters.value.q || undefined,
  kind: filters.value.kind || undefined,
  actor: filters.value.actor || undefined,
  sort: filters.value.sort,
  page: filters.value.page,
  pageSize: 24,
}))

const { data, status } = await useFetch<BrowseResult>('/api/library/browse', {
  query: apiQuery,
  deep: false,
})
const result = computed(() => data.value)
const pages = computed(() => Math.max(1, Math.ceil((result.value?.total ?? 0) / (result.value?.pageSize ?? 24))))

const sheetOpen = ref(false)
const activeCount = computed(() => (filters.value.actor ? 1 : 0))

function goToPage(next: number) {
  const target = Math.min(Math.max(1, next), pages.value)
  if (target === filters.value.page) return
  update({ page: target })
  void nextTick(() => {
    document.getElementById('browse-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

// Every filter is a URL parameter, so filters survive refresh and can be shared.
function update(patch: Record<string, string | number | null | undefined>) {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...route.query, ...patch })) {
    if (value === null || value === undefined || value === ''
      || (key === 'page' && Number(value) === 1)
      || (key === 'sort' && value === 'newest')) continue
    next[key] = String(value)
  }
  void router.replace({ path: '/browse', query: next })
}

function clearAll() {
  const keep: Record<string, string> = {}
  if (filters.value.kind) keep.kind = filters.value.kind
  void router.replace({ path: '/browse', query: keep })
}
</script>

<template>
  <div class="browse">
    <header class="browse-head shell">
      <p class="eyebrow">{{ heading.eyebrow }}</p>
      <h1>{{ heading.title }}</h1>
      <p class="browse-lede">{{ heading.lede }}</p>
    </header>

    <div class="browse-bar shell">
      <p class="result-count" aria-live="polite">
        <template v-if="status === 'pending'">正在读取…</template>
        <template v-else-if="result">{{ result.total }} 部<template v-if="activeCount"> · 已筛选</template></template>
      </p>
      <div class="bar-actions">
        <label class="sort-label">
          <span class="visually-hidden">排序</span>
          <select class="field sort-select" :value="filters.sort" data-test="sort" @change="update({ sort: ($event.target as HTMLSelectElement).value, page: null })">
            <option v-for="sort in sorts" :key="sort.value" :value="sort.value">{{ sort.label }}</option>
          </select>
        </label>
        <button
          v-if="activeCount"
          class="btn btn--ghost filter-toggle"
          type="button"
          data-test="browse-clear"
          @click="clearAll"
        >清除筛选</button>
      </div>
    </div>

    <div class="browse-layout shell">
      <aside v-if="activeCount" class="filters" aria-label="筛选条件">
        <div class="filter-head">
          <h2>筛选</h2>
          <button class="filter-clear" type="button" @click="clearAll">清除</button>
        </div>
        <fieldset v-if="result?.actors?.length" class="filter-group">
          <legend>演员</legend>
          <div class="chips">
            <button type="button" class="chip" :aria-pressed="!filters.actor" @click="update({ actor: null, page: null })">全部</button>
            <button
              v-for="actor in result.actors"
              :key="actor"
              type="button"
              class="chip"
              :aria-pressed="filters.actor === actor"
              @click="update({ actor, page: null })"
            >{{ actor }}</button>
          </div>
        </fieldset>
      </aside>

      <section id="browse-results" class="results" aria-label="作品列表">
        <p v-if="status === 'pending'" class="state-note">正在读取…</p>
        <p v-else-if="!result?.items.length" class="state-note">没有符合条件的作品。</p>
        <ul v-else class="grid" role="list">
          <li v-for="item in result.items" :key="item.id">
            <MovieCard :item="item" />
          </li>
        </ul>

        <!-- Pagination sits at the bottom-right, with first/last shortcuts and
             single-arrow steps, so long catalogues stay easy to walk. -->
        <AppPager
          v-if="pages > 1"
          :page="filters.page"
          :page-count="pages"
          :summary="`共 ${result?.total ?? 0} 部`"
          test-prefix="browse"
          @go="goToPage"
        />
      </section>
    </div>
  </div>
</template>

<style scoped>
.browse { padding-block-end: clamp(2rem, 4vw, 3rem); }
.browse-head { padding-block: clamp(1.6rem, 3vw, 2.4rem) 0; }
.eyebrow { color: var(--accent); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.12em; }
.browse-head h1 { margin-block: 0.5rem 0; font-family: var(--font-display); font-size: clamp(1.8rem, 3.6vw, 2.6rem); font-weight: 500; }
.browse-lede { margin-block-start: 0.5rem; color: var(--text-muted); }
.browse-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 1.5rem;
  margin-block: 1.4rem 0;
  padding-block-end: 0.9rem;
  border-block-end: 1px solid var(--border);
}
.result-count { margin: 0; color: var(--text-muted); font-size: 0.86rem; font-variant-numeric: tabular-nums; }
.bar-actions { display: flex; align-items: center; gap: 0.6rem; }
.sort-select { min-block-size: 38px; }
.browse-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1.6rem;
  margin-block-start: 1.6rem;
}
.filters { min-inline-size: 0; }
.filter-head { display: flex; align-items: baseline; justify-content: space-between; }
.filter-head h2 { font-size: 0.95rem; font-weight: 600; }
.filter-clear { border: 0; background: transparent; color: var(--accent); font-size: 0.8rem; text-decoration: underline; }
.filter-group { margin-block: 1rem 0; padding: 0; border: 0; }
.filter-group legend { padding: 0; color: var(--text-muted); font-size: 0.78rem; }
.chips { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-block-start: 0.5rem; }
.chip {
  min-block-size: 32px;
  padding: 0.15rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-muted);
  font-size: 0.8rem;
}
.chip[aria-pressed='true'] { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.results { min-inline-size: 0; }
.grid {
  display: grid;
  /* Cards flow into as many columns as the width allows; the rail-style single
     column that appeared when the results pane was squeezed is what this replaces. */
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 10rem), 1fr));
  gap: clamp(0.9rem, 1.8vw, 1.5rem);
  margin: 0;
  padding: 0;
  list-style: none;
}
.grid > li { min-inline-size: 0; }
.state-note { color: var(--text-muted); }
@media (min-width: 60rem) {
  /* The filter column only exists while a filter is active; without it the results
     must span the full width instead of being squeezed into the 14rem slot. */
  .browse-layout:has(> .filters) { grid-template-columns: 14rem minmax(0, 1fr); }
}
</style>
