<script setup lang="ts">
import type { LibraryCard, TitleDetail } from '#shared/types/library'
import EpisodeList from '~/components/public/EpisodeList.vue'
import MovieCard from '~/components/public/MovieCard.vue'
import PublicIcon from '~/components/public/Icon.vue'
import LibraryState from '~/components/public/LibraryState.vue'
import { recordPlaybackProgress, useContinueWatching } from '~/composables/useProgress'
import { useUserSession } from '~/composables/useUser'

const route = useRoute()
const router = useRouter()
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

// One-shot intent: opening a watch URL or picking an episode from the list
// does not start playback. Only continuation requested here does.
let episodeAutoplay: { episodeId: string } | null = null

async function watchEpisode(episode: { id: string }, autoplay = false) {
  cancelEndedCountdown()
  const intent = autoplay ? { episodeId: episode.id } : null
  episodeAutoplay = intent
  try {
    const failure = await router.push({
      path: `/watch/${encodeURIComponent(titleId.value)}`,
      query: { episode: episode.id },
    })
    if (failure && episodeAutoplay === intent) episodeAutoplay = null
  } catch (error) {
    if (episodeAutoplay === intent) episodeAutoplay = null
    throw error
  }
}

// Reaching the end should move on rather than replay a finished episode, but only
// when there really is a next one — the film and the last episode just stop.
const nextEpisodeDelaySeconds = 2
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
  endedCountdown.value = nextEpisodeDelaySeconds
  stopEndedCountdown()
  endedTimer = setInterval(() => {
    endedCountdown.value -= 1
    if (endedCountdown.value > 0) return
    const episodeId = endedNextId.value
    if (episodeId) void watchEpisode({ id: episodeId }, true)
    else cancelEndedCountdown()
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
const expandedFallback = ref(false)
const fillScreen = ref(false)
const settingsOpen = ref(false)
const settingsButton = ref<HTMLButtonElement | null>(null)
const pipSupported = ref(false)
const pipActive = ref(false)
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
let resumeTimer: ReturnType<typeof setTimeout> | undefined
let lastReported = 0
let reportTimer: ReturnType<typeof setTimeout> | undefined

// Playback speed is a viewer preference, so it is remembered across films.
const playbackRates = [0.75, 1, 1.25, 1.5, 2] as const
const rateStorageKey = 'night-library:playback-rate'
const playbackRate = ref(1)

function readStoredRate(): number {
  try {
    const stored = Number(localStorage.getItem(rateStorageKey))
    return (playbackRates as readonly number[]).includes(stored) ? stored : 1
  } catch { return 1 }
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

function applyResumePoint() {
  const element = player.value
  if (resumeApplied.value || !element || resumePosition.value <= 0) return
  if (!Number.isFinite(element.duration) || element.duration <= 0) return
  if (resumePosition.value >= element.duration - 1) return
  element.currentTime = resumePosition.value
  resumeApplied.value = true
  resumeNotice.value = `已从上次 ${clockTime(resumePosition.value)} 继续播放`
  if (resumeTimer !== undefined) clearTimeout(resumeTimer)
  resumeTimer = setTimeout(() => { resumeNotice.value = '' }, 4000)
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
type NoticeIcon = 'fast-forward' | 'fast-backward' | 'camera' | 'pip' | 'warning'
const playerNotice = ref<{ text: string; icon: NoticeIcon } | null>(null)
let noticeTimer: ReturnType<typeof setTimeout> | undefined

const touchUi = ref(false)
const playing = ref(false)
const progress = ref(0)
const duration = ref(0)
const bufferedTo = ref(0)
const scrubbing = ref(false)
const volume = ref(1)
const muted = ref(false)
const silent = computed(() => muted.value || volume.value === 0)
const canCapture = ref(false)
const controlsShown = ref(true)
let hideTimer: ReturnType<typeof setTimeout> | undefined
let videoClickTimer: ReturnType<typeof setTimeout> | undefined

function syncTransport() {
  const element = player.value
  if (!element) return
  duration.value = Number.isFinite(element.duration) ? element.duration : 0
  // While dragging, the bar shows the finger position rather than the video's.
  if (!scrubbing.value) progress.value = element.currentTime
  playing.value = !element.paused && !element.ended
  canCapture.value = element.readyState >= 2 && element.videoWidth > 0
  bufferedTo.value = 0
  const { buffered, currentTime } = element
  for (let i = 0; i < buffered.length; i++) {
    if (buffered.start(i) <= currentTime && currentTime <= buffered.end(i)) {
      bufferedTo.value = buffered.end(i)
      break
    }
  }
}

function syncVolume() {
  if (!player.value) return
  volume.value = player.value.volume
  muted.value = player.value.muted
}

function toggleMute() {
  const element = player.value
  if (!element) return
  if (volume.value === 0) {
    element.volume = 1
    element.muted = false
  } else {
    element.muted = !element.muted
  }
  revealControls()
}

function setVolume(event: Event) {
  const element = player.value
  if (!element) return
  element.volume = (event.target as HTMLInputElement).valueAsNumber
  element.muted = false
  revealControls()
}

function trackPercent(seconds: number) {
  return `${duration.value ? Math.min(100, (seconds / duration.value) * 100) : 0}%`
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
  if (!touchUi.value || seekHintSeen) return
  seekHintSeen = true
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
  if (!element || !duration.value || !Number.isFinite(seconds)) return
  const target = Math.min(Math.max(seconds, 0), Math.max(duration.value - 0.05, 0))
  element.currentTime = target
  progress.value = target
}

// Let the range input handle pointer, keyboard and assistive input. Preview a
// drag with `input`, then seek on `change` rather than re-decoding every frame.
function previewScrub(event: Event) {
  scrubbing.value = true
  progress.value = (event.target as HTMLInputElement).valueAsNumber
  revealControls()
}

function commitScrub(event: Event) {
  scrubbing.value = false
  seekTo((event.target as HTMLInputElement).valueAsNumber)
  revealControls()
}

function cancelScrub() {
  scrubbing.value = false
  syncTransport()
  revealControls()
}

// A sideways swipe only previews until release, just like the progress bar.
const TAP_ZONE = 0.3
const SWIPE_SPAN = 20
const DOUBLE_TAP_MS = 280
// The zone hint appears once per visit so the gesture is discoverable.
const seekHintShown = ref(false)
let seekHintSeen = false
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

// Defer showing the controls on a side tap until we know it isn't a seek gesture.
let pendingSideTap: { zone: 'left' | 'right'; timer: ReturnType<typeof setTimeout> } | null = null

function cancelPendingSideTap() {
  if (!pendingSideTap) return
  clearTimeout(pendingSideTap.timer)
  pendingSideTap = null
}

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
  tabFocus.value = false
  if (!(event.target instanceof Element)) return
  if (!event.target.closest('.watch-transport')) settingsOpen.value = false
  const touchPicture = (touchUi.value || event.pointerType === 'touch' || event.pointerType === 'pen')
    && event.target === player.value
  if (!event.isPrimary) return
  if (!touchPicture || !playerReady()) {
    cancelPendingSideTap()
    revealControls()
    return
  }
  swipe.active = true
  swipe.pointerId = event.pointerId
  swipe.startX = event.clientX
  swipe.startY = event.clientY
  swipe.base = player.value?.currentTime ?? 0
  swipe.moved = false
  swipeOffset.value = 0
}

function onStagePointerMove(event: PointerEvent) {
  if (!swipe.active || event.pointerId !== swipe.pointerId) {
    if (!touchUi.value && event.pointerType === 'mouse') revealControls()
    return
  }
  const dx = event.clientX - swipe.startX
  const dy = event.clientY - swipe.startY
  // A mostly-vertical drag is page scrolling, not scrubbing; give it back.
  if (!swipe.moved) {
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) {
      swipe.active = false
      cancelPendingSideTap()
      return
    }
    if (Math.abs(dx) < 12) return
    cancelPendingSideTap()
    swipe.moved = true
    swipePreviewing.value = true
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
  const target = event.currentTarget as HTMLElement
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
  const element = player.value
  if (!element) return
  if (swipe.moved) {
    // The finger has lifted, so this is where the seek finally lands.
    seekTo(element.currentTime + swipeOffset.value)
    swipePreviewing.value = false
    swipeOffset.value = 0
    return
  }
  const zone = zoneOf(event.clientX)
  const repeated = pendingSideTap?.zone === zone
  cancelPendingSideTap()
  if (zone !== 'left' && zone !== 'right') {
    revealControls()
  } else if (repeated) {
    seekBy(zone === 'left' ? -seekStep : seekStep)
  } else {
    pendingSideTap = {
      zone,
      timer: setTimeout(() => {
        pendingSideTap = null
        revealControls()
      }, DOUBLE_TAP_MS),
    }
  }
}

function onStagePointerCancel(event: PointerEvent) {
  if (event.pointerId !== swipe.pointerId) return
  cancelPendingSideTap()
  swipe.active = false
  swipePreviewing.value = false
  swipeOffset.value = 0
}

function onVideoClick(event: MouseEvent) {
  if (touchUi.value || ('pointerType' in event && event.pointerType !== 'mouse')) return
  // Give a double-click a chance to fullscreen without also pausing playback.
  if (event.detail !== 1 || videoClickTimer !== undefined) return
  videoClickTimer = setTimeout(() => {
    videoClickTimer = undefined
    togglePlay()
  }, DOUBLE_TAP_MS)
}

function onVideoDoubleClick() {
  if (touchUi.value) return
  if (videoClickTimer !== undefined) clearTimeout(videoClickTimer)
  videoClickTimer = undefined
  void toggleFullscreen()
}

function clockTime(seconds: number) {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`
}

function showPlayerNotice(text: string, icon: NoticeIcon) {
  playerNotice.value = { text, icon }
  if (noticeTimer !== undefined) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => { playerNotice.value = null }, 1600)
}

function seekBy(delta: number): boolean {
  const element = player.value
  if (!element || !duration.value) return false
  const target = Math.min(Math.max(element.currentTime + delta, 0), Math.max(duration.value - 0.05, 0))
  if (Math.abs(target - element.currentTime) < 0.01) return false
  seekTo(target)
  showPlayerNotice(`${delta > 0 ? '快进' : '快退'} ${Math.round(Math.abs(delta))} 秒 · ${clockTime(target)}`, delta > 0 ? 'fast-forward' : 'fast-backward')
  return true
}

function captureFrame() {
  const element = player.value
  if (!element || !canCapture.value) return
  const canvas = document.createElement('canvas')
  canvas.width = element.videoWidth
  canvas.height = element.videoHeight
  const context = canvas.getContext('2d')
  if (!context) return showPlayerNotice('无法截取当前画面', 'warning')
  const time = clockTime(element.currentTime).replaceAll(':', '-')
  const key = videoKey.value
  try {
    context.drawImage(element, 0, 0)
    canvas.toBlob((blob) => {
      if (element !== player.value || key !== videoKey.value) return
      if (!blob) return showPlayerNotice('无法截取当前画面', 'warning')
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `视频截图-${time}.png`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
      showPlayerNotice('已截取当前画面', 'camera')
    }, 'image/png')
  } catch { showPlayerNotice('无法截取当前画面', 'warning') }
}

async function togglePictureInPicture() {
  const element = player.value
  if (!element || !pipSupported.value) return
  try {
    if (document.pictureInPictureElement === element) await document.exitPictureInPicture()
    else await element.requestPictureInPicture()
  } catch { showPlayerNotice('当前无法使用画中画', 'pip') }
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

// Fullscreen the whole stage so its controls and feedback stay in the top layer.
// Browsers that disallow element fullscreen get an expanded in-page player;
// fullscreening just the video would lose the overlays on those devices.
async function toggleFullscreen() {
  const element = stage.value
  if (!element) return
  settingsOpen.value = false
  if (expandedFallback.value) {
    expandedFallback.value = false
  } else if (document.fullscreenElement === element) {
    try { await document.exitFullscreen() } catch { /* stay in fullscreen */ }
  } else {
    try { await element.requestFullscreen() } catch {
      if (element === stage.value) expandedFallback.value = true
    }
  }
  syncFullscreen()
  player.value?.focus({ preventScroll: true })
}

function syncFullscreen() {
  isFullscreen.value = Boolean(stage.value) && (
    document.fullscreenElement === stage.value || expandedFallback.value
  )
  revealControls()
}

function handlePlayerKey(event: KeyboardEvent) {
  // Leave browser and operating-system shortcuts untouched.
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
  if (event.key === 'Tab') {
    tabFocus.value = true
    return
  }
  if (event.key === 'Escape' && settingsOpen.value) {
    settingsOpen.value = false
    settingsButton.value?.focus()
    event.preventDefault()
    return
  }
  if (event.key === 'Escape' && expandedFallback.value) {
    void toggleFullscreen()
    event.preventDefault()
    return
  }
  if (event.shiftKey || typingTarget(event.target) || !playerReady()) return
  const target = event.target instanceof Element ? event.target : null
  if (!target?.closest('.watch-transport')) tabFocus.value = false
  if (event.key.toLowerCase() === 'f') {
    if (!event.repeat) void toggleFullscreen()
    event.preventDefault()
    return
  }
  if (event.code === 'Space' && !target?.closest('button, a, [role="button"]')) {
    if (!event.repeat) togglePlay()
    event.preventDefault()
    return
  }
  const delta = event.key === 'ArrowRight' ? seekStep : event.key === 'ArrowLeft' ? -seekStep : 0
  if (delta && seekBy(delta)) event.preventDefault()
}
watch(videoKey, () => {
  playbackError.value = ''
  playerNotice.value = null
  resumeNotice.value = ''
  resumeApplied.value = false
  lastReported = 0
  if (reportTimer !== undefined) clearTimeout(reportTimer)
  reportTimer = undefined
  if (videoClickTimer !== undefined) clearTimeout(videoClickTimer)
  videoClickTimer = undefined
  playing.value = false
  duration.value = progress.value = bufferedTo.value = 0
  canCapture.value = scrubbing.value = false
  swipe.active = swipePreviewing.value = false
  cancelPendingSideTap()
  settingsOpen.value = false
  cancelEndedCountdown()
  revealControls()
})

watch(videoKey, (key) => {
  const intent = episodeAutoplay
  episodeAutoplay = null
  const element = player.value
  if (!intent || intent.episodeId !== activeEpisode.value?.id || !element) return
  // The new src is now on the existing video element, which retains permission
  // from the viewer starting playback. Let play() wait for the media to load.
  void element.play().catch((error: unknown) => {
    if (element !== player.value || key !== videoKey.value) return
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      showPlayerNotice('浏览器限制了自动播放，请点击播放继续', 'warning')
    }
  })
}, { flush: 'post' })

function initTransport(element: HTMLVideoElement) {
  element.volume = volume.value
  element.muted = muted.value
  pipActive.value = document.pictureInPictureElement === element
  applyPlaybackRate()
  syncTransport()
  // Preload can complete or fail before the SSR video is hydrated.
  if (element.error) reportPlaybackError()
  else if (playerReady()) {
    applyResumePoint()
    showTitleCard()
  }
}

watch(player, (element) => {
  if (element) initTransport(element)
}, { flush: 'post' })
watch(stage, (element) => {
  if (!element) {
    expandedFallback.value = false
    isFullscreen.value = false
  }
})

onMounted(() => {
  window.addEventListener('keydown', handlePlayerKey, true)
  document.addEventListener('fullscreenchange', syncFullscreen)
  // Leaving mid-film should keep the position; `pagehide` fires on tab close too.
  window.addEventListener('pagehide', flushProgress)
  touchUi.value = window.matchMedia('(pointer: coarse)').matches
  pipSupported.value = document.pictureInPictureEnabled && typeof player.value?.requestPictureInPicture === 'function'
  playbackRate.value = readStoredRate()
  if (player.value) initTransport(player.value)
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
  if (videoClickTimer !== undefined) clearTimeout(videoClickTimer)
  if (resumeTimer !== undefined) clearTimeout(resumeTimer)
  cancelPendingSideTap()
  stopEndedCountdown()
})

function flushProgress() {
  reportProgress(true)
}

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
          :class="{ 'is-fullscreen': isFullscreen, 'is-expanded-fallback': expandedFallback, 'is-fill': fillScreen, 'is-tab-focus': tabFocus }"
          @pointerdown="onStagePointerDown"
          @pointermove="onStagePointerMove"
          @pointerup="onStagePointerUp"
          @pointercancel="onStagePointerCancel"
        >
          <video
            :key="titleId"
            ref="player"
            :src="sourceUrl"
            :aria-label="activeEpisode ? `播放${detail.title}第 ${activeEpisode.season} 季第 ${activeEpisode.episode} 集` : `播放${detail.title}`"
            tabindex="0"
            playsinline
            preload="metadata"
            @error="reportPlaybackError"
            @loadedmetadata="playbackError = ''; applyResumePoint(); applyPlaybackRate(); syncTransport(); showTitleCard()"
            @loadeddata="syncTransport"
            @canplay="syncTransport(); showTitleCard()"
            @progress="syncTransport"
            @timeupdate="scheduleReport(); syncTransport()"
            @durationchange="syncTransport"
            @volumechange="syncVolume"
            @enterpictureinpicture="pipActive = true"
            @leavepictureinpicture="pipActive = false"
            @play="cancelEndedCountdown(); syncTransport(); revealControls(); showZoneHintOnce()"
            @pause="reportProgress(true); syncTransport(); revealControls()"
            @ended="onEnded"
            @click="onVideoClick"
            @dblclick="onVideoDoubleClick"
            @contextmenu.prevent
          >
            当前浏览器不支持网页视频。<a :href="downloadUrl" download>下载原文件</a>后可用本地播放器观看。
          </video>

          <div class="watch-transport" :class="{ 'is-hidden': !controlsShown && !settingsOpen }" role="group" aria-label="播放控制">
            <input
              type="range"
              dir="ltr"
              class="watch-transport-track"
              min="0"
              :max="duration"
              step="any"
              :value="progress"
              :disabled="!duration"
              :style="{ '--played': trackPercent(progress), '--buffered': trackPercent(bufferedTo) }"
              aria-label="播放进度"
              :aria-valuetext="`${clockTime(progress)} / ${clockTime(duration)}`"
              data-test="player-track"
              @input="previewScrub"
              @change="commitScrub"
              @pointercancel="cancelScrub"
              @keydown.left.prevent="seekBy(-seekStep)"
              @keydown.right.prevent="seekBy(seekStep)"
            >
            <div class="watch-transport-row">
              <div class="watch-transport-group">
                <button
                  class="watch-transport-button watch-play-button" type="button"
                  :aria-label="playing ? '暂停' : '播放'" :title="playing ? '暂停' : '播放'"
                  :disabled="Boolean(playbackError)" data-test="player-play" @click="togglePlay"
                >
                  <PublicIcon :name="playing ? 'pause' : 'play'" />
                </button>
                <button
                  v-if="previousEpisode" type="button" class="watch-transport-button"
                  :title="`上一集：第 ${previousEpisode.season} 季第 ${previousEpisode.episode} 集`"
                  :aria-label="`上一集：第 ${previousEpisode.season} 季第 ${previousEpisode.episode} 集`"
                  data-test="episode-prev" @click="watchEpisode(previousEpisode)"
                >
                  <PublicIcon name="next" class="watch-step-back" />
                </button>
                <button
                  v-if="nextEpisode" type="button" class="watch-transport-button"
                  :title="`下一集：第 ${nextEpisode.season} 季第 ${nextEpisode.episode} 集`"
                  :aria-label="`下一集：第 ${nextEpisode.season} 季第 ${nextEpisode.episode} 集`"
                  data-test="episode-next" @click="watchEpisode(nextEpisode, true)"
                >
                  <PublicIcon name="next" />
                </button>
                <button
                  class="watch-transport-button" type="button" :title="silent ? '恢复声音' : '静音'"
                  :aria-label="silent ? '恢复声音' : '静音'" data-test="player-volume" @click="toggleMute"
                >
                  <PublicIcon :name="silent ? 'muted' : 'volume'" />
                </button>
                <span class="watch-transport-clock" data-test="player-clock">{{ clockTime(progress) }} / {{ clockTime(duration) }}</span>
              </div>
              <div class="watch-transport-group">
                <label class="watch-speed" :title="`播放速度：${playbackRate}×`">
                  <span aria-hidden="true">{{ playbackRate === 1 ? '倍速' : `${playbackRate}×` }}</span>
                  <select
                    :value="String(playbackRate)" aria-label="播放速度" data-test="watch-speed"
                    @change="setPlaybackRate(($event.target as HTMLSelectElement).value); revealControls()"
                  >
                    <option v-for="rate in playbackRates" :key="rate" :value="String(rate)">{{ rate }}×</option>
                  </select>
                </label>
                <button
                  class="watch-transport-button" type="button" title="视频截图" aria-label="视频截图"
                  :disabled="!canCapture" data-test="player-screenshot" @click="captureFrame"
                >
                  <PublicIcon name="camera" />
                </button>
                <button
                  ref="settingsButton" class="watch-transport-button" type="button" title="播放设置" aria-label="播放设置"
                  :aria-expanded="settingsOpen" aria-controls="watch-player-settings" data-test="player-settings"
                  @click="settingsOpen = !settingsOpen"
                >
                  <PublicIcon name="gear" />
                </button>
                <div v-show="settingsOpen" id="watch-player-settings" class="watch-settings" role="group" aria-label="播放设置">
                  <label class="watch-settings-volume">
                    音量
                    <input type="range" min="0" max="1" step="0.01" :value="silent ? 0 : volume" @input="setVolume">
                  </label>
                  <button class="watch-settings-fit" type="button" @click="fillScreen = !fillScreen">
                    {{ fillScreen ? '保持画面比例' : '铺满屏幕' }}
                  </button>
                </div>
                <button
                  v-if="pipSupported" class="watch-transport-button" type="button"
                  :title="pipActive ? '退出画中画' : '画中画'" :aria-label="pipActive ? '退出画中画' : '画中画'"
                  :disabled="!canCapture" data-test="player-pip" @click="togglePictureInPicture"
                >
                  <PublicIcon name="pip" />
                </button>
                <button
                  class="watch-transport-button" type="button" :title="isFullscreen ? '退出全屏' : '全屏播放'"
                  :aria-label="isFullscreen ? '退出全屏' : '全屏播放'" data-test="player-fullscreen" @click="toggleFullscreen"
                >
                  <PublicIcon :name="isFullscreen ? 'collapse' : 'expand'" />
                </button>
              </div>
            </div>
          </div>

          <!-- While a swipe is being read, the pending position shows in the bottom-left
               corner so the viewer can see where the seek will land. -->
          <div v-if="swipePreviewing" class="watch-scrub-preview" aria-hidden="true" data-test="scrub-preview">
            <span class="watch-scrub-preview-time">{{ clockTime(swipePreview) }}</span>
            <span class="watch-scrub-preview-total">/ {{ clockTime(duration) }}</span>
            <span class="watch-scrub-preview-delta">{{ swipeOffset >= 0 ? '+' : '−' }}{{ Math.abs(Math.round(swipeOffset)) }} 秒</span>
          </div>

          <button
            v-if="!playing && !swipePreviewing && !playbackError && !endedCountdown"
            type="button" class="watch-paused-mark" aria-label="继续播放" data-test="paused-mark" @click="togglePlay"
          >
            <svg viewBox="0 0 84 80" aria-hidden="true" focusable="false">
              <path d="m35 17-7-10m21 10 7-10" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" />
              <path fill="currentColor" fill-rule="evenodd" d="M23 14h38c14 0 19 6 19 19v23c0 13-6 20-19 20H23C10 76 4 69 4 56V33c0-13 5-19 19-19Zm15 18c-4-2.6-8 0-8 4.8v17c0 4.8 4 7.4 8 4.8L54 49c3.9-2.4 3.9-6.2 0-8.6Z" />
            </svg>
          </button>

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
              <span>双击后退 {{ seekStep }} 秒</span>
            </span>
            <span class="watch-zone-hint-side">
              <span>双击前进 {{ seekStep }} 秒</span>
              <PublicIcon name="back" class="watch-zone-hint-flip" />
            </span>
          </div>

          <p v-if="playerNotice" class="watch-seek" role="status">
            <PublicIcon :name="playerNotice.icon" />
            <span>{{ playerNotice.text }}</span>
          </p>
          <p v-else-if="resumeNotice" class="watch-seek" role="status" data-test="resume-notice">{{ resumeNotice }}</p>
          <p v-if="isFullscreen && playbackError" class="watch-stage-error" role="status">{{ playbackError }}</p>

          <!-- A finished episode offers the next one instead of silently stopping. -->
          <div v-if="endedCountdown > 0 && nextEpisode" class="watch-next-card" role="status" data-test="next-up">
            <p class="watch-next-title">
              即将播放 第 {{ nextEpisode.season }} 季第 {{ nextEpisode.episode }} 集
              <span class="watch-next-seconds">{{ endedCountdown }} 秒</span>
            </p>
            <div class="watch-next-actions">
              <button class="btn watch-next-play" type="button" data-test="next-up-play" @click="watchEpisode(nextEpisode, true)">
                立即播放
              </button>
              <button class="btn watch-next-cancel" type="button" data-test="next-up-cancel" @click="cancelEndedCountdown">
                取消
              </button>
            </div>
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
  --player-pad: clamp(6px, 0.9vw, 12px);
  --player-button: clamp(24px, 7.5vw, 46px);
  --player-bottom: calc(70px + env(safe-area-inset-bottom, 0px));
  --player-accent: #ff5833;
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-md);
  background: #000;
  box-shadow: var(--shadow-player);
}
.watch-stage:fullscreen,
.watch-stage.is-fullscreen {
  inline-size: 100%;
  block-size: 100%;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.watch-stage.is-expanded-fallback {
  position: fixed;
  z-index: 120;
  inset: 0;
  block-size: 100dvh;
}
:global(html:has(.watch-stage.is-expanded-fallback)) { overflow: hidden; }
.watch-stage video {
  display: block;
  inline-size: 100%;
  max-block-size: 76vh;
  max-block-size: 76svh;
  aspect-ratio: 16 / 9;
  background: #000;
  object-fit: contain;
  touch-action: pan-y;
}
.watch-stage:fullscreen video,
.watch-stage.is-fullscreen video { block-size: 100%; max-block-size: none; }
.watch-stage.is-fill video { object-fit: cover; }
.watch-stage video:focus-visible { outline: none; }
.watch-stage.is-tab-focus video:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: -2px; }

/* A thin, uninterrupted seek line, followed by a single row of controls. */
.watch-transport {
  position: absolute;
  z-index: 8;
  inset: auto 0 0;
  padding: 2px var(--player-pad) calc(4px + env(safe-area-inset-bottom, 0px));
  color: #f0f0f0;
  background: transparent;
  text-shadow: 0 1px 3px #000, 0 0 5px rgb(0 0 0 / 0.65);
  transition: opacity var(--dur-fast) var(--ease);
}
.watch-transport.is-hidden { opacity: 0; pointer-events: none; }
.watch-stage.is-tab-focus .watch-transport.is-hidden:has(:focus-visible) { opacity: 1; pointer-events: auto; }
.watch-transport-row,
.watch-transport-group { display: flex; align-items: center; }
.watch-transport-row { justify-content: space-between; }
.watch-transport-group { gap: clamp(0px, calc((100vw - 390px) / 80), 6px); }
.watch-transport-button,
.watch-speed {
  display: grid;
  place-items: center;
  flex: none;
  inline-size: var(--player-button);
  block-size: 44px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.watch-transport-button :deep(svg) {
  inline-size: clamp(16px, 4.5vw, 24px);
  block-size: auto;
  filter: drop-shadow(0 1px 2px rgb(0 0 0 / 0.9));
}
.watch-play-button[aria-label="播放"] :deep(svg) { fill: currentColor; }
.watch-step-back { transform: rotate(180deg); }
.watch-transport-button:hover:not(:disabled),
.watch-transport-button[aria-expanded="true"],
.watch-speed:hover { color: #fff; background: rgb(255 255 255 / 0.1); }
.watch-transport-button:disabled { opacity: 0.4; cursor: default; }
.watch-transport-clock {
  flex: none;
  margin-inline: clamp(2px, 0.7vw, 10px) 2px;
  color: inherit;
  font-size: clamp(10px, 2.7vw, 16px);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.watch-transport-track {
  appearance: none;
  display: block;
  inline-size: 100%;
  block-size: 20px;
  margin: 0;
  border: 0;
  background: linear-gradient(to right, var(--player-accent) 0 var(--played), #747474 var(--played) max(var(--played), var(--buffered)), #414141 max(var(--played), var(--buffered)) 100%) center / 100% 3px no-repeat;
  cursor: pointer;
  touch-action: none;
}
.watch-transport-track:disabled { cursor: default; }
.watch-transport-track::-webkit-slider-thumb {
  appearance: none;
  inline-size: 10px;
  block-size: 10px;
  border-radius: 50%;
  background: var(--player-accent);
  opacity: 0;
}
.watch-transport-track::-moz-range-thumb {
  inline-size: 10px;
  block-size: 10px;
  border: 0;
  border-radius: 50%;
  background: var(--player-accent);
  opacity: 0;
}
.watch-transport-track:is(:hover, :focus-visible, :active):not(:disabled)::-webkit-slider-thumb { opacity: 1; }
.watch-transport-track:is(:hover, :focus-visible, :active):not(:disabled)::-moz-range-thumb { opacity: 1; }
.watch-speed { position: relative; font-size: clamp(11px, 3vw, 16px); }
.watch-speed select {
  position: absolute;
  inset: 0;
  inline-size: 100%;
  block-size: 100%;
  opacity: 0;
  cursor: pointer;
}
.watch-transport :is(button, input):focus-visible,
.watch-speed:has(select:focus-visible) { outline: 2px solid var(--player-accent); outline-offset: -2px; }
.watch-settings {
  position: absolute;
  inset-inline-end: var(--player-pad);
  inset-block-end: calc(100% + 0.4rem);
  inline-size: min(13rem, calc(100% - 2 * var(--player-pad)));
  padding: 0.6rem;
  border: 1px solid rgb(255 255 255 / 0.16);
  border-radius: var(--radius-sm);
  background: #151515;
  box-shadow: 0 4px 20px rgb(0 0 0 / 0.55);
  color: #eee;
  font-size: 0.85rem;
}
.watch-settings-volume { display: flex; align-items: center; gap: 0.6rem; padding: 0.3rem; }
.watch-settings-volume input { min-inline-size: 0; flex: 1; accent-color: var(--player-accent); }
.watch-settings-fit { inline-size: 100%; padding: 0.4rem; border-radius: var(--radius-sm); text-align: start; }
.watch-settings-fit:hover { background: rgb(255 255 255 / 0.12); }

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

.watch-paused-mark {
  position: absolute;
  z-index: 5;
  inset-block-start: 50%;
  inset-inline-start: 50%;
  display: grid;
  place-items: center;
  inline-size: clamp(3.5rem, 6vw, 5.5rem);
  aspect-ratio: 84 / 80;
  padding: 0;
  border: 0;
  background: none;
  color: rgb(255 255 255 / 0.86);
  transform: translate(-50%, -50%);
  cursor: pointer;
  animation: watch-paused-in 160ms var(--ease);
}
.watch-paused-mark:hover { color: #fff; }
.watch-paused-mark svg { display: block; inline-size: 80%; filter: drop-shadow(0 3px 8px rgb(0 0 0 / 0.5)); }
@keyframes watch-paused-in {
  from { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
  to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}

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

/* Seek and resume feedback live above the transport, inside the fullscreen stage. */
.watch-seek,
.watch-stage-error {
  position: absolute;
  z-index: 6;
  inset-block-end: var(--player-bottom);
  inset-inline-end: var(--player-pad);
  margin: 0;
  padding: 0.45rem 0.8rem;
  border-radius: var(--radius-pill);
  background: rgb(0 0 0 / 0.78);
  color: #fff;
  font-size: 0.84rem;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  backdrop-filter: blur(6px);
}
.watch-seek { display: inline-flex; align-items: center; gap: 0.4rem; white-space: nowrap; }
.watch-seek :deep(svg) { inline-size: 1.05rem; block-size: 1.05rem; color: var(--player-accent); }
.watch-stage-error { inset-inline-start: var(--player-pad); text-align: center; }

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
  .watch-stage:not(.is-fullscreen, :fullscreen) { margin-inline: calc(var(--shell-pad) * -1); border-radius: 0; }
  .watch-actions { flex: 1 1 100%; margin-inline-start: 0; }
  .watch-action { flex: 1 1 8rem; }
  .watch-file-size { display: none; }
  .watch-keys { display: none; }
}
</style>
