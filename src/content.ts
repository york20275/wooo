import type { Env } from './env';
import { getSettings, logContent, newId, now } from './env';
import { BASE_RULES, generate } from './ai';
import { fetchNews as fetchNewsImpl, takeNews, type NewsItem } from './news';
import { addComment, addLike } from './api';
import { aiImage, assignAvatars, splitPhotoLine, topicQuery } from './photos';
import { cleanupStories, runDailyPoll, runIssuePoll } from './features';
import { migrate } from './migrate';
import { pingIndexNow } from './indexnow';
import { DEFAULT_CHANNELS, fetchVideos, takeVideo, type Video } from './videos';

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

type Style = 'banter' | 'joke' | 'adult' | 'normal' | 'topic' | 'ask' | 'observe';
interface HotTopic { name: string; facts: string; ratio: number; groups?: string[]; board?: 'game' | 'news' | 'ent'; keyword?: string }

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
    ? [['banter', 35], ['joke', 20], ['adult', adult], ['observe', 20], ['ask', 15], ['normal', 10]]
    : [['banter', 35], ['joke', 10], ['adult', adult], ['ask', 20], ['observe', 15], ['normal', 20]];
  let r = Math.random() * w.reduce((n, x) => n + x[1], 0);
  for (const [st, n] of w) { r -= n; if (r <= 0) return { style: st, topic: null }; }
  return { style: 'normal', topic: null };
}

const REFUSAL = /抱歉|對不起，我|我無法|我不能|無法提供|不適合提供|作為(一個)?(AI|人工智慧|語言模型)|AI 助理/;

/** 常見錯字（模型偶爾寫出的異體字或形近字） */
/** 大陸用語換成台灣用語 */
const TW_TERMS: [RegExp, string][] = [[/視頻/g, '影片'], [/質量/g, '品質'], [/信息/g, '訊息'], [/軟件/g, '軟體'], [/硬件/g, '硬體'], [/網絡/g, '網路'], [/屏幕/g, '螢幕'], [/手機殼/g, '手機殼'], [/打印/g, '列印'], [/優化/g, '最佳化'], [/鼠標/g, '滑鼠'], [/出租車/g, '計程車'], [/地鐵/g, '捷運'], [/公交車?/g, '公車'], [/自行車/g, '腳踏車'], [/土豆/g, '馬鈴薯'], [/西紅柿/g, '番茄'], [/早上好/g, '早安'], [/晚上好/g, '晚安'], [/牛逼/g, '超猛'], [/靠譜/g, '可靠'], [/給力/g, '讚'], [/點贊/g, '按讚'], [/博主/g, '版主'], [/網友們/g, '大家'], [/搞定/g, '搞定'], [/小伙伴/g, '朋友'], [/閨蜜/g, '好姊妹'], [/渠道/g, '管道'], [/激活/g, '啟用'], [/默認/g, '預設'], [/數據/g, '資料'], [/程序/g, '程式'], [/攝像頭/g, '鏡頭'], [/服務器/g, '伺服器'], [/U盤/g, '隨身碟'], [/幹嘛呢/g, '在幹嘛'], [/挺好/g, '還不錯'], [/咋/g, '怎麼'], [/冲/g, '衝'], [/想象/g, '想像'], [/幸運色：橙/g, '幸運色：橘'], [/里面/g, '裡面'], [/着/g, '著'], [/于/g, '於']];
/** 出現簡體字就不用（模型偶爾混簡體） */
const SIMPLIFIED = /[这们说还个来对时会过没发问题吗让给经么样开关点头见进现实东车门长书买卖电话语认识应该视频网络软]/;
export function toTaiwan(t: string) { return TW_TERMS.reduce((s, [re, to]) => s.replace(re, to), t); }

const TYPOS: [RegExp, string][] = [[/倒楉|倒霉/g, '倒楣'], [/重來沒/g, '從來沒'], [/在也不/g, '再也不'], [/因該/g, '應該'], [/以經/g, '已經'], [/真的假的阿/g, '真的假的啊']];
function fixTypos(t: string) { return toTaiwan(TYPOS.reduce((s, [re, to]) => s.replace(re, to), t)); }

