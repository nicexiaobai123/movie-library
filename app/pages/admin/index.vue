<script setup lang="ts">
import type { AdminLibrary, AdminMedia, BulkEditResult, ScanStatus } from '#shared/types/library'
import AdminBulkPanel from '~/components/admin/AdminBulkPanel.vue'
import AdminMediaList from '~/components/admin/AdminMediaList.vue'
import AdminScanPanel from '~/components/admin/AdminScanPanel.vue'
import AdminUploadPanel from '~/components/admin/AdminUploadPanel.vue'
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
const listPanel = ref<{ focusRow: (id: string) => void } | null>(null)

// One section at a time keeps the page short; the list is the default because
// it is where most editing happens.
type AdminTab = 'files' | 'ingest' | 'bulk'
const tabs = [
  { value: 'files', label: '文件清单' },
  { value: 'ingest', label: '上传与扫描' },
  { value: 'bulk', label: '批量处理' },
] as const satisfies readonly { value: AdminTab; label: string }[]
const tab = ref<AdminTab>('files')

const pendingCount = computed(() => (library.value?.items ?? []).filter(item => item.state === 'pending').length)
// Published titles with no poster fall back to a placeholder tile on the site, so
// the bulk tab advertises them as work waiting to be done.
const missingPosterCount = computed(() => {
  const titles = library.value?.titles ?? []
  return titles.filter(title => {
    const published = (library.value?.items ?? []).some(item => item.titleId === title.id && item.state === 'published')
    return published && !title.posterPath
  }).length
})
const tabCounts = computed<Record<AdminTab, number | null>>(() => ({
  files: pendingCount.value || null,
  ingest: null,
  bulk: (pendingCount.value + missingPosterCount.value) || null,
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
    // A catalog response that started before a scan request cannot replace its newer status.
    if (readingScanRevision === scanRevision && !startingScan.value && !checkingScan.value) {
      applyScanStatus(result.scan)
    }
  } catch (error) {
    if (!canUpdate() || handleUnauthorized(error) || libraryRequest !== requestId) return
    libraryError.value = adminErrorMessage(error, '暂时无法读取文件清单，请重试。')
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
    if (!result.running) void refreshLibrary()
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

function onSaved(item: AdminMedia) {
  notice.value = item.state === 'published' && item.available
    ? `已保存并发布：${item.fileName}`
    : `已保存：${item.fileName}`
  void refreshLibrary()
}

function onBulkPublished(result: BulkEditResult) {
  notice.value = result.skipped.length
    ? `批量发布完成：${result.published.length} 个已发布，${result.skipped.length} 个待手动整理。`
    : `批量发布完成：${result.published.length} 个已发布。`
  void refreshLibrary()
}

// Hand a blocked file from the bulk panel to the detailed editor on the list tab.
async function openManual(id: string) {
  tab.value = 'files'
  await nextTick()
  listPanel.value?.focusRow(id)
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

onMounted(() => { void refreshLibrary() })
onBeforeUnmount(() => {
  disposed = true
  clearScanTimer()
})
</script>

<template>
  <div class="shell admin-page">
    <header class="admin-heading">
      <div>
        <p class="eyebrow">夜灯 · 管理后台</p>
        <h1>片库管理</h1>
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
      <p>{{ signingOut ? '当前设备的管理会话已结束。' : '管理员会话已失效，登录后可继续管理影视库。' }}</p>
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

      <div v-show="tab === 'files'" id="admin-panel-files" role="tabpanel" aria-labelledby="admin-tab-files">
        <AdminMediaList
          ref="listPanel"
          :items="library?.items ?? []"
          :titles="library?.titles ?? []"
          :loaded="library !== null"
          :loading="loadingLibrary"
          :error-message="libraryError"
          :disabled="signingOut"
          @refresh="refreshLibrary"
          @saved="onSaved"
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

      <div v-show="tab === 'bulk'" id="admin-panel-bulk" role="tabpanel" aria-labelledby="admin-tab-bulk">
        <AdminBulkPanel
          :items="library?.items ?? []"
          :titles="library?.titles ?? []"
          :settings="library?.settings ?? { defaultDescription: '' }"
          :disabled="signingOut"
          @published="onBulkPublished"
          @manual="openManual"
          @unauthorized="expireSession"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.admin-page {
  padding-block: clamp(1.8rem, 4vw, 3.2rem) clamp(3rem, 6vw, 5rem);
}
/* The page is narrower than the shared shell, but keeps the shell's side padding
   so the title lines up with the site header on every width. */
.admin-page > * { max-inline-size: 78rem; }
.admin-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem 2rem;
  padding-block-end: clamp(1rem, 2.4vw, 1.6rem);
}
/* The copy block shrinks instead of forcing the title under the logout button. */
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
  /* Only the tab strip may scroll sideways. Setting overflow-x on its own makes
     the vertical axis scrollable too, and the active tab's -1px margin would then
     paint a stray vertical scrollbar beside the tabs. */
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
  border-block-end: 1px solid var(--border-strong);
}
.admin-tabs::-webkit-scrollbar { block-size: 2px; }
.admin-tabs::-webkit-scrollbar:vertical { inline-size: 0; block-size: 0; }
.admin-tabs::-webkit-scrollbar-thumb { border-radius: 2px; background: var(--border-strong); }
.admin-tabs::-webkit-scrollbar-track { background: transparent; }
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
.admin-notice:not(:empty) {
  margin-block: 1rem 0;
  padding: 0.65rem 0 0.65rem 1rem;
  border-inline-start: 2px solid var(--accent);
  color: var(--text-secondary);
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
/* On a phone the logout button drops below the title rather than overlapping it. */
@media (max-width: 30rem) {
  .admin-heading { align-items: flex-start; }
  .admin-heading h1 { font-size: clamp(1.7rem, 7vw, 2rem); }
}
</style>
