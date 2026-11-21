import { Hono } from 'hono';
import type { AppEnv, Env, User } from './env';
import { canSeeSensitive, findMentions, getSetting, imgUrl, isBlockedEither, logAudit, newId, now, twDay } from './env';
import { cleanReason, MOD_REASONS, recordAction } from './moderation';
import { badgesFor, DEFAULT_BOARD } from './features';
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

export const POST_COLS = `p.id, p.user_id, p.text, p.title, p.kind, p.image_key, p.images, p.repost_of, p.quote_of, p.repost_count, p.community_id, p.is_daily, p.view_count, p.image_credit, p.image_credit_url, p.link_url, p.link_title, p.link_site, p.link_image, p.sensitive, p.source,
  p.like_count, p.comment_count, p.created_at,
  u.id AS author_id, u.name AS author_name, u.handle AS author_handle, u.avatar_key AS author_avatar, u.is_content AS author_is_content`;

/**
 * 依排名順序合併，但 ✦ 內容在任何位置之前都不超過 ratio 比例；
 * 真人貼文不夠時，剩下的 ✦ 內容接在後面（網站剛起步時動態牆才不會空）。
 */
export function diversifyBoards<T extends { community_id?: string | null }>(rows: T[], maxRun = 2): T[] {
  const out: T[] = [];
  const rest = [...rows];
  while (rest.length) {
    const last = out.slice(-maxRun);
    const blocked = last.length === maxRun && last.every((x) => x.community_id && x.community_id === last[0].community_id) ? last[0].community_id : null;
    const i = blocked ? rest.findIndex((x) => x.community_id !== blocked) : 0;
    out.push(rest.splice(i < 0 ? 0 : i, 1)[0]);
  }
  return out;
}

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

export const REACTIONS = ['❤️', '😂', '😮', '😢', '😡'];
export const pubUser = (x: any) => ({ id: x.id, name: x.name, handle: x.handle, avatar_url: imgUrl(x.avatar_key), is_content: !!x.is_content });

function imageKeys(r: any): string[] {
  if (r.images) { try { const a = JSON.parse(r.images); if (Array.isArray(a) && a.length) return a.slice(0, 4); } catch {} }
  return r.image_key ? [r.image_key] : [];
}

interface Ctx { reactions: Map<string, string>; summary: Map<string, { emoji: string; n: number }[]>; bookmarks: Set<string>; polls: Map<string, any>; communities: Map<string, any> }

export function serializePost(r: any, ctx?: Ctx) {
  const imgs = imageKeys(r).map((k) => imgUrl(k)!);
  const reaction = ctx?.reactions.get(r.id) ?? null;
  return {
    id: r.id,
    kind: r.kind || 'post',
    title: r.title || null,
    text: r.text,
    image_url: imgs[0] ?? null,
    images: imgs,
    image_credit: r.image_credit ? { name: r.image_credit, url: r.image_credit_url } : null,
    link: r.link_url ? { url: r.link_url, title: r.link_title, site: r.link_site, image: r.link_image || null } : null,
    sensitive: !!r.sensitive,
    created_at: r.created_at,
    like_count: r.like_count,
    comment_count: r.comment_count,
    repost_count: r.repost_count || 0,
    view_count: r.view_count || 0,
    liked: !!reaction,
    reaction,
    reactions: ctx?.summary.get(r.id) ?? [],
    bookmarked: ctx?.bookmarks.has(r.id) ?? false,
    poll: ctx?.polls.get(r.id) ?? null,
    community: r.community_id ? ctx?.communities.get(r.community_id) ?? null : null,
    is_daily: !!r.is_daily,
    author: { id: r.author_id, name: r.author_name, handle: r.author_handle, avatar_url: imgUrl(r.author_avatar), is_content: !!r.author_is_content },
  };
}

const inList = (ids: string[]) => ids.map(() => '?').join(',');

