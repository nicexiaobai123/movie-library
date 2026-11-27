<script setup lang="ts">
import { computed } from 'vue'

// A global fault screen. It replaces the framework's default so a broken request
// still looks like part of this site instead of an unstyled English error page.
const props = defineProps<{ error: { statusCode?: number; statusMessage?: string; message?: string } }>()

const statusCode = computed(() => props.error?.statusCode ?? 500)
const notFound = computed(() => statusCode.value === 404)
const heading = computed(() => notFound.value ? '找不到这个页面' : '出了点问题')
const detail = computed(() => {
  if (notFound.value) return '这个地址不存在，可能链接已经失效。'
  if (statusCode.value >= 500) return '服务器暂时无法完成请求。可以稍后重试，或回到首页重新开始。'
  return props.error?.statusMessage || '请求没有完成。'
})

function goHome() {
  void clearError({ redirect: '/' })
}
function retry() {
  void clearError()
}
</script>

<template>
  <div class="fault">
    <div class="fault-inner">
      <p class="eyebrow">{{ notFound ? '404' : `错误 ${statusCode}` }}</p>
      <h1>{{ heading }}</h1>
      <p class="fault-detail">{{ detail }}</p>
      <div class="fault-actions">
        <button v-if="!notFound" class="btn btn--primary" type="button" @click="retry">重试</button>
        <button class="btn" :class="{ 'btn--primary': notFound }" type="button" @click="goHome">返回首页</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fault {
  display: flex;
  align-items: center;
  min-block-size: 100vh;
  min-block-size: 100svh;
  background:
    radial-gradient(70% 55% at 78% 14%, rgb(214 184 117 / 0.1), transparent 62%),
    var(--bg);
}
.fault-inner {
  inline-size: min(100%, var(--shell-max));
  margin-inline: auto;
  padding-inline: var(--shell-pad);
  max-inline-size: 42rem;
}
.fault-inner h1 {
  margin: 0.9rem 0 0;
  font-family: var(--font-display);
  font-size: clamp(1.8rem, 4vw, 2.8rem);
  font-weight: 700;
  letter-spacing: -0.02em;
}
.fault-detail { margin: 1rem 0 0; color: var(--text-secondary); font-size: 0.96rem; line-height: 1.8; }
.fault-actions { display: flex; flex-wrap: wrap; gap: 0.7rem; margin-block-start: 1.8rem; }
</style>
