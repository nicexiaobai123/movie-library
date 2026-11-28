<script setup lang="ts">
import type { AdminMedia, AdminTitle } from '#shared/types/library'
import AdminMediaEditor from '~/components/admin/AdminMediaEditor.vue'
import AppPager from '~/components/public/AppPager.vue'
import { adminErrorMessage, adminErrorStatus, formatAdminBytes, useAdminApi } from '~/composables/useAdminApi'

// The list is a view over the media folder: one row per MP4, with what it was
// recognised as. There is no pending state and no delete action — removing a file
// from the library means removing it from the folder and scanning again.
const props = defineProps<{
  items: readonly AdminMedia[]
  titles: readonly AdminTitle[]
  loaded: boolean
  loading: boolean
  errorMessage: string
  disabled?: boolean
}>()
const emit = defineEmits<{ refresh: []; saved: [item: AdminMedia]; classified: []; unauthorized: [] }>()

const api = useAdminApi()
const titlesById = computed(() => new Map(props.titles.map(title => [title.id, title])))

// A fixed page of rows keeps the panel the same height whatever the library size.
const pageSize = 7
const query = ref('')
const kindFilter = ref<'all' | 'movie' | 'series'>('all')
const page = ref(1)
const editingId = ref<string | null>(null)
const editorSaving = ref(false)

const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return props.items.filter((item) => {
    if (kindFilter.value !== 'all' && item.kind !== kindFilter.value) return false
    if (!needle) return true
    return item.fileName.toLowerCase().includes(needle)
      || item.title.toLowerCase().includes(needle)
      || item.cast.some(name => name.toLowerCase().includes(needle))
  })
})
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))
const visibleRows = computed(() => {
  const start = (page.value - 1) * pageSize
  return filtered.value.slice(start, start + pageSize)
})
// Follow the edited row to its own page instead of appending an eighth row.
watch([editingId, filtered], () => {
  const id = editingId.value
  if (!id) return
  const index = filtered.value.findIndex(item => item.id === id)
  if (index < 0) return
  const target = Math.floor(index / pageSize) + 1
  if (target !== page.value) page.value = target
})
watch([query, kindFilter], () => { page.value = 1 })
watch(pageCount, total => { if (page.value > total) page.value = total })

function goToPage(next: number) {
  page.value = Math.min(Math.max(1, next), pageCount.value)
}

const counts = computed(() => ({
  all: props.items.length,
  movie: props.items.filter(item => item.kind === 'movie').length,
  series: props.items.filter(item => item.kind === 'series').length,
}))

function posterOf(item: AdminMedia): string | null {
  return item.titleId ? titlesById.value.get(item.titleId)?.posterUrl ?? null : null
}
function monogram(item: AdminMedia): string {
  return Array.from(item.title.trim())[0] ?? '?'
}
function episodeLabel(item: AdminMedia): string {
  if (item.kind !== 'series' || item.episode === null) return ''
  return `第 ${item.season ?? 1} 季 · 第 ${item.episode} 集`
}

const heading = ref<HTMLElement | null>(null)

// --- Batch classification ---------------------------------------------------
// A filename can only guess the kind, so the list needs a way to override it for
// several files at once: select rows, then say "these are films" or "these are
// episodes of this series".
const selected = ref<Set<string>>(new Set())
const batchKind = ref<'movie' | 'series'>('movie')
const batchTitle = ref('')
const batchTarget = ref('')
const batchSeason = ref<number | ''>('')
const batchBusy = ref(false)
const batchMessage = ref('')
const batchError = ref('')

const selectedItems = computed(() => props.items.filter(item => selected.value.has(item.id)))
const allOnPageSelected = computed(() =>
  visibleRows.value.length > 0 && visibleRows.value.every(item => selected.value.has(item.id)))
// Only series titles can receive episodes.
const seriesTitles = computed(() => props.titles.filter(title => title.kind === 'series'))

