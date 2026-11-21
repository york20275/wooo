import { Hono } from 'hono';
import type { AppEnv, Env, User } from './env';
import { getSettings, imgUrl, isBlockedEither, logContent, newId, now } from './env';
import { HttpError, POST_COLS, requireHuman, requireUser, serializeMany, visibility } from './api';
import { notify } from './notify';
import { BASE_RULES, generate } from './ai';

export const features = new Hono<AppEnv>();
const pubUser = (x: any) => ({ id: x.id, name: x.name, handle: x.handle, avatar_url: imgUrl(x.avatar_key), is_content: !!x.is_content });

// ======================= 轉發 =======================
features.post('/posts/:id/repost', async (c) => {
  const u = requireUser(c);
  requireHuman(c, u);
  let p = await c.env.DB.prepare("SELECT p.id, p.user_id, p.kind, p.repost_of, p.text FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ? AND p.hidden = 0 AND u.status != 'banned'").bind(c.req.param('id')).first<any>();
  if (p?.kind === 'repost') p = await c.env.DB.prepare('SELECT id, user_id, kind, text FROM posts WHERE id = ? AND hidden = 0').bind(p.repost_of).first<any>();
  if (!p) throw new HttpError(404, '找不到這篇文章');
  if (p.user_id === u.id) throw new HttpError(400, '不能轉發自己的文章');
  if (await isBlockedEither(c.env.DB, u.id, p.user_id)) throw new HttpError(403, '你無法轉發這位用戶的文章');
  const dup = await c.env.DB.prepare("SELECT id FROM posts WHERE user_id = ? AND repost_of = ? AND kind = 'repost'").bind(u.id, p.id).first();
  if (dup) return c.json({ ok: true, reposted: true });
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO posts (id, user_id, text, kind, repost_of, source, created_at) VALUES (?, ?, '', 'repost', ?, 'user', ?)").bind(newId(), u.id, p.id, now()),
    c.env.DB.prepare('UPDATE posts SET repost_count = repost_count + 1 WHERE id = ?').bind(p.id),
  ]);
  await notify(c.env, c.executionCtx, p.user_id, u, 'repost', p.id, p.text);
  return c.json({ ok: true, reposted: true });
});

