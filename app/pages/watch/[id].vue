<script setup lang="ts">
import type { LibraryCard, TitleDetail } from '#shared/types/library'
import EpisodeList from '~/components/public/EpisodeList.vue'
import MovieCard from '~/components/public/MovieCard.vue'
import PublicIcon from '~/components/public/Icon.vue'
import LibraryState from '~/components/public/LibraryState.vue'
import { recordPlaybackProgress, useContinueWatching } from '~/composables/useProgress'
import { useUserSession } from '~/composables/useUser'

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

// Episodes in viewing order; "next" means the following slot that actually has a
// file, so a gap in the folder does not dead-end the button.
const orderedEpisodes = computed(() => {
  if (detail.value?.kind !== 'series') return []
  return [...detail.value.episodes].sort((a, b) => a.season - b.season || a.episode - b.episode)
})
const nextEpisode = computed(() => {
  const current = activeEpisode.value
  if (!current) return undefined
  const list = orderedEpisodes.value
  const index = list.findIndex(episode => episode.id === current.id)
  if (index < 0) return undefined
  return list.slice(index + 1).find(episode => episode.media?.available)
})
const previousEpisode = computed(() => {
  const current = activeEpisode.value
  if (!current) return undefined
  const list = orderedEpisodes.value
  const index = list.findIndex(episode => episode.id === current.id)
  if (index <= 0) return undefined
  return list.slice(0, index).reverse().find(episode => episode.media?.available)
})

function watchEpisode(episode: { id: string }) {
  return navigateTo({
    path: `/watch/${encodeURIComponent(titleId.value)}`,
    query: { episode: episode.id },
  })
}

// Reaching the end should move on rather than replay a finished episode, but only
// when there really is a next one — the film and the last episode just stop.
const endedNextId = ref<string | null>(null)
const endedCountdown = ref(0)
let endedTimer: ReturnType<typeof setInterval> | undefined

function stopEndedCountdown() {
  if (endedTimer !== undefined) {
    clearInterval(endedTimer)
    endedTimer = undefined
  }
}

function cancelEndedCountdown() {
  stopEndedCountdown()
  endedNextId.value = null
  endedCountdown.value = 0
}

function onEnded() {
  reportProgress(true)
  syncTransport()
  revealControls()
  const next = nextEpisode.value
  if (!next) return
  endedNextId.value = next.id
  endedCountdown.value = 5
  stopEndedCountdown()
  endedTimer = setInterval(() => {
    endedCountdown.value -= 1
    if (endedCountdown.value > 0) return
    stopEndedCountdown()
    if (endedNextId.value) void watchEpisode({ id: endedNextId.value })
  }, 1000)
}
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

// Resume bookkeeping: positions are written at most every few seconds, and the
// stored value is applied once when this exact video first loads.
const { signedIn } = await useUserSession()
const { items: resumeItems, refresh: refreshResume } = await useContinueWatching()
const resumePosition = computed(() => {
  const item = resumeItems.value.find(entry => entry.id === titleId.value
    && (entry.episodeId ?? null) === (activeEpisode.value?.id ?? null))
  return item && item.percent > 0 && item.percent < 97 ? item.position : 0
})
const resumeApplied = ref(false)
const resumeNotice = ref('')
let lastReported = 0
let reportTimer: ReturnType<typeof setTimeout> | undefined

// Playback speed is a viewer preference, so it is remembered across films.
const playbackRates = [0.75, 1, 1.25, 1.5, 2] as const
const rateStorageKey = 'night-library:playback-rate'
const playbackRate = ref(1)

function readStoredRate(): number {
  if (typeof localStorage === 'undefined') return 1
  const stored = Number(localStorage.getItem(rateStorageKey))
  return (playbackRates as readonly number[]).includes(stored) ? stored : 1
}

function setPlaybackRate(value: string) {
  const rate = Number(value)
  if (!(playbackRates as readonly number[]).includes(rate)) return
  playbackRate.value = rate
  if (player.value) player.value.playbackRate = rate
  try { localStorage.setItem(rateStorageKey, String(rate)) } catch { /* private mode */ }
}

