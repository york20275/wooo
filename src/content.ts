import type { Env } from './env';
import { getSettings, logContent, newId, now } from './env';
import { BASE_RULES, generate } from './ai';
import { fetchNews as fetchNewsImpl, takeNews, type NewsItem } from './news';
import { addComment, addLike } from './api';
import { aiImage, assignAvatars, splitPhotoLine, topicQuery } from './photos';
import { cleanupStories, runDailyPoll } from './features';
import { migrate } from './migrate';

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

interface Board { id: string; name: string; description: string; content_group: string | null }

/**
 * ✦ 帳號每次發文都挑一個分類版（到處跑，不固定一個版）：
 * 自己這組對應的版機率比較高，時事討論只放新聞摘要為主；新聞摘要大多發在時事討論。
 */
function chooseBoard(boards: Board[], a: Account, isNews: boolean): Board | null {
  if (!boards.length) return null;
  const newsBoard = boards.find((b) => b.content_group === 'news');
  if (isNews) return newsBoard && Math.random() < 0.8 ? newsBoard : boards.find((b) => b.id === 'cm_free') || newsBoard || boards[0];
  const weighted = boards.map((b) => ({ b, w: b.content_group === a.content_group ? 3 : b.content_group === 'news' ? 0.3 : 1 }));
  let r = Math.random() * weighted.reduce((s, x) => s + x.w, 0);
  for (const x of weighted) { r -= x.w; if (r <= 0) return x.b; }
  return weighted[weighted.length - 1].b;
}

type Style = 'banter' | 'joke' | 'adult' | 'normal' | 'topic';
interface HotTopic { name: string; facts: string; ratio: number; groups?: string[] }

export function hotTopics(s: Record<string, string>): HotTopic[] {
  try { const t = JSON.parse(s.hot_topics || '[]'); return Array.isArray(t) ? t.filter((x) => x && x.name) : []; } catch { return []; }
}

/** 每篇文挑一種風格：幹話、笑話、成人梗、一般短文；遊戲相關帳號有機率聊熱門話題 */
function chooseStyle(s: Record<string, string>, a: Account): { style: Style; topic: HotTopic | null } {
  for (const t of hotTopics(s)) {
    const groups = t.groups && t.groups.length ? t.groups : ['game'];
    if (groups.includes(a.content_group) && Math.random() * 100 < Number(t.ratio || 0)) return { style: 'topic', topic: t };
  }
  const adult = Math.max(0, Math.min(40, Number(s.adult_ratio ?? 10)));
  const w: [Style, number][] = a.content_group === 'fun'
    ? [['banter', 30], ['joke', 30], ['adult', adult], ['normal', 30]]
    : [['banter', 35], ['joke', 20], ['adult', adult], ['normal', 35]];
  let r = Math.random() * w.reduce((n, x) => n + x[1], 0);
  for (const [st, n] of w) { r -= n; if (r <= 0) return { style: st, topic: null }; }
  return { style: 'normal', topic: null };
}

const REFUSAL = /抱歉|對不起，我|我無法|我不能|無法提供|不適合提供|作為(一個)?(AI|人工智慧|語言模型)|AI 助理/;

/** 常見錯字（模型偶爾寫出的異體字或形近字） */
const TYPOS: [RegExp, string][] = [[/倒楉|倒霉/g, '倒楣'], [/重來沒/g, '從來沒'], [/在也不/g, '再也不'], [/因該/g, '應該'], [/以經/g, '已經'], [/真的假的阿/g, '真的假的啊']];
function fixTypos(t: string) { return TYPOS.reduce((s, [re, to]) => s.replace(re, to), t); }

/** 發文前再檢查一次：不合常理就不發；合理就只修錯字。短文（幹話）不檢查以節省用量 */
async function reviewPost(env: Env, model: string, text: string): Promise<string | null> {
  if ([...text].length <= 30) return text;
  const out = await generate(env, '你是台灣社群網站的文字編輯，用繁體中文，只輸出結果，不要解釋。', `檢查下面這則貼文：
1. 情節是否合乎常理（例如：吃漢堡本來就用手，不會需要叉子或筷子；不會有像犯罪或被困住的情節；前後不能矛盾）。
2. 有沒有錯字或不自然的用詞。
如果情節不合理，只回覆「NO」。
如果合理，回覆修正錯字後的全文（只修錯字和不通順的地方，不要改內容、不要加字、不要加引號）。

貼文：
${text}`, 260, model);
  if (!out) return text;
  const r = out.trim().replace(/^["「『]|["」』]$/g, '');
  if (/^NO\b|^「?NO」?$|不合理/i.test(r)) return null;
  if ([...r].length < [...text].length * 0.5 || [...r].length > [...text].length * 1.5) return text; // 編輯改太多就用原文
  return fixTypos(r);
}

