'use strict';
/* 窩Wooo！前端（不需要建置工具的單頁應用程式） */

const S = { me: null, unread: 0, dev: false, feedTab: 'hot' };
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
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m21 16-5-5-8 8"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  eyeoff: '<path d="M3 3l18 18"/><path d="M10.6 6.1A10 10 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-3 3.6M6.4 7.4C4.2 9 3 12 3 12s4 6 9 6a9 9 0 0 0 3.6-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
};
const icon = (n, extra = '') => h('span', { html: `<svg class="i ${extra}" viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`, style: 'display:inline-flex' });

async function api(method, path, body) {
  const opt = { method, headers: {} };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const res = await fetch(path, opt);
  let data = {};
  try { data = await res.json(); } catch {}
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
  const cls = `avatar ${size}`;
  const inner = u.avatar_url ? h('img', { src: u.avatar_url, alt: '' }) : (u.name || '?').slice(0, 1);
  return h('a', { class: cls, href: `/u/${u.handle}`, 'aria-label': `${u.name} 的個人頁` }, inner);
}
function richText(text) {
  const frag = [];
  const re = /(#[\p{L}\p{N}_]{1,20})|(https?:\/\/[^\s]+)/gu;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) frag.push(text.slice(last, m.index));
    if (m[1]) frag.push(h('a', { href: `/explore?q=${encodeURIComponent(m[1])}` }, m[1]));
    else frag.push(h('a', { href: m[2], target: '_blank', rel: 'noopener nofollow ugc' }, m[2]));
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.push(text.slice(last));
  return frag;
}
function modal(title, ...content) {
  const bg = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg) bg.remove(); } });
  const close = h('button', { class: 'icon-btn', 'aria-label': '關閉', onclick: () => bg.remove() }, icon('x'));
  bg.append(h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('div', { class: 'row between' }, h('h2', null, title), close), ...content));
  document.body.append(bg);
  const onKey = (e) => { if (e.key === 'Escape') { bg.remove(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  return bg;
}
function needLogin() {
  modal('先登入吧', h('p', null, '用 Google 帳號就能登入窩Wooo！，按讚、留言、發文。'), loginButton());
}
function loginButton() {
  const wrap = h('div', { class: 'row wrap' }, h('a', { class: 'btn', href: '/auth/google' }, '用 Google 登入'));
  if (S.dev) wrap.append(h('a', { class: 'btn ghost', href: '/auth/dev?email=tester@example.com&name=測試用戶' }, '測試登入（開發模式）'));
  return wrap;
}
function starButton(anchorLeft = 0) {
  const wrap = h('span', { style: 'position:relative;display:inline-flex' });
  const btn = h('button', { class: 'star', 'aria-label': '這個標記是什麼？', 'aria-expanded': 'false' }, '✦');
  btn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const open = wrap.querySelector('.tip');
    if (open) { open.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
    wrap.append(h('span', { class: 'tip', role: 'tooltip', style: `left:${anchorLeft}px` }, '平台內容帳號'));
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

// ---------- 路由 ----------
const routes = [
  [/^\/$/, () => feedPage()],
  [/^\/explore$/, () => explorePage()],
  [/^\/notifications$/, () => notificationsPage()],
  [/^\/settings$/, () => settingsPage()],
  [/^\/about$/, () => aboutPage()],
  [/^\/u\/([\w]+)$/, (m) => profilePage(m[1])],
  [/^\/p\/([\w]+)$/, (m) => postPage(m[1])],
  [/^\/admin(?:\/(\w+))?$/, (m) => adminPage(m[1] || 'dashboard')],
];
function navigate(path, replace = false) {
  if (replace) history.replaceState(null, '', path); else history.pushState(null, '', path);
  render();
  window.scrollTo(0, 0);
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a || a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/img/')) return;
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
    h('a', { class: 'logo', href: '/', 'aria-label': '窩Wooo！首頁' }, h('b', null, '窩'), h('span', null, 'Wooo！')),
    form, right);
}
function sideNav(path) {
  const link = (href, label, extra) => h('a', { href, class: path === href ? 'active' : '' }, label, extra);
  return h('nav', { class: 'side', 'aria-label': '主選單' },
    link('/', '首頁'), link('/explore', '探索'),
    link('/notifications', '通知', S.unread ? h('span', { class: 'dot', 'aria-label': `${S.unread} 則未讀` }) : null),
    S.me ? link(`/u/${S.me.handle}`, '個人頁') : null,
    link('/settings', '設定'),
    S.me?.role === 'gm' ? link('/admin', 'GM 後台') : null);
}
function bottomNav(path) {
  const link = (href, ic, label) => h('a', { href, class: path === href ? 'active' : '', 'aria-label': label }, icon(ic));
  return h('nav', { class: 'bottom', 'aria-label': '主選單' },
    link('/', 'home', '首頁'), link('/explore', 'search', '探索'), link('/notifications', 'bell', '通知'),
    S.me ? link(`/u/${S.me.handle}`, 'user', '個人頁') : link('/settings', 'gear', '設定'));
}
function aside() {
  const box = h('div', { class: 'box glass' }, h('h2', null, '今日話題'), h('span', { class: 'muted' }, '載入中…'));
  api('GET', '/api/topics').then((d) => {
    box.lastChild.remove();
    if (!d.topics.length) box.append(h('span', { class: 'muted' }, '還沒有話題，發文時加上 #標籤 吧'));
    for (const t of d.topics) box.append(h('a', { href: `/explore?q=${encodeURIComponent('#' + t.tag)}` }, `#${t.tag}`));
  }).catch(() => {});
  return h('aside', { class: 'side' }, box,
    h('p', { class: 'foot' }, h('a', { href: '/about' }, '關於'), ' · ', h('a', { href: '/about#content' }, '✦ 說明'), ' · ', h('a', { href: '/about#rules' }, '社群規範'), h('br'), '© 2026 窩Wooo！'));
}
function shell(path, mainEl) {
  app.replaceChildren(header(), h('div', { class: 'layout' }, sideNav(path), mainEl, aside()), bottomNav(path));
}

// ---------- 貼文卡片 ----------
function postCard(p, { onDelete } = {}) {
  const el = h('article', { class: 'post glass' });
  const likeBtn = h('button', { class: `icon-btn ${p.liked ? 'on' : ''}`, 'aria-label': p.liked ? '收回讚' : '按讚', 'aria-pressed': String(p.liked) });
  const drawLike = () => { likeBtn.replaceChildren(icon(p.liked ? 'heartFill' : 'heart'), String(p.like_count)); likeBtn.classList.toggle('on', p.liked); likeBtn.setAttribute('aria-pressed', String(p.liked)); likeBtn.setAttribute('aria-label', p.liked ? '收回讚' : '按讚'); };
  drawLike();
  likeBtn.addEventListener('click', async () => {
    if (!S.me) return needLogin();
    const was = p.liked;
    p.liked = !was; p.like_count += was ? -1 : 1; drawLike();
    try { await api(was ? 'DELETE' : 'POST', `/api/posts/${p.id}/like`); }
    catch (e) { p.liked = was; p.like_count += was ? 1 : -1; drawLike(); toast(e.message); }
  });

  let media = null;
  if (p.image_url) {
    const img = h('img', { src: p.image_url, alt: '貼文圖片', loading: 'lazy' });
    media = h('div', { class: `pimg ${p.sensitive ? 'blur' : ''}` }, img);
    if (p.sensitive) {
      const cover = h('button', { class: 'cover', 'aria-label': '敏感內容，點擊查看' }, icon('eyeoff'), h('b', null, '敏感內容'), h('span', null, '發文者已標記 · 點擊查看'));
      cover.addEventListener('click', () => { media.classList.remove('blur'); cover.remove(); });
      media.append(cover);
    }
  }
  let textEl = p.text ? h('p', { class: 'text' }, richText(p.text)) : null;
  if (p.sensitive && !p.image_url && textEl) {
    const hidden = textEl;
    textEl = h('button', { class: 'sens-text icon-btn', style: 'justify-content:flex-start;width:100%', onclick: () => textEl.replaceWith(hidden) }, icon('eyeoff'), '敏感內容 · 點擊查看');
  }

  const menuWrap = h('div', { class: 'menu' });
  const menuBtn = h('button', { class: 'icon-btn', 'aria-label': '更多選項', 'aria-haspopup': 'true' }, icon('more'));
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menuWrap.querySelector('.pop')) return menuWrap.querySelector('.pop').remove();
    const pop = h('div', { class: 'pop', role: 'menu' },
      h('button', { role: 'menuitem', onclick: () => { pop.remove(); likesModal(p.id); } }, '查看按讚名單'),
      h('button', { role: 'menuitem', onclick: () => { pop.remove(); navigator.clipboard?.writeText(`${location.origin}/p/${p.id}`); toast('已複製連結'); } }, '複製連結'),
      S.me && S.me.id !== p.author.id ? h('button', { role: 'menuitem', onclick: () => { pop.remove(); reportModal({ post_id: p.id }); } }, '檢舉') : null,
      S.me && (S.me.id === p.author.id || S.me.role === 'gm') ? h('button', { role: 'menuitem', style: 'color:#A32D2D', onclick: async () => {
        pop.remove();
        if (!confirm('確定要刪除這篇文章嗎？刪除後無法復原。')) return;
        try { await api('DELETE', `/api/posts/${p.id}`); el.remove(); toast('已刪除'); onDelete?.(); } catch (err) { toast(err.message); }
      } }, '刪除') : null);
    menuWrap.append(pop);
    setTimeout(() => document.addEventListener('click', () => pop.remove(), { once: true }), 0);
  });
  menuWrap.append(menuBtn);

  el.append(
    avatar(p.author),
    h('div', { class: 'body' },
      h('div', { class: 'meta' },
        h('a', { class: 'name', href: `/u/${p.author.handle}` }, p.author.name),
        p.author.is_content ? starButton(0) : null,
        h('a', { class: 'time', href: `/p/${p.id}`, style: 'text-decoration:none' }, timeAgo(p.created_at))),
      textEl,
      p.link ? h('a', { class: 'linkcard', href: p.link.url, target: '_blank', rel: 'noopener nofollow' }, h('small', null, p.link.site || '新聞來源'), h('b', null, p.link.title || p.link.url)) : null,
      media,
      h('div', { class: 'actions' }, likeBtn,
        h('a', { class: 'icon-btn', href: `/p/${p.id}`, 'aria-label': '留言' }, icon('chat'), String(p.comment_count)),
        menuWrap)));
  return el;
}
async function likesModal(id) {
  const list = h('div', { class: 'ulist' }, h('span', { class: 'muted' }, '載入中…'));
  const m = modal('按讚名單', list);
  try {
    const d = await api('GET', `/api/posts/${id}/likes`);
    list.replaceChildren(...(d.users.length ? d.users.map((u) => h('a', { class: 'uitem', href: `/u/${u.handle}`, onclick: () => m.remove() }, avatar(u, 'sm'), h('span', null, u.name), u.is_content ? h('span', { class: 'star', 'aria-label': '平台內容帳號' }, '✦') : null)) : [h('span', { class: 'muted' }, '還沒有人按讚')]));
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

// ---------- 發文框 ----------
function composer(onPosted) {
  const ta = h('textarea', { rows: '2', maxlength: '1000', placeholder: '有什麼想說的？' });
  const sens = h('input', { type: 'checkbox' });
  const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', class: 'sr', id: 'cfile' });
  const preview = h('div');
  const err = h('span', { class: 'err' });
  let imageKey = null;
  const send = h('button', { class: 'btn' }, '發布');
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    err.textContent = '';
    try {
      const blob = await shrinkImage(f);
      const fd = new FormData(); fd.append('file', blob, 'image');
      send.disabled = true;
      const d = await api('POST', '/api/upload', fd);
      imageKey = d.key;
      preview.replaceChildren(h('div', { class: 'preview' }, h('img', { src: d.url, alt: '預覽' }),
        h('button', { class: 'btn ghost small', style: 'position:absolute;top:6px;left:6px', onclick: () => { imageKey = null; preview.replaceChildren(); } }, '移除')));
    } catch (e) { err.textContent = e.message; } finally { send.disabled = false; file.value = ''; }
  });
  send.addEventListener('click', async () => {
    err.textContent = '';
    if (!ta.value.trim() && !imageKey) { err.textContent = '寫點什麼或加張圖片吧'; ta.focus(); return; }
    send.disabled = true;
    try {
      await api('POST', '/api/posts', { text: ta.value, image_key: imageKey, sensitive: sens.checked });
      ta.value = ''; imageKey = null; preview.replaceChildren(); sens.checked = false;
      toast('已發布'); onPosted?.();
    } catch (e) { err.textContent = e.message; } finally { send.disabled = false; }
  });
  return h('section', { class: 'composer glass', 'aria-label': '發表新文章' }, avatar(S.me),
    h('div', { style: 'flex:1;min-width:0' },
      h('label', null, h('span', { class: 'sr' }, '文章內容'), ta), preview, err,
      h('div', { class: 'row' },
        h('label', { for: 'cfile', class: 'icon-btn', style: 'color:var(--primary)', 'aria-label': '加入圖片', tabindex: '0', onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') file.click(); } }, icon('image')), file,
        h('label', { class: 'check' }, sens, '標記敏感'),
        h('span', { style: 'flex:1' }), send)));
}
/** 上傳前在瀏覽器縮圖並轉成 WebP，省空間又快 */
async function shrinkImage(f) {
  if (f.type === 'image/gif') return f;
  const bmp = await createImageBitmap(f).catch(() => null);
  if (!bmp) return f;
  const max = 1600, scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.82));
  return blob && blob.size < f.size ? new File([blob], 'image.webp', { type: 'image/webp' }) : f;
}