// A newly created <video> element starts at 1x, so the choice is re-applied.
function applyPlaybackRate() {
  if (player.value) player.value.playbackRate = playbackRate.value
}

function currentPositionInput() {
  const element = player.value
  if (!element || !Number.isFinite(element.duration) || element.duration <= 0) return null
  return {
    titleId: titleId.value,
    episodeId: activeEpisode.value?.id ?? null,
    position: element.currentTime,
    duration: element.duration,
  }
}

function reportProgress(force = false) {
  if (!signedIn.value) return
  const input = currentPositionInput()
  if (!input) return
  // Skip redundant writes while paused at the same spot.
  if (!force && Math.abs(input.position - lastReported) < 5) return
  lastReported = input.position
  void recordPlaybackProgress(input)
}

function scheduleReport() {
  if (reportTimer !== undefined) return
  reportTimer = setTimeout(() => {
    reportTimer = undefined
    reportProgress()
  }, 10_000)
}

function applyResumePoint() {  const element = player.value
  if (resumeApplied.value || !element || resumePosition.value <= 0) return
  if (!Number.isFinite(element.duration) || element.duration <= 0) return
  if (resumePosition.value >= element.duration - 1) return
  element.currentTime = resumePosition.value
  resumeApplied.value = true
  resumeNotice.value = `已从上次 ${clockTime(resumePosition.value)} 继续播放`
  setTimeout(() => { resumeNotice.value = '' }, 4000)
}

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

const seekStep = 5
const seekNotice = ref('')
let noticeTimer: ReturnType<typeof setTimeout> | undefined

// Touch devices get our own transport bar instead of the native one. The native
// control bar draws its own scrubber knob and double-tap ripple, which cannot be
// styled away, and both sit over the middle of the picture.
const touchUi = ref(false)
const playing = ref(false)
const progress = ref(0)
const duration = ref(0)
const scrubbing = ref(false)
const controlsShown = ref(true)
let hideTimer: ReturnType<typeof setTimeout> | undefined

function syncTransport() {
  const element = player.value
  if (!element) return
  duration.value = Number.isFinite(element.duration) ? element.duration : 0
  // While dragging, the bar shows the finger position rather than the video's.
  if (!scrubbing.value) progress.value = element.currentTime
  playing.value = !element.paused && !element.ended
}

function revealControls() {
  controlsShown.value = true
  if (hideTimer !== undefined) clearTimeout(hideTimer)
  // Controls fade out during playback so they do not sit over the picture.
  hideTimer = setTimeout(() => {
    hideTimer = undefined
    if (playing.value && !scrubbing.value) controlsShown.value = false
  }, 2600)
}

// Teach the seek zones the first time playback starts on a touch device.
function showZoneHintOnce() {
  if (seekHintShown.value || hintTimer !== undefined) return
  seekHintShown.value = true
  hintTimer = setTimeout(() => {
    hintTimer = undefined
    seekHintShown.value = false
  }, 3000)
}

function togglePlay() {
  const element = player.value
  if (!element) return
  if (element.paused) void element.play().catch(() => { /* the browser refused; the poster stays */ })
  else element.pause()
  revealControls()
}

function seekTo(seconds: number) {
  const element = player.value
  if (!element || !Number.isFinite(seconds)) return
  const end = Number.isFinite(element.duration) ? element.duration : 0
  const target = Math.min(Math.max(seconds, 0), Math.max(end - 0.05, 0))
  element.currentTime = target
  progress.value = target
}

// A tap on the scrubber jumps there; a drag follows the finger.
function scrubFromEvent(event: PointerEvent) {
  const track = event.currentTarget as HTMLElement
  const rect = track.getBoundingClientRect()
  if (!rect.width || !duration.value) return 0
  const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1)
  return ratio * duration.value
}

function onScrubStart(event: PointerEvent) {
  if (!duration.value) return
  scrubbing.value = true
  revealControls()
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  progress.value = scrubFromEvent(event)
}

