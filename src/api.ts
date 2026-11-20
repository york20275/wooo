import { Hono } from 'hono';
import type { AppEnv, Env, User } from './env';
import { canSeeSensitive, findMentions, getSetting, imgUrl, isBlockedEither, newId, now, twDay } from './env';
import { notify } from './notify';

export const api = new Hono<AppEnv>();

const POST_MAX = 1000;
const BLOG_MAX = 20000;
const COMMENT_MAX = 500;
export const THEMES = ['forestsky', 'mist', 'orangeblue', 'forest', 'lavender', 'ocean', 'sakura', 'lemon', 'mono'];
export const ACCENTS = ['#2E6A4E', '#2F74AE', '#B5501C', '#5B3FBF', '#0E6B6F', '#CF3F76', '#8A6600', '#1C1C1A'];
const REPORT_REASONS = ['spam', 'harassment', 'copyright', 'unmarked_sensitive', 'illegal', 'other'];

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function requireUser(c: any): User {
  const u = c.get('user') as User | null;
  if (!u) throw new HttpError(401, '請先登入');
  if (u.status !== 'active') throw new HttpError(403, '你的帳號目前無法執行這個動作');
  return u;
}

/** 新帳號（3 天內）在發文、留言、私訊前要先通過人機驗證（有設定 Turnstile 才啟用） */
export function needsHumanCheck(env: Env, u: User): boolean {
  return !!env.TURNSTILE_SECRET && !u.human_verified && now() - u.created_at < 3 * 86400_000 && u.role !== 'gm';
}
export function requireHuman(c: any, u: User) {
  if (needsHumanCheck(c.env, u)) throw new HttpError(428, '請先完成人機驗證');
}

const POST_COLS = `p.id, p.text, p.title, p.kind, p.image_key, p.image_credit, p.image_credit_url, p.link_url, p.link_title, p.link_site, p.sensitive, p.source,
  p.like_count, p.comment_count, p.created_at,
  u.id AS author_id, u.name AS author_name, u.handle AS author_handle, u.avatar_key AS author_avatar, u.is_content AS author_is_content`;

/**
 * 依排名順序合併，但 ✦ 內容在任何位置之前都不超過 ratio 比例；
 * 真人貼文不夠時，剩下的 ✦ 內容接在後面（網站剛起步時動態牆才不會空）。
 */
export function mixContent<T extends { source: string }>(ranked: T[], ratio: number): T[] {
  const out: T[] = [];
  const waiting: T[] = [];
  let nc = 0;
  const allowed = () => nc < Math.ceil((out.length + 1) * ratio);
  for (const x of ranked) {
    if (x.source !== 'content') {
      out.push(x);
      while (waiting.length && allowed()) { out.push(waiting.shift()!); nc++; }
    } else if (allowed() && !waiting.length) { out.push(x); nc++; }
    else waiting.push(x);
  }
  return out.concat(waiting);
}

export function serializePost(r: any, likedSet?: Set<string>) {
  return {
    id: r.id,
    kind: r.kind || 'post',
    title: r.title || null,
    text: r.text,
    image_url: imgUrl(r.image_key),
    image_credit: r.image_credit ? { name: r.image_credit, url: r.image_credit_url } : null,
    link: r.link_url ? { url: r.link_url, title: r.link_title, site: r.link_site } : null,
    sensitive: !!r.sensitive,
    created_at: r.created_at,
    like_count: r.like_count,
    comment_count: r.comment_count,
    liked: likedSet ? likedSet.has(r.id) : false,
    author: { id: r.author_id, name: r.author_name, handle: r.author_handle, avatar_url: imgUrl(r.author_avatar), is_content: !!r.author_is_content },
  };
}
const pubUser = (x: any) => ({ id: x.id, name: x.name, handle: x.handle, avatar_url: imgUrl(x.avatar_key), is_content: !!x.is_content });

async function likedSetFor(c: any, ids: string[]): Promise<Set<string>> {
  const u = c.get('user') as User | null;
  if (!u || ids.length === 0) return new Set();
  const qs = ids.map(() => '?').join(',');
  const r = await c.env.DB.prepare(`SELECT post_id FROM likes WHERE user_id = ? AND post_id IN (${qs})`).bind(u.id, ...ids).all();
  return new Set(r.results.map((x: any) => x.post_id));
}