/** 讀新聞網頁的 og:image（連結預覽縮圖），讀不到就算了 */
async function ogImage(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WooBot/1.0; +https://wootw.com)', accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(6000) });
    if (!r.ok || !(r.headers.get('content-type') || '').includes('html')) return null;
    const html = (await r.text()).slice(0, 300_000);
    const m = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::src)?["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i);
    if (!m) return null;
    const img = new URL(m[1].replace(/&amp;/g, '&'), r.url).toString();
    return /^https:\/\//.test(img) && img.length < 600 ? img : null;
  } catch { return null; }
}

async function writePost(env: Env, model: string, a: Account, news: NewsItem | null, wantPhoto = false, board: Board | null = null, style: Style = 'normal', topic: HotTopic | null = null, headlines: string[] = []): Promise<string | null> {
  const boardLine = board && !news && style !== 'topic' ? `\n這篇發在「${board.name}」分類版（${board.description || board.name}），內容跟這個版有關，但保持你的說話風格。` : '';
  const system = `${BASE_RULES}\n你的帳號名稱是「${a.name}」，主題與個性：${a.persona}。${boardLine}`;
  if (news) {
    const prompt = `請根據下面這則新聞的標題與摘要寫一則重點整理貼文。
開頭固定寫「【新聞重點】」，接著用 1 到 3 句話整理重點，只能使用這裡提供的資訊，不可以加入沒提到的事實，保持中立。全文 50 到 110 字，不要附網址。
新聞標題：${news.title}
新聞摘要：${news.description || '（無摘要，只根據標題整理，不要延伸）'}`;
    const out = await generate(env, system, prompt, 260, model);
    return out ?? `【新聞重點】\n${news.title}`;
  }
  const when = `現在是${twNow()}（只是讓你知道時間，不要在開頭寫星期幾或幾點）。`;
  const prompts: Record<Style, string> = {
    banter: `${when}隨手發一句幹話或廢文，像滑手機時打的碎念：5 到 25 個字，可以很無厘頭、厭世或自嘲，不要 hashtag，不要解釋。`,
    joke: `${when}講一個很短的笑話、冷笑話或諧音梗，20 到 60 個字，最後一句是笑點，不要解釋笑點。`,
    adult: `${when}寫一個成年人看得懂的黃色梗或雙關笑話，靠諧音、雙關或暗示讓人會心一笑，20 到 60 個字。不能有露骨的性描寫，只能涉及成年人，不要解釋。`,
    normal: a.content_group === 'fun'
      ? `${when}寫一則好笑的生活小事，1 到 3 句話、20 到 80 個字。要是真實生活中會發生、大家看了會說「我也是」的事，不要為了反轉硬編不合理的情節。不要提到真實人名、店名或品牌。`
      : `${when}依照你的主題與個性，寫一則簡短的社群貼文，1 到 3 句話、20 到 80 個字，可以問大家一個輕鬆的問題。`,
    topic: `${when}最近大家都在聊「${topic?.name}」。用玩家的口吻發一則貼文，可以是心得、吐槽、期待、新手建議或問大家問題，20 到 100 個字，可以加 #${(topic?.name || '').replace(/\s+/g, '')}。
具體資訊只能用下面提供的內容，不要捏造任務名稱、數字、角色、地點或彩蛋；沒提供的細節就講個人感受或一般玩法建議。
已知資訊：${topic?.facts || ''}${headlines.length ? `\n最近新聞標題：\n${headlines.slice(0, 6).join('\n')}` : ''}`,
  };
  const photoAsk = wantPhoto ? '\n這篇會配一張用手機隨手拍的照片：寫完貼文後，另起最後一行寫「PHOTO: 」加上 8 到 20 個英文單字，具體描述照片畫面，要跟貼文內容一致（例如貼文說客廳很亂，就寫 messy living room with clothes and snack bags on the sofa）。不要拍到人臉、不要有文字或品牌。' : '';
  const out = await generate(env, system, prompts[style] + photoAsk, style === 'banter' ? 80 : 220, model);
  if (out && !REFUSAL.test(out)) {
    const lines = out.replace(/^["「『]|["」』]$/g, '').trim().split('\n');
    const photoLine = /^PHOTO\s*[:：]/i.test(lines[lines.length - 1] || '') ? lines.pop()! : '';
    const checked = await reviewPost(env, model, fixTypos(lines.join('\n').trim()));
    if (!checked) return null;
    return photoLine ? `${checked}\n${photoLine}` : checked;
  }
  if (out) return null;
  if (env.DEV_MODE !== '1') return null; // 正式環境 AI 失敗就不發，避免重複的罐頭文
  return pick(style === 'banter' ? ['好想下班', '今天也是廢廢的一天', '肚子餓到可以吃下一頭牛'] : style === 'joke' ? ['為什麼海很鹹？因為魚在裡面流汗。'] : [`${twNow()}，又是想窩著什麼都不做的時刻。大家現在在做什麼？`]);
}