function onScrubMove(event: PointerEvent) {
  if (!scrubbing.value) return
  progress.value = scrubFromEvent(event)
}

function onScrubEnd(event: PointerEvent) {
  if (!scrubbing.value) return
  const target = scrubFromEvent(event)
  scrubbing.value = false
  seekTo(target)
  revealControls()
  ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
}

// Touch seeking works without the native bar. A sideways swipe scrubs, but it only
// previews while the finger moves and applies the seek once it lifts: writing
// `currentTime` on every move makes the decoder thrash and the picture stutter.
const TAP_ZONE = 0.3
// A double tap on either side, and the arrow keys, step by the same amount.
const SWIPE_STEP = 5
const SWIPE_SPAN = 20
const DOUBLE_TAP_MS = 280
// The zone hint appears once per visit so the gesture is discoverable.
const seekHintShown = ref(false)
let hintTimer: ReturnType<typeof setTimeout> | undefined

// The title card names what is playing when the picture first appears, then fades,
// so a viewer catching the middle of a series always knows which episode this is.
const titleCardShown = ref(false)
let titleCardTimer: ReturnType<typeof setTimeout> | undefined

const titleCardText = computed(() => {
  const title = detail.value?.title ?? ''
  if (detail.value?.kind !== 'series' || !activeEpisode.value) return title
  return `${title} 第 ${activeEpisode.value.season} 季第 ${activeEpisode.value.episode} 集`
})

function showTitleCard() {
  if (!titleCardText.value) return
  if (titleCardTimer !== undefined) clearTimeout(titleCardTimer)
  titleCardShown.value = true
  titleCardTimer = setTimeout(() => {
    titleCardTimer = undefined
    titleCardShown.value = false
  }, 4000)
}

const swipe = { active: false, startX: 0, startY: 0, base: 0, moved: false, pointerId: -1 }
// While a swipe is in progress the overlay shows where the finger would land, so the
// pending position is tracked separately from the element's real currentTime.
const swipeOffset = ref(0)
const swipePreviewing = ref(false)
const swipePreview = computed(() => {
  const end = duration.value
  return Math.min(Math.max(swipe.base + swipeOffset.value, 0), Math.max(end - 0.05, 0))
})

// Double-tap bookkeeping: a single tap must not seek, so the second tap is what
// commits the gesture.
let lastTapAt = 0
let lastTapZone: 'left' | 'right' | 'middle' | null = null

function stageRect(): DOMRect | null {
  return stage.value?.getBoundingClientRect() ?? null
}

function zoneOf(clientX: number): 'left' | 'right' | 'middle' | null {
  const rect = stageRect()
  if (!rect?.width) return null
  const ratio = (clientX - rect.left) / rect.width
  if (ratio <= TAP_ZONE) return 'left'
  if (ratio >= 1 - TAP_ZONE) return 'right'
  return 'middle'
}

function onStagePointerDown(event: PointerEvent) {
  // Only a finger on the picture itself; our transport bar handles its own taps.
  if (!touchUi.value || !playerReady()) return
  if ((event.target as HTMLElement).closest('.watch-transport, .watch-overlay, button, a')) return
  swipe.active = true
  swipe.pointerId = event.pointerId
  swipe.startX = event.clientX
  swipe.startY = event.clientY
  swipe.base = player.value?.currentTime ?? 0
  swipe.moved = false
  swipeOffset.value = 0
}

function onStagePointerMove(event: PointerEvent) {
  if (!swipe.active || event.pointerId !== swipe.pointerId) return
  const dx = event.clientX - swipe.startX
  const dy = event.clientY - swipe.startY
  // A mostly-vertical drag is page scrolling, not scrubbing; give it back.
  if (!swipe.moved) {
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) {
      swipe.active = false
      return
    }
    if (Math.abs(dx) < 12) return
    swipe.moved = true
    swipePreviewing.value = true
    revealControls()
    // Capture only once this is clearly a horizontal scrub.
    ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  }
  // A full swipe across the picture covers a fixed span, which keeps the gesture
  // predictable regardless of the film's length. Nothing is committed yet: the
  // overlay shows the landing point and the video keeps playing smoothly.
  const rect = stageRect()
  if (!rect?.width) return
  swipeOffset.value = ((event.clientX - swipe.startX) / rect.width) * SWIPE_SPAN
}

