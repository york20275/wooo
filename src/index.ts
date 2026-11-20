import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppEnv, Env } from './env';
import { auth, loadUser } from './auth';
import { api, HttpError } from './api';
import { admin } from './admin';
import { handleCron } from './content';

const app = new Hono<AppEnv>();

// 載入登入者
app.use('*', async (c, next) => {
  c.set('user', await loadUser(c.env, getCookie(c, 'sid')));
  await next();
});

// 防 CSRF：會改資料的請求必須來自同一個網站
app.use('/api/*', async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('origin');
    if (origin && new URL(origin).host !== new URL(c.req.url).host) return c.json({ error: '來源不被允許' }, 403);
  }
  await next();
});
app.use('/auth/logout', async (c, next) => {
  const origin = c.req.header('origin');
  if (origin && new URL(origin).host !== new URL(c.req.url).host) return c.json({ error: '來源不被允許' }, 403);
  await next();
});

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as any);
  console.log('Unhandled', err);
  return c.json({ error: '伺服器發生錯誤，請稍後再試' }, 500);
});

app.route('/auth', auth);
app.route('/api/admin', admin);
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

app.all('/api/*', (c) => c.json({ error: '找不到這個 API' }, 404));

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleCron(env, event.cron));
  },
};
