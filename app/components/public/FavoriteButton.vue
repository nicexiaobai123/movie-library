<script setup lang="ts">
import { favoriteState, useFavorites, useUserSession } from '~/composables/useUser'
import { adminErrorMessage, adminErrorStatus } from '~/composables/useAdminApi'

const route = useRoute()
const titleId = computed(() => String(route.params.id ?? ''))
const { signedIn } = await useUserSession()
const { refresh: refreshFavorites, set: setFavorite } = await useFavorites()
const { data: state, refresh: refreshState } = await favoriteState(titleId.value)

const isFavorite = computed(() => Boolean(state.value?.favorited))
const pending = ref(false)
const notice = ref('')
const errorMessage = ref('')

watch(isFavorite, (value) => {
  if (value) notice.value = '已加入收藏。'
})

async function toggle() {
  if (pending.value) return
  if (!signedIn.value) {
    await navigateTo({ path: '/user', query: { next: route.fullPath } })
    return
  }
  pending.value = true
  errorMessage.value = ''
  notice.value = ''
  try {
    await setFavorite(titleId.value, !isFavorite.value)
    await Promise.all([refreshState(), refreshFavorites()])
  } catch (error) {
    if (adminErrorStatus(error) === 401) {
      await navigateTo({ path: '/user', query: { next: route.fullPath } })
      return
    }
    errorMessage.value = adminErrorMessage(error, '未能更新收藏，请稍后重试。')
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <section class="title-favorite" aria-labelledby="favorite-heading">
    <h2 id="favorite-heading" class="visually-hidden">收藏</h2>
    <button
      class="btn favorite-button"
      type="button"
      :disabled="pending"
      :aria-pressed="isFavorite"
      :aria-label="isFavorite ? '取消收藏' : '加入收藏'"
      data-test="title-favorite"
      @click="toggle"
    >
      <span class="favorite-mark" aria-hidden="true">{{ isFavorite ? '★' : '☆' }}</span>
      <span>{{ isFavorite ? '已收藏' : '收藏' }}</span>
    </button>
    <p v-if="notice" class="favorite-note" role="status" data-test="title-favorite-status">{{ notice }}</p>
    <p v-else-if="!signedIn" class="favorite-note">登录后可以收藏影片，并在这里找到它们。</p>
    <p v-if="errorMessage" class="favorite-error" role="alert">{{ errorMessage }}</p>
  </section>
</template>

<style scoped>
.title-favorite {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: .5rem .9rem;
  margin-block-start: .9rem;
}
.favorite-button[aria-pressed='true'] {
  border-color: var(--accent);
  color: var(--accent-strong);
}
.favorite-mark { font-size: 1.05rem; line-height: 1; }
.favorite-note { margin: 0; color: var(--text-muted); font-size: .85rem; }
.favorite-error { margin: 0; color: var(--danger); font-size: .85rem; }
</style>