/** 發文前再檢查一次：不合常理就不發；合理就只修錯字。短文（幹話）不檢查以節省用量 */
async function reviewPost(env: Env, model: string, text: string, facts = ''): Promise<string | null> {
  if ([...text].length <= 6) return text;
  const out = await generate(env, '你是台灣社群網站的文字編輯，用繁體中文，只輸出結果，不要解釋。', `檢查下面這則貼文：
1. 是否符合台灣生活常識（例如捷運上不能吃東西、機車要戴安全帽）與現在的時間（${twNow()}；下午不會說早安）。
2. 是否通順、看得懂、有意思（語無倫次、重複繞口、看不懂在講什麼都算不合格）；情節是否合乎常理（例如：吃漢堡本來就用手，不會需要叉子或筷子；不會有像犯罪或被困住的情節；前後不能矛盾）。
3. 有沒有錯字或不自然的用詞。${facts ? `\n4. 內容不能跟下面的已知事實矛盾，也不能出現已知事實裡沒有的具體名稱、地名、數字（矛盾或捏造就回覆 NO）：\n${facts}` : ''}
如果不合格或情節不合理，只回覆「NO」。
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
    if (/logo|default|placeholder|250_ltn|og_image_default|share\.(png|jpg)$/i.test(img)) return null; // 網站的預設 LOGO 不算縮圖
    return /^https:\/\//.test(img) && img.length < 600 ? img : null;
  } catch { return null; }
}

const TOPIC_ANGLES = ['問大家一個具體的問題', '分享一個小技巧或新手建議', '吐槽一件小事', '跟朋友一起玩的趣事', '對某則新聞標題的看法', '還在猶豫要不要買、問大家意見', '跟前作或其他作品比較的感覺', '一句話的幹話或玩笑', '看到別人討論後的想法', '工作太忙沒時間玩的抱怨'];
async function writePost(env: Env, model: string, a: Account, news: NewsItem | null, wantPhoto = false, board: Board | null = null, style: Style = 'normal', topic: HotTopic | null = null, headlines: string[] = [], recentTopic: string[] = []): Promise<string | null> {
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
    banter: `${when}隨手發一句生活碎念，像滑手機時隨手打的：10 到 35 個字。要符合現在的時間和大家的日常（上班、下班、熬夜、吃飯、天氣、放假、追劇、滑手機），帶一點自嘲或無奈，讓人看了會心一笑、想回「我也是」。例如：「大人都在睡覺，小孩也都睡了，到底誰還醒著在網路上浪費時間啊」「明明說好今天要早睡，結果又滑到一點」「禮拜一的我跟禮拜五的我根本是兩個人」。不要照抄例子，不要 hashtag，不要解釋。`,
    joke: `${when}講一個很短的笑話、冷笑話或諧音梗，20 到 60 個字，最後一句是笑點，不要解釋笑點。`,
    adult: `${when}寫一個成年人看得懂的黃色梗或雙關笑話，靠諧音、雙關或暗示讓人會心一笑，20 到 60 個字。不能有露骨的性描寫，只能涉及成年人，不要解釋。`,
    normal: a.content_group === 'fun'
      ? `${when}寫一則好笑的生活小事，1 到 3 句話、20 到 80 個字。要是真實生活中會發生、大家看了會說「我也是」的事，不要為了反轉硬編不合理的情節。不要提到真實人名、店名或品牌。`
      : `${when}依照你的主題與個性，寫一則簡短的社群貼文，1 到 3 句話、20 到 80 個字，可以問大家一個輕鬆的問題。`,
    // 脆爆紅的手法：「不懂就問」讓大家搶著回答、留言區比本文還熱鬧
    ask: `${when}發一則讓大家忍不住想回答的問句貼文，10 到 50 個字。可以是「不懂就問」、求推薦、二選一、你們都怎麼做、有人跟我一樣嗎。問題要具體、跟你的主題有關、真實生活會遇到，不要附答案。`,
    // 脆爆紅的手法：日常裡的小觀察、溫馨或好笑的瞬間，看了想按讚分享
    observe: `${when}分享一個你在日常生活中觀察到的小瞬間，15 到 60 個字：路上、捷運、超商、公司、家裡看到的有趣、溫馨或讓人會心一笑的事。要像真的看到的，寫得口語、有畫面，不要說教、不要提真實人名或店名。`,
    topic: `${when}最近大家都在聊「${topic?.name}」。發一則貼文，這次的角度是：${pick(TOPIC_ANGLES)}。15 到 80 個字，可以加 #${(topic?.name || '').replace(/\s+/g, '')}。不要用「終於等到」「終於入手」「買了實體版」「買了數位版」「玩了整整」「趁著週末」這類開頭，開頭要跟下面這些最近的貼文都不一樣：\n${recentTopic.slice(0, 8).map((t) => `- ${t.slice(0, 30)}`).join('\n') || '（無）'}
具體資訊只能用下面提供的內容與新聞標題，不要捏造名稱、數字、日期、股價或細節；沒提供的就講個人感受、看法或問大家。如果跟股票投資有關，只能聊看法與心情，不能給買賣建議。
已知資訊：${topic?.facts || ''}${headlines.length ? `\n最近新聞標題：\n${headlines.slice(0, 6).join('\n')}` : ''}`,
  };
  const photoAsk = wantPhoto ? '\n這篇會配一張用手機隨手拍的照片：寫完貼文後，另起最後一行寫「PHOTO: 」加上 8 到 20 個英文單字，具體描述照片畫面，要跟貼文內容一致（例如貼文說客廳很亂，就寫 messy living room with clothes and empty cups on the sofa）。畫面只能有物品、食物、動物、地點或風景，絕對不能有人、人臉、手或身體，也不要有包裝盒、招牌、書本、螢幕這類會有字的東西。' : '';
  const out = await generate(env, system, prompts[style] + photoAsk, style === 'banter' ? 80 : 220, model);
  if (out && SIMPLIFIED.test(out)) return null;
  if (out && !REFUSAL.test(out)) {
    const lines = out.replace(/^["「『]|["」』]$/g, '').trim().split('\n');
    const photoLine = /^PHOTO\s*[:：]/i.test(lines[lines.length - 1] || '') ? lines.pop()! : '';
    const checked = await reviewPost(env, model, fixTypos(lines.join('\n').trim()), style === 'topic' ? topic?.facts || '' : '');
    if (!checked) return null;
    return photoLine ? `${checked}\n${photoLine}` : checked;
  }
  if (out) return null;
  if (env.DEV_MODE !== '1') return null; // 正式環境 AI 失敗就不發，避免重複的罐頭文
  return pick(style === 'banter' ? ['好想下班', '今天也是廢廢的一天', '肚子餓到可以吃下一頭牛'] : style === 'joke' ? ['為什麼海很鹹？因為魚在裡面流汗。'] : [`${twNow()}，又是想窩著什麼都不做的時刻。大家現在在做什麼？`]);
}

const SPORTS = /棒球|籃球|足球|網球|羽球|排球|高爾夫|中職|職棒|MLB|NBA|PLG|TPBL|大谷|世界棒球|經典賽|奧運|亞運|英超|世界盃|球員|球隊|教練|全壘打|比賽|冠軍賽|季後賽|總冠軍|戰績|運動員|馬拉松|F1|賽車/i;
const MONEY = /台股|美股|股市|股價|加權指數|大盤|ETF|台積電|輝達|NVIDIA|那斯達克|道瓊|標普|外資|投信|殖利率|升息|降息|聯準會|Fed|匯率|新台幣|美元|通膨|財報|營收|法說會|除息|漲停|跌停|期貨|比特幣|加密貨幣/i;
const WORLD = /美國|中國|日本|南韓|北韓|俄羅斯|烏克蘭|以色列|伊朗|加薩|歐盟|英國|法國|德國|印度|川普|拜登|普丁|習近平|聯合國|北約|白宮|國際/;
const ENT = /BTS|防彈|BIGBANG|G-DRAGON|GD|BLACKPINK|IVE|aespa|NewJeans|K-?POP|韓團|偶像|演唱會|明星|歌手|藝人|影后|影帝|金曲|金馬|時尚|走秀|粉絲見面會|專輯|MV/i;
const POLITICAL = /選舉|選戰|候選人|參選|市長|縣長|議員|立委|立法院|總統|政見|政黨|國民黨|民進黨|民眾黨|時代力量|藍營|綠營|白營|罷免|公投|投票日|拜票|造勢|辯論會/;

/** 讀網頁的標題、摘要（og:title / og:description） */
export async function pageMeta(url: string): Promise<{ title: string; description: string; site: string } | null> {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WooBot/1.0; +https://wootw.com)', accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const html = (await r.text()).slice(0, 400_000);
    const meta = (k: string) => (html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']*)["']`, 'i')) || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${k}["']`, 'i')))?.[1];
    const dec = (s = '') => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    const title = dec(meta('og:title') || html.match(/<title>([^<]*)<\/title>/i)?.[1] || '');
    if (!title) return null;
    return { title: title.slice(0, 200), description: dec(meta('og:description') || meta('description') || '').slice(0, 500), site: dec(meta('og:site_name') || new URL(r.url).hostname) };
  } catch { return null; }
}

