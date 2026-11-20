import { Hono } from 'hono';
import type { AppEnv, Env, User } from './env';
import { newId, now } from './env';
import { HttpError } from './api';
import { pushToUser } from './push';

/** 處理原因（跟檢舉原因共用代碼） */
export const MOD_REASONS: Record<string, string> = {
  spam: '垃圾訊息或廣告',
  scam: '詐騙',
  harassment: '騷擾或人身攻擊',
  privacy: '公開他人個資',
  unmarked_sensitive: '敏感內容未標記',
  copyright: '侵權',
  illegal: '違法內容',
  violence: '暴力威脅',
  other: '其他',
};
export const MOD_ACTIONS: Record<string, string> = {
  hide: '隱藏',
  delete: '刪除',
  mark_sensitive: '標記為敏感內容',
  suspended: '暫停帳號',
  banned: '停權帳號',
};
const TARGET: Record<string, string> = { post: '文章', comment: '留言', account: '帳號' };
const APPEAL_DAYS = 30;

export function cleanReason(r: any) {
  return typeof r === 'string' && MOD_REASONS[r] ? r : 'other';
}

/**
 * 記錄一筆管理處理並通知本人（原因、可申訴）。
 * ✦ 內容帳號不通知、不列入透明度報告。
 */
export async function recordAction(env: Env, ctx: { waitUntil(p: Promise<unknown>): void } | undefined, a: {
  userId: string; targetType: 'post' | 'comment' | 'account'; targetId: string; action: string; reason: string;
  detail?: string; snapshot?: string; gmId: string; source?: 'gm' | 'report';
}) {
  const u = await env.DB.prepare('SELECT is_content FROM users WHERE id = ?').bind(a.userId).first<{ is_content: number }>();
  if (!u || u.is_content) return null;
  const id = newId();
  const reason = cleanReason(a.reason);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO moderation_actions (id, user_id, target_type, target_id, action, reason, detail, snapshot, gm_id, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, a.userId, a.targetType, a.targetId, a.action, reason, String(a.detail || '').slice(0, 300), String(a.snapshot || '').slice(0, 200), a.gmId, a.source || 'gm', now()),
    env.DB.prepare('INSERT INTO notifications (id, user_id, actor_id, type, post_id, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(newId(), a.userId, a.gmId, 'moderation', null, id, now()),
  ]);
  const p = pushToUser(env, a.userId, {
    title: `窩Woo！管理團隊：你的${TARGET[a.targetType]}已被${MOD_ACTIONS[a.action] || '處理'}`,
    body: `原因：${MOD_REASONS[reason]}。如果你認為處理有誤，可以申訴。`,
    url: '/moderation',
  });
  if (ctx) ctx.waitUntil(p); else await p;
  return id;
}

const pub = (r: any) => ({
  id: r.id, target_type: r.target_type, target_id: r.target_id, action: r.action, action_label: MOD_ACTIONS[r.action] || r.action,
  reason: r.reason, reason_label: MOD_REASONS[r.reason] || '其他', detail: r.detail || '', snapshot: r.snapshot || '',
  appeal_status: r.appeal_status, appeal_text: r.appeal_text, appeal_reply: r.appeal_reply, reversed: !!r.reversed,
  created_at: r.created_at, can_appeal: r.appeal_status === 'none' && now() - r.created_at < APPEAL_DAYS * 86400_000,
});

export const mod = new Hono<AppEnv>();

/** 我的處理紀錄（被停權的人也看得到，才能申訴） */
mod.get('/me/moderation', async (c) => {
  const u = c.get('user') as User | null;
  if (!u) throw new HttpError(401, '請先登入');
  const r = await c.env.DB.prepare('SELECT * FROM moderation_actions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').bind(u.id).all();
  return c.json({ status: u.status, actions: r.results.map(pub), appeal_days: APPEAL_DAYS });
});

mod.post('/moderation/:id/appeal', async (c) => {
  const u = c.get('user') as User | null;
  if (!u) throw new HttpError(401, '請先登入');
  const text = String((await c.req.json<any>()).text || '').trim();
  if (text.length < 5) throw new HttpError(400, '請說明你認為處理有誤的原因（至少 5 個字）');
  const r = await c.env.DB.prepare('SELECT * FROM moderation_actions WHERE id = ? AND user_id = ?').bind(c.req.param('id'), u.id).first<any>();
  if (!r) throw new HttpError(404, '找不到這筆紀錄');
  if (!pub(r).can_appeal) throw new HttpError(400, r.appeal_status !== 'none' ? '這筆紀錄已經申訴過了' : `只能在處理後 ${APPEAL_DAYS} 天內申訴`);
  await c.env.DB.prepare("UPDATE moderation_actions SET appeal_status = 'pending', appeal_text = ?, appealed_at = ? WHERE id = ?").bind(text.slice(0, 1000), now(), r.id).run();
  return c.json({ ok: true });
});