features.delete('/posts/:id/repost', async (c) => {
  const u = requireUser(c);
  const r = await c.env.DB.prepare("DELETE FROM posts WHERE user_id = ? AND repost_of = ? AND kind = 'repost'").bind(u.id, c.req.param('id')).run();
  if (r.meta.changes) await c.env.DB.prepare('UPDATE posts SET repost_count = MAX(repost_count - 1, 0) WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true, reposted: false });
});

/** 自己有沒有轉發過（前端開轉發選單時用） */
features.get('/posts/:id/repost', async (c) => {
  const u = c.get('user') as User | null;
  if (!u) return c.json({ reposted: false });
  const r = await c.env.DB.prepare("SELECT 1 FROM posts WHERE user_id = ? AND repost_of = ? AND kind = 'repost'").bind(u.id, c.req.param('id')).first();
  return c.json({ reposted: !!r });
});

// ======================= 收藏 =======================
features.post('/posts/:id/bookmark', async (c) => {
  const u = requireUser(c);
  const p = await c.env.DB.prepare('SELECT 1 FROM posts WHERE id = ? AND hidden = 0').bind(c.req.param('id')).first();
  if (!p) throw new HttpError(404, '找不到這篇文章');
  await c.env.DB.prepare('INSERT OR IGNORE INTO bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)').bind(u.id, c.req.param('id'), now()).run();
  return c.json({ ok: true });
});
features.delete('/posts/:id/bookmark', async (c) => {
  const u = requireUser(c);
  await c.env.DB.prepare('DELETE FROM bookmarks WHERE user_id = ? AND post_id = ?').bind(u.id, c.req.param('id')).run();
  return c.json({ ok: true });
});
features.get('/me/bookmarks', async (c) => {
  const u = requireUser(c);
  const before = Number(c.req.query('before') || 0);
  const [vis, vb] = await visibility(c, { ignoreBlocks: true });
  const r = await c.env.DB.prepare(
    `SELECT ${POST_COLS}, b.created_at AS saved_at FROM bookmarks b JOIN posts p ON p.id = b.post_id JOIN users u ON u.id = p.user_id
     WHERE b.user_id = ? AND ${vis} ${before ? 'AND b.created_at < ?' : ''} ORDER BY b.created_at DESC LIMIT 20`
  ).bind(u.id, ...vb, ...(before ? [before] : [])).all();
  return c.json({ posts: await serializeMany(c, r.results) });
});

// ======================= 個人過濾 =======================
features.get('/me/muted', async (c) => {
  const u = requireUser(c);
  const r = await c.env.DB.prepare('SELECT word FROM muted_words WHERE user_id = ? ORDER BY created_at DESC').bind(u.id).all();
  return c.json({ words: r.results.map((x: any) => x.word) });
});
features.post('/me/muted', async (c) => {
  const u = requireUser(c);
  const word = String((await c.req.json<any>()).word || '').trim().slice(0, 30);
  if (!word) throw new HttpError(400, '請輸入要過濾的字詞');
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM muted_words WHERE user_id = ?').bind(u.id).first<{ n: number }>();
  if ((n?.n ?? 0) >= 50) throw new HttpError(400, '最多 50 個過濾字詞');
  await c.env.DB.prepare('INSERT OR IGNORE INTO muted_words (user_id, word, created_at) VALUES (?, ?, ?)').bind(u.id, word, now()).run();
  return c.json({ ok: true });
});
features.delete('/me/muted', async (c) => {
  const u = requireUser(c);
  const word = String((await c.req.json<any>()).word || '');
  await c.env.DB.prepare('DELETE FROM muted_words WHERE user_id = ? AND word = ?').bind(u.id, word).run();
  return c.json({ ok: true });
});

// ======================= 限時動態 =======================
const STORY_HOURS = 24;
const STORY_BGS = ['#2E6A4E', '#1F5FA8', '#C2561D', '#7A3E9D', '#B23A48', '#1C1C1A'];

features.post('/stories', async (c) => {
  const u = requireUser(c);
  requireHuman(c, u);
  const b = await c.req.json<any>();
  const text = String(b.text || '').trim().slice(0, 200);
  const key = b.image_key ? String(b.image_key) : null;
  if (!text && !key) throw new HttpError(400, '寫點字或放張照片吧');
  if (key) {
    const own = await c.env.DB.prepare('SELECT 1 FROM uploads WHERE key = ? AND user_id = ?').bind(key, u.id).first();
    if (!own) throw new HttpError(400, '圖片不存在');
  }
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM stories WHERE user_id = ? AND expires_at > ?').bind(u.id, now()).first<{ n: number }>();
  if ((n?.n ?? 0) >= 20) throw new HttpError(429, '24 小時內最多 20 則限時動態');
  const bg = STORY_BGS.includes(b.bg) ? b.bg : STORY_BGS[0];
  const id = newId();
  await c.env.DB.prepare('INSERT INTO stories (id, user_id, text, image_key, bg, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, u.id, text, key, bg, now(), now() + STORY_HOURS * 3600_000).run();
  return c.json({ id });
});

/** 動態牆上方的限時動態列：自己、追蹤的人優先，再補其他真人 */
features.get('/stories', async (c) => {
  const u = c.get('user') as User | null;
  const r = await c.env.DB.prepare(
    `SELECT s.id, s.user_id, s.text, s.image_key, s.bg, s.created_at, u.name, u.handle, u.avatar_key,
       ${u ? '(SELECT 1 FROM story_views v WHERE v.story_id = s.id AND v.user_id = ?)' : '0'} AS viewed,
       ${u ? '(s.user_id = ? OR s.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?))' : '0'} AS close
     FROM stories s JOIN users u ON u.id = s.user_id
     WHERE s.expires_at > ? AND u.status = 'active'
       ${u ? "AND s.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?) AND s.user_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ? AND kind = 'block')" : ''}
     ORDER BY s.created_at ASC LIMIT 500`
  ).bind(...(u ? [u.id, u.id, u.id] : []), now(), ...(u ? [u.id, u.id] : [])).all();
  const groups = new Map<string, any>();
  for (const s of r.results as any[]) {
    if (!groups.has(s.user_id)) groups.set(s.user_id, { user: { id: s.user_id, name: s.name, handle: s.handle, avatar_url: imgUrl(s.avatar_key) }, mine: u?.id === s.user_id, close: !!s.close, stories: [] });
    groups.get(s.user_id).stories.push({ id: s.id, text: s.text, image_url: imgUrl(s.image_key), bg: s.bg, created_at: s.created_at, viewed: !!s.viewed });
  }
  const list = [...groups.values()].map((g) => ({ ...g, all_viewed: g.stories.every((s: any) => s.viewed), latest: g.stories[g.stories.length - 1].created_at }));
  list.sort((a, b) => Number(b.mine) - Number(a.mine) || Number(a.all_viewed) - Number(b.all_viewed) || Number(b.close) - Number(a.close) || b.latest - a.latest);
  return c.json({ groups: list.slice(0, 40) });
});

features.post('/stories/:id/view', async (c) => {
  const u = c.get('user') as User | null;
  if (!u) return c.json({ ok: true });
  await c.env.DB.prepare('INSERT OR IGNORE INTO story_views (story_id, user_id, created_at) VALUES (?, ?, ?)').bind(c.req.param('id'), u.id, now()).run();
  return c.json({ ok: true });
});

features.get('/stories/:id/viewers', async (c) => {
  const u = requireUser(c);
  const s = await c.env.DB.prepare('SELECT user_id FROM stories WHERE id = ?').bind(c.req.param('id')).first<any>();
  if (!s || s.user_id !== u.id) throw new HttpError(403, '只有自己看得到誰看過');
  const r = await c.env.DB.prepare('SELECT u.id, u.name, u.handle, u.avatar_key, u.is_content FROM story_views v JOIN users u ON u.id = v.user_id WHERE v.story_id = ? AND v.user_id != ? ORDER BY v.created_at DESC LIMIT 200').bind(c.req.param('id'), u.id).all();
  return c.json({ users: r.results.map(pubUser) });
});

features.delete('/stories/:id', async (c) => {
  const u = requireUser(c);
  const s = await c.env.DB.prepare('SELECT user_id, image_key FROM stories WHERE id = ?').bind(c.req.param('id')).first<any>();
  if (!s) throw new HttpError(404, '找不到這則動態');
  if (s.user_id !== u.id && u.role !== 'gm') throw new HttpError(403, '沒有權限');
  await deleteStories(c.env, [{ id: c.req.param('id'), image_key: s.image_key }]);
  return c.json({ ok: true });
});

async function deleteStories(env: Env, list: { id: string; image_key: string | null }[]) {
  for (const s of list) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM stories WHERE id = ?').bind(s.id),
      env.DB.prepare('DELETE FROM story_views WHERE story_id = ?').bind(s.id),
    ]);
    if (s.image_key) {
      await env.IMAGES.delete(s.image_key);
      await env.DB.prepare('DELETE FROM uploads WHERE key = ?').bind(s.image_key).run();
    }
  }
}
/** 排程：清掉過期的限時動態（連圖片） */
export async function cleanupStories(env: Env) {
  const r = await env.DB.prepare('SELECT id, image_key FROM stories WHERE expires_at < ? LIMIT 200').bind(now()).all<{ id: string; image_key: string | null }>();
  await deleteStories(env, r.results);
}

