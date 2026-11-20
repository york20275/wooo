import { Hono } from 'hono';
import type { AppEnv, User } from './env';
import { canSeeSensitive, getSetting, newId, now } from './env';

export const api = new Hono<AppEnv>();

const POST_MAX = 1000;
const COMMENT_MAX = 500;
const THEMES = ['forestsky', 'mist', 'orangeblue', 'forest', 'lavender', 'ocean', 'sakura', 'lemon', 'mono'];
const REPORT_REASONS = ['spam', 'harassment', 'copyright', 'unmarked_sensitive', 'illegal', 'other'];

function requireUser(c: any): User {
  const u = c.get('user') as User | null;
  if (!u) throw new HttpError(401, '請先登入');
  if (u.status !== 'active') throw new HttpError(403, '你的帳號目前無法執行這個動作');
  return u;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const imgUrl = (key: string | null) => (key ? `/img/${key}` : null);

const POST_COLS = `p.id, p.text, p.image_key, p.link_url, p.link_title, p.link_site, p.sensitive, p.source,
  p.like_count, p.comment_count, p.created_at,
  u.id AS author_id, u.name AS author_name, u.handle AS author_handle, u.avatar_key AS author_avatar, u.is_content AS author_is_content`;

function serializePost(r: any, likedSet?: Set<string>) {
  return {
    id: r.id,
    text: r.text,
    image_url: imgUrl(r.image_key),
    link: r.link_url ? { url: r.link_url, title: r.link_title, site: r.link_site } : null,
    sensitive: !!r.sensitive,
    created_at: r.created_at,
    like_count: r.like_count,
    comment_count: r.comment_count,
    liked: likedSet ? likedSet.has(r.id) : false,
    author: {
      id: r.author_id,
      name: r.author_name,
      handle: r.author_handle,
      avatar_url: imgUrl(r.author_avatar),
      is_content: !!r.author_is_content,
    },
  };
}

async function likedSetFor(c: any, ids: string[]): Promise<Set<string>> {
  const u = c.get('user') as User | null;
  if (!u || ids.length === 0) return new Set();
  const qs = ids.map(() => '?').join(',');
  const r = await c.env.DB.prepare(`SELECT post_id FROM likes WHERE user_id = ? AND post_id IN (${qs})`).bind(u.id, ...ids).all();
  return new Set(r.results.map((x: any) => x.post_id));
}

/** 共用的可見性條件 */
async function visibility(c: any, opts: { forHot?: boolean } = {}): Promise<string> {
  const u = c.get('user') as User | null;
  const parts = ['p.hidden = 0', "u.status != 'banned'"];
  if (opts.forHot || !canSeeSensitive(u)) parts.push('p.sensitive = 0');
  const enabled = await getSetting(c.env.DB, 'content_enabled', '1');
  const mode = await getSetting(c.env.DB, 'old_posts_mode', 'keep');
  if (enabled !== '1' && mode === 'hide') parts.push("p.source = 'user'");
  return parts.join(' AND ');
}

// ---------- 自己 ----------
api.get('/me', async (c) => {
  const u = c.get('user');
  if (!u) return c.json({ user: null });
  const unread = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0').bind(u.id).first<{ n: number }>();
  return c.json({
    user: {
      id: u.id, name: u.name, handle: u.handle, bio: u.bio, email: u.email, avatar_url: imgUrl(u.avatar_key),
      role: u.role, theme: u.theme, age_verified: !!u.age_verified, show_sensitive: !!u.show_sensitive,
    },
    unread: unread?.n ?? 0,
    dev_mode: c.env.DEV_MODE === '1',
  });
});

api.patch('/me', async (c) => {
  const u = requireUser(c);
  const b = await c.req.json<any>();
  const sets: string[] = [];
  const vals: any[] = [];
  if (typeof b.name === 'string') {
    const n = b.name.trim().slice(0, 40);
    if (!n) throw new HttpError(400, '名稱不能空白');
    sets.push('name = ?'); vals.push(n);
  }
  if (typeof b.bio === 'string') { sets.push('bio = ?'); vals.push(b.bio.slice(0, 200)); }
  if (typeof b.theme === 'string' && THEMES.includes(b.theme)) { sets.push('theme = ?'); vals.push(b.theme); }
  if (typeof b.avatar_key === 'string') {
    const own = await c.env.DB.prepare('SELECT 1 FROM uploads WHERE key = ? AND user_id = ?').bind(b.avatar_key, u.id).first();
    if (!own) throw new HttpError(400, '圖片不存在');
    sets.push('avatar_key = ?'); vals.push(b.avatar_key);
  }
  if (typeof b.show_sensitive === 'boolean') {
    if (b.show_sensitive && !u.age_verified) throw new HttpError(403, '需要先完成年齡驗證');
    sets.push('show_sensitive = ?'); vals.push(b.show_sensitive ? 1 : 0);
  }
  if (sets.length) await c.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, u.id).run();
  return c.json({ ok: true });
});

