import type { Env } from './env';
import { now } from './env';

/** ✦ 帳號分享影片用的 YouTube 頻道（官方頻道的公開 RSS，不需要金鑰） */
export interface Channel { id: string; name: string; group: 'game' | 'tech' | 'news' | 'finance' | 'ent'; only?: RegExp }
export const DEFAULT_CHANNELS: Channel[] = [
  { id: 'UC6VcWc1rAoWdBCM0JxrRQ3A', name: 'Rockstar Games', group: 'game' },
  { id: 'UCKy1dAqELo0zrOtPkf0eTMw', name: 'IGN', group: 'game' },
  { id: 'UCaMwSZ3PzkOGZtaspPbKlkg', name: '巴哈姆特 GNN', group: 'game' },
  { id: 'UCb6QDBuxtoIP8kT4cO5BX0A', name: '4Gamers', group: 'game' },
  { id: 'UC_ErhNjgkPOA9Kuahcj-iTA', name: 'NVIDIA Taiwan', group: 'tech' },
  { id: 'UCHuiy8bXnmK5nisYHUd1J5g', name: 'NVIDIA', group: 'tech' },
  { id: 'UC5nwNW4KdC0SzrhF9BXEYOQ', name: 'TVBS NEWS', group: 'news' },
  { id: 'UCexpzYDEnfmAvPSfG4xbcjA', name: '公視新聞網', group: 'news' },
  { id: 'UCWLpLjjiDrH8gkOUJmB7DSw', name: '中央社', group: 'news' },
  { id: 'UCYIVkruUoN04UjV9pkBTswg', name: '非凡電視', group: 'finance' },
  // GTA 攻略、心得頻道：只收標題跟 GTA 有關的影片
  { id: 'UCuWcjpKbIDAbZfHoru1toFg', name: 'GTA Series Videos', group: 'game', only: /GTA|Grand Theft Auto/i },
  { id: 'UCcZ3sRk9z6jjgfYQbMGTpig', name: 'Broughy1322', group: 'game', only: /GTA|Grand Theft Auto/i },
  { id: 'UChLDRvS2OeJ0f5Xi2j7uofA', name: 'TGG', group: 'game', only: /GTA|Grand Theft Auto/i },
  { id: 'UCWBA1-H9A5IldSb3tNwQmtQ', name: 'PowerPyx', group: 'game', only: /GTA|Grand Theft Auto/i },
  { id: 'UC0PMQXAwF6O6aeTpv962miA', name: 'MrBossFTW', group: 'game', only: /GTA|Grand Theft Auto/i },
  { id: 'UC8sFtiTkQ3Sduf3-7TqFNhQ', name: 'gtagram', group: 'game', only: /GTA|Grand Theft Auto/i },
  { id: 'UCCcYXmK1yjh_34e_-WwWwVw', name: 'Speirs Gaming', group: 'game', only: /GTA|Grand Theft Auto/i },
  { id: 'UC1PhTs67PPip_Ys0_xmk8Bg', name: 'GhillieMaster', group: 'game', only: /GTA|Grand Theft Auto/i },
  { id: 'UCbu2SsF-Or3Rsn3NxqODImw', name: 'GameSpot', group: 'game', only: /GTA|Grand Theft Auto/i },
  { id: 'UC-2Y8dQb0S6DtpxNgAKoJKA', name: 'PlayStation', group: 'game', only: /GTA|Grand Theft Auto/i },
  { id: 'UC9sbkOLjDXRdxhF7VpHG-cQ', name: 'PlayStation Taiwan', group: 'game' },
  { id: 'UC3IZKseVpdzPSBaWxBxundA', name: 'HYBE LABELS', group: 'ent' },
  { id: 'UCLkAepWjdylmXSltofFvsYQ', name: 'BANGTANTV', group: 'ent' },
  { id: 'UCzw-C7fNfs018R1FzIKnlaA', name: 'BIGBANG', group: 'ent' },
  { id: 'UCeU5qTuBiqTU5z-hyL6WITQ', name: 'OfficialGDRAGON', group: 'ent' },
  { id: 'UCOmHUn--16B90oW2L6FRR3A', name: 'BLACKPINK', group: 'ent' },
  { id: 'UCEf_Bc-KVd7onSeifS3py9g', name: 'SMTOWN', group: 'ent' },
  { id: 'UCaO6TYtlC8U5ttz62hTrZgg', name: 'JYP Entertainment', group: 'ent' },
  { id: 'UCbD8EppRX3ZwJSou-TVo90A', name: 'Mnet K-POP', group: 'ent' },
  { id: 'UCX157UE-NdaUGQJDkQ-XKnw', name: 'ETtoday星光雲', group: 'ent' },
  { id: 'UCmyVDKnXwdw3McUlcijqmvQ', name: '東森娛樂', group: 'ent' },
  { id: 'UCRXiA3h1no_PFkb1JCP0yMA', name: 'Vogue', group: 'ent' },
];

