import type { Env } from './env';
import { now } from './env';

/** IndexNow：新文章一發就通知 Bing、Yandex 等搜尋引擎來收錄（公開金鑰，不是機密） */
export const INDEXNOW_KEY = '0f1b43b7ec2175393f52709238180096';

export async function pingIndexNow(env: Env) {
  const origin = env.SITE_URL?.startsWith('https://') ? env.SITE_URL : 'https://wootw.com';
  const rows = (await env.DB.prepare("SELECT p.id FROM posts p JOIN users u ON u.id = p.user_id WHERE p.created_at > ? AND p.hidden = 0 AND p.sensitive = 0 AND p.kind != 'repost' AND u.status = 'active' ORDER BY p.created_at DESC LIMIT 500").bind(now() - 35 * 60_000).all<{ id: string }>()).results;
  const urls = rows.map((r) => `${origin}/p/${r.id}`);
  if (!urls.length) return 0;
  urls.push(`${origin}/`);
  const r = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: new URL(origin).host, key: INDEXNOW_KEY, keyLocation: `${origin}/${INDEXNOW_KEY}.txt`, urlList: urls }),
  });
  return r.status;
}
