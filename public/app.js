'use strict';
/* 窩Woo！前端（不需要建置工具的單頁應用程式） */

const S = { hotBoard: '', me: null, unread: 0, unreadMsg: 0, dev: false, feedTab: 'hot', turnstile: null, vapid: null, accents: [] };
const app = document.getElementById('app');

// ---------- 小工具 ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v; // 只用在程式內建的圖示
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const ICON = {
  home: '<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  heartFill: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" fill="currentColor"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m21 16-5-5-8 8"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/>',
  poll: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  repost: '<path d="M4 9V7a2 2 0 0 1 2-2h12l-3-3M20 15v2a2 2 0 0 1-2 2H6l3 3"/>',
  bookmark: '<path d="M6 4h12v17l-6-4-6 4z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
  hash: '<path d="M5 9h14M4 15h14M10 3 8 21M16 3l-2 18"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  eyeoff: '<path d="M3 3l18 18"/><path d="M10.6 6.1A10 10 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-3 3.6M6.4 7.4C4.2 9 3 12 3 12s4 6 9 6a9 9 0 0 0 3.6-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  pin: '<path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7"/>',
  send: '<path d="M4 12 20 4l-6 16-3-7z"/>',
};
const icon = (n, extra = '') => h('span', { html: `<svg class="i ${extra}" viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`, style: 'display:inline-flex' });

async function api(method, path, body) {
  const opt = { method, headers: {} };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const res = await fetch(path, opt);
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 428) { humanCheckModal(); }
  if (!res.ok) throw new Error(data.error || '發生錯誤，請稍後再試');
  return data;
}
function toast(msg) {
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}
function timeAgo(ts) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return '剛剛';
  if (s < 3600) return `${Math.floor(s / 60)} 分鐘`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小時`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} 天`;
  const d = new Date(ts);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
function avatar(u, size = '') {
  const inner = u.avatar_url ? h('img', { src: u.avatar_url, alt: '' }) : (u.name || '?').slice(0, 1);
  return h('a', { class: `avatar ${size}`, href: `/u/${u.handle}`, 'aria-label': `${u.name} 的個人頁` }, inner);
}
/** 文字轉成可點的 #標籤、@提及、網址（全部用文字節點組成，不用 innerHTML） */
function richText(text) {
  const frag = [];
  const re = /(#[\p{L}\p{N}_]{1,20})|(@[a-zA-Z0-9_]{3,30})|(https?:\/\/[^\s]+)/gu;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) frag.push(text.slice(last, m.index));
    if (m[1]) frag.push(h('a', { href: `/tag/${encodeURIComponent(m[1].slice(1))}` }, m[1]));
    else if (m[2]) frag.push(h('a', { href: `/u/${m[2].slice(1).toLowerCase()}` }, m[2]));
    else frag.push(h('a', { href: m[3], target: '_blank', rel: 'noopener nofollow ugc' }, m[3]));
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.push(text.slice(last));
  return frag;
}
function modal(title, ...content) {
  const bg = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg) close(); } });
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  bg.append(h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'row between' }, h('h2', null, title), h('button', { class: 'icon-btn', 'aria-label': '關閉', onclick: close }, icon('x'))), ...content));
  document.body.append(bg);
  document.addEventListener('keydown', onKey);
  bg.remove = ((orig) => () => { orig.call(bg); document.removeEventListener('keydown', onKey); })(bg.remove);
  return bg;
}
function needLogin() { modal('先登入吧', h('p', null, '用 Google 帳號就能登入窩Woo！，按讚、留言、發文。'), loginButton()); }
function loginButton() {
  const wrap = h('div', { class: 'row wrap' }, h('a', { class: 'btn', href: '/auth/google' }, '用 Google 登入'));
  if (S.dev) wrap.append(h('a', { class: 'btn ghost', href: '/auth/dev?email=tester@example.com&name=測試用戶' }, '測試登入（開發模式）'));
  return wrap;
}
function starButton() {
  const wrap = h('span', { style: 'position:relative;display:inline-flex' });
  const btn = h('button', { class: 'star', 'aria-label': '這個標記是什麼？', 'aria-expanded': 'false' }, '✦');
  btn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const open = wrap.querySelector('.tip');
    if (open) { open.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
    wrap.append(h('span', { class: 'tip', role: 'tooltip', style: 'left:0' }, '平台內容帳號'));
    btn.setAttribute('aria-expanded', 'true');
    setTimeout(() => { wrap.querySelector('.tip')?.remove(); btn.setAttribute('aria-expanded', 'false'); }, 2500);
  });
  wrap.append(btn);
  return wrap;
}
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('theme', t); } catch {}
}
/** 上傳前在瀏覽器縮圖並轉成 WebP，省空間又快 */
async function shrinkImage(f, max = 1600) {
  if (f.type === 'image/gif') return f;
  const bmp = await createImageBitmap(f).catch(() => null);
  if (!bmp) return f;
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.82));
  return blob && blob.size < f.size ? new File([blob], 'image.webp', { type: 'image/webp' }) : f;
}
async function uploadImage(file, max) {
  const fd = new FormData();
  fd.append('file', await shrinkImage(file, max), 'image');
  return api('POST', '/api/upload', fd);
}

// ---------- 人機驗證（Cloudflare Turnstile） ----------
let turnstileLoading = null;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  if (!turnstileLoading) turnstileLoading = new Promise((ok, fail) => {
    const s = h('script', { src: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', async: true });
    s.onload = ok; s.onerror = fail; document.head.append(s);
  });
  return turnstileLoading;
}
async function humanCheckModal() {
  if (!S.turnstile || document.querySelector('.human-check')) return;
  const box = h('div', { class: 'human-check' });
  const m = modal('請先完成人機驗證', h('p', { style: 'margin:0' }, '新帳號第一次發文、留言或傳私訊前，需要確認你不是機器人。'), box);
  try {
    await loadTurnstile();
    window.turnstile.render(box, {
      sitekey: S.turnstile,
      callback: async (token) => {
        try { await api('POST', '/api/human/verify', { token }); await loadMe(); m.remove(); toast('驗證完成，可以繼續了'); }
        catch (e) { toast(e.message); }
      },
    });
  } catch { box.append(h('span', { class: 'err' }, '人機驗證載入失敗，請重新整理頁面')); }
}

// ---------- 路由 ----------
const routes = [
  [/^\/$/, () => feedPage()],
  [/^\/explore$/, () => explorePage()],
  [/^\/notifications$/, () => notificationsPage()],
  [/^\/messages$/, () => messagesPage()],
  [/^\/messages\/(\w+)$/, (m) => conversationPage(m[1])],
  [/^\/settings$/, () => settingsPage()],
  [/^\/about$/, () => aboutPage()],
  [/^\/privacy$/, () => privacyPage()],
  [/^\/terms$/, () => termsPage()],
  [/^\/tag\/(.+)$/, (m) => tagPage(decodeURIComponent(m[1]))],
  [/^\/u\/(\w+)$/, (m) => profilePage(m[1], 'posts')],
  [/^\/u\/(\w+)\/(blog|albums)$/, (m) => profilePage(m[1], m[2])],
  [/^\/album\/(\w+)$/, (m) => albumPage(m[1])],
  [/^\/p\/(\w+)$/, (m) => postPage(m[1])],
  [/^\/admin(?:\/(\w+))?$/, (m) => (window.adminPage ? adminPage(m[1] || 'dashboard') : null)],
];
function navigate(path, replace = false) {
  if (replace) history.replaceState(null, '', path); else history.pushState(null, '', path);
  render();
  window.scrollTo(0, 0);
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a || a.target === '_blank' || a.hasAttribute('download') || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/img/') || url.pathname.startsWith('/api/')) return;
  e.preventDefault();
  navigate(url.pathname + url.search);
});
window.addEventListener('popstate', render);

// ---------- 外框 ----------
function header() {
  const q = h('input', { type: 'search', placeholder: '搜尋', 'aria-label': '搜尋' });
  const form = h('form', { class: 'search', role: 'search', onsubmit: (e) => { e.preventDefault(); if (q.value.trim()) navigate(`/explore?q=${encodeURIComponent(q.value.trim())}`); } }, icon('search'), q);
  const right = S.me ? avatar(S.me) : h('a', { class: 'btn small', href: '/auth/google' }, '登入');
  return h('header', { class: 'top' },
    h('a', { class: 'logo', href: '/', 'aria-label': '窩Woo！首頁' }, h('img', { src: '/logo.png', alt: '窩Woo！', width: '106', height: '46' })),
    form, right);
}
const dot = (n, label) => (n ? h('span', { class: 'dot', 'aria-label': `${n} ${label}` }) : null);
function sideNav(path) {
  const link = (href, label, extra) => h('a', { href, class: path === href ? 'active' : '' }, label, extra);
  return h('nav', { class: 'side', 'aria-label': '主選單' },
    link('/', '首頁'), link('/explore', '探索'), link('/communities', '分類版'),
    link('/notifications', '通知', dot(S.unread, '則未讀通知')),
    S.me ? link('/messages', '私訊', dot(S.unreadMsg, '則未讀私訊')) : null,
    S.me ? link('/bookmarks', '收藏') : null,
    S.me ? link(`/u/${S.me.handle}`, '個人頁') : null,
    link('/settings', '設定'),
    S.me?.role === 'gm' ? link('/admin', 'GM 後台') : null);
}
function bottomNav(path) {
  const link = (href, ic, label, n) => h('a', { href, class: path === href ? 'active' : '', 'aria-label': label }, icon(ic), n ? h('span', { class: 'dot', style: 'position:absolute;top:12px;right:12px' }) : null);
  return h('nav', { class: 'bottom', 'aria-label': '主選單' },
    link('/', 'home', '首頁'), link('/explore', 'search', '探索'), link('/communities', 'users', '分類版'),
    S.me ? link('/messages', 'mail', '私訊', S.unreadMsg) : null,
    link('/notifications', 'bell', '通知', S.unread),
    S.me ? link(`/u/${S.me.handle}`, 'user', '個人頁') : link('/settings', 'gear', '設定'));
}
function aside() {
  const box = h('div', { class: 'box glass' }, h('h2', null, '今日話題'), h('span', { class: 'muted' }, '載入中…'));
  api('GET', '/api/topics').then((d) => {
    box.lastChild.remove();
    if (!d.topics.length) box.append(h('span', { class: 'muted' }, '還沒有話題，發文時加上 #標籤 吧'));
    for (const t of d.topics) box.append(h('a', { href: `/tag/${encodeURIComponent(t.tag)}` }, `#${t.tag}`));
  }).catch(() => {});
  return h('aside', { class: 'side' }, box,
    h('p', { class: 'foot' }, h('a', { href: '/about' }, '關於'), ' · ', h('a', { href: '/about#content' }, '✦ 說明'), ' · ', h('a', { href: '/about#rules' }, '社群規範'), h('br'),
      h('a', { href: '/transparency' }, '透明度報告'), ' · ', h('a', { href: '/privacy' }, '隱私權政策'), ' · ', h('a', { href: '/terms' }, '使用條款'), h('br'), '© 2026 窩Woo！'));
}
function shell(path, mainEl) {
  const banner = typeof statusBanner === 'function' ? statusBanner() : null;
  if (banner && mainEl.firstChild) mainEl.prepend(banner);
  app.replaceChildren(header(), h('div', { class: 'layout' }, sideNav(path), mainEl, aside()), bottomNav(path));
}
const pageTitle = (t) => h('h1', { class: 'ptitle' }, t);

