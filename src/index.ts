import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppEnv, Env } from './env';
import { now, twDay } from './env';
import { auth, loadUser } from './auth';
import { api, HttpError } from './api';
import { social } from './social';
import { admin } from './admin';
import { mod } from './moderation';
import { features } from './features';
import { handleCron } from './content';
import { withOg } from './og';

const app = new Hono<AppEnv>();

// www.wootw.com、xxx.workers.dev 一律轉到正式網址（登入狀態才不會分散在不同網址）
app.use('*', async (c, next) => {
  if (c.env.DEV_MODE !== '1' && c.env.SITE_URL.startsWith('https://')) {
    const url = new URL(c.req.url);
    const site = new URL(c.env.SITE_URL);
    const host = (c.req.header('host') || url.host).toLowerCase();
    if (host !== site.host && (host === `www.${site.host}` || host.endsWith('.workers.dev'))) {
      return c.redirect(site.origin + url.pathname + url.search, 301);
    }
  }
  await next();
});

// 載入登入者，並記錄每日活躍（10 分鐘內只記一次）
app.use('*', async (c, next) => {
  const u = await loadUser(c.env, getCookie(c, 'sid'));
  c.set('user', u);
  if (u && (!u.last_seen_at || now() - u.last_seen_at > 600_000)) {
    c.executionCtx.waitUntil(c.env.DB.batch([
      c.env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(now(), u.id),
      c.env.DB.prepare('INSERT OR IGNORE INTO daily_active (day, user_id) VALUES (?, ?)').bind(twDay(), u.id),
    ]));
  }
  await next();
});

// 防 CSRF：會改資料的請求必須來自同一個網站
const sameOrigin = async (c: any, next: any) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('origin');
    if (origin && new URL(origin).host !== new URL(c.req.url).host) return c.json({ error: '來源不被允許' }, 403);
  }
  await next();
};
app.use('/api/*', sameOrigin);
app.use('/auth/logout', sameOrigin);

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as any);
  console.error('Unhandled', err);
  return c.json({ error: '伺服器發生錯誤，請稍後再試' }, 500);
});

app.route('/auth', auth);
app.route('/api/admin', admin);
app.route('/api', mod);
app.route('/api', features);
app.route('/api', social);
app.route('/api', api);

// 圖片
app.get('/img/*', async (c) => {
  const key = c.req.path.slice('/img/'.length);
  const obj = await c.env.IMAGES.get(key);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
});

// 分享預覽（貼文、個人頁、相簿、標籤頁）
app.get('/p/:id', (c) => withOg(c.env, c.req.raw));
app.get('/u/:handle', (c) => withOg(c.env, c.req.raw));
app.get('/album/:id', (c) => withOg(c.env, c.req.raw));
app.get('/tag/:tag', (c) => withOg(c.env, c.req.raw));

app.all('/api/*', (c) => c.json({ error: '找不到這個 API' }, 404));

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleCron(env, event.cron));
  },
};
