// Migrations are append-only. Each version runs in one transaction.
//
// The schema describes exactly what the app stores and nothing more: a media file
// is a row per MP4 in the media folder, a title is what those files are called, and
// episodes only exist as (season, episode) slots under a series title. Earlier
// versions modelled a "pending/missing" workflow; that is gone, and the database is
// rebuilt rather than migrated, because the library is derived from the folder and
// can simply be scanned again.
export const migrations = [
  {
    version: 1,
    sql: `
      -- One row per MP4 in the media folder.
      CREATE TABLE media_files (
        id TEXT PRIMARY KEY NOT NULL,
        relative_path TEXT NOT NULL,
        path_key TEXT NOT NULL UNIQUE,
        size INTEGER NOT NULL CHECK (size >= 0),
        mtime INTEGER NOT NULL,
        available INTEGER NOT NULL CHECK (available IN (0, 1)),
        title_id TEXT REFERENCES titles(id) ON DELETE CASCADE,
        episode_id TEXT,
        added_at TEXT NOT NULL,
        FOREIGN KEY (episode_id, title_id) REFERENCES episodes(id, title_id)
      ) STRICT;

      -- What a file (or a group of episode files) is called.
      CREATE TABLE titles (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('movie','series')),
        title TEXT NOT NULL,
        year INTEGER,
        description TEXT NOT NULL DEFAULT '',
        poster_path TEXT,
        runtime INTEGER,
        identity_key TEXT UNIQUE,
        created_at TEXT NOT NULL,
        cast_members TEXT NOT NULL DEFAULT '[]'
      ) STRICT;

      -- A series positions its files by season and episode number, never by name.
      CREATE TABLE episodes (
        id TEXT PRIMARY KEY NOT NULL,
        title_id TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
        season INTEGER NOT NULL CHECK (season BETWEEN 0 AND 999),
        episode INTEGER NOT NULL CHECK (episode BETWEEN 1 AND 9999),
        UNIQUE (title_id, season, episode),
        UNIQUE (id, title_id)
      ) STRICT;

      CREATE INDEX idx_media_title ON media_files(title_id);
      CREATE INDEX idx_media_episode ON media_files(episode_id);
      CREATE INDEX idx_titles_kind ON titles(kind, title);
      CREATE INDEX idx_titles_created ON titles(created_at DESC);

      CREATE TABLE scan_runs (
        id TEXT PRIMARY KEY NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('success','failed')),
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        discovered INTEGER NOT NULL,
        indexed INTEGER NOT NULL,
        removed INTEGER NOT NULL,
        message TEXT
      ) STRICT;
      CREATE INDEX idx_scan_runs_finished ON scan_runs(finished_at DESC);

      -- The single administrator account.
      CREATE TABLE admin_account (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL
      ) STRICT;
      CREATE TABLE admin_sessions (
        token_hash TEXT PRIMARY KEY NOT NULL,
        expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX idx_admin_sessions_expiry ON admin_sessions(expires_at);

      -- Visitors: sign in, keep favourites, and resume playback.
      CREATE TABLE users (
        id TEXT PRIMARY KEY NOT NULL,
        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE user_sessions (
        token_hash TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX idx_user_sessions_expiry ON user_sessions(expires_at);

      CREATE TABLE favorites (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        -- Deliberately not cascaded: a favourite is the visitor's own record, and it
        -- must survive the title disappearing from the folder so it can come back.
        title_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, title_id)
      ) STRICT;
      CREATE INDEX idx_favorites_created ON favorites(user_id, created_at DESC);

      CREATE TABLE playback_progress (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        -- Likewise not cascaded: resuming still works if the file returns.
        title_id TEXT NOT NULL,
        -- '' means a whole film; an episode id otherwise. SQLite treats NULLs as
        -- distinct in a primary key, so a sentinel keeps one row per slot.
        episode_id TEXT NOT NULL DEFAULT '',
        position REAL NOT NULL,
        duration REAL NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, title_id, episode_id)
      ) STRICT;
      CREATE INDEX idx_progress_recent ON playback_progress(user_id, updated_at DESC);
    `,
  },
] as const