// ======================= 分類版（只有官方，GM 管理） =======================
const pubBoard = (x: any) => ({
  id: x.id, slug: x.slug, name: x.name, description: x.description, icon: x.icon, post_count: x.post_count, content_group: x.content_group,
});

features.get('/communities', async (c) => {
  const r = await c.env.DB.prepare('SELECT * FROM communities ORDER BY created_at, name LIMIT 200').all();
  return c.json({ communities: r.results.map(pubBoard) });
});

async function findBoard(c: any) {
  const x = await c.env.DB.prepare('SELECT * FROM communities WHERE slug = ?').bind(c.req.param('slug')).first();
  if (!x) throw new HttpError(404, '找不到這個分類版');
  return x;
}

features.get('/communities/:slug', async (c) => {
  const x: any = await findBoard(c);
  const before = Number(c.req.query('before') || 0);
  const [vis, vb] = await visibility(c);
  const r = await c.env.DB.prepare(
    `SELECT ${POST_COLS} FROM posts p JOIN users u ON u.id = p.user_id WHERE ${vis} AND p.community_id = ? ${before ? 'AND p.created_at < ?' : ''} ORDER BY p.created_at DESC LIMIT 20`
  ).bind(...vb, x.id, ...(before ? [before] : [])).all();
  return c.json({ community: pubBoard(x), posts: await serializeMany(c, r.results) });
});

function requireGm(c: any) {
  const u = requireUser(c);
  if (u.role !== 'gm') throw new HttpError(403, '只有 GM 可以管理分類版');
  return u;
}
function boardInput(b: any) {
  const name = String(b.name || '').trim().slice(0, 20);
  const description = String(b.description || '').trim().slice(0, 200);
  const icon = Array.from(String(b.icon || '💬').trim())[0] || '💬';
  const group = ['news', 'game', 'mixed', 'fun'].includes(b.content_group) ? b.content_group : null;
  if (name.length < 2) throw new HttpError(400, '分類版名稱至少 2 個字');
  return { name, description, icon, group };
}

