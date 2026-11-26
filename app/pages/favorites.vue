<script setup lang="ts">
// The favourites page moved to /my-list to match the product navigation.
await navigateTo('/my-list', { redirectCode: 301 })
</script>

<template>
  <div class="shell" aria-busy="true"><p>正在打开收藏夹…</p></div>
</template>