// ---------- 頁面 ----------
function feedPage() {
  const list = h('div', { style: 'display:flex;flex-direction:column;gap:12px' });
  const more = h('button', { class: 'btn ghost', style: 'align-self:center' }, '載入更多');
  let offset = 0, before = 0, loading = false;
  const load = async (reset) => {
    if (loading) return; loading = true;
    if (reset) { list.replaceChildren(h('div', { class: 'empty' }, '載入中…')); offset = 0; before = 0; }
    try {
      const qs = S.feedTab === 'hot' ? `tab=hot&offset=${offset}` : `tab=following${before ? `&before=${before}` : ''}`;
      const d = await api('GET', `/api/feed?${qs}`);
      if (reset) list.replaceChildren();
      if (reset && !d.posts.length) list.append(h('div', { class: 'empty glass' }, S.feedTab === 'following' ? (S.me ? '你追蹤的人還沒有發文，去探索看看吧' : '登入後就能看到你追蹤的人') : '還沒有文章，來發第一篇吧'));
      for (const p of d.posts) list.append(postCard(p));
      offset += d.posts.length;
      if (d.posts.length) before = d.posts[d.posts.length - 1].created_at;
      more.style.display = d.posts.length >= 20 ? '' : 'none';
    } catch (e) { list.replaceChildren(h('div', { class: 'empty err' }, e.message)); }
    loading = false;
  };
  more.addEventListener('click', () => load(false));
  const tab = (key, label) => h('button', { class: S.feedTab === key ? 'on' : '', role: 'tab', 'aria-selected': String(S.feedTab === key), onclick: () => { S.feedTab = key; render(); } }, label);
  const main = h('main', { class: 'main' },
    S.me ? composer(() => load(true)) : h('div', { class: 'card glass' }, h('h2', null, '歡迎來到窩Wooo！'), h('p', { style: 'margin:0' }, '一個可以慵懶窩著、隨意分享日常的地方。'), loginButton()),
    h('div', { class: 'tabs', role: 'tablist', 'aria-label': '動態牆' }, tab('following', '追蹤中'), tab('hot', '熱門')),
    list, more);
  shell('/', main);
  load(true);
}

