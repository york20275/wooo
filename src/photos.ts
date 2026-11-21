import type { Env } from './env';
import { getSetting, newId } from './env';

/** Pexels 免費圖庫：搜尋照片 → 複製一份到 R2 → 回傳圖片位置與攝影者（顯示在照片下方） */
export interface Photo { key: string; credit: string; creditUrl: string }

/** 依帳號主題的備用搜尋字（AI 沒給關鍵字時用） */
const TOPIC_WORDS: [RegExp, string][] = [
  [/貓/, 'cat'], [/狗|毛孩/, 'dog'], [/咖啡/, 'coffee cup'], [/夜市/, 'night market food'], [/捷運|公車|通勤/, 'subway train city'],
  [/超商|便利商店/, 'convenience store'], [/早餐/, 'breakfast'], [/外送/, 'food delivery'], [/颱風|天氣/, 'rainy street umbrella'],
  [/機車/, 'scooter street'], [/菜市場/, 'vegetable market'], [/健身/, 'gym workout'], [/減肥/, 'healthy food'], [/旅/, 'travel landscape'],
  [/租屋|室友|套房/, 'small apartment room'], [/辦公室|上班/, 'office desk'], [/學生/, 'classroom'], [/約會/, 'cafe table'],
  [/美食|料理|小吃/, 'street food'], [/桌遊/, 'board game'], [/手遊|手機遊戲/, 'mobile game phone'], [/電競|主機|遊戲|RPG/, 'video game controller'],
  [/星座|塔羅/, 'night sky stars'], [/追劇|電影/, 'popcorn movie night'], [/家族|老媽|老爸/, 'home dinner table'], [/心情|下班/, 'city sunset'],
];
export function topicQuery(persona: string) {
  for (const [re, q] of TOPIC_WORDS) if (re.test(persona)) return q;
  return 'everyday life';
}

