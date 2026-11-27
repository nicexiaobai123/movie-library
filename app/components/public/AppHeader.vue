<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useUserSession } from '~/composables/useUser'
import SearchBox from '~/components/public/SearchBox.vue'

const route = useRoute()
const { username } = await useUserSession()
const scrolled = ref(false)
const menuOpen = ref(false)
// Only the client knows the scroll offset and the session, so those styles are
// applied after mount to keep the server and client markup identical.
const mounted = ref(false)

// The bar starts transparent over the hero and solidifies once the page moves.
function onScroll() {
  scrolled.value = window.scrollY > 24
}
onMounted(() => {
  mounted.value = true
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
})
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))
watch(() => route.fullPath, () => { menuOpen.value = false })

// Movies and series are separate top-level destinations; there is no generic
// "browse" entry, because the two kinds are the only distinction worth a tab.
const links = [
  { to: '/', label: '首页' },
  { to: '/browse?kind=movie', label: '电影' },
  { to: '/browse?kind=series', label: '剧集' },
  { to: '/actors', label: '明星' },
  { to: '/my-list', label: '我的收藏' },
]

// A tab is active when its path and `kind` both match, so 电影 and 剧集 never
// light up together.
function isActive(link: { to: string }) {
  const [path, search] = link.to.split('?')
  if (path !== route.path) return false
  const kind = new URLSearchParams(search ?? '').get('kind')
  if (!kind) return true
  return (route.query.kind ?? '') === kind
}

const solid = computed(() => mounted.value && (scrolled.value || route.path !== '/'))
const accountName = computed(() => username.value)
</script>

<template>
  <header class="nav" :class="{ 'nav--solid': solid }">
    <div class="nav-inner">
      <NuxtLink to="/" class="brand" aria-label="夜灯 · 私人影视库 首页">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 28 28" focusable="false"><circle cx="14" cy="14" r="13" fill="none" stroke="currentColor" stroke-opacity=".45" /><path d="M9 9.5h10l2.6 7.5H6.4z" fill="currentColor" /><path d="M14 17v5m-3 0h6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
        </span>
        <span class="brand-text">夜灯</span>
      </NuxtLink>

      <nav class="nav-links" aria-label="主导航">
        <NuxtLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="nav-link"
          :class="{ 'is-active': isActive(link) }"
        >{{ link.label }}</NuxtLink>
      </nav>

      <div class="nav-actions">
        <SearchBox class="nav-search" />
        <NuxtLink to="/my-list" class="nav-icon" aria-label="我的收藏">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 4.5l2.3 4.9 5.2.7-3.8 3.7.9 5.3L12 16.6l-4.6 2.5.9-5.3-3.8-3.7 5.2-.7z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" /></svg>
        </NuxtLink>
        <NuxtLink to="/user" class="nav-account" :title="accountName ?? '登录'" data-test="nav-account">
          <span class="nav-avatar" aria-hidden="true">{{ accountName ? Array.from(accountName)[0] : '登' }}</span>
          <span class="nav-account-label" :class="{ 'is-signed-in': accountName }">{{ accountName ?? '登录' }}</span>
        </NuxtLink>
        <button
          class="nav-burger"
          type="button"
          :aria-expanded="menuOpen"
          aria-controls="mobile-menu"
          aria-label="打开导航菜单"
          @click="menuOpen = !menuOpen"
        >
          <span /><span /><span />
        </button>
      </div>
    </div>

    <div v-if="menuOpen" id="mobile-menu" class="mobile-menu">
      <NuxtLink v-for="link in links" :key="link.to" :to="link.to" class="mobile-link">{{ link.label }}</NuxtLink>
      <NuxtLink to="/user" class="mobile-link">{{ accountName ? `账户：${accountName}` : '登录 / 注册' }}</NuxtLink>
      <NuxtLink to="/admin" class="mobile-link mobile-link--muted">管理后台</NuxtLink>
    </div>
  </header>
</template>