async function postPage(id) {
  const main = h('main', { class: 'main' }, h('div', { class: 'empty' }, '載入中…'));
  shell('', main);
  try {
    const d = await api('GET', `/api/posts/${id}`);
    const comments = h('div', { style: 'display:flex;flex-direction:column;gap:10px' });
    const drawComments = (list) => comments.replaceChildren(...list.map((c) => h('div', { class: 'post glass', style: 'padding:12px 16px' }, avatar(c.author, 'sm'),
      h('div', { class: 'body' },
        h('div', { class: 'meta' }, h('a', { class: 'name', href: `/u/${c.author.handle}`, style: 'font-size:14px' }, c.author.name), c.author.is_content ? starButton(0) : null, h('span', { class: 'time' }, timeAgo(c.created_at)),
          S.me ? h('span', { style: 'margin-left:auto;display:flex;gap:4px' },
            S.me.id !== c.author.id ? h('button', { class: 'icon-btn', onclick: () => reportModal({ comment_id: c.id }) }, '檢舉') : null,
            S.me.id === c.author.id || S.me.role === 'gm' ? h('button', { class: 'icon-btn', onclick: async () => { if (!confirm('刪除這則留言？')) return; try { await api('DELETE', `/api/comments/${c.id}`); postPage(id); } catch (e) { toast(e.message); } } }, '刪除') : null) : null),
        h('p', { class: 'text', style: 'font-size:14px' }, richText(c.text))))));
    drawComments(d.comments);
    let form;
    if (S.me) {
      const ta = h('textarea', { rows: '2', maxlength: '500', placeholder: '留個言吧' });
      const err = h('span', { class: 'err' });
      form = h('div', { class: 'composer glass' }, avatar(S.me, 'sm'), h('div', { style: 'flex:1' }, h('label', null, h('span', { class: 'sr' }, '留言內容'), ta), err,
        h('div', { class: 'row', style: 'justify-content:flex-end' }, h('button', { class: 'btn small', onclick: async () => {
          if (!ta.value.trim()) { err.textContent = '留言不能空白'; return; }
          try { await api('POST', `/api/posts/${id}/comments`, { text: ta.value }); postPage(id); } catch (e) { err.textContent = e.message; }
        } }, '留言'))));
    } else form = h('div', { class: 'card glass' }, h('span', null, '登入後就能留言'), loginButton());
    main.replaceChildren(postCard(d.post, { onDelete: () => navigate('/') }), form, h('h2', { style: 'margin:8px 4px 0;font-family:var(--round);font-size:16px' }, `留言 ${d.comments.length}`), comments);
  } catch (e) { main.replaceChildren(h('div', { class: 'empty glass' }, e.message)); }
}

