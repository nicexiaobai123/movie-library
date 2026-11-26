<script setup lang="ts">
import type { LibraryCard, TitleDetail } from '#shared/types/library'
import EpisodeList from '~/components/public/EpisodeList.vue'
import MovieCard from '~/components/public/MovieCard.vue'
import PublicIcon from '~/components/public/Icon.vue'
import LibraryState from '~/components/public/LibraryState.vue'

const route = useRoute()
const titleId = computed(() => String(route.params.id ?? ''))
const detailPath = computed(() => `/movie/${encodeURIComponent(titleId.value)}`)
const { data: detail, status, error, refresh } = await useFetch<TitleDetail>(
  () => `/api/library/${encodeURIComponent(titleId.value)}`,
  { deep: false },
)

const notFound = computed(() => (error.value?.statusCode ?? error.value?.status) === 404)
if (import.meta.server && notFound.value) {
  const event = useRequestEvent()
  if (event) setResponseStatus(event, 404)
}

useSeoMeta({ title: () => detail.value ? `${detail.value.title} · 播放 · 夜灯` : '播放 · 夜灯' })

const requestedEpisode = computed(() => route.query.episode)
const activeEpisode = computed(() => {
  if (detail.value?.kind !== 'series') return undefined
  const episodes = detail.value.episodes
  if (requestedEpisode.value !== undefined) {
    return typeof requestedEpisode.value === 'string'
      ? episodes.find(episode => episode.id === requestedEpisode.value)
      : undefined
  }
  const ordered = [...episodes].sort((a, b) => a.season - b.season || a.episode - b.episode)
  return ordered.find(episode => episode.media?.available) ?? ordered[0]
})
const invalidEpisode = computed(() => detail.value?.kind === 'series'
  && requestedEpisode.value !== undefined && !activeEpisode.value)
const media = computed(() => detail.value?.kind === 'movie' ? detail.value.movie : activeEpisode.value?.media)
const sourceUrl = computed(() => media.value?.available ? `/api/media/${encodeURIComponent(media.value.id)}` : undefined)
const downloadUrl = computed(() => sourceUrl.value ? `${sourceUrl.value}/download` : undefined)
const videoKey = computed(() => JSON.stringify([sourceUrl.value, activeEpisode.value?.id]))

const unavailableTitle = computed(() => invalidEpisode.value ? '找不到这一集' : '没有可播放的文件')
const unavailableMessage = computed(() => {
  if (detail.value?.kind === 'series') {
    if (invalidEpisode.value) return detail.value.episodes.length
      ? '链接中的分集可能已移除。请在下方重新选集。'
      : '链接中的分集可能已移除，目前没有可选分集。'
    return activeEpisode.value
      ? '这一集的源文件可能尚未入库或已移走。可以在下方查看其他分集。'
      : '这部剧集暂未录入分集。'
  }
  return '这部电影的源文件可能尚未入库或已移走。'
})

const fileSize = computed(() => {
  let size = media.value?.size ?? 0
  if (!Number.isFinite(size) || size <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let unit = 0
  while (size >= 1000 && unit < units.length - 1) {
    size /= 1000
    unit++
  }
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: unit > 0 ? 1 : 0 }).format(size)} ${units[unit]}`
})

// Suggested viewing comes from the same public catalog, excluding this title.
const { data: related } = await useFetch<{ items: LibraryCard[] }>('/api/library/browse', {
  query: { kind: detail.value?.kind, pageSize: 12 },
  default: () => ({ items: [] }),
  server: false,
})
const more = computed(() => (related.value?.items ?? []).filter(item => item.id !== titleId.value).slice(0, 6))

const stage = ref<HTMLElement | null>(null)
const player = ref<HTMLVideoElement | null>(null)
const playbackError = ref('')
const isFullscreen = ref(false)
const fillScreen = ref(false)
// Focus rings are for Tab navigation only; playback keys and clicks must not
// leave a highlight frame around the picture.
const tabFocus = ref(false)

function reportPlaybackError() {
  if (player.value?.error?.code === 2) {
    playbackError.value = '视频读取中断。请检查局域网连接，或尝试下载原文件。'
  } else if (player.value?.error?.code === 3 || player.value?.error?.code === 4) {
    playbackError.value = '浏览器无法解码或播放此视频。请下载原文件后用本地播放器打开。'
  } else {
    playbackError.value = '视频未能播放。可重新载入视频，或下载原文件观看。'
  }
}

function reloadVideo() {
  if (!player.value) return
  playbackError.value = ''
  player.value.load()
  player.value.focus()
}

const seekStep = 3
const seekNotice = ref('')
let noticeTimer: ReturnType<typeof setTimeout> | undefined

function clockTime(seconds: number) {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`
}

