<script setup lang="ts">
import PublicIcon from './Icon.vue'

defineProps<{
  to: string
  label: string
}>()
</script>

<template>
  <NuxtLink :to="to" class="back-link">
    <PublicIcon name="back" />
    <span>{{ label }}</span>
  </NuxtLink>
</template>

<style scoped>
.back-link {
  display: inline-flex;
  align-items: center;
  gap: .45rem;
  min-block-size: 2.75rem;
  box-sizing: border-box;
  margin-inline-start: -.35rem;
  padding-inline: .35rem .6rem;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: .9rem;
  text-decoration: none;
  transition: color .16s ease;
}

.back-link :deep(svg) {
  inline-size: 1.05rem;
  block-size: 1.05rem;
  transition: transform .2s var(--ease);
}

.back-link:hover { color: var(--accent-strong); }
.back-link:hover :deep(svg) { transform: translateX(-3px); }
</style>
