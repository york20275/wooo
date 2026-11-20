import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import type { AppEnv, User } from './env';
import { canSeeSensitive, imgUrl, isBlockedEither, newId, now, twDay } from './env';
import { HttpError, requireHuman, requireUser } from './api';
import { notify } from './notify';

export const social = new Hono<AppEnv>();
const pubUser = (x: any) => ({ id: x.id, name: x.name, handle: x.handle, avatar_url: imgUrl(x.avatar_key), is_content: !!x.is_content });

async function findUser(db: D1Database, handle: string) {
  const t = await db.prepare("SELECT * FROM users WHERE handle = ? AND status != 'banned'").bind(handle).first<User>();
  if (!t) throw new HttpError(404, '找不到這位用戶');
  return t;
}

// ---------- 封鎖與靜音 ----------
social.post('/users/:handle/:kind{block|mute}', async (c) => {
  const u = requireUser(c);
  const kind = c.req.param('kind');
  const t = await findUser(c.env.DB, c.req.param('handle'));
  if (t.id === u.id) throw new HttpError(400, '不能對自己這樣做');
  await c.env.DB.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, kind, created_at) VALUES (?, ?, ?, ?)').bind(u.id, t.id, kind, now()).run();
  if (kind === 'block') {
    await c.env.DB.prepare('DELETE FROM follows WHERE (follower_id = ? AND followee_id = ?) OR (follower_id = ? AND followee_id = ?)').bind(u.id, t.id, t.id, u.id).run();
  }
  return c.json({ ok: true });
});

social.delete('/users/:handle/:kind{block|mute}', async (c) => {
  const u = requireUser(c);
  const t = await findUser(c.env.DB, c.req.param('handle'));
  await c.env.DB.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ? AND kind = ?').bind(u.id, t.id, c.req.param('kind')).run();
  return c.json({ ok: true });
});

social.get('/me/blocks', async (c) => {
  const u = requireUser(c);
  const r = await c.env.DB.prepare('SELECT b.kind, x.id, x.name, x.handle, x.avatar_key, x.is_content FROM blocks b JOIN users x ON x.id = b.blocked_id WHERE b.blocker_id = ? ORDER BY b.created_at DESC').bind(u.id).all();
  return c.json({ items: r.results.map((x: any) => ({ kind: x.kind, user: pubUser(x) })) });
});

// ---------- 私訊 ----------
const pair = (a: string, b: string) => (a < b ? [a, b] : [b, a]);

social.get('/messages', async (c) => {
  const u = requireUser(c);
  const r = await c.env.DB.prepare(
    `SELECT cv.id, cv.user_a, cv.user_b, cv.last_message_at, cv.a_read_at, cv.b_read_at,
       o.id AS oid, o.name, o.handle, o.avatar_key, o.is_content,
       (SELECT text FROM messages m WHERE m.conversation_id = cv.id ORDER BY m.created_at DESC LIMIT 1) AS last_text
     FROM conversations cv JOIN users o ON o.id = CASE WHEN cv.user_a = ? THEN cv.user_b ELSE cv.user_a END
     WHERE (cv.user_a = ? OR cv.user_b = ?) AND o.status != 'banned' ORDER BY cv.last_message_at DESC LIMIT 50`
  ).bind(u.id, u.id, u.id).all();
  return c.json({
    conversations: r.results.map((x: any) => ({
      id: x.id,
      user: pubUser({ id: x.oid, name: x.name, handle: x.handle, avatar_key: x.avatar_key, is_content: x.is_content }),
      last_text: x.last_text,
      last_message_at: x.last_message_at,
      unread: x.last_message_at > (x.user_a === u.id ? x.a_read_at : x.b_read_at),
    })),
  });
});