/**
 * 年齡驗證。正式上線前必須串接第三方驗證服務（信用卡或身分證件），
 * 由服務商回傳「已滿 18 歲」的結果後才把 age_verified 設為 1。
 * 這裡只保存驗證結果，不保存卡號或證件影像。
 */
api.post('/age/verify', async (c) => {
  const u = requireUser(c);
  if (c.env.DEV_MODE === '1') {
    await c.env.DB.prepare('UPDATE users SET age_verified = 1, show_sensitive = 1 WHERE id = ?').bind(u.id).run();
    return c.json({ ok: true, dev: true });
  }
  throw new HttpError(501, '年齡驗證服務尚未開通，敏感內容暫時無法開啟');
});

// ---------- 動態牆 ----------
api.get('/feed', async (c) => {
  const tab = c.req.query('tab') === 'following' ? 'following' : 'hot';
  const before = Number(c.req.query('before') || 0);
  const u = c.get('user');
  let rows: any[];
  if (tab === 'following') {
    if (!u) return c.json({ posts: [] });
    const vis = await visibility(c);
    const r = await c.env.DB.prepare(
      `SELECT ${POST_COLS} FROM posts p JOIN users u ON u.id = p.user_id
       WHERE ${vis} AND (p.user_id = ? OR p.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?))
       ${before ? 'AND p.created_at < ?' : ''} ORDER BY p.created_at DESC LIMIT 20`
    ).bind(u.id, u.id, ...(before ? [before] : [])).all();
    rows = r.results;
  } else {
    // 熱門：只算真人讚數，越新越前面；熱門不放敏感內容
    const vis = await visibility(c, { forHot: true });
    const since = now() - 3 * 86400_000;
    const r = await c.env.DB.prepare(
      `SELECT ${POST_COLS}, p.real_like_count FROM posts p JOIN users u ON u.id = p.user_id
       WHERE ${vis} AND p.created_at > ? ORDER BY p.created_at DESC LIMIT 200`
    ).bind(since).all();
    const t = now();
    rows = r.results
      .map((x: any) => ({ x, s: (x.real_like_count + 1) / Math.pow((t - x.created_at) / 3600_000 + 2, 1.5) }))
      .sort((a, b) => b.s - a.s)
      .map((y) => y.x);
    const offset = Number(c.req.query('offset') || 0);
    rows = rows.slice(offset, offset + 20);
  }
  const liked = await likedSetFor(c, rows.map((r) => r.id));
  return c.json({ posts: rows.map((r) => serializePost(r, liked)) });
});

api.get('/posts/:id', async (c) => {
  const vis = await visibility(c);
  const r = await c.env.DB.prepare(`SELECT ${POST_COLS} FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ? AND ${vis}`).bind(c.req.param('id')).first();
  if (!r) throw new HttpError(404, '找不到這篇文章');
  const cm = await c.env.DB.prepare(
    `SELECT c.id, c.text, c.created_at, u.id AS uid, u.name, u.handle, u.avatar_key, u.is_content
     FROM comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ? AND c.hidden = 0 AND u.status != 'banned' ORDER BY c.created_at LIMIT 200`
  ).bind(r.id).all();
  const liked = await likedSetFor(c, [r.id as string]);
  return c.json({
    post: serializePost(r, liked),
    comments: cm.results.map((x: any) => ({
      id: x.id, text: x.text, created_at: x.created_at,
      author: { id: x.uid, name: x.name, handle: x.handle, avatar_url: imgUrl(x.avatar_key), is_content: !!x.is_content },
    })),
  });
});