/** GM 指定網址，由一個 ✦ 帳號轉貼（附一兩句看法＋原文連結與縮圖） */
export async function shareUrl(env: Env, url: string) {
  const m = await pageMeta(url);
  if (!m) return { error: '讀不到這個網址的標題，可能需要登入或擋爬蟲' };
  const s = await getSettings(env.DB);
  const a = await env.DB.prepare("SELECT id, name, handle, content_group, persona FROM users WHERE is_content = 1 AND content_enabled = 1 AND content_group IN ('mixed', 'news', 'fun') ORDER BY COALESCE(last_posted_at, 0) ASC LIMIT 1").first<Account>();
  if (!a) return { error: '沒有可用的內容帳號' };
  const boards = (await env.DB.prepare('SELECT id, name, description, content_group FROM communities').all<Board>()).results;
  const toBack = env.DB.prepare('UPDATE users SET last_posted_at = ? WHERE id = ?').bind(now(), a.id);
  const id = await postShare(env, s.ai_model || env.AI_MODEL, a, { url, title: m.title, description: m.description, source: m.site }, boards, toBack);
  return id ? { posted: id, account: a.name, title: m.title } : { error: 'AI 寫的轉貼文沒通過檢查，請再試一次' };
}

async function takePolitical(env: Env): Promise<NewsItem | null> {
  const rows = (await env.DB.prepare('SELECT url, title, source, description FROM news_cache WHERE used = 0 AND fetched_at > ? ORDER BY fetched_at DESC LIMIT 60').bind(now() - 36 * 3600_000).all<NewsItem>()).results;
  const pol = rows.filter((x) => POLITICAL.test(x.title + (x.description || '')));
  if (!pol.length) return null;
  const it = pol[Math.floor(Math.random() * Math.min(pol.length, 10))];
  const r = await env.DB.prepare('UPDATE news_cache SET used = 1 WHERE url = ? AND used = 0').bind(it.url).run();
  return r.meta.changes ? it : null;
}