/** 公開透明度報告：最近 12 個月的處理統計（不含 ✦ 內容帳號） */
mod.get('/transparency', async (c) => {
  const since = now() - 365 * 86400_000;
  const month = "strftime('%Y-%m', created_at / 1000 + 8 * 3600, 'unixepoch')";
  const [byAction, byReason, appeals, reports, totals] = await Promise.all([
    c.env.DB.prepare(`SELECT ${month} AS m, action, COUNT(*) AS n FROM moderation_actions WHERE created_at > ? GROUP BY m, action`).bind(since).all(),
    c.env.DB.prepare(`SELECT ${month} AS m, reason, COUNT(*) AS n FROM moderation_actions WHERE created_at > ? GROUP BY m, reason`).bind(since).all(),
    c.env.DB.prepare(`SELECT ${month} AS m, appeal_status AS s, COUNT(*) AS n FROM moderation_actions WHERE created_at > ? AND appeal_status != 'none' GROUP BY m, s`).bind(since).all(),
    c.env.DB.prepare(`SELECT ${month} AS m, COUNT(*) AS n FROM reports WHERE created_at > ? GROUP BY m`).bind(since).all(),
    c.env.DB.prepare(`SELECT ${month} AS m, COUNT(*) AS n FROM posts WHERE source = 'user' AND created_at > ? GROUP BY m`).bind(since).all(),
  ]);
  const months = new Map<string, any>();
  const get = (m: string) => {
    if (!months.has(m)) months.set(m, { month: m, posts: 0, reports: 0, actions: {}, reasons: {}, appeals: { pending: 0, accepted: 0, rejected: 0 } });
    return months.get(m);
  };
  for (const r of byAction.results as any[]) get(r.m).actions[r.action] = r.n;
  for (const r of byReason.results as any[]) get(r.m).reasons[r.reason] = r.n;
  for (const r of appeals.results as any[]) get(r.m).appeals[r.s] = r.n;
  for (const r of reports.results as any[]) get(r.m).reports = r.n;
  for (const r of totals.results as any[]) get(r.m).posts = r.n;
  return c.json({
    months: [...months.values()].sort((a, b) => b.month.localeCompare(a.month)),
    action_labels: MOD_ACTIONS,
    reason_labels: MOD_REASONS,
  });
});

/** GM：申訴列表與裁決 */
export const modAdmin = new Hono<AppEnv>();

modAdmin.get('/appeals', async (c) => {
  const status = ['pending', 'accepted', 'rejected'].includes(c.req.query('status') || '') ? c.req.query('status') : 'pending';
  const r = await c.env.DB.prepare(
    `SELECT m.*, u.name, u.handle FROM moderation_actions m JOIN users u ON u.id = m.user_id
     WHERE m.appeal_status = ? ORDER BY m.appealed_at DESC LIMIT 100`
  ).bind(status).all();
  return c.json({ appeals: r.results.map((x: any) => ({ ...pub(x), user: { name: x.name, handle: x.handle }, appealed_at: x.appealed_at })) });
});

modAdmin.post('/appeals/:id', async (c) => {
  const me = c.get('user')!;
  const b = await c.req.json<any>();
  if (!['accept', 'reject'].includes(b.decision)) throw new HttpError(400, '請選擇接受或駁回');
  const reply = String(b.reply || '').trim().slice(0, 500);
  const r = await c.env.DB.prepare("SELECT * FROM moderation_actions WHERE id = ? AND appeal_status = 'pending'").bind(c.req.param('id')).first<any>();
  if (!r) throw new HttpError(404, '找不到這筆申訴');
  let reversed = 0;
  if (b.decision === 'accept') {
    // 能復原的就復原；刪除無法復原，但會記錄為誤判
    const db = c.env.DB;
    if (r.action === 'hide' && r.target_type === 'post') { await db.prepare('UPDATE posts SET hidden = 0 WHERE id = ?').bind(r.target_id).run(); reversed = 1; }
    if (r.action === 'hide' && r.target_type === 'comment') { await db.prepare('UPDATE comments SET hidden = 0 WHERE id = ?').bind(r.target_id).run(); reversed = 1; }
    if (r.action === 'mark_sensitive') { await db.prepare('UPDATE posts SET sensitive = 0 WHERE id = ?').bind(r.target_id).run(); reversed = 1; }
    if (r.action === 'suspended' || r.action === 'banned') { await db.prepare("UPDATE users SET status = 'active' WHERE id = ?").bind(r.user_id).run(); reversed = 1; }
  }
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE moderation_actions SET appeal_status = ?, appeal_reply = ?, decided_at = ?, reversed = ? WHERE id = ?')
      .bind(b.decision === 'accept' ? 'accepted' : 'rejected', reply, now(), reversed, r.id),
    c.env.DB.prepare('INSERT INTO notifications (id, user_id, actor_id, type, post_id, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(newId(), r.user_id, me.id, 'appeal', null, r.id, now()),
    c.env.DB.prepare('INSERT INTO audit_log (id, gm_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(newId(), me.id, `appeal_${b.decision}`, r.id, reply, now()),
  ]);
  c.executionCtx.waitUntil(pushToUser(c.env, r.user_id, {
    title: b.decision === 'accept' ? '窩Woo！管理團隊：你的申訴已通過' : '窩Woo！管理團隊：你的申訴結果',
    body: reply || (b.decision === 'accept' ? '處理已撤銷，造成困擾很抱歉。' : '經審查後維持原處理。'),
    url: '/moderation',
  }));
  return c.json({ ok: true, reversed: !!reversed });
});
