import type { Env } from './env';
import { getSettings, logContent, newId, now } from './env';
import { BASE_RULES, generate } from './ai';
import { fetchNews as fetchNewsImpl, takeNews, type NewsItem } from './news';
import { addComment, addLike } from './api';

export const fetchNews = fetchNewsImpl;
export const GROUPS = ['news', 'game', 'mixed', 'fun'] as const;
/** 每分鐘最多發幾則（避免超過 Workers 單次執行的限制，也避免瞬間洗版） */
const MAX_POSTS_PER_TICK = 10;

interface Account { id: string; name: string; handle: string; content_group: string; persona: string }

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
function twNow() {
  const d = new Date(Date.now() + 8 * 3600_000);
  const h = d.getUTCHours();
  const period = h < 5 ? '深夜' : h < 11 ? '早上' : h < 14 ? '中午' : h < 18 ? '下午' : h < 22 ? '晚上' : '深夜';
  return `星期${WEEKDAYS[d.getUTCDay()]}${period}`;
}
function siteOf(url: string, fallback: string) {
  if (fallback) return fallback;
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
/** 依機率取整數：rate = 2.3 → 2 或 3（平均 2.3） */
const randRound = (rate: number) => Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);

async function writePost(env: Env, model: string, a: Account, news: NewsItem | null): Promise<string | null> {
  const system = `${BASE_RULES}\n你的帳號名稱是「${a.name}」，主題與個性：${a.persona}。`;
  if (news) {
    const prompt = `請根據下面這則新聞的標題與摘要寫一則重點整理貼文。
開頭固定寫「【新聞重點】」，接著用 2 到 4 句話整理重點，只能使用這裡提供的資訊，不可以加入沒提到的事實。
最後可以用一句話說說一般人可能關心的地方，保持中立，不表達政治立場。全文 80 到 180 字，不要附網址。
新聞標題：${news.title}
新聞摘要：${news.description || '（無摘要，只根據標題整理，不要延伸）'}`;
    const out = await generate(env, system, prompt, 320, model);
    return out ?? `【新聞重點】\n${news.title}${news.description ? '\n' + news.description.slice(0, 120) : ''}`;
  }
  const prompt = a.content_group === 'fun'
    ? `現在是${twNow()}。依照你的主題與說話風格，寫一則好笑的生活趣事貼文。
可以是虛構的日常小故事或觀察，但要像在台灣真的會遇到的情境；不要提到真實的人名、店名或品牌。
2 到 5 句話，50 到 160 字，最後一句要有笑點或反轉，可以加最多一個 #話題標籤。每次換完全不同的情境。`
    : `現在是${twNow()}。依照你的主題與個性，寫一則社群貼文。
2 到 4 句話，60 到 150 字，可以在結尾問大家一個輕鬆的問題，或加上最多一個 #話題標籤。
每次換不同的小話題，不要每篇都一樣。`;
  const out = await generate(env, system, prompt, 320, model);
  if (out) return out;
  if (env.DEV_MODE !== '1') return null; // 正式環境 AI 失敗就不發，避免重複的罐頭文
  return pick([
    `${twNow()}，又是想窩著什麼都不做的時刻。大家現在在做什麼？`,
    `今天的小目標：好好吃一頓飯、早點睡。你今天的小目標是什麼？`,
    `剛剛在路上看到一隻貓坐得比我還端正，我決定今天向牠看齊。`,
  ]);
}

