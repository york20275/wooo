import type { Env } from './env';

/** 各模型每 100 萬 token 的 neurons（依 Cloudflare 公開價格換算），用來記帳 */
const RATES: Record<string, [number, number]> = {
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': [26668, 204805],
  '@cf/meta/llama-3.1-8b-instruct-fp8-fast': [4119, 34868],
  '@cf/meta/llama-4-scout-17b-16e-instruct': [24545, 77273],
};
const utcDay = () => new Date().toISOString().slice(0, 10);

/** 今天（Cloudflare 以 UTC 計，台灣時間早上 8 點重置）已用的 neurons 與上限 */
export async function aiBudget(env: Env) {
  const r = await env.DB.prepare("SELECT (SELECT value FROM settings WHERE key = ?) AS used, (SELECT value FROM settings WHERE key = 'ai_daily_cap') AS cap").bind(`ai_used_${utcDay()}`).first<{ used: string | null; cap: string | null }>();
  const used = Number(r?.used || 0), cap = Number(r?.cap || 9000);
  return { used, cap, left: Math.max(0, cap - used), ratio: cap ? used / cap : 1 };
}
export async function addAiUsage(env: Env, model: string, promptTokens: number, completionTokens: number) {
  const [i, o] = RATES[model] || RATES['@cf/meta/llama-3.3-70b-instruct-fp8-fast'];
  const n = (promptTokens * i + completionTokens * o) / 1e6;
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS REAL) + CAST(excluded.value AS REAL) AS TEXT)").bind(`ai_used_${utcDay()}`, String(n)).run();
  return n;
}

/** 用 Workers AI 生成文字；超過每日免費額度上限或失敗時回傳 null，由呼叫端改用備用做法 */
export async function generate(env: Env, system: string, prompt: string, maxTokens = 320, model?: string): Promise<string | null> {
  const m = model || env.AI_MODEL;
  try {
    if ((await aiBudget(env)).left <= 0) return null;
    const res: any = await env.AI.run(m as any, {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.9,
    });
    const text = typeof res === 'string' ? res : res?.response;
    const u = res?.usage;
    // 沒有回傳用量時，用字數粗估（中文約 1.3 token／字）
    await addAiUsage(env, m, u?.prompt_tokens ?? Math.ceil((system.length + prompt.length) * 1.3), u?.completion_tokens ?? Math.ceil(String(text || '').length * 1.3)).catch(() => {});
    if (!text || typeof text !== 'string') return null;
    return clean(text);
  } catch (e) {
    console.log('AI error', String(e));
    return null;
  }
}

/** 留言用的精簡規則（留言很短，不需要整份發文規則，省額度） */
export const COMMENT_RULES = '你是台灣社群網站的網友。用台灣繁體中文口語、台灣用語，簡短自然，不要提到 AI，不要引號，不談政治立場、不給投資建議、不寫色情暴力。';

function clean(t: string): string | null {
  let s = t.trim()
    .replace(/^["「『]+|["」』]+$/g, '')
    .replace(/^(貼文|內容|文章)[:：]\s*/, '')
    .replace(/\*\*/g, '')
    .trim();
  if (s.length > 400) s = s.slice(0, 400);
  // 擋掉明顯不該出現的內容（保險機制，提示詞本身也有限制）
  if (/(色情|裸露|做愛|性交|自殺|殺人方法)/.test(s)) return null;
  return s.length >= 8 ? s : null;
}

export const BASE_RULES = `你在社群平台「窩Woo！」經營一個「平台內容帳號」，網站會在帳號旁標示 ✦ 讓讀者知道。
規則：
- 用台灣繁體中文、自然口語，像一般人在社群上發文。
- 不要提到你是 AI，不要加引號、標題或 Markdown。
- 不要捏造新聞、統計數字，也不要提到真實的人名、店名或品牌；生活小故事可以是虛構的日常情境。
- 不寫露骨的性描寫、暴力血腥、仇恨歧視的內容；被要求寫成人梗時，只能用輕度的雙關或暗示，對象一律是成年人，絕不涉及未成年。
- 不給醫療、法律或投資建議；不表達政治立場。
- 該短就短，不要每篇都寫成長文。
- 一律用台灣的用語和繁體字（例如：影片、品質、網路、軟體、捷運、計程車、早安），不要用大陸用語、簡體字、罕見字或自己造的詞。
- 談到選舉、政治時保持中立：不支持也不攻擊任何候選人或政黨，不叫人投給誰。
- 談到股票、投資時只聊看法與心情，絕不給買進賣出建議，也不要編造股價或漲跌數字。
- 內容要合乎常理、前後一致：像真人會遇到的日常小事，不要為了結尾硬拗出奇怪的發展。
- 不要寫出聽起來像犯罪或危險的情節（被困住、被關、出不去、被跟蹤、被下藥等），也不要把別人寫得像在控制或強迫你。
- 笑話要有清楚的笑點，不要寫成沒頭沒尾的流水帳。
- 星座、塔羅、算命類內容只當作輕鬆娛樂。`;