async function profilePage(handle) {
  const main = h('main', { class: 'main' }, h('div', { class: 'empty' }, '載入中…'));
  shell(S.me && S.me.handle === handle ? `/u/${handle}` : '', main);
  try {
    const d = await api('GET', `/api/users/${handle}`);
    const u = d.user;
    const isMe = S.me && S.me.id === u.id;
    let action = null;
    if (isMe) action = h('button', { class: 'btn ghost small', onclick: () => editProfile(u) }, '編輯個人資料');
    else if (!u.is_content || true) {
      let following = d.is_following;
      action = h('button', { class: following ? 'btn ghost small' : 'btn small' }, following ? '追蹤中' : '追蹤');
      action.addEventListener('click', async () => {
        if (!S.me) return needLogin();
        try { await api(following ? 'DELETE' : 'POST', `/api/users/${handle}/follow`); following = !following; action.textContent = following ? '追蹤中' : '追蹤'; action.className = following ? 'btn ghost small' : 'btn small'; } catch (e) { toast(e.message); }
      });
    }
    const head = h('section', { class: 'card glass' },
      h('div', { class: 'row between' }, h('span', { class: 'avatar lg' }, u.avatar_url ? h('img', { src: u.avatar_url, alt: '' }) : u.name.slice(0, 1)), action),
      h('div', null, h('h1', { style: 'font-size:22px' }, u.name, u.is_content ? starButton(0) : null), h('span', { class: 'muted' }, `@${u.handle}`)),
      u.is_content ? h('p', { class: 'notice', style: 'margin:0;font-size:13px' }, '✦ 這是平台內容帳號，由窩Wooo！自動發布內容。') : null,
      u.bio ? h('p', { style: 'margin:0;white-space:pre-wrap' }, u.bio) : null,
      h('div', { class: 'row', style: 'gap:18px;font-size:14px' }, h('span', null, h('b', null, d.following), ' 追蹤中'), h('span', null, h('b', null, d.followers), ' 粉絲')));
    main.replaceChildren(head, ...(d.posts.length ? d.posts.map((p) => postCard(p)) : [h('div', { class: 'empty glass' }, '還沒有文章')]));
  } catch (e) { main.replaceChildren(h('div', { class: 'empty glass' }, e.message)); }
}
function editProfile(u) {
  const name = h('input', { value: u.name, maxlength: '40' });
  const bio = h('textarea', { rows: '3', maxlength: '200' }); bio.value = u.bio || '';
  const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
  const err = h('span', { class: 'err' });
  const m = modal('編輯個人資料',
    h('label', { class: 'field' }, '名稱', name), h('label', { class: 'field' }, '自我介紹', bio),
    h('label', { class: 'field' }, '大頭貼（不可使用敏感內容）', file), err,
    h('button', { class: 'btn', onclick: async () => {
      try {
        const body = { name: name.value, bio: bio.value };
        if (file.files[0]) { const fd = new FormData(); fd.append('file', await shrinkImage(file.files[0]), 'avatar'); body.avatar_key = (await api('POST', '/api/upload', fd)).key; }
        await api('PATCH', '/api/me', body);
        m.remove(); await loadMe(); profilePage(u.handle);
      } catch (e) { err.textContent = e.message; }
    } }, '儲存'));
}

async function notificationsPage() {
  const main = h('main', { class: 'main' });
  shell('/notifications', main);
  if (!S.me) { main.append(h('div', { class: 'card glass' }, h('h2', null, '通知'), h('span', null, '登入後就能看到誰按讚、留言或追蹤你'), loginButton())); return; }
  main.append(h('div', { class: 'empty' }, '載入中…'));
  try {
    const d = await api('GET', '/api/notifications');
    const label = { like: '按讚了你的文章', comment: '留言了你的文章', follow: '開始追蹤你' };
    main.replaceChildren(h('h1', { style: 'margin:0 4px;font-family:var(--round);font-size:24px;color:var(--strong)' }, '通知'),
      ...(d.notifications.length ? d.notifications.map((n) => h('a', { class: 'post glass', href: n.post_id ? `/p/${n.post_id}` : `/u/${n.actor.handle}`, style: `text-decoration:none;padding:12px 16px;align-items:center;${n.read ? '' : 'border-color:var(--accent)'}` },
        avatar(n.actor, 'sm'), h('span', null, h('b', null, n.actor.name), n.actor.is_content ? ' ✦' : '', ' ', label[n.type] || ''), h('span', { class: 'time', style: 'margin-left:auto' }, timeAgo(n.created_at))))
        : [h('div', { class: 'empty glass' }, '目前沒有通知')]));
    if (S.unread) { await api('POST', '/api/notifications/read'); S.unread = 0; }
  } catch (e) { main.replaceChildren(h('div', { class: 'empty err' }, e.message)); }
}

async function explorePage() {
  const q0 = new URLSearchParams(location.search).get('q') || '';
  const input = h('input', { type: 'search', value: q0, placeholder: '搜尋人或文章', 'aria-label': '搜尋' });
  const results = h('div', { style: 'display:flex;flex-direction:column;gap:12px' });
  const main = h('main', { class: 'main' },
    h('form', { class: 'search', style: 'max-width:none;margin:0;display:flex', role: 'search', onsubmit: (e) => { e.preventDefault(); navigate(`/explore?q=${encodeURIComponent(input.value.trim())}`); } }, icon('search'), input),
    results);
  shell('/explore', main);
  if (!q0) {
    const d = await api('GET', '/api/feed?tab=hot').catch(() => ({ posts: [] }));
    results.append(h('h2', { style: 'margin:4px;font-family:var(--round);font-size:16px' }, '熱門文章'), ...d.posts.map((p) => postCard(p)));
    return;
  }
  results.append(h('div', { class: 'empty' }, '搜尋中…'));
  try {
    const d = await api('GET', `/api/search?q=${encodeURIComponent(q0)}`);
    results.replaceChildren(
      d.users.length ? h('div', { class: 'card glass' }, h('h2', null, '用戶'), ...d.users.map((u) => h('a', { class: 'uitem', href: `/u/${u.handle}` }, avatar(u, 'sm'), h('span', null, u.name, u.is_content ? ' ✦' : ''), h('span', { class: 'muted' }, `@${u.handle}`)))) : null,
      ...(d.posts.length ? d.posts.map((p) => postCard(p)) : [h('div', { class: 'empty glass' }, '找不到相關文章')]));
  } catch (e) { results.replaceChildren(h('div', { class: 'empty err' }, e.message)); }
}

