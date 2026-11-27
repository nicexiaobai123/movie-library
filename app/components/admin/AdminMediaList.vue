<script setup lang="ts">
import type { AdminMedia, AdminTitle } from '#shared/types/library'
import AdminMediaEditor from '~/components/admin/AdminMediaEditor.vue'
import { formatAdminBytes } from '~/composables/useAdminApi'

const props = defineProps<{
  items: readonly AdminMedia[]
  titles: readonly AdminTitle[]
  loaded: boolean
  loading: boolean
  errorMessage: string
  disabled?: boolean
}>()
const emit = defineEmits<{ refresh: []; saved: [item: AdminMedia]; unauthorized: [] }>()

const filters = [
  { value: 'pending', label: '待整理' },
  { value: 'all', label: '全部' },
  { value: 'missing', label: '缺失' },
] as const
type Filter = typeof filters[number]['value']

const filter = ref<Filter>('pending')
const editingId = ref<string | null>(null)
const editorSaving = ref(false)
const heading = ref<HTMLElement | null>(null)
const counts = computed(() => {
  let pending = 0
  let missing = 0
  for (const item of props.items) {
    if (item.state === 'pending') pending++
    if (!item.available) missing++
  }
  return { pending, all: props.items.length, missing }
})
const titlesById = computed(() => new Map(props.titles.map(title => [title.id, title])))

function matchesFilter(item: AdminMedia, current: Filter) {
  return current === 'all' || (current === 'pending' ? item.state === 'pending' : !item.available)
}

function linkedTitle(item: AdminMedia) {
  const title = item.titleId ? titlesById.value.get(item.titleId) : null
  if (!title) return ''
  if (title.kind !== 'series' || item.season === null || item.episode === null) return title.title
  return `${title.title} · 第 ${item.season} 季 / 第 ${item.episode} 集${item.episodeTitle ? ` · ${item.episodeTitle}` : ''}`
}

// The runtime is detected from the file header, so it is shown next to the size.
function linkedRuntime(item: AdminMedia): string {
  const title = item.titleId ? titlesById.value.get(item.titleId) : null
  return title?.runtime ? `${title.runtime} 分钟` : ''
}

const rows = computed(() => props.items
  .filter(item => item.id === editingId.value || matchesFilter(item, filter.value))
  .map(item => ({ item, linked: linkedTitle(item) })))
const pinned = computed(() => rows.value.some(({ item }) => !matchesFilter(item, filter.value)))

// A large library cannot render hundreds of rows at once, so the list is filtered
// by name and split into numbered pages like a normal media library admin.
const pageSize = 40
const query = ref('')
const page = ref(1)

const searched = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return rows.value
  return rows.value.filter(({ item, linked }) =>
    item.id === editingId.value
    || item.fileName.toLowerCase().includes(needle)
    || item.relativePath.toLowerCase().includes(needle)
    || linked.toLowerCase().includes(needle))
})
const pageCount = computed(() => Math.max(1, Math.ceil(searched.value.length / pageSize)))
const visibleRows = computed(() => {
  const list = searched.value
  const start = (page.value - 1) * pageSize
  const slice = list.slice(start, start + pageSize)
  // The row being edited must stay reachable even if it sits on another page.
  const editing = list.find(({ item }) => item.id === editingId.value)
  return editing && !slice.some(({ item }) => item.id === editingId.value) ? [...slice, editing] : slice
})

// Page numbers with the first/last always visible and a short window around the
// current one, so a hundred pages do not produce a hundred buttons.
const pages = computed<(number | 'gap')[]>(() => {
  const total = pageCount.value
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1)
  const set = new Set([1, total, page.value, page.value - 1, page.value + 1])
  const numbers = [...set].filter(value => value >= 1 && value <= total).sort((a, b) => a - b)
  const result: (number | 'gap')[] = []
  let previous = 0
  for (const value of numbers) {
    if (previous && value - previous > 1) result.push('gap')
    result.push(value)
    previous = value
  }
  return result
})

function goToPage(next: number) {
  page.value = Math.min(Math.max(1, next), pageCount.value)
}
watch([filter, query], () => { page.value = 1 })
// A shrinking list must not leave the view on a page that no longer exists.
watch(pageCount, total => { if (page.value > total) page.value = total })
const emptyMessage = computed(() => {
  if (counts.value.all === 0) return '片库还没有视频。可上传 MP4，或扫描磁盘中的媒体目录。'
  if (filter.value === 'pending') return '没有待整理的文件，可在「全部」中编辑已整理的文件。'
  return '没有缺失或暂不可用的视频文件。'
})

function editTriggerId(id: string) {
  return `admin-edit-trigger-${id}`
}

async function closeEditor(restore: 'trigger' | 'heading' = 'trigger') {
  const previous = editingId.value
  editingId.value = null
  editorSaving.value = false
  await nextTick()
  const trigger = previous && restore === 'trigger' ? document.getElementById(editTriggerId(previous)) : null
  const focusTarget = trigger ?? heading.value
  focusTarget?.focus()
}

function toggleEditor(id: string) {
  if (props.disabled || editorSaving.value) return
  if (editingId.value === id) void closeEditor()
  else editingId.value = id
}

