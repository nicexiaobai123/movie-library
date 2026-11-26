<script setup lang="ts">
// The old detail route now lives at /movie/:id; keep shared links working.
const route = useRoute()
const id = String(route.params.id ?? '')
await navigateTo({ path: `/movie/${encodeURIComponent(id)}`, query: route.query }, { redirectCode: 301 })
</script>

<template>
  <div class="shell" aria-busy="true"><p>正在打开影片…</p></div>
</template>
