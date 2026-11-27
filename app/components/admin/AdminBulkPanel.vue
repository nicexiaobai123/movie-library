<script setup lang="ts">
import type { AdminMedia, AdminSettings, BulkEditResult } from '#shared/types/library'
import { captureFirstFrame, frameFileName } from '~/composables/useFirstFrame'
import { adminErrorMessage, adminErrorStatus, useAdminApi } from '~/composables/useAdminApi'

const props = defineProps<{
  items: readonly AdminMedia[]
  titles: readonly { id: string; title: string; description: string; posterPath: string | null }[]
  settings: AdminSettings
  disabled?: boolean
}>()
const emit = defineEmits<{ published: [result: BulkEditResult]; manual: [id: string]; unauthorized: [] }>()

const api = useAdminApi()
const mode = ref<'complete' | 'publish'>('complete')
const pending = computed(() => props.items.filter(item => item.state === 'pending'))
const publishedItems = computed(() => props.items.filter(item => item.state === 'published' && item.available))

const titlesById = computed(() => new Map(props.titles.map(title => [title.id, title])))

// In complete mode one film may own several episode files; each title is listed once.
const perTitle = computed(() => {
  const seen = new Set<string>()
  return publishedItems.value.filter((item) => {
    if (!item.titleId || seen.has(item.titleId)) return false
    seen.add(item.titleId)
    return true
  })
})
const incomplete = computed(() => perTitle.value.filter((item) => {
  const title = titlesById.value.get(item.titleId ?? '')
  return Boolean(title && (!title.description.trim() || !title.posterPath))
}))
// A published film with neither a poster nor artwork to generate one shows the
// placeholder tile on the site, so the count is surfaced separately.
const missingPoster = computed(() => perTitle.value.filter((item) => !titlesById.value.get(item.titleId ?? '')?.posterPath))

const candidates = computed(() => mode.value === 'publish' ? pending.value.filter(item => item.available) : incomplete.value)
const rows = computed(() => mode.value === 'publish' ? pending.value : perTitle.value)
const selected = ref<Set<string>>(new Set())
const withFirstFrame = ref(true)

// Films still missing a cover are what the administrator came here to fix, so
// they can be selected in one click instead of ticking each file by hand.
function selectMissingPosters() {
  selected.value = new Set(missingPoster.value.map(item => item.id))
}

const overwrite = ref(false)
const publishAs = ref<'auto' | 'movie' | 'series'>('auto')
const description = ref('')
const publishing = ref(false)
const progress = ref({ done: 0, total: 0 })
const errorMessage = ref('')
const resultMessage = ref('')
const settingsMessage = ref('')
const settingsError = ref('')
const savingSettings = ref(false)
let disposed = false

onMounted(() => { description.value = props.settings.defaultDescription })
watch(() => props.settings.defaultDescription, (value) => {
  if (!description.value.trim()) description.value = value
})
onBeforeUnmount(() => { disposed = true })

const allSelected = computed(() => candidates.value.length > 0 && candidates.value.every(item => selected.value.has(item.id)))

// Switching modes must not carry a selection into a different set of files.
watch(mode, () => { selected.value = new Set() })
watch(candidates, (current) => {
  const allowed = new Set(current.map(item => item.id))
  // On the first pass, pre-select the films that have no cover at all: that is
  // the common reason to open this panel, and it keeps the action one click away.
  if (!selected.value.size && mode.value === 'complete') {
    const missing = new Set(missingPoster.value.map(item => item.id))
    const preselect = current.filter(item => missing.has(item.id))
    if (preselect.length) {
      selected.value = new Set(preselect.map(item => item.id))
      return
    }
  }
  const next = new Set([...selected.value].filter(id => allowed.has(id)))
  if (next.size !== selected.value.size) selected.value = next
}, { immediate: true })

function toggleAll() {
  selected.value = allSelected.value ? new Set() : new Set(candidates.value.map(item => item.id))
}

