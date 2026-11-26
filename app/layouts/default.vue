<template>
  <div class="site">
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
</script>

<style scoped>
.site { display: flex; flex-direction: column; min-block-size: 100vh; min-block-size: 100svh; }
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
