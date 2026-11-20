import type { Env } from './env';

/** 用 Workers AI 生成文字；失敗時回傳 null，由呼叫端改用備用模板 */
export async function generate(env: Env, system: string, prompt: string, maxTokens = 320): Promise<string | null> {
  try {
    const res: any = await env.AI.run(env.AI_MODEL as any, {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.9,
    });
    const text = typeof res === 'string' ? res : res?.response;
    if (!text || typeof text !== 'string') return null;
    return clean(text);
  } catch (e) {
    console.log('AI error', String(e));
    return null;
  }
}

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
- 不要捏造具體的數字、人名、日期、事件或新聞。
- 不寫與性有關、暴力血腥、仇恨歧視的內容；不給醫療、法律或投資建議；不表達政治立場。
- 星座、塔羅、算命類內容只當作輕鬆娛樂。`;
