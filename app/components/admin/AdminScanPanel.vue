<script setup lang="ts">
import type { ScanStatus } from '#shared/types/library'

const props = defineProps<{
  scan: ScanStatus | null
  starting: boolean
  checking: boolean
  errorMessage: string
  disabled?: boolean
}>()
const emit = defineEmits<{ start: []; retryStatus: [] }>()

const last = computed(() => props.scan?.last ?? null)
const metrics = computed(() => {
  if (!last.value) return []
  return [
    { label: '发现', count: last.value.discovered },
    { label: '已入库', count: last.value.indexed },
    { label: '已发布', count: last.value.published },
    { label: '待整理', count: last.value.pending },
    { label: '未稳定', count: last.value.unstable },
    { label: '缺失', count: last.value.missing },
  ]
})

const dateFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
function formatDate(value: string) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? dateFormat.format(date) : value
}
</script>

<template>
  <section class="scan-panel" aria-labelledby="admin-scan-title">
    <header class="scan-intro">
      <h2 id="admin-scan-title">扫描媒体目录</h2>
      <p>检查磁盘中的视频，登记新文件并标记已移走的文件。</p>
    </header>

    <div class="scan-actions">
      <button
        class="btn"
        type="button"
        :disabled="disabled || starting || checking || scan?.running"
        aria-describedby="admin-scan-status"
        data-test="admin-scan-start"
        @click="emit('start')"
      >
        {{ starting ? '正在提交…' : scan?.running ? '扫描进行中' : '开始扫描' }}
      </button>
      <button
        v-if="errorMessage && scan?.running"
        type="button"
        class="btn"
        :disabled="disabled || checking"
        @click="emit('retryStatus')"
      >
        立即查询
      </button>
    </div>
    <p
      id="admin-scan-status"
      class="scan-status"
      :class="{ 'scan-status--running': starting || scan?.running, 'scan-status--failed': !starting && !scan?.running && last?.state === 'failed' }"
      role="status"
      data-test="admin-scan-status"
    >
      <template v-if="starting">正在提交扫描请求。</template>
      <template v-else-if="scan?.running">扫描在后台进行，完成后会自动刷新文件清单。</template>
      <template v-else-if="last?.state === 'failed'">最近一次扫描失败。</template>
      <template v-else-if="last">最近一次扫描已完成。</template>
      <template v-else-if="scan">尚未执行过扫描。</template>
      <template v-else>尚未获取扫描状态。</template>
    </p>
    <p v-if="errorMessage" class="scan-error" role="alert" data-test="admin-scan-error">{{ errorMessage }}</p>

    <div v-if="last" class="scan-result" data-test="admin-scan-result">
      <h3>最近一次扫描结果</h3>
      <p class="scan-time">完成于 <time :datetime="last.finishedAt">{{ formatDate(last.finishedAt) }}</time></p>
      <dl class="scan-metrics">
        <div v-for="metric in metrics" :key="metric.label">
          <dt>{{ metric.label }}</dt>
          <dd>{{ metric.count }}</dd>
        </div>
      </dl>
      <p v-if="last.message" class="result-message" :class="{ 'scan-error': last.state === 'failed' }">{{ last.message }}</p>
      <p v-else-if="last.unstable" class="scan-time waiting-note">文件稳定后才会入库，可稍后再次扫描。</p>
    </div>
  </section>
</template>

<style scoped>
.scan-panel { min-width: 0; }
.scan-intro h2 {
  font-family: var(--font-display);
  font-size: 1.3rem;
  font-weight: 600;
  line-height: 1.4;
}
.scan-intro p,
.scan-status,
.scan-time {
  color: var(--text-muted);
  font-size: 0.9rem;
  line-height: 1.7;
}
.scan-intro p { margin-top: 0.4rem; }
.scan-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  margin-top: 1.35rem;
}
.scan-status, .scan-error {
  margin-top: 0.75rem;
  overflow-wrap: anywhere;
}
.scan-status {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
}
.scan-status::before {
  flex: none;
  width: 0.4rem;
  height: 0.4rem;
  margin-top: 0.55em;
  border-radius: 50%;
  background: var(--text-muted);
  content: '';
}
.scan-status--running::before { background: var(--accent); }
.scan-status--failed::before { background: var(--color-danger, var(--accent-strong)); }
.scan-error {
  color: var(--color-danger, var(--accent-strong));
  font-size: 0.9rem;
}
.scan-result {
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
}
.scan-result h3 {
  font-size: 0.9rem;
  font-weight: 600;
}
.scan-time { margin-top: 0.2rem; }
.waiting-note { margin-top: 0.7rem; }
.scan-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 0.85rem clamp(1.2rem, 2vw, 1.8rem);
  margin-block: 1rem 0;
}
.scan-metrics div { min-width: 3.2rem; }
.scan-metrics dt {
  color: var(--text-muted);
  font-size: 0.8rem;
}
.scan-metrics dd {
  margin: 0.1rem 0 0;
  color: var(--text-secondary);
  font-size: 1.05rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.result-message {
  margin-top: 0.8rem;
  font-size: 0.9rem;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
</style>
