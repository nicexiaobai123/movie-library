<script setup lang="ts">
import type { AdminMedia, LibraryKind, MediaEdit } from '#shared/types/library'
import { adminErrorMessage, adminErrorStatus, useAdminApi } from '~/composables/useAdminApi'
import { adminTransferWasCancelled, startAdminFileTransfer, type AdminFileTransfer } from '~/composables/useAdminUpload'

// Only the fields the library actually uses: what it is called, when it came out,
// its cover, who is in it, how long it runs, and whether it is a film or an episode.
const props = defineProps<{
  item: AdminMedia
  disabled?: boolean
}>()
const emit = defineEmits<{
  cancel: []
  saving: [busy: boolean]
  saved: [item: AdminMedia]
  unauthorized: []
}>()

const api = useAdminApi()
const form = ref<HTMLFormElement | null>(null)
const heading = ref<HTMLElement | null>(null)
const posterInput = ref<HTMLInputElement | null>(null)
const saving = ref(false)
const posterUploading = ref(false)
const errorMessage = ref('')
const posterStatus = ref('')
const posterError = ref('')

const draft = reactive<{
  kind: LibraryKind
  title: string
  year: number | ''
  description: string
  posterPath: string
  runtime: number | ''
  castText: string
  season: number | ''
  episode: number | ''
}>({
  kind: props.item.kind,
  title: props.item.title,
  year: props.item.year ?? '',
  description: '',
  posterPath: '',
  runtime: '',
  castText: props.item.cast.join('、'),
  season: props.item.season ?? '',
  episode: props.item.episode ?? '',
})

// The title record carries the description, cover and runtime, so it is loaded once
// for the row being edited rather than being repeated on every list row.
const titleRecord = ref<{ description: string; posterPath: string | null; runtime: number | null } | null>(null)
onMounted(async () => {
  try {
    const library = await api.library()
    const title = props.item.titleId ? library.titles.find(candidate => candidate.id === props.item.titleId) : null
    if (title) {
      titleRecord.value = { description: title.description, posterPath: title.posterPath, runtime: title.runtime }
      draft.description = title.description
      draft.posterPath = title.posterPath ?? ''
      draft.runtime = title.runtime ?? ''
    }
  } catch {
    // A failed lookup only means the optional fields start blank.
  }
  await nextTick()
  heading.value?.focus()
})

function splitList(value: string): string[] {
  return [...new Set(value.split(/[、,，;；]+/).map(item => item.trim()).filter(Boolean))].slice(0, 20)
}

// Escape closes the dialog; the listener is on the dialog so it never steals keys
// from the rest of the page.
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !saving.value) {
    event.stopPropagation()
    emit('cancel')
  }
}

let posterTransfer: AdminFileTransfer<{ path: string }> | null = null

async function pickPoster(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || props.disabled) return
  posterTransfer?.cancel()
  posterError.value = ''
  posterUploading.value = true
  const current = startAdminFileTransfer<{ path: string }>(
    '/api/admin/posters',
    file,
    { contentType: file.type || 'image/jpeg' },
  )
  posterTransfer = current
  try {
    const { path } = await current.promise
    draft.posterPath = path
    posterStatus.value = '封面已上传，保存后生效。'
  } catch (error) {
    if (adminTransferWasCancelled(error)) posterStatus.value = '已取消上传。'
    else if (adminErrorStatus(error) === 401) emit('unauthorized')
    else posterError.value = adminErrorMessage(error, '封面上传失败，请重试。')
  } finally {
    if (posterTransfer === current) {
      posterTransfer = null
      posterUploading.value = false
    }
  }
}

