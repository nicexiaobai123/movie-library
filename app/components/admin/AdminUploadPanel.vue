<script setup lang="ts">
import type { AdminMedia } from '#shared/types/library'
import { adminErrorMessage, adminErrorStatus, formatAdminBytes } from '~/composables/useAdminApi'
import { adminTransferWasCancelled, startAdminFileTransfer, type AdminFileTransfer } from '~/composables/useAdminUpload'

const props = defineProps<{ disabled?: boolean }>()
const emit = defineEmits<{
  uploaded: [item: AdminMedia]
  unauthorized: []
}>()

const input = ref<HTMLInputElement | null>(null)
const selected = shallowRef<File[]>([])
const progress = ref({ loaded: 0, total: 0 })
const uploading = ref(false)
const currentName = ref('')
const results = ref<{ name: string; ok: boolean; message: string }[]>([])
const percentage = computed(() => progress.value.total > 0
  ? Math.min(100, Math.floor(100 * progress.value.loaded / progress.value.total))
  : 0)
const totalBytes = computed(() => selected.value.reduce((sum, file) => sum + file.size, 0))
const errorMessage = ref('')
const statusMessage = ref('')
let transfer: AdminFileTransfer<{ item: AdminMedia }> | null = null

// Several episodes of one show can be selected at once; each file is sent as its
// own streamed request so no video is ever buffered in memory.
function chooseFiles(event: Event) {
  const target = event.target as HTMLInputElement
  const files = [...(target.files ?? [])]
  selected.value = []
  errorMessage.value = ''
  statusMessage.value = ''
  results.value = []
  if (!files.length) return
  const rejected: string[] = []
  const accepted: File[] = []
  for (const file of files) {
    if (!/\.mp4$/i.test(file.name) || file.size === 0) rejected.push(`${file.name}：不是有效的 MP4`)
    else if (file.name.length > 240) rejected.push(`${file.name}：文件名过长`)
    else if (accepted.some(item => item.name === file.name)) rejected.push(`${file.name}：重复选择`)
    else accepted.push(file)
  }
  if (rejected.length) errorMessage.value = rejected.join('；')
  if (accepted.length) {
    selected.value = accepted
    return
  }
  target.value = ''
}

async function send(file: File): Promise<void> {
  currentName.value = file.name
  progress.value = { loaded: 0, total: file.size }
  const current = startAdminFileTransfer<{ item: AdminMedia }>('/api/admin/upload', file, {
    onProgress: (value) => { progress.value = value },
  })
  transfer = current
  try {
    const { item } = await current.promise
    if (transfer !== current) return
    if (typeof item?.fileName !== 'string') throw new Error('Missing uploaded item')
    results.value = [...results.value, {
      name: file.name,
      ok: true,
      message: item.state === 'pending' ? '已加入待整理' : '已入库',
    }]
    emit('uploaded', item)
  } catch (error) {
    if (transfer !== current) return
    if (adminTransferWasCancelled(error)) {
      results.value = [...results.value, { name: file.name, ok: false, message: '已取消' }]
    } else if (adminErrorStatus(error) === 401) {
      emit('unauthorized')
      throw error
    } else {
      results.value = [...results.value, {
        name: file.name,
        ok: false,
        message: adminErrorMessage(error, '上传未完成'),
      }]
    }
  } finally {
    if (transfer === current) transfer = null
  }
}

async function upload() {
  if (!selected.value.length || uploading.value || props.disabled) return
  errorMessage.value = ''
  statusMessage.value = ''
  results.value = []
  uploading.value = true
  const queue = [...selected.value]
  try {
    for (const [index, file] of queue.entries()) {
      await send(file)
      statusMessage.value = `正在上传 ${index + 1} / ${queue.length}`
    }
    if (input.value) input.value.value = ''
    selected.value = []
    const ok = results.value.filter(item => item.ok).length
    const failed = results.value.length - ok
    statusMessage.value = failed ? `完成：${ok} 个成功，${failed} 个失败。` : `全部 ${ok} 个文件已上传。`
  } catch {
    // An expired session aborts the queue; remaining files stay selected for a retry.
    statusMessage.value = '上传已中断，请重新登录后重试。'
  } finally {
    uploading.value = false
    currentName.value = ''
    progress.value = { loaded: 0, total: 0 }
  }
}

function cancelUpload() {
  transfer?.cancel()
}

onBeforeUnmount(() => {
  const current = transfer
  transfer = null
  current?.cancel()
})
</script>