/** GM 新增分類版 */
features.post('/communities', async (c) => {
  const u = requireGm(c);
  const b = await c.req.json<any>();
  const { name, description, icon, group } = boardInput(b);
  const slug = String(b.slug || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{2,24}$/.test(slug)) throw new HttpError(400, '網址代號只能用 2～24 個英文小寫、數字或 -');
  const dup = await c.env.DB.prepare('SELECT 1 FROM communities WHERE slug = ? OR name = ?').bind(slug, name).first();
  if (dup) throw new HttpError(400, '這個名稱或網址代號已經有了');
  const id = 'cm_' + newId().slice(0, 12);
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO communities (id, slug, name, description, icon, official, content_group, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)').bind(id, slug, name, description, icon, group, now()),
    c.env.DB.prepare('INSERT INTO audit_log (id, gm_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(newId(), u.id, 'board_create', id, name, now()),
  ]);
  return c.json({ id, slug });
});

/** GM 修改分類版 */
features.patch('/communities/:slug', async (c) => {
  const u = requireGm(c);
  const x: any = await findBoard(c);
  const { name, description, icon, group } = boardInput({ ...x, ...(await c.req.json<any>()) });
  const dup = await c.env.DB.prepare('SELECT 1 FROM communities WHERE name = ? AND id != ?').bind(name, x.id).first();
  if (dup) throw new HttpError(400, '這個名稱已經有了');
  if (group) await c.env.DB.prepare('UPDATE communities SET content_group = NULL WHERE content_group = ? AND id != ?').bind(group, x.id).run();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE communities SET name = ?, description = ?, icon = ?, content_group = ? WHERE id = ?').bind(name, description, icon, group, x.id),
    c.env.DB.prepare('INSERT INTO audit_log (id, gm_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(newId(), u.id, 'board_edit', x.id, name, now()),
  ]);
  return c.json({ ok: true });
});

/** GM 刪除分類版：文章移到「暢所欲言」 */
features.delete('/communities/:slug', async (c) => {
  const u = requireGm(c);
  const x: any = await findBoard(c);
  if (x.id === DEFAULT_BOARD) throw new HttpError(400, '「暢所欲言」是預設分類版，不能刪除');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE communities SET post_count = post_count + ? WHERE id = ?').bind(x.post_count, DEFAULT_BOARD),
    c.env.DB.prepare('UPDATE posts SET community_id = ? WHERE community_id = ?').bind(DEFAULT_BOARD, x.id),
    c.env.DB.prepare('DELETE FROM communities WHERE id = ?').bind(x.id),
    c.env.DB.prepare('INSERT INTO audit_log (id, gm_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(newId(), u.id, 'board_delete', x.id, x.name, now()),
  ]);
  return c.json({ ok: true });
});

export const DEFAULT_BOARD = 'cm_free';

// ======================= 每日熱門投票 =======================
features.get('/daily-poll', async (c) => {
  const [vis, vb] = await visibility(c, { forHot: true });
  const r = await c.env.DB.prepare(`SELECT ${POST_COLS} FROM posts p JOIN users u ON u.id = p.user_id WHERE ${vis} AND p.is_daily = 1 AND p.created_at > ? ORDER BY p.created_at DESC LIMIT 1`)
    .bind(...vb, now() - 36 * 3600_000).all();
  const [post] = await serializeMany(c, r.results);
  return c.json({ post: post ?? null });
});

const FALLBACK_POLLS: [string, string[]][] = [
  ['週末最想窩在哪裡？', ['家裡沙發', '咖啡廳', '戶外走走', '棉被裡']],
  ['宵夜首選是？', ['鹹酥雞', '泡麵', '滷味', '不吃宵夜']],
  ['夏天最受不了的是？', ['熱到流汗', '蚊子', '午後雷陣雨', '冷氣電費']],
  ['手搖飲甜度你都點？', ['無糖', '微糖', '半糖', '全糖']],
  ['早餐你都吃什麼？', ['蛋餅', '飯糰', '吐司', '不吃早餐']],
  ['假日最常做的事？', ['睡到自然醒', '追劇', '出門玩', '打電動']],
  ['你是哪一派？', ['貓派', '狗派', '都愛', '都不養']],
  ['通勤時你都在？', ['滑手機', '聽音樂', '補眠', '看風景']],
  ['火鍋湯底選？', ['麻辣', '昆布', '酸菜白肉', '牛奶']],
  ['最想去的國內旅遊地點？', ['花東', '墾丁', '澎湖', '合歡山']],
];