const THEMES = [
  ['forestsky', '森林晴空', '#F4F8F7', '#A9CC9F', '#A8CFF2'], ['mist', '暖霧', '#EFEEEA', '#EDB898', '#B8CBB4'], ['orangeblue', '橘藍', '#EEF0F7', '#FFB067', '#4A6CF0'],
  ['forest', '森林', '#EDF1EA', '#A9CC9F', '#EADBA6'], ['lavender', '薰衣草', '#F1EEF7', '#C9B6F2', '#FFC7A8'], ['ocean', '海洋', '#EBF4F4', '#7FD0CA', '#FFB6A3'],
  ['sakura', '櫻花', '#F8EEF1', '#F5B4C7', '#FFD8B8'], ['lemon', '檸檬', '#F6F4E9', '#FFE17A', '#FFB86B'], ['mono', '極簡黑白', '#EDEDED', '#D9D9D9', '#C4C4C4'],
];
function settingsPage() {
  const cur = document.documentElement.dataset.theme || 'forestsky';
  const grid = h('div', { class: 'themes' }, THEMES.map(([id, name, bg, c1, c2]) => h('button', { class: `theme ${cur === id ? 'on' : ''}`, 'aria-pressed': String(cur === id), onclick: async () => {
    applyTheme(id);
    if (S.me) api('PATCH', '/api/me', { theme: id }).catch(() => {});
    settingsPage();
  } }, h('span', { class: 'sw', style: `background:${bg}` }, h('i', { style: `background:${c1};top:-20px;left:-10px` }), h('i', { style: `background:${c2};bottom:-30px;right:-10px` })), h('b', null, name))));

  const op = h('input', { type: 'range', min: '20', max: '90', value: String(Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--op') || '0.55') * 100)), style: 'width:200px;accent-color:var(--primary)', 'aria-label': '卡片透明度' });
  op.addEventListener('input', () => { const v = (op.value / 100).toFixed(2); document.documentElement.style.setProperty('--op', v); try { localStorage.setItem('op', v); } catch {} });
  const large = document.documentElement.classList.contains('large');
  const sizeBtn = (on, label) => h('button', { class: `btn small ${on ? '' : 'ghost'}`, onclick: () => { document.documentElement.classList.toggle('large', label === '大'); try { localStorage.setItem('large', label === '大' ? '1' : '0'); } catch {} settingsPage(); } }, label);

  const sensitive = h('section', { class: 'card glass' }, h('h2', null, '敏感內容'));
  if (!S.me) sensitive.append(h('span', { class: 'muted' }, '登入並完成年齡驗證後才能開啟。'));
  else {
    const sw = h('button', { class: 'switch', role: 'switch', 'aria-checked': String(!!S.me.show_sensitive), 'aria-label': '顯示敏感內容' });
    const panel = h('div');
    sw.addEventListener('click', async () => {
      if (S.me.show_sensitive) { await api('PATCH', '/api/me', { show_sensitive: false }); await loadMe(); return settingsPage(); }
      if (S.me.age_verified) { await api('PATCH', '/api/me', { show_sensitive: true }); await loadMe(); return settingsPage(); }
      const err = h('span', { class: 'err' });
      const verify = async () => { try { await api('POST', '/api/age/verify', { method: 'card' }); await loadMe(); settingsPage(); } catch (e) { err.textContent = e.message; } };
      panel.replaceChildren(h('div', { class: 'notice' },
        h('b', { style: 'font-family:var(--round)' }, '需要先完成年齡驗證'),
        h('span', { style: 'font-size:14px' }, '依台灣法規，觀看敏感內容前必須確認你已年滿 18 歲，自己填生日不算數。'),
        h('div', { class: 'row wrap' }, h('button', { class: 'btn small', onclick: verify }, '信用卡驗證'), h('button', { class: 'btn ghost small', onclick: verify }, '身分證件驗證'), h('button', { class: 'icon-btn', onclick: () => panel.replaceChildren() }, '取消')),
        err, h('span', { class: 'muted' }, '驗證由第三方服務處理，窩Wooo！只記錄「已滿 18 歲」的結果，不保存卡號或證件影像。')));
    });
    sensitive.append(h('div', { class: 'row between' }, h('span', null, h('span', null, '顯示敏感內容'), h('br'), h('span', { class: 'muted' }, '開啟後，被標記為敏感的貼文會先模糊顯示，點擊才會看到。未滿 18 歲或未完成驗證的帳號永遠看不到。')), sw), panel,
      S.me.age_verified ? h('span', { class: 'ok' }, '✓ 已完成年齡驗證（18 歲以上）') : null);
  }

  const main = h('main', { class: 'main' },
    h('h1', { style: 'margin:0 4px;font-family:var(--round);font-size:26px;color:var(--strong)' }, '設定'),
    h('section', { class: 'card glass' }, h('h2', null, '外觀配色'), grid),
    h('section', { class: 'card glass' }, h('h2', null, '顯示'),
      h('label', { class: 'row between' }, '卡片透明度', op),
      h('div', { class: 'row between' }, '文字大小', h('div', { class: 'row' }, sizeBtn(!large, '標準'), sizeBtn(large, '大')))),
    sensitive,
    h('section', { class: 'card glass' }, h('h2', null, '帳號'),
      S.me ? h('div', { class: 'row between wrap' }, h('span', { class: 'muted' }, `以 Google 帳號登入 · ${S.me.email || ''}`),
        h('button', { class: 'btn ghost small', onclick: async () => { await api('POST', '/auth/logout'); S.me = null; navigate('/'); } }, '登出')) : loginButton()));
  shell('/settings', main);
}

function aboutPage() {
  const main = h('main', { class: 'main' },
    h('section', { class: 'card glass' }, h('h1', null, '關於窩Wooo！'), h('p', { style: 'margin:0' }, '窩Wooo！是一個可以慵懶窩著、隨意分享日常的社群。')),
    h('section', { class: 'card glass', id: 'content' }, h('h2', null, '✦ 平台內容帳號是什麼？'),
      h('p', { style: 'margin:0' }, '名稱旁邊有 ✦ 的帳號是「平台內容帳號」，由窩Wooo！自動發布時事、遊戲、生活等內容，讓大家一進來就有東西可以看。這些帳號不是個人用戶，也不會主動和你互動。'),
      h('p', { style: 'margin:0' }, '時事類內容是根據新聞來源整理的重點摘要，並附上原文連結，完整內容請以原文為準。')),
    h('section', { class: 'card glass', id: 'rules' }, h('h2', null, '社群規範'),
      h('ul', { style: 'margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px' },
        h('li', null, '敏感內容必須在發文時勾選「標記敏感」，未標記會被強制標記或停權。'),
        h('li', null, '敏感內容不能用在大頭貼；只有年滿 18 歲、完成年齡驗證並自行開啟的用戶看得到。'),
        h('li', null, '嚴格禁止：任何涉及未成年的性相關內容（包含繪圖與 AI 生成）、未經當事人同意的私密影像、暴力或性虐待內容。違者立即停權並配合司法調查。'),
        h('li', null, '禁止騷擾、仇恨、詐騙、垃圾廣告與侵權內容。'),
        h('li', null, '看到違規內容請使用貼文右下角「⋯」裡的「檢舉」。'))));
  shell('/about', main);
}

// ---------- GM 後台 ----------
async function adminPage(tab) {
  if (!S.me || S.me.role !== 'gm') { shell('', h('main', { class: 'main' }, h('div', { class: 'empty glass' }, '只有 GM 可以使用後台'))); return; }
  const tabs = [['dashboard', '儀表板'], ['users', '用戶管理'], ['posts', '內容管理'], ['reports', '檢舉處理'], ['content', '✦ 內容帳號'], ['news', '新聞來源']];
  const nav = h('nav', { 'aria-label': '後台選單' },
    h('a', { href: '/', style: 'margin-bottom:12px' }, '← 回到網站'),
    tabs.map(([k, l]) => h('a', { href: k === 'dashboard' ? '/admin' : `/admin/${k}`, class: tab === k ? 'active' : '' }, l)));
  const main = h('main', null, h('div', { class: 'empty' }, '載入中…'));
  app.replaceChildren(header(), h('div', { class: 'admin' }, nav, main));
  try { await ADMIN[tab]?.(main); } catch (e) { main.replaceChildren(h('div', { class: 'empty err' }, e.message)); }
}
const fmt = (t) => (t ? new Date(t).toLocaleString('zh-TW', { hour12: false }) : '—');
const REASON = { spam: '垃圾訊息', harassment: '騷擾', copyright: '侵權', unmarked_sensitive: '未標記敏感內容', illegal: '違法內容', other: '其他' };
const GROUP = { news: '時事', game: '遊戲', mixed: '綜合' };
function table(cols, rows) {
  return h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, h('tr', null, cols.map((c) => h('th', { scope: 'col' }, c)))), h('tbody', null, rows)));
}
function sw(on, onToggle, label) {
  const b = h('button', { class: 'switch', role: 'switch', 'aria-checked': String(!!on), 'aria-label': label });
  b.addEventListener('click', async () => { const next = b.getAttribute('aria-checked') !== 'true'; try { await onToggle(next); b.setAttribute('aria-checked', String(next)); } catch (e) { toast(e.message); } });
  return b;
}
const ADMIN = {
  async dashboard(main) {
    const d = await api('GET', '/api/admin/dashboard');
    const s = d.stats;
    const stat = (l, v) => h('div', { class: 'stat glass' }, h('span', { class: 'muted' }, l), h('b', null, v));
    const paused = d.content.paused_until > Date.now();
    main.replaceChildren(h('h1', null, '儀表板'),
      h('div', { class: 'stats' }, stat('今日新用戶', s.newUsers), stat('今日真人發文', s.realPosts), stat('今日 ✦ 發文', s.contentPosts), stat('待處理檢舉', s.openReports)),
      h('section', { class: 'card glass' }, h('div', { class: 'row between wrap' },
        h('div', null, h('h2', null, '✦ 內容帳號自動發文'), h('span', { class: 'muted' }, `${d.content.enabled_accounts} 個帳號啟用中 · 每 ${d.content.interval_min} 分鐘一則${paused ? ` · 暫停到 ${fmt(d.content.paused_until)}` : ''}`)),
        h('div', { class: 'row wrap' },
          h('button', { class: 'btn ghost small', onclick: async () => { await api('PATCH', '/api/admin/settings', { paused_until: paused ? 0 : Date.now() + 3600_000 }); navigate('/admin', true); } }, paused ? '取消暫停' : '暫停 1 小時'),
          h('a', { class: 'btn ghost small', href: '/admin/content' }, '前往設定'),
          sw(d.content.enabled, (v) => api('PATCH', '/api/admin/settings', { content_enabled: v ? '1' : '0' }), '自動發文總開關')))),
      h('section', { class: 'card glass' }, h('h2', null, '新進用戶'), `總用戶數：${s.totalUsers}`,
        h('div', { class: 'ulist' }, d.latest_users.map((u) => h('a', { class: 'uitem', href: `/u/${u.handle}` }, avatar({ ...u, avatar_url: u.avatar_key ? `/img/${u.avatar_key}` : null }, 'sm'), u.name, h('span', { class: 'muted' }, fmt(u.created_at)))))));
  },
  async users(main) {
    const q = new URLSearchParams(location.search).get('q') || '';
    const d = await api('GET', `/api/admin/users?q=${encodeURIComponent(q)}`);
    const input = h('input', { value: q, placeholder: '搜尋名稱、帳號或 Email', 'aria-label': '搜尋用戶' });
    const statusLabel = { active: '正常', suspended: '停權（可看不可發）', banned: '封鎖' };
    main.replaceChildren(h('h1', null, '用戶管理'),
      h('form', { class: 'search', style: 'margin:0;max-width:420px;display:flex', onsubmit: (e) => { e.preventDefault(); navigate(`/admin/users?q=${encodeURIComponent(input.value)}`); } }, icon('search'), input),
      h('section', { class: 'card glass' }, table(['用戶', 'Email', '角色', '年齡驗證', '文章', '加入', '狀態'], d.users.map((u) => {
        const sel = h('select', { 'aria-label': `${u.name} 的狀態`, disabled: u.id === S.me.id ? true : null }, Object.entries(statusLabel).map(([v, l]) => h('option', { value: v, selected: u.status === v ? true : null }, l)));
        sel.addEventListener('change', async () => { if (sel.value === 'banned' && !confirm(`確定封鎖 ${u.name}？`)) { sel.value = u.status; return; } try { await api('POST', `/api/admin/users/${u.id}/status`, { status: sel.value }); u.status = sel.value; toast('已更新'); } catch (e) { toast(e.message); sel.value = u.status; } });
        return h('tr', null, h('td', null, h('a', { href: `/u/${u.handle}` }, u.name), h('br'), h('span', { class: 'muted' }, `@${u.handle}`)), h('td', null, u.email || '—'), h('td', null, u.role === 'gm' ? 'GM' : '用戶'), h('td', null, u.age_verified ? '已驗證' : '—'), h('td', null, u.posts), h('td', null, fmt(u.created_at)), h('td', null, sel));
      }))));
  },
  async posts(main) {
    const src = new URLSearchParams(location.search).get('source') || '';
    const d = await api('GET', `/api/admin/posts${src ? `?source=${src}` : ''}`);
    const act = async (id, action) => { if (action === 'delete' && !confirm('確定刪除？無法復原。')) return; await api('POST', `/api/admin/posts/${id}`, { action }); ADMIN.posts(main); };
    const f = (v, l) => h('button', { class: src === v ? 'on' : '', onclick: () => navigate(`/admin/posts${v ? `?source=${v}` : ''}`) }, l);
    main.replaceChildren(h('h1', null, '內容管理'), h('div', { class: 'tabs' }, f('', '全部'), f('user', '真人'), f('content', '✦ 內容帳號')),
      h('section', { class: 'card glass' }, table(['作者', '內容', '讚（真人）', '留言', '時間', '狀態', '處理'], d.posts.map((p) => h('tr', null,
        h('td', null, p.name, p.is_content ? ' ✦' : ''), h('td', { style: 'max-width:280px' }, h('a', { href: `/p/${p.id}` }, (p.text || '（圖片）').slice(0, 60))),
        h('td', null, `${p.like_count}（${p.real_like_count}）`), h('td', null, p.comment_count), h('td', null, fmt(p.created_at)),
        h('td', null, p.hidden ? h('span', { class: 'pill warn' }, '已隱藏') : '顯示', p.sensitive ? h('span', { class: 'pill' }, '敏感') : null),
        h('td', { style: 'white-space:nowrap' }, h('button', { class: 'btn ghost small', onclick: () => act(p.id, p.hidden ? 'unhide' : 'hide') }, p.hidden ? '取消隱藏' : '隱藏'), ' ',
          p.sensitive ? null : h('button', { class: 'btn ghost small', onclick: () => act(p.id, 'mark_sensitive') }, '標記敏感'), ' ',
          h('button', { class: 'btn danger small', onclick: () => act(p.id, 'delete') }, '刪除')))))));
  },
  async reports(main) {
    const st = new URLSearchParams(location.search).get('status') || 'open';
    const d = await api('GET', `/api/admin/reports?status=${st}`);
    const act = async (id, action) => { await api('POST', `/api/admin/reports/${id}`, { action }); toast('已處理'); ADMIN.reports(main); };
    const f = (v, l) => h('button', { class: st === v ? 'on' : '', onclick: () => navigate(`/admin/reports?status=${v}`) }, l);
    main.replaceChildren(h('h1', null, '檢舉處理'), h('div', { class: 'tabs' }, f('open', '待處理'), f('resolved', '已處理'), f('dismissed', '已略過')),
      h('section', { class: 'card glass' }, d.reports.length ? table(['時間', '被檢舉內容', '原因', '次數', '處理'], d.reports.map((r) => h('tr', null,
        h('td', null, fmt(r.created_at)), h('td', { style: 'max-width:300px' }, r.post_id ? h('a', { href: `/p/${r.post_id}` }, (r.content || '（已刪除）').slice(0, 60)) : (r.content || '（已刪除）').slice(0, 60), r.detail ? h('div', { class: 'muted' }, `補充：${r.detail}`) : null),
        h('td', null, h('span', { class: 'pill warn' }, REASON[r.reason] || r.reason)), h('td', null, r.count),
        h('td', { style: 'white-space:nowrap' }, st === 'open' ? [h('button', { class: 'btn small', onclick: () => act(r.id, 'hide') }, '隱藏'), ' ',
          r.post_id ? h('button', { class: 'btn ghost small', onclick: () => act(r.id, 'mark_sensitive') }, '標記敏感') : null, ' ',
          h('button', { class: 'btn ghost small', onclick: () => act(r.id, 'dismiss') }, '略過')] : '—')))) : h('div', { class: 'empty' }, '沒有檢舉')));
  },
  async content(main) {
    const g = new URLSearchParams(location.search).get('group') || '';
    const d = await api('GET', `/api/admin/content${g ? `?group=${g}` : ''}`);
    const s = d.settings;
    const set = (k, v) => api('PATCH', '/api/admin/settings', { [k]: v });
    const counts = { news: 0, game: 0, mixed: 0 };
    if (!g) for (const a of d.accounts) counts[a.content_group]++;
    const groupCard = (k) => h('section', { class: 'card glass' }, h('div', { class: 'row between' }, h('h2', null, GROUP[k]), sw(s[`group_${k}`] !== '0', (v) => api('POST', `/api/admin/content/group/${k}`, { enabled: v }), `${GROUP[k]}分組開關`)),
      h('span', { class: 'muted' }, `${g ? '' : counts[k] + ' 個帳號 · '}今日已發 ${d.today[k] || 0} 則`));
    const interval = h('select', { 'aria-label': '發文間隔' }, [['30', '每 30 分鐘'], ['60', '每 1 小時'], ['120', '每 2 小時']].map(([v, l]) => h('option', { value: v, selected: s.interval_min === v ? true : null }, l)));
    interval.addEventListener('change', () => set('interval_min', interval.value).then(() => toast('已儲存')));
    const oldMode = h('select', { 'aria-label': '停用後的舊文' }, [['keep', '保留顯示'], ['hide', '全部隱藏']].map(([v, l]) => h('option', { value: v, selected: s.old_posts_mode === v ? true : null }, l)));
    oldMode.addEventListener('change', () => set('old_posts_mode', oldMode.value).then(() => toast('已儲存')));
    const f = (v, l) => h('button', { class: g === v ? 'on' : '', onclick: () => navigate(`/admin/content${v ? `?group=${v}` : ''}`) }, l);
    main.replaceChildren(
      h('div', { class: 'row between wrap' }, h('div', null, h('h1', null, '✦ 內容帳號'), h('span', { class: 'muted' }, '全站依間隔輪流發文，同一帳號約 3 天輪到一次')),
        h('div', { class: 'row wrap' },
          h('span', { class: 'row' }, '總開關', sw(s.content_enabled === '1', (v) => set('content_enabled', v ? '1' : '0'), '自動發文總開關')),
          h('button', { class: 'btn ghost small', onclick: async () => { const r = await api('POST', '/api/admin/content/run-now'); toast(r.posted ? `${r.account} 已發文` : `未發文：${r.skipped}`); ADMIN.content(main); } }, '立刻發一則'),
          h('button', { class: 'btn danger small', onclick: async () => { if (!confirm('確定停用全部內容帳號？')) return; await api('POST', '/api/admin/content/disable-all'); toast('已全部停用'); ADMIN.content(main); } }, '一鍵停用全部'))),
      h('div', { class: 'groups' }, groupCard('news'), groupCard('game'), groupCard('mixed')),
      h('section', { class: 'card glass' }, h('h2', null, '發文與互動設定'),
        h('div', { class: 'groups' },
          h('label', { class: 'field' }, '發文間隔', interval),
          h('div', { class: 'field' }, '內容帳號互相按讚', sw(s.interact_like === '1', (v) => set('interact_like', v ? '1' : '0'), '互相按讚')),
          h('div', { class: 'field' }, '內容帳號互相留言', sw(s.interact_comment === '1', (v) => set('interact_comment', v ? '1' : '0'), '互相留言')),
          h('label', { class: 'field' }, '停用後的舊文', oldMode))),
      h('section', { class: 'card glass' },
        h('div', { class: 'tabs' }, f('', '全部'), f('news', '時事'), f('game', '遊戲'), f('mixed', '綜合')),
        table(['帳號', '分組', '個性／主題', '文章', '上次發文', '啟用', ''], d.accounts.map((a) => h('tr', null,
          h('td', null, h('a', { href: `/u/${a.handle}` }, a.name, ' ✦'), h('br'), h('span', { class: 'muted' }, `@${a.handle}`)),
          h('td', null, h('span', { class: 'pill' }, GROUP[a.content_group])), h('td', { style: 'max-width:280px', class: 'muted' }, a.persona),
          h('td', null, a.posts), h('td', null, fmt(a.last_posted_at)),
          h('td', null, sw(a.content_enabled, (v) => api('PATCH', `/api/admin/content/${a.id}`, { enabled: v }), `${a.name} 啟用`)),
          h('td', null, h('button', { class: 'btn ghost small', onclick: () => editPersona(a, main) }, '編輯')))))),
      h('section', { class: 'card glass' }, h('h2', null, '最近紀錄'), d.log.length ? h('div', { class: 'ulist' }, d.log.map((l) => h('div', { class: 'muted' }, `${fmt(l.created_at)}　${l.detail}`))) : h('span', { class: 'muted' }, '還沒有紀錄')));
  },
  async news(main) {
    const d = await api('GET', '/api/admin/content');
    const n = await api('GET', '/api/admin/news');
    let feeds = [];
    try { feeds = JSON.parse(d.settings.rss_feeds || '[]'); } catch {}
    const key = h('input', { type: 'password', placeholder: d.settings.newsdata_key ? '已設定（輸入新的會覆蓋）' : '貼上 NewsData.io 的 API Key', autocomplete: 'off' });
    const rss = h('textarea', { rows: '4', placeholder: '每行一個 RSS 網址' }); rss.value = feeds.join('\n');
    main.replaceChildren(h('h1', null, '新聞來源'),
      h('section', { class: 'card glass' }, h('h2', null, 'NewsData.io'), h('span', { class: 'muted' }, '免費方案每天 200 次額度、可商用，新聞有約 12 小時延遲。'),
        h('label', { class: 'field' }, 'API Key', key),
        h('h2', null, 'RSS 來源'), h('span', { class: 'muted' }, '補充即時新聞。請使用允許轉載摘要與連結的來源。'), h('label', { class: 'field' }, h('span', { class: 'sr' }, 'RSS 網址'), rss),
        h('div', { class: 'row wrap' },
          h('button', { class: 'btn', onclick: async () => { const body = { rss_feeds: rss.value.split('\n').map((x) => x.trim()).filter(Boolean) }; if (key.value) body.newsdata_key = key.value; await api('PATCH', '/api/admin/settings', body); toast('已儲存'); ADMIN.news(main); } }, '儲存'),
          h('button', { class: 'btn ghost', onclick: async () => { const r = await api('POST', '/api/admin/content/fetch-news'); toast(`新增 ${r.fetched} 則新聞`); ADMIN.news(main); } }, '立刻抓新聞'))),
      h('section', { class: 'card glass' }, h('h2', null, '最近抓到的新聞'), n.news.length ? table(['標題', '來源', '已使用', '時間'], n.news.map((x) => h('tr', null, h('td', null, h('a', { href: x.url, target: '_blank', rel: 'noopener' }, x.title)), h('td', null, x.source), h('td', null, x.used ? '是' : '—'), h('td', null, fmt(x.fetched_at))))) : h('span', { class: 'muted' }, '還沒有新聞')));
  },
};
function editPersona(a, main) {
  const name = h('input', { value: a.name, maxlength: '40' });
  const persona = h('textarea', { rows: '3', maxlength: '300' }); persona.value = a.persona || '';
  const m = modal('編輯內容帳號', h('label', { class: 'field' }, '名稱', name), h('label', { class: 'field' }, '個性／主題（AI 會依照這段寫文）', persona),
    h('button', { class: 'btn', onclick: async () => { await api('PATCH', `/api/admin/content/${a.id}`, { name: name.value, persona: persona.value }); m.remove(); ADMIN.content(main); } }, '儲存'));
}

// ---------- 啟動 ----------
async function loadMe() {
  try {
    const d = await api('GET', '/api/me');
    S.me = d.user; S.unread = d.unread || 0; S.dev = !!d.dev_mode;
    if (S.me?.theme) applyTheme(S.me.theme);
  } catch { S.me = null; }
}
function render() {
  const path = location.pathname;
  for (const [re, fn] of routes) { const m = path.match(re); if (m) return fn(m); }
  shell('', h('main', { class: 'main' }, h('div', { class: 'empty glass' }, '找不到這個頁面'), h('a', { class: 'btn', href: '/', style: 'align-self:center' }, '回首頁')));
}
loadMe().then(render);