function toggleSelected(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}
function togglePageSelection() {
  const next = new Set(selected.value)
  if (allOnPageSelected.value) for (const item of visibleRows.value) next.delete(item.id)
  else for (const item of visibleRows.value) next.add(item.id)
  selected.value = next
}
function clearSelection() {
  selected.value = new Set()
  batchMessage.value = ''
  batchError.value = ''
}
// A selection must not survive a filter that hides those rows.
watch([query, kindFilter], () => { selected.value = new Set() })
// The default title comes from the selection, which saves retyping it.
watch(selected, () => {
  if (!selected.value.size) return
  batchError.value = ''
  const first = selectedItems.value[0]
  if (first && !batchTitle.value) batchTitle.value = first.title
})

async function applyClassification() {
  if (!selected.value.size || batchBusy.value || props.disabled) return
  if (batchKind.value === 'series' && !batchTarget.value && !batchTitle.value.trim()) {
    batchError.value = '归为剧集时，请填写剧名或选择一个已有剧集。'
    return
  }
  batchBusy.value = true
  batchError.value = ''
  batchMessage.value = ''
  try {
    const result = await api.classify({
      ids: [...selected.value],
      kind: batchKind.value,
      titleId: batchKind.value === 'series' && batchTarget.value ? batchTarget.value : null,
      title: batchKind.value === 'series' && !batchTarget.value ? batchTitle.value.trim() : null,
      season: batchKind.value === 'series' && batchSeason.value !== '' ? Number(batchSeason.value) : null,
    })
    batchMessage.value = result.skipped.length
      ? `已更新 ${result.items.length} 个，${result.skipped.length} 个未处理。`
      : `已更新 ${result.items.length} 个文件。`
    selected.value = new Set()
    batchTitle.value = ''
    emit('classified')
  } catch (error) {
    if (adminErrorStatus(error) === 401) {
      emit('unauthorized')
      return
    }
    batchError.value = adminErrorMessage(error, '批量分类失败，请重试。')
  } finally {
    batchBusy.value = false
  }
}function editTriggerId(id: string) {
  return `admin-edit-trigger-${id}`
}
async function closeEditor(restore: 'trigger' | 'heading' = 'trigger') {
  const previous = editingId.value
  editingId.value = null
  editorSaving.value = false
  await nextTick()
  const trigger = previous && restore === 'trigger' ? document.getElementById(editTriggerId(previous)) : null
  ;(trigger ?? heading.value)?.focus()
}
function toggleEditor(id: string) {
  if (props.disabled || editorSaving.value) return
  if (editingId.value === id) void closeEditor()
  else editingId.value = id
}
function onSaved(item: AdminMedia) {
  void closeEditor()
  emit('saved', item)
}
watch(() => props.items, (items) => {
  if (editingId.value && !items.some(item => item.id === editingId.value)) void closeEditor('heading')
})
</script>