/** 排程：每天台灣時間 10 點由 ✦ 帳號發一題全站投票 */
/** 議題投票：只問「在意哪些議題、怎麼做決定」，不提任何候選人或政黨，每天中午一題，發在政治議題版 */
const ISSUE_POLLS: [string, string[]][] = [
  ['這次地方選舉，你最在意哪個議題？', ['交通建設', '房價居住', '治安', '長照與醫療', '教育與托育']],
  ['你通常怎麼決定要投給誰？', ['看政見', '看過去政績', '看政黨', '看辯論表現', '還沒決定']],
  ['你主要從哪裡得到選舉資訊？', ['電視新聞', '網路新聞', '社群平台', '親友討論', '政見發表會']],
  ['你覺得政見發表會有幫助嗎？', ['很有幫助', '有一點', '沒什麼幫助', '從來沒看過']],
  ['怎麼做最能提高年輕人投票率？', ['不在籍投票', '更多網路資訊', '政見貼近年輕人', '投票日交通補助', '其他']],
  ['你這次會回戶籍地投票嗎？', ['會', '不會', '還在考慮', '戶籍就在住的地方']],
  ['選舉期間最讓你受不了的是？', ['宣傳車太吵', '假訊息', '互相抹黑', '旗幟看板太多', '都還好']],
  ['你希望你住的城市優先改善什麼？', ['大眾運輸', '公園綠地', '停車問題', '人行道安全', '空氣品質']],
];
export async function runIssuePoll(env: Env, force = false) {
  const s = await getSettings(env.DB);
  if (!force && (s.issue_poll === '0' || s.content_enabled !== '1')) return { skipped: '議題投票已關閉' };
  const board = await env.DB.prepare("SELECT id FROM communities WHERE slug = 'politics'").first<{ id: string }>();
  if (!board) return { skipped: '沒有政治議題版' };
  const todayStart = (() => { const d = new Date(Date.now() + 8 * 3600_000); d.setUTCHours(0, 0, 0, 0); return d.getTime() - 8 * 3600_000; })();
  if (!force && (await env.DB.prepare("SELECT 1 FROM posts WHERE community_id = ? AND text LIKE '【議題投票】%' AND created_at >= ?").bind(board.id, todayStart).first())) return { skipped: '今天已經發過' };
  const done = (await env.DB.prepare("SELECT text FROM posts WHERE text LIKE '【議題投票】%'").all<{ text: string }>()).results.map((r) => r.text);
  const left = ISSUE_POLLS.filter(([q]) => !done.some((t) => t.includes(q)));
  const [question, options] = (left.length ? left : ISSUE_POLLS)[Math.floor(Math.random() * (left.length || ISSUE_POLLS.length))];
  const a = await env.DB.prepare("SELECT id FROM users WHERE is_content = 1 AND content_enabled = 1 AND content_group IN ('news', 'mixed') ORDER BY RANDOM() LIMIT 1").first<{ id: string }>();
  if (!a) return { skipped: '沒有可用的內容帳號' };
  const id = newId();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO posts (id, user_id, text, community_id, source, created_at) VALUES (?, ?, ?, ?, 'content', ?)").bind(id, a.id, `【議題投票】${question}\n投完歡迎留言說說你的理由，理性討論 🙏\n#議題投票`, board.id, now()),
    env.DB.prepare('INSERT INTO polls (post_id, ends_at) VALUES (?, ?)').bind(id, now() + 3 * 86400_000),
    ...options.map((o, i) => env.DB.prepare('INSERT INTO poll_options (post_id, idx, text) VALUES (?, ?, ?)').bind(id, i, o)),
    env.DB.prepare('UPDATE communities SET post_count = post_count + 1 WHERE id = ?').bind(board.id),
  ]);
  return { posted: id, question };
}

