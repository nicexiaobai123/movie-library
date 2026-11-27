<script setup lang="ts">
import type { ActorList } from '#shared/types/library'

useSeoMeta({ title: '演员 · 夜灯', description: '按演员浏览片库中的电影与剧集。' })

const { data, status, refresh } = await useFetch<ActorList>('/api/library/actors', { deep: false })
const actors = computed(() => data.value?.items ?? [])
const total = computed(() => actors.value.reduce((sum, actor) => sum + actor.count, 0))
</script>

<template>
  <div class="actors-page">
    <header class="shell actors-head">
      <p class="eyebrow">演员</p>
      <h1>演员</h1>
      <p class="actors-lede">片库中出场过的演员，按作品数量排列。点开可以看他的全部作品。</p>
    </header>

    <div class="shell">
      <div v-if="status === 'pending' || status === 'idle'" class="actor-grid" aria-hidden="true">
        <div v-for="n in 8" :key="n" class="skeleton-actor" />
      </div>
      <div v-else-if="status === 'error'" class="actors-empty" role="alert">
        <p>暂时无法读取演员列表。</p>
        <button class="btn btn--ghost" type="button" @click="refresh()">重试</button>
      </div>
      <div v-else-if="!actors.length" class="actors-empty">
        <h2>还没有演员资料</h2>
        <p>
          上传或发布视频时，把文件名写成「<strong>杨幂-古剑奇谭-dx123</strong>」这样的格式，
          第一段会被识别为演员、第二段是真实片名、最后一段是发片标识。这样片名不会带上演员名字，
          演员也会自动出现在这里。
        </p>
        <NuxtLink to="/admin" class="btn btn--primary">去后台上传</NuxtLink>
      </div>

      <template v-else>
        <p class="actors-count">{{ actors.length }} 位演员 · {{ total }} 次出演</p>
        <ul class="actor-grid" role="list" data-test="actor-grid">
          <li v-for="actor in actors" :key="actor.name">
            <NuxtLink :to="`/actors/${encodeURIComponent(actor.name)}`" class="actor-card">
              <span class="actor-avatar" aria-hidden="true">{{ Array.from(actor.name)[0] }}</span>
              <span class="actor-body">
                <span class="actor-name">{{ actor.name }}</span>
                <span class="actor-count">{{ actor.count }} 部作品</span>
              </span>
              <svg class="actor-arrow" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="m9.5 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </NuxtLink>
          </li>
        </ul>
      </template>
    </div>
  </div>
</template>

<style scoped>
.actors-page { padding-block: calc(var(--header-h) + clamp(1.5rem, 4vw, 3rem)) clamp(2rem, 5vw, 4rem); }
.actors-head { display: grid; gap: 0.55rem; padding-block-end: clamp(1.4rem, 3vw, 2.2rem); }
.actors-head h1 { font-size: clamp(1.9rem, 4vw, 3rem); font-weight: 700; }
.actors-lede { margin: 0; color: var(--text-secondary); font-size: 0.95rem; }
.actors-count { margin: 0 0 1.2rem; color: var(--text-muted); font-size: 0.84rem; font-variant-numeric: tabular-nums; }

.actor-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.actor-card {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  box-sizing: border-box;
  min-block-size: 4.2rem;
  padding: 0.75rem 0.9rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text);
  text-decoration: none;
  transition: background-color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
}
.actor-card:hover { border-color: var(--border-strong); background: var(--bg-hover); }
.actor-card:active { transform: scale(0.99); }
.actor-card:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px; }
.actor-avatar {
  display: grid;
  place-items: center;
  flex: none;
  inline-size: 2.4rem;
  block-size: 2.4rem;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 1rem;
  font-weight: 600;
}
.actor-body { display: grid; gap: 0.1rem; min-inline-size: 0; flex: 1; }
.actor-name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 0.92rem; font-weight: 600; }
.actor-count { color: var(--text-muted); font-size: 0.76rem; font-variant-numeric: tabular-nums; }
.actor-arrow { inline-size: 1rem; block-size: 1rem; flex: none; color: var(--text-muted); }

.actors-empty { display: grid; justify-items: start; gap: 0.9rem; max-inline-size: 40rem; padding-block: 2.5rem; color: var(--text-secondary); }
.actors-empty h2 { font-size: 1.2rem; color: var(--text); }
.actors-empty p { margin: 0; line-height: 1.8; }
.actors-empty strong { color: var(--accent); font-weight: 600; }
.skeleton-actor { block-size: 4.2rem; border-radius: var(--radius-sm); background: linear-gradient(100deg, #15171b 20%, #1d2026 40%, #15171b 60%); background-size: 220% 100%; animation: shimmer 1.5s linear infinite; }
@keyframes shimmer { to { background-position: -220% 0; } }

@media (max-width: 34rem) {
  .actor-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