async function save() {
  if (props.disabled || saving.value) return
  const title = draft.title.trim()
  if (!title) {
    errorMessage.value = '请填写片名。'
    return
  }
  if (draft.kind === 'series' && (draft.season === '' || draft.episode === '')) {
    errorMessage.value = '剧集需要季号和集号。'
    return
  }
  saving.value = true
  errorMessage.value = ''
  emit('saving', true)
  const body: MediaEdit = {
    title,
    year: draft.year === '' ? null : Number(draft.year),
    description: draft.description.trim(),
    posterPath: draft.posterPath || null,
    runtime: draft.runtime === '' ? null : Number(draft.runtime),
    cast: splitList(draft.castText),
    kind: draft.kind,
    season: draft.kind === 'series' && draft.season !== '' ? Number(draft.season) : null,
    episode: draft.kind === 'series' && draft.episode !== '' ? Number(draft.episode) : null,
  }
  try {
    const { item } = await api.editMedia(props.item.id, body)
    emit('saved', item)
  } catch (error) {
    if (adminErrorStatus(error) === 401) emit('unauthorized')
    else errorMessage.value = adminErrorMessage(error, '保存失败，请重试。')
  } finally {
    saving.value = false
    emit('saving', false)
  }
}
</script>

<template>
  <div class="editor-modal" data-test="admin-media-modal">
    <div class="editor-scrim" aria-hidden="true" @click="emit('cancel')" />
    <section
      class="media-editor"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-media-editor-title"
      data-test="admin-media-editor"
      @keydown="onKeydown"
    >
      <header class="editor-modal-head">
        <div>
          <h2 id="admin-media-editor-title" ref="heading" tabindex="-1">编辑条目</h2>
          <p class="editor-modal-file">{{ item.fileName }}</p>
        </div>
        <button class="btn" type="button" :disabled="saving" data-test="admin-media-close" @click="emit('cancel')">关闭</button>
      </header>

      <form ref="form" @submit.prevent="save">
        <div class="editor-fields">
          <div class="editor-row">
            <label class="editor-field">
              <span>片名</span>
              <input v-model="draft.title" class="field" type="text" required maxlength="200" data-test="admin-media-title">
            </label>
            <label class="editor-field editor-field--narrow">
              <span>年份</span>
              <input v-model.number="draft.year" class="field" type="number" min="1800" max="2300" data-test="admin-media-year">
            </label>
          </div>

          <div class="editor-row">
            <label class="editor-field">
              <span>类型</span>
              <select v-model="draft.kind" class="field" data-test="admin-media-kind">
                <option value="movie">电影</option>
                <option value="series">剧集</option>
              </select>
            </label>
            <template v-if="draft.kind === 'series'">
              <label class="editor-field editor-field--narrow">
                <span>季</span>
                <input v-model.number="draft.season" class="field" type="number" min="0" max="999" data-test="admin-media-season">
              </label>
              <label class="editor-field editor-field--narrow">
                <span>集</span>
                <input v-model.number="draft.episode" class="field" type="number" min="1" max="9999" data-test="admin-media-episode">
              </label>
            </template>
            <label class="editor-field editor-field--narrow">
              <span>片长（分钟）</span>
              <input v-model.number="draft.runtime" class="field" type="number" min="0" max="1440" data-test="admin-media-runtime">
            </label>
          </div>

          <label class="editor-field">
            <span>演员（用「、」分隔）</span>
            <input v-model="draft.castText" class="field" type="text" maxlength="400" data-test="admin-media-cast">
          </label>

          <label class="editor-field">
            <span>简介</span>
            <textarea v-model="draft.description" class="field" rows="4" maxlength="6000" data-test="admin-media-description" />
          </label>

          <div class="editor-field">
            <span>封面</span>
            <div class="editor-poster">
              <span class="editor-poster-preview" :class="{ 'is-empty': !draft.posterPath }">
                <img v-if="draft.posterPath" :src="`/api/posters/${item.titleId}`" alt="" data-test="admin-poster-preview">
                <template v-else>无封面</template>
              </span>
              <div class="editor-poster-actions">
                <input ref="posterInput" class="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" data-test="admin-media-poster-file" @change="pickPoster">
                <button class="btn" type="button" :disabled="posterUploading || disabled" data-test="admin-poster-upload" @click="posterInput?.click()">
                  {{ posterUploading ? '正在上传…' : '上传封面' }}
                </button>
                <p class="editor-poster-hint">不填则使用视频第一帧。</p>
              </div>
            </div>
            <p v-if="posterStatus" class="editor-status" role="status" data-test="admin-poster-status">{{ posterStatus }}</p>
            <p v-if="posterError" class="editor-error" role="alert">{{ posterError }}</p>
          </div>

          <p v-if="errorMessage" class="editor-error" role="alert" data-test="admin-media-error">{{ errorMessage }}</p>
        </div>

        <div class="editor-footer">
          <div class="editor-actions">
            <button class="btn btn--primary" type="submit" :disabled="saving || posterUploading" data-test="admin-media-save">
              {{ saving ? '正在保存…' : '保存' }}
            </button>
            <button class="btn" type="button" :disabled="saving" data-test="admin-media-cancel" @click="emit('cancel')">取消</button>
          </div>
        </div>
      </form>
    </section>
  </div>