/** 轉貼文共用格式：第一行是標題（中文），接一兩句看法，最後 2～4 個 #標籤（方便站內外搜尋） */
const SHARE_FORMAT = `只輸出下面三行，不要加其他文字：
標題：（中文標題；原標題是中文就照抄，英文就翻成自然的中文，遊戲、人名等專有名詞可保留英文）
看法：（1 到 2 句、10 到 50 個字，像台灣網友轉貼時隨手打的感想或問大家）
標籤：（2 到 4 個 #標籤，用空格分開，例如 #GTA6 #攻略 或 #BTS #防彈少年團，標籤裡不要有空格）`;
function parseShare(out: string, fallbackTitle: string) {
  const get = (k: string) => (out.match(new RegExp(`${k}[:：]\\s*(.+)`)) || [])[1]?.trim() || '';
  const title = get('標題').replace(/^[「『"]|[」』"]$/g, '') || fallbackTitle;
  const say = get('看法').replace(/^[「『"]|[」』"]$/g, '').replace(/https?:\/\/\S+/g, '');
  const tags = (get('標籤').match(/#[^\s#，,。]{1,20}/g) || []).slice(0, 4);
  return { title: title.slice(0, 120), say, tags };
}

/** 分享一篇網路文章：只根據標題與摘要講一兩句看法，附原文連結（不複製文章內容） */
async function postShare(env: Env, model: string, a: Account, item: NewsItem, boards: Board[], toBack: D1PreparedStatement): Promise<string | null> {
  const political = POLITICAL.test(item.title + (item.description || ''));
  const system = `${BASE_RULES}\n你的帳號名稱是「${a.name}」，主題與個性：${a.persona}。`;
  const rule = political
    ? '這是選舉／政治相關的新聞。保持中立：可以點出新聞重點、問大家怎麼看或關心哪些議題，絕對不能支持或反對任何候選人、政黨，不能叫人投給誰或不要投給誰，也不能嘲諷任何一方。'
    : '可以是感想、吐槽、驚訝或問大家怎麼看。';
  const prompt = `你要在社群轉貼一篇文章，附上一兩句話。文章標題：「${item.title}」\n摘要：${(item.description || '（無）').slice(0, 300)}
看法的部分：${rule}只能根據標題和摘要，不要加入沒提到的事實或數字。
${SHARE_FORMAT}`;
  const out = await generate(env, system, prompt, 200, model);
  if (!out || REFUSAL.test(out) || SIMPLIFIED.test(out)) { await toBack.run(); return null; }
  const ps = parseShare(out, item.title);
  if (!ps.say) { await toBack.run(); return null; }
  const say = await reviewPost(env, model, fixTypos(ps.say), `文章標題：${item.title}\n摘要：${item.description || ''}${political ? '\n（政治新聞：內容必須中立，支持或攻擊任何候選人、政黨就回覆 NO）' : ''}`);
  if (!say) { await toBack.run(); return null; }
  const text = `${fixTypos(ps.title)}\n${say}${ps.tags.length ? `\n${ps.tags.join(' ')}` : ''}`;
  const linkImage = await ogImage(item.url);
  const ent = ENT.test(item.title + (item.description || ''));
  const blob = item.title + (item.description || '');
  const special = political ? '政治議題' : ent ? '追星娛樂' : SPORTS.test(blob) ? '運動體壇' : MONEY.test(blob) ? '股市財經' : WORLD.test(blob) ? '國際新聞' : '';
  const board = (special ? boards.find((b) => b.name === special) : null) || boards.find((b) => b.content_group === (political ? 'news' : a.content_group)) || boards.find((b) => b.content_group === 'news') || null;
  const id = newId();
  const t = now();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO posts (id, user_id, text, link_url, link_title, link_site, link_image, community_id, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'content', ?)`)
      .bind(id, a.id, text.slice(0, 1000), item.url, item.title, siteOf(item.url, item.source), linkImage, board?.id ?? null, t),
    env.DB.prepare('UPDATE users SET last_posted_at = ? WHERE id = ?').bind(t, a.id),
    ...(board ? [env.DB.prepare('UPDATE communities SET post_count = post_count + 1 WHERE id = ?').bind(board.id)] : []),
  ]);
  return id;
}

/** 分享一部 YouTube 影片：只根據標題講一兩句感想，不捏造影片內容 */
async function postVideo(env: Env, model: string, a: Account, v: Video, boards: Board[], toBack: D1PreparedStatement): Promise<string | null> {
  const system = `${BASE_RULES}\n你的帳號名稱是「${a.name}」，主題與個性：${a.persona}。`;
  const english = !/[\u4e00-\u9fff]/.test(v.title);
  const prompt = `你要在社群分享一部 YouTube 影片。影片標題：「${v.title}」（頻道：${v.channel}）。
${english ? '標題是英文，請翻成自然的中文標題（例如「國外大神整理的 GTA6 新手必學技巧」）。' : ''}
${SHARE_FORMAT}
只能根據標題講，不要假裝看過影片細節、不要捏造數字或內容；如果跟股票有關，不要給買賣建議。不要附網址。`;
  const out = await generate(env, system, prompt, 200, model);
  if (!out || REFUSAL.test(out) || SIMPLIFIED.test(out)) { await toBack.run(); return null; }
  const ps = parseShare(out, v.title);
  if (!ps.say) { await toBack.run(); return null; }
  const say = await reviewPost(env, model, fixTypos(ps.say), `影片標題：${v.title}`);
  if (!say) { await toBack.run(); return null; }
  const text = `${fixTypos(ps.title)}\n${say}${ps.tags.length ? `\n${ps.tags.join(' ')}` : ''}`;
  const byGrp: Record<string, string> = { ent: '追星娛樂', sports: '運動體壇', finance: '股市財經', world: '國際新聞' };
  const board = (v.grp === 'game' ? boards.find((b) => b.content_group === 'game') : byGrp[v.grp] ? boards.find((b) => b.name === byGrp[v.grp]) : boards.find((b) => b.content_group === 'news')) || boards.find((b) => b.content_group === 'news') || null;
  const id = newId();
  const t = now();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO posts (id, user_id, text, link_url, link_title, link_site, link_image, community_id, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'content', ?)`)
      .bind(id, a.id, text.slice(0, 1000), `https://www.youtube.com/watch?v=${v.id}`, v.title, `YouTube · ${v.channel}`, `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`, board?.id ?? null, t),
    env.DB.prepare('UPDATE users SET last_posted_at = ? WHERE id = ?').bind(t, a.id),
    ...(board ? [env.DB.prepare('UPDATE communities SET post_count = post_count + 1 WHERE id = ?').bind(board.id)] : []),
  ]);
  return id;
}

