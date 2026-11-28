<script setup lang="ts">
import type { BrowseResult } from '#shared/types/library'
import AppPager from '~/components/public/AppPager.vue'
import MovieCard from '~/components/public/MovieCard.vue'

useSeoMeta({ title: '搜索 · 夜灯', robots: 'noindex, nofollow' })

const route = useRoute()
const router = useRouter()
const query = computed(() => typeof route.query.q === 'string' ? route.query.q.trim() : '')
const page = computed(() => Math.max(1, Number(typeof route.query.page === 'string' ? route.query.page : '') || 1))
const draft = ref(query.value)
watch(query, (value) => { draft.value = value })

// Debounced navigation keeps typing responsive while still updating the URL.
let timer: ReturnType<typeof setTimeout> | undefined
function onInput() {
  if (timer !== undefined) clearTimeout(timer)
  timer = setTimeout(() => {
    const value = draft.value.trim()
    // A new keyword starts again from the first page.
    void router.replace({ path: '/search', query: value ? { q: value } : {} })
  }, 280)
}
function submit() {
  if (timer !== undefined) clearTimeout(timer)
  const value = draft.value.trim()
  void router.replace({ path: '/search', query: value ? { q: value } : {} })
}
onBeforeUnmount(() => { if (timer !== undefined) clearTimeout(timer) })

const pageSize = 24
const { data, status } = await useFetch<BrowseResult>('/api/library/browse', {
  query: computed(() => ({ q: query.value || undefined, page: page.value, pageSize })),
  deep: false,
})
const items = computed(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))

function goToPage(next: number) {
  if (next < 1 || next > pages.value) return
  void router.replace({
    path: '/search',
    query: next === 1 ? { q: query.value } : { q: query.value, page: String(next) },
  })
}
</script>

<template>
  <div class="search-page">
    <div class="shell search-shell">
      <form class="search-form" role="search" @submit.prevent="submit">
        <label for="search-input" class="visually-hidden">搜索影片名称</label>
        <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="10.5" cy="10.5" r="6.4" fill="none" stroke="currentColor" stroke-width="1.6" />
          <path d="m15.6 15.6 4.2 4.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
        <input
          id="search-input"
          v-model="draft"
          class="search-input"
          type="search"
          placeholder="搜索影片名称"
          maxlength="200"
          autocomplete="off"
          autofocus
          enterkeyhint="search"
          data-test="search-input"
          @input="onInput"
        >
        <button v-if="draft" class="search-clear" type="button" aria-label="清空搜索" data-test="search-clear" @click="draft = ''; submit()">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
        </button>
      </form>

      <div v-if="query" class="search-summary" aria-live="polite">
        <p>
          <template v-if="status === 'pending'">正在搜索「{{ query }}」…</template>
          <template v-else>{{ total }} 个结果 · 「{{ query }}」</template>
        </p>
      </div>

      <div v-if="!query" class="search-idle">
        <p>输入片名开始搜索，例如「远山」。</p>
        <NuxtLink to="/browse?kind=movie" class="btn btn--ghost">按筛选浏览电影</NuxtLink>
      </div>
      <div v-else-if="status === 'pending'" class="search-grid" aria-hidden="true">
        <div v-for="n in 6" :key="n" class="skeleton-card" />
      </div>
      <div v-else-if="!items.length" class="search-empty" role="status">
        <h1>没有找到「{{ query }}」</h1>
        <p>换一个关键词，或者去电影、剧集页面浏览。</p>
        <NuxtLink to="/browse?kind=movie" class="btn">浏览电影</NuxtLink>
      </div>
      <template v-else>
        <ul class="search-grid" role="list">
          <li v-for="item in items" :key="item.id">
            <MovieCard :item="item" />
          </li>
        </ul>
        <AppPager
          :page="page"
          :page-count="pages"
          :summary="`共 ${total} 部`"
          test-prefix="search"
          @go="goToPage"
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
.search-page { padding-block: calc(var(--header-h) + clamp(1.5rem, 4vw, 3rem)) clamp(2rem, 5vw, 4rem); }
.search-shell { max-inline-size: 76rem; }
.search-form {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding-inline: 1rem;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-pill);
  background: var(--bg-elevated);
  transition: border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
}
.search-form:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.search-icon { inline-size: 1.2rem; block-size: 1.2rem; flex: none; color: var(--text-muted); }
.search-input {
  flex: 1;
  min-inline-size: 0;
  min-block-size: 58px;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: clamp(1rem, 1.6vw, 1.15rem);
  outline: none;
}
.search-input::placeholder { color: var(--text-muted); }
.search-input::-webkit-search-cancel-button { display: none; }
.search-clear { display: grid; place-items: center; inline-size: 32px; block-size: 32px; border: 0; border-radius: 50%; background: rgb(255 255 255 / 0.08); color: var(--text-secondary); }
.search-clear svg { inline-size: 1rem; block-size: 1rem; }
.search-summary { padding-block: 1.2rem 0.4rem; color: var(--text-muted); font-size: 0.84rem; }
.search-summary p { margin: 0; }
.search-idle { display: grid; justify-items: start; gap: 1rem; padding-block: 3rem; color: var(--text-secondary); }
.search-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr)); gap: clamp(0.8rem, 1.6vw, 1.35rem) clamp(0.7rem, 1.2vw, 1.1rem); margin: 1rem 0 0; padding: 0; list-style: none; }
.search-grid li { min-inline-size: 0; }
.skeleton-card { aspect-ratio: 2 / 3; border-radius: var(--radius-sm); background: linear-gradient(100deg, #15171b 20%, #1d2026 40%, #15171b 60%); background-size: 220% 100%; animation: shimmer 1.5s linear infinite; }
@keyframes shimmer { to { background-position: -220% 0; } }
.search-empty { display: grid; justify-items: start; gap: 0.9rem; padding-block: 3rem; color: var(--text-secondary); }
.search-empty h1 { font-size: clamp(1.3rem, 2.6vw, 1.9rem); color: var(--text); }
/* The pager is the shared AppPager; the catalogue frame gives it its top spacing. */
@media (max-width: 34rem) {
  .search-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