// ---------- 貼文卡片 ----------
/** 投票卡：還沒投 → 選項按鈕；投過／已結束／自己的文 → 顯示結果 */
function pollBox(p) {
  const box = h('div', { class: 'poll' });
  const draw = () => {
    const poll = p.poll;
    const mine = S.me && S.me.id === p.author.id;
    const showResult = poll.voted !== null || poll.closed || mine;
    const left = poll.ends_at - Date.now();
    const leftText = poll.closed ? '投票已結束' : left > 86400000 ? `剩 ${Math.ceil(left / 86400000)} 天` : left > 3600000 ? `剩 ${Math.ceil(left / 3600000)} 小時` : `剩 ${Math.max(1, Math.ceil(left / 60000))} 分鐘`;
    const max = Math.max(...poll.options.map((o) => o.votes));
    box.replaceChildren(
      ...poll.options.map((o, i) => {
        if (!showResult) {
          return h('button', { class: 'poll-opt', onclick: async () => {
            if (!S.me) return needLogin();
            try { const d = await api('POST', `/api/posts/${p.id}/vote`, { idx: i }); p.poll = d.poll; draw(); }
            catch (e) { toast(e.message); }
          } }, o.text);
        }
        const pct = poll.total ? Math.round((o.votes / poll.total) * 100) : 0;
        return h('div', { class: `poll-bar ${poll.voted === i ? 'mine' : ''} ${poll.closed && o.votes === max && max > 0 ? 'win' : ''}` },
          h('span', { class: 'fill', style: `width:${pct}%` }),
          h('span', { class: 'label' }, o.text, poll.voted === i ? ' ✓' : ''), h('b', null, `${pct}%`));
      }),
      h('span', { class: 'muted poll-meta' }, `${poll.total} 票 · ${leftText}`));
  };
  draw();
  return box;
}

/** 瀏覽次數：文章真的出現在畫面上超過 1 秒才算一次（同一次瀏覽只算一次），每 5 秒批次送出 */
const VIEWS = { seen: new Set(), pending: new Set(), timer: null, io: null };
function fmtCount(n) { return n >= 10000 ? `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}萬` : String(n); }
function flushViews() {
  if (!VIEWS.pending.size) return;
  const ids = [...VIEWS.pending]; VIEWS.pending.clear();
  fetch('/api/views', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }), keepalive: true, credentials: 'same-origin' }).catch(() => {});
}
function trackView(el, id) {
  if (!('IntersectionObserver' in window) || VIEWS.seen.has(id)) return;
  if (!VIEWS.io) {
    VIEWS.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const pid = e.target.dataset.pid;
        if (e.isIntersecting) e.target._vt = setTimeout(() => { if (!VIEWS.seen.has(pid)) { VIEWS.seen.add(pid); VIEWS.pending.add(pid); } VIEWS.io.unobserve(e.target); }, 1000);
        else clearTimeout(e.target._vt);
      }
    }, { threshold: 0.5 });
    VIEWS.timer = setInterval(flushViews, 5000);
    addEventListener('pagehide', flushViews);
  }
  el.dataset.pid = id;
  VIEWS.io.observe(el);
}

function postCard(p, { onDelete, full = false, pinned = false } = {}) {
  const el = h('article', { class: 'post glass' });
  const likeBtn = reactionControl(p);
  const media = imageGrid(p);
  const isBlog = p.kind === 'blog';
  let body = p.text;
  let more = null;
  if (isBlog && !full && body.length > 180) { body = body.slice(0, 180) + '…'; more = h('a', { href: `/p/${p.id}`, class: 'readmore' }, '閱讀全文'); }
  let textEl = body ? h('div', { class: `text ${isBlog && full ? 'blogbody' : ''}` }, richText(body)) : null;
  if (p.sensitive && !p.image_url && textEl) {
    const hidden = textEl;
    textEl = h('button', { class: 'sens-text icon-btn', style: 'justify-content:flex-start;width:100%', onclick: () => textEl.replaceWith(hidden) }, icon('eyeoff'), '敏感內容 · 點擊查看');
  }

  const menuWrap = h('div', { class: 'menu' });
  const menuBtn = h('button', { class: 'icon-btn', 'aria-label': '更多選項', 'aria-haspopup': 'true' }, icon('more'));
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menuWrap.querySelector('.pop')) return menuWrap.querySelector('.pop').remove();
    const mine = S.me && S.me.id === p.author.id;
    const item = (label, fn, danger) => h('button', { role: 'menuitem', style: danger ? 'color:#A32D2D' : null, onclick: () => { pop.remove(); fn(); } }, label);
    const pop = h('div', { class: 'pop', role: 'menu' },
      S.me ? item(p.bookmarked ? '取消收藏' : '收藏', () => toggleBookmark(p)) : null,
      item('查看回應名單', () => likesModal(p.id)),
      item('複製連結', async () => { try { await navigator.clipboard.writeText(`${location.origin}/p/${p.id}`); toast('已複製連結'); } catch { toast(`${location.origin}/p/${p.id}`); } }),
      mine ? item(pinned ? '取消置頂' : '置頂到個人頁', async () => { await api('PATCH', '/api/me', { pinned_post_id: pinned ? null : p.id }); toast(pinned ? '已取消置頂' : '已置頂'); render(); }) : null,
      S.me && !mine ? item('檢舉', () => reportModal({ post_id: p.id })) : null,
      S.me && mine ? item('刪除', async () => {
        if (!confirm('確定要刪除這篇文章嗎？刪除後無法復原。')) return;
        try { await api('DELETE', `/api/posts/${p.id}`); el.remove(); toast('已刪除'); onDelete?.(); } catch (err) { toast(err.message); }
      }, true) : null,
      S.me && !mine && S.me.role === 'gm' ? item('刪除（GM）', () => reasonModal('刪除這篇文章', async (reason, detail) => {
        await api('DELETE', `/api/posts/${p.id}`, { reason, detail }); el.remove(); toast('已刪除並通知作者'); onDelete?.();
      }), true) : null);
    menuWrap.append(pop);
    setTimeout(() => document.addEventListener('click', () => pop.remove(), { once: true }), 0);
  });
  menuWrap.append(menuBtn);

  el.append(
    avatar(p.author),
    h('div', { class: 'body' },
      p.repost ? h('a', { class: 'muted row reposted', href: `/u/${p.repost.by.handle}`, style: 'gap:4px' }, icon('repost'), `${p.repost.by.name} 轉發了`) : null,
      pinned ? h('span', { class: 'muted row', style: 'gap:4px' }, icon('pin'), '置頂文章') : null,
      h('div', { class: 'meta' },
        h('a', { class: 'name', href: `/u/${p.author.handle}` }, p.author.name),
        p.author.is_content ? starButton() : null,
        h('a', { class: 'time', href: `/p/${p.id}`, style: 'text-decoration:none' }, timeAgo(p.created_at)),
        isBlog ? h('span', { class: 'pill', style: 'margin-left:6px' }, '網誌') : null,
        p.is_daily ? h('span', { class: 'pill', style: 'margin-left:6px' }, '今日投票') : null,
        p.community ? h('a', { class: 'cchip', href: `/c/${p.community.slug}` }, `${p.community.icon} ${p.community.name}`) : null),
      isBlog ? h(full ? 'h1' : 'a', { class: 'blogtitle', href: full ? null : `/p/${p.id}` }, p.title) : null,
      textEl, more,
      p.link ? h('a', { class: `linkcard${p.link.image ? ' has-img' : ''}`, href: p.link.url, target: '_blank', rel: 'noopener nofollow' }, p.link.image ? h('img', { class: 'lthumb', src: p.link.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => { e.target.remove(); } }) : null, h('div', { class: 'ltext' }, h('small', null, p.link.site || '新聞來源'), h('b', null, p.link.title || p.link.url))) : null,
      p.poll ? pollBox(p) : null,
      media,
      p.quote ? quoteCard(p.quote) : null,
      h('div', { class: 'pstats' }, h('span', null, `${fmtCount(p.view_count || 0)} 次瀏覽`), h('span', null, `${fmtCount((p.like_count || 0) + (p.comment_count || 0) + (p.repost_count || 0))} 次互動`)),
      h('div', { class: 'actions' }, likeBtn,
        h('a', { class: 'icon-btn', href: `/p/${p.id}`, 'aria-label': '留言' }, icon('chat'), String(p.comment_count)),
        p.kind !== 'blog' ? repostControl(p) : null,
        menuWrap)));
  trackView(el, p.id);
  return el;
}
async function likesModal(id) {
  const list = h('div', { class: 'ulist' }, h('span', { class: 'muted' }, '載入中…'));
  const m = modal('回應名單', list);
  try {
    const d = await api('GET', `/api/posts/${id}/likes`);
    list.replaceChildren(...(d.users.length ? d.users.map((u) => h('a', { class: 'uitem', href: `/u/${u.handle}`, onclick: () => m.remove() }, avatar(u, 'sm'), h('span', null, u.name), u.is_content ? h('span', { class: 'star', 'aria-label': '平台內容帳號' }, '✦') : null, u.emoji ? h('span', { style: 'margin-left:auto;font-size:18px' }, u.emoji) : null)) : [h('span', { class: 'muted' }, '還沒有人回應')]));
  } catch (e) { list.replaceChildren(h('span', { class: 'err' }, e.message)); }
}
function reportModal(target) {
  const reasons = [['spam', '垃圾訊息或廣告'], ['harassment', '騷擾或人身攻擊'], ['unmarked_sensitive', '未標記的敏感內容'], ['copyright', '侵權'], ['illegal', '違法內容（涉及未成年、未經同意的私密影像等）'], ['other', '其他']];
  let chosen = '';
  const detail = h('textarea', { rows: '2', maxlength: '300', placeholder: '補充說明（選填）' });
  const err = h('span', { class: 'err' });
  const opts = reasons.map(([v, l]) => h('label', { class: 'check', style: 'color:var(--text);font-size:14px' }, h('input', { type: 'radio', name: 'reason', value: v, onchange: () => { chosen = v; err.textContent = ''; } }), l));
  const m = modal('檢舉', h('div', { class: 'field' }, ...opts), h('label', { class: 'field' }, h('span', { class: 'sr' }, '補充說明'), detail), err,
    h('button', { class: 'btn', onclick: async () => {
      if (!chosen) { err.textContent = '請選擇檢舉原因'; return; }
      try { await api('POST', '/api/reports', { ...target, reason: chosen, detail: detail.value }); m.remove(); toast('已送出檢舉，GM 會盡快處理'); } catch (e) { err.textContent = e.message; }
    } }, '送出檢舉'));
}