/** 共用的可見性條件：隱藏、停權、敏感內容、內容帳號舊文、封鎖與靜音 */
export async function visibility(c: any, opts: { forHot?: boolean; ignoreBlocks?: boolean } = {}): Promise<[string, any[]]> {
  const u = c.get('user') as User | null;
  const parts = ['p.hidden = 0', "u.status != 'banned'"];
  const binds: any[] = [];
  if (opts.forHot || !canSeeSensitive(u)) parts.push('p.sensitive = 0');
  const enabled = await getSetting(c.env.DB, 'content_enabled', '1');
  const mode = await getSetting(c.env.DB, 'old_posts_mode', 'keep');
  if (enabled !== '1' && mode === 'hide') parts.push("p.source = 'user'");
  if (u && !opts.ignoreBlocks) {
    parts.push("p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)");
    parts.push("p.user_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ? AND kind = 'block')");
    binds.push(u.id, u.id);
  }
  return [parts.join(' AND '), binds];
}

// ---------- 自己 ----------
api.get('/me', async (c) => {
  const u = c.get('user');
  if (!u) return c.json({ user: null, vapid_public_key: c.env.VAPID_PUBLIC_KEY || null });
  const [unread, unreadMsg] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0').bind(u.id).first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM conversations WHERE (user_a = ? AND last_message_at > a_read_at) OR (user_b = ? AND last_message_at > b_read_at)`
    ).bind(u.id, u.id).first<{ n: number }>(),
  ]);
  return c.json({
    user: {
      id: u.id, name: u.name, handle: u.handle, bio: u.bio, email: u.email, avatar_url: imgUrl(u.avatar_key), banner_url: imgUrl(u.banner_key),
      accent: u.accent, pinned_post_id: u.pinned_post_id, role: u.role, theme: u.theme, age_verified: !!u.age_verified, show_sensitive: !!u.show_sensitive,
      onboarded: !!u.onboarded, needs_human_check: needsHumanCheck(c.env, u),
    },
    unread: unread?.n ?? 0,
    unread_messages: unreadMsg?.n ?? 0,
    dev_mode: c.env.DEV_MODE === '1',
    turnstile_sitekey: c.env.TURNSTILE_SITEKEY || null,
    vapid_public_key: c.env.VAPID_PUBLIC_KEY || null,
    accents: ACCENTS,
  });
});