social.get('/messages/:handle', async (c) => {
  const u = requireUser(c);
  const t = await findUser(c.env.DB, c.req.param('handle'));
  const [a, b] = pair(u.id, t.id);
  const cv = await c.env.DB.prepare('SELECT id FROM conversations WHERE user_a = ? AND user_b = ?').bind(a, b).first<{ id: string }>();
  const blocked = await isBlockedEither(c.env.DB, u.id, t.id);
  let msgs: any[] = [];
  if (cv) {
    const r = await c.env.DB.prepare('SELECT id, sender_id, text, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 100').bind(cv.id).all();
    msgs = r.results.reverse();
    await c.env.DB.prepare(`UPDATE conversations SET ${u.id === a ? 'a_read_at' : 'b_read_at'} = ? WHERE id = ?`).bind(now(), cv.id).run();
  }
  return c.json({ user: pubUser(t), can_send: !blocked && !t.is_content && t.status === 'active', messages: msgs.map((m) => ({ id: m.id, mine: m.sender_id === u.id, text: m.text, created_at: m.created_at })) });
});

social.post('/messages/:handle', async (c) => {
  const u = requireUser(c);
  requireHuman(c, u);
  const t = await findUser(c.env.DB, c.req.param('handle'));
  if (t.id === u.id) throw new HttpError(400, '不能傳私訊給自己');
  if (t.is_content) throw new HttpError(400, '✦ 平台內容帳號不接收私訊');
  if (t.status !== 'active') throw new HttpError(400, '這位用戶目前無法接收私訊');
  if (await isBlockedEither(c.env.DB, u.id, t.id)) throw new HttpError(403, '你無法傳私訊給這位用戶');
  const b = await c.req.json<any>();
  const text = String(b.text || '').trim();
  if (!text) throw new HttpError(400, '訊息不能空白');
  if (text.length > 1000) throw new HttpError(400, '訊息最多 1000 字');
  const recent = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM messages WHERE sender_id = ? AND created_at > ?').bind(u.id, now() - 3600_000).first<{ n: number }>();
  if ((recent?.n ?? 0) >= 100) throw new HttpError(429, '訊息太頻繁，請稍後再試');
  const [a, bb] = pair(u.id, t.id);
  const t0 = now();
  let cv = await c.env.DB.prepare('SELECT id FROM conversations WHERE user_a = ? AND user_b = ?').bind(a, bb).first<{ id: string }>();
  if (!cv) {
    cv = { id: newId() };
    await c.env.DB.prepare('INSERT INTO conversations (id, user_a, user_b, last_message_at) VALUES (?, ?, ?, ?)').bind(cv.id, a, bb, t0).run();
  }
  const mid = newId();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO messages (id, conversation_id, sender_id, text, created_at) VALUES (?, ?, ?, ?, ?)').bind(mid, cv.id, u.id, text, t0),
    c.env.DB.prepare(`UPDATE conversations SET last_message_at = ?, ${u.id === a ? 'a_read_at' : 'b_read_at'} = ? WHERE id = ?`).bind(t0, t0, cv.id),
  ]);
  await notify(c.env, c.executionCtx, t.id, u, 'message', null, text);
  return c.json({ id: mid });
});

// ---------- 新手引導 ----------
export const INTERESTS: Record<string, string[]> = {
  時事: ['新聞'], 科技: ['科技', '3C'], 財經: ['財經'], 運動: ['體育', '運動'], 遊戲: ['遊戲', '電競', '桌遊'],
  美食: ['美食', '咖啡', '料理'], 寵物: ['貓', '毛孩'], 星座: ['星座', '塔羅'], 旅行: ['旅行', '散步'], 追劇: ['追劇', '電影'], 生活: ['生活', '下班', '租屋', '心情'],
};

