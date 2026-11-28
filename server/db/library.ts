import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  ActorSummary, AdminMedia, AdminTitle, BrowseQuery, BrowseResult, HomeData, LibraryCard,
  LibraryEpisode, LibraryKind, PlayableMedia, ScanResult, TitleDetail,
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
  cast_members: string
}

export type TitleMetadata = Pick<TitleRecord,
  'title' | 'year' | 'description' | 'poster_path' | 'cast_members'>

export interface EpisodeRecord {
  id: string
  title_id: string
  season: number
  episode: number
}

export interface MediaRecord {
  id: string
  relative_path: string
  path_key: string
  size: number
  mtime: number
  available: 0 | 1
  title_id: string | null
  episode_id: string | null
  added_at: string
}

export interface AdminMediaRecord extends MediaRecord {
  kind: LibraryKind
  title: string
  year: number | null
  season: number | null
  episode: number | null
  cast_members: string
}

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

const hasFiles = `EXISTS (SELECT 1 FROM media_files m WHERE m.title_id = t.id AND m.available = 1)`

const posterUrl = (id: string) => `/api/posters/${id}`

export function libraryStore(db: DatabaseSync) {
  const adminFileSelect = `
    SELECT m.*, t.kind, t.title, t.year, t.cast_members, e.season, e.episode
    FROM media_files m
    JOIN titles t ON t.id = m.title_id
    LEFT JOIN episodes e ON e.id = m.episode_id`

  const sql = {
    allTitles: db.prepare('SELECT * FROM titles ORDER BY title COLLATE NOCASE, year, rowid'),
    published: db.prepare(`SELECT t.* FROM titles t
      WHERE ${hasFiles} AND t.kind = ? ORDER BY t.created_at DESC, t.rowid DESC LIMIT ?`),
    title: db.prepare('SELECT * FROM titles WHERE id = ?'),
    identity: db.prepare('SELECT * FROM titles WHERE identity_key = ?'),
    addTitle: db.prepare(`INSERT INTO titles (id, kind, title, year, description, poster_path, identity_key, created_at, cast_members)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    editTitle: db.prepare(`UPDATE titles SET title = ?, year = ?, description = ?, poster_path = ?, cast_members = ? WHERE id = ?`),
    setKind: db.prepare('UPDATE titles SET kind = ?, identity_key = ? WHERE id = ?'),
    fillRuntime: db.prepare('DELETE FROM titles WHERE id = ?'),
    deleteTitle: db.prepare('DELETE FROM titles WHERE id = ?'),
    episode: db.prepare('SELECT * FROM episodes WHERE id = ?'),
    episodeAt: db.prepare('SELECT * FROM episodes WHERE title_id = ? AND season = ? AND episode = ?'),
    addEpisode: db.prepare('INSERT INTO episodes (id, title_id, season, episode) VALUES (?, ?, ?, ?)'),
    publicEpisodes: db.prepare(`SELECT e.*, m.id AS media_id, m.size, m.available
      FROM episodes e JOIN media_files m ON m.episode_id = e.id
      WHERE e.title_id = ? ORDER BY e.season, e.episode`),
    movie: db.prepare("SELECT * FROM media_files WHERE title_id = ? AND episode_id IS NULL"),
    episodeFile: db.prepare('SELECT * FROM media_files WHERE episode_id = ?'),
    allFiles: db.prepare('SELECT * FROM media_files'),
    adminFiles: db.prepare(`${adminFileSelect} ORDER BY m.added_at DESC, m.rowid DESC`),
    adminFile: db.prepare(`${adminFileSelect} WHERE m.id = ?`),
    path: db.prepare('SELECT * FROM media_files WHERE path_key = ?'),
    addFile: db.prepare(`INSERT INTO media_files (id, relative_path, path_key, size, mtime, available, title_id, episode_id, added_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    observe: db.prepare('UPDATE media_files SET relative_path = ?, size = ?, mtime = ?, available = ? WHERE id = ?'),
    associate: db.prepare('UPDATE media_files SET title_id = ?, episode_id = ? WHERE id = ?'),
    deleteFile: db.prepare('DELETE FROM media_files WHERE id = ?'),
    lastScan: db.prepare('SELECT * FROM scan_runs ORDER BY finished_at DESC, rowid DESC LIMIT 1'),
    addScan: db.prepare(`INSERT INTO scan_runs (id, state, started_at, finished_at, discovered, indexed, removed, message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    trimScans: db.prepare(`DELETE FROM scan_runs WHERE id IN
      (SELECT id FROM scan_runs ORDER BY finished_at DESC, rowid DESC LIMIT -1 OFFSET 20)`),
  }

  const title = (id: string) => sql.title.get(id) as unknown as TitleRecord | undefined

  function card(row: TitleRecord): LibraryCard {
    return {
      id: row.id,
      kind: row.kind,
      title: row.title,
      year: row.year,
      posterUrl: row.poster_path ? posterUrl(row.id) : null,
      runtime: null,
      cast: parseList(row.cast_members),
      addedAt: row.created_at,
    }
  }

  const publishedByKind = (kind: LibraryKind, limit = -1) => sql.published.all(kind, limit) as unknown as TitleRecord[]
  const publishedRows = () => publishedByKind('movie').concat(publishedByKind('series'))

  // Runtime is a property of the files, not the title, so it is summed on read.
  function runtimeOf(titleId: string): number | null {
    return null
  }

  function browse(query: BrowseQuery): BrowseResult {
    const clauses = [hasFiles]
    const params: (string | number)[] = []
    if (query.kind) { clauses.push('t.kind = ?'); params.push(query.kind) }
    if (query.q) { clauses.push('instr(lower(t.title), lower(?)) > 0'); params.push(query.q) }
    if (query.actor) { clauses.push(`EXISTS (SELECT 1 FROM json_each(t.cast_members) a WHERE a.value = ?)`); params.push(query.actor) }
    const where = clauses.join(' AND ')
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM titles t WHERE ${where}`).get(...params) as unknown as { n: number }).n
    const offset = (query.page - 1) * query.pageSize
    const order = query.sort === 'title'
      ? 't.title COLLATE NOCASE ASC'
      : 't.created_at DESC, t.rowid DESC'
    const rows = db.prepare(`SELECT t.* FROM titles t WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...params, query.pageSize, offset) as unknown as TitleRecord[]
    return {
      items: rows.map(card),
      total,
      page: query.page,
      pageSize: query.pageSize,
      actors: [...new Set(publishedRows().flatMap(row => parseList(row.cast_members)))].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    }
  }

  function home(): HomeData {
    // Two rows of seven at the widest home layout; narrower grids show fewer.
    const previewLimit = 14
    const movies = publishedByKind('movie', previewLimit).map(card)
    const series = publishedByKind('series', previewLimit).map(card)
    return { heroes: [...movies, ...series].slice(0, 5), movies, series }
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
        const entry = counts.get(name) ?? { count: 0, poster: row.poster_path ? posterUrl(row.id) : null }
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
    browse,
    home,
    card,
    runtimeOf,
    detail(id: string): TitleDetail | null {
      const row = sql.title.get(id) as unknown as TitleRecord | undefined
      if (!row) return null
      if (!(db.prepare(`SELECT 1 AS hit FROM titles t WHERE t.id = ? AND ${hasFiles}`).get(id))) return null
      const film = row.kind === 'movie' ? sql.movie.get(id) as unknown as MediaRecord | undefined : undefined
      const episodes: LibraryEpisode[] = row.kind === 'series'
        ? (sql.publicEpisodes.all(id) as unknown as (EpisodeRecord & { media_id: string; size: number; available: 0 | 1 })[])
          .map(episode => ({
            id: episode.id,
            season: episode.season,
            episode: episode.episode,
            media: { id: episode.media_id, size: episode.size, available: Boolean(episode.available) } as PlayableMedia,
          }))
        : []
      return {
        ...card(row),
        description: row.description,
        movie: film ? { id: film.id, size: film.size, available: Boolean(film.available) } : null,
        episodes,
      }
    },
    posterPath: (id: string) => title(id)?.poster_path ?? null,
    title,
    titles: (): AdminTitle[] => (sql.allTitles.all() as unknown as TitleRecord[]).map(row => ({
      id: row.id, kind: row.kind, title: row.title, year: row.year, description: row.description,
      posterPath: row.poster_path, posterUrl: row.poster_path ? posterUrl(row.id) : null,
      runtime: null, cast: parseList(row.cast_members),
    })),
    findIdentity: (key: string) => sql.identity.get(key) as unknown as TitleRecord | undefined,
    createTitle(kind: LibraryKind, metadata: TitleMetadata, identityKey: string | null) {
      const id = randomUUID()
      sql.addTitle.run(id, kind, metadata.title, metadata.year, metadata.description, metadata.poster_path,
        identityKey, new Date().toISOString(), metadata.cast_members)
      return id
    },
    editTitle(id: string, metadata: TitleMetadata) {
      sql.editTitle.run(metadata.title, metadata.year, metadata.description, metadata.poster_path, metadata.cast_members, id)
    },
    deleteTitle: (id: string) => { sql.deleteTitle.run(id) },
    // Re-classifying a title keeps its files: the identity is rebuilt so two titles
    // that become the same kind and name can still be told apart.
    setKind(id: string, kind: LibraryKind, identityKey: string | null) {
      sql.setKind.run(kind, identityKey, id)
    },
    episode: (id: string) => sql.episode.get(id) as unknown as EpisodeRecord | undefined,
    episodesOf: (titleId: string) =>
      (db.prepare('SELECT * FROM episodes WHERE title_id = ? ORDER BY season, episode').all(titleId) as unknown as EpisodeRecord[]),
    episodeAt: (titleId: string, season: number, episode: number) =>
      sql.episodeAt.get(titleId, season, episode) as unknown as EpisodeRecord | undefined,
    createEpisode(titleId: string, season: number, episode: number) {
      const id = randomUUID()
      sql.addEpisode.run(id, titleId, season, episode)
      return id
    },
    files: () => sql.allFiles.all() as unknown as MediaRecord[],
    adminFiles: () => sql.adminFiles.all() as unknown as AdminMediaRecord[],
    adminFile: (id: string) => sql.adminFile.get(id) as unknown as AdminMediaRecord | undefined,
    fileAt: (pathKey: string) => sql.path.get(pathKey) as unknown as MediaRecord | undefined,
    createFile(row: Omit<MediaRecord, 'id' | 'added_at'>) {
      const id = randomUUID()
      sql.addFile.run(id, row.relative_path, row.path_key, row.size, row.mtime, row.available,
        row.title_id, row.episode_id, new Date().toISOString())
      return id
    },
    observe(id: string, file: Pick<MediaRecord, 'relative_path' | 'size' | 'mtime' | 'available'>) {
      sql.observe.run(file.relative_path, file.size, file.mtime, file.available, id)
    },
    associate(id: string, titleId: string | null, episodeId: string | null) {
      sql.associate.run(titleId, episodeId, id)
    },
    deleteFile: (id: string) => { sql.deleteFile.run(id) },
    lastScan(): ScanResult | null {
      const row = sql.lastScan.get() as unknown as ScanRecord | undefined
      if (!row) return null
      const { started_at, finished_at, ...rest } = row
      return { ...rest, startedAt: started_at, finishedAt: finished_at }
    },
    recordScan(run: ScanResult) {
      sql.addScan.run(run.id, run.state, run.startedAt, run.finishedAt, run.discovered, run.indexed, run.removed, run.message)
      sql.trimScans.run()
    },
  }
}

export type LibraryStore = ReturnType<typeof libraryStore>

// The admin list repeats the title's cast on every file row; this shapes one.
export function adminMedia(row: AdminMediaRecord): AdminMedia {
  return {
    id: row.id,
    fileName: row.relative_path.split('/').at(-1) ?? row.relative_path,
    relativePath: row.relative_path,
    available: Boolean(row.available),
    size: row.size,
    addedAt: row.added_at,
    titleId: row.title_id,
    kind: row.kind,
    title: row.title,
    year: row.year,
    season: row.season,
    episode: row.episode,
    cast: parseList(row.cast_members),
  }
}