async function ownUpload(db: D1Database, key: string, userId: string) {
  const own = await db.prepare('SELECT 1 FROM uploads WHERE key = ? AND user_id = ?').bind(key, userId).first();
  if (!own) throw new HttpError(400, '圖片不存在');
}

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
  if (typeof b.avatar_key === 'string') { await ownUpload(c.env.DB, b.avatar_key, u.id); sets.push('avatar_key = ?'); vals.push(b.avatar_key); }
  if (typeof b.banner_key === 'string') { await ownUpload(c.env.DB, b.banner_key, u.id); sets.push('banner_key = ?'); vals.push(b.banner_key); }
  if (b.banner_key === null) sets.push('banner_key = NULL');
  if (typeof b.accent === 'string' && ACCENTS.includes(b.accent)) { sets.push('accent = ?'); vals.push(b.accent); }
  if (b.pinned_post_id === null) sets.push('pinned_post_id = NULL');
  else if (typeof b.pinned_post_id === 'string') {
    const own = await c.env.DB.prepare('SELECT 1 FROM posts WHERE id = ? AND user_id = ?').bind(b.pinned_post_id, u.id).first();
    if (!own) throw new HttpError(400, '只能置頂自己的文章');
    sets.push('pinned_post_id = ?'); vals.push(b.pinned_post_id);
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
 * 由服務商回傳「已滿 18 歲」的結果後才把 age_verified 設為 1。只保存結果，不保存卡號或證件影像。
 */
api.post('/age/verify', async (c) => {
  const u = requireUser(c);
  if (c.env.DEV_MODE === '1') {
    await c.env.DB.prepare('UPDATE users SET age_verified = 1, show_sensitive = 1 WHERE id = ?').bind(u.id).run();
    return c.json({ ok: true, dev: true });
  }
  throw new HttpError(501, '年齡驗證服務尚未開通，敏感內容暫時無法開啟');
});

/** 人機驗證（Cloudflare Turnstile） */
api.post('/human/verify', async (c) => {
  const u = requireUser(c);
  if (!c.env.TURNSTILE_SECRET) return c.json({ ok: true });
  const b = await c.req.json<any>();
  const form = new URLSearchParams({ secret: c.env.TURNSTILE_SECRET, response: String(b.token || '') });
  const ip = c.req.header('cf-connecting-ip');
  if (ip) form.set('remoteip', ip);
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const j: any = await r.json();
  if (!j.success) throw new HttpError(400, '人機驗證失敗，請再試一次');
  await c.env.DB.prepare('UPDATE users SET human_verified = 1 WHERE id = ?').bind(u.id).run();
  return c.json({ ok: true });
});

// ---------- 動態牆 ----------
api.get('/feed', async (c) => {
  const tab = c.req.query('tab') === 'following' ? 'following' : 'hot';
  const before = Number(c.req.query('before') || 0);
  const u = c.get('user');
  let rows: any[];
  if (tab === 'following') {
    if (!u) return c.json({ posts: [] });
    const [vis, vb] = await visibility(c);
    const r = await c.env.DB.prepare(
      `SELECT ${POST_COLS} FROM posts p JOIN users u ON u.id = p.user_id
       WHERE ${vis} AND (p.user_id = ? OR p.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?))
       ${before ? 'AND p.created_at < ?' : ''} ORDER BY p.created_at DESC LIMIT 20`
    ).bind(...vb, u.id, u.id, ...(before ? [before] : [])).all();
    rows = r.results;
  } else {
    // 熱門：只算真人讚數，越新越前面；熱門不放敏感內容
    const [vis, vb] = await visibility(c, { forHot: true });
    const r = await c.env.DB.prepare(
      `SELECT ${POST_COLS}, p.real_like_count FROM posts p JOIN users u ON u.id = p.user_id
       WHERE ${vis} AND p.created_at > ? ORDER BY p.created_at DESC LIMIT 600`
    ).bind(...vb, now() - 2 * 86400_000).all();
    const t = now();
    const ranked = r.results
      .map((x: any) => ({ x, s: (x.real_like_count + 1) / Math.pow((t - x.created_at) / 3600_000 + 2, 1.5) }))
      .sort((a, b) => b.s - a.s)
      .map((y) => y.x);
    // ✦ 內容帳號的貼文最多只能佔熱門動態牆的一定比例，避免把真人的文洗掉
    const ratio = Math.min(100, Math.max(0, Number(await getSetting(c.env.DB, 'feed_content_ratio', '50')))) / 100;
    rows = mixContent(ranked, ratio);
    const mixed = rows;
    const offset = Number(c.req.query('offset') || 0);
    rows = mixed.slice(offset, offset + 20);
  }
  const liked = await likedSetFor(c, rows.map((r) => r.id));
  return c.json({ posts: rows.map((r) => serializePost(r, liked)) });
});

/** #標籤頁 */
api.get('/tags/:tag', async (c) => {
  const tag = c.req.param('tag').replace(/[%_]/g, '').slice(0, 20);
  const [vis, vb] = await visibility(c);
  const r = await c.env.DB.prepare(`SELECT ${POST_COLS} FROM posts p JOIN users u ON u.id = p.user_id WHERE ${vis} AND p.text LIKE ? ORDER BY p.created_at DESC LIMIT 50`)
    .bind(...vb, `%#${tag}%`).all();
  const rows = r.results.filter((x: any) => new RegExp(`#${tag}(?![\\p{L}\\p{N}_])`, 'u').test(x.text));
  const liked = await likedSetFor(c, rows.map((x: any) => x.id));
  return c.json({ tag, posts: rows.map((x: any) => serializePost(x, liked)) });
});

api.get('/posts/:id', async (c) => {
  const [vis, vb] = await visibility(c);
  const r = await c.env.DB.prepare(`SELECT ${POST_COLS} FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ? AND ${vis}`).bind(c.req.param('id'), ...vb).first();
  if (!r) throw new HttpError(404, '找不到這篇文章');
  const me = c.get('user');
  const cm = await c.env.DB.prepare(
    `SELECT c.id, c.text, c.parent_id, c.created_at, u.id AS uid, u.name, u.handle, u.avatar_key, u.is_content
     FROM comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ? AND c.hidden = 0 AND u.status != 'banned'
     ${me ? "AND c.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?) AND c.user_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ? AND kind = 'block')" : ''}
     ORDER BY c.created_at LIMIT 300`
  ).bind(r.id, ...(me ? [me.id, me.id] : [])).all();
  const liked = await likedSetFor(c, [r.id as string]);
  return c.json({
    post: serializePost(r, liked),
    comments: cm.results.map((x: any) => ({
      id: x.id, text: x.text, parent_id: x.parent_id, created_at: x.created_at,
      author: { id: x.uid, name: x.name, handle: x.handle, avatar_url: imgUrl(x.avatar_key), is_content: !!x.is_content },
    })),
  });
});

async function notifyMentions(c: any, author: User, text: string, postId: string) {
  if (author.is_content) return;
  const handles = findMentions(text);
  if (!handles.length) return;
  const qs = handles.map(() => '?').join(',');
  const r = await c.env.DB.prepare(`SELECT id FROM users WHERE handle IN (${qs}) AND is_content = 0 AND status = 'active'`).bind(...handles).all();
  for (const t of r.results as any[]) await notify(c.env, c.executionCtx, t.id, author, 'mention', postId, text);
}

api.post('/posts', async (c) => {
  const u = requireUser(c);
  requireHuman(c, u);
  const b = await c.req.json<any>();
  const kind = b.kind === 'blog' ? 'blog' : 'post';
  const text = String(b.text || '').trim();
  const title = kind === 'blog' ? String(b.title || '').trim().slice(0, 100) : null;
  if (kind === 'blog' && !title) throw new HttpError(400, '網誌要有標題');
  if (!text && !b.image_key) throw new HttpError(400, '內容不能空白');
  const max = kind === 'blog' ? BLOG_MAX : POST_MAX;
  if (text.length > max) throw new HttpError(400, `內容最多 ${max} 字`);
  const recent = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM posts WHERE user_id = ? AND created_at > ?').bind(u.id, now() - 3600_000).first<{ n: number }>();
  if ((recent?.n ?? 0) >= 30) throw new HttpError(429, '發文太頻繁，請稍後再試');
  let imageKey: string | null = null;
  if (b.image_key) { await ownUpload(c.env.DB, b.image_key, u.id); imageKey = b.image_key; }
  const id = newId();
  await c.env.DB.prepare('INSERT INTO posts (id, user_id, text, title, kind, image_key, sensitive, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, u.id, text, title, kind, imageKey, b.sensitive ? 1 : 0, 'user', now()).run();
  await notifyMentions(c, u, text, id);
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
    env.DB.prepare('UPDATE users SET pinned_post_id = NULL WHERE pinned_post_id = ?').bind(id),
  ]);
  if (imageKey) {
    await env.IMAGES.delete(imageKey);
    await env.DB.prepare('DELETE FROM uploads WHERE key = ?').bind(imageKey).run();
  }
}

// ---------- 讚 ----------
export async function addLike(env: any, postId: string, liker: { id: string; name?: string; is_content: number }, ctx?: { waitUntil(p: Promise<unknown>): void }) {
  const r = await env.DB.prepare('INSERT OR IGNORE INTO likes (post_id, user_id, created_at) VALUES (?, ?, ?)').bind(postId, liker.id, now()).run();
  if (!r.meta.changes) return false;
  await env.DB.prepare(`UPDATE posts SET like_count = like_count + 1${liker.is_content ? '' : ', real_like_count = real_like_count + 1'} WHERE id = ?`).bind(postId).run();
  if (!liker.is_content) {
    const p = await env.DB.prepare('SELECT user_id, text FROM posts WHERE id = ?').bind(postId).first();
    if (p) await notify(env, ctx, p.user_id, { id: liker.id, name: liker.name || '' }, 'like', postId, p.text);
  }
  return true;
}

async function assertNotBlockedByAuthor(c: any, u: User, postId: string) {
  const p = await c.env.DB.prepare('SELECT user_id FROM posts WHERE id = ? AND hidden = 0').bind(postId).first();
  if (!p) throw new HttpError(404, '找不到這篇文章');
  if (await isBlockedEither(c.env.DB, u.id, p.user_id)) throw new HttpError(403, '你無法與這位用戶互動');
  return p;
}

api.post('/posts/:id/like', async (c) => {
  const u = requireUser(c);
  const id = c.req.param('id');
  await assertNotBlockedByAuthor(c, u, id);
  await addLike(c.env, id, u, c.executionCtx);
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
  return c.json({ users: r.results.map(pubUser) });
});

// ---------- 留言（支援一層回覆） ----------
export async function addComment(env: any, postId: string, author: { id: string }, text: string, parentId: string | null = null) {
  const id = newId();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO comments (id, post_id, user_id, parent_id, text, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, postId, author.id, parentId, text, now()),
    env.DB.prepare('UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?').bind(postId),
  ]);
  return id;
}