social.get('/onboarding/suggestions', async (c) => {
  const u = requireUser(c);
  const picked: string[] = JSON.parse(u.interests || '[]');
  const words = picked.flatMap((p) => INTERESTS[p] || []);
  const content = await c.env.DB.prepare("SELECT id, name, handle, avatar_key, is_content, persona FROM users WHERE is_content = 1 AND content_enabled = 1").all();
  const scored = (content.results as any[])
    .map((x) => ({ x, s: words.reduce((n, w) => n + (String(x.persona).includes(w) ? 1 : 0), 0) + Math.random() * 0.5 }))
    .filter((y) => !words.length || y.s >= 1)
    .sort((a, b) => b.s - a.s).slice(0, 8).map((y) => y.x);
  const people = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.handle, u.avatar_key, u.is_content, COUNT(p.id) AS n FROM users u JOIN posts p ON p.user_id = u.id
     WHERE u.is_content = 0 AND u.status = 'active' AND u.id != ? AND p.created_at > ? GROUP BY u.id ORDER BY n DESC LIMIT 6`
  ).bind(u.id, now() - 7 * 86400_000).all();
  return c.json({ interests: Object.keys(INTERESTS), picked, users: [...people.results, ...scored].map(pubUser) });
});

social.post('/onboarding', async (c) => {
  const u = requireUser(c);
  const b = await c.req.json<any>();
  const interests = (Array.isArray(b.interests) ? b.interests : []).filter((x: string) => x in INTERESTS).slice(0, 11);
  const sets = ['interests = ?'];
  const vals: any[] = [JSON.stringify(interests)];
  if (b.done) sets.push('onboarded = 1');
  await c.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, u.id).run();
  if (Array.isArray(b.follow)) {
    for (const h of b.follow.slice(0, 20)) {
      const t = await c.env.DB.prepare("SELECT id FROM users WHERE handle = ? AND status = 'active'").bind(String(h)).first<{ id: string }>();
      if (t && t.id !== u.id) await c.env.DB.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)').bind(u.id, t.id, now()).run();
    }
  }
  return c.json({ ok: true });
});

// ---------- 相簿 ----------
social.get('/users/:handle/albums', async (c) => {
  const t = await findUser(c.env.DB, c.req.param('handle'));
  const me = c.get('user');
  const r = await c.env.DB.prepare(
    `SELECT a.id, a.title, a.description, a.sensitive, a.created_at,
       (SELECT image_key FROM album_photos ph WHERE ph.album_id = a.id ORDER BY ph.created_at LIMIT 1) AS cover,
       (SELECT COUNT(*) FROM album_photos ph WHERE ph.album_id = a.id) AS count
     FROM albums a WHERE a.user_id = ? ${canSeeSensitive(me) || me?.id === t.id ? '' : 'AND a.sensitive = 0'} ORDER BY a.created_at DESC`
  ).bind(t.id).all();
  return c.json({ albums: r.results.map((a: any) => ({ id: a.id, title: a.title, description: a.description, sensitive: !!a.sensitive, created_at: a.created_at, count: a.count, cover_url: imgUrl(a.cover) })) });
});

social.post('/albums', async (c) => {
  const u = requireUser(c);
  requireHuman(c, u);
  const b = await c.req.json<any>();
  const title = String(b.title || '').trim().slice(0, 60);
  if (!title) throw new HttpError(400, '相簿要有名稱');
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM albums WHERE user_id = ?').bind(u.id).first<{ n: number }>();
  if ((n?.n ?? 0) >= 100) throw new HttpError(400, '相簿最多 100 本');
  const id = newId();
  await c.env.DB.prepare('INSERT INTO albums (id, user_id, title, description, sensitive, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, u.id, title, String(b.description || '').slice(0, 300), b.sensitive ? 1 : 0, now()).run();
  return c.json({ id });
});

async function ownAlbum(c: any, id: string) {
  const u = requireUser(c);
  const a = await c.env.DB.prepare('SELECT * FROM albums WHERE id = ?').bind(id).first();
  if (!a) throw new HttpError(404, '找不到這本相簿');
  if (a.user_id !== u.id && u.role !== 'gm') throw new HttpError(403, '沒有權限');
  return { u, a };
}

social.get('/albums/:id', async (c) => {
  const a = await c.env.DB.prepare('SELECT a.*, u.name, u.handle, u.avatar_key, u.is_content, u.status FROM albums a JOIN users u ON u.id = a.user_id WHERE a.id = ?').bind(c.req.param('id')).first<any>();
  if (!a || a.status === 'banned') throw new HttpError(404, '找不到這本相簿');
  const me = c.get('user');
  if (a.sensitive && !canSeeSensitive(me) && me?.id !== a.user_id) throw new HttpError(403, '這本相簿含敏感內容，需要登入、完成年齡驗證並開啟敏感內容');
  if (me && await isBlockedEither(c.env.DB, me.id, a.user_id)) throw new HttpError(403, '你無法查看這本相簿');
  const r = await c.env.DB.prepare('SELECT id, image_key, caption, created_at FROM album_photos WHERE album_id = ? ORDER BY created_at').bind(a.id).all();
  return c.json({
    album: { id: a.id, title: a.title, description: a.description, sensitive: !!a.sensitive, created_at: a.created_at, owner: pubUser({ id: a.user_id, name: a.name, handle: a.handle, avatar_key: a.avatar_key, is_content: a.is_content }) },
    photos: r.results.map((p: any) => ({ id: p.id, url: imgUrl(p.image_key), caption: p.caption, created_at: p.created_at })),
  });
});

social.patch('/albums/:id', async (c) => {
  const { a } = await ownAlbum(c, c.req.param('id'));
  const b = await c.req.json<any>();
  const title = typeof b.title === 'string' && b.title.trim() ? b.title.trim().slice(0, 60) : a.title;
  const desc = typeof b.description === 'string' ? b.description.slice(0, 300) : a.description;
  const sens = typeof b.sensitive === 'boolean' ? (b.sensitive ? 1 : 0) : a.sensitive;
  await c.env.DB.prepare('UPDATE albums SET title = ?, description = ?, sensitive = ? WHERE id = ?').bind(title, desc, sens, a.id).run();
  return c.json({ ok: true });
});

social.delete('/albums/:id', async (c) => {
  const { a } = await ownAlbum(c, c.req.param('id'));
  const photos = await c.env.DB.prepare('SELECT image_key FROM album_photos WHERE album_id = ?').bind(a.id).all<{ image_key: string }>();
  for (const p of photos.results) { await c.env.IMAGES.delete(p.image_key); await c.env.DB.prepare('DELETE FROM uploads WHERE key = ?').bind(p.image_key).run(); }
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM album_photos WHERE album_id = ?').bind(a.id),
    c.env.DB.prepare('DELETE FROM albums WHERE id = ?').bind(a.id),
  ]);
  return c.json({ ok: true });
});

social.post('/albums/:id/photos', async (c) => {
  const { u, a } = await ownAlbum(c, c.req.param('id'));
  const b = await c.req.json<any>();
  const own = await c.env.DB.prepare('SELECT 1 FROM uploads WHERE key = ? AND user_id = ?').bind(String(b.image_key || ''), u.id).first();
  if (!own) throw new HttpError(400, '圖片不存在');
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM album_photos WHERE album_id = ?').bind(a.id).first<{ n: number }>();
  if ((n?.n ?? 0) >= 300) throw new HttpError(400, '一本相簿最多 300 張');
  const id = newId();
  await c.env.DB.prepare('INSERT INTO album_photos (id, album_id, image_key, caption, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, a.id, b.image_key, String(b.caption || '').slice(0, 200), now()).run();
  return c.json({ id });
});

social.delete('/albums/:id/photos/:pid', async (c) => {
  const { a } = await ownAlbum(c, c.req.param('id'));
  const p = await c.env.DB.prepare('SELECT image_key FROM album_photos WHERE id = ? AND album_id = ?').bind(c.req.param('pid'), a.id).first<{ image_key: string }>();
  if (p) {
    await c.env.IMAGES.delete(p.image_key);
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM album_photos WHERE id = ?').bind(c.req.param('pid')),
      c.env.DB.prepare('DELETE FROM uploads WHERE key = ?').bind(p.image_key),
    ]);
  }
  return c.json({ ok: true });
});

// ---------- 訪客計數 ----------
async function sha(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d).slice(0, 12), (x) => x.toString(16).padStart(2, '0')).join('');
}
social.post('/users/:handle/visit', async (c) => {
  const t = await findUser(c.env.DB, c.req.param('handle'));
  const me = c.get('user');
  if (me?.id === t.id) return c.json({ ok: true });
  const day = twDay();
  const key = me ? 'u:' + me.id : 'a:' + (await sha(`${c.req.header('cf-connecting-ip') || ''}|${c.req.header('user-agent') || ''}|${day}`));
  const r = await c.env.DB.prepare('INSERT OR IGNORE INTO profile_visits (user_id, visitor_key, day) VALUES (?, ?, ?)').bind(t.id, key, day).run();
  if (r.meta.changes) {
    await c.env.DB.prepare(
      `INSERT INTO profile_stats (user_id, total, today, today_day) VALUES (?, 1, 1, ?)
       ON CONFLICT(user_id) DO UPDATE SET total = total + 1, today = CASE WHEN today_day = excluded.today_day THEN today + 1 ELSE 1 END, today_day = excluded.today_day`
    ).bind(t.id, day).run();
  }
  return c.json({ ok: true });
});

// ---------- 推播訂閱 ----------
social.post('/push/subscribe', async (c) => {
  const u = requireUser(c);
  const b = await c.req.json<any>();
  const ep = String(b.endpoint || '');
  if (!/^https:\/\//.test(ep) || !b.keys?.p256dh || !b.keys?.auth) throw new HttpError(400, '推播訂閱資料不完整');
  await c.env.DB.prepare('INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth')
    .bind(ep, u.id, String(b.keys.p256dh), String(b.keys.auth), now()).run();
  return c.json({ ok: true });
});
social.post('/push/unsubscribe', async (c) => {
  const u = requireUser(c);
  const b = await c.req.json<any>();
  await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').bind(String(b.endpoint || ''), u.id).run();
  return c.json({ ok: true });
});

// ---------- 個資：匯出與刪除帳號 ----------
social.get('/me/export', async (c) => {
  const u = requireUser(c);
  const db = c.env.DB;
  const [posts, comments, albums, follows, messages] = await Promise.all([
    db.prepare('SELECT id, kind, title, text, image_key, sensitive, created_at FROM posts WHERE user_id = ? ORDER BY created_at').bind(u.id).all(),
    db.prepare('SELECT id, post_id, text, created_at FROM comments WHERE user_id = ? ORDER BY created_at').bind(u.id).all(),
    db.prepare('SELECT a.id, a.title, a.description, (SELECT json_group_array(image_key) FROM album_photos WHERE album_id = a.id) AS photos FROM albums a WHERE a.user_id = ?').bind(u.id).all(),
    db.prepare('SELECT x.handle FROM follows f JOIN users x ON x.id = f.followee_id WHERE f.follower_id = ?').bind(u.id).all(),
    db.prepare('SELECT m.text, m.created_at, m.conversation_id FROM messages m WHERE m.sender_id = ? ORDER BY m.created_at').bind(u.id).all(),
  ]);
  const data = {
    exported_at: new Date().toISOString(),
    profile: { name: u.name, handle: u.handle, email: u.email, bio: u.bio, created_at: new Date(u.created_at).toISOString() },
    posts: posts.results, comments: comments.results, albums: albums.results, following: follows.results.map((x: any) => x.handle), sent_messages: messages.results,
  };
  return new Response(JSON.stringify(data, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="wooo-${u.handle}.json"` },
  });
});

