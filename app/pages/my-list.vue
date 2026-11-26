<script setup lang="ts">
import type { LibraryCard } from '#shared/types/library'
import MovieCard from '~/components/public/MovieCard.vue'
import { useFavorites, useUserSession } from '~/composables/useUser'

useSeoMeta({ title: '我的收藏 · 夜灯', robots: 'noindex, nofollow' })

const route = useRoute()
const { signedIn } = await useUserSession()
const { items, refresh, set } = await useFavorites()
const pendingId = ref<string | null>(null)
const errorMessage = ref('')

async function remove(id: string) {
  if (pendingId.value) return
  pendingId.value = id
  errorMessage.value = ''
  try {
    await set(id, false)
  } catch {
    errorMessage.value = '未能取消收藏，请稍后重试。'
  } finally {
    pendingId.value = null
  }
}

const signIn = computed(() => ({ path: '/user', query: { next: route.fullPath } }))
const count = computed(() => items.value.length)
void refresh
</script>

<template>
  <div class="my-list">
    <header class="shell list-head">
      <p class="eyebrow">我的收藏</p>
      <h1>收藏夹</h1>
      <p v-if="signedIn && count" class="list-lede">{{ count }} 部影片 · 按加入时间排列</p>
      <p v-else-if="signedIn" class="list-lede">在影片详情页点击收藏，影片会出现在这里。</p>
      <p v-else class="list-lede">登录后可以收藏影片，并在任意设备上找回。</p>
    </header>

    <div class="shell">
      <div v-if="!signedIn" class="state">
        <h2>登录后查看收藏</h2>
        <p>注册一个账户即可收藏影片，收藏保存在这台服务器上。</p>
        <NuxtLink class="btn btn--primary" :to="signIn">登录或注册</NuxtLink>
      </div>

      <div v-else-if="!count" class="state">
        <h2>收藏夹还是空的</h2>
        <p>去片库挑几部喜欢的影片，点一下收藏就能在这里找到。</p>
        <NuxtLink to="/browse?kind=movie" class="btn btn--primary">浏览电影</NuxtLink>
      </div>

      <template v-else>
        <p v-if="errorMessage" class="list-error" role="alert">{{ errorMessage }}</p>
        <ul class="list-grid" role="list">
          <li v-for="item in items" :key="item.id" class="list-item">
            <MovieCard :item="item" />
            <button
              class="list-remove"
              type="button"
              :disabled="pendingId === item.id"
              :aria-label="`从收藏中移除：${item.title}`"
              data-test="favorite-remove"
              @click="remove(item.id)"
            >移除</button>
          </li>
        </ul>
      </template>
    </div>
  </div>
</template>

<style scoped>
.my-list { padding-block: calc(var(--header-h) + clamp(1.5rem, 4vw, 3rem)) clamp(2rem, 5vw, 4rem); }
.list-head { display: grid; gap: 0.55rem; padding-block-end: clamp(1.4rem, 3vw, 2.2rem); }
.list-head h1 { font-size: clamp(1.9rem, 4vw, 3rem); font-weight: 700; }
.list-lede { margin: 0; color: var(--text-secondary); font-size: 0.92rem; }
.state { display: grid; justify-items: start; gap: 0.9rem; max-inline-size: 32rem; padding-block: 2.5rem; color: var(--text-secondary); }
.state h2 { font-size: 1.25rem; color: var(--text); }
.list-error { margin: 0 0 1rem; color: var(--danger); font-size: 0.88rem; }
.list-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr)); gap: clamp(0.9rem, 1.8vw, 1.5rem) clamp(0.7rem, 1.2vw, 1.1rem); margin: 0; padding: 0; list-style: none; }
.list-item { position: relative; min-inline-size: 0; }
.list-remove {
  margin-block-start: 0.45rem;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.76rem;
  text-decoration: underline;
  text-underline-offset: 0.2em;
}
.list-remove:hover { color: var(--danger); }
@media (max-width: 34rem) {
  .list-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
