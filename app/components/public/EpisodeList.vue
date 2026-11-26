<script setup lang="ts">
import type { LibraryEpisode } from '#shared/types/library'
import PublicIcon from './Icon.vue'

const props = withDefaults(defineProps<{
  titleId: string
  episodes: LibraryEpisode[]
  activeEpisodeId?: string
}>(), {})

const seasons = computed(() => {
  const groups = new Map<number, LibraryEpisode[]>()
  const ordered = [...props.episodes].sort((a, b) => a.season - b.season || a.episode - b.episode)
  for (const episode of ordered) {
    const season = groups.get(episode.season)
    if (season) season.push(episode)
    else groups.set(episode.season, [episode])
  }
  return Array.from(groups, ([number, episodes]) => ({ number, episodes }))
})

function watchLocation(episode: LibraryEpisode) {
  return { path: `/watch/${encodeURIComponent(props.titleId)}`, query: { episode: episode.id } }
}

function episodeLabel(episode: LibraryEpisode) {
  return `第 ${episode.season} 季第 ${episode.episode} 集`
}

// Season headers only earn their space when a show actually has more than one.
const multipleSeasons = computed(() => seasons.value.length > 1)
</script>

<template>
  <section class="episodes" aria-label="剧集列表">
    <div class="episodes-heading">
      <h2>剧集列表</h2>
      <span>{{ episodes.length }} 集</span>
    </div>

    <p v-if="!seasons.length" class="episodes-empty">这部剧集还没有录入分集。</p>
    <div v-else class="seasons">
      <section v-for="season in seasons" :key="season.number" class="season">
        <h3 v-if="multipleSeasons" class="season-heading">第 {{ season.number }} 季</h3>
        <ul class="episode-grid" role="list">
          <li v-for="episode in season.episodes" :key="episode.id">
            <NuxtLink
              v-if="episode.media?.available"
              v-slot="{ href, navigate }"
              :to="watchLocation(episode)"
              custom
            >
              <!-- The whole tile is the play target: one link per episode instead of
                   a row of repeated buttons. -->
              <a
                :href="href ?? undefined"
                class="episode-tile"
                :class="{ 'is-current': episode.id === activeEpisodeId }"
                :aria-current="episode.id === activeEpisodeId ? 'true' : undefined"
                :aria-label="`${episode.id === activeEpisodeId ? '正在播放：' : '播放'}${episodeLabel(episode)}${episode.title ? `，${episode.title}` : ''}`"
                @click="navigate"
              >
                <span class="tile-number">{{ episode.episode }}</span>
                <span class="tile-body">
                  <!-- The number already says which episode it is; the name is the
                       only thing worth repeating, so it takes the whole line. -->
                  <span class="tile-label">{{ episode.title || `第 ${episode.episode} 集` }}</span>
                </span>
                <span class="tile-icon" aria-hidden="true">
                  <PublicIcon name="play" />
                </span>
              </a>
            </NuxtLink>
            <span v-else class="episode-tile is-unavailable" :aria-label="`${episodeLabel(episode)}不可用`">
              <span class="tile-number">{{ episode.episode }}</span>
              <span class="tile-body">
                <span class="tile-label">第 {{ episode.episode }} 集</span>
                <span class="tile-name">文件不可用</span>
              </span>
            </span>
          </li>
        </ul>
      </section>
    </div>
  </section>
</template>

<style scoped>
.episodes:focus-visible {
  outline: 2px solid var(--accent-strong);
  outline-offset: 4px;
}

.episodes-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.35rem 1rem;
  padding-block: clamp(1.25rem, 3vw, 2rem) 1rem;
  border-block-start: 1px solid var(--border);
}

.episodes-heading h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(1.25rem, 2.5vw, 1.65rem);
  font-weight: 600;
  line-height: 1.4;
}

.episodes-heading span,
.episodes-empty {
  color: var(--text-muted);
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}

.seasons { display: grid; gap: 1.1rem; }
.season { min-inline-size: 0; }

.season-heading {
  margin: 0 0 0.7rem;
  color: var(--accent);
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  line-height: 1.5;
}

/* Compact horizontal grid: many episodes stay scannable without a tall list.
   auto-fit fills the row, and the min width leaves room for the label text. */
.episode-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.episode-grid li { min-inline-size: 0; }

.episode-tile {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.55rem;
  box-sizing: border-box;
  min-block-size: 3.25rem;
  padding: 0.55rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-secondary);
  text-decoration: none;
  transition: background-color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
}

.episode-tile:hover {
  border-color: var(--border-strong);
  background: var(--bg-hover);
  color: var(--text);
}

.episode-tile:active { transform: scale(0.985); }
.episode-tile:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px; }

.episode-tile.is-current {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--text);
}

.tile-number {
  flex: none;
  min-inline-size: 1.6rem;
  color: var(--text-muted);
  font-family: var(--font-display);
  font-size: 0.95rem;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  text-align: center;
}

.episode-tile.is-current .tile-number { color: var(--accent); }

/* One line per tile: a big episode number, then the name (or the default label). */
.tile-body {
  display: block;
  min-inline-size: 0;
  flex: 1;
}

.tile-label {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 0.8rem;
  font-weight: 500;
  line-height: 1.3;
}

.tile-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--text-muted);
  font-size: 0.72rem;
  line-height: 1.3;
}

.tile-icon {
  flex: none;
  display: grid;
  place-items: center;
  inline-size: 1.5rem;
  block-size: 1.5rem;
  border-radius: 50%;
  background: rgb(255 255 255 / 0.06);
  color: var(--text-muted);
  transition: background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}

.tile-icon :deep(svg) { inline-size: 0.8rem; block-size: 0.8rem; }

.episode-tile:hover .tile-icon,
.episode-tile.is-current .tile-icon {
  background: var(--accent);
  color: var(--on-accent);
}

.episode-tile.is-unavailable {
  border-style: dashed;
  background: transparent;
  cursor: default;
}

.episode-tile.is-unavailable .tile-number,
.episode-tile.is-unavailable .tile-body { opacity: 0.55; }

@media (max-width: 34rem) {
  .episode-grid { grid-template-columns: repeat(auto-fill, minmax(6.4rem, 1fr)); }
  .episode-tile { min-block-size: 3rem; padding: 0.5rem 0.55rem; }
  .tile-icon { display: none; }
}
</style>
