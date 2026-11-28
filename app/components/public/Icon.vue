<script setup lang="ts">
defineProps<{
  name: 'lamp' | 'film' | 'search' | 'back' | 'play' | 'pause' | 'next' | 'download' | 'archive' | 'warning' | 'clock' | 'settings' | 'expand' | 'collapse'
}>()
</script>

<template>
  <svg
    aria-hidden="true"
    focusable="false"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.65"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="public-icon"
  >
    <template v-if="name === 'lamp'">
      <path d="M8 3.5h8l4 9H4l4-9ZM12 12.5v8m-4 0h8m1-8v3.5" />
    </template>
    <template v-else-if="name === 'film'">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M8 4.5v15m8-15v15M3.5 9.5H8m-4.5 5H8m8-5h4.5m-4.5 5h4.5" />
    </template>
    <template v-else-if="name === 'search'">
      <circle cx="10.5" cy="10.5" r="5.75" />
      <path d="m15 15 4.25 4.25" />
    </template>
    <path v-else-if="name === 'back'" d="m11 6-6 6 6 6M5 12h14" />
    <path v-else-if="name === 'play'" d="M8.5 5.75 18.5 12l-10 6.25V5.75Z" />
    <template v-else-if="name === 'pause'">
      <path d="M9.25 6v12M14.75 6v12" stroke-width="2.4" />
    </template>
    <template v-else-if="name === 'next'">
      <path d="M6.5 6.5 14 12l-7.5 5.5V6.5Z" fill="currentColor" stroke="none" />
      <path d="M17.5 6v12" stroke-width="2.2" />
    </template>
    <path v-else-if="name === 'download'" d="M12 3.75v11m-4-4 4 4 4-4M5 15.5v4.75h14V15.5" />
    <template v-else-if="name === 'archive'">
      <rect x="3.5" y="4.5" width="17" height="4.75" rx="1" />
      <path d="M5 9.25v9.25A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9.25M10 13h4" />
    </template>
    <template v-else-if="name === 'warning'">
      <path d="M10.75 4.75a1.45 1.45 0 0 1 2.5 0l7.1 12.3a1.5 1.5 0 0 1-1.3 2.25H4.95a1.5 1.5 0 0 1-1.3-2.25l7.1-12.3Z" />
      <path d="M12 9v3.75m0 3.25h.01" />
    </template>
    <template v-else-if="name === 'clock'">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </template>
    <template v-else-if="name === 'settings'">
      <path d="M4.5 7h15m-15 5h15m-15 5h15" />
      <path d="M9 5v4m6 1v4m-7 1v4" stroke-width="2.5" />
    </template>
    <template v-else-if="name === 'expand'">
      <path d="M4.5 9.5v-5h5m5 0h5v5m0 5v5h-5m-5 0h-5v-5" />
    </template>
    <template v-else-if="name === 'collapse'">
      <path d="M9.5 4.5v5h-5m15 0h-5v-5m0 15v-5h5m-15 0h5v5" />
    </template>
  </svg>
</template>

<style scoped>
.public-icon {
  flex: none;
}
</style>
