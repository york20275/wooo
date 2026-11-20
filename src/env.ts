export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  AI: Ai;
  ASSETS: Fetcher;
  SITE_NAME: string;
  SITE_URL: string;
  GM_EMAILS: string;
  AI_MODEL: string;
  DEV_MODE: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  NEWSDATA_API_KEY?: string;
}

export interface User {
  id: string;
  google_sub: string | null;
  email: string | null;
  name: string;
  handle: string;
  avatar_key: string | null;
  bio: string;
  role: string;
  status: string;
  is_content: number;
  content_group: string | null;
  persona: string | null;
  content_enabled: number;
  last_posted_at: number | null;
  age_verified: number;
  show_sensitive: number;
  theme: string;
  created_at: number;
}

export type AppEnv = { Bindings: Env; Variables: { user: User | null } };

export const now = () => Date.now();

export function newId(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 20);
}

export function randomToken(bytes = 32): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export async function getSetting(db: D1Database, key: string, fallback = ''): Promise<string> {
  const r = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return r ? r.value : fallback;
}

export async function getSettings(db: D1Database): Promise<Record<string, string>> {
  const r = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const out: Record<string, string> = {};
  for (const row of r.results) out[row.key] = row.value;
  return out;
}

export async function setSetting(db: D1Database, key: string, value: string) {
  await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run();
}

export async function logContent(db: D1Database, kind: string, accountId: string | null, detail: string) {
  await db.prepare('INSERT INTO content_log (id, kind, account_id, detail, created_at) VALUES (?, ?, ?, ?, ?)').bind(newId(), kind, accountId, detail.slice(0, 500), now()).run();
}

/** 這位觀看者能不能看敏感內容：必須登入、已完成年齡驗證、並自己開啟 */
export function canSeeSensitive(u: User | null): boolean {
  return !!u && u.age_verified === 1 && u.show_sensitive === 1;
}
