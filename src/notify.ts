import type { Env } from './env';
import { newId, now } from './env';
import { pushToUser } from './push';

const TEXT: Record<string, string> = {
  like: '按讚了你的文章',
  comment: '留言了你的文章',
  reply: '回覆了你的留言',
  mention: '在文章中提到你',
  follow: '開始追蹤你',
  message: '傳了一則私訊給你',
};

/**
 * 建立通知並推播。不會通知自己、不會通知 ✦ 內容帳號、被對方封鎖時也不通知。
 * 私訊（message）不寫進通知列表，只推播。
 */
export async function notify(env: Env, ctx: { waitUntil(p: Promise<unknown>): void } | undefined, userId: string, actor: { id: string; name: string }, type: string, postId: string | null, preview = '') {
  if (userId === actor.id) return;
  const t = await env.DB.prepare('SELECT is_content FROM users WHERE id = ?').bind(userId).first<{ is_content: number }>();
  if (!t || t.is_content) return;
  const blocked = await env.DB.prepare("SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ? LIMIT 1").bind(userId, actor.id).first();
  if (blocked) return;
  if (type !== 'message') {
    await env.DB.prepare('INSERT INTO notifications (id, user_id, actor_id, type, post_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(newId(), userId, actor.id, type, postId, now()).run();
  }
  const url = type === 'message' ? '/messages' : postId ? `/p/${postId}` : '/notifications';
  const p = pushToUser(env, userId, { title: `${actor.name} ${TEXT[type] || ''}`, body: preview.slice(0, 80), url });
  if (ctx) ctx.waitUntil(p); else await p;
}
