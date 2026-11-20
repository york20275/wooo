import { Hono } from 'hono';
import type { AppEnv, User } from './env';
import { getSettings, newId, now, setSetting } from './env';
import { HttpError, deletePost } from './api';
import { runPostTick, fetchNews } from './content';

export const admin = new Hono<AppEnv>();

admin.use('*', async (c, next) => {
  const u = c.get('user') as User | null;
  if (!u || u.role !== 'gm') throw new HttpError(403, '只有 GM 可以使用後台');
  await next();
});

const dayStart = () => {
  // 台灣時間今天 00:00
  const t = new Date(Date.now() + 8 * 3600_000);
  t.setUTCHours(0, 0, 0, 0);
  return t.getTime() - 8 * 3600_000;
};

admin.get('/dashboard', async (c) => {
  const db = c.env.DB;
  const since = dayStart();
  const q = (sql: string, ...b: any[]) => db.prepare(sql).bind(...b).first<{ n: number }>().then((r) => r?.n ?? 0);
  const [newUsers, realPosts, contentPosts, openReports, totalUsers] = await Promise.all([
    q('SELECT COUNT(*) AS n FROM users WHERE is_content = 0 AND created_at >= ?', since),
    q("SELECT COUNT(*) AS n FROM posts WHERE source = 'user' AND created_at >= ?", since),
    q("SELECT COUNT(*) AS n FROM posts WHERE source = 'content' AND created_at >= ?", since),
    q("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
    q('SELECT COUNT(*) AS n FROM users WHERE is_content = 0'),
  ]);
  const s = await getSettings(db);
  const enabledAccounts = await q('SELECT COUNT(*) AS n FROM users WHERE is_content = 1 AND content_enabled = 1');
  const latest = await db.prepare(
    "SELECT id, name, handle, avatar_key, created_at FROM users WHERE is_content = 0 ORDER BY created_at DESC LIMIT 6"
  ).all();
  return c.json({
    stats: { newUsers, realPosts, contentPosts, openReports, totalUsers },
    content: { enabled: s.content_enabled === '1', paused_until: Number(s.paused_until || 0), interval_min: Number(s.interval_min || 30), enabled_accounts: enabledAccounts },
    latest_users: latest.results,
  });
});

// ---------- 用戶管理 ----------
admin.get('/users', async (c) => {
  const q = String(c.req.query('q') || '').trim();
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const r = await c.env.DB.prepare(
    `SELECT id, name, handle, email, role, status, age_verified, created_at,
       (SELECT COUNT(*) FROM posts WHERE user_id = users.id) AS posts
     FROM users WHERE is_content = 0 ${q ? 'AND (name LIKE ? OR handle LIKE ? OR email LIKE ?)' : ''}
     ORDER BY created_at DESC LIMIT 100`
  ).bind(...(q ? [like, like, like] : [])).all();
  return c.json({ users: r.results });
});

admin.post('/users/:id/status', async (c) => {
  const b = await c.req.json<any>();
  if (!['active', 'suspended', 'banned'].includes(b.status)) throw new HttpError(400, '狀態不正確');
  const me = c.get('user')!;
  if (c.req.param('id') === me.id) throw new HttpError(400, '不能變更自己的狀態');
  await c.env.DB.prepare('UPDATE users SET status = ? WHERE id = ? AND is_content = 0').bind(b.status, c.req.param('id')).run();
  if (b.status === 'banned') await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ---------- 內容管理 ----------
admin.get('/posts', async (c) => {
  const source = c.req.query('source');
  const r = await c.env.DB.prepare(
    `SELECT p.id, p.text, p.sensitive, p.hidden, p.source, p.like_count, p.real_like_count, p.comment_count, p.created_at, p.image_key,
       u.name, u.handle, u.is_content
     FROM posts p JOIN users u ON u.id = p.user_id ${source === 'user' || source === 'content' ? 'WHERE p.source = ?' : ''}
     ORDER BY p.created_at DESC LIMIT 100`
  ).bind(...(source === 'user' || source === 'content' ? [source] : [])).all();
  return c.json({ posts: r.results });
});

admin.post('/posts/:id', async (c) => {
  const b = await c.req.json<any>();
  const id = c.req.param('id');
  if (b.action === 'hide') await c.env.DB.prepare('UPDATE posts SET hidden = 1 WHERE id = ?').bind(id).run();
  else if (b.action === 'unhide') await c.env.DB.prepare('UPDATE posts SET hidden = 0 WHERE id = ?').bind(id).run();
  else if (b.action === 'mark_sensitive') await c.env.DB.prepare('UPDATE posts SET sensitive = 1 WHERE id = ?').bind(id).run();
  else if (b.action === 'delete') {
    const p = await c.env.DB.prepare('SELECT image_key FROM posts WHERE id = ?').bind(id).first<any>();
    if (p) await deletePost(c.env, id, p.image_key);
  } else throw new HttpError(400, '未知的動作');
  return c.json({ ok: true });
});

// ---------- 檢舉 ----------
admin.get('/reports', async (c) => {
  const status = c.req.query('status') || 'open';
  const r = await c.env.DB.prepare(
    `SELECT r.id, r.post_id, r.comment_id, r.reason, r.detail, r.status, r.created_at,
       COALESCE(p.text, cm.text) AS content, p.sensitive, p.hidden,
       (SELECT COUNT(*) FROM reports r2 WHERE IFNULL(r2.post_id,'') = IFNULL(r.post_id,'') AND IFNULL(r2.comment_id,'') = IFNULL(r.comment_id,'') AND r2.status = 'open') AS count
     FROM reports r LEFT JOIN posts p ON p.id = r.post_id LEFT JOIN comments cm ON cm.id = r.comment_id
     WHERE r.status = ? ORDER BY r.created_at DESC LIMIT 100`
  ).bind(status).all();
  return c.json({ reports: r.results });
});

admin.post('/reports/:id', async (c) => {
  const b = await c.req.json<any>();
  const me = c.get('user')!;
  const r = await c.env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(c.req.param('id')).first<any>();
  if (!r) throw new HttpError(404, '找不到這筆檢舉');
  if (b.action === 'hide' && r.post_id) await c.env.DB.prepare('UPDATE posts SET hidden = 1 WHERE id = ?').bind(r.post_id).run();
  if (b.action === 'hide' && r.comment_id) await c.env.DB.prepare('UPDATE comments SET hidden = 1 WHERE id = ?').bind(r.comment_id).run();
  if (b.action === 'mark_sensitive' && r.post_id) await c.env.DB.prepare('UPDATE posts SET sensitive = 1 WHERE id = ?').bind(r.post_id).run();
  const status = b.action === 'dismiss' ? 'dismissed' : 'resolved';
  // 同一個對象的其他未處理檢舉一起結案
  await c.env.DB.prepare(
    "UPDATE reports SET status = ?, resolved_by = ?, resolved_at = ? WHERE status = 'open' AND IFNULL(post_id,'') = ? AND IFNULL(comment_id,'') = ?"
  ).bind(status, me.id, now(), r.post_id || '', r.comment_id || '').run();
  return c.json({ ok: true });
});

// ---------- ✦ 內容帳號 ----------
admin.get('/content', async (c) => {
  const group = c.req.query('group');
  const r = await c.env.DB.prepare(
    `SELECT id, name, handle, content_group, persona, content_enabled, last_posted_at,
       (SELECT COUNT(*) FROM posts WHERE user_id = users.id) AS posts
     FROM users WHERE is_content = 1 ${group ? 'AND content_group = ?' : ''} ORDER BY content_group, handle`
  ).bind(...(group ? [group] : [])).all();
  const s = await getSettings(c.env.DB);
  const since = dayStart();
  const today = await c.env.DB.prepare(
    "SELECT u.content_group AS g, COUNT(*) AS n FROM posts p JOIN users u ON u.id = p.user_id WHERE p.source = 'content' AND p.created_at >= ? GROUP BY u.content_group"
  ).bind(since).all();
  const log = await c.env.DB.prepare('SELECT kind, detail, created_at FROM content_log ORDER BY created_at DESC LIMIT 30').all();
  return c.json({
    accounts: r.results,
    settings: { ...s, newsdata_key: s.newsdata_key ? '已設定' : '' },
    today: Object.fromEntries(today.results.map((x: any) => [x.g, x.n])),
    log: log.results,
  });
});

admin.patch('/content/:id', async (c) => {
  const b = await c.req.json<any>();
  const sets: string[] = [];
  const vals: any[] = [];
  if (typeof b.enabled === 'boolean') { sets.push('content_enabled = ?'); vals.push(b.enabled ? 1 : 0); }
  if (typeof b.persona === 'string') { sets.push('persona = ?'); vals.push(b.persona.slice(0, 300)); }
  if (typeof b.name === 'string' && b.name.trim()) { sets.push('name = ?'); vals.push(b.name.trim().slice(0, 40)); }
  if (sets.length) await c.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ? AND is_content = 1`).bind(...vals, c.req.param('id')).run();
  return c.json({ ok: true });
});

const EDITABLE = ['content_enabled', 'interval_min', 'interact_like', 'interact_comment', 'old_posts_mode', 'group_news', 'group_game', 'group_mixed', 'paused_until', 'newsdata_key', 'rss_feeds'];
admin.patch('/settings', async (c) => {
  const b = await c.req.json<Record<string, any>>();
  for (const [k, v] of Object.entries(b)) {
    if (!EDITABLE.includes(k)) continue;
    let val = String(v);
    if (k === 'interval_min' && !['30', '60', '120'].includes(val)) continue;
    if (k === 'old_posts_mode' && !['keep', 'hide'].includes(val)) continue;
    if (k === 'rss_feeds') {
      const list = (Array.isArray(v) ? v : []).map(String).filter((u) => /^https?:\/\//.test(u)).slice(0, 20);
      val = JSON.stringify(list);
    }
    await setSetting(c.env.DB, k, val);
  }
  return c.json({ ok: true });
});

/** 一鍵停用全部：關閉總開關（個別帳號的設定保留，之後打開總開關就恢復） */
admin.post('/content/disable-all', async (c) => {
  await setSetting(c.env.DB, 'content_enabled', '0');
  return c.json({ ok: true });
});

admin.post('/content/group/:g', async (c) => {
  const g = c.req.param('g');
  if (!['news', 'game', 'mixed'].includes(g)) throw new HttpError(400, '分組不正確');
  const b = await c.req.json<any>();
  await setSetting(c.env.DB, `group_${g}`, b.enabled ? '1' : '0');
  return c.json({ ok: true });
});

/** 手動觸發：立刻發一則、立刻抓新聞（測試用） */
admin.post('/content/run-now', async (c) => {
  const res = await runPostTick(c.env, { force: true });
  return c.json(res);
});
admin.post('/content/fetch-news', async (c) => {
  const n = await fetchNews(c.env);
  return c.json({ fetched: n });
});

admin.get('/news', async (c) => {
  const r = await c.env.DB.prepare('SELECT url, title, source, used, fetched_at FROM news_cache ORDER BY fetched_at DESC LIMIT 50').all();
  return c.json({ news: r.results });
});