function showSeekNotice(message: string) {
  seekNotice.value = message
  if (noticeTimer !== undefined) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => { seekNotice.value = '' }, 1600)
}

function seekBy(delta: number): boolean {
  const element = player.value
  if (!element || !Number.isFinite(element.duration) || element.duration <= 0) return false
  const target = Math.min(Math.max(element.currentTime + delta, 0), Math.max(element.duration - 0.05, 0))
  if (Math.abs(target - element.currentTime) < 0.01) return false
  element.currentTime = target
  showSeekNotice(`${delta > 0 ? '快进' : '快退'} ${Math.round(Math.abs(delta))} 秒 · ${clockTime(target)}`)
  return true
}

// Keys are adopted only when a real, loadable video is present.
function playerReady(): boolean {
  const element = player.value
  return Boolean(element && Number.isFinite(element.duration) && element.duration > 0)
}

function typingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

// Fullscreen the stage rather than the bare <video>, so our own black frame,
// hint text and key handling stay in control instead of the browser's chrome.
async function toggleFullscreen() {
  if (document.fullscreenElement) {
    await document.exitFullscreen?.()
    return
  }
  const element = stage.value
  if (!element?.requestFullscreen) return
  try { await element.requestFullscreen() } catch { /* the browser refused; keep inline playback */ }
}

function syncFullscreen() {
  const element = document.fullscreenElement
  const active = Boolean(element) && (element === stage.value || element === player.value)
  isFullscreen.value = active
  if (!active) fillScreen.value = false
}

function handlePlayerKey(event: KeyboardEvent) {
  // Leave browser and operating-system shortcuts untouched.
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  if (typingTarget(event.target)) return
  if (!playerReady()) return
  // Tab (and Shift+Tab) is how keyboard users locate the player; everything
  // else is playback and must not leave a highlight frame around the picture.
  tabFocus.value = event.key === 'Tab'
  if (event.key === 'f' || event.key === 'F') {
    void toggleFullscreen()
    event.preventDefault()
    return
  }
  const delta = event.key === 'ArrowRight' ? seekStep : event.key === 'ArrowLeft' ? -seekStep : 0
  if (!delta) return
  if (!seekBy(delta)) return
  event.preventDefault()
}
watch(videoKey, () => {
  playbackError.value = ''
  seekNotice.value = ''
})
watch(player, (element) => {
  // Metadata preloading can fail before the SSR video is hydrated.
  if (element?.error) reportPlaybackError()
}, { flush: 'post' })

onMounted(() => {
  window.addEventListener('keydown', handlePlayerKey, true)
  document.addEventListener('fullscreenchange', syncFullscreen)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handlePlayerKey, true)
  document.removeEventListener('fullscreenchange', syncFullscreen)
  if (noticeTimer !== undefined) clearTimeout(noticeTimer)
})

</script>