</template>

<style scoped>
.editor-modal {
  position: fixed;
  z-index: 60;
  inset: 0;
  display: grid;
  place-items: center;
  padding: clamp(0.75rem, 3vw, 2.5rem);
}
.editor-scrim {
  position: absolute;
  inset: 0;
  background: rgb(4 5 7 / 0.72);
  backdrop-filter: blur(2px);
}
.media-editor {
  position: relative;
  display: flex;
  flex-direction: column;
  inline-size: min(100%, 44rem);
  max-block-size: min(90vh, 90svh);
  overflow: hidden;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-player);
}
.media-editor form { display: flex; flex-direction: column; flex: 1 1 auto; min-block-size: 0; overflow: hidden; }
.editor-modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem clamp(1.1rem, 2.5vw, 1.8rem);
  border-block-end: 1px solid var(--border);
}
.editor-modal-head h2 { font-family: var(--font-display); font-size: 1.15rem; font-weight: 600; }
.editor-modal-file { margin: 0.25rem 0 0; color: var(--text-muted); font-size: 0.8rem; overflow-wrap: anywhere; }
.editor-fields {
  display: grid;
  gap: 0.85rem;
  flex: 1 1 auto;
  min-block-size: 0;
  overflow-y: auto;
  padding: clamp(1rem, 2.5vw, 1.4rem) clamp(1.1rem, 2.5vw, 1.8rem);
}
.editor-row { display: flex; flex-wrap: wrap; gap: 0.85rem; }
.editor-field { display: grid; gap: 0.35rem; flex: 1 1 12rem; min-inline-size: 0; font-size: 0.85rem; }
.editor-field > span { color: var(--text-secondary); font-weight: 600; }
.editor-field--narrow { flex: 0 1 7rem; }
.editor-field input, .editor-field select, .editor-field textarea { inline-size: 100%; }
.editor-field textarea { resize: vertical; }
.editor-poster { display: flex; gap: 0.9rem; align-items: flex-start; }
.editor-poster-preview {
  display: grid;
  place-items: center;
  inline-size: 5rem;
  block-size: 6.6rem;
  flex: none;
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-muted);
  font-size: 0.75rem;
  overflow: hidden;
}
.editor-poster-preview.is-empty { border: 1px dashed var(--border-strong); }
.editor-poster-preview img { inline-size: 100%; block-size: 100%; object-fit: cover; }
.editor-poster-actions { display: grid; gap: 0.4rem; align-content: start; }
.editor-poster-hint { margin: 0; color: var(--text-muted); font-size: 0.78rem; }
.editor-status { margin: 0.3rem 0 0; color: var(--accent); font-size: 0.8rem; }
.editor-error { margin: 0; color: var(--color-danger, var(--accent-strong)); font-size: 0.82rem; overflow-wrap: anywhere; }
.editor-footer {
  flex: none;
  padding: 0.85rem clamp(1.1rem, 2.5vw, 1.8rem);
  border-block-start: 1px solid var(--border);
  background: var(--bg-elevated);
}
.editor-actions { display: flex; gap: 0.6rem; }
</style>