/** 自己對每篇文的表情回應 */
async function reactionsFor(c: any, ids: string[]): Promise<Map<string, string>> {
  const u = c.get('user') as User | null;
  if (!u || ids.length === 0) return new Map();
  const r = await c.env.DB.prepare(`SELECT post_id, emoji FROM likes WHERE user_id = ? AND post_id IN (${inList(ids)})`).bind(u.id, ...ids).all();
  return new Map(r.results.map((x: any) => [x.post_id, x.emoji]));
}
async function reactionSummary(c: any, ids: string[]) {
  const out = new Map<string, { emoji: string; n: number }[]>();
  if (!ids.length) return out;
  const r = await c.env.DB.prepare(`SELECT post_id, emoji, COUNT(*) AS n FROM likes WHERE post_id IN (${inList(ids)}) GROUP BY post_id, emoji`).bind(...ids).all();
  for (const x of r.results as any[]) {
    if (!out.has(x.post_id)) out.set(x.post_id, []);
    out.get(x.post_id)!.push({ emoji: x.emoji, n: x.n });
  }
  for (const v of out.values()) v.sort((a, b) => b.n - a.n);
  return out;
}
async function bookmarksFor(c: any, ids: string[]): Promise<Set<string>> {
  const u = c.get('user') as User | null;
  if (!u || ids.length === 0) return new Set();
  const r = await c.env.DB.prepare(`SELECT post_id FROM bookmarks WHERE user_id = ? AND post_id IN (${inList(ids)})`).bind(u.id, ...ids).all();
  return new Set(r.results.map((x: any) => x.post_id));
}
async function communitiesFor(c: any, ids: string[]) {
  const out = new Map<string, any>();
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return out;
  const r = await c.env.DB.prepare(`SELECT id, slug, name, icon FROM communities WHERE id IN (${inList(uniq)})`).bind(...uniq).all();
  for (const x of r.results as any[]) out.set(x.id, { slug: x.slug, name: x.name, icon: x.icon });
  return out;
}

/** 一次載入多篇文章的投票（選項、票數、自己投了哪個） */
export async function pollsFor(c: any, ids: string[]): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  if (!ids.length) return out;
  const polls = await c.env.DB.prepare(`SELECT post_id, ends_at FROM polls WHERE post_id IN (${inList(ids)})`).bind(...ids).all();
  if (!polls.results.length) return out;
  const pids = polls.results.map((p: any) => p.post_id);
  const pq = inList(pids);
  const opts = await c.env.DB.prepare(`SELECT post_id, idx, text, votes FROM poll_options WHERE post_id IN (${pq}) ORDER BY idx`).bind(...pids).all();
  const u = c.get('user') as User | null;
  const mine = u ? await c.env.DB.prepare(`SELECT post_id, idx FROM poll_votes WHERE user_id = ? AND post_id IN (${pq})`).bind(u.id, ...pids).all() : { results: [] };
  const voted = new Map((mine.results as any[]).map((v) => [v.post_id, v.idx]));
  for (const p of polls.results as any[]) {
    const options = (opts.results as any[]).filter((o) => o.post_id === p.post_id).map((o) => ({ text: o.text, votes: o.votes }));
    out.set(p.post_id, { options, total: options.reduce((s, o) => s + o.votes, 0), ends_at: p.ends_at, closed: p.ends_at <= now(), voted: voted.has(p.post_id) ? voted.get(p.post_id) : null });
  }
  return out;
}

/**
 * 文章列表輸出：表情回應、收藏、投票、分類版、轉發／引用的原文一起載入。
 * 轉發會輸出成「原文＋repost（誰轉發）」；原文被刪或隱藏的轉發會略過。
 */