function onStagePointerUp(event: PointerEvent) {
  if (!swipe.active || event.pointerId !== swipe.pointerId) return
  swipe.active = false
  ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
  const element = player.value
  if (!element) return
  if (swipe.moved) {
    // The finger has lifted, so this is where the seek finally lands.
    seekTo(element.currentTime + swipeOffset.value)
    swipePreviewing.value = false
    swipeOffset.value = 0
    revealControls()
    return
  }
  // A tap: the picture no longer toggles playback, so the only thing a single tap
  // does is bring the controls back. Seeking needs a double tap on a side zone.
  const zone = zoneOf(event.clientX)
  const now = Date.now()
  const repeated = zone !== null && zone === lastTapZone && now - lastTapAt < DOUBLE_TAP_MS
  lastTapAt = now
  lastTapZone = zone
  if (!repeated) {
    revealControls()
    return
  }
  // Consume the pair so a third tap starts a fresh count.
  lastTapAt = 0
  lastTapZone = null
  if (zone === 'left') seekBy(-SWIPE_STEP)
  else if (zone === 'right') seekBy(SWIPE_STEP)
  revealControls()
}

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
  cancelEndedCountdown()
})
watch(player, (element) => {
  // Metadata preloading can fail before the SSR video is hydrated.
  if (element?.error) reportPlaybackError()
}, { flush: 'post' })

onMounted(() => {
  window.addEventListener('keydown', handlePlayerKey, true)
  document.addEventListener('fullscreenchange', syncFullscreen)
  // Leaving mid-film should keep the position; `pagehide` fires on tab close too.
  window.addEventListener('pagehide', flushProgress)
  // A coarse pointer means a finger, where the native bar's knob and double-tap
  // ripple would cover the picture; those devices get the custom transport.
  touchUi.value = window.matchMedia?.('(pointer: coarse)').matches ?? false
  playbackRate.value = readStoredRate()
  applyPlaybackRate()
  // `preload="metadata"` can finish before this component's listeners are attached,
  // so ask for the title card directly as well as on the media events.
  void nextTick(() => {
    if (playerReady()) showTitleCard()
  })
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handlePlayerKey, true)
  document.removeEventListener('fullscreenchange', syncFullscreen)
  window.removeEventListener('pagehide', flushProgress)
  flushProgress()
  if (noticeTimer !== undefined) clearTimeout(noticeTimer)
  if (reportTimer !== undefined) clearTimeout(reportTimer)
  if (hideTimer !== undefined) clearTimeout(hideTimer)
  if (hintTimer !== undefined) clearTimeout(hintTimer)
  if (titleCardTimer !== undefined) clearTimeout(titleCardTimer)
  stopEndedCountdown()
})

function flushProgress() {
  if (!signedIn.value) return
  reportProgress(true)
}

