<script setup lang="ts">
import type { BrowseResult, LibraryKind } from '#shared/types/library'
import MovieCard from '~/components/public/MovieCard.vue'

const route = useRoute()
const router = useRouter()

const sorts = [
  { value: 'newest', label: '最新入库' },
  { value: 'rating', label: '评分最高' },
  { value: 'year', label: '年份最新' },
  { value: 'title', label: '按片名' },
] as const

function readQuery() {
  const value = (key: string) => typeof route.query[key] === 'string' ? String(route.query[key]) : ''
  return {
    q: value('q'),
    kind: value('kind') === 'movie' || value('kind') === 'series' ? value('kind') as LibraryKind : '',
    genre: value('genre'),
    region: value('region'),
    year: value('year'),
    minRating: value('minRating'),
    sort: value('sort') || 'newest',
    page: Math.max(1, Number(value('page')) || 1),
  }
}

const filters = computed(readQuery)
// The top navigation already separates films from series, so this page never
// shows its own kind switch; it just renders whichever kind was asked for.
const isSeries = computed(() => filters.value.kind === 'series')
const heading = computed(() => {
  if (isSeries.value) return { eyebrow: '剧集', title: '剧集', lede: '多集连续播放的作品，按季与集展开。' }
  if (filters.value.kind === 'movie') return { eyebrow: '电影', title: '电影', lede: '单部作品，按类型、地区、年份和评分浏览。' }
  return { eyebrow: '片库', title: '全部作品', lede: '按类型、地区、年份和评分浏览整座片库。' }
})
useSeoMeta({
  title: () => `${heading.value.title} · 夜灯`,
  description: () => heading.value.lede,
})

const apiQuery = computed(() => ({
  q: filters.value.q || undefined,
  kind: filters.value.kind || undefined,
  genre: filters.value.genre || undefined,
  region: filters.value.region || undefined,
  yearFrom: filters.value.year || undefined,
  yearTo: filters.value.year || undefined,
  minRating: filters.value.minRating || undefined,
  sort: filters.value.sort,
  page: filters.value.page,
  pageSize: 24,
}))

const { data, status, refresh } = await useFetch<BrowseResult>('/api/library/browse', {
  query: apiQuery,
  deep: false,
})
const result = computed(() => data.value)
const pages = computed(() => Math.max(1, Math.ceil((result.value?.total ?? 0) / (result.value?.pageSize ?? 24))))
const sheetOpen = ref(false)

// Every filter is a URL parameter, so filters survive refresh and can be shared.
function update(patch: Record<string, string | number | null | undefined>) {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...route.query, ...patch })) {
    if (value === null || value === undefined || value === '' || (key === 'page' && Number(value) === 1) || (key === 'sort' && value === 'newest')) continue
    next[key] = String(value)
  }
  void router.replace({ path: '/browse', query: next })
}

// `kind` belongs to the navigation, not to the filters, so it is not counted.
const activeCount = computed(() => [filters.value.genre, filters.value.region, filters.value.year, filters.value.minRating]
  .filter(Boolean).length)

