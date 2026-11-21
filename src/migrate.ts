import type { Env } from './env';
import { getSetting, setSetting } from './env';

/**
 * 正式資料庫的結構更新（照順序執行一次，記錄在 settings.schema_version）。
 * 新增欄位只能往後加，不能改已經上線的步驟。
 */
const STEPS: string[] = [
  'ALTER TABLE posts ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE posts ADD COLUMN link_image TEXT',
  'CREATE TABLE IF NOT EXISTS video_cache (id TEXT PRIMARY KEY, title TEXT NOT NULL, channel TEXT, grp TEXT, published_at INTEGER, fetched_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0)',
];

export async function migrate(env: Env) {
  const v = Number(await getSetting(env.DB, 'schema_version', '0'));
  if (v >= STEPS.length) return 0;
  for (let i = v; i < STEPS.length; i++) {
    try { await env.DB.prepare(STEPS[i]).run(); }
    catch (e) { if (!/duplicate column|already exists/i.test(String(e))) throw e; }
    await setSetting(env.DB, 'schema_version', String(i + 1));
  }
  return STEPS.length - v;
}
