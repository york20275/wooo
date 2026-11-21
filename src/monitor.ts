import type { Env } from './env';
import { getSettings, now, twDay } from './env';

/** Cloudflare 各方案的每日／總量上限（用來顯示用量百分比） */
export const LIMITS = {
  free: { requests: 100_000, cpuMs: 10, d1Reads: 5_000_000, d1Writes: 100_000, d1StorageMB: 5_000, r2StorageGB: 10, neurons: 10_000 },
  paid: { requests: 10_000_000 / 30, cpuMs: 30_000, d1Reads: 25_000_000_000 / 30, d1Writes: 50_000_000 / 30, d1StorageMB: 10_000, r2StorageGB: 10, neurons: 10_000 },
};

async function gql(env: Env, query: string, variables: Record<string, unknown>) {
  const r = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.CF_API_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const j = (await r.json()) as any;
  if (j.errors?.length) throw new Error(j.errors[0].message);
  return j.data?.viewer?.accounts?.[0] ?? {};
}

/** 用 Cloudflare 分析 API 抓最近 24 小時的真實用量（需要 CF_API_TOKEN） */
async function cloudflareUsage(env: Env) {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) return { enabled: false };
  const end = new Date();
  const start = new Date(end.getTime() - 24 * 3600_000);
  const vars = { acc: env.CF_ACCOUNT_ID, start: start.toISOString(), end: end.toISOString(), startDate: start.toISOString().slice(0, 10) };
  const out: any = { enabled: true, errors: [] as string[] };
  await Promise.all([
    gql(env, `query($acc:String!,$start:Time!,$end:Time!){viewer{accounts(filter:{accountTag:$acc}){
      workersInvocationsAdaptive(limit:48, filter:{scriptName:"wooo", datetime_geq:$start, datetime_leq:$end}, orderBy:[datetimeHour_ASC]){
        sum{requests errors subrequests} quantiles{cpuTimeP50 cpuTimeP99} dimensions{datetimeHour}}}}}`, vars)
      .then((d) => { out.workers = d.workersInvocationsAdaptive || []; }).catch((e) => out.errors.push(`Workers：${e.message}`)),
    gql(env, `query($acc:String!,$startDate:Date!,$db:String!){viewer{accounts(filter:{accountTag:$acc}){
      d1AnalyticsAdaptiveGroups(limit:10, filter:{date_geq:$startDate, databaseId:$db}){sum{readQueries writeQueries rowsRead rowsWritten} dimensions{date}}}}}`, { ...vars, db: env.D1_DATABASE_ID || '' })
      .then((d) => { out.d1 = d.d1AnalyticsAdaptiveGroups || []; }).catch((e) => out.errors.push(`D1：${e.message}`)),
    gql(env, `query($acc:String!,$start:Time!,$end:Time!){viewer{accounts(filter:{accountTag:$acc}){
      r2StorageAdaptiveGroups(limit:1, filter:{datetime_geq:$start, datetime_leq:$end, bucketName:"wooo-images"}, orderBy:[datetime_DESC]){max{payloadSize objectCount}}}}}`, vars)
      .then((d) => { out.r2 = d.r2StorageAdaptiveGroups?.[0]?.max ?? null; }).catch((e) => out.errors.push(`R2：${e.message}`)),
  ]);
  return out;
}

/** 後台「伺服器」頁：網站自己量得到的數字＋（有設定的話）Cloudflare 真實用量 */
export async function serverStats(env: Env) {
  const t0 = Date.now();
  const ping = await env.DB.prepare('SELECT 1 AS ok').first();
  const dbLatency = Date.now() - t0;
  const n = (sql: string, ...b: unknown[]) => env.DB.prepare(sql).bind(...b).first<{ n: number }>().then((r) => r?.n ?? 0);
  const dayStart = now() - ((Date.now() + 8 * 3600_000) % 86400_000);
  const sizeProbe = await env.DB.prepare('SELECT COUNT(*) AS n FROM settings').run();
  const [online5, online30, activeToday, realUsers, contentUsers, posts, postsToday, comments, commentsToday, aiComments, likes, uploads, lastCron, s] = await Promise.all([
    n('SELECT COUNT(*) AS n FROM users WHERE is_content = 0 AND last_seen_at > ?', now() - 5 * 60_000),
    n('SELECT COUNT(*) AS n FROM users WHERE is_content = 0 AND last_seen_at > ?', now() - 30 * 60_000),
    n('SELECT COUNT(*) AS n FROM daily_active WHERE day = ?', twDay()),
    n('SELECT COUNT(*) AS n FROM users WHERE is_content = 0'),
    n('SELECT COUNT(*) AS n FROM users WHERE is_content = 1'),
    n('SELECT COUNT(*) AS n FROM posts'),
    n('SELECT COUNT(*) AS n FROM posts WHERE created_at >= ?', dayStart),
    n('SELECT COUNT(*) AS n FROM comments'),
    n('SELECT COUNT(*) AS n FROM comments WHERE created_at >= ?', dayStart),
    n("SELECT COUNT(*) AS n FROM comments c JOIN users u ON u.id = c.user_id WHERE u.is_content = 1 AND c.created_at >= ?", dayStart),
    n('SELECT COUNT(*) AS n FROM likes'),
    n('SELECT COUNT(*) AS n FROM uploads'),
    env.DB.prepare('SELECT MAX(created_at) AS t FROM content_log').first<{ t: number }>().then((r) => r?.t ?? 0),
    getSettings(env.DB),
  ]);
  const signups = {
    today: await n("SELECT COUNT(*) AS n FROM users WHERE is_content = 0 AND created_at >= ?", dayStart),
    week: await n("SELECT COUNT(*) AS n FROM users WHERE is_content = 0 AND created_at >= ?", now() - 7 * 86400_000),
    by_ref: (await env.DB.prepare("SELECT COALESCE(ref, '直接進站') AS ref, COUNT(*) AS n FROM users WHERE is_content = 0 GROUP BY 1 ORDER BY 2 DESC LIMIT 15").all<{ ref: string; n: number }>()).results,
    by_day: (await env.DB.prepare("SELECT date((created_at + 28800000) / 1000, 'unixepoch') AS day, COUNT(*) AS n FROM users WHERE is_content = 0 AND created_at >= ? GROUP BY 1 ORDER BY 1").bind(now() - 14 * 86400_000).all<{ day: string; n: number }>()).results,
  };
  const aiPostsToday = await n("SELECT COUNT(*) AS n FROM posts WHERE source = 'content' AND created_at >= ?", dayStart);
  // AI 用量估算：發文約 40 neurons（70B）、留言約一半是罐頭回覆，AI 留言約 3 neurons（8B）
  const neurons = Math.round(aiPostsToday * 40 + aiComments * 0.55 * 3);
  return {
    plan: s.cf_plan === 'paid' ? 'paid' : 'free',
    limits: LIMITS,
    db: { latency_ms: dbLatency, ok: !!ping, size_bytes: (sizeProbe.meta as any)?.size_after ?? null },
    signups,
    users: { online5, online30, active_today: activeToday, real: realUsers, content: contentUsers },
    content: { posts, posts_today: postsToday, comments, comments_today: commentsToday, ai_posts_today: aiPostsToday, ai_comments_today: aiComments, likes, uploads },
    ai: { neurons_today_est: neurons },
    cron: { last_run: lastCron, healthy: now() - lastCron < 15 * 60_000 },
    cloudflare: await cloudflareUsage(env),
    time: now(),
  };
}
