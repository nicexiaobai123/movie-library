<script setup lang="ts">
const route = useRoute()
const draft = ref('')

// Submitting goes through the URL so a search is shareable and the back button works.
function submit() {
  const q = draft.value.trim()
  if (!q) {
    void navigateTo('/browse?kind=movie')
    return
  }
  void navigateTo({ path: '/search', query: { q } })
}

watch(() => route.query.q, (value) => {
  if (route.path === '/search' && typeof value === 'string') draft.value = value
})
</script>

<template>
  <form class="search" role="search" @submit.prevent="submit">
    <label for="global-search" class="visually-hidden">搜索影片</label>
    <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="1.7" />
      <path d="m15.2 15.2 4 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
    </svg>
    <input
      id="global-search"
      v-model="draft"
      type="search"
      name="q"
      placeholder="搜索影片"
      maxlength="200"
      autocomplete="off"
      enterkeyhint="search"
      data-test="global-search"
    >
  </form>
</template>

<style scoped>
.search {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  block-size: 38px;
  padding-inline: 0.7rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: rgb(255 255 255 / 0.05);
  transition: border-color var(--dur-fast) var(--ease), background-color var(--dur-fast) var(--ease), inline-size var(--dur) var(--ease);
}
.search:focus-within { border-color: rgb(255 255 255 / 0.28); background: rgb(255 255 255 / 0.08); }
.search-icon { inline-size: 1rem; block-size: 1rem; flex: none; color: var(--text-muted); }
.search input {
  inline-size: 100%;
  min-inline-size: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: 0.86rem;
  outline: none;
}
.search input::placeholder { color: var(--text-muted); }
.search input::-webkit-search-cancel-button { display: none; }
@media (max-width: 34rem) {
  .search { padding-inline: 0; justify-content: center; border-color: transparent; background: transparent; }
  .search-icon { inline-size: 1.25rem; block-size: 1.25rem; }
  .search input { inline-size: 0; padding: 0; }
  .search:focus-within { inline-size: 100%; padding-inline: 0.7rem; border-color: var(--border); background: rgb(255 255 255 / 0.08); }
  .search:focus-within input { inline-size: 100%; }
}
</style>
