-- 窩Wooo！資料庫結構（Cloudflare D1 / SQLite）

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  google_sub TEXT UNIQUE,
  email TEXT,
  name TEXT NOT NULL,
  handle TEXT NOT NULL UNIQUE,
  avatar_key TEXT,
  bio TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user',          -- user | gm
  status TEXT NOT NULL DEFAULT 'active',      -- active | suspended | banned
  is_content INTEGER NOT NULL DEFAULT 0,      -- 1 = ✦ 平台內容帳號
  content_group TEXT,                         -- news | game | mixed
  persona TEXT,                               -- 內容帳號的個性／主題
  content_enabled INTEGER NOT NULL DEFAULT 1,
  last_posted_at INTEGER,
  age_verified INTEGER NOT NULL DEFAULT 0,
  show_sensitive INTEGER NOT NULL DEFAULT 0,
  theme TEXT NOT NULL DEFAULT 'forestsky',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_content ON users(is_content, content_group);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  image_key TEXT,
  link_url TEXT,
  link_title TEXT,
  link_site TEXT,
  sensitive INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'user',        -- user | content
  like_count INTEGER NOT NULL DEFAULT 0,      -- 公開讚數（含 ✦ 帳號）
  real_like_count INTEGER NOT NULL DEFAULT 0, -- 真人讚數（熱門排行用）
  comment_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, created_at);

CREATE TABLE IF NOT EXISTS likes (
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL,
  followee_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  type TEXT NOT NULL,                         -- like | comment | follow
  post_id TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  post_id TEXT,
  comment_id TEXT,
  reporter_id TEXT NOT NULL,
  reason TEXT NOT NULL,                       -- spam | harassment | copyright | unmarked_sensitive | illegal | other
  detail TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',        -- open | resolved | dismissed
  resolved_by TEXT,
  resolved_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS news_cache (
  url TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source TEXT,
  description TEXT,
  fetched_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS uploads (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uploads_user ON uploads(user_id, created_at);

CREATE TABLE IF NOT EXISTS content_log (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                         -- post | like | comment | news | error
  account_id TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_log ON content_log(created_at DESC);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('content_enabled', '1'),
  ('interval_min', '30'),
  ('interact_like', '1'),
  ('interact_comment', '1'),
  ('old_posts_mode', 'keep'),
  ('group_news', '1'),
  ('group_game', '1'),
  ('group_mixed', '1'),
  ('paused_until', '0'),
  ('newsdata_key', ''),
  ('rss_feeds', '[]');