async function postOne(env: Env, model: string, a: Account, photoRatio: number, boards: Board[], s: Record<string, string>): Promise<string | null> {
  // 不論成功與否都排到隊伍最後面，下一則換別人（輪流）
  const toBack = env.DB.prepare('UPDATE users SET last_posted_at = ? WHERE id = ?').bind(now(), a.id);
  let news: NewsItem | null = null;
  if (a.content_group === 'news') {
    news = await takeNews(env);
    if (!news) { await toBack.run(); return null; }
  }
  // 分享網路文章：附一兩句自己的看法＋文章連結與縮圖（像大家在脆上轉貼新聞聊時事）
  const shareRatio = Math.max(0, Math.min(80, Number(s.share_ratio ?? 35)));
  if (!news && Math.random() * 100 < shareRatio) {
    // 約三成優先挑選舉／政治新聞（各家新聞都會輪到，內容保持中立），讓政治議題版有話題
    const item = (Math.random() < 0.3 ? await takePolitical(env) : null) || await takeNews(env);
    if (item) return postShare(env, model, a, item, boards, toBack);
  }
  // 分享影片：遊戲帳號分享遊戲影片，時事／綜合帳號分享新聞、科技、財經影片（像脆上大家轉貼影片聊時事）
  const vRatio = Math.max(0, Math.min(60, Number(s.video_ratio ?? 15)));
  if (!news && Math.random() * 100 < vRatio) {
    const groups = a.content_group === 'game' ? ['game'] : a.content_group === 'fun' ? ['ent', 'sports'] : a.content_group === 'mixed' ? ['game', 'tech', 'news', 'finance', 'ent', 'sports', 'world'] : ['news', 'tech', 'finance', 'world', 'sports'];
    const kws = ['GTA', 'Grand Theft Auto', '俠盜', '黃仁勳', 'Jensen', 'NVIDIA', '輝達', '台股', '股市', '台積電', 'BTS', '防彈', 'G-DRAGON', 'GD', 'BIGBANG', 'BLACKPINK', ...hotTopics(s).map((t) => t.name)];
    const v = await takeVideo(env, groups, kws);
    if (v) return postVideo(env, model, a, v, boards, toBack);
  }
  const { style, topic } = news ? { style: 'normal' as Style, topic: null } : chooseStyle(s, a);
  let board = chooseBoard(boards, a, !!news);
  if (news && POLITICAL.test(news.title + (news.description || ''))) board = boards.find((b) => b.name === '政治議題') || board;
  else if (news && ENT.test(news.title + (news.description || ''))) board = boards.find((b) => b.name === '追星娛樂') || board;
  else if (news && SPORTS.test(news.title + (news.description || ''))) board = boards.find((b) => b.name === '運動體壇') || board;
  else if (news && MONEY.test(news.title + (news.description || ''))) board = boards.find((b) => b.name === '股市財經') || board;
  else if (news && WORLD.test(news.title + (news.description || ''))) board = boards.find((b) => b.name === '國際新聞') || board;
  let headlines: string[] = [];
  let recentTopic: string[] = [];
  if (style === 'topic' && topic) {
    board = (topic.board === 'news' ? boards.find((b) => b.content_group === 'news') : topic.board === 'ent' ? boards.find((b) => b.name === '追星娛樂') : boards.find((b) => b.content_group === 'game')) || board;
    const kw = (topic.keyword || topic.name).replace(/\s+/g, '').slice(0, 10);
    const r = await env.DB.prepare("SELECT title FROM news_cache WHERE replace(title, ' ', '') LIKE ? ORDER BY fetched_at DESC LIMIT 6").bind(`%${kw}%`).all<{ title: string }>();
    headlines = r.results.map((x) => x.title);
    recentTopic = (await env.DB.prepare("SELECT text FROM posts WHERE source = 'content' AND text LIKE ? ORDER BY created_at DESC LIMIT 12").bind(`%${kw}%`).all<{ text: string }>()).results.map((x) => x.text);
  }
  if (style === 'adult') board = boards.find((b) => b.id === 'cm_free') || board;
  // 笑話、幹話也配圖（梗圖感的相關照片）；成人梗不配圖
  // 大約 7 成的文附 1～2 張照片（成人梗不配圖，所以其他類型的比例再拉高一點補回來）
  // 熱門話題（GTA6、黃仁勳、台股）不配 AI 圖：畫出來的主機、手把、人物都會跟事實不符
  const wantPhoto = style !== 'adult' && style !== 'topic' && Math.random() * 100 < Math.min(100, photoRatio * 1.25);
  let raw = await writePost(env, model, a, news, wantPhoto, board, style, topic, headlines, recentTopic);
  // 熱門話題文：開頭跟最近的貼文太像就不發
  if (raw && style === 'topic' && (/^(終於|剛買|買了|最近買|最近終於)/.test(raw) || recentTopic.some((t) => t.slice(0, 6) === raw!.slice(0, 6)))) raw = null;
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
  const imgPrompt = style === 'topic' ? 'cozy living room at night, black gamepad on a gray couch, soft colorful glow on the wall, warm lamp' : photoQuery;
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

const QUICK = ['真假', '超好笑', '太狂了吧', '好啦好啦', '我也想要', '可憐哪', '笑爛', '是在哈囉', '好扯', '有夠真實', '這真的', '我直接笑出來', '好喔沒問題', '推推', '這個讚', '我也遇過', '好可愛喔', '羨慕死', '這樣也行', '欸我也是', '好問題', '蛤', '天啊', '超有感', '笑死', '哈哈哈哈哈', 'XD', '+1', '真的', '我也是', '推', '太扯了吧', '同感', '樓上說的對', '好喔', '這我可以', '羨慕', '有料', '笑到不行', '確實', '我就爛', '先推再看', '這個好', '欸真的', '好真實', '不意外', '有笑有推', '這篇讚', '哈哈哈哈好可愛', '哇', '太神了', '我懂', '可以', '沒毛病'];
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
    `SELECT p.id, p.text, p.link_title, p.comment_count, p.created_at, p.sensitive, p.user_id FROM posts p JOIN users u ON u.id = p.user_id
     WHERE p.source = 'content' AND u.is_content = 1 AND p.hidden = 0 AND p.kind = 'post' AND p.created_at > ? ORDER BY p.created_at DESC LIMIT 300`
  ).bind(now() - 48 * 3600_000).all<{ id: string; text: string; comment_count: number; created_at: number; sensitive: number; user_id: string; link_title: string | null }>();
  // 依「還差幾則」排序，差最多的先留（加一點隨機），每分鐘最多 12 則
  const due = posts.results.map((p) => {
    const target = commentTarget(p.id, min, max);
    const age = (now() - p.created_at) / (12 * 3600_000);
    return { p, gap: Math.floor(target * Math.min(1, Math.sqrt(Math.max(0, age)) + 0.05)) - p.comment_count };
  }).filter((x) => x.gap > 0).sort((a, b) => b.gap + Math.random() * 3 - (a.gap + Math.random() * 3)).slice(0, 12).map((x) => x.p);
  const model = s.comment_model || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  for (const p of due) {
    const a = await env.DB.prepare(
      `SELECT id, name, handle, content_group, persona FROM users WHERE is_content = 1 AND content_enabled = 1 AND content_group = 'commenter'
       AND id NOT IN (SELECT user_id FROM comments WHERE post_id = ?) ORDER BY COALESCE(last_posted_at, 0) ASC, RANDOM() LIMIT 1`
    ).bind(p.id).first<Account>();
    if (!a) continue;
    await env.DB.prepare('UPDATE users SET last_posted_at = ? WHERE id = ?').bind(now(), a.id).run();
    // 三成機率回覆底下已有的留言
    // 只回覆有內容的留言（8 個字以上），不在「真的」「天啊」這種短留言底下疊樓
    const parent = Math.random() < 0.25 ? await env.DB.prepare('SELECT id, text FROM comments WHERE post_id = ? AND parent_id IS NULL AND length(text) >= 8 ORDER BY RANDOM() LIMIT 1').bind(p.id).first<{ id: string; text: string }>() : null;
    const recent = (await env.DB.prepare('SELECT text FROM comments WHERE post_id = ? ORDER BY created_at DESC LIMIT 8').bind(p.id).all<{ text: string }>()).results.map((r) => r.text);
    let text: string | null = null;
    // 罐頭短留言只用在頂層、比例很低，而且同一篇不重複
    if (!parent && Math.random() < 0.2) {
      const pool = (p.sensitive ? QUICK_ADULT.concat(QUICK) : /笑|梗|為什麼|因為/.test(p.text) ? QUICK_JOKE.concat(QUICK) : QUICK).filter((q) => !recent.includes(q));
      text = pool.length ? pick(pool) : null;
    } else {
      const system = `${BASE_RULES}\n你的帳號名稱是「${a.name}」，個性：${a.persona}。`;
      const style = pick(['接著貼文的某個細節說自己的經驗', '針對內容提出一個具體的問題', '給一個實際的小建議', '輕鬆吐槽其中一個點', '說自己不同的看法（客氣地）', '補充一個相關的生活小事']);
      const ban = '不要用「天啊」「同感」「真的」「笑死」「大家一定要看」「我看過了」「可以分享一下嗎」這種空泛的話；不要假裝看過影片或文章全文；不要重複別人說過的話';
      const ask = parent
        ? `貼文：${p.text.slice(0, 200)}\n有人留言：「${parent.text.slice(0, 100)}」\n請針對這則留言的內容回覆，像台灣網友聊天，5 到 30 個字。${ban}。只寫回覆內容。`
        : `貼文：${p.text.slice(0, 300)}${p.link_title ? `\n（貼文附的連結標題：${p.link_title}）` : ''}\n底下已經有人說：${recent.slice(0, 5).map((r) => `「${r}」`).join('、') || '（還沒有人留言）'}\n請你${style}，像台灣網友留言，5 到 30 個字，一定要提到貼文裡的具體內容。${ban}。只寫留言內容。`;
      const out = await generate(env, system, ask, 80, model);
      if (out && !REFUSAL.test(out) && !SIMPLIFIED.test(out)) {
        const c = toTaiwan(out.replace(/^["「『]|["」』]$/g, '').trim());
        if (!/大家一定要看|我看過了|可以分享一下嗎|一定要看/.test(c) && !recent.includes(c)) text = c;
      }
    }
    if (!text) continue;
    await addComment(env, p.id, a, text.slice(0, 120), parent?.id ?? null);
    if (Math.random() < 0.5) await addLike(env, p.id, { id: a.id, is_content: 1 }, undefined, p.sensitive || Math.random() < 0.3 ? '😂' : '❤️');
  }
}

