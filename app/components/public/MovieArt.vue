<script setup lang="ts">
import type { LibraryKind } from '#shared/types/library'

// A single image slot that keeps a fixed aspect ratio, reserves space while the
// image loads and falls back to a styled title card instead of a broken icon.
const props = withDefaults(defineProps<{
  src: string | null
  title: string
  year?: number | null
  kind?: LibraryKind
  ratio?: 'poster' | 'wide'
  priority?: boolean
  showCaption?: boolean
}>(), {
  ratio: 'poster',
  priority: false,
  showCaption: true,
})

const image = ref<HTMLImageElement | null>(null)
const failed = ref(false)
const loaded = ref(false)
watch(() => props.src, () => {
  failed.value = false
  loaded.value = false
})
// A cached image can finish before hydration attaches @load, so the element is
// re-checked whenever it appears or the source changes.
function syncFromElement(element: HTMLImageElement | null) {
  if (!element) return
  if (element.complete) {
    if (element.naturalWidth > 0) loaded.value = true
    else failed.value = true
  }
}
watch(image, element => syncFromElement(element), { flush: 'post' })
onMounted(() => syncFromElement(image.value))

const initial = computed(() => Array.from(props.title.trim())[0] ?? '')
</script>

<template>
  <div class="art" :class="`art--${ratio}`" :data-kind="kind">
    <img
      v-if="src && !failed"
      ref="image"
      :key="src"
      :src="src"
      alt=""
      :loading="priority ? 'eager' : 'lazy'"
      :fetchpriority="priority ? 'high' : undefined"
      decoding="async"
      :class="{ 'is-loaded': loaded }"
      @load="loaded = true"
      @error="failed = true"
    >    <div v-else class="art-fallback">
      <span class="art-initial" aria-hidden="true">{{ initial }}</span>
      <span v-if="showCaption" class="art-caption">{{ title }}</span>
    </div>
    <slot />
  </div>
</template>

<style scoped>
.art {
  position: relative;
  overflow: hidden;
  inline-size: 100%;
  background: linear-gradient(160deg, #22252b, #121418 70%);
  isolation: isolate;
}
.art--poster { aspect-ratio: 2 / 3; }
.art--wide { aspect-ratio: 16 / 9; }
.art img {
  position: absolute;
  inset: 0;
  inline-size: 100%;
  block-size: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity var(--dur) var(--ease);
}
.art img.is-loaded { opacity: 1; }
.art-fallback {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 0.35rem;
  box-sizing: border-box;
  padding: 12%;
  background:
    radial-gradient(120% 80% at 15% 0%, rgb(214 184 117 / 0.12), transparent 60%),
    linear-gradient(160deg, #262a31, #101216 75%);
}
.art-initial {
  position: absolute;
  inset-block-start: 6%;
  inset-block-end: auto;
  inset-inline-start: 8%;
  color: rgb(255 255 255 / 0.05);
  font-family: var(--font-display);
  font-size: 34cqi;
  font-weight: 700;
  line-height: 1;
}
.art-caption {
  position: relative;
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow-wrap: anywhere;
  color: rgb(255 255 255 / 0.9);
  font-size: clamp(0.75rem, 13cqi, 1.05rem);
  font-weight: 600;
  line-height: 1.3;
  text-wrap: balance;
}
@container (min-width: 1px) { .art { container-type: inline-size; } }
</style>