export async function serializeMany(c: any, rows: any[]) {
  const origIds = [...new Set(rows.flatMap((r) => [r.repost_of, r.quote_of]).filter(Boolean))] as string[];
  const originals = new Map<string, any>();
  if (origIds.length) {
    const r = await c.env.DB.prepare(`SELECT ${POST_COLS} FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id IN (${inList(origIds)}) AND p.hidden = 0 AND u.status != 'banned'`).bind(...origIds).all();
    for (const x of r.results as any[]) originals.set(x.id, x);
  }
  const all = [...rows.filter((r) => r.kind !== 'repost'), ...originals.values()];
  const ids = [...new Set(all.map((r) => r.id as string))];
  const [reactions, summary, bookmarks, polls, communities] = await Promise.all([
    reactionsFor(c, ids), reactionSummary(c, ids), bookmarksFor(c, ids), pollsFor(c, ids), communitiesFor(c, all.map((r) => r.community_id)),
  ]);
  const ctx: Ctx = { reactions, summary, bookmarks, polls, communities };
  const out: any[] = [];
  for (const r of rows) {
    if (r.kind === 'repost') {
      const o = originals.get(r.repost_of);
      if (!o) continue;
      const s: any = serializePost(o, ctx);
      if (o.quote_of) s.quote = { deleted: true };
      s.repost = { id: r.id, created_at: r.created_at, by: { id: r.author_id, name: r.author_name, handle: r.author_handle } };
      out.push(s);
      continue;
    }
    const s: any = serializePost(r, ctx);
    if (r.quote_of) {
      const o = originals.get(r.quote_of);
      s.quote = o ? serializePost(o, ctx) : { deleted: true };
    }
    out.push(s);
  }
  return out;
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
    // 自己設定的過濾字詞（自己的文不過濾）
    const muted = await c.env.DB.prepare('SELECT word FROM muted_words WHERE user_id = ? LIMIT 50').bind(u.id).all();
    for (const m of muted.results as any[]) {
      parts.push("(p.user_id = ? OR (instr(lower(p.text), ?) = 0 AND instr(lower(IFNULL(p.title, '')), ?) = 0))");
      const w = String(m.word).toLowerCase();
      binds.push(u.id, w, w);
    }
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
      onboarded: !!u.onboarded, needs_human_check: needsHumanCheck(c.env, u), status: u.status,
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
    if (b.show_sensitive && !u.age_verified) throw new HttpError(403, '需要先確認年滿 18 歲');
    sets.push('show_sensitive = ?'); vals.push(b.show_sensitive ? 1 : 0);
  }
  if (sets.length) await c.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, u.id).run();
  return c.json({ ok: true });
});

/** 年齡確認：用戶自己勾選「我已年滿 18 歲」後才能開啟敏感內容（記錄確認時間） */
api.post('/age/verify', async (c) => {
  const u = requireUser(c);
  const b = await c.req.json<any>().catch(() => ({}));
  if (b.confirm18 !== true) throw new HttpError(400, '請先勾選「我已年滿 18 歲」');
  await c.env.DB.prepare('UPDATE users SET age_verified = 1, show_sensitive = 1 WHERE id = ?').bind(u.id).run();
  return c.json({ ok: true });
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
    // 可以只看某個分類版的熱門（?board=slug）
    const board = c.req.query('board') ? await c.env.DB.prepare('SELECT id FROM communities WHERE slug = ?').bind(c.req.query('board')).first<{ id: string }>() : null;
    const r = await c.env.DB.prepare(
      `SELECT ${POST_COLS}, p.real_like_count FROM posts p JOIN users u ON u.id = p.user_id
       WHERE ${vis} AND p.kind != 'repost' ${board ? 'AND p.community_id = ?' : ''} AND p.created_at > ? ORDER BY p.created_at DESC LIMIT 600`
    ).bind(...vb, ...(board ? [board.id] : []), now() - 2 * 86400_000).all();
    const t = now();
    const ranked = r.results
      // 像脆的「為你推薦」：看互動熱度（讚、留言、轉發、瀏覽），越新越前面，不限追蹤對象
      .map((x: any) => ({ x, s: (x.real_like_count + (x.comment_count || 0) * 2 + (x.repost_count || 0) * 3 + (x.view_count || 0) * 0.02 + 1) / Math.pow((t - x.created_at) / 3600_000 + 2, 1.5) }))
      .sort((a, b) => b.s - a.s)
      .map((y) => y.x);
    // ✦ 內容帳號的貼文最多只能佔熱門動態牆的一定比例，避免把真人的文洗掉
    const ratio = Math.min(100, Math.max(0, Number(await getSetting(c.env.DB, 'feed_content_ratio', '50')))) / 100;
    rows = mixContent(ranked, ratio);
    // 全部版一起看時，同一個分類版不連續出現超過 2 篇，熱門才會看到各版的文
    const mixed = board ? rows : diversifyBoards(rows);
    const offset = Number(c.req.query('offset') || 0);
    rows = mixed.slice(offset, offset + 20);
  }
  return c.json({ posts: await serializeMany(c, rows) });
});

