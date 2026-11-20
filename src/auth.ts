import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppEnv, Env, User } from './env';
import { newId, now, randomToken } from './env';

const SESSION_DAYS = 30;

export async function loadUser(env: Env, sid: string | undefined): Promise<User | null> {
  if (!sid) return null;
  const row = await env.DB.prepare(
    'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?'
  ).bind(sid, now()).first<User>();
  if (!row || row.status === 'banned') return null;
  return row;
}

async function makeHandle(db: D1Database, base: string): Promise<string> {
  let h = base.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16) || 'user';
  if (h.length < 3) h = h + 'user';
  for (let i = 0; i < 20; i++) {
    const cand = i === 0 ? h : h + Math.floor(Math.random() * 9000 + 1000);
    const ex = await db.prepare('SELECT 1 FROM users WHERE handle = ?').bind(cand).first();
    if (!ex) return cand;
  }
  return h + newId().slice(0, 6);
}

async function upsertGoogleUser(env: Env, sub: string, email: string, name: string): Promise<User> {
  const gmList = (env.GM_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const isGm = gmList.includes(email.toLowerCase());
  const existing = await env.DB.prepare('SELECT * FROM users WHERE google_sub = ?').bind(sub).first<User>();
  if (existing) {
    if (isGm && existing.role !== 'gm') {
      await env.DB.prepare("UPDATE users SET role = 'gm' WHERE id = ?").bind(existing.id).run();
      existing.role = 'gm';
    }
    return existing;
  }
  const id = newId();
  const handle = await makeHandle(env.DB, email.split('@')[0]);
  await env.DB.prepare(
    'INSERT INTO users (id, google_sub, email, name, handle, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, sub, email, name.slice(0, 40) || handle, handle, isGm ? 'gm' : 'user', now()).run();
  return (await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>())!;
}

async function startSession(c: any, userId: string) {
  const sid = randomToken(32);
  const exp = now() + SESSION_DAYS * 86400_000;
  await c.env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').bind(sid, userId, exp, now()).run();
  const secure = new URL(c.req.url).protocol === 'https:';
  setCookie(c, 'sid', sid, { httpOnly: true, secure, sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86400 });
}

export const auth = new Hono<AppEnv>();

auth.get('/google', (c) => {
  if (!c.env.GOOGLE_CLIENT_ID) return c.text('尚未設定 GOOGLE_CLIENT_ID', 500);
  const state = randomToken(16);
  const secure = new URL(c.req.url).protocol === 'https:';
  setCookie(c, 'oauth_state', state, { httpOnly: true, secure, sameSite: 'Lax', path: '/auth', maxAge: 600 });
  const p = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${c.env.SITE_URL}/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${p}`);
});

auth.get('/google/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const saved = getCookie(c, 'oauth_state');
  deleteCookie(c, 'oauth_state', { path: '/auth' });
  if (!code || !state || state !== saved) return c.text('登入驗證失敗，請重新登入', 400);
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID!,
      client_secret: c.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${c.env.SITE_URL}/auth/google/callback`,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) return c.text('無法向 Google 取得登入資訊', 502);
  const tok = (await tokenRes.json()) as { access_token: string };
  const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${tok.access_token}` },
  });
  if (!infoRes.ok) return c.text('無法讀取 Google 帳號資料', 502);
  const info = (await infoRes.json()) as { sub: string; email: string; email_verified?: boolean; name?: string };
  if (!info.email_verified) return c.text('這個 Google 帳號的 Email 尚未驗證', 403);
  const user = await upsertGoogleUser(c.env, info.sub, info.email, info.name || '');
  if (user.status === 'banned') return c.text('這個帳號已被停權', 403);
  await startSession(c, user.id);
  return c.redirect('/');
});

/** 本機測試登入：只有 DEV_MODE=1 才能用 */
auth.get('/dev', async (c) => {
  if (c.env.DEV_MODE !== '1') return c.notFound();
  const email = c.req.query('email') || 'tester@example.com';
  const name = c.req.query('name') || '測試用戶';
  const user = await upsertGoogleUser(c.env, 'dev:' + email, email, name);
  await startSession(c, user.id);
  return c.redirect('/');
});

auth.post('/logout', async (c) => {
  const sid = getCookie(c, 'sid');
  if (sid) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
  deleteCookie(c, 'sid', { path: '/' });
  return c.json({ ok: true });
});