<template>
  <section class="files-panel" aria-label="媒体库">
    <h2 id="admin-files-title" ref="heading" class="visually-hidden" tabindex="-1">媒体库</h2>

    <header class="files-heading">
      <p class="files-summary" data-test="admin-files-summary">
        共 {{ counts.all }} 个文件 · 电影 {{ counts.movie }} · 剧集 {{ counts.series }}
      </p>
      <div class="files-heading-actions">
        <label v-if="loaded && visibleRows.length" class="files-select-all">
          <input
            type="checkbox"
            :checked="allOnPageSelected"
            :disabled="disabled || batchBusy"
            data-test="admin-select-page"
            @change="togglePageSelection"
          >
          <span>全选本页</span>
        </label>
        <button class="btn" type="button" :disabled="loading || disabled" data-test="admin-library-refresh" @click="emit('refresh')">
          {{ loading ? '正在读取…' : '刷新' }}
        </button>
      </div>
    </header>

    <div class="files-filters" role="group" aria-label="按类型筛选">
      <button
        v-for="option in [
          { value: 'all', label: '全部', count: counts.all },
          { value: 'movie', label: '电影', count: counts.movie },
          { value: 'series', label: '剧集', count: counts.series },
        ]"
        :key="option.value"
        class="btn filter-button"
        type="button"
        :aria-pressed="kindFilter === option.value"
        :disabled="disabled"
        :data-test="`admin-filter-${option.value}`"
        @click="kindFilter = option.value as typeof kindFilter"
      >
        {{ option.label }} <span class="filter-count">{{ option.count }}</span>
      </button>
    </div>

    <p v-if="errorMessage" class="files-error" role="alert">{{ errorMessage }}</p>

    <div id="admin-files-content">
      <div class="files-search">
        <label for="admin-files-query" class="visually-hidden">搜索</label>
        <input
          id="admin-files-query"
          v-model="query"
          class="field"
          type="search"
          autocomplete="off"
          placeholder="按片名、文件名或演员搜索…"
          data-test="admin-files-query"
        >
      </div>

      <p v-if="!loaded" class="files-empty" role="status">正在读取媒体库…</p>      <p v-else-if="!visibleRows.length" class="files-empty" role="status" data-test="admin-library-empty">
        {{ items.length ? '没有匹配的文件。' : '媒体目录里还没有视频。上传 MP4，或扫描媒体目录。' }}
      </p>
      <ul v-else class="file-list" role="list" aria-label="视频文件">
        <li v-for="item in visibleRows" :key="item.id" class="file-row" :class="{ 'is-selected': selected.has(item.id) }" :data-media-id="item.id" data-test="admin-media-row">
          <div class="file-summary">
            <input
              type="checkbox"
              class="file-select"
              :checked="selected.has(item.id)"
              :disabled="disabled || batchBusy"
              :aria-label="`选择 ${item.title}`"
              :data-test="`admin-media-check-${item.id}`"
              @change="toggleSelected(item.id)"
            >
            <span class="file-thumb" :class="{ 'file-thumb--empty': !posterOf(item) }" aria-hidden="true">
              <img v-if="posterOf(item)" :src="posterOf(item) ?? ''" alt="" loading="lazy" decoding="async">
              <template v-else>{{ monogram(item) }}</template>
            </span>
            <div class="file-copy">
              <div class="file-head">
                <span class="file-kind" :class="item.kind === 'series' ? 'file-kind--series' : 'file-kind--movie'">
                  {{ item.kind === 'series' ? '剧集' : '电影' }}
                </span>
                <h3 class="file-name" :title="item.title" data-test="admin-media-title">{{ item.title }}</h3>
                <span v-if="episodeLabel(item)" class="file-episode">{{ episodeLabel(item) }}</span>
              </div>
              <div class="file-meta">
                <span v-if="item.year">{{ item.year }}</span>
                <span v-if="item.cast.length" class="file-cast">{{ item.cast.join('、') }}</span>
                <span>{{ formatAdminBytes(item.size) }}</span>
                <span class="file-path" :title="item.relativePath">{{ item.fileName }}</span>
              </div>
            </div>
            <button
              :id="editTriggerId(item.id)"
              class="btn file-edit"
              type="button"
              :aria-label="`${editingId === item.id ? '关闭编辑' : '编辑'}：${item.title}`"
              :aria-expanded="editingId === item.id"
              :disabled="disabled || editorSaving"
              data-test="admin-media-edit"
              @click="toggleEditor(item.id)"
            >
              {{ editingId === item.id ? '关闭' : '编辑' }}
            </button>
          </div>
          <AdminMediaEditor
            v-if="editingId === item.id"
            :item="item"
            :disabled="disabled"
            @cancel="closeEditor()"
            @saving="editorSaving = $event"
            @saved="onSaved"
            @unauthorized="emit('unauthorized')"
          />
        </li>
      </ul>

      <!-- Batch classification: a filename can only guess, so several rows can be
           corrected at once instead of opening each editor. -->
      <div v-if="selected.size" class="batch-bar" data-test="admin-batch-bar">
        <p class="batch-head">
          已选 <strong>{{ selected.size }}</strong> 个文件
          <button class="batch-clear" type="button" :disabled="batchBusy" data-test="admin-batch-clear" @click="clearSelection">清空选择</button>
        </p>
        <div class="batch-fields">
          <label class="batch-field">
            <span>归类为</span>
            <select v-model="batchKind" class="field" :disabled="batchBusy || disabled" data-test="admin-batch-kind">
              <option value="movie">电影</option>
              <option value="series">剧集</option>
            </select>
          </label>
          <template v-if="batchKind === 'series'">
            <label class="batch-field batch-field--wide">
              <span>并入已有剧集</span>
              <select v-model="batchTarget" class="field" :disabled="batchBusy || disabled" data-test="admin-batch-target">
                <option value="">新建剧集…</option>
                <option v-for="title in seriesTitles" :key="title.id" :value="title.id">{{ title.title }}</option>
              </select>
            </label>
            <label v-if="!batchTarget" class="batch-field batch-field--wide">
              <span>新剧集名称</span>
              <input v-model="batchTitle" class="field" type="text" maxlength="200" :disabled="batchBusy || disabled" data-test="admin-batch-title">
            </label>
            <label class="batch-field batch-field--narrow">
              <span>季</span>
              <input v-model.number="batchSeason" class="field" type="number" min="0" max="999" :disabled="batchBusy || disabled" data-test="admin-batch-season">
            </label>
          </template>
          <button class="btn btn--primary batch-apply" type="button" :disabled="batchBusy || disabled" data-test="admin-batch-apply" @click="applyClassification">
            {{ batchBusy ? '正在处理…' : `应用到 ${selected.size} 个` }}
          </button>
        </div>
        <p v-if="batchError" class="batch-error" role="alert" data-test="admin-batch-error">{{ batchError }}</p>
      </div>

      <!-- The result outlives the selection: applying clears it, so the message
           cannot live inside the block that disappears with it. -->
      <p v-if="batchMessage" class="batch-result" role="status" data-test="admin-batch-message">{{ batchMessage }}</p>

      <!-- The same pager component as the catalogue, so both lists walk identically. -->
      <AppPager
        class="files-pager"
        :page="page"
        :page-count="pageCount"
        :summary="`共 ${filtered.length} 个文件`"
        test-prefix="admin-files"
        :disabled="disabled || batchBusy"
        variant="inset"
        @go="goToPage"
      />
    </div>
  </section>