api.post('/posts', async (c) => {
  const u = requireUser(c);
  const b = await c.req.json<any>();
  const text = String(b.text || '').trim();
  if (!text && !b.image_key) throw new HttpError(400, '內容不能空白');
  if (text.length > POST_MAX) throw new HttpError(400, `內容最多 ${POST_MAX} 字`);
  const recent = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM posts WHERE user_id = ? AND created_at > ?').bind(u.id, now() - 3600_000).first<{ n: number }>();
  if ((recent?.n ?? 0) >= 30) throw new HttpError(429, '發文太頻繁，請稍後再試');
  let imageKey: string | null = null;
  if (b.image_key) {
    const own = await c.env.DB.prepare('SELECT 1 FROM uploads WHERE key = ? AND user_id = ?').bind(b.image_key, u.id).first();
    if (!own) throw new HttpError(400, '圖片不存在');
    imageKey = b.image_key;
  }
  const id = newId();
  await c.env.DB.prepare('INSERT INTO posts (id, user_id, text, image_key, sensitive, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, u.id, text, imageKey, b.sensitive ? 1 : 0, 'user', now()).run();
  return c.json({ id });
});

api.delete('/posts/:id', async (c) => {
  const u = requireUser(c);
  const p = await c.env.DB.prepare('SELECT user_id, image_key FROM posts WHERE id = ?').bind(c.req.param('id')).first<any>();
  if (!p) throw new HttpError(404, '找不到這篇文章');
  if (p.user_id !== u.id && u.role !== 'gm') throw new HttpError(403, '沒有權限');
  await deletePost(c.env, c.req.param('id'), p.image_key);
  return c.json({ ok: true });
});

export async function deletePost(env: any, id: string, imageKey: string | null) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id),
    env.DB.prepare('DELETE FROM comments WHERE post_id = ?').bind(id),
    env.DB.prepare('DELETE FROM likes WHERE post_id = ?').bind(id),
    env.DB.prepare('DELETE FROM notifications WHERE post_id = ?').bind(id),
  ]);
  if (imageKey) {
    await env.IMAGES.delete(imageKey);
    await env.DB.prepare('DELETE FROM uploads WHERE key = ?').bind(imageKey).run();
  }
}