/** #標籤頁 */
api.get('/tags/:tag', async (c) => {
  const tag = c.req.param('tag').replace(/[%_]/g, '').slice(0, 20);
  const [vis, vb] = await visibility(c);
  const r = await c.env.DB.prepare(`SELECT ${POST_COLS} FROM posts p JOIN users u ON u.id = p.user_id WHERE ${vis} AND p.text LIKE ? ORDER BY p.created_at DESC LIMIT 50`)
    .bind(...vb, `%#${tag}%`).all();
  const rows = r.results.filter((x: any) => new RegExp(`#${tag}(?![\\p{L}\\p{N}_])`, 'u').test(x.text));
  return c.json({ tag, posts: await serializeMany(c, rows) });
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
  const [post] = await serializeMany(c, [r]);
  return c.json({
    post,
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
  // 投票：2～5 個選項，每個最多 40 字，期限 1／3／7 天
  let poll: { options: string[]; days: number } | null = null;
  if (b.poll && kind === 'post') {
    const options = (Array.isArray(b.poll.options) ? b.poll.options : []).map((x: any) => String(x || '').trim()).filter(Boolean);
    if (options.length < 2 || options.length > 5) throw new HttpError(400, '投票要有 2 到 5 個選項');
    if (options.some((o: string) => o.length > 40)) throw new HttpError(400, '每個選項最多 40 字');
    if (new Set(options).size !== options.length) throw new HttpError(400, '選項不能重複');
    if (!text) throw new HttpError(400, '請寫下投票的題目');
    poll = { options, days: [1, 3, 7].includes(Number(b.poll.days)) ? Number(b.poll.days) : 1 };
  }
  const keys: string[] = (Array.isArray(b.image_keys) ? b.image_keys : b.image_key ? [b.image_key] : []).map(String).slice(0, 4);
  if (Array.isArray(b.image_keys) && b.image_keys.length > 4) throw new HttpError(400, '一篇最多 4 張圖片');
  // 引用轉發
  let quoteOf: string | null = null;
  let quoteAuthor: string | null = null;
  if (b.quote_of) {
    let q = await c.env.DB.prepare("SELECT p.id, p.user_id, p.kind, p.repost_of FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ? AND p.hidden = 0 AND u.status != 'banned'").bind(String(b.quote_of)).first<any>();
    if (q?.kind === 'repost') q = await c.env.DB.prepare('SELECT id, user_id FROM posts WHERE id = ? AND hidden = 0').bind(q.repost_of).first<any>();
    if (!q) throw new HttpError(404, '原文已不存在');
    if (await isBlockedEither(c.env.DB, u.id, q.user_id)) throw new HttpError(403, '你無法引用這位用戶的文章');
    if (!text) throw new HttpError(400, '引用轉發要寫點什麼；不想寫的話用「轉發」就好');
    quoteOf = q.id; quoteAuthor = q.user_id;
  }
  // 分類版：一般貼文一定要在某個分類版裡（沒選就放「暢所欲言」）；網誌與引用轉發可以不選
  let communityId: string | null = null;
  if (b.community_id || (kind === 'post' && !quoteOf)) {
    const want = String(b.community_id || DEFAULT_BOARD);
    const cm = await c.env.DB.prepare('SELECT id FROM communities WHERE id = ?').bind(want).first<{ id: string }>();
    if (!cm) throw new HttpError(400, '找不到這個分類版');
    communityId = cm.id;
  }
  if (!text && !keys.length) throw new HttpError(400, '內容不能空白');
  const max = kind === 'blog' ? BLOG_MAX : POST_MAX;
  if (text.length > max) throw new HttpError(400, `內容最多 ${max} 字`);
  const recent = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM posts WHERE user_id = ? AND created_at > ?').bind(u.id, now() - 3600_000).first<{ n: number }>();
  if ((recent?.n ?? 0) >= 30) throw new HttpError(429, '發文太頻繁，請稍後再試');
  for (const k of keys) await ownUpload(c.env.DB, k, u.id);
  const id = newId();
  await c.env.DB.prepare('INSERT INTO posts (id, user_id, text, title, kind, image_key, images, quote_of, community_id, sensitive, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, u.id, text, title, kind, keys[0] ?? null, keys.length > 1 ? JSON.stringify(keys) : null, quoteOf, communityId, b.sensitive ? 1 : 0, 'user', now()).run();
  if (quoteOf) {
    await c.env.DB.prepare('UPDATE posts SET repost_count = repost_count + 1 WHERE id = ?').bind(quoteOf).run();
    await notify(c.env, c.executionCtx, quoteAuthor!, u, 'quote', id, text);
  }
  if (communityId) await c.env.DB.prepare('UPDATE communities SET post_count = post_count + 1 WHERE id = ?').bind(communityId).run();
  if (poll) {
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO polls (post_id, ends_at) VALUES (?, ?)').bind(id, now() + poll.days * 86400_000),
      ...poll.options.map((o, i) => c.env.DB.prepare('INSERT INTO poll_options (post_id, idx, text) VALUES (?, ?, ?)').bind(id, i, o)),
    ]);
  }
  await notifyMentions(c, u, text, id);
  return c.json({ id });
});

/** 投票：每人一票，投了不能改；投票結束後不能再投 */
api.post('/posts/:id/vote', async (c) => {
  const u = requireUser(c);
  requireHuman(c, u);
  const id = c.req.param('id');
  const idx = Number((await c.req.json<any>()).idx);
  const [vis, vb] = await visibility(c);
  const post = await c.env.DB.prepare(`SELECT p.id FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ? AND ${vis}`).bind(id, ...vb).first();
  if (!post) throw new HttpError(404, '找不到這篇文章');
  const poll = await c.env.DB.prepare('SELECT ends_at FROM polls WHERE post_id = ?').bind(id).first<{ ends_at: number }>();
  if (!poll) throw new HttpError(404, '這篇文章沒有投票');
  if (poll.ends_at <= now()) throw new HttpError(400, '投票已經結束');
  const opt = await c.env.DB.prepare('SELECT 1 FROM poll_options WHERE post_id = ? AND idx = ?').bind(id, idx).first();
  if (!opt) throw new HttpError(400, '沒有這個選項');
  const r = await c.env.DB.prepare('INSERT OR IGNORE INTO poll_votes (post_id, user_id, idx, created_at) VALUES (?, ?, ?, ?)').bind(id, u.id, idx, now()).run();
  if (r.meta.changes) await c.env.DB.prepare('UPDATE poll_options SET votes = votes + 1 WHERE post_id = ? AND idx = ?').bind(id, idx).run();
  const polls = await pollsFor(c, [id]);
  return c.json({ poll: polls.get(id) });
});

/** 瀏覽次數：前端把真的出現在畫面上的文章 id 批次送來（每次最多 50 篇） */
api.post('/views', async (c) => {
  const b = await c.req.json<any>().catch(() => ({}));
  const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(String).filter((x: string) => /^[\w]{6,40}$/.test(x)))].slice(0, 50) as string[];
  if (ids.length) await c.env.DB.prepare(`UPDATE posts SET view_count = view_count + 1 WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).run();
  return c.json({ ok: true });
});

/** 打字時的提示：@帳號、#標籤 */
api.get('/suggest', async (c) => {
  const type = c.req.query('type');
  const q = String(c.req.query('q') || '').replace(/[%_]/g, '').trim().slice(0, 30);
  if (type === 'user') {
    if (!q) return c.json({ items: [] });
    const r = await c.env.DB.prepare("SELECT name, handle, avatar_key, is_content FROM users WHERE status = 'active' AND (handle LIKE ? OR name LIKE ?) ORDER BY is_content, last_seen_at DESC LIMIT 6")
      .bind(`${q}%`, `%${q}%`).all();
    return c.json({ items: r.results.map((x: any) => ({ name: x.name, handle: x.handle, avatar_url: imgUrl(x.avatar_key), is_content: !!x.is_content })) });
  }
  const r = await c.env.DB.prepare("SELECT text FROM posts WHERE hidden = 0 AND created_at > ? AND text LIKE ? ORDER BY created_at DESC LIMIT 400").bind(now() - 14 * 86400_000, `%#${q}%`).all();
  const count = new Map<string, number>();
  for (const row of r.results as any[]) for (const m of String(row.text).matchAll(/#([\p{L}\p{N}_]{1,20})/gu)) if (m[1].toLowerCase().startsWith(q.toLowerCase())) count.set(m[1], (count.get(m[1]) || 0) + 1);
  return c.json({ items: [...count.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([tag, n]) => ({ tag, count: n })) });
});

api.delete('/posts/:id', async (c) => {
  const u = requireUser(c);
  const p = await c.env.DB.prepare('SELECT user_id, image_key FROM posts WHERE id = ?').bind(c.req.param('id')).first<any>();
  if (!p) throw new HttpError(404, '找不到這篇文章');
  if (p.user_id !== u.id && u.role !== 'gm') throw new HttpError(403, '沒有權限');
  if (p.user_id !== u.id) {
    // GM 刪別人的文：記錄原因並通知本人
    const b = await c.req.json<any>().catch(() => ({}));
    const full = await c.env.DB.prepare('SELECT text FROM posts WHERE id = ?').bind(c.req.param('id')).first<any>();
    await logAudit(c.env.DB, u.id, 'post_delete', c.req.param('id'), MOD_REASONS[cleanReason(b.reason)]);
    await recordAction(c.env, c.executionCtx, { userId: p.user_id, targetType: 'post', targetId: c.req.param('id'), action: 'delete', reason: b.reason, detail: b.detail, snapshot: full?.text, gmId: u.id });
  }
  await deletePost(c.env, c.req.param('id'), p.image_key);
  return c.json({ ok: true });
});

export async function deletePost(env: any, id: string, imageKey: string | null) {
  const p = await env.DB.prepare('SELECT images, image_key, repost_of, quote_of, community_id FROM posts WHERE id = ?').bind(id).first();
  const keys = p ? imageKeys(p) : imageKey ? [imageKey] : [];
  const orig = p?.repost_of || p?.quote_of;
  await env.DB.batch([
    ...(orig ? [env.DB.prepare('UPDATE posts SET repost_count = MAX(repost_count - 1, 0) WHERE id = ?').bind(orig)] : []),
    ...(p?.community_id ? [env.DB.prepare('UPDATE communities SET post_count = MAX(post_count - 1, 0) WHERE id = ?').bind(p.community_id)] : []),
    env.DB.prepare("DELETE FROM posts WHERE repost_of = ? AND kind = 'repost'").bind(id),
    env.DB.prepare('DELETE FROM bookmarks WHERE post_id = ?').bind(id),
    env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id),
    env.DB.prepare('DELETE FROM comments WHERE post_id = ?').bind(id),
    env.DB.prepare('DELETE FROM likes WHERE post_id = ?').bind(id),
    env.DB.prepare('DELETE FROM polls WHERE post_id = ?').bind(id),
    env.DB.prepare('DELETE FROM poll_options WHERE post_id = ?').bind(id),
    env.DB.prepare('DELETE FROM poll_votes WHERE post_id = ?').bind(id),
    env.DB.prepare('DELETE FROM notifications WHERE post_id = ?').bind(id),
    env.DB.prepare('UPDATE users SET pinned_post_id = NULL WHERE pinned_post_id = ?').bind(id),
  ]);
  for (const k of keys) {
    await env.IMAGES.delete(k);
    await env.DB.prepare('DELETE FROM uploads WHERE key = ?').bind(k).run();
  }
}

// ---------- 讚 ----------
export async function addLike(env: any, postId: string, liker: { id: string; name?: string; is_content: number }, ctx?: { waitUntil(p: Promise<unknown>): void }, emoji = '❤️') {
  if (!REACTIONS.includes(emoji)) emoji = '❤️';
  const r = await env.DB.prepare('INSERT OR IGNORE INTO likes (post_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)').bind(postId, liker.id, emoji, now()).run();
  if (!r.meta.changes) {
    // 已經回應過：換成新的表情，不重複計數
    await env.DB.prepare('UPDATE likes SET emoji = ? WHERE post_id = ? AND user_id = ?').bind(emoji, postId, liker.id).run();
    return false;
  }
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
  const b = await c.req.json<any>().catch(() => ({}));
  await addLike(c.env, id, u, c.executionCtx, b.emoji);
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
    `SELECT u.id, u.name, u.handle, u.avatar_key, u.is_content, l.emoji FROM likes l JOIN users u ON u.id = l.user_id
     WHERE l.post_id = ? AND u.status != 'banned' ORDER BY l.created_at DESC LIMIT 200`
  ).bind(c.req.param('id')).all();
  return c.json({ users: r.results.map((x: any) => ({ ...pubUser(x), emoji: x.emoji })) });
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
  if (cm.user_id !== u.id) {
    const b = await c.req.json<any>().catch(() => ({}));
    const full = await c.env.DB.prepare('SELECT text FROM comments WHERE id = ?').bind(c.req.param('id')).first<any>();
    await logAudit(c.env.DB, u.id, 'comment_delete', c.req.param('id'), MOD_REASONS[cleanReason(b.reason)]);
    await recordAction(c.env, c.executionCtx, { userId: cm.user_id, targetType: 'comment', targetId: c.req.param('id'), action: 'delete', reason: b.reason, detail: b.detail, snapshot: full?.text, gmId: u.id });
  }
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
    posts = await serializeMany(c, r.results);
    if (p.pinned_post_id && tab === 'posts') {
      pinned = posts.find((x) => x.id === p.pinned_post_id) || null;
      if (pinned) posts = posts.filter((x) => x.id !== pinned.id);
    }
  }
  const today = stats && stats.today_day === twDay() ? stats.today : 0;
  const badges = await badgesFor(c.env, p);
  return c.json({
    badges,
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
  const u = c.get('user') as User | null;
  if (!u) throw new HttpError(401, '請先登入');
  const r = await c.env.DB.prepare(
    `SELECT n.id, n.type, n.post_id, n.ref_id, n.read, n.created_at, a.name, a.handle, a.avatar_key, a.is_content
     FROM notifications n JOIN users a ON a.id = n.actor_id WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 50`
  ).bind(u.id).all();
  return c.json({
    notifications: r.results.map((x: any) => ({
      id: x.id, type: x.type, post_id: x.post_id, ref_id: x.ref_id, read: !!x.read, created_at: x.created_at,
      actor: { name: x.name, handle: x.handle, avatar_url: imgUrl(x.avatar_key), is_content: !!x.is_content },
    })),
  });
});

api.post('/notifications/read', async (c) => {
  const u = c.get('user') as User | null;
  if (!u) throw new HttpError(401, '請先登入');
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
  return c.json({ users: users.results.map(pubUser), posts: await serializeMany(c, posts.results) });
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