</template>

<style scoped>
.files-panel { min-width: 0; display: flex; flex-direction: column; }
.files-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 2rem;
}
.files-summary {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}
.files-heading-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem 1rem; }
.files-select-all {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
  cursor: pointer;
}
.files-select-all input { inline-size: 1rem; block-size: 1rem; accent-color: var(--accent); }

/* Batch classification strip, shown only while rows are selected. */
.batch-bar {
  display: grid;
  gap: 0.55rem;
  padding: 0.7rem 0.8rem;
  border-block-start: 1px solid var(--border);
  background: var(--accent-soft);
}
.batch-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.9rem;
  margin: 0;
  font-size: 0.85rem;
  color: var(--text-secondary);
}
.batch-head strong { color: var(--accent); font-variant-numeric: tabular-nums; }
.batch-clear {
  min-block-size: 28px;
  padding: 0 0.45rem;
  border: 0;
  background: transparent;
  color: var(--accent);
  font-size: 0.78rem;
  text-decoration: underline;
  text-underline-offset: 0.16em;
}
.batch-fields {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 0.55rem 0.9rem;
}
.batch-field { display: grid; gap: 0.25rem; font-size: 0.78rem; color: var(--text-muted); }
.batch-field > span { white-space: nowrap; }
.batch-field .field { min-block-size: 34px; font-size: 0.84rem; }
.batch-field--narrow { inline-size: 5rem; }
.batch-field--wide { flex: 1 1 12rem; min-inline-size: 0; }
.batch-apply { margin-inline-start: auto; }
.batch-message { margin: 0; color: var(--accent); font-size: 0.8rem; }
.batch-result {
  margin: 0;
  padding: 0.5rem 0.8rem;
  border-block-start: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--accent);
  font-size: 0.82rem;
  overflow-wrap: anywhere;
}
.batch-error { margin: 0; color: var(--color-danger, var(--accent-strong)); font-size: 0.8rem; overflow-wrap: anywhere; }
.files-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0 1.7rem;
  margin-block: 1.1rem 0;
  padding-block-end: 0.9rem;
  border-block-end: 1px solid var(--border);
}
.filter-button {
  min-width: 44px;
  min-height: 44px;
  margin-block-end: -1px;
  padding: 0.65rem 0;
  border: 0;
  border-block-end: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  color: var(--text-muted);
}
.filter-button[aria-pressed='true'] {
  border-block-end-color: var(--accent);
  background: transparent;
  color: var(--text);
}
.filter-count { color: var(--text-muted); font-size: 0.85em; font-variant-numeric: tabular-nums; }
.filter-button[aria-pressed='true'] .filter-count { color: var(--accent); }
.files-error { margin-block-start: 1rem; padding-inline-start: 0.8rem; border-inline-start: 2px solid var(--color-danger, var(--accent-strong)); color: var(--color-danger, var(--accent-strong)); overflow-wrap: anywhere; }
.files-empty { margin: 0; padding: 1.6rem 0.9rem; color: var(--text-muted); font-size: 0.9rem; }