function clearAll() {
  void router.replace({ path: '/browse', query: filters.value.kind ? { kind: filters.value.kind } : {} })
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
        <button class="btn btn--ghost filter-toggle" type="button" :aria-expanded="sheetOpen" @click="sheetOpen = !sheetOpen">
          筛选<span v-if="activeCount" class="filter-count">{{ activeCount }}</span>
        </button>
      </div>
    </div>

    <div class="browse-layout shell">
      <aside class="filters" :class="{ 'is-open': sheetOpen }" aria-label="筛选条件">
        <div class="filter-head">
          <h2>筛选</h2>
          <button v-if="activeCount" class="filter-clear" type="button" @click="clearAll">清除</button>
        </div>
        <template v-if="result?.facets">
          <fieldset class="filter-group">
            <legend>类型</legend>
            <div class="chips">
              <button type="button" class="chip" :aria-pressed="!filters.genre" @click="update({ genre: null, page: null })">全部</button>
              <button
                v-for="genre in result.facets.genres"
                :key="genre"
                type="button"
                class="chip"
                :aria-pressed="filters.genre === genre"
                @click="update({ genre, page: null })"
              >{{ genre }}</button>
            </div>
          </fieldset>
          <fieldset v-if="result.facets.regions.length" class="filter-group">
            <legend>地区</legend>
            <div class="chips">
              <button type="button" class="chip" :aria-pressed="!filters.region" @click="update({ region: null, page: null })">全部</button>
              <button
                v-for="region in result.facets.regions"
                :key="region"
                type="button"
                class="chip"
                :aria-pressed="filters.region === region"
                @click="update({ region, page: null })"
              >{{ region }}</button>
            </div>
          </fieldset>
          <fieldset v-if="result.facets.years.length" class="filter-group">
            <legend>年份</legend>
            <div class="chips">
              <button type="button" class="chip" :aria-pressed="!filters.year" @click="update({ year: null, page: null })">全部</button>
              <button
                v-for="year in result.facets.years.slice(0, 12)"
                :key="year"
                type="button"
                class="chip"
                :aria-pressed="filters.year === String(year)"
                @click="update({ year, page: null })"
              >{{ year }}</button>
            </div>
          </fieldset>
        </template>
        <fieldset class="filter-group">
          <legend>评分</legend>
          <div class="chips">
            <button type="button" class="chip" :aria-pressed="!filters.minRating" @click="update({ minRating: null, page: null })">不限</button>
            <button
              v-for="score in ['8', '7', '6']"
              :key="score"
              type="button"
              class="chip"
              :aria-pressed="filters.minRating === score"
              @click="update({ minRating: score, page: null })"
            >{{ score }} 分以上</button>
          </div>
        </fieldset>
      </aside>

      <section class="results">
        <div v-if="status === 'pending' || status === 'idle'" class="grid" aria-hidden="true">
          <div v-for="n in 8" :key="n" class="skeleton-card" />
        </div>
        <div v-else-if="status === 'error'" class="state" role="alert">
          <p>暂时无法读取片库。</p>
          <button class="btn btn--ghost" type="button" @click="refresh()">重试</button>
        </div>
        <div v-else-if="!result?.items.length" class="state">
          <h2>没有符合条件的{{ isSeries ? '剧集' : (filters.kind === 'movie' ? '电影' : '作品') }}</h2>
          <p v-if="activeCount">试着放宽筛选条件。</p>
          <p v-else-if="isSeries">还没有入库任何剧集。带集号的文件上传或扫描后会自动成为剧集。</p>
          <p v-else>片库还是空的，可以先到管理后台上传或扫描影片。</p>
          <button v-if="activeCount" class="btn" type="button" @click="clearAll">清除筛选</button>
          <NuxtLink v-else-if="!filters.kind" to="/browse?kind=movie" class="btn">去看电影</NuxtLink>
        </div>
        <template v-else>
          <ul class="grid" role="list">
            <li v-for="item in result.items" :key="item.id">
              <MovieCard :item="item" />
            </li>
          </ul>
          <nav v-if="pages > 1" class="pager" aria-label="翻页">
            <button class="btn btn--ghost" type="button" :disabled="filters.page <= 1" @click="update({ page: filters.page - 1 })">上一页</button>
            <span class="pager-info">第 {{ filters.page }} / {{ pages }} 页</span>
            <button class="btn btn--ghost" type="button" :disabled="filters.page >= pages" @click="update({ page: filters.page + 1 })">下一页</button>
          </nav>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.browse { padding-block: calc(var(--header-h) + clamp(1.5rem, 4vw, 3rem)) clamp(2rem, 5vw, 4rem); }
.browse-head { display: grid; gap: 0.6rem; padding-block-end: clamp(1.2rem, 2.6vw, 2rem); }
.browse-head h1 { font-size: clamp(1.9rem, 4vw, 3rem); font-weight: 700; }
.browse-lede { margin: 0; color: var(--text-secondary); font-size: 0.95rem; }
.browse-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.8rem; padding-block-end: 1.4rem; border-block-end: 1px solid var(--border); }
.bar-actions { display: flex; align-items: center; gap: 0.6rem; }
.sort-select { min-block-size: 40px; font-size: 0.85rem; }
.filter-toggle { display: none; min-block-size: 40px; align-items: center; gap: 0.4rem; font-size: 0.85rem; }
.filter-count { padding: 0 0.35rem; border-radius: var(--radius-pill); background: var(--accent); color: var(--on-accent); font-size: 0.7rem; font-weight: 700; }

.browse-layout { display: grid; grid-template-columns: 14rem minmax(0, 1fr); gap: clamp(1.4rem, 2.6vw, 2.6rem); padding-block-start: 1.8rem; align-items: start; }
.filters { display: grid; gap: 1.5rem; position: sticky; top: calc(var(--header-h) + 1rem); }
.filter-head { display: flex; align-items: baseline; justify-content: space-between; }
.filter-head h2 { font-size: 0.95rem; font-weight: 600; }
.filter-clear { padding: 0; border: 0; background: transparent; color: var(--accent); font-size: 0.82rem; }
.filter-group { margin: 0; padding: 0; border: 0; }
.filter-group legend { padding: 0 0 0.6rem; color: var(--text-muted); font-size: 0.76rem; letter-spacing: 0.1em; }
.chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.chip {
  padding: 0.3rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.78rem;
  transition: background-color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.chip:hover { border-color: var(--border-strong); color: var(--text); }
.chip[aria-pressed='true'] { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }

.results { min-inline-size: 0; }
.result-count { margin: 0 0 1rem; color: var(--text-muted); font-size: 0.82rem; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(11.5rem, 1fr)); gap: clamp(1rem, 1.8vw, 1.6rem) clamp(0.8rem, 1.4vw, 1.25rem); margin: 0; padding: 0; list-style: none; }
.grid li { min-inline-size: 0; }
.skeleton-card { aspect-ratio: 2 / 3; border-radius: var(--radius-sm); background: linear-gradient(100deg, #15171b 20%, #1d2026 40%, #15171b 60%); background-size: 220% 100%; animation: shimmer 1.5s linear infinite; }
@keyframes shimmer { to { background-position: -220% 0; } }
.state { display: grid; justify-items: start; gap: 0.8rem; padding-block: 3rem; color: var(--text-secondary); }
.state h2 { font-size: 1.15rem; color: var(--text); }
.pager { display: flex; align-items: center; justify-content: center; gap: 1rem; padding-block-start: 2.2rem; }
.pager-info { color: var(--text-muted); font-size: 0.82rem; font-variant-numeric: tabular-nums; }

@media (max-width: 62rem) {
  .browse-layout { grid-template-columns: minmax(0, 1fr); }
  .filters { position: static; display: none; padding: 1.2rem; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-elevated); }
  .filters.is-open { display: grid; }
  .filter-toggle { display: inline-flex; }
}
@media (max-width: 34rem) {
  .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