<style scoped>
.nav {
  position: fixed;
  z-index: 50;
  inset-block-start: 0;
  inset-inline: 0;
  background: linear-gradient(180deg, rgb(8 9 11 / 0.78), transparent);
  transition: background-color var(--dur) var(--ease), backdrop-filter var(--dur) var(--ease), border-color var(--dur) var(--ease);
  border-block-end: 1px solid transparent;
}
.nav--solid {
  background: rgb(8 9 11 / 0.92);
  backdrop-filter: saturate(140%) blur(14px);
  border-block-end-color: var(--border);
}
.nav-inner {
  display: flex;
  align-items: center;
  gap: clamp(0.75rem, 2.2vw, 2.4rem);
  inline-size: min(100%, var(--shell-max));
  block-size: var(--header-h);
  margin-inline: auto;
  padding-inline: var(--shell-pad);
}
.brand { display: inline-flex; align-items: center; gap: 0.55rem; text-decoration: none; flex: none; }
.brand-mark { display: grid; place-items: center; inline-size: 1.6rem; block-size: 1.6rem; color: var(--accent); }
.brand-mark svg { inline-size: 100%; block-size: 100%; }
.brand-text { font-size: 1.15rem; font-weight: 700; letter-spacing: 0.14em; }

.nav-links { display: flex; align-items: center; gap: clamp(0.5rem, 1.6vw, 1.5rem); flex: 1; min-inline-size: 0; }
.nav-link {
  position: relative;
  padding-block: 0.4rem;
  color: var(--text-secondary);
  font-size: 0.88rem;
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;
  transition: color var(--dur-fast) var(--ease);
}
.nav-link::after {
  position: absolute;
  inset-inline: 0;
  inset-block-end: 0;
  block-size: 2px;
  border-radius: 2px;
  background: var(--accent);
  content: '';
  transform: scaleX(0);
  transition: transform var(--dur) var(--ease);
}
.nav-link:hover, .nav-link.is-active { color: var(--text); }
.nav-link.is-active::after { transform: scaleX(1); }

.nav-actions { display: flex; align-items: center; gap: 0.45rem; flex: none; }
.nav-search { inline-size: clamp(8rem, 15vw, 14rem); }
.nav-icon {
  display: grid;
  place-items: center;
  inline-size: 38px;
  block-size: 38px;
  border-radius: var(--radius-pill);
  color: var(--text-secondary);
  transition: color var(--dur-fast) var(--ease), background-color var(--dur-fast) var(--ease);
}
.nav-icon svg { inline-size: 1.15rem; block-size: 1.15rem; }
.nav-icon:hover { background: rgb(255 255 255 / 0.08); color: var(--text); }
.nav-account {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.2rem 0.55rem 0.2rem 0.2rem;
  border-radius: var(--radius-pill);
  color: var(--text-secondary);
  text-decoration: none;
  transition: background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.nav-account:hover { background: rgb(255 255 255 / 0.08); color: var(--text); }
.nav-avatar {
  display: grid;
  place-items: center;
  inline-size: 26px;
  block-size: 26px;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.75rem;
  font-weight: 700;
}
.nav-account-label { max-inline-size: 7rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.82rem; }

.nav-burger {
  display: none;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  inline-size: 40px;
  block-size: 40px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
}
.nav-burger span { block-size: 1.5px; background: var(--text); border-radius: 2px; }
.nav-burger span:nth-child(2) { inline-size: 70%; }

.mobile-menu {
  display: grid;
  gap: 0.1rem;
  padding: 0.5rem var(--shell-pad) 1rem;
  background: rgb(8 9 11 / 0.98);
  border-block-end: 1px solid var(--border);
}
.mobile-link {
  padding: 0.8rem 0;
  border-block-end: 1px solid var(--border);
  color: var(--text);
  font-size: 0.95rem;
  text-decoration: none;
}
.mobile-link--muted { color: var(--text-muted); border-block-end: 0; }

@media (max-width: 62rem) {
  .nav-links { display: none; }
  .nav-burger { display: flex; }
  .nav-inner { justify-content: space-between; }
}
@media (max-width: 34rem) {
  .nav-search { inline-size: 2.4rem; }
  .nav-account-label { display: none; }
  .nav-account { padding: 0; }
}
</style>
