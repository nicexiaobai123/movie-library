<script setup lang="ts">
import type { AdminLibrary, AdminMedia, ScanStatus } from '#shared/types/library'
import AdminMediaList from '~/components/admin/AdminMediaList.vue'
import AdminScanPanel from '~/components/admin/AdminScanPanel.vue'
import AdminUploadPanel from '~/components/admin/AdminUploadPanel.vue'
import { captureFirstFrame, frameFileName } from '~/composables/useFirstFrame'
import { adminErrorMessage, adminErrorStatus, useAdminApi } from '~/composables/useAdminApi'

useSeoMeta({ title: '管理后台 · 夜灯', robots: 'noindex, nofollow' })
definePageMeta({ middleware: 'admin' })

const api = useAdminApi()
const library = shallowRef<AdminLibrary | null>(null)
const loadingLibrary = ref(true)
const libraryError = ref('')
const notice = ref('')
const scan = shallowRef<ScanStatus | null>(null)
const startingScan = ref(false)
const checkingScan = ref(false)
const scanError = ref('')
const signingOut = ref(false)
const logoutError = ref('')
const sessionExpired = ref(false)
const sessionHeading = ref<HTMLElement | null>(null)

// Two sections: the library as it stands, and the two ways to add to it.
type AdminTab = 'files' | 'ingest'
const tabs = [
  { value: 'files', label: '媒体库' },
  { value: 'ingest', label: '扫描与上传' },
] as const satisfies readonly { value: AdminTab; label: string }[]
const tab = ref<AdminTab>('files')

// Every file in the media folder becomes an entry, so the count is simply all of it.
const fileCount = computed(() => library.value?.items.length ?? 0)
const tabCounts = computed<Record<AdminTab, number | null>>(() => ({
  files: fileCount.value || null,
  ingest: null,
}))

let scanTimer: ReturnType<typeof setTimeout> | null = null
let scanRevision = 0
let libraryRequest = 0
let disposed = false

function canUpdate() {
  return !disposed && !sessionExpired.value
}

function clearScanTimer() {
  if (scanTimer !== null) {
    clearTimeout(scanTimer)
    scanTimer = null
  }
}

function expireSession() {
  if (!canUpdate()) return
  sessionExpired.value = true
  library.value = null
  scan.value = null
  clearScanTimer()
  void nextTick(() => sessionHeading.value?.focus())
}

function handleUnauthorized(error: unknown) {
  if (adminErrorStatus(error) !== 401) return false
  expireSession()
  return true
}

function scheduleScanCheck(delay = 1500) {
  if (scanTimer !== null || !canUpdate()) return
  scanTimer = setTimeout(() => {
    scanTimer = null
    void checkScan()
  }, delay)
}

function applyScanStatus(status: ScanStatus) {
  scanRevision++
  scan.value = status
  scanError.value = ''
  if (status.running) scheduleScanCheck()
  else clearScanTimer()
}

async function refreshLibrary() {
  if (!canUpdate()) return
  const requestId = ++libraryRequest
  const readingScanRevision = scanRevision
  loadingLibrary.value = true
  libraryError.value = ''

  try {
    const result = await api.library()
    if (!canUpdate() || libraryRequest !== requestId) return
    library.value = result
    if (readingScanRevision === scanRevision && !startingScan.value && !checkingScan.value) {
      applyScanStatus(result.scan)
    }
  } catch (error) {
    if (!canUpdate() || handleUnauthorized(error) || libraryRequest !== requestId) return
    libraryError.value = adminErrorMessage(error, '暂时无法读取媒体库，请重试。')
  } finally {
    if (canUpdate() && libraryRequest === requestId) loadingLibrary.value = false
  }
}

async function checkScan(allowUnknown = false) {
  if (!canUpdate() || checkingScan.value || startingScan.value || (!scan.value?.running && !allowUnknown)) return
  clearScanTimer()
  checkingScan.value = true
  try {
    const result = await api.scanStatus()
    if (!canUpdate()) return
    applyScanStatus(result)
    if (!result.running) {
      void refreshLibrary()
      void fillMissingCovers()
    }
  } catch (error) {
    if (!canUpdate() || handleUnauthorized(error)) return
    scanError.value = adminErrorMessage(error, '暂时无法查询扫描状态。')
    if (scan.value?.running) scheduleScanCheck(3500)
  } finally {
    if (canUpdate()) checkingScan.value = false
  }
}

async function startScan() {
  if (!canUpdate() || startingScan.value || checkingScan.value || scan.value?.running || signingOut.value) return
  startingScan.value = true
  scanError.value = ''
  scanRevision++
  let shouldCheck = false
  try {
    const result = await api.startScan()
    if (!canUpdate()) return
    applyScanStatus(result)
    if (!result.running) void refreshLibrary()
  } catch (error) {
    if (!canUpdate() || handleUnauthorized(error)) return
    scanError.value = adminErrorMessage(error, '未能提交扫描请求，请重试。')
    shouldCheck = adminErrorStatus(error) === 409
  } finally {
    if (canUpdate()) {
      startingScan.value = false
      if (shouldCheck) void checkScan(true)
    }
  }
}

