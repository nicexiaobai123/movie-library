<template>
  <div class="site" :class="{ 'site--flush': flushFooter }">
    <a class="skip" href="#main">跳到主要内容</a>
    <NuxtRouteAnnouncer />
    <AppHeader />
    <main id="main" class="site-main" tabindex="-1">
      <slot />
    </main>
    <AppFooter />
  </div>
</template>

<script setup lang="ts">
import AppHeader from '~/components/public/AppHeader.vue'
import AppFooter from '~/components/public/AppFooter.vue'

// Tool pages fill the window edge to edge, so the footer's usual breathing room is
// dropped there. Desktop-only: on phones the gap helps separate the sections.
const route = useRoute()
const flushFooter = computed(() => route.path.startsWith('/admin'))
</script>

<style scoped>
.site { display: flex; flex-direction: column; min-block-size: 100vh; min-block-size: 100svh; }
/* Admin pages run to the footer, so the gap that separates content on the public
   site would just look like a missing row there. `:deep` reaches the child scope. */
.site--flush :deep(.footer) { margin-block-start: 0; }
.site-main { flex: 1; min-inline-size: 0; }
/* The skip link moves focus here; the container itself needs no visible ring. */
.site-main:focus-visible { outline: none; }
.skip {
  position: fixed;
  z-index: 100;
  inset-block-start: 0.7rem;
  inset-inline-start: 0.7rem;
  padding: 0.6rem 1rem;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--on-accent);
  font-size: 0.85rem;
  font-weight: 600;
  text-decoration: none;
  transform: translateY(calc(-100% - 1.2rem));
  transition: transform var(--dur-fast) var(--ease);
}
.skip:focus-visible { transform: none; }
</style>