// ---------- 讚 ----------
export async function addLike(env: any, postId: string, liker: { id: string; is_content: number }) {
  const r = await env.DB.prepare('INSERT OR IGNORE INTO likes (post_id, user_id, created_at) VALUES (?, ?, ?)').bind(postId, liker.id, now()).run();
  if (!r.meta.changes) return false;
  await env.DB.prepare(`UPDATE posts SET like_count = like_count + 1${liker.is_content ? '' : ', real_like_count = real_like_count + 1'} WHERE id = ?`).bind(postId).run();
  const p = await env.DB.prepare('SELECT p.user_id, u.is_content FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?').bind(postId).first();
  if (p && p.user_id !== liker.id && !p.is_content) {
    await env.DB.prepare('INSERT INTO notifications (id, user_id, actor_id, type, post_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(newId(), p.user_id, liker.id, 'like', postId, now()).run();
  }
  return true;
}

api.post('/posts/:id/like', async (c) => {
  const u = requireUser(c);
  const id = c.req.param('id');
  const exists = await c.env.DB.prepare('SELECT 1 FROM posts WHERE id = ? AND hidden = 0').bind(id).first();
  if (!exists) throw new HttpError(404, '找不到這篇文章');
  await addLike(c.env, id, u);
  return c.json({ ok: true });
});

api.delete('/posts/:id/like', async (c) => {
  const u = requireUser(c);
  const id = c.req.param('id');
  const r = await c.env.DB.prepare('DELETE FROM likes WHERE post_id = ? AND user_id = ?').bind(id, u.id).run();
  if (r.meta.changes) await c.env.DB.prepare('UPDATE posts SET like_count = MAX(like_count - 1, 0), real_like_count = MAX(real_like_count - 1, 0) WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

api.get('/posts/:id/likes', async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.handle, u.avatar_key, u.is_content FROM likes l JOIN users u ON u.id = l.user_id
     WHERE l.post_id = ? AND u.status != 'banned' ORDER BY l.created_at DESC LIMIT 200`
  ).bind(c.req.param('id')).all();
  return c.json({ users: r.results.map((x: any) => ({ id: x.id, name: x.name, handle: x.handle, avatar_url: imgUrl(x.avatar_key), is_content: !!x.is_content })) });
});

// ---------- 留言 ----------
export async function addComment(env: any, postId: string, author: { id: string }, text: string) {
  const id = newId();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO comments (id, post_id, user_id, text, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, postId, author.id, text, now()),
    env.DB.prepare('UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?').bind(postId),
  ]);
  const p = await env.DB.prepare('SELECT p.user_id, u.is_content FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?').bind(postId).first();
  if (p && p.user_id !== author.id && !p.is_content) {
    await env.DB.prepare('INSERT INTO notifications (id, user_id, actor_id, type, post_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(newId(), p.user_id, author.id, 'comment', postId, now()).run();
  }
  return id;
}

api.post('/posts/:id/comments', async (c) => {
  const u = requireUser(c);
  const id = c.req.param('id');
  const b = await c.req.json<any>();
  const text = String(b.text || '').trim();
  if (!text) throw new HttpError(400, '留言不能空白');
  if (text.length > COMMENT_MAX) throw new HttpError(400, `留言最多 ${COMMENT_MAX} 字`);
  const exists = await c.env.DB.prepare('SELECT 1 FROM posts WHERE id = ? AND hidden = 0').bind(id).first();
  if (!exists) throw new HttpError(404, '找不到這篇文章');
  const recent = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM comments WHERE user_id = ? AND created_at > ?').bind(u.id, now() - 3600_000).first<{ n: number }>();
  if ((recent?.n ?? 0) >= 120) throw new HttpError(429, '留言太頻繁，請稍後再試');
  const cid = await addComment(c.env, id, u, text);
  return c.json({ id: cid });
});

api.delete('/comments/:id', async (c) => {
  const u = requireUser(c);
  const cm = await c.env.DB.prepare('SELECT user_id, post_id FROM comments WHERE id = ?').bind(c.req.param('id')).first<any>();
  if (!cm) throw new HttpError(404, '找不到這則留言');
  if (cm.user_id !== u.id && u.role !== 'gm') throw new HttpError(403, '沒有權限');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(c.req.param('id')),
    c.env.DB.prepare('UPDATE posts SET comment_count = MAX(comment_count - 1, 0) WHERE id = ?').bind(cm.post_id),
  ]);
  return c.json({ ok: true });
});

// ---------- 用戶與追蹤 ----------
api.get('/users/:handle', async (c) => {
  const p = await c.env.DB.prepare("SELECT * FROM users WHERE handle = ? AND status != 'banned'").bind(c.req.param('handle')).first<User>();
  if (!p) throw new HttpError(404, '找不到這位用戶');
  const me = c.get('user');
  const [followers, following, isFollowing] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?').bind(p.id).first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?').bind(p.id).first<{ n: number }>(),
    me ? c.env.DB.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').bind(me.id, p.id).first() : Promise.resolve(null),
  ]);
  const vis = await visibility(c);
  const r = await c.env.DB.prepare(`SELECT ${POST_COLS} FROM posts p JOIN users u ON u.id = p.user_id WHERE ${vis} AND p.user_id = ? ORDER BY p.created_at DESC LIMIT 30`).bind(p.id).all();
  const liked = await likedSetFor(c, r.results.map((x: any) => x.id));
  return c.json({
    user: { id: p.id, name: p.name, handle: p.handle, bio: p.bio, avatar_url: imgUrl(p.avatar_key), is_content: !!p.is_content, created_at: p.created_at },
    followers: followers?.n ?? 0,
    following: following?.n ?? 0,
    is_following: !!isFollowing,
    posts: r.results.map((x: any) => serializePost(x, liked)),
  });
});

api.post('/users/:handle/follow', async (c) => {
  const u = requireUser(c);
  const t = await c.env.DB.prepare("SELECT id, is_content FROM users WHERE handle = ? AND status = 'active'").bind(c.req.param('handle')).first<any>();
  if (!t) throw new HttpError(404, '找不到這位用戶');
  if (t.id === u.id) throw new HttpError(400, '不能追蹤自己');
  const r = await c.env.DB.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)').bind(u.id, t.id, now()).run();
  if (r.meta.changes && !t.is_content) {
    await c.env.DB.prepare('INSERT INTO notifications (id, user_id, actor_id, type, created_at) VALUES (?, ?, ?, ?, ?)').bind(newId(), t.id, u.id, 'follow', now()).run();
  }
  return c.json({ ok: true });
});

api.delete('/users/:handle/follow', async (c) => {
  const u = requireUser(c);
  const t = await c.env.DB.prepare('SELECT id FROM users WHERE handle = ?').bind(c.req.param('handle')).first<any>();
  if (t) await c.env.DB.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').bind(u.id, t.id).run();
  return c.json({ ok: true });
});

// ---------- 通知 ----------
api.get('/notifications', async (c) => {
  const u = requireUser(c);
  const r = await c.env.DB.prepare(
    `SELECT n.id, n.type, n.post_id, n.read, n.created_at, a.name, a.handle, a.avatar_key, a.is_content
     FROM notifications n JOIN users a ON a.id = n.actor_id WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 50`
  ).bind(u.id).all();
  return c.json({
    notifications: r.results.map((x: any) => ({
      id: x.id, type: x.type, post_id: x.post_id, read: !!x.read, created_at: x.created_at,
      actor: { name: x.name, handle: x.handle, avatar_url: imgUrl(x.avatar_key), is_content: !!x.is_content },
    })),
  });
});

api.post('/notifications/read', async (c) => {
  const u = requireUser(c);
  await c.env.DB.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').bind(u.id).run();
  return c.json({ ok: true });
});

// ---------- 檢舉 ----------
api.post('/reports', async (c) => {
  const u = requireUser(c);
  const b = await c.req.json<any>();
  if (!REPORT_REASONS.includes(b.reason)) throw new HttpError(400, '請選擇檢舉原因');
  if (!b.post_id && !b.comment_id) throw new HttpError(400, '缺少檢舉對象');
  const dup = await c.env.DB.prepare("SELECT 1 FROM reports WHERE reporter_id = ? AND IFNULL(post_id,'') = ? AND IFNULL(comment_id,'') = ? AND status = 'open'")
    .bind(u.id, b.post_id || '', b.comment_id || '').first();
  if (!dup) {
    await c.env.DB.prepare('INSERT INTO reports (id, post_id, comment_id, reporter_id, reason, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(newId(), b.post_id || null, b.comment_id || null, u.id, b.reason, String(b.detail || '').slice(0, 300), now()).run();
  }
  return c.json({ ok: true });
});

// ---------- 搜尋與話題 ----------
api.get('/search', async (c) => {
  const q = String(c.req.query('q') || '').trim().slice(0, 50);
  if (!q) return c.json({ users: [], posts: [] });
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const users = await c.env.DB.prepare("SELECT id, name, handle, avatar_key, is_content FROM users WHERE status != 'banned' AND (name LIKE ? OR handle LIKE ?) LIMIT 10").bind(like, like).all();
  const vis = await visibility(c);
  const posts = await c.env.DB.prepare(`SELECT ${POST_COLS} FROM posts p JOIN users u ON u.id = p.user_id WHERE ${vis} AND p.text LIKE ? ORDER BY p.created_at DESC LIMIT 20`).bind(like).all();
  const liked = await likedSetFor(c, posts.results.map((x: any) => x.id));
  return c.json({
    users: users.results.map((x: any) => ({ id: x.id, name: x.name, handle: x.handle, avatar_url: imgUrl(x.avatar_key), is_content: !!x.is_content })),
    posts: posts.results.map((x: any) => serializePost(x, liked)),
  });
});

api.get('/topics', async (c) => {
  const r = await c.env.DB.prepare("SELECT text FROM posts WHERE hidden = 0 AND sensitive = 0 AND created_at > ? AND text LIKE '%#%' LIMIT 500").bind(now() - 86400_000).all();
  const count = new Map<string, number>();
  for (const row of r.results as any[]) {
    for (const m of String(row.text).matchAll(/#([\p{L}\p{N}_]{1,20})/gu)) count.set(m[1], (count.get(m[1]) || 0) + 1);
  }
  const topics = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([tag, n]) => ({ tag, count: n }));
  return c.json({ topics });
});

// ---------- 圖片上傳 ----------
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
api.post('/upload', async (c) => {
  const u = requireUser(c);
  const recent = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM uploads WHERE user_id = ? AND created_at > ?').bind(u.id, now() - 3600_000).first<{ n: number }>();
  if ((recent?.n ?? 0) >= 20) throw new HttpError(429, '上傳太頻繁，請稍後再試');
  const form = await c.req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') throw new HttpError(400, '沒有收到圖片');
  if (!ALLOWED.includes(file.type)) throw new HttpError(400, '只能上傳 JPG、PNG、WebP 或 GIF');
  if (file.size > 5 * 1024 * 1024) throw new HttpError(400, '圖片不能超過 5MB');
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const isImg = (head[0] === 0xff && head[1] === 0xd8) || (head[0] === 0x89 && head[1] === 0x50) ||
    (head[0] === 0x47 && head[1] === 0x49) || (head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50);
  if (!isImg) throw new HttpError(400, '檔案不是有效的圖片');
  const d = new Date();
  const ext = file.type.split('/')[1].replace('jpeg', 'jpg');
  const key = `u/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${newId()}.${ext}`;
  await c.env.IMAGES.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  await c.env.DB.prepare('INSERT INTO uploads (key, user_id, created_at) VALUES (?, ?, ?)').bind(key, u.id, now()).run();
  return c.json({ key, url: imgUrl(key) });
});