// Result messages are transient: they must not push the list down.
let noticeTimer: ReturnType<typeof setTimeout> | undefined
function announce(message: string) {
  notice.value = message
  if (noticeTimer !== undefined) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => { notice.value = '' }, 6000)
}
onBeforeUnmount(() => {
  disposed = true
  clearScanTimer()
  if (noticeTimer !== undefined) clearTimeout(noticeTimer)
})

function onSaved(item: AdminMedia) {
  announce(`已保存：${item.title}`)
  void refreshLibrary()
}

// Re-classifying a batch changes which titles exist, so the counts are re-read too.
function onClassified() {
  void refreshLibrary()
}

// The first frame becomes the cover automatically. The browser can decode the MP4,
// so no FFmpeg is needed on the host; each title without a cover is filled in once
// per page load, and a failure only leaves the placeholder.
const covering = ref(0)
let coverRun = 0

async function fillMissingCovers() {
  if (sessionExpired.value || disposed) return
  const run = ++coverRun
  let pending: { titleId: string; mediaId: string; title: string }[] = []
  try {
    const result = await $fetch<{ items: typeof pending }>('/api/admin/covers')
    pending = result.items
  } catch {
    return
  }
  if (!pending.length) return
  covering.value = pending.length
  for (const entry of pending) {
    if (disposed || sessionExpired.value || run !== coverRun) break
    try {
      const frame = await captureFirstFrame(`/api/admin/media/${encodeURIComponent(entry.mediaId)}/preview`)
      const name = frameFileName(entry.title)
      const uploaded = await $fetch<{ path: string }>('/api/admin/posters', {
        method: 'POST',
        query: { name },
        body: new File([frame.blob], name, { type: 'image/jpeg' }),
        headers: { 'content-type': 'image/jpeg' },
        timeout: 60_000,
      })
      // Only the cover is written; every other field keeps its stored value.
      const library = await api.library()
      const title = library.titles.find(candidate => candidate.id === entry.titleId)
      const row = library.items.find(item => item.titleId === entry.titleId)
      if (!title || !row) continue
      await api.editMedia(row.id, {
        title: title.title,
        year: title.year,
        description: title.description,
        posterPath: uploaded.path,
        runtime: title.runtime,
        cast: title.cast,
        kind: title.kind,
        season: row.season,
        episode: row.episode,
      })
    } catch (error) {
      if (adminErrorStatus(error) === 401) {
        expireSession()
        return
      }
      // A cover is a convenience; one failure must not stop the rest.
    } finally {
      if (!disposed) covering.value = Math.max(0, covering.value - 1)
    }
  }
  if (!disposed && run === coverRun) void refreshLibrary()
}

async function logout() {
  if (signingOut.value || !canUpdate()) return
  signingOut.value = true
  logoutError.value = ''
  try {
    await api.logout()
  } catch (error) {
    if (disposed) return
    if (adminErrorStatus(error) !== 401) {
      logoutError.value = adminErrorMessage(error, '未能退出登录，请重试。')
      signingOut.value = false
      return
    }
  }
  if (!disposed) {
    expireSession()
    await navigateTo('/admin/login', { replace: true })
  }
}

onMounted(async () => {
  await refreshLibrary()
  void fillMissingCovers()
})
</script>