<template>
  <div class="shell watch-page">
    <NuxtLink class="watch-back" :to="detailPath" data-test="watch-back">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m14.5 6-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
      返回影片详情
    </NuxtLink>

    <LibraryState
      v-if="status === 'pending' || status === 'idle'"
      class="watch-page-state"
      variant="loading"
      heading="h1"
      title="正在读取作品…"
    />
    <LibraryState
      v-else-if="notFound"
      class="watch-page-state"
      variant="unavailable"
      heading="h1"
      title="找不到这部作品"
      description="它可能已从影视库移除。"
    >
      <NuxtLink to="/" class="btn">返回首页</NuxtLink>
    </LibraryState>
    <LibraryState
      v-else-if="status === 'error' || !detail"
      class="watch-page-state"
      variant="error"
      heading="h1"
      title="暂时无法读取作品"
      description="请检查局域网连接，或稍后重试。"
    >
      <button class="btn" type="button" @click="refresh()">重试</button>
    </LibraryState>
    <template v-else>
      <header class="watch-heading">
        <p class="eyebrow">正在放映</p>
        <h1>{{ detail.title }}</h1>
        <p v-if="activeEpisode" class="watch-episode">
          <span>第 {{ activeEpisode.season }} 季 · 第 {{ activeEpisode.episode }} 集</span>
          <span v-if="activeEpisode.title" class="watch-episode-name">{{ activeEpisode.title }}</span>
        </p>
      </header>

      <section v-if="sourceUrl" class="watch-player" aria-label="视频播放">
        <div ref="stage" class="watch-stage" :class="{ 'is-fullscreen': isFullscreen, 'is-fill': fillScreen, 'is-tab-focus': tabFocus }">
          <video
            :key="videoKey"
            ref="player"
            :src="sourceUrl"
            :aria-label="activeEpisode ? `播放${detail.title}第 ${activeEpisode.season} 季第 ${activeEpisode.episode} 集` : `播放${detail.title}`"
            tabindex="0"
            controls
            playsinline
            preload="metadata"
            @error="reportPlaybackError"
            @loadedmetadata="playbackError = ''"
            @dblclick="toggleFullscreen"
          >
            当前浏览器不支持网页视频。<a :href="downloadUrl" download>下载原文件</a>后可用本地播放器观看。
          </video>
          <p v-if="seekNotice" class="watch-seek" aria-hidden="true">{{ seekNotice }}</p>
          <div v-if="isFullscreen" class="watch-overlay">
            <button
              class="watch-overlay-button"
              type="button"
              aria-label="退出全屏"
              @click="toggleFullscreen"
            >
              <PublicIcon name="collapse" />
              <span>退出全屏</span>
            </button>
            <button
              class="watch-overlay-button"
              type="button"
              :aria-label="fillScreen ? '保持画面比例，显示黑边' : '拉伸铺满屏幕，裁掉边缘'"
              @click="fillScreen = !fillScreen"
            >
              <span v-text="fillScreen ? '保持比例' : '铺满屏幕'" />
            </button>
          </div>
        </div>
        <div class="watch-controls">
          <div class="watch-note" role="status">
            <template v-if="playbackError">
              <PublicIcon name="warning" class="watch-warning" />
              <span>{{ playbackError }}</span>
            </template>
            <span v-else>无法在网页中播放时，可下载原文件观看。</span>
            <span class="watch-keys">键盘 <kbd>←</kbd> <kbd>→</kbd> 快退或快进 {{ seekStep }} 秒</span>
          </div>
          <div class="watch-actions">
            <button v-if="playbackError" type="button" class="btn watch-action" @click="reloadVideo">重新载入</button>
            <button
              type="button"
              class="btn watch-action"
              aria-label="全屏播放"
              @click="toggleFullscreen"
            >
              <PublicIcon name="expand" />
              <span>全屏</span>
            </button>
            <a v-if="detail.kind === 'series' && detail.episodes.length" href="#watch-episodes" class="btn watch-action">选集</a>
            <a :href="downloadUrl" class="btn watch-action" download>
              <PublicIcon name="download" />
              <span>下载原文件</span>
              <span v-if="fileSize" class="watch-file-size">{{ fileSize }}</span>
            </a>
          </div>
        </div>
      </section>
      <LibraryState
        v-else
        class="watch-player"
        variant="unavailable"
        :title="unavailableTitle"
        :description="unavailableMessage"
      >
        <a v-if="detail.kind === 'series' && detail.episodes.length" href="#watch-episodes" class="btn watch-action">选集</a>
      </LibraryState>

      <EpisodeList
        v-if="detail.kind === 'series'"
        id="watch-episodes"
        class="watch-episodes"
        :title-id="detail.id"
        :episodes="detail.episodes"
        :active-episode-id="activeEpisode?.id"
        tabindex="-1"
      />

      <section class="watch-about" aria-labelledby="watch-about-title">
        <h2 id="watch-about-title" class="section-title">关于这部影片</h2>
        <p v-if="detail.description" class="watch-about-text">{{ detail.description }}</p>
        <p v-else class="watch-about-text watch-about-text--muted">暂无简介。</p>
        <p class="watch-about-meta">
          <span v-if="detail.rating" class="watch-about-score">★ {{ detail.rating.toFixed(1) }}</span>
          <span v-if="detail.year">{{ detail.year }}</span>
          <span v-if="detail.region">{{ detail.region }}</span>
          <span v-for="genre in detail.genres" :key="genre">{{ genre }}</span>
        </p>
      </section>

      <section v-if="more.length" class="watch-more" aria-labelledby="watch-more-title">
        <h2 id="watch-more-title" class="section-title">接着看</h2>
        <ul class="watch-more-grid" role="list">
          <li v-for="item in more" :key="item.id">
            <MovieCard :item="item" />
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>


