// Migrations are append-only. Each version runs in one transaction.
export const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE titles (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('movie','series')),
        title TEXT NOT NULL,
        year INTEGER,
        description TEXT NOT NULL DEFAULT '',
        poster_path TEXT,
        identity_key TEXT UNIQUE,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE episodes (
        id TEXT PRIMARY KEY NOT NULL,
        title_id TEXT NOT NULL REFERENCES titles(id),
        season INTEGER NOT NULL CHECK (season BETWEEN 0 AND 999),
        episode INTEGER NOT NULL CHECK (episode BETWEEN 1 AND 9999),
        title TEXT,
        UNIQUE (title_id, season, episode),
        UNIQUE (id, title_id)
      ) STRICT;

      CREATE TABLE media_files (
        id TEXT PRIMARY KEY NOT NULL,
        relative_path TEXT NOT NULL,
        path_key TEXT NOT NULL UNIQUE,
        size INTEGER NOT NULL CHECK (size >= 0),
        mtime INTEGER NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('published','pending')),
        available INTEGER NOT NULL CHECK (available IN (0, 1)),
        valid_mp4 INTEGER NOT NULL CHECK (valid_mp4 IN (0, 1)),
        reason TEXT,
        source TEXT NOT NULL CHECK (source IN ('scan','upload')),
        title_id TEXT REFERENCES titles(id),
        episode_id TEXT,
        added_at TEXT NOT NULL,
        file_version INTEGER NOT NULL DEFAULT 1,
        CHECK (state <> 'published' OR title_id IS NOT NULL),
        CHECK (episode_id IS NULL OR title_id IS NOT NULL),
        FOREIGN KEY (episode_id, title_id) REFERENCES episodes(id, title_id)
      ) STRICT;

      CREATE INDEX idx_media_title ON media_files(title_id, state);
      CREATE UNIQUE INDEX uq_movie_file ON media_files(title_id)
        WHERE state = 'published' AND episode_id IS NULL;
      CREATE UNIQUE INDEX uq_episode_file ON media_files(episode_id)
        WHERE state = 'published' AND episode_id IS NOT NULL;

      CREATE TABLE scan_runs (
        id TEXT PRIMARY KEY NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('success','failed')),
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        discovered INTEGER NOT NULL,
        indexed INTEGER NOT NULL,
        published INTEGER NOT NULL,
        pending INTEGER NOT NULL,
        unstable INTEGER NOT NULL,
        missing INTEGER NOT NULL,
        message TEXT
      ) STRICT;
      CREATE INDEX idx_scan_runs_finished ON scan_runs(finished_at DESC);

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
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      ) STRICT;
    `,
  },
  {
    version: 3,
    sql: `
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
        title_id TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, title_id)
      ) STRICT;
      CREATE INDEX idx_favorites_created ON favorites(user_id, created_at DESC);
    `,
  },
  {
    version: 4,
    sql: `
      ALTER TABLE titles ADD COLUMN original_title TEXT;
      ALTER TABLE titles ADD COLUMN genres TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE titles ADD COLUMN region TEXT;
      ALTER TABLE titles ADD COLUMN rating REAL;
      ALTER TABLE titles ADD COLUMN runtime INTEGER;
      ALTER TABLE titles ADD COLUMN director TEXT;
      ALTER TABLE titles ADD COLUMN cast_members TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE titles ADD COLUMN backdrop_path TEXT;
      CREATE INDEX idx_titles_year ON titles(kind, year);
      CREATE INDEX idx_titles_created ON titles(created_at DESC);
    `,
  },
] as const