/** 遊戲推坑小站：中立的遊戲推薦帳號，每天兩篇——一篇介紹合作工作室的作品（標明【工作室作品】），一篇轉貼其他獨立遊戲的影片 */
const STUDIO_GAMES: { title: string; facts: string; url: string; img: string }[] = [
  { title: '街區學園：勢力崛起', facts: '台灣街頭×賽博龐克的掛機練功 MMO，三大學院爭奪戰、四大職業，支援中英日韓', url: 'https://nanstudiotw.itch.io/neo-academy', img: 'https://img.itch.zone/aW1nLzMyMjMwODI5LmpwZw==/315x250%23c/o%2FqIYZ.jpg' },
  { title: '人族無敵 II', facts: '魔獸三經典塔防地圖《人族無敵 II》的網頁、手機版', url: 'https://nanstudiotw.itch.io/humans2', img: 'https://img.itch.zone/aW1nLzMxNzcxNDMzLnBuZw==/315x250%23c/YreCjh.png' },
  { title: '真．三國無雙（魔獸Ⅲ經典地圖）', facts: '魔獸Ⅲ經典地圖《真．三國無雙》的網頁、手機版', url: 'https://nanstudiotw.itch.io/sanguomusou', img: 'https://img.itch.zone/aW1nLzMxNjEyNDM5LmpwZw==/315x250%23c/VFcqiP.jpg' },
  { title: '誰是殺手 Who Is the Killer?', facts: '隱藏身分的推理對戰遊戲', url: 'https://nanstudiotw.itch.io/who-is-the-killer', img: 'https://img.itch.zone/aW1nLzMxNTkwMzQxLnBuZw==/315x250%23c/F%2Bv8wA.png' },
  { title: '守女神GX 手機版', facts: '魔獸經典防守圖《守女神GX》手機／網頁版，60 位戰國武將', url: 'https://nanstudiotw.itch.io/gx-defense', img: 'https://img.itch.zone/aW1nLzMxNTI3MjIxLmpwZw==/315x250%23c/e1twba.jpg' },
  { title: '綠色循環圈外傳TD', facts: '魔獸經典地圖「綠色循環圈外傳」手機版：原始 3D 模型、48 波加熊貓大師、有電腦隊友', url: 'https://nanstudiotw.itch.io/green-circle-td', img: 'https://img.itch.zone/aW1nLzMxNTE0MDA2LmpwZw==/315x250%23c/g%2BV5xW.jpg' },
  { title: '火影忍者羈絆TD 手機版', facts: '魔獸三經典守城《火影忍者羈絆》手機版：48 位忍者、30 波守城、AI 隊友', url: 'https://nanstudiotw.itch.io/naruto-kizuna-mobile', img: 'https://img.itch.zone/aW1nLzMxNTI3MjQwLnBuZw==/315x250%23c/1B0RjL.png' },
  { title: '戰國防衛戰 BASARA 手機版', facts: '戰國題材的防守遊戲手機版', url: 'https://nanstudiotw.itch.io/basara-defense', img: 'https://img.itch.zone/aW1nLzMxNTI3MjM1LmpwZw==/315x250%23c/g%2F1%2BAW.jpg' },
  { title: '台灣爭霸 Taiwan Conquest', facts: '以台灣為舞台的多人線上策略遊戲', url: 'https://nanstudiotw.itch.io/taiwan-conquest', img: 'https://img.itch.zone/aW1nLzMxMzcxMzQ3LmpwZw==/315x250%23c/GpTtqt.jpg' },
  { title: '信長之野望 手機版', facts: '織田軍對聯合軍，手機上的 5v5 信長 MOBA（Android）', url: 'https://nanstudiotw.itch.io/nobunaga-mobile', img: 'https://img.itch.zone/aW1nLzMxMzA5MjE5LnBuZw==/315x250%23c/K1Ss4N.png' },
  { title: 'Deadzone City 都市獵殺', facts: '回合制都市大逃殺：搜刮、整裝，跟 20 個 AI 對手拚到最後', url: 'https://nanstudiotw.itch.io/deadzone-city', img: 'https://img.itch.zone/aW1nLzMwNjQ2Mzk4LnBuZw==/315x250%23c/G8yXwc.png' },
];
export async function runGamePicks(env: Env, slot: 'studio' | 'indie', force = false) {
  const s = await getSettings(env.DB);
  if (!force && (s.game_picks === '0' || s.content_enabled !== '1')) return { skipped: '已關閉' };
  await env.DB.prepare("INSERT OR IGNORE INTO users (id, name, handle, is_content, content_group, content_enabled, persona, bio, created_at) VALUES ('u_gamepicks', '遊戲推坑小站', 'game_picks', 1, 'gamepicks', 0, '熱愛獨立遊戲和網頁遊戲的推坑帳號，語氣輕鬆、會講重點', '推薦好玩的獨立遊戲與網頁遊戲 🎮 標示【工作室作品】的是合作工作室 N.A.N_TW_STUDIO 的作品', ?)").bind(now()).run();
  const a = await env.DB.prepare("SELECT id, name, handle, content_group, persona FROM users WHERE id = 'u_gamepicks'").first<Account>();
  if (!a) return { error: '帳號建立失敗' };
  const boards = (await env.DB.prepare('SELECT id, name, description, content_group FROM communities').all<Board>()).results;
  const indie = boards.find((b) => b.name === '獨立遊戲') || boards.find((b) => b.content_group === 'game') || null;
  const model = s.ai_model || env.AI_MODEL;
  const toBack = env.DB.prepare("SELECT 1");
  if (slot === 'indie') {
    const v = await takeVideo(env, ['game'], ['indie', '獨立', 'Steam', 'demo', '試玩']);
    return v ? { posted: await postVideo(env, model, a, v, indie ? [{ ...indie, content_group: 'game' }] : boards, toBack) } : { skipped: '沒有可分享的遊戲影片' };
  }
  const idx = Number(s.studio_games_idx || 0) % STUDIO_GAMES.length;
  const g = STUDIO_GAMES[idx];
  const prompt = `用推薦帳號的口吻介紹一款遊戲，輕鬆、講重點，像在跟大家說「這款可以看看」。不要寫成自己玩過的心得（不要用「最近在玩」「我玩了」「真的很好玩」這類說法），也不要替遊戲打分數或說別人評價很好。
遊戲：${g.title}
已知資訊（只能用這些，不要編造玩法細節、數字、評價或更新內容）：${g.facts}。
只輸出 2 到 3 句、40 到 90 個字的介紹，不要標題、不要網址、不要 hashtag。`;
  const out = await generate(env, BASE_RULES, prompt, 220, model);
  if (!out || REFUSAL.test(out) || SIMPLIFIED.test(out)) return { error: 'AI 生成失敗' };
  const intro = await reviewPost(env, model, fixTypos(out.replace(/^["「『]|["」』]$/g, '').replace(/https?:\/\/\S+/g, '').trim()), `遊戲：${g.title}\n已知資訊：${g.facts}`);
  if (!intro) return { error: '介紹沒通過檢查' };
  const tagName = g.title.split(' ')[0].replace(/（.*?）|[：:．・]/g, '');
  const text = `【工作室作品】${g.title}\n${intro}\n#獨立遊戲 #手機遊戲 #${tagName}`;
  const id = newId();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO posts (id, user_id, text, link_url, link_title, link_site, link_image, community_id, source, created_at) VALUES (?, 'u_gamepicks', ?, ?, ?, 'itch.io · NanStudioTw', ?, ?, 'content', ?)")
      .bind(id, text, g.url, g.title, g.img, indie?.id ?? null, now()),
    env.DB.prepare("UPDATE users SET last_posted_at = ? WHERE id = 'u_gamepicks'").bind(now()),
    env.DB.prepare("INSERT INTO settings (key, value) VALUES ('studio_games_idx', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(idx + 1)),
    ...(indie ? [env.DB.prepare('UPDATE communities SET post_count = post_count + 1 WHERE id = ?').bind(indie.id)] : []),
  ]);
  return { posted: id, game: g.title };
}

