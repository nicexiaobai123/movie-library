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

const rows = computed(() => props.items
  .filter(item => item.id === editingId.value || matchesFilter(item, filter.value))
  .map(item => ({ item, linked: linkedTitle(item) })))
const pinned = computed(() => rows.value.some(({ item }) => !matchesFilter(item, filter.value)))
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
        <p v-if="!rows.length" class="files-empty" role="status" data-test="admin-library-empty">{{ emptyMessage }}</p>
        <ul v-else class="file-list" role="list" aria-label="视频文件">
          <li v-for="{ item, linked } in rows" :key="item.id" class="file-row" :data-media-id="item.id" data-test="admin-media-row">
            <div class="file-summary">
              <div class="file-copy">
                <h3 class="file-name" data-test="admin-media-filename">{{ item.fileName }}</h3>
                <p class="file-path"><span class="visually-hidden">相对路径：</span>{{ item.relativePath }}</p>
                <div class="file-meta">
                  <span class="file-tag" :class="{ 'file-tag--pending': item.state === 'pending' }">
                    {{ item.state === 'pending' ? '待整理' : '已发布' }}
                  </span>
                  <span v-if="!item.available" class="file-tag file-tag--missing">缺失／不可用</span>
                  <span>{{ formatAdminBytes(item.size) }}</span>
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
.pinned-note { padding-block: 1rem 0; }
.file-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.file-row {
  padding-block: 1.35rem;
  border-block-end: 1px solid var(--border);
}
.file-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 0.9rem 2rem;
}
.file-name, .file-path, .file-linkage, .file-reason {
  min-width: 0;
  overflow-wrap: anywhere;
}
.file-name {
  font-size: 1rem;
  font-weight: 650;
  line-height: 1.55;
}
.file-path, .file-linkage, .file-reason {
  margin-top: 0.35rem;
  color: var(--text-muted);
  font-size: 0.86rem;
  line-height: 1.65;
}
.file-reason { white-space: pre-wrap; }
.file-reason strong { color: var(--text-secondary); }
.file-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem 1.15rem;
  margin-top: 0.75rem;
  color: var(--text-muted);
  font-size: 0.82rem;
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