<template>
  <div class="shell admin-page">
    <header class="admin-heading">
      <div>
        <p class="eyebrow">夜灯 · 管理后台</p>
        <h1>媒体库</h1>
      </div>
      <button
        v-if="!sessionExpired"
        class="btn"
        type="button"
        :disabled="signingOut"
        data-test="admin-logout"
        @click="logout"
      >
        {{ signingOut ? '正在退出…' : '退出登录' }}
      </button>
    </header>

    <section v-if="sessionExpired" class="admin-state" aria-labelledby="admin-session-title" data-test="admin-session-expired">
      <h2 id="admin-session-title" ref="sessionHeading" tabindex="-1">{{ signingOut ? '已退出登录' : '请重新登录' }}</h2>
      <p>{{ signingOut ? '当前设备的管理会话已结束。' : '管理员会话已失效，登录后可继续管理媒体库。' }}</p>
      <NuxtLink class="btn btn--primary" to="/admin/login">前往登录</NuxtLink>
    </section>

    <template v-else>
      <div class="admin-tabs" role="tablist" aria-label="管理功能">
        <button
          v-for="item in tabs"
          :id="`admin-tab-${item.value}`"
          :key="item.value"
          class="admin-tab"
          type="button"
          role="tab"
          :aria-selected="tab === item.value"
          :aria-controls="`admin-panel-${item.value}`"
          :tabindex="tab === item.value ? 0 : -1"
          :data-test="`admin-tab-${item.value}`"
          @click="tab = item.value"
        >
          {{ item.label }}
          <span v-if="tabCounts[item.value]" class="admin-tab-count">{{ tabCounts[item.value] }}</span>
        </button>
      </div>

      <p v-if="logoutError" class="admin-error" role="alert">{{ logoutError }}</p>
      <p class="admin-notice" role="status" data-test="admin-save-status">{{ notice }}</p>
      <p v-if="covering" class="admin-notice" role="status" data-test="admin-covering">
        {{ `正在用视频第一帧生成封面，剩余 ${covering} 部…` }}
      </p>

      <div v-show="tab === 'files'" id="admin-panel-files" role="tabpanel" aria-labelledby="admin-tab-files">
        <AdminMediaList
          :items="library?.items ?? []"
          :titles="library?.titles ?? []"
          :loaded="library !== null"
          :loading="loadingLibrary"
          :error-message="libraryError"
          :disabled="signingOut"
          @refresh="refreshLibrary"
          @saved="onSaved"
          @classified="onClassified"
          @unauthorized="expireSession"
        />
      </div>

      <div v-show="tab === 'ingest'" id="admin-panel-ingest" role="tabpanel" aria-labelledby="admin-tab-ingest">
        <div class="admin-tools">
          <AdminUploadPanel :disabled="signingOut" @uploaded="refreshLibrary" @unauthorized="expireSession" />
          <AdminScanPanel
            :scan="scan"
            :starting="startingScan"
            :checking="checkingScan"
            :error-message="scanError"
            :disabled="signingOut || (loadingLibrary && !scan)"
            @start="startScan"
            @retry-status="checkScan()"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.admin-page {
  padding-block: clamp(1.8rem, 4vw, 3.2rem) clamp(1.6rem, 3vw, 2.4rem);
}
.admin-page {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
.admin-page > .admin-tabs { margin-block-end: 0.15rem; }
.admin-heading, .admin-tabs { flex: none; }
:global(.site:has(#admin-panel-files)) :global(.footer) { margin-block-start: 0; }
.admin-page > * { max-inline-size: 92rem; }
.admin-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.9rem 2rem;
  padding-block-end: clamp(1.2rem, 2.6vw, 1.9rem);
}
.admin-heading > div { min-inline-size: 0; }
.admin-heading h1 { overflow-wrap: anywhere; }
.admin-heading .eyebrow {
  color: var(--accent);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.12em;
}
.admin-heading h1 {
  margin-block: 0.55rem 0;
  font-family: var(--font-display);
  font-size: clamp(1.9rem, 4vw, 2.7rem);
  font-weight: 500;
  line-height: 1.2;
}
.admin-tabs {
  display: flex;
  gap: 0 1.8rem;
  overflow-x: auto;
  overflow-y: hidden;
  border-block-end: 1px solid var(--border-strong);
}
.admin-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 46px;
  margin-block-end: -1px;
  padding: 0.65rem 0;
  border: 0;
  border-block-end: 2px solid transparent;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.92rem;
  white-space: nowrap;
}
.admin-tab[aria-selected='true'] {
  border-block-end-color: var(--accent);
  color: var(--text);
}
.admin-tab-count {
  padding: 0 0.4rem;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
  line-height: 1.5;
}
.admin-tools {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  padding-block: clamp(1.4rem, 3vw, 2.4rem);
}
.admin-tools > * { min-width: 0; }
.admin-tools > * + * {
  margin-block-start: 1.6rem;
  padding-block-start: 1.6rem;
  border-block-start: 1px solid var(--border);
}
.admin-error {
  margin-block-start: 1rem;
  color: var(--color-danger, var(--accent-strong));
}
.admin-error, .admin-notice { overflow-wrap: anywhere; }
/* A result message is a short-lived banner pinned to the bottom edge. */
.admin-notice:not(:empty) {
  position: fixed;
  z-index: 40;
  inset-inline: 1rem;
  inset-block-end: 1.25rem;
  max-inline-size: 34rem;
  margin-inline: auto;
  padding: 0.75rem 1.1rem;
  border: 1px solid var(--border-strong);
  border-inline-start: 3px solid var(--accent);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-pop);
  color: var(--text-secondary);
  font-size: 0.86rem;
  animation: notice-in var(--dur) var(--ease);
}
@keyframes notice-in {
  from { opacity: 0; transform: translateY(0.5rem); }
}
.admin-notice:empty {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
}
.admin-state {
  display: grid;
  justify-items: start;
  gap: 0.85rem;
  max-width: 42rem;
  padding-block: clamp(2rem, 4vw, 3rem);
}
.admin-state h2 { font-family: var(--font-display); font-size: 1.4rem; font-weight: 600; }
@media (min-width: 49rem) {
  .admin-tools { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .admin-tools > :first-child { padding-inline-end: clamp(1.5rem, 3.5vw, 3.5rem); }
  .admin-tools > * + * {
    margin-block-start: 0;
    padding-block-start: 0;
    padding-inline-start: clamp(1.5rem, 3.5vw, 3.5rem);
    border-block-start: 0;
    border-inline-start: 1px solid var(--border);
  }
}
@media (max-width: 30rem) {
  .admin-heading { align-items: flex-start; }
  .admin-heading h1 { font-size: clamp(1.7rem, 7vw, 2rem); }
}
</style>
