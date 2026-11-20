import type { Env } from './env';

/** 分享預覽：讓貼文、個人頁、相簿的連結在 LINE、臉書、Threads 上顯示標題、摘要與圖片 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s: string, n: number) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

interface Meta { title: string; description: string; image: string | null; type?: string }

async function metaFor(env: Env, path: string): Promise<Meta | null> {
  let m: RegExpMatchArray | null;
  if ((m = path.match(/^\/p\/([\w]+)$/))) {
    const p = await env.DB.prepare(
      "SELECT p.text, p.title, p.kind, p.image_key, p.sensitive, u.name, u.is_content FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ? AND p.hidden = 0 AND u.status != 'banned'"
    ).bind(m[1]).first<any>();
    if (!p) return null;
    if (p.sensitive) return { title: `${p.name} 在窩Wooo！`, description: '這篇文章含敏感內容，需登入並完成年齡驗證才能查看。', image: null, type: 'article' };
    return {
      title: p.kind === 'blog' && p.title ? `${p.title}｜${p.name}` : `${p.name}${p.is_content ? ' ✦' : ''} 在窩Wooo！`,
      description: clip(p.text || '（圖片）', 140),
      image: p.image_key ? `/img/${p.image_key}` : null,
      type: 'article',
    };
  }
  if ((m = path.match(/^\/u\/([\w]+)$/))) {
    const u = await env.DB.prepare("SELECT name, handle, bio, avatar_key, banner_key FROM users WHERE handle = ? AND status != 'banned'").bind(m[1]).first<any>();
    if (!u) return null;
    return { title: `${u.name}（@${u.handle}）｜窩Wooo！`, description: clip(u.bio || `來窩Wooo！看看 ${u.name} 的日常`, 140), image: u.banner_key ? `/img/${u.banner_key}` : u.avatar_key ? `/img/${u.avatar_key}` : null, type: 'profile' };
  }
  if ((m = path.match(/^\/album\/([\w]+)$/))) {
    const a = await env.DB.prepare(
      "SELECT a.title, a.description, a.sensitive, u.name, (SELECT image_key FROM album_photos ph WHERE ph.album_id = a.id ORDER BY ph.created_at LIMIT 1) AS cover FROM albums a JOIN users u ON u.id = a.user_id WHERE a.id = ?"
    ).bind(m[1]).first<any>();
    if (!a) return null;
    return { title: `${a.title}｜${a.name} 的相簿`, description: a.sensitive ? '這本相簿含敏感內容。' : clip(a.description || '窩Wooo！相簿', 140), image: !a.sensitive && a.cover ? `/img/${a.cover}` : null };
  }
  if ((m = path.match(/^\/tag\/(.+)$/))) {
    const tag = decodeURIComponent(m[1]).slice(0, 20);
    return { title: `#${tag}｜窩Wooo！`, description: `窩Wooo！上關於 #${tag} 的文章`, image: null };
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
    `<meta property="og:site_name" content="窩Wooo！">`,
    `<meta property="og:type" content="${meta.type || 'website'}">`,
    `<meta property="og:title" content="${esc(meta.title)}">`,
    `<meta property="og:description" content="${esc(meta.description)}">`,
    `<meta property="og:image" content="${esc(img)}">`,
    `<meta property="og:url" content="${esc(url.origin + url.pathname)}">`,
    `<meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="description" content="${esc(meta.description)}">`,
  ].join('');
  return new HTMLRewriter()
    .on('title', { element(e) { e.setInnerContent(meta!.title); } })
    .on('meta[name="description"]', { element(e) { e.remove(); } })
    .on('meta[property^="og:"]', { element(e) { e.remove(); } })
    .on('head', { element(e) { e.append(tags, { html: true }); } })
    .transform(new Response(page.body, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' } }));
}