/* The list is sized by one page of rows: seven of them, whatever the library size. */
#admin-files-content {
  display: flex;
  flex-direction: column;
  margin-block-start: 1.35rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  overflow: hidden;
}
#admin-files-content .files-search { margin: 0; padding: 0.55rem 0.7rem; border-block-end: 1px solid var(--border); }
#admin-files-content .files-search input { inline-size: 100%; }
#admin-files-content .file-list { margin: 0; padding: 0 0.7rem; list-style: none; }
#admin-files-content .files-pager { padding: 0.6rem 0.7rem; border-block-start: 1px solid var(--border); background: var(--bg-elevated); }

.file-row { border-block-end: 1px solid var(--border); }
.file-row:last-child { border-block-end: 0; }
.file-row:hover { background: var(--bg-hover); }
.file-row.is-selected { background: var(--accent-soft); }
.file-summary {
  display: grid;
  /* Select | poster | text | action. */
  grid-template-columns: auto 2.6rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.75rem 1rem;
  min-block-size: 4.4rem;
  padding-block: 0.55rem;
}
.file-select { inline-size: 1rem; block-size: 1rem; accent-color: var(--accent); }
.file-thumb {
  display: grid;
  place-items: center;
  inline-size: 2.6rem;
  block-size: 3.4rem;
  border-radius: var(--radius-sm);
  background: linear-gradient(160deg, var(--bg-hover), var(--bg-card));
  color: var(--text-muted);
  font-size: 1rem;
  font-weight: 600;
  overflow: hidden;
}
.file-thumb img { inline-size: 100%; block-size: 100%; object-fit: cover; }
.file-thumb--empty { border: 1px solid var(--border); }
.file-copy { min-inline-size: 0; }
.file-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; min-inline-size: 0; }
/* The kind badge is the primary cue for "is this a film or a series?". */
.file-kind {
  flex: none;
  padding: 0.02rem 0.4rem;
  border-radius: var(--radius-pill);
  font-size: 0.72rem;
  font-weight: 600;
}
.file-kind--series { background: var(--accent-soft); color: var(--accent); }
.file-kind--movie { background: var(--bg-hover); color: var(--text-secondary); }
.file-name {
  min-inline-size: 0;
  max-inline-size: 100%;
  margin: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 0.95rem;
  font-weight: 600;
}
.file-episode { flex: none; color: var(--accent); font-size: 0.8rem; font-variant-numeric: tabular-nums; }
.file-meta {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.3rem 0.7rem;
  margin-block-start: 0.1rem;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 0.78rem;
  white-space: nowrap;
}
.file-cast { color: var(--text-secondary); }
.file-path { overflow: hidden; text-overflow: ellipsis; opacity: 0.7; }
.file-edit { flex: none; min-width: 4.2rem; }
/* The pager itself is the shared component; the panel only gives it its frame. */
.files-pager { padding: 0.6rem 0.7rem; border-block-start: 1px solid var(--border); background: var(--bg-elevated); }
@media (max-width: 33rem) {
  .file-summary { grid-template-columns: auto minmax(0, 1fr); }
  .file-edit,
  .file-select { grid-row: 1; }
  .file-edit { grid-column: 1 / -1; justify-self: start; }
  .file-thumb { inline-size: 2.2rem; block-size: 3rem; }
  .batch-apply { margin-inline-start: 0; }
}
</style>