function toggle(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

// The browser grabs the frame and uploads it as a normal poster, so no FFmpeg is
// needed on the host. A failure simply leaves the generated placeholder cover.
async function framePosterFor(item: AdminMedia): Promise<string | null> {
  try {
    const frame = await captureFirstFrame(`/api/admin/media/${encodeURIComponent(item.id)}/preview`)
    const file = new File([frame.blob], frameFileName(item.suggestion.title ?? item.fileName), { type: 'image/jpeg' })
    const response = await $fetch<{ path: string }>('/api/admin/posters', {
      method: 'POST',
      query: { name: file.name },
      body: file,
      headers: { 'content-type': 'image/jpeg' },
      timeout: 60_000,
    })
    return response.path
  } catch (error) {
    if (adminErrorStatus(error) === 401) throw error
    return null
  }
}

async function run() {
  if (props.disabled || publishing.value || !selected.value.size) return
  publishing.value = true
  errorMessage.value = ''
  resultMessage.value = ''
  progress.value = { done: 0, total: selected.value.size }
  try {
    const chosen = candidates.value.filter(item => selected.value.has(item.id))
    const body = []
    for (const [index, item] of chosen.entries()) {
      const needsPoster = mode.value === 'publish' || overwrite.value || !titlesById.value.get(item.titleId ?? '')?.posterPath
      const posterPath = withFirstFrame.value && needsPoster ? await framePosterFor(item) : null
      body.push({
        id: item.id,
        mode: mode.value,
        titleId: null,
        kind: mode.value === 'publish' ? (publishAs.value === 'auto' ? null : publishAs.value) : null,
        title: item.suggestion.title,
        year: item.suggestion.year,
        description: description.value.trim() ? description.value.trim() : null,
        posterPath,
        season: item.suggestion.season,
        episode: item.suggestion.episode,
        episodeTitle: null,
        replaceExisting: false,
        overwrite: overwrite.value,
      })
      progress.value = { done: index + 1, total: chosen.length }
    }
    const result = await api.publishMany(body)
    if (disposed) return
    const done = new Set(result.published.map(item => item.id))
    selected.value = new Set([...selected.value].filter(id => !done.has(id)))
    resultMessage.value = result.skipped.length
      ? `已处理 ${result.published.length} 个，${result.skipped.length} 个未改动或需要手动处理。`
      : `已处理 ${result.published.length} 个。`
    emit('published', result)
  } catch (error) {
    if (disposed) return
    if (adminErrorStatus(error) === 401) emit('unauthorized')
    else errorMessage.value = adminErrorMessage(error, '批量操作失败，请稍后重试。')
  } finally {
    if (!disposed) publishing.value = false
  }
}

async function saveDefault() {
  if (savingSettings.value || props.disabled) return
  savingSettings.value = true
  settingsError.value = ''
  settingsMessage.value = ''
  try {
    await api.saveSettings({ defaultDescription: description.value.trim() })
    if (disposed) return
    settingsMessage.value = '默认简介已保存，之后发布或扫描新影片时使用。'
  } catch (error) {
    if (disposed) return
    if (adminErrorStatus(error) === 401) emit('unauthorized')
    else settingsError.value = adminErrorMessage(error, '保存默认简介失败，请稍后重试。')
  } finally {
    if (!disposed) savingSettings.value = false
  }
}
</script>

<template>
  <section class="bulk-panel" aria-label="批量处理">
    <!-- The tab already names this panel, and the two mode buttons explain
         themselves, so no intro paragraph is needed. -->
    <h2 id="admin-bulk-title" class="visually-hidden">批量处理</h2>

    <div class="bulk-modes" role="radiogroup" aria-label="批量处理方式">
      <button
        class="bulk-mode"
        type="button"
        role="radio"
        :aria-checked="mode === 'complete'"
        data-test="admin-bulk-mode-complete"
        @click="mode = 'complete'"
      >补齐已有影片（{{ incomplete.length }}）</button>
      <button
        class="bulk-mode"
        type="button"
        role="radio"
        :aria-checked="mode === 'publish'"
        data-test="admin-bulk-mode-publish"
        @click="mode = 'publish'"
      >发布待整理（{{ pending.length }}）</button>
    </div>

    <p v-if="!candidates.length" class="bulk-empty" data-test="admin-bulk-empty">
      {{ mode === 'publish' ? '没有待整理的文件。' : '所有已发布影片都有简介和封面了。' }}
    </p>
    <template v-else>
      <div v-if="mode === 'complete' && missingPoster.length" class="bulk-hint" data-test="admin-bulk-missing-poster">
        <p class="bulk-hint-text">
          <strong>{{ missingPoster.length }}</strong> 部影片还没有封面，会显示占位图。勾选后执行即可用视频第一帧补上。
        </p>
        <button class="btn btn--ghost bulk-hint-action" type="button" :disabled="publishing || disabled" data-test="admin-bulk-select-missing" @click="selectMissingPosters">
          只选缺封面的（{{ missingPoster.length }}）
        </button>
      </div>

      <div class="bulk-toolbar">
        <label class="bulk-check">
          <input type="checkbox" :checked="allSelected" :disabled="publishing || disabled" data-test="admin-bulk-all" @change="toggleAll">
          <span>全选（{{ selected.size }} / {{ candidates.length }}）</span>
        </label>
      </div>

      <ul class="bulk-list" role="list">
        <li v-for="item in rows" :key="item.id" class="bulk-row" :class="{ 'is-blocked': !candidates.includes(item) }">
          <label class="bulk-check">
            <input
              type="checkbox"
              :checked="selected.has(item.id)"
              :disabled="publishing || disabled || !candidates.includes(item)"
              :data-test="`admin-bulk-select-${item.id}`"
              @change="toggle(item.id)"
            >
            <span class="visually-hidden">选择 {{ item.fileName }}</span>
          </label>
          <span class="bulk-file">
            <span class="bulk-name">{{ mode === 'complete' ? (titlesById.get(item.titleId ?? '')?.title ?? item.fileName) : (item.suggestion.title || item.fileName) }}</span>
            <span class="bulk-meta">
              {{ mode === 'complete' ? (item.suggestion.kind === 'series' ? '剧集' : item.suggestion.kind === 'movie' ? '电影' : '已发布') : (item.suggestion.kind === 'series' ? '剧集' : item.suggestion.kind === 'movie' ? '电影' : '类型待定') }}
              <template v-if="item.suggestion.year"> · {{ item.suggestion.year }}</template>
              <template v-if="mode === 'publish' && item.suggestion.season !== null"> · 第 {{ item.suggestion.season }} 季</template>
              <template v-if="mode === 'publish' && item.suggestion.episode !== null"> · 第 {{ item.suggestion.episode }} 集</template>
              <template v-if="mode === 'complete' && item.fileName"> · {{ item.fileName }}</template>
            </span>
            <span v-if="mode === 'publish' && !candidates.includes(item)" class="bulk-blocked" data-test="admin-bulk-blocked">
              {{ item.available ? '需要手动判断片名、类型或集号' : (item.reason || '媒体文件暂不可用') }}
            </span>
          </span>
          <button class="btn bulk-edit" type="button" :disabled="publishing || disabled" @click="emit('manual', item.id)">
            手动整理
          </button>
        </li>
      </ul>

      <div class="bulk-options">
        <div v-if="mode === 'publish'" class="bulk-field">
          <label for="admin-bulk-kind">发布为</label>
          <select id="admin-bulk-kind" v-model="publishAs" class="field" :disabled="publishing || disabled" data-test="admin-bulk-kind">
            <option value="auto">按文件名判断</option>
            <option value="movie">全部为电影</option>
            <option value="series">全部为剧集</option>
          </select>
        </div>
        <label class="bulk-toggle">
          <input v-model="withFirstFrame" type="checkbox" :disabled="publishing || disabled" data-test="admin-bulk-first-frame">
          <span>用视频第一帧作封面</span>
        </label>
        <label v-if="mode === 'complete'" class="bulk-toggle">
          <input v-model="overwrite" type="checkbox" :disabled="publishing || disabled" data-test="admin-bulk-overwrite">
          <span>覆盖已有的简介和封面</span>
        </label>
      </div>

      <div class="bulk-field">
        <label for="admin-bulk-description">简介</label>
        <textarea
          id="admin-bulk-description"
          v-model="description"
          class="field"
          rows="3"
          maxlength="6000"
          placeholder="留空则使用已保存的默认简介"
          :disabled="publishing || disabled"
          data-test="admin-bulk-description"
        />
        <p class="bulk-hint">「补齐」时默认只填空白项；勾选覆盖才会改写已有内容。</p>
      </div>

      <div class="bulk-actions">
        <button class="btn btn--primary" type="button" :disabled="publishing || disabled || !selected.size" data-test="admin-bulk-publish" @click="run">
          {{ publishing ? `正在处理 ${progress.done}/${progress.total}…` : `处理选中的 ${selected.size} 个` }}
        </button>
        <button class="btn" type="button" :disabled="savingSettings || publishing || disabled" data-test="admin-bulk-save-default" @click="saveDefault">
          {{ savingSettings ? '正在保存…' : '保存为默认简介' }}
        </button>
      </div>
      <p v-if="resultMessage" class="bulk-result" role="status" data-test="admin-bulk-result">{{ resultMessage }}</p>
      <p v-if="errorMessage" class="bulk-error" role="alert" data-test="admin-bulk-error">{{ errorMessage }}</p>
      <p v-if="settingsError" class="bulk-error" role="alert">{{ settingsError }}</p>
      <p v-else-if="settingsMessage" class="bulk-hint" role="status" data-test="admin-bulk-settings-status">{{ settingsMessage }}</p>
    </template>
  </section>
</template>

<style scoped>
.bulk-panel {
  min-width: 0;
  padding-block: clamp(1.1rem, 2vw, 1.5rem);
  border-block-end: 1px solid var(--border);
}
.bulk-empty,
.bulk-hint {
  margin-block-start: 0.4rem;
  color: var(--text-muted);
  font-size: 0.9rem;
  line-height: 1.7;
}
.bulk-empty { padding-block: 0.6rem 0; }
.bulk-modes {
  display: flex;
  flex-wrap: wrap;
  gap: 0 1.7rem;
  margin-block: 1.2rem 0;
  border-block-end: 1px solid var(--border);
}
.bulk-mode {
  min-height: 44px;
  margin-block-end: -1px;
  padding: 0.65rem 0;
  border: 0;
  border-block-end: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.9rem;
  text-align: left;
}
.bulk-mode[aria-checked='true'] {
  border-block-end-color: var(--accent);
  color: var(--text);
}
.bulk-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.5rem;
  margin-block: 1rem 0;
}
/* Surfaces the one thing this panel exists to fix, rather than burying it in a list. */
.bulk-hint {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.7rem 1.2rem;
  margin-block-start: 1.1rem;
  padding: 0.85rem 1rem;
  border: 1px solid var(--border);
  border-inline-start: 2px solid var(--accent);
  border-radius: var(--radius-sm);
  background: rgb(255 255 255 / 0.03);
}
.bulk-hint-text { margin: 0; flex: 1 1 20rem; min-inline-size: 0; color: var(--text-secondary); font-size: 0.88rem; line-height: 1.7; }
.bulk-hint-text strong { color: var(--accent); font-variant-numeric: tabular-nums; }
.bulk-hint-action { flex: none; min-block-size: 40px; font-size: 0.85rem; }
.bulk-check {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  min-block-size: 44px;
  cursor: pointer;
  font-size: 0.9rem;
}
.bulk-check input { inline-size: 1.05rem; block-size: 1.05rem; accent-color: var(--accent); }
.bulk-list { margin: 0.4rem 0 0; padding: 0; list-style: none; }
.bulk-row {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  padding-block: 0.7rem;
  border-block-end: 1px solid var(--border);
}
.bulk-file { display: grid; flex: 1; gap: 0.15rem; min-inline-size: 0; }
.bulk-name { overflow-wrap: anywhere; color: var(--text); font-size: 0.95rem; font-weight: 600; }
.bulk-meta { color: var(--text-muted); font-size: 0.82rem; }
.bulk-blocked { color: var(--danger); font-size: 0.82rem; overflow-wrap: anywhere; }
.bulk-row.is-blocked .bulk-name { color: var(--text-muted); font-weight: 500; }
.bulk-edit { flex: none; }
.bulk-options {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 0.9rem 1.6rem;
  margin-block: 1.2rem 0;
}
.bulk-field { display: grid; min-inline-size: min(100%, 14rem); gap: 0.38rem; margin-block-start: 1rem; }
.bulk-options .bulk-field { margin-block-start: 0; }
.bulk-field label { font-size: 0.9rem; font-weight: 600; }
.bulk-field textarea { resize: vertical; }
.bulk-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  min-block-size: 44px;
  font-size: 0.9rem;
  cursor: pointer;
}
.bulk-toggle input { inline-size: 1.05rem; block-size: 1.05rem; accent-color: var(--accent); }
.bulk-actions { display: flex; flex-wrap: wrap; gap: 0.65rem; margin-block-start: 1.2rem; }
.bulk-result { margin-block-start: 0.85rem; color: var(--accent); font-size: 0.9rem; overflow-wrap: anywhere; }
.bulk-error { margin-block-start: 0.85rem; color: var(--danger); font-size: 0.9rem; overflow-wrap: anywhere; }
@media (max-width: 33rem) {
  .bulk-row { flex-wrap: wrap; }
  .bulk-edit { margin-inline-start: 1.6rem; }
}
</style>