// Lets the bulk panel hand a blocked file straight to the detailed editor.
function focusRow(id: string) {
  filter.value = 'all'
  editingId.value = id
}

defineExpose({ focusRow })

function onSaved(item: AdminMedia) {
  void closeEditor(matchesFilter(item, filter.value) ? 'trigger' : 'heading')
  emit('saved', item)
}

watch(() => props.items, (items) => {
  if (editingId.value && !items.some(item => item.id === editingId.value)) void closeEditor('heading')
})
</script>

<template>
  <section class="files-panel" aria-labelledby="admin-files-title">
    <header class="files-heading">
      <div>
        <h2 id="admin-files-title" ref="heading" tabindex="-1">文件清单</h2>
        <p>整理待处理的视频，或编辑已发布和缺失的条目。</p>
      </div>
      <button class="btn" type="button" :disabled="loading || disabled" data-test="admin-library-refresh" @click="emit('refresh')">
        {{ loading ? '正在刷新…' : '刷新清单' }}
      </button>
    </header>

    <p v-if="errorMessage" class="files-error" role="alert" data-test="admin-library-error">
      {{ errorMessage }}<template v-if="loaded"> 当前仍显示上次读取的清单。</template>
    </p>
    <p v-if="loading && !loaded" class="files-empty" role="status" data-test="admin-library-loading">正在读取文件清单…</p>

    <template v-if="loaded">
      <div class="files-filters" role="group" aria-label="筛选文件">
        <button
          v-for="choice in filters"
          :key="choice.value"
          class="btn filter-button"
          type="button"
          :aria-pressed="filter === choice.value"
          aria-controls="admin-files-content"
          :data-test="`admin-filter-${choice.value}`"
          @click="filter = choice.value"
        >
          {{ choice.label }} <span class="filter-count">{{ counts[choice.value] }}</span>
        </button>
      </div>
      <div id="admin-files-content">
        <p v-if="pinned" class="pinned-note" role="status">当前正在编辑的文件不符合筛选条件，仍会显示到编辑结束。</p>
        <div v-if="counts.all > pageSize" class="files-search">
          <label for="admin-files-query" class="visually-hidden">搜索文件</label>
          <input
            id="admin-files-query"
            v-model="query"
            class="field"
            type="search"
            autocomplete="off"
            placeholder="按片名或文件名搜索…"
            data-test="admin-files-query"
          >
        </div>
        <p v-if="!searched.length" class="files-empty" role="status" data-test="admin-library-empty">{{ query.trim() ? `没有匹配「${query.trim()}」的文件。` : emptyMessage }}</p>
        <ul v-else class="file-list" role="list" aria-label="视频文件">
          <li v-for="{ item, linked } in visibleRows" :key="item.id" class="file-row" :data-media-id="item.id" data-test="admin-media-row">
            <div class="file-summary">
              <div class="file-copy">
                <h3 class="file-name" data-test="admin-media-filename">{{ item.fileName }}</h3>
                <!-- Only show the path when it adds information; for a flat upload
                     it repeats the filename. -->
                <p v-if="item.relativePath !== item.fileName" class="file-path"><span class="visually-hidden">相对路径：</span>{{ item.relativePath }}</p>
                <div class="file-meta">
                  <span class="file-tag" :class="{ 'file-tag--pending': item.state === 'pending' }">
                    {{ item.state === 'pending' ? '待整理' : '已发布' }}
                  </span>
                  <span v-if="!item.available" class="file-tag file-tag--missing">缺失／不可用</span>
                  <span>{{ formatAdminBytes(item.size) }}</span>
                  <span v-if="linkedRuntime(item)" data-test="admin-media-runtime">{{ linkedRuntime(item) }}</span>
                  <span>来源：{{ item.source === 'scan' ? '扫描' : '上传' }}</span>
                </div>
                <p v-if="linked" class="file-linkage">关联：{{ linked }}</p>
                <p v-if="item.reason" class="file-reason" data-test="admin-media-reason"><strong>原因：</strong>{{ item.reason }}</p>
              </div>
              <button
                :id="editTriggerId(item.id)"
                class="btn file-edit"
                type="button"
                :aria-label="`${editingId === item.id ? '关闭编辑' : '编辑'}：${item.fileName}`"
                :aria-expanded="editingId === item.id"
                :aria-controls="editingId === item.id ? 'admin-media-editor' : undefined"
                :disabled="disabled || editorSaving"
                data-test="admin-media-edit"
                @click="toggleEditor(item.id)"
              >
                {{ editingId === item.id ? '关闭编辑' : '编辑' }}
              </button>
            </div>
            <AdminMediaEditor
              v-if="editingId === item.id"
              :item="item"
              :items="items"
              :titles="titles"
              :disabled="disabled"
              @cancel="closeEditor()"
              @saving="editorSaving = $event"
              @saved="onSaved"
              @unauthorized="emit('unauthorized')"
            />
          </li>
        </ul>
        <nav v-if="pageCount > 1" class="files-pager" aria-label="文件清单翻页" data-test="admin-files-pager">
          <p class="pager-info">
            共 {{ searched.length }} 个文件，第 {{ page }} / {{ pageCount }} 页
          </p>
          <div class="pager-controls">
            <button
              class="btn btn--ghost"
              type="button"
              :disabled="page <= 1"
              data-test="admin-files-prev"
              @click="goToPage(page - 1)"
            >上一页</button>
            <template v-for="(entry, index) in pages" :key="`${entry}-${index}`">
              <span v-if="entry === 'gap'" class="pager-gap" aria-hidden="true">…</span>
              <button
                v-else
                class="btn pager-number"
                :class="{ 'is-current': entry === page }"
                type="button"
                :aria-current="entry === page ? 'page' : undefined"
                :data-test="`admin-files-page-${entry}`"
                @click="goToPage(entry)"
              >{{ entry }}</button>
            </template>
            <button
              class="btn btn--ghost"
              type="button"
              :disabled="page >= pageCount"
              data-test="admin-files-next"
              @click="goToPage(page + 1)"
            >下一页</button>
          </div>
        </nav>
      </div>
    </template>
  </section>