api.post('/posts/:id/comments', async (c) => {
  const u = requireUser(c);
  requireHuman(c, u);
  const id = c.req.param('id');
  const b = await c.req.json<any>();
  const text = String(b.text || '').trim();
  if (!text) throw new HttpError(400, '留言不能空白');
  if (text.length > COMMENT_MAX) throw new HttpError(400, `留言最多 ${COMMENT_MAX} 字`);
  const post = await assertNotBlockedByAuthor(c, u, id);
  const recent = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM comments WHERE user_id = ? AND created_at > ?').bind(u.id, now() - 3600_000).first<{ n: number }>();
  if ((recent?.n ?? 0) >= 120) throw new HttpError(429, '留言太頻繁，請稍後再試');
  let parentId: string | null = null;
  let parentAuthor: string | null = null;
  if (b.parent_id) {
    const parent = await c.env.DB.prepare('SELECT id, user_id, parent_id FROM comments WHERE id = ? AND post_id = ?').bind(b.parent_id, id).first<any>();
    if (!parent) throw new HttpError(400, '找不到要回覆的留言');
    parentId = parent.parent_id || parent.id; // 只保留一層
    parentAuthor = parent.user_id;
    if (await isBlockedEither(c.env.DB, u.id, parent.user_id)) throw new HttpError(403, '你無法回覆這位用戶');
  }
  const cid = await addComment(c.env, id, u, text, parentId);
  await notify(c.env, c.executionCtx, post.user_id, u, 'comment', id, text);
  if (parentAuthor && parentAuthor !== post.user_id) await notify(c.env, c.executionCtx, parentAuthor, u, 'reply', id, text);
  await notifyMentions(c, u, text, id);
  return c.json({ id: cid });
});