async function postOne(env: Env, model: string, a: Account): Promise<string | null> {
  // 不論成功與否都排到隊伍最後面，下一則換別人（輪流）
  const toBack = env.DB.prepare('UPDATE users SET last_posted_at = ? WHERE id = ?').bind(now(), a.id);
  let news: NewsItem | null = null;
  if (a.content_group === 'news') {
    news = await takeNews(env);
    if (!news) { await toBack.run(); return null; }
  }
  const text = await writePost(env, model, a, news);
  if (!text) {
    await toBack.run();
    await logContent(env.DB, 'error', a.id, `${a.name}：AI 生成失敗，這次跳過`);
    return null;
  }
  const id = newId();
  const t = now();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO posts (id, user_id, text, link_url, link_title, link_site, source, created_at) VALUES (?, ?, ?, ?, ?, ?, 'content', ?)`)
      .bind(id, a.id, text.slice(0, 1000), news?.url ?? null, news?.title ?? null, news ? siteOf(news.url, news.source) : null, t),
    env.DB.prepare('UPDATE users SET last_posted_at = ? WHERE id = ?').bind(t, a.id),
  ]);
  return id;
}

/** 全站每天目標則數（後台可調） */
export const dailyPosts = (s: Record<string, string>) => Math.min(MAX_POSTS_PER_TICK * 1440, Math.max(0, Number(s.daily_posts ?? 200)));

/**
 * 發文排程（每分鐘執行）：全站每天約 N 則，啟用中的內容帳號「輪流」發文——
 * 每次挑最久沒發文的帳號（同樣久的隨機），發完排到最後面。
 * 每分鐘發幾則依機率決定，所以發文時間自然分散、不會整點一起出現。
 */
export async function runPostTick(env: Env, opts: { force?: boolean } = {}) {
  const s = await getSettings(env.DB);
  if (!opts.force) {
    if (s.content_enabled !== '1') return { skipped: '總開關關閉' };
    if (Number(s.paused_until || 0) > now()) return { skipped: '暫停中' };
  }
  const groups = GROUPS.filter((g) => s[`group_${g}`] !== '0');
  if (!groups.length) return { skipped: '所有分組都關閉' };
  const n = opts.force ? 1 : Math.min(MAX_POSTS_PER_TICK, randRound(dailyPosts(s) / 1440));
  if (!n) return { skipped: '這分鐘輪空' };
  const model = s.ai_model || env.AI_MODEL;
  const qs = groups.map(() => '?').join(',');
  const due = await env.DB.prepare(
    `SELECT id, name, handle, content_group, persona FROM users
     WHERE is_content = 1 AND content_enabled = 1 AND content_group IN (${qs})
     ORDER BY COALESCE(last_posted_at, 0) ASC, RANDOM() LIMIT ?`
  ).bind(...groups, n).all<Account>();
  if (!due.results.length) return { skipped: '沒有啟用中的帳號' };
  if (due.results.some((a) => a.content_group === 'news')) {
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM news_cache WHERE used = 0 AND fetched_at > ?').bind(now() - 36 * 3600_000).first<{ n: number }>();
    if (!left?.n) await fetchNewsImpl(env);
  }
  const results = await Promise.all(due.results.map((a) => postOne(env, model, a).catch(() => null)));
  const posted = results.filter(Boolean).length;
  if (posted) await logContent(env.DB, 'post', null, `發文 ${posted} 則（${due.results.filter((_, i) => results[i]).map((a) => a.name).join('、')}）`);
  return posted ? { posted: results.find(Boolean), account: due.results[results.findIndex(Boolean)].name, count: posted } : { skipped: '這次沒有成功發文（可能沒有新聞或 AI 失敗）' };
}

/** 互動排程（每分鐘）：內容帳號之間互相按讚、留言（只對內容帳號的貼文，不碰真人） */
export async function runInteractTick(env: Env) {
  const s = await getSettings(env.DB);
  if (s.content_enabled !== '1' || Number(s.paused_until || 0) > now()) return;
  const recent = await env.DB.prepare(
    "SELECT p.id, p.user_id, p.text FROM posts p WHERE p.source = 'content' AND p.hidden = 0 AND p.created_at > ? ORDER BY RANDOM() LIMIT 8"
  ).bind(now() - 24 * 3600_000).all<{ id: string; user_id: string; text: string }>();
  if (!recent.results.length) return;
  const likers = await env.DB.prepare('SELECT id FROM users WHERE is_content = 1 AND content_enabled = 1 ORDER BY RANDOM() LIMIT 8').all<{ id: string }>();

  // 依每天發文量調整互動量：平均每則文約 5 個讚、每 3 則文約 1 則留言
  const daily = dailyPosts(s);
  const likes = Math.min(6, randRound((daily * 5) / 1440));
  if (s.interact_like === '1' && likes) {
    await Promise.all(recent.results.slice(0, likes).map((p, i) => {
      const liker = likers.results[i];
      return liker && liker.id !== p.user_id ? addLike(env, p.id, { id: liker.id, is_content: 1 }) : null;
    }));
  }
  if (s.interact_comment === '1' && Math.random() < Math.min(1, daily / 3 / 1440)) {
    const p = recent.results[recent.results.length - 1];
    const a = await env.DB.prepare('SELECT id, name, handle, content_group, persona FROM users WHERE is_content = 1 AND content_enabled = 1 AND id != ? ORDER BY RANDOM() LIMIT 1').bind(p.user_id).first<Account>();
    if (!a) return;
    const system = `${BASE_RULES}\n你的帳號名稱是「${a.name}」，主題與個性：${a.persona}。`;
    const reply = await generate(env, system, `你在別人的貼文底下留言。用 1 到 2 句話、30 字以內，自然地回應這篇貼文：\n${p.text.slice(0, 300)}`, 120, s.ai_model || env.AI_MODEL);
    if (!reply && env.DEV_MODE !== '1') return;
    const text = reply ?? pick(['好有共鳴', '這個我懂', '笑死', '先收藏起來']);
    await addComment(env, p.id, a, text.slice(0, 200));
  }
}

/** Cron 進入點（每分鐘） */
export async function handleCron(env: Env, _cron: string) {
  await runPostTick(env).catch((e) => console.log('post tick', String(e)));
  await runInteractTick(env).catch((e) => console.log('interact tick', String(e)));
  const m = new Date().getUTCMinutes();
  if (m === 0 || m === 30) await fetchNewsImpl(env).catch(() => {});
  if (m === 5) {
    // 清理：兩天前的訪客紀錄、過期的登入、90 天前的每日活躍、30 天前的內容紀錄
    const day = (d: number) => new Date(Date.now() - d * 86400_000 + 8 * 3600_000).toISOString().slice(0, 10);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM profile_visits WHERE day < ?').bind(day(2)),
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now()),
      env.DB.prepare('DELETE FROM daily_active WHERE day < ?').bind(day(90)),
      env.DB.prepare('DELETE FROM content_log WHERE created_at < ?').bind(now() - 30 * 86400_000),
    ]);
  }
}
