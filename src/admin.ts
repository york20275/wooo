import { Hono } from 'hono';
import type { AppEnv, User } from './env';
import { getSettings, logAudit, now, setSetting, twDay } from './env';
import { cleanReason, MOD_REASONS, modAdmin, recordAction } from './moderation';
import { runDailyPoll } from './features';
import { HttpError, deletePost } from './api';
import { deleteUserData } from './social';
import { runPostTick, fetchNews, dailyPosts } from './content';

export const admin = new Hono<AppEnv>();

admin.use('*', async (c, next) => {
  const u = c.get('user') as User | null;
  if (!u || u.role !== 'gm' || u.status !== 'active') throw new HttpError(403, '只有 GM 可以使用後台');
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
  const perDay = dailyPosts(s);
  const latest = await db.prepare(
    "SELECT id, name, handle, avatar_key, created_at FROM users WHERE is_content = 0 ORDER BY created_at DESC LIMIT 6"
  ).all();
  return c.json({
    stats: { newUsers, realPosts, contentPosts, openReports, totalUsers },
    content: { enabled: s.content_enabled === '1', paused_until: Number(s.paused_until || 0), posts_per_day: Math.round(perDay), enabled_accounts: enabledAccounts },
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
  await logAudit(c.env.DB, me.id, `user_status:${b.status}`, c.req.param('id'), b.status === 'active' ? '' : MOD_REASONS[cleanReason(b.reason)]);
  if (b.status !== 'active') {
    await recordAction(c.env, c.executionCtx, { userId: c.req.param('id'), targetType: 'account', targetId: c.req.param('id'), action: b.status, reason: b.reason, detail: b.detail, gmId: me.id });
  }
  return c.json({ ok: true });
});

admin.post('/users/:id/role', async (c) => {
  const b = await c.req.json<any>();
  const me = c.get('user')!;
  if (!['user', 'gm'].includes(b.role)) throw new HttpError(400, '角色不正確');
  if (c.req.param('id') === me.id) throw new HttpError(400, '不能變更自己的角色');
  await c.env.DB.prepare('UPDATE users SET role = ? WHERE id = ? AND is_content = 0').bind(b.role, c.req.param('id')).run();
  await logAudit(c.env.DB, me.id, `user_role:${b.role}`, c.req.param('id'));
  return c.json({ ok: true });
});

/** GM 刪除帳號（例如違法內容），會刪除該用戶所有資料 */
admin.delete('/users/:id', async (c) => {
  const me = c.get('user')!;
  const t = await c.env.DB.prepare('SELECT id, handle, role, is_content FROM users WHERE id = ?').bind(c.req.param('id')).first<any>();
  if (!t || t.is_content) throw new HttpError(404, '找不到這位用戶');
  if (t.id === me.id || t.role === 'gm') throw new HttpError(400, '不能刪除 GM 帳號');
  await deleteUserData(c.env, t.id);
  await logAudit(c.env.DB, me.id, 'user_delete', t.id, `@${t.handle}`);
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
  const me = c.get('user')!;
  await logAudit(c.env.DB, me.id, `post_${b.action}`, id, b.action === 'unhide' ? '' : MOD_REASONS[cleanReason(b.reason)]);
  const target = await c.env.DB.prepare('SELECT user_id, text FROM posts WHERE id = ?').bind(id).first<any>();
  if (target && ['hide', 'delete', 'mark_sensitive'].includes(b.action)) {
    await recordAction(c.env, c.executionCtx, { userId: target.user_id, targetType: 'post', targetId: id, action: b.action, reason: b.reason, detail: b.detail, snapshot: target.text, gmId: me.id });
  }
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
  if (b.action === 'hide' || b.action === 'mark_sensitive') {
    const t = r.post_id
      ? await c.env.DB.prepare('SELECT user_id, text FROM posts WHERE id = ?').bind(r.post_id).first<any>()
      : await c.env.DB.prepare('SELECT user_id, text FROM comments WHERE id = ?').bind(r.comment_id).first<any>();
    const reason = b.reason || ({ harassment: 'harassment', unmarked_sensitive: 'unmarked_sensitive', spam: 'spam', copyright: 'copyright', illegal: 'illegal' } as any)[r.reason] || 'other';
    if (t && !(b.action === 'mark_sensitive' && !r.post_id)) {
      await recordAction(c.env, c.executionCtx, { userId: t.user_id, targetType: r.post_id ? 'post' : 'comment', targetId: r.post_id || r.comment_id, action: b.action, reason, detail: b.detail, snapshot: t.text, gmId: me.id, source: 'report' });
    }
  }
  if (b.action === 'hide' && r.post_id) await c.env.DB.prepare('UPDATE posts SET hidden = 1 WHERE id = ?').bind(r.post_id).run();
  if (b.action === 'hide' && r.comment_id) await c.env.DB.prepare('UPDATE comments SET hidden = 1 WHERE id = ?').bind(r.comment_id).run();
  if (b.action === 'mark_sensitive' && r.post_id) await c.env.DB.prepare('UPDATE posts SET sensitive = 1 WHERE id = ?').bind(r.post_id).run();
  const status = b.action === 'dismiss' ? 'dismissed' : 'resolved';
  await logAudit(c.env.DB, me.id, `report_${b.action}`, r.post_id || r.comment_id, r.reason);
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
  const byGroup = await c.env.DB.prepare('SELECT content_group AS g, COUNT(*) AS n, SUM(content_enabled) AS on_n FROM users WHERE is_content = 1 GROUP BY content_group').all<{ g: string; n: number; on_n: number }>();
  const groups = Object.fromEntries(byGroup.results.map((r) => [r.g, { total: r.n, enabled: r.on_n }]));
  const perDay = dailyPosts(s);
  return c.json({
    accounts: r.results,
    settings: { ...s, newsdata_key: s.newsdata_key ? '已設定' : '', pexels_key: s.pexels_key || c.env.PEXELS_API_KEY ? '已設定' : '' },
    today: Object.fromEntries(today.results.map((x: any) => [x.g, x.n])),
    groups,
    posts_per_day: Math.round(perDay),
    default_model: c.env.AI_MODEL,
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
  await logAudit(c.env.DB, c.get('user')!.id, 'content_account_edit', c.req.param('id'), JSON.stringify(b).slice(0, 200));
  return c.json({ ok: true });
});

const EDITABLE = ['content_enabled', 'daily_posts', 'interact_like', 'interact_comment', 'old_posts_mode',
  'group_news', 'group_game', 'group_mixed', 'group_fun', 'paused_until', 'newsdata_key', 'rss_feeds', 'feed_content_ratio', 'ai_model', 'photo_ratio', 'pexels_key', 'community_ratio', 'daily_poll'];
export const AI_MODELS = ['', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct-fp8-fast', '@cf/meta/llama-4-scout-17b-16e-instruct'];
admin.patch('/settings', async (c) => {
  const b = await c.req.json<Record<string, any>>();
  for (const [k, v] of Object.entries(b)) {
    if (!EDITABLE.includes(k)) continue;
    let val = String(v);
    if (k === 'community_ratio' && !(Number(val) >= 0 && Number(val) <= 100)) continue;
    if (k === 'photo_ratio' && !(Number(val) >= 0 && Number(val) <= 100)) continue;
    if (k === 'daily_posts' && !(Number(val) >= 0 && Number(val) <= 14400)) continue;
    if (k === 'feed_content_ratio' && !(Number(val) >= 0 && Number(val) <= 100)) continue;
    if (k === 'ai_model' && !AI_MODELS.includes(val)) continue;
    if (k === 'old_posts_mode' && !['keep', 'hide'].includes(val)) continue;
    if (k === 'rss_feeds') {
      const list = (Array.isArray(v) ? v : []).map(String).filter((u) => /^https?:\/\//.test(u)).slice(0, 20);
      val = JSON.stringify(list);
    }
    await setSetting(c.env.DB, k, val);
    await logAudit(c.env.DB, c.get('user')!.id, 'setting', k, k === 'newsdata_key' || k === 'pexels_key' ? '（已更新）' : val);
  }
  return c.json({ ok: true });
});

/** 一鍵停用全部：關閉總開關（個別帳號的設定保留，之後打開總開關就恢復） */
admin.post('/content/disable-all', async (c) => {
  await setSetting(c.env.DB, 'content_enabled', '0');
  await logAudit(c.env.DB, c.get('user')!.id, 'content_disable_all', null);
  return c.json({ ok: true });
});

admin.post('/content/group/:g', async (c) => {
  const g = c.req.param('g');
  if (!['news', 'game', 'mixed', 'fun'].includes(g)) throw new HttpError(400, '分組不正確');
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

// ---------- 統計與操作紀錄 ----------
admin.get('/stats', async (c) => {
  const days = Math.min(60, Math.max(7, Number(c.req.query('days') || 14)));
  const out: any[] = [];
  const db = c.env.DB;
  for (let i = days - 1; i >= 0; i--) {
    const day = twDay(Date.now() - i * 86400_000);
    const start = Date.parse(day + 'T00:00:00+08:00');
    const end = start + 86400_000;
    const [nu, rp, cp, au] = await Promise.all([
      db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_content = 0 AND created_at >= ? AND created_at < ?').bind(start, end).first<{ n: number }>(),
      db.prepare("SELECT COUNT(*) AS n FROM posts WHERE source = 'user' AND created_at >= ? AND created_at < ?").bind(start, end).first<{ n: number }>(),
      db.prepare("SELECT COUNT(*) AS n FROM posts WHERE source = 'content' AND created_at >= ? AND created_at < ?").bind(start, end).first<{ n: number }>(),
      db.prepare('SELECT COUNT(*) AS n FROM daily_active WHERE day = ?').bind(day).first<{ n: number }>(),
    ]);
    out.push({ day, new_users: nu?.n ?? 0, real_posts: rp?.n ?? 0, content_posts: cp?.n ?? 0, active_users: au?.n ?? 0 });
  }
  return c.json({ days: out });
});

admin.get('/audit', async (c) => {
  const r = await c.env.DB.prepare(
    'SELECT a.action, a.target, a.detail, a.created_at, u.name AS gm FROM audit_log a LEFT JOIN users u ON u.id = a.gm_id ORDER BY a.created_at DESC LIMIT 200'
  ).all();
  return c.json({ items: r.results });
});
admin.post('/content/daily-poll', async (c) => {
  await logAudit(c.env.DB, c.get('user')!.id, 'daily_poll_now', null);
  return c.json(await runDailyPoll(c.env, true));
});

admin.route('/', modAdmin);
