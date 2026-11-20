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

export async function findPhoto(env: Env, query: string): Promise<Photo | null> {
  const key = await pexelsKey(env);
  if (!key) return null;
  const base = env.PEXELS_API_BASE || 'https://api.pexels.com';
  const r = await fetch(`${base}/v1/search?query=${encodeURIComponent(query)}&per_page=30&orientation=landscape`, { headers: { Authorization: key } });
  if (!r.ok) { console.log('pexels', r.status); return null; }
  const data = (await r.json()) as { photos?: { id: number; url: string; photographer: string; src: { large: string } }[] };
  const photos = (data.photos || []).sort(() => Math.random() - 0.5);
  for (const p of photos.slice(0, 6)) {
    // 同一張照片不重複使用
    const used = await env.DB.prepare('SELECT 1 FROM posts WHERE image_credit_url = ? LIMIT 1').bind(p.url).first();
    if (used) continue;
    const img = await fetch(p.src.large);
    const type = img.headers.get('content-type') || '';
    if (!img.ok || !type.startsWith('image/')) continue;
    const buf = await img.arrayBuffer();
    if (buf.byteLength > 4 * 1024 * 1024) continue;
    const d = new Date();
    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
    const k = `c/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${newId()}.${ext}`;
    await env.IMAGES.put(k, buf, { httpMetadata: { contentType: type } });
    return { key: k, credit: p.photographer.slice(0, 80), creditUrl: p.url };
  }
  return null;
}