<style scoped>
.watch-page {
  padding-block: calc(var(--header-h) + clamp(0.8rem, 2vw, 1.4rem)) clamp(2.5rem, 6vw, 4.5rem);
}
.watch-back {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-block-size: 40px;
  color: var(--text-secondary);
  font-size: 0.86rem;
  text-decoration: none;
  transition: color var(--dur-fast) var(--ease);
}
.watch-back svg { inline-size: 1.05rem; block-size: 1.05rem; }
.watch-back:hover { color: var(--text); }
.watch-page-state { margin-block-start: 1rem; }

.watch-heading { margin-block-start: clamp(0.6rem, 1.8vw, 1.1rem); display: grid; gap: 0.4rem; }
.watch-heading h1 {
  font-size: clamp(1.5rem, 3.2vw, 2.4rem);
  font-weight: 700;
  letter-spacing: -0.02em;
  overflow-wrap: anywhere;
}
.watch-episode { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.3rem 0.9rem; margin: 0; color: var(--text-secondary); font-size: 0.9rem; }
.watch-episode-name { color: var(--text-muted); }

.watch-player { margin-block-start: clamp(0.9rem, 2vw, 1.4rem); }
.watch-stage {
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-md);
  background: #000;
  box-shadow: var(--shadow-player);
}
.watch-stage.is-fullscreen,
.watch-stage:fullscreen {
  display: grid;
  place-items: center;
  inline-size: 100vw;
  block-size: 100vh;
  box-sizing: border-box;
  border: 0;
  border-radius: 0;
}
.watch-stage video {
  display: block;
  inline-size: 100%;
  max-block-size: 76vh;
  max-block-size: 76svh;
  aspect-ratio: 16 / 9;
  background: #000;
  object-fit: contain;
}
.watch-stage.is-fullscreen video,
.watch-stage:fullscreen video { inline-size: 100%; block-size: 100%; max-block-size: none; }
.watch-stage.is-fullscreen.is-fill video { object-fit: cover; }
.watch-stage video:focus-visible { outline: none; }
.watch-stage.is-tab-focus video:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px; }

