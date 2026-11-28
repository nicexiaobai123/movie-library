export type LibraryKind = 'movie' | 'series'

// A card is everything the public lists need: enough for a poster tile.
export interface LibraryCard {
  id: string
  kind: LibraryKind
  title: string
  year: number | null
  posterUrl: string | null
  runtime: number | null
  cast: string[]
  addedAt: string
}

export interface PlayableMedia {
  id: string
  size: number
  available: boolean
}

export interface LibraryEpisode {
  id: string
  season: number
  episode: number
  media: PlayableMedia | null
}

export interface TitleDetail extends LibraryCard {
  description: string
  movie: PlayableMedia | null
  episodes: LibraryEpisode[]
}

export interface BrowseQuery {
  q: string
  kind: LibraryKind | null
  actor: string | null
  sort: 'newest' | 'title'
  page: number
  pageSize: number
}

export interface BrowseResult {
  items: LibraryCard[]
  total: number
  page: number
  pageSize: number
  actors: string[]
}

export interface HomeData {
  heroes: LibraryCard[]
  rails: HomeRail[]
  total: number
}

export interface HomeRail {
  id: string
  title: string
  subtitle: string | null
  presentation: 'poster' | 'wide'
  items: LibraryCard[]
}

// One row of the admin file list: the file plus what it was recognised as.
export interface AdminMedia {
  id: string
  fileName: string
  relativePath: string
  available: boolean
  size: number
  addedAt: string
  titleId: string | null
  kind: LibraryKind
  title: string
  year: number | null
  season: number | null
  episode: number | null
  cast: string[]
}

export interface AdminTitle {
  id: string
  kind: LibraryKind
  title: string
  year: number | null
  description: string
  posterPath: string | null
  posterUrl: string | null
  runtime: number | null
  cast: string[]
}

export interface ScanResult {
  id: string
  state: 'success' | 'failed'
  startedAt: string
  finishedAt: string
  discovered: number
  indexed: number
  removed: number
  message: string | null
}

export interface ScanStatus {
  running: boolean
  last: ScanResult | null
}

export interface AdminLibrary {
  items: AdminMedia[]
  titles: AdminTitle[]
  scan: ScanStatus
}

// Re-classify a selection as films or as episodes of one series.
export interface ClassifyInput {
  ids: string[]
  kind: LibraryKind
  // For a series: an existing title to attach to, otherwise a new one is created
  // from `title` (or the first file's recognised title).
  titleId: string | null
  title: string | null
  season: number | null
}

export interface ClassifyResult {
  items: AdminMedia[]
  skipped: { id: string; message: string }[]
}

// Everything an administrator may change on a title.
export interface MediaEdit {
  title: string
  year: number | null
  description: string
  posterPath: string | null
  runtime: number | null
  cast: string[]
  kind: LibraryKind
  season: number | null
  episode: number | null
}

export interface UserSession {
  username: string | null
}

export interface FavoriteState {
  favorited: boolean
}

export interface FavoriteList {
  items: LibraryCard[]
}

export interface PlaybackProgress {
  titleId: string
  episodeId: string | null
  position: number
  duration: number
}

export interface ContinueWatchingItem extends LibraryCard {
  episodeId: string | null
  episodeLabel: string | null
  position: number
  duration: number
  percent: number
}

export interface ContinueWatching {
  items: ContinueWatchingItem[]
}

export interface ProgressInput {
  titleId: string
  episodeId: string | null
  position: number
  duration: number
}

export interface ActorSummary {
  name: string
  count: number
  posterUrl: string | null
}

export interface ActorList {
  items: ActorSummary[]
}

export interface ActorDetail {
  name: string
  titles: LibraryCard[]
}
