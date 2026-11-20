import type { Env } from './env';
import { getSettings, logContent, newId, now } from './env';
import { BASE_RULES, generate } from './ai';
import { fetchNews as fetchNewsImpl, takeNews, type NewsItem } from './news';
import { addComment, addLike } from './api';

export const fetchNews = fetchNewsImpl;

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

async function writePost(env: Env, a: Account, news: NewsItem | null): Promise<string | null> {
  const system = `${BASE_RULES}\n你的帳號名稱是「${a.name}」，主題與個性：${a.persona}。`;
  if (news) {
    const prompt = `請根據下面這則新聞的標題與摘要寫一則重點整理貼文。
開頭固定寫「【新聞重點】」，接著用 2 到 4 句話整理重點，只能使用這裡提供的資訊，不可以加入沒提到的事實。
最後可以用一句話說說一般人可能關心的地方，保持中立，不表達政治立場。全文 80 到 180 字，不要附網址。
新聞標題：${news.title}
新聞摘要：${news.description || '（無摘要，只根據標題整理，不要延伸）'}`;
    const out = await generate(env, system, prompt);
    return out ?? `【新聞重點】\n${news.title}${news.description ? '\n' + news.description.slice(0, 120) : ''}`;
  }
  const prompt = `現在是${twNow()}。依照你的主題與個性，寫一則社群貼文。
2 到 4 句話，60 到 150 字，可以在結尾問大家一個輕鬆的問題，或加上最多一個 #話題標籤。
每次換不同的小話題，不要每篇都一樣。`;
  const out = await generate(env, system, prompt);
  if (out) return out;
  // 正式環境 AI 失敗就不發（避免重複的罐頭文）；本機開發模式才用備用句子
  if (env.DEV_MODE !== '1') return null;
  const fallback = [
    `${twNow()}，又是想窩著什麼都不做的時刻。大家現在在做什麼？`,
    `今天的小目標：好好吃一頓飯、早點睡。你今天的小目標是什麼？`,
    `最近在想，生活裡最療癒的是哪一刻？我先說：下班回家關上門的那一秒。`,
  ];
  return fallback[Math.floor(Math.random() * fallback.length)];
}

/** 發文排程：依序挑最久沒發文的帳號，發一則 */
export async function runPostTick(env: Env, opts: { force?: boolean } = {}) {
  const s = await getSettings(env.DB);
  if (!opts.force) {
    if (s.content_enabled !== '1') return { skipped: '總開關關閉' };
    if (Number(s.paused_until || 0) > now()) return { skipped: '暫停中' };
    const interval = Number(s.interval_min || 30) * 60_000;
    const last = await env.DB.prepare("SELECT MAX(created_at) AS t FROM posts WHERE source = 'content'").first<{ t: number | null }>();
    if (last?.t && now() - last.t < interval - 120_000) return { skipped: '還沒到發文時間' };
  }
  const groups = ['news', 'game', 'mixed'].filter((g) => s[`group_${g}`] !== '0');
  if (!groups.length) return { skipped: '所有分組都關閉' };
  const qs = groups.map(() => '?').join(',');

  for (let attempt = 0; attempt < 5; attempt++) {
    const a = await env.DB.prepare(
      `SELECT id, name, handle, content_group, persona FROM users
       WHERE is_content = 1 AND content_enabled = 1 AND content_group IN (${qs})
       ORDER BY IFNULL(last_posted_at, 0) ASC, RANDOM() LIMIT 1`
    ).bind(...groups).first<Account>();
    if (!a) return { skipped: '沒有啟用中的內容帳號' };

    let news: NewsItem | null = null;
    if (a.content_group === 'news') {
      news = await takeNews(env);
      if (!news) { await fetchNewsImpl(env); news = await takeNews(env); }
      if (!news) {
        // 沒有新聞可用：這個帳號先跳過，換下一個
        await env.DB.prepare('UPDATE users SET last_posted_at = ? WHERE id = ?').bind(now(), a.id).run();
        await logContent(env.DB, 'error', a.id, `${a.name}：沒有可用的新聞，跳過`);
        continue;
      }
    }
    const text = await writePost(env, a, news);
    if (!text) {
      await logContent(env.DB, 'error', a.id, `${a.name}：AI 生成失敗，這次不發文`);
      return { skipped: 'AI 生成失敗' };
    }
    const id = newId();
    await env.DB.prepare(
      `INSERT INTO posts (id, user_id, text, link_url, link_title, link_site, source, created_at) VALUES (?, ?, ?, ?, ?, ?, 'content', ?)`
    ).bind(id, a.id, text.slice(0, 1000), news?.url ?? null, news?.title ?? null, news ? siteOf(news.url, news.source) : null, now()).run();
    await env.DB.prepare('UPDATE users SET last_posted_at = ? WHERE id = ?').bind(now(), a.id).run();
    await logContent(env.DB, 'post', a.id, `${a.name} 發文：${text.slice(0, 40)}`);
    return { posted: id, account: a.name };
  }
  return { skipped: '找不到可以發文的帳號' };
}

/** 互動排程：內容帳號之間互相按讚、留言（只對內容帳號的貼文，不碰真人） */
export async function runInteractTick(env: Env) {
  const s = await getSettings(env.DB);
  if (s.content_enabled !== '1' || Number(s.paused_until || 0) > now()) return;
  const recent = await env.DB.prepare(
    "SELECT p.id, p.user_id, p.text FROM posts p WHERE p.source = 'content' AND p.hidden = 0 AND p.created_at > ? ORDER BY RANDOM() LIMIT 4"
  ).bind(now() - 48 * 3600_000).all<{ id: string; user_id: string; text: string }>();
  if (!recent.results.length) return;

  if (s.interact_like === '1') {
    for (const p of recent.results.slice(0, 3)) {
      const liker = await env.DB.prepare('SELECT id FROM users WHERE is_content = 1 AND content_enabled = 1 AND id != ? ORDER BY RANDOM() LIMIT 1').bind(p.user_id).first<{ id: string }>();
      if (liker) await addLike(env, p.id, { id: liker.id, is_content: 1 });
    }
  }
  // 留言大約每 30 分鐘一則
  if (s.interact_comment === '1' && Math.random() < 0.34) {
    const p = recent.results[recent.results.length - 1];
    const a = await env.DB.prepare('SELECT id, name, handle, content_group, persona FROM users WHERE is_content = 1 AND content_enabled = 1 AND id != ? ORDER BY RANDOM() LIMIT 1').bind(p.user_id).first<Account>();
    if (!a) return;
    const system = `${BASE_RULES}\n你的帳號名稱是「${a.name}」，主題與個性：${a.persona}。`;
    const reply = await generate(env, system, `你在別人的貼文底下留言。用 1 到 2 句話、30 字以內，自然地回應這篇貼文：\n${p.text.slice(0, 300)}`, 120);
    if (!reply && env.DEV_MODE !== '1') return;
    const text = reply ?? ['好有共鳴', '這個我懂', '說得太對了', '先收藏起來'][Math.floor(Math.random() * 4)];
    await addComment(env, p.id, a, text.slice(0, 200));
    await logContent(env.DB, 'comment', a.id, `${a.name} 留言：${text.slice(0, 30)}`);
  }
}

/** Cron 進入點 */
export async function handleCron(env: Env, cron: string) {
  if (cron === '*/30 * * * *') {
    await runPostTick(env);
  } else {
    await runInteractTick(env);
    // 每小時抓一次新聞（整點後第一個 10 分鐘）
    const m = new Date().getUTCMinutes();
    if (m < 10) await fetchNewsImpl(env);
  }
}
