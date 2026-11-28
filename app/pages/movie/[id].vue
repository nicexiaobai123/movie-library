<script setup lang="ts">
import type { TitleDetail } from '#shared/types/library'
import MovieArt from '~/components/public/MovieArt.vue'
import MovieCard from '~/components/public/MovieCard.vue'
import FavoriteButton from '~/components/public/FavoriteButton.vue'
import EpisodeList from '~/components/public/EpisodeList.vue'

const route = useRoute()
const titleId = computed(() => String(route.params.id ?? ''))
const { data: detail, status, error, refresh } = await useFetch<TitleDetail>(
  () => `/api/library/${encodeURIComponent(titleId.value)}`,
  { deep: false },
)

const notFound = computed(() => (error.value?.statusCode ?? error.value?.status) === 404)
if (import.meta.server && notFound.value) {
  const event = useRequestEvent()
  if (event) setResponseStatus(event, 404)
}
useSeoMeta({ title: () => detail.value ? `${detail.value.title} · 夜灯` : '影片详情 · 夜灯' })

const { data: related } = await useFetch<{ items: TitleDetail[] }>('/api/library/browse', {
  query: { pageSize: 12 },
  default: () => ({ items: [] }),
  server: false,
})

const firstEpisode = computed(() => {
  if (detail.value?.kind !== 'series') return undefined
  return [...detail.value.episodes].sort((a, b) => a.season - b.season || a.episode - b.episode)
    .find(episode => episode.media?.available)
})
const playable = computed(() => {
  if (!detail.value) return null
  return detail.value.kind === 'movie' ? detail.value.movie : firstEpisode.value?.media ?? null
})
const watchLink = computed(() => ({
  path: `/watch/${encodeURIComponent(titleId.value)}`,
  query: firstEpisode.value ? { episode: firstEpisode.value.id } : undefined,
}))
const runtimeLabel = computed(() => {
  const minutes = detail.value?.runtime
  if (!minutes) return null
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours} 小时 ${minutes % 60} 分` : `${minutes} 分钟`
})
const seasonCount = computed(() => new Set(detail.value?.episodes.map(episode => episode.season)).size)
const moreLikeThis = computed(() => (related.value?.items ?? []).filter(item => item.id !== titleId.value).slice(0, 10))
const available = computed(() => Boolean(playable.value?.available))
</script>

<template>
  <div class="detail">
    <div v-if="status === 'pending' || status === 'idle'" class="detail-loading" role="status">
      <p class="visually-hidden">正在读取影片…</p>
      <div class="skeleton detail-skeleton" />
    </div>

    <section v-else-if="notFound" class="detail-missing shell">
      <h1>找不到这部影片</h1>
      <p>它可能已从片库移除。</p>
      <NuxtLink to="/browse?kind=movie" class="btn">浏览电影</NuxtLink>
    </section>

    <section v-else-if="status === 'error' || !detail" class="detail-missing shell" role="alert">
      <h1>暂时无法读取影片</h1>
      <p>请检查连接后重试。</p>
      <button class="btn" type="button" @click="refresh()">重试</button>
    </section>

    <template v-else>
      <div class="backdrop">
        <MovieArt :src="detail.posterUrl" :title="detail.title" ratio="wide" priority :show-caption="false" />
        <div class="backdrop-scrim" aria-hidden="true" />
      </div>

      <article class="detail-body shell">
        <div class="poster-col">
          <div class="poster">
            <MovieArt :src="detail.posterUrl" :title="detail.title" :year="detail.year" :kind="detail.kind" priority />
          </div>
        </div>

        <div class="info-col">
          <p class="eyebrow">{{ detail.kind === 'series' ? '剧集' : '电影' }}</p>
          <h1 class="detail-title">{{ detail.title }}</h1>

          <div class="detail-badges">
            <span v-if="detail.year" class="badge">{{ detail.year }}</span>
            <span v-if="runtimeLabel" class="badge">{{ runtimeLabel }}</span>
            <span v-if="detail.kind === 'series'" class="badge">{{ seasonCount }} 季 · {{ detail.episodes.length }} 集</span>
            <span v-if="!available" class="badge badge--muted">暂无片源</span>
          </div>

          <p v-if="detail.description" class="detail-overview">{{ detail.description }}</p>
          <p v-else class="detail-overview detail-overview--empty">暂无简介。</p>

          <div class="detail-actions">
            <NuxtLink v-if="available && playable" :to="watchLink" class="btn btn--primary detail-btn">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8.5 5.5 18.5 12l-10 6.5z" fill="currentColor" /></svg>
              {{ detail.kind === 'series' ? '开始播放' : '播放正片' }}
            </NuxtLink>
            <span v-else class="detail-unavailable">源文件暂不可用</span>
            <FavoriteButton class="detail-favorite" />
          </div>

          <dl v-if="detail.cast.length" class="detail-credits">
            <div>
              <dt>演员</dt>
              <dd>
                <NuxtLink
                  v-for="(name, index) in detail.cast"
                  :key="name"
                  :to="{ path: '/browse', query: { actor: name } }"
                  class="detail-cast-link"
                >{{ name }}{{ index < detail.cast.length - 1 ? ' / ' : '' }}</NuxtLink>
              </dd>
            </div>
          </dl>
        </div>
      </article>

      <section v-if="detail.kind === 'series' && detail.episodes.length" class="shell episodes-block">
        <EpisodeList :title-id="detail.id" :episodes="detail.episodes" />
      </section>

      <section v-if="moreLikeThis.length" class="shell more">
        <h2 class="section-title">更多类似影片</h2>
        <ul class="more-grid" role="list">
          <li v-for="item in moreLikeThis" :key="item.id">
            <MovieCard :item="item" />
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.detail { position: relative; padding-block-end: clamp(2rem, 5vw, 4rem); }
/* Content paints above the backdrop layer, and the backdrop above the page. */
.detail > :not(.backdrop) { position: relative; z-index: 1; }
.detail-loading { padding-block: calc(var(--header-h) + 3rem) 4rem; padding-inline: var(--shell-pad); }
.detail-skeleton { block-size: 60vh; border-radius: var(--radius-lg); animation: shimmer 1.5s linear infinite; background: linear-gradient(100deg,#15171b 20%,#1d2026 40%,#15171b 60%); background-size: 220% 100%; }
@keyframes shimmer { to { background-position: -220% 0; } }

.detail-missing { display: grid; justify-items: start; gap: 1rem; padding-block: calc(var(--header-h) + 4rem) 4rem; }
.detail-missing h1 { font-size: clamp(1.6rem, 3vw, 2.4rem); }
.detail-missing p { color: var(--text-secondary); }

.backdrop { position: absolute; z-index: 0; inset-block-start: 0; inset-inline: 0; block-size: clamp(24rem, 56vh, 40rem); }
.backdrop :deep(.art) { block-size: 100%; aspect-ratio: auto; }
.backdrop-scrim {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(180deg, rgb(8 9 11 / 0.55) 0%, rgb(8 9 11 / 0.72) 46%, var(--bg) 96%),
    linear-gradient(90deg, rgb(8 9 11 / 0.85) 0%, transparent 65%);
}

.detail-body {
  display: grid;
  grid-template-columns: minmax(0, 15rem) minmax(0, 1fr);
  gap: clamp(1.4rem, 3.5vw, 3.2rem);
  align-items: start;
  padding-block: calc(var(--header-h) + clamp(1.5rem, 5vw, 4rem)) 0;
}
.poster { border-radius: var(--radius-md); overflow: hidden; box-shadow: var(--shadow-card); }
.info-col { min-inline-size: 0; display: grid; align-content: start; gap: 0.85rem; padding-block-start: 0.4rem; }
.detail-title { margin: 0; font-size: clamp(1.9rem, 4vw, 3.2rem); font-weight: 700; letter-spacing: -0.025em; line-height: 1.05; text-wrap: balance; }
.detail-original { margin: 0; color: var(--text-secondary); font-size: 0.92rem; letter-spacing: 0.02em; }
.detail-badges { display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem; }
.badge { padding: 0.15rem 0.55rem; border: 1px solid var(--border); border-radius: var(--radius-pill); color: var(--text-secondary); font-size: 0.76rem; font-variant-numeric: tabular-nums; }
.badge--score { border-color: transparent; background: var(--accent); color: var(--on-accent); font-weight: 700; }
.badge--muted { color: var(--text-muted); }
.detail-genres { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.genre-chip { padding: 0.2rem 0.7rem; border-radius: var(--radius-pill); background: rgb(255 255 255 / 0.07); color: var(--text-secondary); font-size: 0.78rem; text-decoration: none; transition: background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease); }
.genre-chip:hover { background: var(--accent-soft); color: var(--accent); }
.detail-overview { max-inline-size: 60ch; margin: 0.2rem 0 0; color: var(--text-secondary); font-size: 0.95rem; line-height: 1.85; text-wrap: pretty; }
.detail-overview--empty { color: var(--text-muted); }
.detail-cast-link { color: var(--text-secondary); text-decoration: none; }
.detail-cast-link:hover { color: var(--accent); }
.detail-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.7rem; margin-block-start: 0.5rem; }
/* The favourite section holds a button plus an optional hint. Only the button
   belongs on this row, so the section is flattened into the flex container and
   the hint forces its own line underneath. */
.detail-actions :deep(.detail-favorite) {
  display: contents;
}
/* Both controls are given the same box so they read as one row. */
.detail-btn,
.detail-actions :deep(.detail-favorite .btn) {
  min-block-size: 46px;
  padding-inline: 1.4rem;
  font-size: 0.92rem;
}
.detail-btn svg { inline-size: 1rem; block-size: 1rem; }
.detail-actions :deep(.favorite-note),
.detail-actions :deep(.favorite-error) {
  flex-basis: 100%;
  margin: 0.4rem 0 0;
}
.detail-unavailable { color: var(--text-muted); font-size: 0.85rem; }
.detail-credits { display: grid; gap: 0.4rem; margin: 0.7rem 0 0; padding-block-start: 1rem; border-block-start: 1px solid var(--border); }
.detail-credits div { display: grid; grid-template-columns: 3.2rem minmax(0, 1fr); gap: 0.7rem; }
.detail-credits dt { color: var(--text-muted); font-size: 0.82rem; }
.detail-credits dd { margin: 0; color: var(--text-secondary); font-size: 0.88rem; overflow-wrap: anywhere; }

.episodes-block, .more { padding-block-start: clamp(2rem, 4.5vw, 3.4rem); }
.more-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(8.6rem, 1fr)); gap: clamp(0.7rem, 1.4vw, 1.2rem); margin: 1rem 0 0; padding: 0; list-style: none; }
.more-grid li { min-inline-size: 0; }

@media (max-width: 48rem) {
  .detail-body { grid-template-columns: minmax(0, 1fr); padding-block-start: calc(var(--header-h) + 1rem); }
  .poster-col { inline-size: 9rem; }
  .backdrop { block-size: 22rem; }
  /* Playback is the primary action, so it takes the row; the favourite control
     sits beside it instead of wrapping to a lonely second line. */
  .detail-actions { align-items: stretch; gap: 0.6rem; }
  .detail-actions > * { flex: 1 1 auto; }
  .detail-actions :deep(.btn) { inline-size: 100%; }
  .detail-actions .detail-unavailable { flex-basis: 100%; }
}
</style>
