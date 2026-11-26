<script setup lang="ts">
import type { AdminMedia, AdminTitle, LibraryKind, MediaEdit } from '#shared/types/library'
import { adminErrorCode, adminErrorMessage, adminErrorStatus, useAdminApi } from '~/composables/useAdminApi'
import { adminTransferWasCancelled, startAdminFileTransfer, type AdminFileTransfer } from '~/composables/useAdminUpload'

const props = defineProps<{
  item: AdminMedia
  items: readonly AdminMedia[]
  titles: readonly AdminTitle[]
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
const conflictHeading = ref<HTMLElement | null>(null)
const posterInput = ref<HTMLInputElement | null>(null)
const initialTitle = props.titles.find(title => title.id === props.item.titleId)
const orderedTitles = computed(() => [...props.titles].sort((a, b) => a.title.localeCompare(b.title, 'zh-CN') || (a.year ?? 0) - (b.year ?? 0)))

// Free-text fields accept 、, ， or , as separators so typing is forgiving.
function splitList(value: string): string[] {
  return [...new Set(value.split(/[、,，;；]+/).map(item => item.trim()).filter(Boolean))].slice(0, 20)
}

function titleFields(title?: AdminTitle) {
  const suggestion = props.item.suggestion
  const inferredKind = suggestion.kind ?? (props.item.season !== null || props.item.episode !== null || suggestion.episode !== null ? 'series' : 'movie')
  return {
    kind: title?.kind ?? inferredKind,
    title: title?.title ?? suggestion.title ?? '',
    year: (title ? title.year : suggestion.year) ?? '' as const,
    description: title?.description ?? '',
    posterPath: title?.posterPath ?? '',
    originalTitle: title?.originalTitle ?? '',
    genresText: (title?.genres ?? []).join('、'),
    region: title?.region ?? '',
    rating: (title?.rating ?? '') as OptionalNumber,
    runtime: (title?.runtime ?? '') as OptionalNumber,
    director: title?.director ?? '',
    castText: (title?.cast ?? []).join('、'),
    backdropPath: title?.backdropPath ?? '',
  }
}

type OptionalNumber = number | ''
const draft = reactive<{
  titleId: string
  kind: LibraryKind
  title: string
  year: OptionalNumber
  description: string
  posterPath: string
  originalTitle: string
  genresText: string
  region: string
  rating: OptionalNumber
  runtime: OptionalNumber
  director: string
  castText: string
  backdropPath: string
  season: OptionalNumber
  episode: OptionalNumber
  episodeTitle: string
}>({
  titleId: initialTitle?.id ?? '',
  ...titleFields(initialTitle),
  season: props.item.season ?? props.item.suggestion.season ?? '',
  episode: props.item.episode ?? props.item.suggestion.episode ?? '',
  episodeTitle: props.item.episodeTitle ?? '',
})

const selectedTitle = computed(() => props.titles.find(title => title.id === draft.titleId))
const slot = computed(() => {
  if (!draft.titleId) return null
  if (draft.kind === 'movie') return { titleId: draft.titleId, season: null, episode: null }
  if (draft.season === '' || draft.episode === '') return null
  return { titleId: draft.titleId, season: draft.season, episode: draft.episode }
})
const replaceKey = computed(() => JSON.stringify([
  draft.titleId, draft.kind,
  draft.kind === 'series' ? [draft.season, draft.episode] : null,
  !draft.titleId ? [draft.title.trim(), draft.year] : null,
]))
const occupant = computed(() => {
  const target = slot.value
  if (!target) return null
  return props.items.find(item => item.state === 'published' && item.id !== props.item.id
    && item.titleId === target.titleId && item.season === target.season && item.episode === target.episode) ?? null
})
const conflict = ref<{ replaceKey: string; message: string } | null>(null)
const activeConflict = computed(() => conflict.value?.replaceKey === replaceKey.value ? conflict.value : null)
const saving = ref(false)
const errorMessage = ref('')
const posterUploading = ref(false)
const posterProgress = ref(0)
const posterError = ref('')
const posterStatus = ref('')
const posterPreview = computed(() => selectedTitle.value?.posterPath === draft.posterPath ? selectedTitle.value?.posterUrl : null)
const previewFailed = ref(false)
let posterTransfer: AdminFileTransfer<{ path: string }> | null = null
let disposed = false

watch(posterPreview, () => { previewFailed.value = false })
watch(replaceKey, () => {
  if (conflict.value) errorMessage.value = ''
  conflict.value = null
})

function selectTitle(event: Event) {
  draft.titleId = (event.target as HTMLSelectElement).value
  Object.assign(draft, titleFields(selectedTitle.value))
  posterError.value = ''
  posterStatus.value = ''
  errorMessage.value = ''
}

function validateDraft(): MediaEdit | null {
  const title = draft.title.trim()
  const year = draft.year === '' ? null : draft.year
  const season = draft.kind === 'series' && draft.season !== '' ? draft.season : null
  const episode = draft.kind === 'series' && draft.episode !== '' ? draft.episode : null
  const posterPath = draft.posterPath.trim() || null
  const backdropPath = draft.backdropPath.trim()
  if (backdropPath && (/^(?:\/|[a-z][a-z\d+.-]*:)/i.test(backdropPath) || backdropPath.includes('\\') || backdropPath.split('/').includes('..'))) {
    errorMessage.value = '背景图需使用库内相对路径，用正斜杠（/）分隔目录。'
    return null
  }
  if (draft.rating !== '' && (!Number.isFinite(draft.rating) || draft.rating < 0 || draft.rating > 10)) {
    errorMessage.value = '评分须为 0–10 之间的数字，未知时留空。'
    return null
  }
  if (draft.runtime !== '' && (!Number.isInteger(draft.runtime) || draft.runtime < 0 || draft.runtime > 1440)) {
    errorMessage.value = '片长须为 0–1440 之间的整数分钟，未知时留空。'
    return null
  }

  if (!title) {
    errorMessage.value = '请输入片名，不能只填写空格。'
    document.getElementById('admin-media-title')?.focus()
    return null
  }
  if (year !== null && (!Number.isInteger(year) || year < 1800 || year > 2300)) {
    errorMessage.value = '年份须为 1800–2300 之间的整数，未知时留空。'
    return null
  }
  if (draft.kind === 'series' && (season === null || episode === null || !Number.isInteger(season) || !Number.isInteger(episode)
    || season < 0 || season > 999 || episode < 1 || episode > 9999)) {
    errorMessage.value = '请填写有效的季号（0–999）和集号（1–9999）。'
    return null
  }
  if (posterPath && (/^(?:\/|[a-z][a-z\d+.-]*:)/i.test(posterPath) || posterPath.includes('\\') || posterPath.split('/').includes('..'))) {
    errorMessage.value = '请输入库内图片的相对路径，使用正斜杠（/）分隔目录。'
    document.getElementById('admin-media-poster-path')?.focus()
    return null
  }
  return {
    titleId: draft.titleId || null,
    kind: draft.kind,
    title,
    year,
    description: draft.description.trim(),
    originalTitle: draft.originalTitle.trim() || null,
    genres: splitList(draft.genresText),
    region: draft.region.trim() || null,
    rating: draft.rating === '' ? null : draft.rating,
    runtime: draft.runtime === '' ? null : draft.runtime,
    director: draft.director.trim() || null,
    cast: splitList(draft.castText),
    posterPath,
    backdropPath: backdropPath.trim() || null,
    season,
    episode,
    episodeTitle: draft.kind === 'series' ? draft.episodeTitle.trim() || null : null,
  }
}

async function save(replaceExisting = false) {
  if (saving.value || posterUploading.value || props.disabled) return
  if (replaceExisting && (!activeConflict.value || !form.value?.reportValidity())) return
  errorMessage.value = ''
  const payload = validateDraft()
  if (!payload) return
  const attemptedKey = replaceKey.value
  conflict.value = null
  saving.value = true
  emit('saving', true)

  try {
    const { item } = await api.editMedia(props.item.id, replaceExisting ? { ...payload, replaceExisting: true } : payload)
    if (!disposed) emit('saved', item)
  } catch (error) {
    if (disposed) return
    const status = adminErrorStatus(error)
    if (status === 401) {
      emit('unauthorized')
    } else if (status === 409 && adminErrorCode(error) === 'SLOT_OCCUPIED') {
      conflict.value = {
        replaceKey: attemptedKey,
        message: adminErrorMessage(error, '此位置已被其他文件占用。'),
      }
      await nextTick()
      conflictHeading.value?.focus()
    } else {
      errorMessage.value = adminErrorMessage(error, '未能保存修改，请检查内容后重试。')
    }
  } finally {
    if (!disposed) {
      saving.value = false
      emit('saving', false)
    }
  }
}

function dismissConflict() {
  conflict.value = null
  const field = draft.kind === 'series' ? 'admin-media-episode' : 'admin-media-title-id'
  document.getElementById(field)?.focus()
}

function posterMimeType(name: string) {
  if (/\.jpe?g$/i.test(name)) return 'image/jpeg'
  if (/\.png$/i.test(name)) return 'image/png'
  if (/\.webp$/i.test(name)) return 'image/webp'
  return null
}

function clearPosterMessages() {
  posterError.value = ''
  posterStatus.value = ''
}

async function uploadPoster(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (!file || props.disabled || saving.value || posterUploading.value) return
  clearPosterMessages()
  const contentType = posterMimeType(file.name)
  if (!contentType || file.size === 0 || file.size > 8 * 1024 * 1024) {
    posterError.value = '请选择不超过 8 MiB 的非空 JPG、PNG 或 WebP 图片。'
    return
  }
  if (file.name.length > 240) {
    posterError.value = '海报文件名过长，请缩短文件名后再上传。'
    return
  }

  posterUploading.value = true
  posterProgress.value = 0
  let cancelled = false
  const current = startAdminFileTransfer<{ path: string }>('/api/admin/posters', file, {
    contentType,
    onProgress: ({ loaded, total }) => { posterProgress.value = total > 0 ? Math.min(100, Math.floor(100 * loaded / total)) : 0 },
  })
  posterTransfer = current
  try {
    const { path } = await current.promise
    if (posterTransfer !== current) return
    if (typeof path !== 'string' || !path) throw new Error('Missing poster path')
    draft.posterPath = path
    posterStatus.value = '海报已上传，保存编辑后生效。'
  } catch (error) {
    if (posterTransfer !== current) return
    if (adminTransferWasCancelled(error)) {
      cancelled = true
      posterStatus.value = '已取消海报上传。'
    } else if (adminErrorStatus(error) === 401) {
      emit('unauthorized')
    } else {
      posterError.value = adminErrorMessage(error, '未能上传海报，请重试。')
    }
  } finally {
    if (posterTransfer === current) {
      posterTransfer = null
      posterUploading.value = false
      if (cancelled) void nextTick(() => posterInput.value?.focus())
    }
  }
}

function cancelPoster() {
  posterTransfer?.cancel()
}

onMounted(() => heading.value?.focus())
onBeforeUnmount(() => {
  disposed = true
  const current = posterTransfer
  posterTransfer = null
  current?.cancel()
})
</script>

<template>
  <section id="admin-media-editor" class="media-editor" aria-labelledby="admin-editor-title">
    <h4 id="admin-editor-title" ref="heading" tabindex="-1">编辑视频资料</h4>
    <p v-if="!initialTitle" class="editor-hint">请核对根据文件名推测的内容，也可将文件归到已有电影或剧集。</p>

    <form ref="form" autocomplete="off" :aria-busy="saving" data-test="admin-media-form" @submit.prevent="save()">
      <fieldset class="editor-fields" :disabled="saving || disabled">
        <legend class="visually-hidden">条目资料</legend>
        <div class="editor-field">
          <label for="admin-media-title-id">归属条目</label>
          <select
            id="admin-media-title-id"
            class="field"
            :value="draft.titleId"
            :disabled="posterUploading"
            aria-describedby="admin-media-association-help"
            data-test="admin-media-title-id"
            @change="selectTitle"
          >
            <option value="">新建电影或剧集</option>
            <option v-for="title in orderedTitles" :key="title.id" :value="title.id">
              {{ title.kind === 'movie' ? '电影' : '剧集' }} · {{ title.title }}{{ title.year === null ? '' : `（${title.year}）` }}
            </option>
          </select>
          <p id="admin-media-association-help" class="editor-hint">
            {{ selectedTitle ? '已有条目的类型不能更改；片名、年份、简介、海报的修改会更新整个条目。' : '选择现有条目会载入该条目的资料。' }}
          </p>
        </div>

        <div class="editor-line">
          <div class="editor-field">
            <label for="admin-media-kind">类型</label>
            <select id="admin-media-kind" v-model="draft.kind" class="field" :disabled="Boolean(selectedTitle)" data-test="admin-media-kind">
              <option value="movie">电影</option>
              <option value="series">剧集</option>
            </select>
          </div>
          <div class="editor-field">
            <label for="admin-media-year">年份 <span>（可选）</span></label>
            <input id="admin-media-year" v-model.number="draft.year" class="field" type="number" min="1800" max="2300" step="1" inputmode="numeric" placeholder="未知可留空" data-test="admin-media-year">
          </div>
        </div>
        <div class="editor-field">
          <label for="admin-media-title">片名</label>
          <input id="admin-media-title" v-model="draft.title" class="field" type="text" required maxlength="200" data-test="admin-media-title">
        </div>
        <div class="editor-line">
          <div class="editor-field">
            <label for="admin-media-original-title">原名 <span>（可选）</span></label>
            <input id="admin-media-original-title" v-model="draft.originalTitle" class="field" type="text" maxlength="200" placeholder="例如英文原名" data-test="admin-media-original-title">
          </div>
          <div class="editor-field">
            <label for="admin-media-region">地区 <span>（可选）</span></label>
            <input id="admin-media-region" v-model="draft.region" class="field" type="text" maxlength="40" placeholder="例如 中国大陆" data-test="admin-media-region">
          </div>
        </div>
        <div class="editor-field">
          <label for="admin-media-genres">类型 <span>（可选，用、分隔）</span></label>
          <input id="admin-media-genres" v-model="draft.genresText" class="field" type="text" maxlength="400" placeholder="例如 剧情、科幻" data-test="admin-media-genres">
        </div>
        <div class="editor-line">
          <div class="editor-field">
            <label for="admin-media-rating">评分 <span>（0–10）</span></label>
            <input id="admin-media-rating" v-model.number="draft.rating" class="field" type="number" min="0" max="10" step="0.1" inputmode="decimal" placeholder="未知可留空" data-test="admin-media-rating">
          </div>
          <div class="editor-field">
            <label for="admin-media-runtime">片长 <span>（分钟）</span></label>
            <input id="admin-media-runtime" v-model.number="draft.runtime" class="field" type="number" min="0" max="1440" step="1" inputmode="numeric" placeholder="未知可留空" data-test="admin-media-runtime">
          </div>
        </div>
        <div class="editor-line">
          <div class="editor-field">
            <label for="admin-media-director">导演 <span>（可选）</span></label>
            <input id="admin-media-director" v-model="draft.director" class="field" type="text" maxlength="120" data-test="admin-media-director">
          </div>
          <div class="editor-field">
            <label for="admin-media-cast">主演 <span>（可选，用、分隔）</span></label>
            <input id="admin-media-cast" v-model="draft.castText" class="field" type="text" maxlength="400" data-test="admin-media-cast">
          </div>
        </div>
        <div class="editor-field">
          <label for="admin-media-description">简介 <span>（可选）</span></label>
          <textarea id="admin-media-description" v-model="draft.description" class="field" rows="4" maxlength="6000" data-test="admin-media-description" />
        </div>

        <section v-if="draft.kind === 'series'" class="editor-subgroup" aria-labelledby="admin-episode-title">
          <h5 id="admin-episode-title">单集资料</h5>
          <div class="editor-line">
            <div class="editor-field">
              <label for="admin-media-season">季号</label>
              <input id="admin-media-season" v-model.number="draft.season" class="field" type="number" min="0" max="999" step="1" inputmode="numeric" required data-test="admin-media-season">
            </div>
            <div class="editor-field">
              <label for="admin-media-episode">集号</label>
              <input id="admin-media-episode" v-model.number="draft.episode" class="field" type="number" min="1" max="9999" step="1" inputmode="numeric" required data-test="admin-media-episode">
            </div>
          </div>
          <div class="editor-field">
            <label for="admin-media-episode-title">单集标题 <span>（可选）</span></label>
            <input id="admin-media-episode-title" v-model="draft.episodeTitle" class="field" type="text" maxlength="200" data-test="admin-media-episode-title">
          </div>
        </section>
        <p v-if="occupant" class="editor-warning" data-test="admin-media-occupant">
          {{ draft.kind === 'series' ? '此集' : '此电影' }}已由「{{ occupant.fileName }}」占用{{ occupant.available ? '' : '（原文件缺失或暂不可用，仍占用此位置）' }}。
        </p>

        <section class="editor-subgroup" aria-labelledby="admin-poster-title">
          <h5 id="admin-poster-title">海报</h5>
          <figure v-if="posterPreview && !previewFailed" class="poster-preview">
            <img :key="posterPreview" :src="posterPreview" alt="" width="52" height="78" loading="lazy" @error="previewFailed = true">
            <figcaption class="editor-hint">当前海报</figcaption>
          </figure>
          <div class="editor-field">
            <label for="admin-media-poster-path">海报相对路径 <span>（可选）</span></label>
            <input
              id="admin-media-poster-path"
              v-model="draft.posterPath"
              class="field"
              type="text"
              maxlength="2048"
              placeholder="例如：海报/片名.webp"
              aria-describedby="admin-poster-path-help"
              :readonly="posterUploading"
              spellcheck="false"
              data-test="admin-media-poster-path"
              @input="clearPosterMessages"
            >
            <p id="admin-poster-path-help" class="editor-hint">使用正斜杠（/）分隔目录，留空可清除已设置的海报。</p>
          </div>
          <div class="editor-field">
            <input
              id="admin-media-poster-file"
              ref="posterInput"
              class="visually-hidden"
              type="file"
              accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
              aria-describedby="admin-poster-upload-help"
              :disabled="posterUploading"
              data-test="admin-media-poster-file"
              @change="uploadPoster"
            >
            <label class="btn poster-choose" for="admin-media-poster-file">上传新海报</label>
            <p id="admin-poster-upload-help" class="editor-hint">支持不超过 8 MiB 的 JPG、PNG 和 WebP。选择后立即上传，保存编辑后才更新条目的海报。</p>
            <div v-if="posterUploading" class="editor-actions poster-progress">
              <progress :value="posterProgress" max="100" aria-label="海报上传进度" />
              <button class="btn" type="button" data-test="admin-poster-cancel" @click="cancelPoster">取消海报上传</button>
            </div>
            <p class="editor-hint" role="status" data-test="admin-poster-status">{{ posterUploading ? '正在上传海报…' : posterStatus }}</p>
            <p v-if="posterError" class="editor-error" role="alert" data-test="admin-poster-error">{{ posterError }}</p>
          </div>
        </section>

        <p v-if="errorMessage" class="editor-error" role="alert" data-test="admin-media-error">{{ errorMessage }}</p>
        <div v-if="activeConflict" class="conflict-panel" data-test="admin-media-conflict">
          <h5 ref="conflictHeading" tabindex="-1">{{ draft.kind === 'series' ? '这一集已有文件' : '这部电影已有文件' }}</h5>
          <p>{{ activeConflict.message }} 替换会将原文件移回待整理，不会删除文件。</p>
          <div class="editor-actions">
            <button class="btn" type="button" @click="dismissConflict">不替换，继续编辑</button>
            <button class="btn conflict-confirm" type="button" :disabled="posterUploading" data-test="admin-media-replace" @click="save(true)">替换占用文件并保存</button>
          </div>
        </div>
        <div class="editor-actions">
          <button class="btn btn--primary" type="submit" :disabled="posterUploading" data-test="admin-media-save">
            {{ saving ? '正在保存…' : '保存编辑' }}
          </button>
          <button class="btn" type="button" data-test="admin-media-cancel" @click="emit('cancel')">取消编辑</button>
        </div>
      </fieldset>
    </form>
  </section>
</template>

<style scoped>
.media-editor {
  min-width: 0;
  margin-top: 1.4rem;
  padding: clamp(1.1rem, 2.5vw, 1.8rem);
  border-inline-start: 2px solid var(--border-strong);
  background: var(--bg-elevated);
}
.media-editor h4 {
  font-family: var(--font-display);
  font-size: 1.2rem;
  font-weight: 600;
}
.media-editor h4 + p { margin-top: 0.4rem; }
.editor-fields, .editor-subgroup, .editor-field { display: grid; min-width: 0; }
.editor-fields {
  gap: 1.15rem;
  max-width: 50rem;
  margin: 1.25rem 0 0;
  padding: 0;
  border: 0;
}
.editor-subgroup {
  gap: 0.85rem;
  padding-top: 1.1rem;
  border-top: 1px solid var(--border);
}
.editor-subgroup h5,
.conflict-panel h5 { font-size: 0.95rem; font-weight: 650; }
.editor-field { gap: 0.4rem; }
.editor-field label { font-weight: 600; font-size: 0.9rem; }
.editor-field label span { color: var(--text-muted); font-size: 0.85em; font-weight: 400; }
.editor-field .field { background: var(--bg); }
.editor-field textarea { min-height: 7rem; resize: vertical; }
.editor-line {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.85rem;
}
.editor-hint, .editor-error, .editor-warning {
  overflow-wrap: anywhere;
  font-size: 0.88rem;
  line-height: 1.65;
}
.editor-hint { color: var(--text-muted); }
.editor-hint:empty { margin: 0; height: 0; }
.editor-warning {
  padding-inline-start: 0.8rem;
  border-inline-start: 2px solid var(--accent);
  color: var(--accent);
}
.editor-error { color: var(--color-danger, var(--accent-strong)); }
.editor-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.65rem; }
.poster-preview { display: flex; align-items: center; gap: 0.75rem; margin: 0; }
.poster-preview img { object-fit: cover; border-radius: var(--radius-sm); background: var(--bg-card); }
.poster-choose { justify-self: start; cursor: pointer; }
.editor-field input:focus-visible + .poster-choose {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
.editor-field input:disabled + .poster-choose {
  cursor: not-allowed;
  opacity: 0.65;
}
.poster-progress progress { max-width: 100%; accent-color: var(--accent); }
.conflict-panel {
  display: grid;
  gap: 0.7rem;
  padding: 0.85rem 1rem;
  border-inline-start: 2px solid var(--color-danger, var(--accent-strong));
  background: var(--bg-card);
  font-size: 0.9rem;
  overflow-wrap: anywhere;
}
.conflict-panel h5 { color: var(--color-danger, var(--accent-strong)); }
.conflict-confirm { border-color: var(--color-danger, var(--accent-strong)); }
@media (max-width: 23rem) {
  .editor-line { grid-template-columns: minmax(0, 1fr); }
}
</style>
