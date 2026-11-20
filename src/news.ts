import type { Env } from './env';
import { getSetting, logContent, now } from './env';

export interface NewsItem { url: string; title: string; source: string; description: string }

function strip(s: string): string {
  return s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

async function fromNewsData(key: string): Promise<NewsItem[]> {
  const url = `https://newsdata.io/api/1/latest?apikey=${encodeURIComponent(key)}&country=tw&language=zh`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NewsData HTTP ${res.status}`);
  const j: any = await res.json();
  return (j.results || [])
    .filter((r: any) => r.link && r.title)
    .map((r: any) => ({
      url: r.link,
      title: strip(r.title),
      source: r.source_name || r.source_id || new URL(r.link).hostname,
      description: strip(r.description || '').slice(0, 600),
    }));
}

async function fromRss(feed: string): Promise<NewsItem[]> {
  const res = await fetch(feed, { headers: { 'user-agent': 'WoooBot/1.0' } });
  if (!res.ok) throw new Error(`RSS HTTP ${res.status}`);
  const xml = await res.text();
  const items: NewsItem[] = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)) {
    const block = m[0];
    const get = (tag: string) => { const x = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`)); return x ? strip(x[1]) : ''; };
    const link = get('link');
    const title = get('title');
    if (!link || !title) continue;
    const src = get('source') || (() => { try { return new URL(link).hostname; } catch { return ''; } })();
    items.push({ url: link, title, source: src, description: get('description').slice(0, 600) });
    if (items.length >= 20) break;
  }
  return items;
}

/** 從 NewsData.io 與 RSS 抓新聞存進快取，回傳新增筆數 */
export async function fetchNews(env: Env): Promise<number> {
  const key = (await getSetting(env.DB, 'newsdata_key', '')) || env.NEWSDATA_API_KEY || '';
  let feeds: string[] = [];
  try { feeds = JSON.parse(await getSetting(env.DB, 'rss_feeds', '[]')); } catch {}
  const all: NewsItem[] = [];
  if (key) {
    try { all.push(...(await fromNewsData(key))); } catch (e) { await logContent(env.DB, 'error', null, `NewsData：${e}`); }
  }
  for (const f of feeds) {
    try { all.push(...(await fromRss(f))); } catch (e) { await logContent(env.DB, 'error', null, `RSS ${f}：${e}`); }
  }
  let added = 0;
  for (const n of all) {
    const r = await env.DB.prepare('INSERT OR IGNORE INTO news_cache (url, title, source, description, fetched_at) VALUES (?, ?, ?, ?, ?)')
      .bind(n.url, n.title.slice(0, 200), (n.source || '').slice(0, 60), n.description, now()).run();
    if (r.meta.changes) added++;
  }
  // 清掉 7 天前的快取
  await env.DB.prepare('DELETE FROM news_cache WHERE fetched_at < ?').bind(now() - 7 * 86400_000).run();
  if (all.length) await logContent(env.DB, 'news', null, `抓到 ${all.length} 則，新增 ${added} 則`);
  return added;
}

export async function takeNews(env: Env): Promise<NewsItem | null> {
  const r = await env.DB.prepare('SELECT url, title, source, description FROM news_cache WHERE used = 0 AND fetched_at > ? ORDER BY fetched_at DESC LIMIT 1')
    .bind(now() - 36 * 3600_000).first<NewsItem>();
  if (!r) return null;
  await env.DB.prepare('UPDATE news_cache SET used = 1 WHERE url = ?').bind(r.url).run();
  return r;
}
