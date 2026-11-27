import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  ActorSummary, AdminTitle, BrowseQuery, BrowseResult, HomeData, HomeRail, LibraryCard, LibraryEpisode, LibraryKind,
  PlayableMedia, ScanResult, TitleDetail,
} from '../../shared/types/library.ts'
import { transaction } from './database.ts'

export interface TitleRecord {
  id: string
  kind: LibraryKind
  title: string
  year: number | null
  description: string
  poster_path: string | null
  identity_key: string | null
  created_at: string
  original_title: string | null
  genres: string
  region: string | null
  rating: number | null
  runtime: number | null
  director: string | null
  cast_members: string
  backdrop_path: string | null
}

export type TitleMetadata = Pick<TitleRecord,
  'title' | 'year' | 'description' | 'poster_path' | 'original_title' | 'genres' | 'region'
  | 'rating' | 'runtime' | 'director' | 'cast_members' | 'backdrop_path'>

interface EpisodeRecord {
  id: string
  title_id: string
  season: number
  episode: number
  title: string | null
}

export interface MediaRecord {
  id: string
  relative_path: string
  path_key: string
  size: number
  mtime: number
  state: 'published' | 'pending'
  available: 0 | 1
  valid_mp4: 0 | 1
  reason: string | null
  source: 'scan' | 'upload'
  title_id: string | null
  episode_id: string | null
  added_at: string
  file_version: number
}

export interface AdminMediaRecord extends MediaRecord {
  season: number | null
  episode: number | null
  episode_title: string | null
}

type FileObservation = Pick<MediaRecord, 'relative_path' | 'size' | 'mtime' | 'available' | 'valid_mp4' | 'reason'>
type Association = Pick<MediaRecord, 'state' | 'title_id' | 'episode_id' | 'reason'>
type NewFile = FileObservation & Association & Pick<MediaRecord, 'path_key' | 'source'>
export type ScanRecord = Omit<ScanResult, 'startedAt' | 'finishedAt'> & { started_at: string; finished_at: string }

// JSON columns keep the schema small; a malformed value must never break a page.
export function parseList(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : []
  } catch {
    return []
  }
}

export const serializeList = (value: string[]) => JSON.stringify(value)

const publishedExists = `EXISTS (SELECT 1 FROM media_files m WHERE m.title_id = t.id AND m.state = 'published')`

function posterUrl(row: TitleRecord): string | null {
  return row.poster_path ? `/api/posters/${row.id}` : null
}

function backdropUrl(row: TitleRecord): string | null {
  return row.backdrop_path ? `/api/posters/${row.id}?variant=backdrop` : null
}

export function card(row: TitleRecord & { available?: 0 | 1 }): LibraryCard {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    originalTitle: row.original_title,
    year: row.year,
    posterUrl: posterUrl(row),
    backdropUrl: backdropUrl(row),
    rating: row.rating,
    genres: parseList(row.genres),
    available: Boolean(row.available),
    addedAt: row.created_at,
  }
}

function mediaView(row: Pick<MediaRecord, 'id' | 'size' | 'available'>): PlayableMedia {
  return { id: row.id, size: row.size, available: Boolean(row.available) }
}

const sortSql: Record<BrowseQuery['sort'], string> = {
  newest: 't.created_at DESC, t.rowid DESC',
  rating: 't.rating IS NULL, t.rating DESC, t.created_at DESC',
  year: 't.year IS NULL, t.year DESC, t.created_at DESC',
  title: 't.title COLLATE NOCASE ASC',
}