</template>

<style scoped>
.files-panel { min-width: 0; }
.files-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1.1rem 2rem;
}
.files-heading h2 {
  font-family: var(--font-display);
  font-size: clamp(1.55rem, 2.5vw, 2rem);
  font-weight: 600;
  line-height: 1.3;
}
.files-heading p,
.files-empty,
.pinned-note {
  color: var(--text-muted);
  font-size: 0.9rem;
  line-height: 1.7;
}
.files-heading p { margin-top: 0.45rem; }
.files-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0 1.7rem;
  margin-block: 1.75rem 0;
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
.files-filters .filter-button:not(:disabled):hover {
  border-block-end-color: var(--accent);
  background: transparent;
  color: var(--text);
}
.filter-count {
  color: var(--text-muted);
  font-size: 0.85em;
  font-variant-numeric: tabular-nums;
}
.filter-button[aria-pressed='true'] .filter-count { color: var(--accent); }
.files-error, .files-empty, .pinned-note { overflow-wrap: anywhere; }
.files-error {
  margin-block-start: 1rem;
  padding-inline-start: 0.8rem;
  border-inline-start: 2px solid var(--color-danger, var(--accent-strong));
  color: var(--color-danger, var(--accent-strong));
}
.files-empty { padding-block: 1.4rem; }
.files-search { margin-block-end: 0.6rem; }
.files-search input { inline-size: 100%; }
.files-more { display: flex; justify-content: center; padding-block: 1.2rem 0; }
/* Numbered pager: the same shape a media library admin normally uses. */
.files-pager { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.7rem 1rem; padding-block: 1.1rem 0; }
.pager-info { margin: 0; color: var(--text-muted); font-size: 0.8rem; font-variant-numeric: tabular-nums; }
.pager-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3rem; }
.pager-controls .btn { min-block-size: 36px; padding-inline: 0.7rem; font-size: 0.82rem; }
.pager-number { min-inline-size: 36px; justify-content: center; color: var(--text-secondary); }
.pager-number.is-current {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}
.pager-gap { padding-inline: 0.2rem; color: var(--text-muted); font-size: 0.82rem; }
.pinned-note { padding-block: 1rem 0; }
.file-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.file-row {
  padding-block: 0.7rem;
  border-block-end: 1px solid var(--border);
}
.file-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.6rem 1.5rem;
}
/* One compact line per file: name, then status and size, so a long list stays
   scannable instead of becoming a column of tall blocks. */
.file-copy { min-inline-size: 0; }
.file-name, .file-path, .file-linkage, .file-reason {
  min-width: 0;
  overflow-wrap: anywhere;
}
.file-name {
  display: inline;
  font-size: 0.95rem;
  font-weight: 600;
  line-height: 1.45;
}
.file-path {
  display: inline;
  margin-inline-start: 0.6rem;
  color: var(--text-muted);
  font-size: 0.8rem;
  font-weight: 400;
}
.file-path:empty { display: none; }
.file-path, .file-linkage, .file-reason {
  margin-top: 0;
  color: var(--text-muted);
  font-size: 0.8rem;
  line-height: 1.55;
}
.file-linkage { display: inline; margin-inline-start: 0.6rem; }
.file-reason { display: block; margin-top: 0.3rem; white-space: pre-wrap; }
.file-reason strong { color: var(--text-secondary); }
.file-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.9rem;
  margin-top: 0.25rem;
  color: var(--text-muted);
  font-size: 0.78rem;
}
.file-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--text-secondary);
  font-weight: 600;
}
.file-tag::before {
  flex: none;
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 50%;
  background: var(--text-muted);
  content: '';
}
.file-tag--pending { color: var(--accent); }
.file-tag--pending::before { background: var(--accent); }
.file-tag--missing { color: var(--color-danger, var(--accent-strong)); }
.file-tag--missing::before { background: var(--color-danger, var(--accent-strong)); }
.file-edit { min-width: 4.8rem; }
@media (max-width: 33rem) {
  .file-summary { grid-template-columns: minmax(0, 1fr); }
  .file-edit { justify-self: start; }
}
</style>
