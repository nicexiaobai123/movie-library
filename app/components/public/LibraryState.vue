<script setup lang="ts">
defineProps<{
  variant: 'empty' | 'search' | 'error' | 'loading' | 'unavailable'
  title: string
  description?: string
  heading?: 'h1' | 'h2' | 'h3'
}>()
</script>

<template>
  <div class="library-state" :class="`library-state--${variant}`">
    <div class="library-state-copy">
      <div :role="variant === 'error' ? 'alert' : variant === 'loading' ? 'status' : undefined">
        <p v-if="variant === 'empty'" class="library-state-kicker">从这里开始</p>
        <component :is="heading ?? 'h2'" class="library-state-heading">{{ title }}</component>
        <p v-if="description" class="library-state-description">{{ description }}</p>
      </div>
      <div v-if="$slots.default" class="library-state-actions">
        <slot />
      </div>
    </div>
    <!-- A film reel, not a placeholder title or a fabricated piece of content. -->
    <svg v-if="variant === 'empty'" class="library-state-art" viewBox="0 0 400 235" fill="none" aria-hidden="true" focusable="false">
      <g stroke="currentColor" stroke-width="1">
        <circle cx="151" cy="112" r="84" />
        <circle cx="151" cy="112" r="73" />
        <circle cx="151" cy="66" r="17" />
        <circle cx="195" cy="98" r="17" />
        <circle cx="178" cy="149" r="17" />
        <circle cx="124" cy="149" r="17" />
        <circle cx="107" cy="98" r="17" />
        <circle cx="151" cy="112" r="9" />
        <path d="M212 170c29 16 52 20 79 13 32-8 50-30 85-27" />
        <path d="M204 178c31 19 59 24 89 16 31-8 51-29 83-26" />
        <path d="m223 180-4 9m16-4-3 10m16-7-2 10m15-9v10m14-11 2 10m12-13 3 10m11-14 4 10m10-15 4 10m10-15 4 9m11-13 3 9m11-11 2 9" />
      </g>
      <circle cx="151" cy="112" r="3" fill="var(--accent)" />
    </svg>
  </div>
</template>

<style scoped>
.library-state {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
  min-block-size: 13rem;
  padding: clamp(2.25rem, 5vw, 4.5rem) 0;
}
.library-state--empty { min-block-size: 20rem; padding-block: clamp(2rem, 4vw, 3.75rem); }
.library-state-copy { max-inline-size: 38rem; min-inline-size: 0; }
.library-state-kicker { margin: 0 0 1.1rem; color: var(--accent); font-size: .78rem; font-weight: 600; letter-spacing: .12em; }
.library-state-heading { margin: 0; overflow-wrap: anywhere; font-family: var(--font-display); font-size: clamp(1.3rem, 2.4vw, 1.7rem); font-weight: 500; line-height: 1.45; }
.library-state-description { max-inline-size: 38rem; margin: .65rem 0 0; overflow-wrap: anywhere; color: var(--text-muted); font-size: .94rem; line-height: 1.8; text-wrap: pretty; }
.library-state-actions { display: flex; flex-wrap: wrap; gap: .6rem; margin-block-start: 1.5rem; }
.library-state-art { flex: 0 1 26rem; inline-size: min(36%, 26rem); color: #8f897a; opacity: .7; }
.library-state--error .library-state-heading { color: var(--danger); }

@media (max-width: 38rem) {
  .library-state--empty { position: relative; align-items: flex-start; min-block-size: 19rem; padding-block: 2.25rem 6rem; }
  .library-state-copy { position: relative; z-index: 1; }
  .library-state-art { position: absolute; inset-inline-end: -.5rem; inset-block-end: .5rem; inline-size: 9rem; opacity: .38; }
}
</style>