export async function runDailyPoll(env: Env, force = false) {
  const s = await getSettings(env.DB);
  if (!force && (s.daily_poll === '0' || s.content_enabled !== '1')) return { skipped: '每日投票已關閉' };
  const todayStart = (() => { const d = new Date(Date.now() + 8 * 3600_000); d.setUTCHours(0, 0, 0, 0); return d.getTime() - 8 * 3600_000; })();
  if (!force) {
    const done = await env.DB.prepare('SELECT 1 FROM posts WHERE is_daily = 1 AND created_at >= ?').bind(todayStart).first();
    if (done) return { skipped: '今天已經發過' };
  }
  const a = await env.DB.prepare("SELECT id, name, persona FROM users WHERE is_content = 1 AND content_enabled = 1 AND content_group IN ('mixed', 'fun') ORDER BY RANDOM() LIMIT 1").first<any>();
  if (!a) return { skipped: '沒有可用的內容帳號' };
  let question = '', options: string[] = [];
  const out = await generate(env, `${BASE_RULES}\n你的帳號名稱是「${a.name}」，主題與個性：${a.persona}。`,
    `出一題輕鬆有趣、大家都能參與的生活投票（不要政治、宗教、敏感議題）。
格式固定如下，不要加其他文字：
題目：（一句話，20 字以內）
1. 選項（10 字以內）
2. 選項
3. 選項
4. 選項`, 200, s.ai_model || env.AI_MODEL);
  if (out) {
    const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
    question = (lines.find((l) => /^題目[:：]/.test(l)) || '').replace(/^題目[:：]\s*/, '').slice(0, 40);
    options = lines.filter((l) => /^\d[.、)]/.test(l)).map((l) => l.replace(/^\d[.、)]\s*/, '').slice(0, 40)).filter(Boolean).slice(0, 5);
    options = [...new Set(options)];
  }
  if (!question || options.length < 2) [question, options] = FALLBACK_POLLS[Math.floor(Math.random() * FALLBACK_POLLS.length)];
  const id = newId();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO posts (id, user_id, text, source, is_daily, created_at) VALUES (?, ?, ?, 'content', 1, ?)").bind(id, a.id, `【今日投票】${question}\n#每日投票`, now()),
    env.DB.prepare('INSERT INTO polls (post_id, ends_at) VALUES (?, ?)').bind(id, now() + 86400_000),
    ...options.map((o, i) => env.DB.prepare('INSERT INTO poll_options (post_id, idx, text) VALUES (?, ?, ?)').bind(id, i, o)),
    env.DB.prepare('UPDATE users SET last_posted_at = ? WHERE id = ?').bind(now(), a.id),
  ]);
  await logContent(env.DB, 'post', a.id, `每日投票：${question}`);
  return { posted: id, question };
}

// ======================= 徽章 =======================
export const BADGES: Record<string, { label: string; icon: string; desc: string }> = {
  gm: { label: '管理團隊', icon: '🛡️', desc: '窩Woo！管理團隊成員' },
  founder: { label: '開站元老', icon: '🏅', desc: '前 100 位加入窩Woo！的真人用戶' },
  early: { label: '早期住戶', icon: '🌱', desc: '前 1000 位加入窩Woo！的用戶' },
  replier: { label: '熱心回覆', icon: '💬', desc: '留言超過 100 則' },
  popular: { label: '人氣作者', icon: '⭐', desc: '文章累積超過 300 個真人讚' },
  pollster: { label: '投票達人', icon: '📊', desc: '發起超過 10 次投票' },
};

export async function badgesFor(env: Env, u: User) {
  if (u.is_content) return [];
  const q = (sql: string, ...b: any[]) => env.DB.prepare(sql).bind(...b).first<{ n: number }>().then((r) => r?.n ?? 0);
  const [rank, comments, likes, polls] = await Promise.all([
    q("SELECT COUNT(*) AS n FROM users WHERE is_content = 0 AND role != 'gm' AND created_at < ?", u.created_at),
    q('SELECT COUNT(*) AS n FROM comments WHERE user_id = ?', u.id),
    q('SELECT COALESCE(SUM(real_like_count), 0) AS n FROM posts WHERE user_id = ?', u.id),
    q('SELECT COUNT(*) AS n FROM polls pl JOIN posts p ON p.id = pl.post_id WHERE p.user_id = ?', u.id),
  ]);
  const keys: string[] = [];
  if (u.role === 'gm') keys.push('gm');
  if (rank < 100 && u.role !== 'gm') keys.push('founder');
  else if (rank < 1000) keys.push('early');
  if (comments >= 100) keys.push('replier');
  if (likes >= 300) keys.push('popular');
  if (polls >= 10) keys.push('pollster');
  return keys.map((k) => (k === 'founder' ? { key: k, ...BADGES[k], label: `開站元老 #${rank + 1}` } : { key: k, ...BADGES[k] }));
}
