// Builds a self-contained demo library so the interface can be reviewed with
// realistic content. It never touches the real database or media folder:
// everything lands under .demo/ and is served by a separate port.
import { createHash } from 'node:crypto'
import { mkdir, writeFile, copyFile, cp, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'

const root = '.demo'
const media = join(root, 'media')
const dbPath = join(root, 'library.sqlite')
// Images are cached outside the demo root so a rebuild never needs the network
// again, and a flaky download only costs a retry on the missing files.
const cache = '.demo-assets'

// Stills are cinematic, royalty-free photographs. Posters are composed locally from
// these stills with the film's own title burned in, so artwork always matches the
// title and no recognisable third-party poster is passed off as this library's.
// Content lives in its own module so titles and artwork stay in sync.
import { films } from './demo-content.mjs'

async function download(url, target) {
  let lastError
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (!response.ok) throw new Error(`${response.status} ${url}`)
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length < 1024) throw new Error(`too small: ${buffer.length}B`)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, buffer)
      return buffer.length
    } catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 600 * attempt))
    }
  }
  throw lastError
}

// Cached files are copied into the demo media root. Passing no URL means the
// asset must already be cached, keeping the reseed fully offline.
async function cacheImage(url, name) {
  const cached = join(cache, name)
  try {
    return { file: cached, bytes: (await stat(cached)).size }
  } catch { /* not cached yet */ }
  if (!url) throw new Error(`not cached: ${name}`)
  const bytes = await download(url, cached)
  return { file: cached, bytes }
}

await rm(root, { recursive: true, force: true })
await mkdir(media, { recursive: true })
await mkdir(join(media, 'posters'), { recursive: true })
// Locally composed posters live beside the media so a reseed keeps them.
await rm(join(media, 'posters'), { recursive: true, force: true })
await mkdir(join(media, 'posters'), { recursive: true })
await cp(join(cache, 'posters'), join(media, 'posters'), { recursive: true, force: true }).catch(() => {})

// A 2 MiB stand-in video keeps every play button functional without shipping a film.
const sample = join('tests', 'fixtures', 'seek.mp4')
const videos = []

for (const [index, film] of films.entries()) {
  const posterFile = `posters/${String(index + 1).padStart(2, '0')}.jpg`
  const backdropFile = `posters/${String(index + 1).padStart(2, '0')}-wide.jpg`
  let backdropPath = null
  try {
    // `still` names a cached photograph (still-01.jpg …); the demo runs offline
    // from here, so a missing cache entry simply leaves the backdrop unset.
    const still = await cacheImage(null, `${film.still}.jpg`)
    await mkdir(dirname(join(media, backdropFile)), { recursive: true })
    await copyFile(still.file, join(media, backdropFile))
    backdropPath = backdropFile
  } catch (error) {
    // An empty path exercises the designed fallback instead of a broken image.
    console.warn(`still failed ${film.title}: ${error.message}`)
  }
  film.backdropPath = backdropPath
  // Posters are composed locally (title burned in) and simply skipped when absent.
  film.posterPath = existsSync(join(media, posterFile)) ? posterFile : null

  const episodeCount = film.kind === 'series' ? film.episodes : 1
  const files = []
  for (let episode = 1; episode <= episodeCount; episode++) {
    const name = film.kind === 'series' ? `series-${index}-${episode}.mp4` : `movie-${index}.mp4`
    const target = join(media, 'demo', name)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(sample, target)
    files.push({ relative: `demo/${name}`, episode })
  }
  videos.push({ film, files })
}

const { openDatabase } = await import('../server/db/database.ts')
const { libraryStore } = await import('../server/db/library.ts')

const db = openDatabase(dbPath)
const store = libraryStore(db)

const now = Date.now()
store.transact(() => {
  for (const [index, { film, files }] of videos.entries()) {
    const titleId = store.createTitle(film.kind, {
      title: film.title,
      year: film.year,
      description: film.description,
      poster_path: film.posterPath,
      original_title: film.original,
      genres: JSON.stringify(film.genres),
      region: film.region,
      rating: film.rating,
      runtime: film.runtime,
      director: film.director,
      cast_members: JSON.stringify(film.cast),
      backdrop_path: film.backdropPath,
    }, `demo:${film.title}`)
    for (const file of files) {
      const episodeId = film.kind === 'series'
        ? store.createEpisode(titleId, 1, file.episode, null)
        : null
      const id = randomUUID()
      store.createFile({
        relative_path: file.relative,
        path_key: file.relative.toLowerCase(),
        size: 1947385,
        mtime: 1_700_000_000 + index,
        state: 'published',
        available: 1,
        valid_mp4: 1,
        reason: null,
        source: 'upload',
        title_id: titleId,
        episode_id: episodeId,
      })
      void id
    }
  }
})
const count = db.prepare('SELECT COUNT(*) AS n FROM titles').get().n
console.log(`demo library ready: ${count} titles, ${videos.length} videos`)
db.close()
void createHash
