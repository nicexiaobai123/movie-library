<script setup lang="ts">
import { pageSlots } from '#shared/pager'

// One pager for the whole app: the catalogue, the media list and any future list.
// It is right-aligned with a count on the left, first/last labels at each end and
// single-arrow steps, so every list is walked the same way.
const props = withDefaults(defineProps<{
  page: number
  pageCount: number
  // Short description of the total, e.g. "共 40 个文件".
  summary?: string
  // data-test prefixes so each list keeps its own stable hooks.
  testPrefix?: string
  disabled?: boolean
  // `inset` draws the top rule used inside a panel; `standalone` is the page-level one.
  variant?: 'standalone' | 'inset'
}>(), { summary: '', testPrefix: 'pager', disabled: false, variant: 'standalone' })

const emit = defineEmits<{ go: [page: number] }>()

const slots = computed(() => pageSlots(props.page, props.pageCount))

// Page entries for the strip. Every page is drawn, so the strip never changes width
// while paging and the arrows beside it stay put.
interface PageEntry {
  key: string
  value: number
  current: boolean
}

const entries = computed<PageEntry[]>(() => slots.value.map(value => ({
  key: `page-${value}`,
  value,
  current: value === props.page,
})))

function go(target: number) {
  if (props.disabled) return
  const next = Math.min(Math.max(1, target), props.pageCount)
  if (next !== props.page) emit('go', next)
}

// `at` builds the per-list data-test hooks: first/prev/next/last and page-N.
const at = (suffix: string | number) => `${props.testPrefix}-${suffix}`
</script>

<template>
  <nav class="pager" :class="`pager--${variant}`" aria-label="翻页" :data-test="`${testPrefix}-pager`">
    <p v-if="summary" class="pager-info">{{ summary }}<template v-if="pageCount > 1">，第 {{ page }} / {{ pageCount }} 页</template></p>
    <div class="pager-controls">
      <button class="btn pager-edge" type="button" :disabled="disabled || page <= 1" :data-test="at('first')" @click="go(1)">首页</button>
      <button class="btn pager-step" type="button" :disabled="disabled || page <= 1" aria-label="上一页" :data-test="at('prev')" @click="go(page - 1)">‹</button>
      <template v-for="entry in entries" :key="entry.key">
        <button
          class="btn pager-number"
          :class="{ 'is-current': entry.current }"
          type="button"
          :disabled="disabled"
          :aria-current="entry.current ? 'page' : undefined"
          :data-test="at(`page-${entry.value}`)"
          @click="go(entry.value)"
        >{{ entry.value }}</button>
      </template>
      <button class="btn pager-step" type="button" :disabled="disabled || page >= pageCount" aria-label="下一页" :data-test="at('next')" @click="go(page + 1)">›</button>
      <button class="btn pager-edge" type="button" :disabled="disabled || page >= pageCount" :data-test="at('last')" @click="go(pageCount)">尾页</button>
    </div>
  </nav>
</template>

<style scoped>
/* Right-aligned at the bottom, with the count pushed to the far left. */
.pager {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.6rem 1.2rem;
}
.pager--standalone {
  margin-block-start: 1.8rem;
  padding-block-start: 1rem;
  border-block-start: 1px solid var(--border);
}
.pager-info {
  margin: 0;
  margin-inline-end: auto;
  color: var(--text-muted);
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}
.pager-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem; }
.pager-controls .btn {
  min-block-size: 34px;
  padding-inline: 0.55rem;
  border-color: transparent;
  background: transparent;
  font-size: 0.82rem;
}
.pager-edge { color: var(--text-muted); }
.pager-edge:not(:disabled):hover { color: var(--text); background: var(--bg-hover); }
.pager-step {
  min-inline-size: 32px;
  justify-content: center;
  color: var(--text-muted);
  font-size: 1.05rem;
  line-height: 1;
}
.pager-step:not(:disabled):hover { color: var(--text); background: var(--bg-hover); }
.pager-number {
  min-inline-size: 32px;
  justify-content: center;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.pager-number:not(:disabled):hover { color: var(--text); background: var(--bg-hover); }
.pager-number.is-current {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 600;
}
/* Every page is listed, so the strip never condenses and no ellipsis is needed. */
@media (max-width: 34rem) {
  .pager { justify-content: center; }
  .pager-info { inline-size: 100%; margin-inline-end: 0; text-align: center; }
}
</style>
