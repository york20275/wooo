-- 窩Woo！資料庫結構（Cloudflare D1 / SQLite）

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
  content_group TEXT,                         -- news | game | mixed | fun
  persona TEXT,                               -- 內容帳號的個性／主題
  content_enabled INTEGER NOT NULL DEFAULT 1,
  last_posted_at INTEGER,
  age_verified INTEGER NOT NULL DEFAULT 0,
  show_sensitive INTEGER NOT NULL DEFAULT 0,
  theme TEXT NOT NULL DEFAULT 'forestsky',
  banner_key TEXT,                            -- 個人頁橫幅
  accent TEXT,                                -- 個人頁主題色
  pinned_post_id TEXT,                        -- 置頂文章
  interests TEXT DEFAULT '[]',                -- 新手引導選的興趣
  onboarded INTEGER NOT NULL DEFAULT 0,
  human_verified INTEGER NOT NULL DEFAULT 0,  -- 已通過人機驗證
  last_seen_at INTEGER,
  deleted_at INTEGER,
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
  image_credit TEXT,                         -- 圖庫照片的攝影者（✦ 帳號用）
  image_credit_url TEXT,                     -- 圖庫照片頁面網址
  link_url TEXT,
  link_title TEXT,
  link_site TEXT,
  sensitive INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'user',        -- user | content
  kind TEXT NOT NULL DEFAULT 'post',          -- post | blog（網誌長文）
  title TEXT,                                 -- 網誌標題
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
  parent_id TEXT,                             -- 回覆哪一則留言（只有一層）
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
  type TEXT NOT NULL,                         -- like | comment | reply | mention | follow | message
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


CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL,
  blocked_id TEXT NOT NULL,
  kind TEXT NOT NULL,                         -- block（封鎖）| mute（靜音）
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_id);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_a TEXT NOT NULL,                       -- 兩人 id 依字母排序，a < b
  user_b TEXT NOT NULL,
  last_message_at INTEGER NOT NULL,
  a_read_at INTEGER NOT NULL DEFAULT 0,
  b_read_at INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_a, user_b)
);
CREATE INDEX IF NOT EXISTS idx_conv_a ON conversations(user_a, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_b ON conversations(user_b, last_message_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS albums (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  sensitive INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_albums_user ON albums(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS album_photos (
  id TEXT PRIMARY KEY,
  album_id TEXT NOT NULL,
  image_key TEXT NOT NULL,
  caption TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_album_photos ON album_photos(album_id, created_at);

-- 訪客計數（無名小站風格）：每位訪客每天只算一次
CREATE TABLE IF NOT EXISTS profile_visits (
  user_id TEXT NOT NULL,
  visitor_key TEXT NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (user_id, visitor_key, day)
);
CREATE TABLE IF NOT EXISTS profile_stats (
  user_id TEXT PRIMARY KEY,
  total INTEGER NOT NULL DEFAULT 0,
  today INTEGER NOT NULL DEFAULT 0,
  today_day TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  gm_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit ON audit_log(created_at DESC);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

-- 每日統計（儀表板圖表用）
CREATE TABLE IF NOT EXISTS daily_active (
  day TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (day, user_id)
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('content_enabled', '1'),
  ('daily_posts', '200'),                    -- 全站 ✦ 帳號每天約發幾則（輪流）
  ('photo_ratio', '30'),                     -- 非時事的 ✦ 貼文有幾 % 附真實照片（Pexels）
  ('pexels_key', ''),
  ('group_fun', '1'),
  ('feed_content_ratio', '50'),              -- 熱門動態牆中 ✦ 內容最多佔幾 %
  ('ai_model', ''),                          -- 空白 = 用 wrangler.toml 的 AI_MODEL
  ('interact_like', '1'),
  ('interact_comment', '1'),
  ('old_posts_mode', 'keep'),
  ('group_news', '1'),
  ('group_game', '1'),
  ('group_mixed', '1'),
  ('paused_until', '0'),
  ('newsdata_key', ''),
  ('rss_feeds', '[]');