.watch-seek {
  position: absolute;
  inset-block-start: 50%;
  inset-inline-start: 50%;
  margin: 0;
  padding: 0.55rem 1rem;
  border-radius: var(--radius-pill);
  background: rgb(0 0 0 / 0.72);
  color: #fff;
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  transform: translate(-50%, -50%);
  pointer-events: none;
  backdrop-filter: blur(6px);
}
.watch-overlay {
  position: absolute;
  z-index: 5;
  inset-block-start: 0.9rem;
  inset-inline-end: 0.9rem;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.55rem;
  max-inline-size: calc(100% - 1.8rem);
  pointer-events: none;
}
.watch-overlay-button {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-block-size: 40px;
  padding-inline: 0.9rem;
  border: 1px solid rgb(255 255 255 / 0.18);
  border-radius: var(--radius-pill);
  background: rgb(0 0 0 / 0.6);
  color: #fff;
  font-size: 0.82rem;
  opacity: 0.6;
  pointer-events: auto;
  transition: opacity var(--dur-fast) var(--ease), background-color var(--dur-fast) var(--ease);
}
.watch-overlay:hover .watch-overlay-button { opacity: 1; }
.watch-overlay-button:hover, .watch-overlay-button:focus-visible { background: rgb(0 0 0 / 0.85); opacity: 1; }
.watch-overlay-button :deep(svg) { inline-size: 1rem; block-size: 1rem; }

.watch-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.85rem 1rem;
  padding-block: 0.9rem 0;
}
.watch-note { display: flex; flex: 1 1 17rem; flex-wrap: wrap; align-items: center; gap: 0.35rem 0.5rem; min-inline-size: 0; color: var(--text-muted); font-size: 0.84rem; }
.watch-warning { inline-size: 1.05rem; block-size: 1.05rem; color: var(--danger); }
.watch-note:has(.watch-warning) { color: var(--text-secondary); }
.watch-keys { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.28rem; flex-basis: 100%; font-size: 0.78rem; }
.watch-keys kbd { min-inline-size: 1.45rem; padding: 0.05rem 0.32rem; border: 1px solid var(--border-strong); border-radius: var(--radius-xs); background: var(--bg-card); color: var(--text-secondary); font-family: var(--font-sans); font-size: 0.74rem; text-align: center; }
.watch-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-inline-start: auto; }
.watch-action { min-block-size: 42px; padding-inline: 0.95rem; font-size: 0.84rem; white-space: nowrap; }
.watch-action :deep(svg) { inline-size: 1rem; block-size: 1rem; }
.watch-file-size { padding-inline-start: 0.5rem; border-inline-start: 1px solid var(--border-strong); color: var(--text-muted); font-size: 0.74rem; font-variant-numeric: tabular-nums; }
.watch-episodes { margin-block-start: clamp(1.8rem, 4vw, 3rem); scroll-margin-block-start: calc(var(--header-h) + 1rem); }

.watch-about { max-inline-size: 62ch; padding-block-start: clamp(1.6rem, 3.5vw, 2.6rem); }
.watch-about-text { margin: .7rem 0 0; color: var(--text-secondary); font-size: .95rem; line-height: 1.85; text-wrap: pretty; }
.watch-about-text--muted { color: var(--text-muted); }
.watch-about-meta { display: flex; flex-wrap: wrap; align-items: center; gap: .3rem .8rem; margin: 1rem 0 0; color: var(--text-muted); font-size: .82rem; }
.watch-about-score { padding: .1rem .45rem; border-radius: var(--radius-xs); background: var(--accent); color: var(--on-accent); font-weight: 700; font-variant-numeric: tabular-nums; }
.watch-more { padding-block-start: clamp(2rem, 4.5vw, 3.4rem); }
.watch-more-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr)); gap: clamp(.8rem, 1.6vw, 1.3rem); margin: 1rem 0 0; padding: 0; list-style: none; }
.watch-more-grid li { min-inline-size: 0; }

@media (max-width: 40rem) {
  .watch-stage { margin-inline: calc(var(--shell-pad) * -1); border-radius: 0; }
  .watch-actions { flex: 1 1 100%; margin-inline-start: 0; }
  .watch-action { flex: 1 1 8rem; }
  .watch-file-size { display: none; }
  .watch-keys { display: none; }
}
</style>