social.delete('/me', async (c) => {
  const u = requireUser(c);
  const b = await c.req.json<any>();
  if (b.confirm !== u.handle) throw new HttpError(400, '請輸入你的帳號名稱確認刪除');
  if (u.role === 'gm') {
    const gms = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'gm'").first<{ n: number }>();
    if ((gms?.n ?? 0) <= 1) throw new HttpError(400, '你是唯一的 GM，請先指定其他 GM 再刪除帳號');
  }
  await deleteUserData(c.env, u.id);
  deleteCookie(c, 'sid', { path: '/' });
  return c.json({ ok: true });
});

/** 刪除一位用戶的所有資料（文章、留言、讚、追蹤、私訊、相簿、圖片…） */
export async function deleteUserData(env: any, uid: string) {
  const db = env.DB;
  // 先記下受影響的文章，刪完再重算讚數與留言數
  const likedPosts = (await db.prepare('SELECT post_id FROM likes WHERE user_id = ?').bind(uid).all()).results.map((x: any) => x.post_id);
  const commentedPosts = (await db.prepare('SELECT DISTINCT post_id FROM comments WHERE user_id = ?').bind(uid).all()).results.map((x: any) => x.post_id);
  const keys = (await db.prepare('SELECT key FROM uploads WHERE user_id = ?').bind(uid).all()).results.map((x: any) => x.key);
  const convs = (await db.prepare('SELECT id FROM conversations WHERE user_a = ? OR user_b = ?').bind(uid, uid).all()).results.map((x: any) => x.id);
  const albums = (await db.prepare('SELECT id FROM albums WHERE user_id = ?').bind(uid).all()).results.map((x: any) => x.id);
  const ownPosts = (await db.prepare('SELECT id FROM posts WHERE user_id = ?').bind(uid).all()).results.map((x: any) => x.id);
  const stmts: any[] = [
    db.prepare('DELETE FROM comments WHERE user_id = ?').bind(uid),
    db.prepare('DELETE FROM likes WHERE user_id = ?').bind(uid),
    db.prepare('DELETE FROM poll_votes WHERE user_id = ?').bind(uid),
    db.prepare('DELETE FROM follows WHERE follower_id = ? OR followee_id = ?').bind(uid, uid),
    db.prepare('DELETE FROM notifications WHERE user_id = ? OR actor_id = ?').bind(uid, uid),
    db.prepare('DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?').bind(uid, uid),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(uid),
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').bind(uid),
    db.prepare('DELETE FROM profile_stats WHERE user_id = ?').bind(uid),
    db.prepare('DELETE FROM profile_visits WHERE user_id = ?').bind(uid),
    db.prepare('DELETE FROM uploads WHERE user_id = ?').bind(uid),
    db.prepare('DELETE FROM daily_active WHERE user_id = ?').bind(uid),
  ];
  for (const id of ownPosts) {
    stmts.push(db.prepare('DELETE FROM comments WHERE post_id = ?').bind(id), db.prepare('DELETE FROM likes WHERE post_id = ?').bind(id), db.prepare('DELETE FROM notifications WHERE post_id = ?').bind(id));
  }
  stmts.push(db.prepare('DELETE FROM posts WHERE user_id = ?').bind(uid));
  for (const id of convs) stmts.push(db.prepare('DELETE FROM messages WHERE conversation_id = ?').bind(id), db.prepare('DELETE FROM conversations WHERE id = ?').bind(id));
  for (const id of albums) stmts.push(db.prepare('DELETE FROM album_photos WHERE album_id = ?').bind(id));
  stmts.push(db.prepare('DELETE FROM albums WHERE user_id = ?').bind(uid));
  stmts.push(db.prepare('DELETE FROM users WHERE id = ?').bind(uid));
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  const affected = [...new Set([...likedPosts, ...commentedPosts])];
  for (const pid of affected) {
    await db.prepare(
      `UPDATE posts SET like_count = (SELECT COUNT(*) FROM likes WHERE post_id = ?),
         real_like_count = (SELECT COUNT(*) FROM likes l JOIN users x ON x.id = l.user_id WHERE l.post_id = ? AND x.is_content = 0),
         comment_count = (SELECT COUNT(*) FROM comments WHERE post_id = ?) WHERE id = ?`
    ).bind(pid, pid, pid, pid).run();
  }
  for (let i = 0; i < keys.length; i += 100) await env.IMAGES.delete(keys.slice(i, i + 100));
}