<template>
  <section class="upload-panel" aria-labelledby="admin-upload-title">
    <header class="upload-intro">
      <h2 id="admin-upload-title">上传视频</h2>
      <p id="admin-upload-help">可一次选择多个 MP4。剧集请让文件名带集号，例如「潮声来处 S01E02.mp4」或「潮声来处 第02集.mp4」，系统会归到同一部剧。</p>
    </header>

    <form class="upload-form" @submit.prevent="upload">
      <div class="upload-actions">
        <input
          id="admin-video-file"
          ref="input"
          class="visually-hidden"
          type="file"
          accept=".mp4,video/mp4"
          multiple
          aria-describedby="admin-upload-help"
          :disabled="uploading || disabled"
          data-test="admin-video-file"
          @change="chooseFiles"
        >
        <label class="btn upload-choose" for="admin-video-file">选择视频文件</label>
        <button class="btn btn--primary" type="submit" :disabled="!selected.length || uploading || disabled" data-test="admin-upload-submit">
          {{ uploading ? '正在上传…' : (selected.length > 1 ? `上传 ${selected.length} 个文件` : '开始上传') }}
        </button>
        <button v-if="uploading" class="btn" type="button" data-test="admin-upload-cancel" @click="cancelUpload">
          取消上传
        </button>
      </div>
      <p class="file-detail selected-detail" data-test="admin-upload-selected">
        <template v-if="selected.length > 1">已选择 <strong>{{ selected.length }}</strong> 个文件，共 {{ formatAdminBytes(totalBytes) }}。</template>
        <template v-else-if="selected.length === 1"><span class="selected-name">{{ selected[0]!.name }}</span> <span class="selected-size">· {{ formatAdminBytes(selected[0]!.size) }}</span></template>
        <template v-else>尚未选择视频。</template>
      </p>
      <ul v-if="selected.length > 1" class="upload-queue" role="list" data-test="admin-upload-queue">
        <li v-for="file in selected" :key="file.name">
          <span class="queue-name">{{ file.name }}</span>
          <span class="queue-size">{{ formatAdminBytes(file.size) }}</span>
        </li>
      </ul>
    </form>

    <div v-if="uploading" class="upload-progress">
      <p v-if="currentName" class="upload-current" data-test="admin-upload-current">正在发送：{{ currentName }}</p>
      <div class="progress-line">
        <progress :value="percentage" max="100" aria-label="视频上传进度" data-test="admin-upload-progress" />
        <span aria-hidden="true">{{ percentage }}%</span>
      </div>
      <p class="file-detail">{{ formatAdminBytes(progress.loaded) }} / {{ formatAdminBytes(progress.total) }}</p>
    </div>

    <p class="upload-status" role="status" data-test="admin-upload-status">
      <template v-if="uploading">{{ percentage === 100 ? '发送完成，等待服务器确认。' : statusMessage }}</template>
      <template v-else>{{ statusMessage }}</template>
    </p>

    <ul v-if="results.length" class="upload-results" role="list" data-test="admin-upload-results">
      <li v-for="result in results" :key="result.name" :class="result.ok ? 'is-ok' : 'is-failed'">
        <span class="result-name">{{ result.name }}</span>
        <span class="result-state">{{ result.message }}</span>
      </li>
    </ul>

    <p v-if="errorMessage" class="upload-error" role="alert" data-test="admin-upload-error">{{ errorMessage }}</p>
  </section>
</template>

<style scoped>
.upload-panel { min-width: 0; }
.upload-intro h2 {
  font-family: var(--font-display);
  font-size: 1.3rem;
  font-weight: 600;
  line-height: 1.4;
}
.upload-intro p {
  margin-top: 0.4rem;
  color: var(--text-muted);
  font-size: 0.9rem;
  line-height: 1.7;
}
.upload-form { margin-top: 1.35rem; }
.upload-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.65rem;
}
.upload-choose { cursor: pointer; }
.upload-actions input:focus-visible + label {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
.upload-actions input:disabled + label {
  cursor: not-allowed;
  opacity: 0.65;
}
.file-detail {
  min-width: 0;
  color: var(--text-muted);
  font-size: 0.85rem;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.selected-detail { margin-top: 0.75rem; }
.selected-name { color: var(--text-secondary); }
.selected-size { white-space: nowrap; }
.upload-progress { margin-top: 1rem; }
.upload-current { margin: 0 0 0.5rem; color: var(--text-secondary); font-size: 0.85rem; overflow-wrap: anywhere; }
.progress-line {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 3rem;
  align-items: center;
  gap: 0.65rem;
  color: var(--accent);
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.progress-line progress {
  width: 100%;
  accent-color: var(--accent);
}
.upload-status:not(:empty), .upload-error {
  margin-top: 0.75rem;
  font-size: 0.9rem;
  overflow-wrap: anywhere;
}
.upload-status { color: var(--text-secondary); }
.upload-error { color: var(--color-danger, var(--accent-strong)); }

/* A multi-file selection is listed so it is clear what will be queued. */
.upload-queue, .upload-results {
  margin: 0.7rem 0 0;
  padding: 0;
  list-style: none;
  max-block-size: 13rem;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.upload-queue li, .upload-results li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.8rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.84rem;
}
.upload-queue li + li, .upload-results li + li { border-block-start: 1px solid var(--border); }
.queue-name, .result-name { min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary); }
.queue-size { flex: none; color: var(--text-muted); font-size: 0.78rem; font-variant-numeric: tabular-nums; }
.result-state { flex: none; font-size: 0.78rem; }
.upload-results li.is-ok .result-state { color: var(--accent); }
.upload-results li.is-failed .result-state { color: var(--color-danger, var(--accent-strong)); }
</style>