api.delete('/comments/:id', async (c) => {
  const u = requireUser(c);
  const cm = await c.env.DB.prepare('SELECT user_id, post_id FROM comments WHERE id = ?').bind(c.req.param('id')).first<any>();
  if (!cm) throw new HttpError(404, '找不到這則留言');
  if (cm.user_id !== u.id && u.role !== 'gm') throw new HttpError(403, '沒有權限');
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM comments WHERE id = ? OR parent_id = ?').bind(c.req.param('id'), c.req.param('id')).first<{ n: number }>();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM comments WHERE id = ? OR parent_id = ?').bind(c.req.param('id'), c.req.param('id')),
    c.env.DB.prepare('UPDATE posts SET comment_count = MAX(comment_count - ?, 0) WHERE id = ?').bind(n?.n ?? 1, cm.post_id),
  ]);
  return c.json({ ok: true });
});

// ---------- 用戶與追蹤 ----------
api.get('/users/:handle', async (c) => {
  const p = await c.env.DB.prepare("SELECT * FROM users WHERE handle = ? AND status != 'banned'").bind(c.req.param('handle')).first<User>();
  if (!p) throw new HttpError(404, '找不到這位用戶');
  const me = c.get('user');
  const [followers, following, isFollowing, stats, rel] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?').bind(p.id).first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?').bind(p.id).first<{ n: number }>(),
    me ? c.env.DB.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').bind(me.id, p.id).first() : Promise.resolve(null),
    c.env.DB.prepare('SELECT total, today, today_day FROM profile_stats WHERE user_id = ?').bind(p.id).first<any>(),
    me ? c.env.DB.prepare('SELECT kind FROM blocks WHERE blocker_id = ? AND blocked_id = ?').bind(me.id, p.id).all() : Promise.resolve({ results: [] } as any),
  ]);
  const blockedMe = me ? await c.env.DB.prepare("SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ? AND kind = 'block'").bind(p.id, me.id).first() : null;
  const kinds = new Set((rel.results as any[]).map((x) => x.kind));
  const tab = c.req.query('tab') === 'blog' ? 'blog' : 'posts';
  let posts: any[] = [];
  let pinned: any = null;
  if (!blockedMe) {
    // 個人頁不套用封鎖／靜音過濾（被對方封鎖時上面已經擋掉）
    const [vis, vb] = await visibility(c, { ignoreBlocks: true });
    const r = await c.env.DB.prepare(
      `SELECT ${POST_COLS} FROM posts p JOIN users u ON u.id = p.user_id WHERE ${vis} AND p.user_id = ? ${tab === 'blog' ? "AND p.kind = 'blog'" : ''} ORDER BY p.created_at DESC LIMIT 30`
    ).bind(...vb, p.id).all();
    const liked = await likedSetFor(c, r.results.map((x: any) => x.id));
    posts = r.results.map((x: any) => serializePost(x, liked));
    if (p.pinned_post_id && tab === 'posts') {
      pinned = posts.find((x) => x.id === p.pinned_post_id) || null;
      if (pinned) posts = posts.filter((x) => x.id !== pinned.id);
    }
  }
  const today = stats && stats.today_day === twDay() ? stats.today : 0;
  return c.json({
    user: {
      id: p.id, name: p.name, handle: p.handle, bio: p.bio, avatar_url: imgUrl(p.avatar_key), banner_url: imgUrl(p.banner_key), accent: p.accent,
      is_content: !!p.is_content, created_at: p.created_at,
    },
    followers: followers?.n ?? 0,
    following: following?.n ?? 0,
    is_following: !!isFollowing,
    blocked: kinds.has('block'),
    muted: kinds.has('mute'),
    blocked_me: !!blockedMe,
    visits: { today, total: stats?.total ?? 0 },
    pinned,
    posts,
  });
});