/** 每日星座運勢：專門的 ✦ 帳號每天早上 7 點發一篇 12 星座運勢（娛樂用） */
const SIGNS = ['♈ 牡羊座', '♉ 金牛座', '♊ 雙子座', '♋ 巨蟹座', '♌ 獅子座', '♍ 處女座', '♎ 天秤座', '♏ 天蠍座', '♐ 射手座', '♑ 摩羯座', '♒ 水瓶座', '♓ 雙魚座'];
export async function runHoroscope(env: Env, force = false) {
  const s = await getSettings(env.DB);
  if (!force && (s.horoscope === '0' || s.content_enabled !== '1')) return { skipped: '已關閉' };
  await env.DB.prepare("INSERT OR IGNORE INTO users (id, name, handle, is_content, content_group, content_enabled, persona, bio, created_at) VALUES ('u_horoscope', '每日星座運勢', 'daily_horoscope', 1, 'horoscope', 0, '每天早上幫大家看 12 星座運勢，語氣溫暖帶點幽默', '每天早上 7 點更新 12 星座運勢 🔮 僅供娛樂參考', ?)").bind(now()).run();
  const d = new Date(Date.now() + 8 * 3600_000);
  const label = `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${'日一二三四五六'[d.getUTCDay()]}）`;
  if (!force && (await env.DB.prepare("SELECT 1 FROM posts WHERE user_id = 'u_horoscope' AND text LIKE ?").bind(`🔮 ${label}%`).first())) return { skipped: '今天已經發過' };
  const prompt = `寫今天（${label}）的 12 星座運勢，給台灣社群網站的大家看，僅供娛樂。
每個星座一行，格式：「星座名：一句運勢（15 到 28 個字，具體、生活化、有點幽默，例如工作、感情、財運、人際的小提醒）｜幸運色：○」
照這個順序寫：${SIGNS.map((x) => x.split(' ')[1]).join('、')}。只輸出這 12 行，不要開場白。不要寫恐嚇或負面到讓人不舒服的內容。不要提到任何節日或特定日期（除非今天真的是那個節日）。`;
  let lines: string[] = [];
  for (let i = 0; i < 3 && lines.length < 12; i++) {
    const out = await generate(env, BASE_RULES, prompt, 1600, s.ai_model || env.AI_MODEL);
    if (!out || SIMPLIFIED.test(out)) continue;
    const got = SIGNS.map((sg) => { const name = sg.split(' ')[1]; const m = out.match(new RegExp(`${name}[:：]\\s*(.+)`)); return m ? `${sg}：${toTaiwan(m[1].trim().replace(/\s+｜/g, '｜')).slice(0, 90)}` : ''; });
    if (got.every((x) => x && /幸運色：\S/.test(x))) lines = got;
  }
  if (lines.length < 12) return { error: 'AI 沒有寫齊 12 星座，這次跳過' };
  const board = await env.DB.prepare("SELECT id FROM communities WHERE slug = 'life'").first<{ id: string }>();
  const id = newId();
  const text = `🔮 ${label} 12 星座運勢\n\n${lines.join('\n')}\n\n你的星座今天準不準？留言告訴我 👇\n#星座運勢 #每日運勢`;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO posts (id, user_id, text, community_id, source, created_at) VALUES (?, 'u_horoscope', ?, ?, 'content', ?)").bind(id, text, board?.id ?? null, now()),
    env.DB.prepare("UPDATE users SET last_posted_at = ? WHERE id = 'u_horoscope'").bind(now()),
    ...(board ? [env.DB.prepare('UPDATE communities SET post_count = post_count + 1 WHERE id = ?').bind(board.id)] : []),
  ]);
  return { posted: id };
}

