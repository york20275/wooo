import type { Env } from './env';

/** 用 Workers AI 生成文字；失敗時回傳 null，由呼叫端改用備用模板 */
export async function generate(env: Env, system: string, prompt: string, maxTokens = 320, model?: string): Promise<string | null> {
  try {
    const res: any = await env.AI.run((model || env.AI_MODEL) as any, {
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
- 不要捏造新聞、統計數字，也不要提到真實的人名、店名或品牌；生活小故事可以是虛構的日常情境。
- 不寫露骨的性描寫、暴力血腥、仇恨歧視的內容；被要求寫成人梗時，只能用輕度的雙關或暗示，對象一律是成年人，絕不涉及未成年。
- 不給醫療、法律或投資建議；不表達政治立場。
- 該短就短，不要每篇都寫成長文。
- 內容要合乎常理、前後一致：像真人會遇到的日常小事，不要為了結尾硬拗出奇怪的發展。
- 不要寫出聽起來像犯罪或危險的情節（被困住、被關、出不去、被跟蹤、被下藥等），也不要把別人寫得像在控制或強迫你。
- 笑話要有清楚的笑點，不要寫成沒頭沒尾的流水帳。
- 星座、塔羅、算命類內容只當作輕鬆娛樂。`;
