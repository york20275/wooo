import type { Env } from './env';

/** 分享預覽：讓貼文、個人頁、相簿的連結在 LINE、臉書、Threads 上顯示標題、摘要與圖片 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s: string, n: number) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

interface Meta { title: string; description: string; image: string | null; type?: string; jsonld?: any; body?: string }

async function metaFor(env: Env, path: string): Promise<Meta | null> {
  let m: RegExpMatchArray | null;
  if ((m = path.match(/^\/p\/([\w]+)$/))) {
    const p = await env.DB.prepare(
      "SELECT p.text, p.title, p.kind, p.image_key, p.sensitive, p.created_at, p.like_count, p.comment_count, u.name, u.is_content FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ? AND p.hidden = 0 AND u.status != 'banned'"
    ).bind(m[1]).first<any>();
    if (!p) return null;
    if (p.sensitive) return { title: `${p.name} 在窩Woo！`, description: '這篇文章含敏感內容，需登入並完成年齡驗證才能查看。', image: null, type: 'article' };
    const title = p.kind === 'blog' && p.title ? `${p.title}｜${p.name}` : `${p.name}${p.is_content ? ' ✦' : ''} 在窩Woo！`;
    return {
      title,
      description: clip(p.text || '（圖片）', 140),
      image: p.image_key ? `/img/${p.image_key}` : null,
      type: 'article',
      jsonld: { '@context': 'https://schema.org', '@type': 'DiscussionForumPosting', headline: clip(p.title || p.text || '窩Woo！文章', 100), text: clip(p.text || '', 1000), author: { '@type': 'Person', name: p.name }, datePublished: new Date(p.created_at).toISOString(), interactionStatistic: [{ '@type': 'InteractionCounter', interactionType: 'https://schema.org/LikeAction', userInteractionCount: p.like_count }, { '@type': 'InteractionCounter', interactionType: 'https://schema.org/CommentAction', userInteractionCount: p.comment_count }] },
      body: `<article><h1>${esc(title)}</h1><p>${esc(p.text || '')}</p></article>`,
    };
  }
  if ((m = path.match(/^\/u\/([\w]+)$/))) {
    const u = await env.DB.prepare("SELECT name, handle, bio, avatar_key, banner_key FROM users WHERE handle = ? AND status != 'banned'").bind(m[1]).first<any>();
    if (!u) return null;
    return { title: `${u.name}（@${u.handle}）｜窩Woo！`, description: clip(u.bio || `來窩Woo！看看 ${u.name} 的日常`, 140), image: u.banner_key ? `/img/${u.banner_key}` : u.avatar_key ? `/img/${u.avatar_key}` : null, type: 'profile' };
  }
  if ((m = path.match(/^\/album\/([\w]+)$/))) {
    const a = await env.DB.prepare(
      "SELECT a.title, a.description, a.sensitive, u.name, (SELECT image_key FROM album_photos ph WHERE ph.album_id = a.id ORDER BY ph.created_at LIMIT 1) AS cover FROM albums a JOIN users u ON u.id = a.user_id WHERE a.id = ?"
    ).bind(m[1]).first<any>();
    if (!a) return null;
    return { title: `${a.title}｜${a.name} 的相簿`, description: a.sensitive ? '這本相簿含敏感內容。' : clip(a.description || '窩Woo！相簿', 140), image: !a.sensitive && a.cover ? `/img/${a.cover}` : null };
  }
  if ((m = path.match(/^\/c\/([a-z0-9-]+)$/))) {
    const c = await env.DB.prepare('SELECT id, name, description, icon FROM communities WHERE slug = ?').bind(m[1]).first<any>();
    if (!c) return null;
    const posts = await env.DB.prepare("SELECT p.text, u.name FROM posts p JOIN users u ON u.id = p.user_id WHERE p.community_id = ? AND p.hidden = 0 AND p.sensitive = 0 AND u.status != 'banned' ORDER BY p.created_at DESC LIMIT 20").bind(c.id).all<any>();
    return {
      title: `${c.icon} ${c.name}｜窩Woo！分類版`,
      description: clip(`${c.description || c.name}。在窩Woo！暢所欲言，不怕被亂刪。`, 140),
      image: null,
      body: `<h1>${esc(c.name)}</h1><p>${esc(c.description || '')}</p><ul>${posts.results.map((x: any) => `<li>${esc(x.name)}：${esc(clip(x.text || '', 120))}</li>`).join('')}</ul>`,
    };
  }
  if ((m = path.match(/^\/tag\/(.+)$/))) {
    const tag = decodeURIComponent(m[1]).slice(0, 20);
    return { title: `#${tag}｜窩Woo！`, description: `窩Woo！上關於 #${tag} 的文章`, image: null };
  }
  return null;
}

export async function withOg(env: Env, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const page = await env.ASSETS.fetch(new Request(new URL('/index.html', url.origin).toString(), { headers: req.headers }));
  let meta: Meta | null = null;
  try { meta = await metaFor(env, url.pathname); } catch {}
  if (!meta) return page;
  const img = new URL(meta.image || '/og.png', url.origin).toString();
  const tags = [
    `<meta property="og:site_name" content="窩Woo！">`,
    `<meta property="og:type" content="${meta.type || 'website'}">`,
    `<meta property="og:title" content="${esc(meta.title)}">`,
    `<meta property="og:description" content="${esc(meta.description)}">`,
    `<meta property="og:image" content="${esc(img)}">`,
    `<meta property="og:url" content="${esc(url.origin + url.pathname)}">`,
    `<meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="description" content="${esc(meta.description)}">`,
    `<link rel="canonical" href="${esc(url.origin + url.pathname)}">`,
    meta.jsonld ? `<script type="application/ld+json">${JSON.stringify(meta.jsonld).replace(/</g, '\\u003c')}</script>` : '',
  ].join('');
  return new HTMLRewriter()
    .on('title', { element(e) { e.setInnerContent(meta!.title); } })
    .on('meta[name="description"]', { element(e) { e.remove(); } })
    .on('meta[property^="og:"]', { element(e) { e.remove(); } })
    .on('link[rel="canonical"]', { element(e) { e.remove(); } })
    .on('head', { element(e) { e.append(tags, { html: true }); } })
    // 給搜尋引擎與不執行 JavaScript 的爬蟲看的文字內容（跟畫面上顯示的是同一份）
    .on('body', { element(e) { if (meta!.body) e.prepend(`<noscript>${meta!.body}</noscript>`, { html: true }); } })
    .transform(new Response(page.body, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' } }));
}

/** robots.txt */
export function robots(origin: string) {
  return `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\nDisallow: /auth/\nDisallow: /settings\nDisallow: /messages\nDisallow: /notifications\n\nSitemap: ${origin}/sitemap.xml\n`;
}

