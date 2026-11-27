export type LibraryKind = 'movie' | 'series'

// The card is the only shape the public list endpoints return. It carries just
// enough metadata to render a poster tile and a hover preview.
export interface LibraryCard {
  id: string
  kind: LibraryKind
  title: string
  originalTitle: string | null
  year: number | null
  posterUrl: string | null
  backdropUrl: string | null
  rating: number | null
  genres: string[]
  available: boolean
  addedAt: string
}

export interface PlayableMedia {
  id: string
  available: boolean
  size: number
}

export interface LibraryEpisode {
  id: string
  season: number
  episode: number
  title: string | null
  media: PlayableMedia | null
}

export interface TitleDetail extends LibraryCard {
  description: string
  region: string | null
  runtime: number | null
  director: string | null
  cast: string[]
  movie: PlayableMedia | null
  episodes: LibraryEpisode[]
}

export type BrowseSort = 'newest' | 'rating' | 'year' | 'title'

export interface BrowseQuery {
  q: string
  kind: LibraryKind | null
  genre: string | null
  region: string | null
  actor: string | null
  yearFrom: number | null
  yearTo: number | null
  minRating: number | null
  sort: BrowseSort
  page: number
  pageSize: number
}

export interface BrowseResult {
  items: LibraryCard[]
  total: number
  page: number
  pageSize: number
  facets: {
    genres: string[]
    regions: string[]
    years: number[]
    actors: string[]
  }
}

export interface HomeRail {
  id: string
  title: string
  subtitle: string | null
  presentation: 'poster' | 'wide'
  items: LibraryCard[]
}

export interface HomeData {
  heroes: LibraryCard[]
  rails: HomeRail[]
  total: number
  genres: string[]
}

export interface AdminTitle {
  id: string
  kind: LibraryKind
  title: string
  year: number | null
  description: string
  posterPath: string | null
  posterUrl: string | null
  originalTitle: string | null
  genres: string[]
  region: string | null
  rating: number | null
  runtime: number | null
  director: string | null
  cast: string[]
  backdropPath: string | null
}

export interface MediaSuggestion {
  kind: LibraryKind | null
  title: string | null
  year: number | null
  season: number | null
  episode: number | null
  // A star parsed out of a `star-title-tag` filename, shown as a hint only.
  actor: string | null
}

export interface AdminMedia {
  id: string
  fileName: string
  relativePath: string
  state: 'published' | 'pending'
  available: boolean
  reason: string | null
  size: number
  source: 'scan' | 'upload'
  addedAt: string
  titleId: string | null
  season: number | null
  episode: number | null
  episodeTitle: string | null
  suggestion: MediaSuggestion
}

export interface ScanResult {
  id: string
  state: 'success' | 'failed'
  startedAt: string
  finishedAt: string
  discovered: number
  indexed: number
  published: number
  pending: number
  unstable: number
  missing: number
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
  settings: AdminSettings
}

// Library-wide defaults the administrator can change without touching the database.
export interface AdminSettings {
  defaultDescription: string
}

// One row of a bulk publish. A null field means "use the filename suggestion",
// except description, where null means "use the saved default description".
export interface BulkEditItem {
  id: string
  // publish: turn a pending file into a library entry.
  // complete: fill in missing description/poster on an already published title.
  mode?: 'publish' | 'complete'
  titleId: string | null
  kind: LibraryKind | null
  title: string | null
  year: number | null
  description: string | null
  posterPath: string | null
  season: number | null
  episode: number | null
  episodeTitle: string | null
  replaceExisting: boolean
  // complete only: replace a description/poster that the administrator already set.
  overwrite?: boolean
}

export interface BulkEditSkipped {
  id: string
  fileName: string
  message: string
}

export interface BulkEditResult {
  published: AdminMedia[]
  skipped: BulkEditSkipped[]
}

// A signed-in visitor of the public site. Separate from the single admin account.
export interface UserSession {
  username: string | null
}

export interface FavoriteState {
  favorited: boolean
}

export interface FavoriteList {
  items: LibraryCard[]
}

// One resumable position. `episodeId` is null for a whole film.
export interface PlaybackProgress {
  titleId: string
  episodeId: string | null
  position: number
  duration: number
}

// One resumable position, keyed by the card's own id (titleId is implicit in `id`).
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

// One actor plus how many published titles they appear in.
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

export interface ProgressInput {
  titleId: string
  episodeId: string | null
  position: number
  duration: number
}

// Everything an administrator may change on a title, shared by PATCH and bulk.
export interface MediaEdit {
  titleId: string | null
  kind: LibraryKind
  title: string
  originalTitle: string | null
  year: number | null
  description: string
  genres: string[]
  region: string | null
  rating: number | null
  runtime: number | null
  director: string | null
  cast: string[]
  posterPath: string | null
  backdropPath: string | null
  season: number | null
  episode: number | null
  episodeTitle: string | null
  replaceExisting?: boolean
}