/** 清掉 ✦ 帳號的空泛留言（罐頭短句、6 個字以內、像業配的話），連同底下的回覆，並重算留言數 */
export async function purgeGenericComments(env: Env) {
  const canned = [...QUICK, ...QUICK_ADULT, ...QUICK_JOKE];
  const rows = (await env.DB.prepare(`SELECT c.id, c.post_id, c.text FROM comments c JOIN users u ON u.id = c.user_id WHERE u.is_content = 1`).all<{ id: string; post_id: string; text: string }>()).results;
  const bad = rows.filter((r) => { const t = r.text.trim(); return canned.includes(t) || [...t.replace(/[\s!！?？~～。，,.]/g, '')].length <= 6 || /大家一定要看|一定要看|我看過了|可以分享一下嗎|有夠搞笑吧|笑死我了/.test(t); });
  const ids = bad.map((b) => b.id);
  const posts = new Set(bad.map((b) => b.post_id));
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const ph = chunk.map(() => '?').join(',');
    await env.DB.prepare(`DELETE FROM comments WHERE id IN (${ph}) OR parent_id IN (${ph})`).bind(...chunk, ...chunk).run();
  }
  const pl = [...posts];
  for (let i = 0; i < pl.length; i += 50) {
    const chunk = pl.slice(i, i + 50);
    await env.DB.batch(chunk.map((id) => env.DB.prepare('UPDATE posts SET comment_count = (SELECT COUNT(*) FROM comments WHERE post_id = ?) WHERE id = ?').bind(id, id)));
  }
  return { deleted: ids.length, posts: pl.length, total_ai_comments: rows.length };
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
  // 每 30 分鐘通知搜尋引擎（IndexNow）收錄新文章
  if (m === 20 || m === 50) await pingIndexNow(env).catch((e) => console.log('indexnow', String(e)));
  // 頻道分兩批抓（免費方案每次最多 50 個對外請求）
  if (m === 15 || m === 45) await fetchVideos(env, DEFAULT_CHANNELS.filter((_, i) => i % 2 === (m === 15 ? 0 : 1))).catch((e) => console.log('videos', String(e)));
  // 每日投票：台灣時間 10:00 起每 10 分鐘檢查一次（今天發過就跳過）
  if (d.getUTCHours() >= 2 && d.getUTCHours() < 14 && m % 10 === 0) await runDailyPoll(env).catch((e) => console.log('daily poll', String(e)));
  // 遊戲推坑小站：台灣時間 12:40 介紹工作室作品、20:40 轉貼其他獨立遊戲影片
  const twH = (d.getUTCHours() + 8) % 24;
  if (m === 40 && twH === 12) await runGamePicks(env, 'studio').catch((e) => console.log('gamepicks', String(e)));
  if (m === 40 && twH === 20) await runGamePicks(env, 'indie').catch((e) => console.log('gamepicks', String(e)));
  // 星座運勢：台灣時間早上 7:00 起每 10 分鐘檢查一次（UTC 23 點）
  if ((d.getUTCHours() === 23 || d.getUTCHours() === 0) && m % 10 === 2) await runHoroscope(env).catch((e) => console.log('horoscope', String(e)));
  // 議題投票：台灣時間 12:00 起每 10 分鐘檢查一次
  if (d.getUTCHours() >= 4 && d.getUTCHours() < 14 && m % 10 === 5) await runIssuePoll(env).catch((e) => console.log('issue poll', String(e)));
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