// A new episode or film resets the resume bookkeeping for the next video.
watch(videoKey, () => {
  resumeApplied.value = false
  lastReported = 0
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
        <p v-if="activeEpisode" class="watch-episode" data-test="watch-episode">
          <span>第 {{ activeEpisode.season }} 季 · 第 {{ activeEpisode.episode }} 集</span>
        </p>
      </header>

      <section v-if="sourceUrl" class="watch-player" aria-label="视频播放">
        <div
          ref="stage"
          class="watch-stage"
          :class="{ 'is-fullscreen': isFullscreen, 'is-fill': fillScreen, 'is-tab-focus': tabFocus, 'is-touch': touchUi }"
          @pointerdown="onStagePointerDown"
          @pointermove="onStagePointerMove"
          @pointerup="onStagePointerUp"
          @pointercancel="onStagePointerUp"
        >
          <video
            :key="videoKey"
            ref="player"
            :src="sourceUrl"
            :aria-label="activeEpisode ? `播放${detail.title}第 ${activeEpisode.season} 季第 ${activeEpisode.episode} 集` : `播放${detail.title}`"
            tabindex="0"
            :controls="!touchUi"
            playsinline
            preload="metadata"
            @error="reportPlaybackError"
            @loadedmetadata="playbackError = ''; applyResumePoint(); applyPlaybackRate(); syncTransport(); showTitleCard()"
            @canplay="showTitleCard()"
            @timeupdate="scheduleReport(); syncTransport()"
            @durationchange="syncTransport()"
            @play="syncTransport(); revealControls(); showZoneHintOnce()"
            @pause="reportProgress(true); syncTransport(); revealControls()"
            @ended="onEnded"
            @dblclick="touchUi ? undefined : toggleFullscreen()"
          >
            当前浏览器不支持网页视频。<a :href="downloadUrl" download>下载原文件</a>后可用本地播放器观看。
          </video>

          <!-- Touch transport: play/pause and a scrubber we draw ourselves, so the
               native knob and its double-tap ripple never appear over the picture. -->
          <div
            v-if="touchUi && sourceUrl"
            class="watch-transport"
            :class="{ 'is-hidden': !controlsShown }"
            @click.self="controlsShown = playing ? false : true"
          >            <button
              class="watch-transport-button"
              type="button"
              :aria-label="playing ? '暂停' : '播放'"
              data-test="touch-play"
              @click="togglePlay"
            >
              <PublicIcon :name="playing ? 'pause' : 'play'" />
            </button>
            <!-- The next episode sits with the transport on the left, not pushed to
                 the far right of the bar. -->
            <button
              v-if="nextEpisode"
              class="watch-transport-button watch-transport-next"
              type="button"
              :aria-label="`下一集：第 ${nextEpisode.season} 季第 ${nextEpisode.episode} 集`"
              data-test="touch-next"
              @click="watchEpisode(nextEpisode)"
            >
              <PublicIcon name="next" />
            </button>
            <span class="watch-transport-clock" data-test="touch-clock">{{ clockTime(progress) }}</span>
            <div
              class="watch-transport-track"
              role="slider"
              tabindex="0"
              aria-label="播放进度"
              :aria-valuemin="0"
              :aria-valuemax="Math.round(duration)"
              :aria-valuenow="Math.round(progress)"
              :aria-valuetext="`${clockTime(progress)} / ${clockTime(duration)}`"
              data-test="touch-track"
              @pointerdown.prevent="onScrubStart"
              @pointermove.prevent="onScrubMove"
              @pointerup.prevent="onScrubEnd"
              @pointercancel="onScrubEnd"
              @keydown.left.prevent="seekBy(-seekStep)"
              @keydown.right.prevent="seekBy(seekStep)"
            >
              <span class="watch-transport-fill" :style="{ inlineSize: `${duration ? (progress / duration) * 100 : 0}%` }" />
            </div>
            <span class="watch-transport-clock">{{ clockTime(duration) }}</span>
          </div>

          <!-- While a swipe is being read, the pending position shows in the bottom-left
               corner so the viewer can see where the seek will land. -->
          <div v-if="swipePreviewing" class="watch-scrub-preview" aria-hidden="true" data-test="scrub-preview">
            <span class="watch-scrub-preview-time">{{ clockTime(swipePreview) }}</span>
            <span class="watch-scrub-preview-total">/ {{ clockTime(duration) }}</span>
            <span class="watch-scrub-preview-delta">{{ swipeOffset >= 0 ? '+' : '−' }}{{ Math.abs(Math.round(swipeOffset)) }} 秒</span>
          </div>

          <!-- A paused picture says so in the middle, on every device. -->
          <div v-if="sourceUrl && !playing && !swipePreviewing" class="watch-paused-mark" aria-hidden="true" data-test="paused-mark">
            <PublicIcon name="pause" />
          </div>

          <!-- What is playing, named in the top-left corner when the picture loads and
               then faded out, so it never lingers over the film. -->
          <transition name="watch-title-fade">
            <p v-if="titleCardShown && titleCardText" class="watch-title-card" data-test="title-card">
              <span class="watch-title-card-kind">{{ detail.kind === 'series' ? '剧集' : '电影' }}</span>
              <span class="watch-title-card-text">{{ titleCardText }}</span>
            </p>
          </transition>

          <!-- Touch hint: a double tap on either side of the picture seeks, a swipe
               scrubs. Shown briefly when playback starts so it is discoverable. -->
          <div v-if="touchUi && sourceUrl && seekHintShown" class="watch-zone-hint" aria-hidden="true">
            <span class="watch-zone-hint-side">
              <PublicIcon name="back" />
              <span>双击后退 {{ SWIPE_STEP }} 秒</span>
            </span>
            <span class="watch-zone-hint-side">
              <span>双击前进 {{ SWIPE_STEP }} 秒</span>
              <PublicIcon name="back" class="watch-zone-hint-flip" />
            </span>
          </div>

          <p v-if="seekNotice" class="watch-seek" aria-hidden="true">{{ seekNotice }}</p>
          <p v-else-if="resumeNotice" class="watch-seek" role="status" data-test="resume-notice">{{ resumeNotice }}</p>

          <!-- A finished episode offers the next one instead of silently stopping. -->
          <div v-if="endedCountdown > 0 && nextEpisode" class="watch-next-card" role="status" data-test="next-up">
            <p class="watch-next-title">
              即将播放 第 {{ nextEpisode.season }} 季第 {{ nextEpisode.episode }} 集
              <span class="watch-next-seconds">{{ endedCountdown }} 秒</span>
            </p>
            <div class="watch-next-actions">
              <button class="btn watch-next-play" type="button" data-test="next-up-play" @click="watchEpisode(nextEpisode)">
                立即播放
              </button>
              <button class="btn watch-next-cancel" type="button" data-test="next-up-cancel" @click="cancelEndedCountdown">
                取消
              </button>
            </div>
          </div>
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
            <!-- Episode stepping belongs with the other controls rather than floating
                 over the picture. Icon only: the tooltip names the episode. -->
            <button
              v-if="previousEpisode"
              type="button"
              class="btn watch-action watch-step"
              :title="`上一集：第 ${previousEpisode.season} 季第 ${previousEpisode.episode} 集`"
              :aria-label="`上一集：第 ${previousEpisode.season} 季第 ${previousEpisode.episode} 集`"
              data-test="episode-prev"
              @click="watchEpisode(previousEpisode)"
            >
              <PublicIcon name="next" class="watch-step-back" />
            </button>
            <button
              v-if="nextEpisode"
              type="button"
              class="btn watch-action watch-step"
              :title="`下一集：第 ${nextEpisode.season} 季第 ${nextEpisode.episode} 集`"
              :aria-label="`下一集：第 ${nextEpisode.season} 季第 ${nextEpisode.episode} 集`"
              data-test="episode-next"
              @click="watchEpisode(nextEpisode)"
            >
              <PublicIcon name="next" />
            </button>
            <label class="watch-speed">
              <span class="visually-hidden">播放速度</span>
              <select
                class="field"
                :value="String(playbackRate)"
                data-test="watch-speed"
                @change="setPlaybackRate(($event.target as HTMLSelectElement).value)"
              >
                <option v-for="rate in playbackRates" :key="rate" :value="String(rate)">{{ rate }}×</option>
              </select>
            </label>
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
          <span v-if="detail.year">{{ detail.year }}</span>
          <span v-if="detail.runtime">{{ detail.runtime }} 分钟</span>
          <span v-if="detail.cast.length">{{ detail.cast.join(' / ') }}</span>
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
/* Our own gestures replace the native bar on touch; horizontal drags must not be
   claimed by the page scroller. */
.watch-stage.is-touch { touch-action: pan-y; }
.watch-stage.is-fullscreen video,
.watch-stage:fullscreen video { inline-size: 100%; block-size: 100%; max-block-size: none; }
.watch-stage.is-fullscreen.is-fill video { object-fit: cover; }
.watch-stage video:focus-visible { outline: none; }
.watch-stage.is-tab-focus video:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px; }

/* Touch transport: our own bar along the bottom of the picture, replacing the
   native one so no scrubber knob or double-tap ripple is drawn over the video. */
.watch-transport {
  position: absolute;
  z-index: 4;
  inset-inline: 0;
  inset-block-end: 0;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0.7rem calc(0.5rem + env(safe-area-inset-bottom, 0px));
  background: linear-gradient(to top, rgb(0 0 0 / 0.82), rgb(0 0 0 / 0));
  transition: opacity var(--dur-fast) var(--ease);
}
.watch-transport.is-hidden { opacity: 0; pointer-events: none; }
.watch-transport-button {
  display: grid;
  place-items: center;
  flex: none;
  inline-size: 2.4rem;
  block-size: 2.4rem;
  border: 0;
  border-radius: 50%;
  background: rgb(255 255 255 / 0.14);
  color: #fff;
}
.watch-transport-button :deep(svg) { inline-size: 1.1rem; block-size: 1.1rem; }
.watch-transport-clock {
  flex: none;
  color: rgb(255 255 255 / 0.82);
  font-size: 0.74rem;
  font-variant-numeric: tabular-nums;
}
.watch-transport-next { margin-inline-start: 0.1rem; }
/* The track is tall enough to grab with a finger; the visible line stays thin. */
.watch-transport-track {
  position: relative;
  flex: 1 1 auto;
  min-inline-size: 0;
  block-size: 1.9rem;
  cursor: pointer;
  touch-action: none;
}
.watch-transport-track::before {
  content: '';
  position: absolute;
  inset-inline: 0;
  inset-block-start: 50%;
  block-size: 3px;
  border-radius: 2px;
  background: rgb(255 255 255 / 0.26);
  transform: translateY(-50%);
}
.watch-transport-fill {
  position: absolute;
  inset-inline-start: 0;
  inset-block-start: 50%;
  block-size: 3px;
  border-radius: 2px;
  background: var(--accent);
  transform: translateY(-50%);
}
.watch-transport-track:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 3px; border-radius: var(--radius-xs); }