// ---------- 發文框與網誌編輯器 ----------
function imagePicker(onKey) {
  const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', class: 'sr' });
  const preview = h('div');
  const err = h('span', { class: 'err' });
  let key = null;
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    err.textContent = '';
    try {
      const d = await uploadImage(f);
      key = d.key; onKey(key);
      preview.replaceChildren(h('div', { class: 'preview' }, h('img', { src: d.url, alt: '預覽' }),
        h('button', { class: 'btn ghost small', style: 'position:absolute;top:6px;left:6px', onclick: () => { key = null; onKey(null); preview.replaceChildren(); } }, '移除')));
    } catch (e) { err.textContent = e.message; } finally { file.value = ''; }
  });
  const btn = h('button', { class: 'icon-btn', style: 'color:var(--primary)', 'aria-label': '加入圖片', onclick: () => file.click() }, icon('image'));
  return { btn, file, preview, err, reset: () => { key = null; preview.replaceChildren(); } };
}
/** 打字時的 @帳號、#標籤 提示 */
function attachSuggest(ta) {
  const pop = h('div', { class: 'suggest', role: 'listbox', hidden: true });
  let timer = null, items = [], active = 0, token = null;
  const close = () => { pop.hidden = true; items = []; token = null; };
  const insert = (text) => {
    if (!token) return;
    const before = ta.value.slice(0, token.start), after = ta.value.slice(ta.selectionStart);
    ta.value = before + text + ' ' + after;
    const pos = (before + text + ' ').length;
    ta.setSelectionRange(pos, pos); ta.focus(); close();
  };
  const draw = () => {
    pop.replaceChildren(...items.map((it, i) => h('button', { type: 'button', role: 'option', class: i === active ? 'on' : '', onmousedown: (e) => { e.preventDefault(); insert(it.insert); } },
      it.user ? [avatar(it.user, 'sm'), h('span', null, it.user.name), it.user.is_content ? h('span', { class: 'star' }, '✦') : null, h('small', null, `@${it.user.handle}`)] : [h('span', null, `#${it.tag}`), h('small', null, `${it.count} 篇`)])));
    pop.hidden = !items.length;
  };
  ta.addEventListener('input', () => {
    clearTimeout(timer);
    const m = ta.value.slice(0, ta.selectionStart).match(/(^|\s)([#@])([\p{L}\p{N}_]{0,20})$/u);
    if (!m || (m[2] === '@' && !m[3])) return close();
    token = { start: ta.selectionStart - m[3].length - 1 };
    timer = setTimeout(async () => {
      try {
        const d = await api('GET', `/api/suggest?type=${m[2] === '@' ? 'user' : 'tag'}&q=${encodeURIComponent(m[3])}`);
        items = d.items.map((x) => (x.handle ? { user: x, insert: `@${x.handle}` } : { tag: x.tag, count: x.count, insert: `#${x.tag}` }));
        active = 0; draw();
      } catch { close(); }
    }, 200);
  });
  ta.addEventListener('keydown', (e) => {
    if (pop.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; draw(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(items[active].insert); }
    else if (e.key === 'Escape') close();
  });
  ta.addEventListener('blur', () => setTimeout(close, 150));
  return pop;
}

function composer(onPosted, opts = {}) {
  const ta = h('textarea', { rows: '2', maxlength: '1000', placeholder: '有什麼想說的？用 #標籤、@帳號 都可以' });
  const suggest = attachSuggest(ta);
  const sens = h('input', { type: 'checkbox' });
  const err = h('span', { class: 'err' });
  const pick = multiImagePicker(4);
  const csel = communitySelect(opts.communityId ? opts : null);

  // 標籤：最多 5 個，發文時加在文末
  let tags = [];
  const tagRow = h('div', { class: 'tag-row', hidden: true });
  const tagInput = h('input', { class: 'tag-input', maxlength: '20', placeholder: '輸入標籤後按 Enter', 'aria-label': '新增標籤' });
  const drawTags = () => {
    tagRow.replaceChildren(...tags.map((t) => h('span', { class: 'chip' }, `#${t}`, h('button', { type: 'button', 'aria-label': `移除 #${t}`, onclick: () => { tags = tags.filter((x) => x !== t); drawTags(); } }, '×'))), tags.length < 5 ? tagInput : null);
  };
  tagInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ',' && e.key !== ' ') return;
    e.preventDefault();
    const t = tagInput.value.replace(/^#/, '').replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 20);
    if (t && !tags.includes(t) && tags.length < 5) tags.push(t);
    tagInput.value = ''; drawTags(); tagInput.focus();
  });
  const tagBtn = h('button', { type: 'button', class: 'icon-btn', style: 'color:var(--primary)', onclick: () => { tagRow.hidden = false; drawTags(); tagInput.focus(); } }, icon('hash'), '標籤');

  // 投票：2～5 個選項
  let pollOn = false;
  const pollEditor = h('div', { class: 'poll-editor', hidden: true });
  let optInputs = [];
  const days = h('select', { 'aria-label': '投票期限' }, [['1', '1 天'], ['3', '3 天'], ['7', '7 天']].map(([v, l]) => h('option', { value: v }, l)));
  const drawPoll = () => {
    pollEditor.replaceChildren(
      ...optInputs.map((inp, i) => h('div', { class: 'row' }, inp, optInputs.length > 2 ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': `刪除選項 ${i + 1}`, onclick: () => { optInputs.splice(i, 1); relabel(); drawPoll(); } }, icon('x')) : null)),
      h('div', { class: 'row wrap' },
        optInputs.length < 5 ? h('button', { type: 'button', class: 'btn ghost small', onclick: () => { optInputs.push(newOpt()); relabel(); drawPoll(); optInputs[optInputs.length - 1].focus(); } }, '＋ 新增選項') : null,
        h('label', { class: 'row', style: 'gap:6px' }, h('span', { class: 'muted' }, '期限'), days),
        h('span', { style: 'flex:1' }),
        h('button', { type: 'button', class: 'btn ghost small', onclick: () => togglePoll(false) }, '移除投票')));
  };
  const newOpt = () => h('input', { maxlength: '40' });
  const relabel = () => optInputs.forEach((inp, i) => { inp.placeholder = `選項 ${i + 1}`; inp.setAttribute('aria-label', `選項 ${i + 1}`); });
  const togglePoll = (on) => {
    pollOn = on; pollEditor.hidden = !on;
    if (on) { optInputs = [newOpt(), newOpt()]; relabel(); drawPoll(); optInputs[0].focus(); ta.placeholder = '投票題目，例如：週末最想窩在哪裡？'; }
    else { ta.placeholder = '有什麼想說的？用 #標籤、@帳號 都可以'; }
  };
  const pollBtn = h('button', { type: 'button', class: 'icon-btn', style: 'color:var(--primary)', onclick: () => togglePoll(!pollOn) }, icon('poll'), '投票');

  const send = h('button', { class: 'btn' }, '發布');
  send.addEventListener('click', async () => {
    err.textContent = '';
    if (!ta.value.trim() && !pick.keys().length) { err.textContent = pollOn ? '請寫下投票的題目' : '寫點什麼或加張圖片吧'; ta.focus(); return; }
    let poll = null;
    if (pollOn) {
      const options = optInputs.map((x) => x.value.trim()).filter(Boolean);
      if (options.length < 2) { err.textContent = '投票至少要填 2 個選項'; return; }
      poll = { options, days: Number(days.value) };
    }
    const text = ta.value.trim() + (tags.length ? `\n${tags.map((t) => `#${t}`).join(' ')}` : '');
    send.disabled = true;
    try {
      await api('POST', '/api/posts', { text, image_keys: pick.keys(), sensitive: sens.checked, poll, community_id: csel.value || 'cm_free' });
      ta.value = ''; pick.reset(); sens.checked = false;
      tags = []; tagRow.hidden = true; togglePoll(false);
      toast('已發布'); onPosted?.();
    } catch (e) { err.textContent = e.message; } finally { send.disabled = false; }
  });
  return h('section', { class: 'composer glass', 'aria-label': '發表新文章' }, avatar(S.me),
    h('div', { style: 'flex:1;min-width:0;position:relative' },
      h('label', null, h('span', { class: 'sr' }, '文章內容'), ta), suggest, pollEditor, tagRow, pick.preview, err, pick.err,
      h('div', { class: 'row wrap' }, pick.btn, pick.file, pollBtn, tagBtn, csel,
        h('button', { class: 'icon-btn', style: 'color:var(--primary)', onclick: () => blogEditor(onPosted) }, icon('pen'), '寫網誌'),
        h('label', { class: 'check' }, sens, '標記敏感'),
        h('span', { style: 'flex:1' }), send)));
}
function blogEditor(onPosted) {
  const title = h('input', { maxlength: '100', placeholder: '網誌標題' });
  const body = h('textarea', { rows: '12', maxlength: '20000', placeholder: '寫下你的故事…（支援 #標籤、@帳號）' });
  const sens = h('input', { type: 'checkbox' });
  const err = h('span', { class: 'err' });
  let imageKey = null;
  const pick = imagePicker((k) => { imageKey = k; });
  const m = modal('寫網誌',
    h('label', { class: 'field' }, '標題', title),
    h('label', { class: 'field' }, '內容', body),
    pick.preview, pick.err,
    h('div', { class: 'row wrap' }, pick.btn, pick.file, h('span', { class: 'muted' }, '封面圖片（選填）'), h('label', { class: 'check' }, sens, '標記敏感')),
    err,
    h('button', { class: 'btn', onclick: async () => {
      if (!title.value.trim()) { err.textContent = '請輸入標題'; return; }
      if (!body.value.trim()) { err.textContent = '請輸入內容'; return; }
      try { const d = await api('POST', '/api/posts', { kind: 'blog', title: title.value, text: body.value, image_key: imageKey, sensitive: sens.checked }); m.remove(); toast('網誌已發布'); onPosted ? onPosted() : navigate(`/p/${d.id}`); }
      catch (e) { err.textContent = e.message; }
    } }, '發布網誌'));
  m.querySelector('.modal').classList.add('wide');
}

// ---------- 頁面：動態牆 ----------
function postList(loader, emptyText) {
  const list = h('div', { class: 'stack' });
  const more = h('button', { class: 'btn ghost', style: 'align-self:center;display:none' }, '載入更多');
  let state = { offset: 0, before: 0, loading: false };
  const load = async (reset) => {
    if (state.loading) return; state.loading = true;
    if (reset) { list.replaceChildren(h('div', { class: 'empty' }, '載入中…')); state.offset = 0; state.before = 0; }
    try {
      const posts = await loader(state);
      if (reset) list.replaceChildren();
      if (reset && !posts.length) list.append(h('div', { class: 'empty glass' }, emptyText));
      for (const p of posts) list.append(postCard(p));
      state.offset += posts.length;
      if (posts.length) state.before = posts[posts.length - 1].created_at;
      more.style.display = posts.length >= 20 ? '' : 'none';
    } catch (e) { list.replaceChildren(h('div', { class: 'empty err' }, e.message)); }
    state.loading = false;
  };
  more.addEventListener('click', () => load(false));
  return { el: h('div', { class: 'stack' }, list, more), load };
}
function feedPage() {
  const pl = postList(async (st) => {
    const qs = S.feedTab === 'hot' ? `tab=hot&offset=${st.offset}${S.hotBoard ? `&board=${S.hotBoard}` : ''}` : `tab=following${st.before ? `&before=${st.before}` : ''}`;
    return (await api('GET', `/api/feed?${qs}`)).posts;
  }, S.feedTab === 'following' ? (S.me ? '你追蹤的人還沒有發文，去探索看看吧' : '登入後就能看到你追蹤的人') : '還沒有文章，來發第一篇吧');
  const tab = (key, label) => h('button', { class: S.feedTab === key ? 'on' : '', role: 'tab', 'aria-selected': String(S.feedTab === key), onclick: () => { S.feedTab = key; render(); } }, label);
  const main = h('main', { class: 'main' },
    S.me ? composer(() => pl.load(true)) : h('div', { class: 'card glass' }, h('h2', null, '歡迎來到窩Woo！'), h('p', { style: 'margin:0' }, '一個可以慵懶窩著、隨意分享日常的地方。'), loginButton()),
    storiesBar(),
    h('div', { class: 'tabs', role: 'tablist', 'aria-label': '動態牆' }, tab('following', '追蹤中'), tab('hot', '熱門')),
    S.feedTab === 'hot' ? boardChips(() => render()) : null,
    S.feedTab === 'hot' && !S.hotBoard ? dailyPollCard() : null,
    pl.el);
  shell('/', main);
  pl.load(true);
}
function tagPage(tag) {
  const pl = postList(async () => (await api('GET', `/api/tags/${encodeURIComponent(tag)}`)).posts, `還沒有 #${tag} 的文章`);
  const main = h('main', { class: 'main' }, pageTitle(`#${tag}`), S.me ? h('span', { class: 'muted', style: 'margin:0 4px' }, `發文時加上 #${tag} 就會出現在這裡`) : null, pl.el);
  shell('', main);
  pl.load(true);
}

// ---------- 頁面：單篇文章與留言串 ----------
async function postPage(id) {
  const main = h('main', { class: 'main' }, h('div', { class: 'empty' }, '載入中…'));
  shell('', main);
  try {
    const d = await api('GET', `/api/posts/${id}`);
    const top = d.comments.filter((c) => !c.parent_id || !d.comments.some((x) => x.id === c.parent_id));
    const replies = (pid) => d.comments.filter((c) => c.parent_id === pid);
    const commentForm = (parent, onDone) => {
      const ta = h('textarea', { rows: '2', maxlength: '500', placeholder: parent ? `回覆 ${parent.author.name}` : '留個言吧' });
      const err = h('span', { class: 'err' });
      return h('div', { class: 'composer glass', style: parent ? 'margin-left:44px' : null }, avatar(S.me, 'sm'), h('div', { style: 'flex:1' }, h('label', null, h('span', { class: 'sr' }, '留言內容'), ta), err,
        h('div', { class: 'row', style: 'justify-content:flex-end' }, parent ? h('button', { class: 'icon-btn', onclick: onDone }, '取消') : null, h('button', { class: 'btn small', onclick: async () => {
          if (!ta.value.trim()) { err.textContent = '留言不能空白'; return; }
          try { await api('POST', `/api/posts/${id}/comments`, { text: ta.value, parent_id: parent?.id }); postPage(id); } catch (e) { err.textContent = e.message; }
        } }, parent ? '回覆' : '留言'))));
    };
    const commentEl = (c, isReply) => {
      const wrap = h('div', { class: 'stack', style: 'gap:8px' });
      const actions = h('span', { style: 'margin-left:auto;display:flex;gap:2px' },
        S.me && !isReply ? h('button', { class: 'icon-btn', onclick: () => { if (wrap.querySelector('.composer')) return; wrap.append(commentForm(c, () => wrap.querySelector('.composer')?.remove())); } }, '回覆') : null,
        S.me && isReply ? h('button', { class: 'icon-btn', onclick: () => { const holder = wrap.parentElement; if (holder.querySelector(':scope > .composer')) return; holder.append(commentForm(c, () => holder.querySelector(':scope > .composer')?.remove())); } }, '回覆') : null,
        S.me && S.me.id !== c.author.id ? h('button', { class: 'icon-btn', onclick: () => reportModal({ comment_id: c.id }) }, '檢舉') : null,
        S.me && S.me.id === c.author.id ? h('button', { class: 'icon-btn', onclick: async () => { if (!confirm('刪除這則留言？')) return; try { await api('DELETE', `/api/comments/${c.id}`); postPage(id); } catch (e) { toast(e.message); } } }, '刪除') : null,
        S.me && S.me.id !== c.author.id && S.me.role === 'gm' ? h('button', { class: 'icon-btn', onclick: () => reasonModal('刪除這則留言', async (reason, detail) => { await api('DELETE', `/api/comments/${c.id}`, { reason, detail }); toast('已刪除並通知作者'); postPage(id); }) }, '刪除（GM）') : null);
      wrap.append(h('div', { class: 'post glass', style: `padding:12px 16px;${isReply ? 'margin-left:44px' : ''}` }, avatar(c.author, 'sm'),
        h('div', { class: 'body' },
          h('div', { class: 'meta' }, h('a', { class: 'name', href: `/u/${c.author.handle}`, style: 'font-size:14px' }, c.author.name), c.author.is_content ? starButton() : null, h('span', { class: 'time' }, timeAgo(c.created_at)), actions),
          h('div', { class: 'text', style: 'font-size:14px' }, richText(c.text)))));
      return wrap;
    };
    const comments = h('div', { class: 'stack', style: 'gap:10px' }, top.map((c) => {
      const thread = h('div', { class: 'stack', style: 'gap:8px' }, commentEl(c, false), replies(c.id).map((r) => commentEl(r, true)));
      return thread;
    }));
    const form = S.me ? commentForm(null) : h('div', { class: 'card glass' }, h('span', null, '登入後就能留言'), loginButton());
    main.replaceChildren(postCard(d.post, { onDelete: () => navigate('/'), full: true }), form, h('h2', { class: 'subhead' }, `留言 ${d.comments.length}`), comments);
  } catch (e) { main.replaceChildren(h('div', { class: 'empty glass' }, e.message)); }
}

// ---------- 頁面：個人頁（動態／網誌／相簿、訪客計數、封鎖） ----------
async function profilePage(handle, tab) {
  const main = h('main', { class: 'main' }, h('div', { class: 'empty' }, '載入中…'));
  shell(S.me && S.me.handle === handle ? `/u/${handle}` : '', main);
  try {
    const d = await api('GET', `/api/users/${handle}${tab === 'blog' ? '?tab=blog' : ''}`);
    const u = d.user;
    const isMe = S.me && S.me.id === u.id;
    if (!isMe) api('POST', `/api/users/${handle}/visit`).catch(() => {});
    const actions = h('div', { class: 'row wrap', style: 'justify-content:flex-end' });
    if (isMe) actions.append(h('button', { class: 'btn ghost small', onclick: () => editProfile(u) }, '編輯個人資料'));
    else {
      let following = d.is_following;
      const fb = h('button', { class: following ? 'btn ghost small' : 'btn small' }, following ? '追蹤中' : '追蹤');
      fb.addEventListener('click', async () => {
        if (!S.me) return needLogin();
        try { await api(following ? 'DELETE' : 'POST', `/api/users/${handle}/follow`); following = !following; fb.textContent = following ? '追蹤中' : '追蹤'; fb.className = following ? 'btn ghost small' : 'btn small'; } catch (e) { toast(e.message); }
      });
      if (!d.blocked && !d.blocked_me) actions.append(fb);
      if (S.me && !u.is_content && !d.blocked && !d.blocked_me) actions.append(h('a', { class: 'btn ghost small', href: `/messages/${handle}` }, '私訊'));
      if (S.me) {
        const mw = h('div', { class: 'menu', style: 'margin-left:0' });
        const mb = h('button', { class: 'icon-btn', 'aria-label': '更多選項' }, icon('more'));
        mb.addEventListener('click', (e) => {
          e.stopPropagation();
          if (mw.querySelector('.pop')) return mw.querySelector('.pop').remove();
          const act = (label, method, path, msg) => h('button', { role: 'menuitem', onclick: async () => { pop.remove(); try { await api(method, path); toast(msg); profilePage(handle, tab); } catch (err) { toast(err.message); } } }, label);
          const pop = h('div', { class: 'pop', role: 'menu' },
            d.muted ? act('取消靜音', 'DELETE', `/api/users/${handle}/mute`, '已取消靜音') : act('靜音（不在動態牆看到他）', 'POST', `/api/users/${handle}/mute`, '已靜音'),
            d.blocked ? act('解除封鎖', 'DELETE', `/api/users/${handle}/block`, '已解除封鎖') : act('封鎖', 'POST', `/api/users/${handle}/block`, '已封鎖，對方無法再和你互動'));
          mw.append(pop);
          setTimeout(() => document.addEventListener('click', () => pop.remove(), { once: true }), 0);
        });
        mw.append(mb);
        actions.append(mw);
      }
    }
    const accent = u.accent || 'var(--primary)';
    const banner = h('div', { class: 'banner', style: u.banner_url ? `background-image:url("${encodeURI(u.banner_url)}")` : `background:${accent};opacity:.85` });
    const head = h('section', { class: 'card glass profile', style: `--paccent:${accent}` }, banner,
      h('div', { class: 'row between', style: 'margin-top:-56px;align-items:flex-end;position:relative;z-index:1' }, h('span', { class: 'avatar lg ring' }, u.avatar_url ? h('img', { src: u.avatar_url, alt: '' }) : u.name.slice(0, 1)), actions),
      h('div', null, h('h1', { style: 'font-size:22px' }, u.name, u.is_content ? starButton() : null), h('span', { class: 'muted' }, `@${u.handle}`)),
      badgeRow(d.badges),
      u.is_content ? h('p', { class: 'notice', style: 'margin:0;font-size:13px' }, '✦ 這是平台內容帳號，由窩Woo！自動發布內容。') : null,
      d.blocked ? h('p', { class: 'notice', style: 'margin:0;font-size:13px' }, '你已封鎖這位用戶。') : null,
      d.blocked_me ? h('p', { class: 'notice', style: 'margin:0;font-size:13px' }, '你無法查看這位用戶的內容。') : null,
      u.bio ? h('p', { style: 'margin:0;white-space:pre-wrap' }, u.bio) : null,
      h('div', { class: 'row wrap', style: 'gap:18px;font-size:14px' }, h('span', null, h('b', null, d.following), ' 追蹤中'), h('span', null, h('b', null, d.followers), ' 粉絲'),
        h('span', { class: 'counter', title: '訪客人數' }, '今日 ', h('b', null, d.visits.today), ' · 總計 ', h('b', null, d.visits.total), ' 人來訪')));
    const tabLink = (key, label) => h('a', { href: key === 'posts' ? `/u/${handle}` : `/u/${handle}/${key}`, class: tab === key ? 'on' : '' }, label);
    const tabs = h('div', { class: 'tabs linktabs' }, tabLink('posts', '動態'), tabLink('blog', '網誌'), tabLink('albums', '相簿'));
    if (tab === 'albums') {
      main.replaceChildren(head, tabs, await albumsSection(u, isMe));
    } else {
      const items = [];
      if (d.pinned) items.push(postCard(d.pinned, { pinned: true }));
      for (const p of d.posts) items.push(postCard(p));
      if (isMe && tab === 'blog') items.unshift(h('button', { class: 'btn', style: 'align-self:flex-start', onclick: () => blogEditor(() => profilePage(handle, 'blog')) }, icon('pen'), '寫網誌'));
      main.replaceChildren(head, tabs, ...(items.length ? items : [h('div', { class: 'empty glass' }, tab === 'blog' ? '還沒有網誌' : '還沒有文章')]));
    }
  } catch (e) { main.replaceChildren(h('div', { class: 'empty glass' }, e.message)); }
}
function editProfile(u) {
  const name = h('input', { value: u.name, maxlength: '40' });
  const bio = h('textarea', { rows: '3', maxlength: '200' }); bio.value = u.bio || '';
  const av = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
  const bn = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
  let accent = u.accent || '';
  const sw = h('div', { class: 'row wrap', role: 'radiogroup', 'aria-label': '個人頁主題色' }, (S.accents.length ? S.accents : ['#2E6A4E', '#2F74AE', '#B5501C', '#5B3FBF', '#0E6B6F', '#CF3F76', '#8A6600', '#1C1C1A']).map((c) => {
    const b = h('button', { class: 'swatch', role: 'radio', 'aria-checked': String(accent === c), 'aria-label': c, style: `background:${c}` });
    b.addEventListener('click', () => { accent = c; sw.querySelectorAll('.swatch').forEach((x) => x.setAttribute('aria-checked', String(x === b))); });
    return b;
  }));
  const err = h('span', { class: 'err' });
  const save = h('button', { class: 'btn' }, '儲存');
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      const body = { name: name.value, bio: bio.value };
      if (accent) body.accent = accent;
      if (av.files[0]) body.avatar_key = (await uploadImage(av.files[0], 600)).key;
      if (bn.files[0]) body.banner_key = (await uploadImage(bn.files[0], 1600)).key;
      await api('PATCH', '/api/me', body);
      m.remove(); await loadMe(); profilePage(S.me.handle, 'posts');
    } catch (e) { err.textContent = e.message; save.disabled = false; }
  });
  const m = modal('編輯個人資料',
    h('label', { class: 'field' }, '名稱', name), h('label', { class: 'field' }, '自我介紹', bio),
    h('label', { class: 'field' }, '大頭貼（不可使用敏感內容）', av),
    h('label', { class: 'field' }, '個人頁橫幅（建議 1500×500，不可使用敏感內容）', bn),
    h('div', { class: 'field' }, '個人頁主題色', sw), err, save);
}

// ---------- 相簿 ----------
async function albumsSection(u, isMe) {
  const wrap = h('div', { class: 'stack' });
  const d = await api('GET', `/api/users/${u.handle}/albums`);
  if (isMe) wrap.append(h('button', { class: 'btn', style: 'align-self:flex-start', onclick: () => albumForm(null, () => profilePage(u.handle, 'albums')) }, icon('plus'), '新增相簿'));
  if (!d.albums.length) wrap.append(h('div', { class: 'empty glass' }, '還沒有相簿'));
  else wrap.append(h('div', { class: 'albums' }, d.albums.map((a) => h('a', { class: 'album glass', href: `/album/${a.id}` },
    h('div', { class: `cover ${a.sensitive ? 'blur' : ''}`, style: a.cover_url ? `background-image:url("${encodeURI(a.cover_url)}")` : null }, a.cover_url ? null : icon('image'), a.sensitive ? h('span', { class: 'pill', style: 'position:absolute;top:8px;left:8px' }, '敏感') : null),
    h('b', null, a.title), h('span', { class: 'muted' }, `${a.count} 張`)))));
  return wrap;
}
function albumForm(album, onDone) {
  const title = h('input', { maxlength: '60', value: album?.title || '' });
  const desc = h('textarea', { rows: '2', maxlength: '300' }); desc.value = album?.description || '';
  const sens = h('input', { type: 'checkbox', checked: album?.sensitive ? true : null });
  const err = h('span', { class: 'err' });
  const m = modal(album ? '編輯相簿' : '新增相簿', h('label', { class: 'field' }, '相簿名稱', title), h('label', { class: 'field' }, '說明（選填）', desc), h('label', { class: 'check' }, sens, '這本相簿含敏感內容'), err,
    h('button', { class: 'btn', onclick: async () => {
      if (!title.value.trim()) { err.textContent = '請輸入相簿名稱'; return; }
      try {
        const body = { title: title.value, description: desc.value, sensitive: sens.checked };
        if (album) await api('PATCH', `/api/albums/${album.id}`, body); else { const r = await api('POST', '/api/albums', body); m.remove(); return navigate(`/album/${r.id}`); }
        m.remove(); onDone?.();
      } catch (e) { err.textContent = e.message; }
    } }, '儲存'));
}
async function albumPage(id) {
  const main = h('main', { class: 'main' }, h('div', { class: 'empty' }, '載入中…'));
  shell('', main);
  try {
    const d = await api('GET', `/api/albums/${id}`);
    const a = d.album;
    const isOwner = S.me && S.me.id === a.owner.id;
    const canEdit = isOwner || S.me?.role === 'gm';
    const tools = h('div', { class: 'row wrap' });
    if (isOwner) {
      const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', multiple: true, class: 'sr' });
      const status = h('span', { class: 'muted' });
      file.addEventListener('change', async () => {
        const files = [...file.files];
        for (let i = 0; i < files.length; i++) {
          status.textContent = `上傳中 ${i + 1}/${files.length}…`;
          try { const up = await uploadImage(files[i]); await api('POST', `/api/albums/${id}/photos`, { image_key: up.key }); } catch (e) { toast(e.message); break; }
        }
        albumPage(id);
      });
      tools.append(h('button', { class: 'btn small', onclick: () => file.click() }, icon('plus'), '上傳照片'), file, status,
        h('button', { class: 'btn ghost small', onclick: () => albumForm(a, () => albumPage(id)) }, '編輯相簿'));
    }
    if (canEdit) tools.append(h('button', { class: 'btn danger small', onclick: async () => { if (!confirm('確定刪除整本相簿？照片會一起刪除，無法復原。')) return; await api('DELETE', `/api/albums/${id}`); navigate(`/u/${a.owner.handle}/albums`); } }, '刪除相簿'));
    const grid = h('div', { class: 'photos' }, d.photos.map((p, i) => h('button', { class: 'photo', 'aria-label': p.caption || `第 ${i + 1} 張照片`, onclick: () => lightbox(d.photos, i, canEdit ? async (pid) => { await api('DELETE', `/api/albums/${id}/photos/${pid}`); albumPage(id); } : null) },
      h('img', { src: p.url, alt: p.caption || '', loading: 'lazy' }))));
    main.replaceChildren(
      h('section', { class: 'card glass' },
        h('a', { class: 'row', href: `/u/${a.owner.handle}/albums`, style: 'text-decoration:none' }, avatar(a.owner, 'sm'), h('span', null, a.owner.name, ' 的相簿')),
        h('h1', null, a.title), a.description ? h('p', { style: 'margin:0;white-space:pre-wrap' }, a.description) : null,
        h('span', { class: 'muted' }, `${d.photos.length} 張照片`, a.sensitive ? ' · 敏感內容' : ''), tools),
      d.photos.length ? grid : h('div', { class: 'empty glass' }, isOwner ? '按「上傳照片」加入第一張吧' : '這本相簿還沒有照片'));
  } catch (e) { main.replaceChildren(h('div', { class: 'empty glass' }, e.message)); }
}
function lightbox(photos, idx, onDelete) {
  let i = idx;
  const img = h('img', { alt: '' });
  const cap = h('p', { class: 'muted', style: 'margin:0' });
  const draw = () => { img.src = photos[i].url; img.alt = photos[i].caption || ''; cap.textContent = photos[i].caption || `${i + 1} / ${photos.length}`; };
  const m = modal('照片', h('div', { class: 'lightbox' }, img), cap,
    h('div', { class: 'row between' },
      h('button', { class: 'btn ghost small', onclick: () => { i = (i - 1 + photos.length) % photos.length; draw(); } }, '上一張'),
      onDelete ? h('button', { class: 'btn danger small', onclick: async () => { if (!confirm('刪除這張照片？')) return; m.remove(); await onDelete(photos[i].id); } }, '刪除') : null,
      h('button', { class: 'btn ghost small', onclick: () => { i = (i + 1) % photos.length; draw(); } }, '下一張')));
  m.querySelector('.modal').classList.add('wide');
  draw();
}

// ---------- 通知 ----------
async function notificationsPage() {
  const main = h('main', { class: 'main' });
  shell('/notifications', main);
  if (!S.me) { main.append(h('div', { class: 'card glass' }, h('h2', null, '通知'), h('span', null, '登入後就能看到誰按讚、留言或追蹤你'), loginButton())); return; }
  main.append(h('div', { class: 'empty' }, '載入中…'));
  try {
    const d = await api('GET', '/api/notifications');
    const label = { like: '回應了你的文章', comment: '留言了你的文章', reply: '回覆了你的留言', mention: '在文章或留言中提到你', follow: '開始追蹤你', repost: '轉發了你的文章', quote: '引用了你的文章' };
    const sys = { moderation: '你的內容被處理了，點這裡看原因或申訴', appeal: '你的申訴有結果了' };
    main.replaceChildren(pageTitle('通知'),
      ...(d.notifications.length ? d.notifications.map((n) => sys[n.type]
        ? h('a', { class: 'post glass', href: '/moderation', style: `text-decoration:none;padding:12px 16px;align-items:center;${n.read ? '' : 'border-color:var(--accent)'}` },
          h('span', { class: 'avatar sm', style: 'background:var(--primary);color:#fff' }, '🛡️'), h('span', null, h('b', null, '窩Woo！管理團隊'), ' ', sys[n.type]), h('span', { class: 'time', style: 'margin-left:auto' }, timeAgo(n.created_at)))
        : h('a', { class: 'post glass', href: n.post_id ? `/p/${n.post_id}` : `/u/${n.actor.handle}`, style: `text-decoration:none;padding:12px 16px;align-items:center;${n.read ? '' : 'border-color:var(--accent)'}` },
        avatar(n.actor, 'sm'), h('span', null, h('b', null, n.actor.name), n.actor.is_content ? ' ✦' : '', ' ', label[n.type] || ''), h('span', { class: 'time', style: 'margin-left:auto' }, timeAgo(n.created_at))))
        : [h('div', { class: 'empty glass' }, '目前沒有通知')]));
    if (S.unread) { await api('POST', '/api/notifications/read'); S.unread = 0; }
  } catch (e) { main.replaceChildren(h('div', { class: 'empty err' }, e.message)); }
}

// ---------- 私訊 ----------
async function messagesPage() {
  const main = h('main', { class: 'main' });
  shell('/messages', main);
  if (!S.me) { main.append(h('div', { class: 'card glass' }, h('h2', null, '私訊'), loginButton())); return; }
  main.append(pageTitle('私訊'), h('div', { class: 'empty' }, '載入中…'));
  try {
    const d = await api('GET', '/api/messages');
    main.lastChild.replaceWith(d.conversations.length ? h('div', { class: 'stack', style: 'gap:8px' }, d.conversations.map((c) => h('a', { class: 'post glass', href: `/messages/${c.user.handle}`, style: `text-decoration:none;padding:12px 16px;align-items:center;${c.unread ? 'border-color:var(--accent)' : ''}` },
      avatar(c.user, 'sm'), h('div', { class: 'body', style: 'gap:2px' }, h('div', { class: 'row between' }, h('b', null, c.user.name), h('span', { class: 'time' }, timeAgo(c.last_message_at))), h('span', { class: 'muted', style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, c.last_text || '')))))
      : h('div', { class: 'empty glass' }, '還沒有私訊。到別人的個人頁按「私訊」就能開始聊天。'));
  } catch (e) { main.lastChild.replaceWith(h('div', { class: 'empty err' }, e.message)); }
}
let convTimer = null;
async function conversationPage(handle) {
  clearInterval(convTimer);
  const main = h('main', { class: 'main' });
  shell('/messages', main);
  if (!S.me) { main.append(loginButton()); return; }
  const list = h('div', { class: 'chat glass', 'aria-live': 'polite' });
  const ta = h('textarea', { rows: '1', maxlength: '1000', placeholder: '輸入訊息…' });
  const err = h('span', { class: 'err' });
  let last = '';
  const load = async () => {
    if (location.pathname !== `/messages/${handle}`) return clearInterval(convTimer);
    const d = await api('GET', `/api/messages/${handle}`);
    const sig = d.messages.map((m) => m.id).join();
    if (sig === last) return d;
    last = sig;
    list.replaceChildren(...(d.messages.length ? d.messages.map((m) => h('div', { class: `bubble ${m.mine ? 'mine' : ''}` }, h('span', null, m.text), h('small', null, timeAgo(m.created_at)))) : [h('div', { class: 'empty' }, '還沒有訊息，打聲招呼吧')]));
    list.scrollTop = list.scrollHeight;
    return d;
  };
  try {
    const d = await load();
    const send = async () => {
      const text = ta.value.trim();
      if (!text) return;
      err.textContent = '';
      try { await api('POST', `/api/messages/${handle}`, { text }); ta.value = ''; await load(); } catch (e) { err.textContent = e.message; }
    };
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
    main.append(
      h('div', { class: 'row' }, h('a', { class: 'icon-btn', href: '/messages' }, '← 私訊'), avatar(d.user, 'sm'), h('a', { href: `/u/${d.user.handle}`, style: 'text-decoration:none;font-weight:700' }, d.user.name)),
      list,
      d.can_send ? h('div', { class: 'composer glass', style: 'align-items:flex-end' }, h('label', { style: 'flex:1' }, h('span', { class: 'sr' }, '訊息內容'), ta), h('button', { class: 'btn', 'aria-label': '傳送', onclick: send }, icon('send'))) : h('div', { class: 'empty glass' }, '你無法傳私訊給這位用戶'),
      err);
    S.unreadMsg = Math.max(0, S.unreadMsg - 1);
    convTimer = setInterval(() => load().catch(() => {}), 5000);
  } catch (e) { main.append(h('div', { class: 'empty glass' }, e.message)); }
}

// ---------- 探索 ----------
async function explorePage() {
  const q0 = new URLSearchParams(location.search).get('q') || '';
  const input = h('input', { type: 'search', value: q0, placeholder: '搜尋人或文章', 'aria-label': '搜尋' });
  const results = h('div', { class: 'stack' });
  const main = h('main', { class: 'main' },
    h('form', { class: 'search', style: 'max-width:none;margin:0;display:flex', role: 'search', onsubmit: (e) => { e.preventDefault(); navigate(`/explore?q=${encodeURIComponent(input.value.trim())}`); } }, icon('search'), input),
    results);
  shell('/explore', main);
  if (!q0) {
    const d = await api('GET', '/api/feed?tab=hot').catch(() => ({ posts: [] }));
    results.append(h('h2', { class: 'subhead' }, '熱門文章'), ...d.posts.map((p) => postCard(p)));
    return;
  }
  if (q0.startsWith('#')) return navigate(`/tag/${encodeURIComponent(q0.slice(1))}`, true);
  results.append(h('div', { class: 'empty' }, '搜尋中…'));
  try {
    const d = await api('GET', `/api/search?q=${encodeURIComponent(q0)}`);
    results.replaceChildren(
      d.users.length ? h('div', { class: 'card glass' }, h('h2', null, '用戶'), ...d.users.map((u) => h('a', { class: 'uitem', href: `/u/${u.handle}` }, avatar(u, 'sm'), h('span', null, u.name, u.is_content ? ' ✦' : ''), h('span', { class: 'muted' }, `@${u.handle}`)))) : null,
      ...(d.posts.length ? d.posts.map((p) => postCard(p)) : [h('div', { class: 'empty glass' }, '找不到相關文章')]));
  } catch (e) { results.replaceChildren(h('div', { class: 'empty err' }, e.message)); }
}

// ---------- 設定 ----------
const THEMES = [
  ['forestsky', '森林晴空', '#F4F8F7', '#A9CC9F', '#A8CFF2'], ['mist', '暖霧', '#EFEEEA', '#EDB898', '#B8CBB4'], ['orangeblue', '橘藍', '#EEF0F7', '#FFB067', '#4A6CF0'],
  ['forest', '森林', '#EDF1EA', '#A9CC9F', '#EADBA6'], ['lavender', '薰衣草', '#F1EEF7', '#C9B6F2', '#FFC7A8'], ['ocean', '海洋', '#EBF4F4', '#7FD0CA', '#FFB6A3'],
  ['sakura', '櫻花', '#F8EEF1', '#F5B4C7', '#FFD8B8'], ['lemon', '檸檬', '#F6F4E9', '#FFE17A', '#FFB86B'], ['mono', '極簡黑白', '#EDEDED', '#D9D9D9', '#C4C4C4'],
];
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
async function pushState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !S.vapid) return 'unsupported';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  return sub ? 'on' : 'off';
}
function vapidKey(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function togglePush(on) {
  const reg = await navigator.serviceWorker.ready;
  if (on) {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('瀏覽器沒有允許通知，請到瀏覽器設定開啟');
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey(S.vapid) });
    await api('POST', '/api/push/subscribe', sub.toJSON());
  } else {
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
  }
}
async function settingsPage() {
  const cur = document.documentElement.dataset.theme || 'forestsky';
  const grid = h('div', { class: 'themes' }, THEMES.map(([id, name, bg, c1, c2]) => h('button', { class: `theme ${cur === id ? 'on' : ''}`, 'aria-pressed': String(cur === id), onclick: () => {
    applyTheme(id);
    if (S.me) api('PATCH', '/api/me', { theme: id }).catch(() => {});
    settingsPage();
  } }, h('span', { class: 'sw', style: `background:${bg}` }, h('i', { style: `background:${c1};top:-20px;left:-10px` }), h('i', { style: `background:${c2};bottom:-30px;right:-10px` })), h('b', null, name))));

  const op = h('input', { type: 'range', min: '20', max: '90', value: String(Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--op') || '0.55') * 100)), style: 'width:200px;accent-color:var(--primary)', 'aria-label': '卡片透明度' });
  op.addEventListener('input', () => { const v = (op.value / 100).toFixed(2); document.documentElement.style.setProperty('--op', v); try { localStorage.setItem('op', v); } catch {} });
  const large = document.documentElement.classList.contains('large');
  const sizeBtn = (on, label) => h('button', { class: `btn small ${on ? '' : 'ghost'}`, onclick: () => { document.documentElement.classList.toggle('large', label === '大'); try { localStorage.setItem('large', label === '大' ? '1' : '0'); } catch {} settingsPage(); } }, label);

  const sensitive = h('section', { class: 'card glass' }, h('h2', null, '敏感內容'));
  if (!S.me) sensitive.append(h('span', { class: 'muted' }, '登入並確認年滿 18 歲後才能開啟。'));
  else {
    const sw = h('button', { class: 'switch', role: 'switch', 'aria-checked': String(!!S.me.show_sensitive), 'aria-label': '顯示敏感內容' });
    const panel = h('div');
    sw.addEventListener('click', async () => {
      if (S.me.show_sensitive) { await api('PATCH', '/api/me', { show_sensitive: false }); await loadMe(); return settingsPage(); }
      if (S.me.age_verified) { await api('PATCH', '/api/me', { show_sensitive: true }); await loadMe(); return settingsPage(); }
      const err = h('span', { class: 'err' });
      const box = h('input', { type: 'checkbox', id: 'adult18' });
      const go = h('button', { class: 'btn small', disabled: true, onclick: async () => { try { await api('POST', '/api/age/verify', { confirm18: true }); await loadMe(); settingsPage(); } catch (e) { err.textContent = e.message; } } }, '開啟敏感內容');
      box.addEventListener('change', () => { go.disabled = !box.checked; });
      panel.replaceChildren(h('div', { class: 'notice' },
        h('label', { class: 'row', for: 'adult18', style: 'gap:8px;cursor:pointer' }, box, h('span', null, '我已年滿 18 歲，願意觀看敏感內容')),
        h('div', { class: 'row wrap' }, go, h('button', { class: 'icon-btn', onclick: () => panel.replaceChildren() }, '取消')), err));
    });
    sensitive.append(h('div', { class: 'row between' }, h('span', null, h('span', null, '顯示敏感內容'), h('br'), h('span', { class: 'muted' }, '開啟後，被標記為敏感的貼文會先模糊顯示，點擊才會看到。僅限年滿 18 歲。')), sw), panel);
  }

  const notifySec = h('section', { class: 'card glass' }, h('h2', null, '通知與 App'));
  const ps = S.me ? await pushState().catch(() => 'unsupported') : 'unsupported';
  if (S.me && ps !== 'unsupported') {
    const psw = h('button', { class: 'switch', role: 'switch', 'aria-checked': String(ps === 'on'), 'aria-label': '推播通知' });
    psw.addEventListener('click', async () => { try { await togglePush(psw.getAttribute('aria-checked') !== 'true'); settingsPage(); } catch (e) { toast(e.message); } });
    notifySec.append(h('div', { class: 'row between' }, h('span', null, '推播通知', h('br'), h('span', { class: 'muted' }, '有人按讚、留言、回覆、提到你或傳私訊時通知你')), psw));
  } else if (S.me) notifySec.append(h('span', { class: 'muted' }, '這個瀏覽器不支援推播通知。iPhone 請先「加入主畫面」，再從主畫面打開窩Woo！開啟通知。'));
  notifySec.append(h('div', { class: 'row between wrap' }, h('span', null, '加到手機主畫面', h('br'), h('span', { class: 'muted' }, '像 App 一樣從主畫面打開')),
    h('button', { class: 'btn ghost small', onclick: async () => {
      if (installPrompt) { installPrompt.prompt(); installPrompt = null; }
      else modal('加到主畫面', h('p', { style: 'margin:0' }, 'iPhone：用 Safari 打開窩Woo！，按下方「分享」→「加入主畫面」。'), h('p', { style: 'margin:0' }, 'Android：用 Chrome 打開，按右上角「⋮」→「加到主畫面」。'));
    } }, '加到主畫面')));

  const account = h('section', { class: 'card glass' }, h('h2', null, '帳號與隱私'));
  if (!S.me) account.append(loginButton());
  else {
    const blocks = h('div', { class: 'ulist' }, h('span', { class: 'muted' }, '載入中…'));
    api('GET', '/api/me/blocks').then((d) => blocks.replaceChildren(...(d.items.length ? d.items.map((x) => h('div', { class: 'row between' }, h('a', { class: 'uitem', href: `/u/${x.user.handle}` }, avatar(x.user, 'sm'), x.user.name, h('span', { class: 'pill' }, x.kind === 'block' ? '已封鎖' : '已靜音')),
      h('button', { class: 'btn ghost small', onclick: async () => { await api('DELETE', `/api/users/${x.user.handle}/${x.kind}`); settingsPage(); } }, x.kind === 'block' ? '解除封鎖' : '取消靜音'))) : [h('span', { class: 'muted' }, '沒有封鎖或靜音任何人')]))).catch(() => {});
    account.append(
      h('div', { class: 'row between wrap' }, h('span', { class: 'muted' }, `以 Google 帳號登入 · ${S.me.email || ''}`),
        h('button', { class: 'btn ghost small', onclick: async () => { await api('POST', '/auth/logout'); S.me = null; navigate('/'); } }, '登出')),
      h('h3', { class: 'subhead', style: 'margin:6px 0 0' }, '封鎖與靜音'), blocks,
      h('h3', { class: 'subhead', style: 'margin:6px 0 0' }, '我的資料'),
      h('div', { class: 'row wrap' },
        h('a', { class: 'btn ghost small', href: '/api/me/export', download: 'wooo-data.json' }, '下載我的資料'),
        h('button', { class: 'btn danger small', onclick: deleteAccountModal }, '刪除帳號')),
      h('span', { class: 'muted' }, h('a', { href: '/privacy' }, '隱私權政策'), ' · ', h('a', { href: '/terms' }, '使用條款')));
  }

  const main = h('main', { class: 'main' }, pageTitle('設定'),
    h('section', { class: 'card glass' }, h('h2', null, '外觀配色'), grid),
    h('section', { class: 'card glass' }, h('h2', null, '顯示'),
      h('label', { class: 'row between' }, '卡片透明度', op),
      h('div', { class: 'row between' }, '文字大小', h('div', { class: 'row' }, sizeBtn(!large, '標準'), sizeBtn(large, '大')))),
    mutedSection(), sensitive, notifySec, account,
    S.me ? h('section', { class: 'card glass' }, h('h2', null, '處理紀錄與申訴'), h('span', { class: 'muted' }, '如果你的內容或帳號曾被管理團隊處理，原因和申訴都在這裡。'), h('a', { class: 'btn ghost small', href: '/moderation', style: 'align-self:flex-start' }, '查看處理紀錄')) : null);
  shell('/settings', main);
}
function deleteAccountModal() {
  const input = h('input', { placeholder: S.me.handle, autocomplete: 'off' });
  const err = h('span', { class: 'err' });
  const m = modal('刪除帳號',
    h('p', { style: 'margin:0' }, '刪除後，你的文章、網誌、相簿、留言、按讚、追蹤和私訊都會永久刪除，無法復原。'),
    h('p', { style: 'margin:0' }, '建議先按「下載我的資料」備份。'),
    h('label', { class: 'field' }, `請輸入你的帳號名稱「${S.me.handle}」確認`, input), err,
    h('button', { class: 'btn danger', onclick: async () => {
      try { await api('DELETE', '/api/me', { confirm: input.value.trim() }); m.remove(); S.me = null; toast('帳號已刪除'); navigate('/'); }
      catch (e) { err.textContent = e.message; }
    } }, '永久刪除我的帳號'));
}

// ---------- 新手引導 ----------
async function onboarding() {
  let picked = [];
  const d = await api('GET', '/api/onboarding/suggestions');
  const step = h('div', { class: 'stack' });
  const m = modal('歡迎來到窩Woo！', step);
  const step1 = () => {
    const chips = h('div', { class: 'row wrap' }, d.interests.map((t) => {
      const b = h('button', { class: 'chip', 'aria-pressed': 'false' }, t);
      b.addEventListener('click', () => { const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on)); picked = on ? [...picked, t] : picked.filter((x) => x !== t); });
      return b;
    }));
    step.replaceChildren(h('p', { style: 'margin:0' }, '你對哪些主題有興趣？我們會推薦相關的帳號給你。'), chips,
      h('div', { class: 'row between' }, h('button', { class: 'icon-btn', onclick: finish }, '略過'),
        h('button', { class: 'btn', onclick: async () => { await api('POST', '/api/onboarding', { interests: picked }); const s = await api('GET', '/api/onboarding/suggestions'); step2(s.users); } }, '下一步')));
  };
  const step2 = (users) => {
    const chosen = new Set(users.slice(0, 5).map((u) => u.handle));
    const list = h('div', { class: 'ulist' }, users.map((u) => h('label', { class: 'row between' }, h('span', { class: 'row' }, avatar(u, 'sm'), u.name, u.is_content ? h('span', { class: 'star' }, '✦') : null),
      h('input', { type: 'checkbox', checked: chosen.has(u.handle) ? true : null, onchange: (e) => (e.target.checked ? chosen.add(u.handle) : chosen.delete(u.handle)), 'aria-label': `追蹤 ${u.name}` }))));
    step.replaceChildren(h('p', { style: 'margin:0' }, '追蹤幾個帳號，動態牆就不會空空的（✦ 是平台內容帳號）。'), users.length ? list : h('span', { class: 'muted' }, '目前沒有推薦'),
      h('button', { class: 'btn', onclick: () => finish([...chosen]) }, '開始使用'));
  };
  async function finish(follow = []) {
    await api('POST', '/api/onboarding', { interests: picked, follow, done: true }).catch(() => {});
    m.remove(); await loadMe(); S.feedTab = follow.length ? 'following' : 'hot'; render();
  }
  step1();
}

// ---------- 靜態頁 ----------
function aboutPage() {
  shell('/about', h('main', { class: 'main' },
    h('section', { class: 'card glass' }, h('h1', null, '關於窩Woo！'), h('p', { style: 'margin:0' }, '窩Woo！是一個可以慵懶窩著、隨意分享日常的社群：短短的動態、長長的網誌、一本本相簿，都歡迎。')),
    h('section', { class: 'card glass' }, h('h2', null, '說你想說的，不怕被消失'),
      h('p', { style: 'margin:0' }, '我們主張言論自由、暢所欲言。不會因為觀點或立場刪文，也不會無預警封號。'),
      h('ul', { class: 'list' },
        h('li', null, '只處理違法或嚴重違反社群規範的內容，規則寫在下面，看得到。'),
        h('li', null, '每次處理都會通知本人、說明原因。'),
        h('li', null, '處理後 30 天內都可以申訴，由真人審查。'),
        h('li', null, '每個月公開處理統計：', h('a', { href: '/transparency' }, '透明度報告'), '。'))),
    h('section', { class: 'card glass', id: 'content' }, h('h2', null, '✦ 平台內容帳號是什麼？'),
      h('p', { style: 'margin:0' }, '名稱旁邊有 ✦ 的帳號是「平台內容帳號」，由窩Woo！自動發布時事、遊戲、生活等內容，讓大家一進來就有東西可以看。這些帳號不是個人用戶，也不會主動和你互動或接收私訊。'),
      h('p', { style: 'margin:0' }, '時事類內容是根據新聞來源整理的重點摘要，並附上原文連結，完整內容請以原文為準。')),
    h('section', { class: 'card glass', id: 'rules' }, h('h2', null, '社群規範'),
      h('ul', { class: 'list' },
        h('li', null, '敏感內容必須在發文時勾選「標記敏感」，未標記會被強制標記或停權。'),
        h('li', null, '敏感內容不能用在大頭貼或個人頁橫幅。'),
        h('li', null, '嚴格禁止：任何涉及未成年的性相關內容（包含繪圖與 AI 生成）、未經當事人同意的私密影像、暴力或性虐待內容。違者立即刪除帳號並配合司法調查。'),
        h('li', null, '禁止騷擾、仇恨、詐騙、垃圾廣告與侵權內容。'),
        h('li', null, '看到違規內容請使用「⋯」裡的「檢舉」；不想看到某人，可以到他的個人頁封鎖或靜音。')))));
}
const LEGAL_NOTE = h('p', { class: 'notice', style: 'margin:0;font-size:13px' }, '本頁為範本草稿，正式上線前請由律師確認，並把 [ ] 內的資料換成實際內容。');
function legalPage(title, sections) {
  shell('', h('main', { class: 'main' }, h('section', { class: 'card glass legal' }, h('h1', null, title), h('span', { class: 'muted' }, '最後更新：[日期]'), LEGAL_NOTE.cloneNode(true),
    sections.map(([t, ...ps]) => [h('h2', null, t), ...ps.map((p) => (Array.isArray(p) ? h('ul', { class: 'list' }, p.map((x) => h('li', null, x))) : h('p', null, p)))]))));
}
function privacyPage() {
  legalPage('隱私權政策', [
    ['一、誰負責保護你的資料', '窩Woo！（以下稱「本平台」）由 [營運者名稱] 經營。對個人資料有任何問題，請來信 [聯絡 Email]。'],
    ['二、我們蒐集哪些資料', ['Google 帳號提供的姓名、Email 與帳號識別碼（用於登入）。', '你主動提供的內容：個人資料、文章、網誌、相簿、留言、私訊、檢舉內容。', '使用紀錄：登入時間、瀏覽個人頁的訪客統計（未登入者僅保存經雜湊處理的識別值，兩天後刪除）。', '年齡確認：只保存你是否已確認年滿 18 歲。', '推播通知訂閱資訊（你開啟推播時）。']],
    ['三、蒐集目的與使用方式', '提供社群服務、帳號管理、通知、內容審核與檢舉處理、防止濫用與詐騙、統計分析與服務改善。我們不會販售你的個人資料。'],
    ['四、資料保存與處理地點', '資料保存在 Cloudflare 提供的雲端服務（資料庫與圖片儲存），可能位於台灣以外的地區。時事內容的 AI 摘要由 Cloudflare Workers AI 處理，不會傳送你的個人資料。'],
    ['五、你的權利', '依個人資料保護法，你可以查詢、閱覽、取得副本、補充更正、要求停止蒐集處理利用，或要求刪除你的個人資料。你可以在「設定 → 帳號與隱私」直接下載你的資料或刪除帳號，其他請求請來信 [聯絡 Email]。'],
    ['六、Cookie', '本平台只使用維持登入狀態所必需的 Cookie，以及儲存你在本機選擇的外觀設定，不使用廣告追蹤 Cookie。'],
    ['七、未成年人', '敏感內容僅限確認年滿 18 歲的用戶開啟。未滿 18 歲的用戶請在法定代理人同意下使用本平台。'],
    ['八、政策修改', '本政策修改時會在本頁公告，重大變更會另以站內通知告知。'],
  ]);
}
function termsPage() {
  legalPage('使用條款', [
    ['一、接受條款', '使用窩Woo！（以下稱「本平台」）即表示你同意本條款與社群規範。若不同意，請停止使用。'],
    ['二、帳號', ['你必須使用自己的 Google 帳號登入，並對帳號下的所有行為負責。', '不得冒用他人身分、買賣或轉讓帳號。']],
    ['三、你的內容', '你保有自己發布內容的著作權，但同意授權本平台在提供服務的範圍內儲存、顯示與傳輸這些內容。你保證發布的內容不侵害他人權利。'],
    ['四、禁止行為', ['涉及未成年的性相關內容（包含繪圖與 AI 生成）、未經同意的私密影像、暴力或性虐待內容。', '騷擾、仇恨、詐騙、垃圾訊息、惡意程式、侵害著作權或隱私。', '未標記的敏感內容、在大頭貼或橫幅使用敏感內容。', '以自動化方式大量註冊、發文或擷取資料。']],
    ['五、敏感內容', '敏感內容須由發文者標記，且僅提供給確認年滿 18 歲並自行開啟的用戶觀看。'],
    ['六、✦ 平台內容帳號', '標示 ✦ 的帳號為本平台自動發布內容的帳號，時事摘要僅供參考，請以原始新聞來源為準。'],
    ['七、處置', '違反本條款或法律時，本平台得不經通知移除內容、停權或刪除帳號，並於必要時配合司法機關調查。'],
    ['八、免責', '本平台依現狀提供服務，不保證服務不中斷或無錯誤。用戶之間的互動與發布內容由發布者自行負責。'],
    ['九、準據法', '本條款以中華民國法律為準據法，並以 [管轄法院] 為第一審管轄法院。'],
  ]);
}

// ---------- 啟動 ----------
async function loadMe() {
  try {
    const d = await api('GET', '/api/me');
    S.me = d.user; S.unread = d.unread || 0; S.unreadMsg = d.unread_messages || 0; S.dev = !!d.dev_mode;
    S.turnstile = d.turnstile_sitekey || null; S.vapid = d.vapid_public_key || null; S.accents = d.accents || [];
    if (S.me?.theme) applyTheme(S.me.theme);
  } catch { S.me = null; }
}
function render() {
  const path = location.pathname;
  for (const [re, fn] of routes) { const m = path.match(re); if (m) return fn(m); }
  shell('', h('main', { class: 'main' }, h('div', { class: 'empty glass' }, '找不到這個頁面'), h('a', { class: 'btn', href: '/', style: 'align-self:center' }, '回首頁')));
}
// 每分鐘更新未讀數
setInterval(async () => {
  if (!S.me || document.hidden) return;
  const before = S.unread + S.unreadMsg;
  await loadMe();
  if (S.unread + S.unreadMsg !== before) document.querySelectorAll('nav.side, nav.bottom').forEach((n) => n.replaceWith(n.classList.contains('side') ? sideNav(location.pathname) : bottomNav(location.pathname)));
}, 60000);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
loadMe().then(() => { render(); if (S.me && !S.me.onboarded && !location.pathname.startsWith('/admin')) onboarding().catch(() => {}); });