/** sitemap.xml：首頁、分類版、透明度報告、最近的公開文章與活躍用戶 */
export async function sitemap(env: Env, origin: string) {
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  const urls: { loc: string; lastmod?: string; freq?: string; pri?: string }[] = [
    { loc: '/', freq: 'hourly', pri: '1.0' },
    { loc: '/communities', freq: 'daily', pri: '0.8' },
    { loc: '/explore', freq: 'hourly', pri: '0.7' },
    { loc: '/about', freq: 'monthly', pri: '0.5' },
    { loc: '/transparency', freq: 'weekly', pri: '0.6' },
  ];
  const boards = await env.DB.prepare('SELECT slug FROM communities').all<any>();
  for (const b of boards.results) urls.push({ loc: `/c/${b.slug}`, freq: 'hourly', pri: '0.8' });
  const posts = await env.DB.prepare(
    "SELECT p.id, p.created_at FROM posts p JOIN users u ON u.id = p.user_id WHERE p.hidden = 0 AND p.sensitive = 0 AND p.kind != 'repost' AND u.status = 'active' ORDER BY p.created_at DESC LIMIT 2000"
  ).all<any>();
  for (const p of posts.results) urls.push({ loc: `/p/${p.id}`, lastmod: day(p.created_at), freq: 'weekly', pri: '0.6' });
  const users = await env.DB.prepare("SELECT handle FROM users WHERE status = 'active' AND is_content = 0 ORDER BY last_seen_at DESC LIMIT 500").all<any>();
  for (const u of users.results) urls.push({ loc: `/u/${u.handle}`, freq: 'daily', pri: '0.4' });
  const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${x(origin + u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}${u.freq ? `<changefreq>${u.freq}</changefreq>` : ''}${u.pri ? `<priority>${u.pri}</priority>` : ''}</url>`).join('\n')}\n</urlset>`;
}