/* The end-of-episode card: an offer to keep watching, with a real countdown. */
.watch-next-card {
  position: absolute;
  z-index: 7;
  inset-block-end: 3.6rem;
  inset-inline-end: 0.9rem;
  display: grid;
  gap: 0.55rem;
  max-inline-size: min(20rem, calc(100% - 1.8rem));
  padding: 0.75rem 0.9rem;
  border-radius: var(--radius-sm);
  background: rgb(0 0 0 / 0.85);
  color: #fff;
  backdrop-filter: blur(8px);
}
.watch-next-title { margin: 0; font-size: 0.86rem; line-height: 1.45; }
.watch-next-seconds { color: var(--accent); font-variant-numeric: tabular-nums; }
.watch-next-actions { display: flex; flex-wrap: wrap; gap: 0.45rem; }
.watch-next-play { min-block-size: 34px; padding-inline: 0.8rem; background: var(--accent); color: var(--on-accent); font-size: 0.8rem; }
.watch-next-cancel { min-block-size: 34px; padding-inline: 0.7rem; border-color: rgb(255 255 255 / 0.3); background: transparent; color: #fff; font-size: 0.8rem; }

/* The pending seek position during a swipe, in the bottom-left corner above the
   transport bar, clear of the buttons that live on the same edge. */
.watch-scrub-preview {
  position: absolute;
  z-index: 6;
  inset-block-end: 4.9rem;
  inset-inline-start: 0.9rem;
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  padding: 0.4rem 0.75rem;
  border-radius: var(--radius-pill);
  background: rgb(0 0 0 / 0.82);
  color: #fff;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
.watch-scrub-preview-time { font-size: 1rem; font-weight: 600; }
.watch-scrub-preview-total { color: rgb(255 255 255 / 0.55); font-size: 0.76rem; }
.watch-scrub-preview-delta { margin-inline-start: 0.2rem; color: var(--accent); font-size: 0.76rem; }

/* A paused picture is marked in the middle so the state is unmistakable. */
.watch-paused-mark {
  position: absolute;
  z-index: 5;
  inset-block-start: 50%;
  inset-inline-start: 50%;
  display: grid;
  place-items: center;
  inline-size: 4rem;
  block-size: 4rem;
  border-radius: 50%;
  background: rgb(0 0 0 / 0.55);
  color: #fff;
  transform: translate(-50%, -50%);
  pointer-events: none;
  animation: watch-paused-in 160ms var(--ease);
}
@keyframes watch-paused-in {
  from { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
  to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}
.watch-paused-mark :deep(svg) { inline-size: 1.6rem; block-size: 1.6rem; }

/* Episode stepping sits in the action bar with the other controls; the icon carries
   the meaning and the title tooltip names the exact episode. */
.watch-step { min-block-size: 42px; inline-size: 42px; padding-inline: 0; }
.watch-step :deep(svg) { inline-size: 1.05rem; block-size: 1.05rem; }
.watch-step-back { transform: rotate(180deg); }

/* The title card sits in the top-left corner of the picture for a few seconds after
   the video loads, then fades so nothing remains over the film. */
.watch-title-card {
  position: absolute;
  z-index: 6;
  inset-block-start: 0.9rem;
  inset-inline-start: 0.9rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  max-inline-size: calc(100% - 1.8rem);
  margin: 0;
  padding: 0.4rem 0.75rem;
  border-radius: var(--radius-pill);
  background: rgb(0 0 0 / 0.7);
  color: #fff;
  font-size: 0.86rem;
  line-height: 1.4;
  backdrop-filter: blur(8px);
  pointer-events: none;
}
.watch-title-card-kind {
  flex: none;
  padding: 0.02rem 0.36rem;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--on-accent);
  font-size: 0.7rem;
  font-weight: 600;
}
.watch-title-card-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.watch-title-fade-enter-active,
.watch-title-fade-leave-active { transition: opacity 400ms var(--ease); }
.watch-title-fade-enter-from,
.watch-title-fade-leave-to { opacity: 0; }

/* The left/right thirds are seek zones on touch; this hint names them once, briefly,
   just above the transport bar so it does not cover the picture itself. */
.watch-zone-hint {
  position: absolute;
  z-index: 3;
  inset-inline: 0;
  inset-block-end: 3.9rem;
  display: flex;
  justify-content: space-between;
  padding-inline: 0.7rem;
  pointer-events: none;
  animation: watch-zone-fade 3s var(--ease) forwards;
}
@keyframes watch-zone-fade {
  0%, 70% { opacity: 1; }
  100% { opacity: 0; }
}
.watch-zone-hint-side {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.4rem 0.7rem;
  border-radius: var(--radius-pill);
  background: rgb(0 0 0 / 0.55);
  color: rgb(255 255 255 / 0.9);
  font-size: 0.76rem;
  white-space: nowrap;
  backdrop-filter: blur(4px);
}
.watch-zone-hint-side :deep(svg) { inline-size: 0.9rem; block-size: 0.9rem; }
.watch-zone-hint-flip { transform: rotate(180deg); }

/* Feedback sits in the bottom-right corner rather than mid-picture, so a seek or
   resume message never covers the part of the frame being watched. The native
   control bar occupies the very bottom on desktop, so the message clears it. */
.watch-seek {
  position: absolute;
  z-index: 6;
  inset-block-end: 3.4rem;
  inset-inline-end: 0.9rem;
  margin: 0;
  padding: 0.45rem 0.8rem;
  border-radius: var(--radius-pill);
  background: rgb(0 0 0 / 0.72);
  color: #fff;
  font-size: 0.84rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
  backdrop-filter: blur(6px);
}
/* On touch the transport bar is taller, so the message lifts above it. */
.watch-stage.is-touch .watch-seek { inset-block-end: calc(3.6rem + env(safe-area-inset-bottom, 0px)); }
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
.watch-speed .field { min-block-size: 42px; padding-block: 0; font-size: 0.84rem; font-variant-numeric: tabular-nums; }
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