export function libraryStore(db: DatabaseSync) {
  const selectAdminFile = `SELECT m.*, e.season, e.episode, e.title AS episode_title
    FROM media_files m LEFT JOIN episodes e ON e.id = m.episode_id`
  const sql = {
    published: db.prepare(`SELECT t.*, EXISTS (SELECT 1 FROM media_files p WHERE p.title_id = t.id
        AND p.state = 'published' AND p.available = 1) AS available
      FROM titles t WHERE ${publishedExists} AND t.kind = ? ORDER BY t.created_at DESC, t.rowid DESC`),
    allTitles: db.prepare('SELECT * FROM titles ORDER BY title COLLATE NOCASE, year, rowid'),
    title: db.prepare('SELECT * FROM titles WHERE id = ?'),
    identity: db.prepare('SELECT * FROM titles WHERE identity_key = ?'),
    addTitle: db.prepare(`INSERT INTO titles (id, kind, title, year, description, poster_path, identity_key, created_at,
        original_title, genres, region, rating, runtime, director, cast_members, backdrop_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    editTitle: db.prepare(`UPDATE titles SET title = ?, year = ?, description = ?, poster_path = ?,
        original_title = ?, genres = ?, region = ?, rating = ?, runtime = ?, director = ?, cast_members = ?,
        backdrop_path = ? WHERE id = ?`),
    visibleTitle: db.prepare(`SELECT t.* FROM titles t WHERE t.id = ? AND ${publishedExists}`),
    episode: db.prepare('SELECT * FROM episodes WHERE id = ?'),
    episodeAt: db.prepare('SELECT * FROM episodes WHERE title_id = ? AND season = ? AND episode = ?'),
    addEpisode: db.prepare('INSERT INTO episodes (id, title_id, season, episode, title) VALUES (?, ?, ?, ?, ?)'),
    editEpisode: db.prepare('UPDATE episodes SET season = ?, episode = ?, title = ? WHERE id = ?'),
    publicEpisodes: db.prepare(`SELECT e.*, m.id AS media_id, m.size, m.available
      FROM episodes e JOIN media_files m ON m.episode_id = e.id AND m.state = 'published'
      WHERE e.title_id = ? ORDER BY e.season, e.episode`),
    movie: db.prepare(`SELECT * FROM media_files WHERE title_id = ? AND state = 'published' AND episode_id IS NULL`),
    episodeFile: db.prepare(`SELECT * FROM media_files WHERE episode_id = ? AND state = 'published'`),
    allFiles: db.prepare('SELECT * FROM media_files'),
    adminFiles: db.prepare(`${selectAdminFile} ORDER BY m.added_at DESC, m.rowid DESC`),
    adminFile: db.prepare(`${selectAdminFile} WHERE m.id = ?`),
    publishedFile: db.prepare(`SELECT * FROM media_files WHERE id = ? AND state = 'published'`),
    path: db.prepare('SELECT * FROM media_files WHERE path_key = ?'),
    addFile: db.prepare(`INSERT INTO media_files (id, relative_path, path_key, size, mtime, state,
        available, valid_mp4, reason, source, title_id, episode_id, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    observe: db.prepare(`UPDATE media_files SET relative_path = ?, size = ?, mtime = ?, available = ?, valid_mp4 = ?,
        reason = ?, file_version = file_version + 1 WHERE id = ?`),
    absent: db.prepare(`UPDATE media_files SET available = 0, file_version = file_version + 1
      WHERE id = ? AND file_version = ? AND available = 1`),
    associate: db.prepare('UPDATE media_files SET state = ?, title_id = ?, episode_id = ?, reason = ? WHERE id = ?'),
    lastScan: db.prepare('SELECT * FROM scan_runs ORDER BY finished_at DESC, rowid DESC LIMIT 1'),
    addScan: db.prepare(`INSERT INTO scan_runs (id,state,started_at,finished_at,discovered,indexed,published,pending,unstable,missing,message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    trimScans: db.prepare(`DELETE FROM scan_runs WHERE id IN
      (SELECT id FROM scan_runs ORDER BY finished_at DESC, rowid DESC LIMIT -1 OFFSET 20)`),
    readSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    writeSetting: db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value`),
  }

  const title = (id: string) => sql.title.get(id) as unknown as TitleRecord | undefined
  const movie = (titleId: string) => sql.movie.get(titleId) as unknown as MediaRecord | undefined
  const visibleTitle = (id: string) => sql.visibleTitle.get(id) as unknown as TitleRecord | undefined
  const publishedRows = () => sql.published.all('movie').concat(sql.published.all('series')) as unknown as (TitleRecord & { available: 0 | 1 })[]
  const allPublishedCards = () => publishedRows().map(row => card(row))

  // Filters run in SQL so paging and counting stay correct as the library grows.
  function browse(query: BrowseQuery): BrowseResult {
    const clauses = [publishedExists]
    const params: (string | number)[] = []
    if (query.kind) { clauses.push('t.kind = ?'); params.push(query.kind) }
    if (query.q) { clauses.push('instr(lower(t.title), lower(?)) > 0'); params.push(query.q) }
    if (query.genre) { clauses.push(`EXISTS (SELECT 1 FROM json_each(t.genres) g WHERE g.value = ?)`); params.push(query.genre) }
    if (query.region) { clauses.push('t.region = ?'); params.push(query.region) }
    if (query.yearFrom !== null) { clauses.push('t.year >= ?'); params.push(query.yearFrom) }
    if (query.yearTo !== null) { clauses.push('t.year <= ?'); params.push(query.yearTo) }
    if (query.minRating !== null) { clauses.push('t.rating >= ?'); params.push(query.minRating) }
    if (query.actor) { clauses.push(`EXISTS (SELECT 1 FROM json_each(t.cast_members) a WHERE a.value = ?)`); params.push(query.actor) }
    const where = clauses.join(' AND ')
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM titles t WHERE ${where}`).get(...params) as unknown as { n: number }).n
    const offset = (query.page - 1) * query.pageSize
    const rows = db.prepare(`SELECT t.*, EXISTS (SELECT 1 FROM media_files p WHERE p.title_id = t.id
        AND p.state = 'published' AND p.available = 1) AS available
      FROM titles t WHERE ${where} ORDER BY ${sortSql[query.sort]} LIMIT ? OFFSET ?`)
      .all(...params, query.pageSize, offset) as unknown as (TitleRecord & { available: 0 | 1 })[]
    const facets = allPublishedCards()
    const unique = (values: (string | null)[]) => [...new Set(values.filter((value): value is string => Boolean(value)))].sort()
    const actorNames = [...new Set(publishedRows().flatMap(row => parseList(row.cast_members)))]
    return {
      items: rows.map(row => card(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      facets: {
        genres: unique(facets.flatMap(item => item.genres)),
        regions: unique(facets.map(item => visibleTitle(item.id)?.region ?? null)),
        years: [...new Set(facets.map(item => item.year).filter((year): year is number => year !== null))].sort((a, b) => b - a),
        actors: actorNames.sort((a, b) => a.localeCompare(b, 'zh-CN')),
      },
    }
  }

  // Rails are curated from the same published set, so every row stays honest
  // when the library is small: no fabricated entries, only reordered real titles.
  function home(): HomeData {    const items = allPublishedCards()
    const withGenre = (name: string) => items.filter(item => item.genres.includes(name))
    const byRating = [...items].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
    const byYear = [...items].filter(item => item.year !== null).sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
    const rails: HomeRail[] = []
    const rail = (id: string, title: string, subtitle: string | null, list: LibraryCard[], presentation: HomeRail['presentation'] = 'poster') => {
      const unique = [...new Map(list.map(item => [item.id, item])).values()]
      if (unique.length) rails.push({ id, title, subtitle, presentation, items: unique })
    }
    // Rails are curated from the same published set, so every row stays honest
    // when the library is small: no fabricated entries, only reordered real titles.
    // A rail that would repeat the exact same titles is skipped.
    const railKeys: string[] = []
    const addRail = (...args: Parameters<typeof rail>) => {
      const candidate = args[3]
      const key = candidate.map(item => item.id).join(',')
      if (!key || railKeys.includes(key)) return
      railKeys.push(key)
      rail(...args)
    }
    addRail('trending', '本周热门', '按评分排序', byRating.slice(0, 18))
    addRail('new', '最新入库', null, byYear.slice(0, 18))
    // Series are listed on their own so multi-episode shows are easy to find.
    addRail('series', '剧集', '按季、按集连续观看', items.filter(item => item.kind === 'series'))
    addRail('top', '高分佳作', '评分最高的馆藏', byRating.slice(0, 18))
    for (const genre of [...new Set(items.flatMap(item => item.genres))]) {
      addRail(`genre-${genre}`, genre, null, withGenre(genre))
    }
    addRail('all', '全部馆藏', null, items, 'wide')
    return {
      heroes: byRating.slice(0, 5),
      rails,
      total: items.length,
      genres: [...new Set(items.flatMap(item => item.genres))].sort(),
    }
  }

  // Actors are derived from each title's cast list; there is no separate table, so
  // the actor index always reflects whatever the library currently holds.
  function actors(): ActorSummary[] {
    const counts = new Map<string, { count: number; poster: string | null }>()
    for (const row of publishedRows()) {
      const seen = new Set<string>()
      for (const name of parseList(row.cast_members)) {
        if (seen.has(name)) continue
        seen.add(name)
        const entry = counts.get(name) ?? { count: 0, poster: posterUrl(row) }
        entry.count++
        counts.set(name, entry)
      }
    }
    return [...counts.entries()]
      .map(([name, entry]) => ({ name, count: entry.count, posterUrl: entry.poster }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))
  }

  return {
    transact: <T>(work: () => T) => transaction(db, work),
    actors,
    cards(q: string, kind: LibraryKind | null): LibraryCard[] {
      return allPublishedCards().filter(item =>
        (!kind || item.kind === kind) && item.title.toLowerCase().includes(q.toLowerCase()))
    },
    browse,
    home,
    detail(id: string): TitleDetail | null {
      const row = visibleTitle(id)
      if (!row) return null
      const film = row.kind === 'movie' ? movie(id) : null
      const episodes: LibraryEpisode[] = row.kind === 'series' ? (
        sql.publicEpisodes.all(id) as unknown as (EpisodeRecord & { media_id: string; size: number; available: 0 | 1 })[]
      ).map(episode => ({
        id: episode.id, season: episode.season, episode: episode.episode, title: episode.title,
        media: mediaView({ id: episode.media_id, size: episode.size, available: episode.available }),
      })) : []
      return {
        ...card({ ...row, available: film?.available || episodes.some(episode => episode.media?.available) ? 1 : 0 }),
        description: row.description,
        region: row.region,
        runtime: row.runtime,
        director: row.director,
        cast: parseList(row.cast_members),
        movie: film ? mediaView(film) : null,
        episodes,
      }
    },
    // Poster and backdrop are separate files chosen by the administrator.
    posterPath(id: string): string | null {
      const row = visibleTitle(id)
      return row ? row.poster_path : null
    },
    backdropPath(id: string): string | null {
      const row = visibleTitle(id)
      return row ? row.backdrop_path : null
    },
    title,
    titles: (): AdminTitle[] => (sql.allTitles.all() as unknown as TitleRecord[]).map(row => ({
      id: row.id, kind: row.kind, title: row.title, year: row.year, description: row.description,
      posterPath: row.poster_path, posterUrl: posterUrl(row), originalTitle: row.original_title,
      genres: parseList(row.genres), region: row.region, rating: row.rating, runtime: row.runtime,
      director: row.director, cast: parseList(row.cast_members), backdropPath: row.backdrop_path,
    })),
    findIdentity: (key: string) => sql.identity.get(key) as unknown as TitleRecord | undefined,
    createTitle(kind: LibraryKind, metadata: TitleMetadata, identityKey: string | null) {
      const id = randomUUID()
      sql.addTitle.run(id, kind, metadata.title, metadata.year, metadata.description, metadata.poster_path, identityKey,
        new Date().toISOString(), metadata.original_title, metadata.genres, metadata.region, metadata.rating,
        metadata.runtime, metadata.director, metadata.cast_members, metadata.backdrop_path)
      return id
    },
    // Optional fields default to empty so a caller that only edits the basics
    // (title/year/description/poster) cannot write NULL into a NOT NULL column.
    editTitle(id: string, metadata: Partial<TitleMetadata> & Pick<TitleMetadata, 'title' | 'year' | 'description' | 'poster_path'>) {
      sql.editTitle.run(
        metadata.title, metadata.year, metadata.description, metadata.poster_path,
        metadata.original_title ?? null, metadata.genres ?? '[]', metadata.region ?? null,
        metadata.rating ?? null, metadata.runtime ?? null, metadata.director ?? null,
        metadata.cast_members ?? '[]', metadata.backdrop_path ?? null, id)
    },
    episode: (id: string) => sql.episode.get(id) as unknown as EpisodeRecord | undefined,
    episodeAt: (titleId: string, season: number, episode: number) => sql.episodeAt.get(titleId, season, episode) as unknown as EpisodeRecord | undefined,
    createEpisode(titleId: string, season: number, episode: number, name: string | null) {
      const id = randomUUID()
      sql.addEpisode.run(id, titleId, season, episode, name)
      return id
    },
    editEpisode(id: string, season: number, episode: number, name: string | null) {
      sql.editEpisode.run(season, episode, name, id)
    },
    publishedFor: (titleId: string, episodeId: string | null) => episodeId
      ? sql.episodeFile.get(episodeId) as unknown as MediaRecord | undefined
      : movie(titleId),
    files: () => sql.allFiles.all() as unknown as MediaRecord[],
    adminFiles: () => sql.adminFiles.all() as unknown as AdminMediaRecord[],
    adminFile: (id: string) => sql.adminFile.get(id) as unknown as AdminMediaRecord | undefined,
    publishedFile: (id: string) => sql.publishedFile.get(id) as unknown as MediaRecord | undefined,
    fileAt: (pathKey: string) => sql.path.get(pathKey) as unknown as MediaRecord | undefined,
    createFile(row: NewFile) {
      const id = randomUUID()
      sql.addFile.run(id, row.relative_path, row.path_key, row.size, row.mtime, row.state, row.available,
        row.valid_mp4, row.reason, row.source, row.title_id, row.episode_id, new Date().toISOString())
      return id
    },
    observe(id: string, file: FileObservation) {
      sql.observe.run(file.relative_path, file.size, file.mtime, file.available, file.valid_mp4, file.reason, id)
    },
    unavailable: (id: string, version: number) => Number(sql.absent.run(id, version).changes) === 1,
    associate(id: string, change: Association) {
      sql.associate.run(change.state, change.title_id, change.episode_id, change.reason, id)
    },
    lastScan(): ScanResult | null {
      const row = sql.lastScan.get() as unknown as ScanRecord | undefined
      if (!row) return null
      const { started_at, finished_at, ...rest } = row
      return { ...rest, startedAt: started_at, finishedAt: finished_at }
    },
    recordScan(run: ScanResult) {
      sql.addScan.run(run.id, run.state, run.startedAt, run.finishedAt, run.discovered, run.indexed, run.published,
        run.pending, run.unstable, run.missing, run.message)
      sql.trimScans.run()
    },
    setting(key: string): string | null {
      const row = sql.readSetting.get(key) as unknown as { value: string } | undefined
      return row?.value ?? null
    },
    saveSetting(key: string, value: string) {
      sql.writeSetting.run(key, value)
    },
  }
}

export type LibraryStore = ReturnType<typeof libraryStore>