api.post('/users/:handle/follow', async (c) => {
  const u = requireUser(c);
  const t = await c.env.DB.prepare("SELECT id, is_content FROM users WHERE handle = ? AND status = 'active'").bind(c.req.param('handle')).first<any>();
  if (!t) throw new HttpError(404, '找不到這位用戶');
  if (t.id === u.id) throw new HttpError(400, '不能追蹤自己');
  if (await isBlockedEither(c.env.DB, u.id, t.id)) throw new HttpError(403, '你無法追蹤這位用戶');
  const r = await c.env.DB.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)').bind(u.id, t.id, now()).run();
  if (r.meta.changes) await notify(c.env, c.executionCtx, t.id, u, 'follow', null);
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
  const [vis, vb] = await visibility(c);
  const posts = await c.env.DB.prepare(`SELECT ${POST_COLS} FROM posts p JOIN users u ON u.id = p.user_id WHERE ${vis} AND (p.text LIKE ? OR p.title LIKE ?) ORDER BY p.created_at DESC LIMIT 20`).bind(...vb, like, like).all();
  const liked = await likedSetFor(c, posts.results.map((x: any) => x.id));
  return c.json({ users: users.results.map(pubUser), posts: posts.results.map((x: any) => serializePost(x, liked)) });
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
  if ((recent?.n ?? 0) >= 60) throw new HttpError(429, '上傳太頻繁，請稍後再試');
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