/** 從 AI 輸出拆出「PHOTO: 關鍵字」那一行 */
export function splitPhotoLine(text: string): { text: string; query: string | null } {
  let query: string | null = null;
  const out = text.split('\n').filter((line) => {
    const m = line.match(/^\s*\**\s*PHOTO\s*[:：]\s*(.+?)\s*\**\s*$/i);
    if (m) { query = m[1].replace(/[^a-zA-Z ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || null; return false; }
    return true;
  });
  return { text: out.join('\n').trim(), query };
}

export async function pexelsKey(env: Env) {
  return (await getSetting(env.DB, 'pexels_key', '')) || env.PEXELS_API_KEY || '';
}

interface Candidate { image: string; credit: string; page: string }

/** 依序嘗試：Pexels（有金鑰）→ Pixabay（有金鑰）→ Openverse（免金鑰，CC0／公眾領域／CC BY） */
export async function candidates(env: Env, query: string, debug?: string[]): Promise<Candidate[]> {
  const pexels = await pexelsKey(env);
  if (pexels) {
    const base = env.PEXELS_API_BASE || 'https://api.pexels.com';
    const r = await fetch(`${base}/v1/search?query=${encodeURIComponent(query)}&per_page=30&orientation=landscape`, { headers: { Authorization: pexels } });
    if (r.ok) {
      const d = (await r.json()) as any;
      const list = (d.photos || []).map((x: any) => ({ image: x.src.large, credit: `${x.photographer}／Pexels`, page: x.url }));
      if (list.length) return list;
    } else console.log('pexels', r.status);
  }
  const pixabay = await getSetting(env.DB, 'pixabay_key', '');
  if (pixabay) {
    const r = await fetch(`https://pixabay.com/api/?key=${encodeURIComponent(pixabay)}&q=${encodeURIComponent(query)}&image_type=photo&orientation=horizontal&safesearch=true&per_page=30`);
    if (r.ok) {
      const d = (await r.json()) as any;
      const list = (d.hits || []).map((x: any) => ({ image: x.webformatURL, credit: `${x.user}／Pixabay`, page: x.pageURL }));
      if (list.length) return list;
    } else console.log('pixabay', r.status);
  }
  const r = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&license=cc0,pdm,by&mature=false&aspect_ratio=wide&page_size=20`, {
    headers: { 'User-Agent': 'WooBot/1.0 (+https://wootw.com)' },
  });
  if (!r.ok) { console.log('openverse', r.status); debug?.push(`openverse HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`); return []; }
  const d = (await r.json()) as any;
  return (d.results || [])
    .filter((x: any) => x.url)
    .map((x: any) => ({
      // Flickr 會擋 Cloudflare 伺服器（403），改用 Openverse 自己代理的縮圖
      image: /staticflickr|flickr\.com/.test(x.url) && x.thumbnail ? `${x.thumbnail}?full_size=true` : x.url,
      credit: `${(x.creator || '佚名').slice(0, 40)}／${x.license === 'by' ? `CC BY ${x.license_version || ''}`.trim() : x.license === 'cc0' ? 'CC0' : '公眾領域'}`,
      page: x.foreign_landing_url || x.url,
    }));
}

export async function findPhoto(env: Env, query: string, debug?: string[]): Promise<Photo | null> {
  const list = (await candidates(env, query, debug)).sort(() => Math.random() - 0.5);
  debug?.push(`候選 ${list.length} 張`);
  for (const p of list.slice(0, 6)) {
    // 同一張照片不重複使用
    const used = await env.DB.prepare('SELECT 1 FROM posts WHERE image_credit_url = ? LIMIT 1').bind(p.page).first();
    if (used) continue;
    let img = await fetch(p.image, { headers: { 'User-Agent': 'WooBot/1.0 (+https://wootw.com)' } }).catch(() => null);
    if ((!img || !img.ok) && p.image.includes('full_size=true')) img = await fetch(p.image.replace('?full_size=true', ''), { headers: { 'User-Agent': 'WooBot/1.0 (+https://wootw.com)' } }).catch(() => null);
    const type = img?.headers.get('content-type') || '';
    debug?.push(`${p.image} → ${img ? img.status : '連線失敗'} ${type}`);
    if (!img || !img.ok || !type.startsWith('image/') || type.includes('svg')) continue;
    const buf = await img.arrayBuffer();
    debug?.push(`大小 ${buf.byteLength}`);
    if (buf.byteLength > 4 * 1024 * 1024 || buf.byteLength < 5000) continue;
    const d = new Date();
    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
    const k = `c/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${newId()}.${ext}`;
    await env.IMAGES.put(k, buf, { httpMetadata: { contentType: type } });
    return { key: k, credit: p.credit.slice(0, 80), creditUrl: p.page };
  }
  return null;
}

// ======================= ✦ 帳號頭像 =======================
const CARTOON = ['lorelei', 'notionists', 'open-peeps', 'pixel-art', 'thumbs']; // DiceBear 的 CC0 授權風格（卡通人物）
const ANIMALS = ['cat', 'kitten', 'dog', 'puppy', 'shiba inu', 'corgi', 'rabbit', 'hamster', 'parrot', 'owl', 'fox', 'red panda', 'penguin', 'turtle', 'hedgehog', 'alpaca', 'duck', 'squirrel'];
const SCENES = ['mountain landscape', 'sea sunset', 'forest', 'city night', 'flowers', 'coffee', 'blue sky clouds', 'beach', 'autumn leaves', 'snow mountain', 'lake', 'sunrise', 'cherry blossom', 'starry sky', 'waterfall'];
const pickOne = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];

async function grab(url: string): Promise<{ buf: ArrayBuffer; type: string } | null> {
  const r = await fetch(url, { headers: { 'User-Agent': 'WooBot/1.0 (+https://wootw.com)' } }).catch(() => null);
  const type = r?.headers.get('content-type') || '';
  if (!r || !r.ok || !type.startsWith('image/') || type.includes('svg')) return null;
  const buf = await r.arrayBuffer();
  return buf.byteLength > 5000 && buf.byteLength < 3 * 1024 * 1024 ? { buf, type } : null;
}

/** 動物或風景照（只用 CC0／公眾領域，頭像上不必標示作者） */
async function openverseSquare(query: string) {
  const r = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&license=cc0,pdm&mature=false&aspect_ratio=square&page_size=20`, {
    headers: { 'User-Agent': 'WooBot/1.0 (+https://wootw.com)' },
  }).catch(() => null);
  if (!r || !r.ok) return null;
  const d = (await r.json()) as any;
  const list = (d.results || []).filter((x: any) => x.url).sort(() => Math.random() - 0.5);
  for (const x of list.slice(0, 3)) {
    const img = await grab(x.thumbnail || x.url);
    if (img) return img;
  }
  return null;
}

/** 每次幫幾個還沒有頭像的 ✦ 帳號配頭像：約 3 成動物、2 成風景、5 成卡通人物（不使用真人照片） */
export async function assignAvatars(env: Env, n: number) {
  const r = await env.DB.prepare('SELECT id, handle FROM users WHERE is_content = 1 AND avatar_key IS NULL ORDER BY RANDOM() LIMIT ?').bind(n).all<{ id: string; handle: string }>();
  let done = 0;
  for (const u of r.results) {
    const roll = Math.random();
    let img = roll < 0.3 ? await openverseSquare(pickOne(ANIMALS)) : roll < 0.5 ? await openverseSquare(pickOne(SCENES)) : null;
    if (!img) {
      const style = pickOne(CARTOON);
      img = await grab(`https://api.dicebear.com/9.x/${style}/png?seed=${encodeURIComponent(u.handle)}&size=256&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf,c7f0d8`);
    }
    if (!img) continue;
    const ext = img.type.includes('png') ? 'png' : img.type.includes('webp') ? 'webp' : 'jpg';
    const key = `avatars/c/${u.id}-${newId().slice(0, 6)}.${ext}`;
    await env.IMAGES.put(key, img.buf, { httpMetadata: { contentType: img.type } });
    await env.DB.prepare('UPDATE users SET avatar_key = ? WHERE id = ? AND avatar_key IS NULL').bind(key, u.id).run();
    done++;
  }
  return done;
}