async function postOne(env: Env, model: string, a: Account, photoRatio: number, boards: Board[], s: Record<string, string>): Promise<string | null> {
  // 不論成功與否都排到隊伍最後面，下一則換別人（輪流）
  const toBack = env.DB.prepare('UPDATE users SET last_posted_at = ? WHERE id = ?').bind(now(), a.id);
  let news: NewsItem | null = null;
  if (a.content_group === 'news') {
    news = await takeNews(env);
    if (!news) { await toBack.run(); return null; }
  }
  const { style, topic } = news ? { style: 'normal' as Style, topic: null } : chooseStyle(s, a);
  let board = chooseBoard(boards, a, !!news);
  let headlines: string[] = [];
  if (style === 'topic' && topic) {
    board = boards.find((b) => b.content_group === 'game') || board;
    const kw = topic.name.replace(/\s+/g, '').slice(0, 10);
    const r = await env.DB.prepare("SELECT title FROM news_cache WHERE replace(title, ' ', '') LIKE ? ORDER BY fetched_at DESC LIMIT 6").bind(`%${kw}%`).all<{ title: string }>();
    headlines = r.results.map((x) => x.title);
  }
  if (style === 'adult') board = boards.find((b) => b.id === 'cm_free') || board;
  // 笑話、幹話也配圖（梗圖感的相關照片）；成人梗不配圖
  // 大約 7 成的文附 1～2 張照片（成人梗不配圖，所以其他類型的比例再拉高一點補回來）
  const wantPhoto = style !== 'adult' && Math.random() * 100 < Math.min(100, photoRatio * 1.12);
  const raw = await writePost(env, model, a, news, wantPhoto, board, style, topic, headlines);
  if (!raw) {
    await toBack.run();
    await logContent(env.DB, 'error', a.id, `${a.name}：AI 生成失敗，這次跳過`);
    return null;
  }
  const { text, query } = splitPhotoLine(raw);
  if (!text) { await toBack.run(); return null; }
  // 照片找不到就只發文字，不影響發文
  const photoQuery = query || (news ? topicQuery(`${news.title}${news.description || ''}`) : style === 'topic' ? 'video game controller' : topicQuery(`${board?.name || ''}${board?.description || ''}${a.persona}`));
  // 新聞文：用新聞網站自己提供的縮圖（連結預覽），有縮圖就不另外配照片
  const linkImage = news ? await ogImage(news.url) : null;
  // 圖片一律用 AI 生成，跟貼文內容一致；不使用別人的照片。新聞文用新聞網站的連結縮圖
  // 熱門遊戲話題不能畫出遊戲本身（會畫錯、也不該假冒遊戲畫面），只拍玩家在家玩遊戲的情境
  const imgPrompt = style === 'topic' ? 'cozy living room at night, game controller on the couch, TV screen glowing with colorful light, blurred screen, no recognizable game' : photoQuery;
  const k1 = wantPhoto && !news ? await aiImage(env, imgPrompt) : null;
  const k2 = k1 && Math.random() < 0.3 ? await aiImage(env, `${imgPrompt}, different angle`) : null;
  const photo = k1 ? { key: k1, credit: null as string | null, creditUrl: null as string | null } : null;
  const images = k1 ? JSON.stringify([k1, ...(k2 ? [k2] : [])]) : null;
  const credit: string | null = null;
  const id = newId();
  const t = now();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO posts (id, user_id, text, image_key, images, image_credit, image_credit_url, link_url, link_title, link_site, link_image, community_id, sensitive, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'content', ?)`)
      .bind(id, a.id, text.slice(0, 1000), photo?.key ?? null, images, null, photo?.creditUrl ?? null, news?.url ?? null, news?.title ?? null, news ? siteOf(news.url, news.source) : null, linkImage, board?.id ?? null, style === 'adult' ? 1 : 0, t),
    env.DB.prepare('UPDATE users SET last_posted_at = ? WHERE id = ?').bind(t, a.id),
    ...(board ? [env.DB.prepare('UPDATE communities SET post_count = post_count + 1 WHERE id = ?').bind(board.id)] : []),
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
  const boards = (await env.DB.prepare('SELECT id, name, description, content_group FROM communities').all<Board>()).results;
  const results = await Promise.all(due.results.map((a) => postOne(env, model, a, Number(s.photo_ratio ?? 30), boards, s).catch(() => null)));
  const posted = results.filter(Boolean).length;
  if (posted) await logContent(env.DB, 'post', null, `發文 ${posted} 則（${due.results.filter((_, i) => results[i]).map((a) => a.name).join('、')}）`);
  return posted ? { posted: results.find(Boolean), account: due.results[results.findIndex(Boolean)].name, count: posted } : { skipped: '這次沒有成功發文（可能沒有新聞或 AI 失敗）' };
}

/** 互動排程（每分鐘）：內容帳號之間互相按讚、留言（只對內容帳號的貼文，不碰真人） */
export async function runInteractTick(env: Env) {
  const s = await getSettings(env.DB);
  if (s.content_enabled !== '1' || Number(s.paused_until || 0) > now()) return;
  const recent = await env.DB.prepare(
    "SELECT p.id, p.user_id, p.text, u.content_group AS g FROM posts p JOIN users u ON u.id = p.user_id WHERE p.source = 'content' AND p.hidden = 0 AND p.kind = 'post' AND p.created_at > ? ORDER BY RANDOM() LIMIT 8"
  ).bind(now() - 24 * 3600_000).all<{ id: string; user_id: string; text: string; g: string }>();
  if (!recent.results.length) return;
  const likers = await env.DB.prepare('SELECT id FROM users WHERE is_content = 1 AND content_enabled = 1 ORDER BY RANDOM() LIMIT 8').all<{ id: string }>();
  const daily = dailyPosts(s);
  const likes = Math.min(6, randRound((daily * 8) / 1440));
  if (s.interact_like === '1' && likes) {
    await Promise.all(recent.results.slice(0, likes).map((p, i) => {
      const liker = likers.results[i];
      // 趣事文多半回 😂，其他大多是 ❤️
      const emoji = p.g === 'fun' ? (Math.random() < 0.6 ? '😂' : '❤️') : Math.random() < 0.85 ? '❤️' : pick(['😂', '😮']);
      return liker && liker.id !== p.user_id ? addLike(env, p.id, { id: liker.id, is_content: 1 }, undefined, emoji) : null;
    }));
  }
  if (s.interact_comment === '1') await runCommentTick(env, s);
}

/** 每篇 ✦ 貼文的目標留言數（依文章 id 固定，在 min～max 之間，偏向少數篇特別熱門） */
function commentTarget(id: string, min: number, max: number) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const r = (h % 1000) / 1000;
  return min + Math.floor((max - min) * r * r);
}

const QUICK = ['笑死', '哈哈哈哈哈', 'XD', '+1', '真的', '我也是', '推', '太扯了吧', '同感', '樓上說的對', '好喔', '這我可以', '羨慕', '有料', '笑到不行', '確實', '我就爛', '先推再看', '這個好', '欸真的', '好真實', '不意外', '有笑有推', '這篇讚', '哈哈哈哈好可愛', '哇', '太神了', '我懂', '可以', '沒毛病'];
const QUICK_ADULT = ['老司機開車了', '我好像懂了什麼', '這不是去幼稚園的車', '純潔的我看不懂', '你這樣大家都懂了', '車速有點快', '我什麼都沒看到'];
const QUICK_JOKE = ['好冷', '冷到結冰', '噗', '可以，這很可以', '我笑了我輸了', '這個梗給你一百分', '笑到肚子痛'];

/**
 * 留言排程：只在 ✦ 貼文底下，由「留言」組帳號輪流留言。
 * 每篇目標 5～50 則（後台可調），隨著時間自然累積（大約 12 小時內留完），每分鐘最多 12 則。
 * ✦ 帳號絕不在真人的文章底下留言。
 */
async function runCommentTick(env: Env, s: Record<string, string>) {
  if (s.group_commenter === '0') return;
  const min = Math.max(0, Number(s.comment_min ?? 5));
  const max = Math.max(min, Number(s.comment_max ?? 50));
  if (!max) return;
  const posts = await env.DB.prepare(
    `SELECT p.id, p.text, p.comment_count, p.created_at, p.sensitive, p.user_id FROM posts p JOIN users u ON u.id = p.user_id
     WHERE p.source = 'content' AND u.is_content = 1 AND p.hidden = 0 AND p.kind = 'post' AND p.created_at > ? ORDER BY p.created_at DESC LIMIT 300`
  ).bind(now() - 48 * 3600_000).all<{ id: string; text: string; comment_count: number; created_at: number; sensitive: number; user_id: string }>();
  // 依「還差幾則」排序，差最多的先留（加一點隨機），每分鐘最多 12 則
  const due = posts.results.map((p) => {
    const target = commentTarget(p.id, min, max);
    const age = (now() - p.created_at) / (12 * 3600_000);
    return { p, gap: Math.floor(target * Math.min(1, Math.sqrt(Math.max(0, age)) + 0.05)) - p.comment_count };
  }).filter((x) => x.gap > 0).sort((a, b) => b.gap + Math.random() * 3 - (a.gap + Math.random() * 3)).slice(0, 12).map((x) => x.p);
  const model = s.comment_model || '@cf/meta/llama-3.1-8b-instruct-fp8-fast';
  for (const p of due) {
    const a = await env.DB.prepare(
      `SELECT id, name, handle, content_group, persona FROM users WHERE is_content = 1 AND content_enabled = 1 AND content_group = 'commenter'
       AND id NOT IN (SELECT user_id FROM comments WHERE post_id = ?) ORDER BY COALESCE(last_posted_at, 0) ASC, RANDOM() LIMIT 1`
    ).bind(p.id).first<Account>();
    if (!a) continue;
    await env.DB.prepare('UPDATE users SET last_posted_at = ? WHERE id = ?').bind(now(), a.id).run();
    // 三成機率回覆底下已有的留言
    const parent = Math.random() < 0.3 ? await env.DB.prepare('SELECT id, text FROM comments WHERE post_id = ? AND parent_id IS NULL ORDER BY RANDOM() LIMIT 1').bind(p.id).first<{ id: string; text: string }>() : null;
    let text: string | null = null;
    if (Math.random() < 0.45) {
      text = pick(p.sensitive ? QUICK_ADULT.concat(QUICK) : /笑|梗|為什麼|因為/.test(p.text) ? QUICK_JOKE.concat(QUICK) : QUICK);
    } else {
      const system = `${BASE_RULES}\n你的帳號名稱是「${a.name}」，個性：${a.persona}。`;
      const ask = parent
        ? `貼文：${p.text.slice(0, 200)}\n有人留言：${parent.text.slice(0, 100)}\n請回覆這則留言，像網友一樣，3 到 25 個字，只寫回覆內容。`
        : `在這篇貼文底下留言，像網友一樣自然回應，3 到 25 個字，只寫留言內容：\n${p.text.slice(0, 300)}`;
      const out = await generate(env, system, ask, 60, model);
      if (out && !REFUSAL.test(out)) text = out.replace(/^["「『]|["」』]$/g, '').trim();
    }
    if (!text) continue;
    await addComment(env, p.id, a, text.slice(0, 120), parent?.id ?? null);
    if (Math.random() < 0.5) await addLike(env, p.id, { id: a.id, is_content: 1 }, undefined, p.sensitive || Math.random() < 0.3 ? '😂' : '❤️');
  }
}

/** 一次建立 200 個留言專用帳號（已經有的會略過） */
export async function seedCommenters(env: Env) {
  const { COMMENTERS } = await import('./commenter-seed');
  let added = 0;
  for (let i = 0; i < COMMENTERS.length; i += 20) {
    const chunk = COMMENTERS.slice(i, i + 20);
    const r = await env.DB.prepare(
      `INSERT OR IGNORE INTO users (id, name, handle, is_content, content_group, persona, created_at) VALUES ${chunk.map(() => "(?, ?, ?, 1, 'commenter', ?, ?)").join(', ')}`
    ).bind(...chunk.flat()).run();
    added += r.meta.changes || 0;
  }
  return added;
}

export async function handleCron(env: Env, _cron: string) {
  await migrate(env).catch((e) => console.log('migrate', String(e)));
  await runPostTick(env).catch((e) => console.log('post tick', String(e)));
  await runInteractTick(env).catch((e) => console.log('interact tick', String(e)));
  await assignAvatars(env, 3).catch((e) => console.log('avatars', String(e)));
  const d = new Date();
  const m = d.getUTCMinutes();
  if (m === 0 || m === 30) await fetchNewsImpl(env).catch(() => {});
  // 每日投票：台灣時間 10:00 起每 10 分鐘檢查一次（今天發過就跳過）
  if (d.getUTCHours() >= 2 && d.getUTCHours() < 14 && m % 10 === 0) await runDailyPoll(env).catch((e) => console.log('daily poll', String(e)));
  if (m % 10 === 3) await cleanupStories(env).catch((e) => console.log('stories cleanup', String(e)));
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
