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
  images TEXT,                                -- 多張圖片的 key（JSON 陣列，最多 4 張；第一張同 image_key）
  repost_of TEXT,                             -- 轉發的原文 id（kind = repost）
  quote_of TEXT,                              -- 引用轉發的原文 id
  repost_count INTEGER NOT NULL DEFAULT 0,    -- 被轉發＋引用的次數
  community_id TEXT,                          -- 發在哪個社團
  is_daily INTEGER NOT NULL DEFAULT 0,        -- 1 = 每日熱門投票
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
  emoji TEXT NOT NULL DEFAULT '❤️',           -- 表情回應：❤️ 😂 😮 😢 😡
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
  type TEXT NOT NULL,                         -- like | comment | reply | mention | follow | message | repost | quote | moderation | appeal
  post_id TEXT,
  ref_id TEXT,                                -- moderation／appeal：對應的處理紀錄 id
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

-- 投票（一篇文最多一個投票，2～5 個選項，每人一票、投了不能改）
CREATE TABLE IF NOT EXISTS polls (
  post_id TEXT PRIMARY KEY,
  ends_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS poll_options (
  post_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  text TEXT NOT NULL,
  votes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, idx)
);
CREATE TABLE IF NOT EXISTS poll_votes (
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_poll_votes_user ON poll_votes(user_id);

-- 管理處理紀錄（通知本人、申訴、透明度報告都用這張表）
CREATE TABLE IF NOT EXISTS moderation_actions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,                      -- 被處理的用戶
  target_type TEXT NOT NULL,                  -- post | comment | account
  target_id TEXT NOT NULL,
  action TEXT NOT NULL,                       -- hide | delete | mark_sensitive | suspended | banned
  reason TEXT NOT NULL,                       -- spam | scam | harass | privacy | illegal | minor | violence | unlabeled | other
  detail TEXT DEFAULT '',                     -- GM 補充說明（會讓本人看到）
  snapshot TEXT DEFAULT '',                   -- 被處理內容的前 200 字（刪除後本人還看得到是哪篇）
  gm_id TEXT,
  source TEXT NOT NULL DEFAULT 'gm',          -- gm | report
  appeal_status TEXT NOT NULL DEFAULT 'none', -- none | pending | accepted | rejected
  appeal_text TEXT,
  appeal_reply TEXT,
  appealed_at INTEGER,
  decided_at INTEGER,
  reversed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mod_user ON moderation_actions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mod_appeal ON moderation_actions(appeal_status, appealed_at);

-- 個人過濾：自己不想看的關鍵字或標籤
CREATE TABLE IF NOT EXISTS muted_words (
  user_id TEXT NOT NULL,
  word TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, word)
);

-- 收藏
CREATE TABLE IF NOT EXISTS bookmarks (
  user_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id, created_at DESC);

-- 限時動態（24 小時後消失）
CREATE TABLE IF NOT EXISTS stories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  text TEXT DEFAULT '',
  image_key TEXT,
  bg TEXT DEFAULT '',                         -- 純文字動態的背景色
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stories_user ON stories(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_stories_exp ON stories(expires_at);
CREATE TABLE IF NOT EXISTS story_views (
  story_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (story_id, user_id)
);

-- 分類版（只有官方，由 GM 在後台管理；用戶發文時選一個分類版）
CREATE TABLE IF NOT EXISTS communities (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  icon TEXT DEFAULT '',                       -- 一個表情符號當社團圖示
  owner_id TEXT,                              -- NULL = 官方社團
  official INTEGER NOT NULL DEFAULT 0,
  content_group TEXT,                         -- ✦ 帳號哪一組會把部分文章發到這個社團
  member_count INTEGER NOT NULL DEFAULT 0,
  post_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS community_members (
  community_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',        -- owner | member
  created_at INTEGER NOT NULL,
  PRIMARY KEY (community_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_cm_user ON community_members(user_id);

INSERT OR IGNORE INTO communities (id, slug, name, description, icon, official, content_group, created_at) VALUES
  ('cm_news', 'news', '時事討論', '新聞、時事、社會大小事，理性討論', '📰', 1, 'news', 1793491200000),
  ('cm_game', 'games', '遊戲閒聊', '手遊、主機、PC、桌遊，什麼遊戲都能聊', '🎮', 1, 'game', 1793491200000),
  ('cm_life', 'life', '生活雜談', '美食、旅行、追劇、心情，日常什麼都聊', '☕', 1, 'mixed', 1793491200000),
  ('cm_fun', 'funny', '趣事分享', '今天遇到什麼好笑的事？分享出來讓大家笑一下', '😂', 1, 'fun', 1793491200000),
  ('cm_pets', 'pets', '毛孩俱樂部', '貓狗兔鼠，毛孩照片與日常', '🐾', 1, NULL, 1793491200000),
  ('cm_free', 'free-talk', '暢所欲言', '想說什麼就說什麼，只要不違法', '💬', 1, NULL, 1793491200000);

-- 每日統計（儀表板圖表用）
CREATE TABLE IF NOT EXISTS daily_active (
  day TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (day, user_id)
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('content_enabled', '1'),
  ('daily_posts', '200'),                    -- 全站 ✦ 帳號每天約發幾則（輪流）
  ('photo_ratio', '30'),
  ('community_ratio', '100'),                -- ✦ 貼文有幾 % 發到對應的分類版
  ('daily_poll', '1'),                       -- 每天一題 ✦ 全站投票                     -- 非時事的 ✦ 貼文有幾 % 附真實照片（Pexels）
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