export interface Video { id: string; title: string; channel: string; grp: string }

function decode(s: string) {
  return s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

/** 每 30 分鐘抓一次各頻道最新影片，存進 video_cache（同一部影片只存一次） */
export async function fetchVideos(env: Env, channels: Channel[] = DEFAULT_CHANNELS, report?: string[]) {
  let added = 0;
  for (const ch of channels) {
    try {
      const r = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`, { headers: { 'User-Agent': 'WooBot/1.0 (+https://wootw.com)' } });
      if (!r.ok) { report?.push(`${ch.name}: HTTP ${r.status}`); continue; }
      const xml = await r.text();
      const entries = xml.split('<entry>').slice(1, 8);
      const stmts = entries.map((e) => {
        const id = e.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/)?.[1];
        const title = decode(e.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '');
        const pub = Date.parse(e.match(/<published>([^<]+)<\/published>/)?.[1] || '') || now();
        // 跳過短片（#shorts）與太舊的影片（超過 5 天）
        if (!id || !title || /#shorts/i.test(title) || now() - pub > 5 * 86400_000 || (ch.only && !ch.only.test(title))) return null;
        return env.DB.prepare('INSERT OR IGNORE INTO video_cache (id, title, channel, grp, published_at, fetched_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, title.slice(0, 200), ch.name, ch.group, pub, now());
      }).filter(Boolean) as D1PreparedStatement[];
      let got = 0;
      if (stmts.length) { const res = await env.DB.batch(stmts); got = res.reduce((n, x) => n + (x.meta.changes || 0), 0); added += got; }
      report?.push(`${ch.name}: ${entries.length} 部、可用 ${stmts.length}、新增 ${got}`);
    } catch (e) { report?.push(`${ch.name}: ${String(e)}`); console.log('fetchVideos', ch.name, String(e)); }
  }
  await env.DB.prepare('DELETE FROM video_cache WHERE fetched_at < ?').bind(now() - 10 * 86400_000).run();
  return added;
}

/** 依帳號類型挑一部還沒分享過的影片；標題有熱門關鍵字的優先 */
export async function takeVideo(env: Env, groups: string[], keywords: string[]): Promise<Video | null> {
  const ph = groups.map(() => '?').join(',');
  // 同一部影片（或同標題的重複上傳）只分享一次
  const rows = (await env.DB.prepare(`SELECT id, title, channel, grp FROM video_cache v WHERE used = 0 AND grp IN (${ph}) AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.link_title = v.title OR p.link_url = 'https://www.youtube.com/watch?v=' || v.id) ORDER BY published_at DESC LIMIT 30`).bind(...groups).all<Video>()).results;
  if (!rows.length) return null;
  const hot = rows.filter((v) => keywords.some((k) => k && v.title.toLowerCase().includes(k.toLowerCase())));
  const pool = hot.length && Math.random() < 0.7 ? hot : rows;
  const v = pool[Math.floor(Math.random() * Math.min(pool.length, 8))];
  const r = await env.DB.prepare('UPDATE video_cache SET used = 1 WHERE id = ? AND used = 0').bind(v.id).run();
  return r.meta.changes ? v : null;
}
