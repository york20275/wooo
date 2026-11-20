'use strict';
/* 窩Woo！進階功能：表情回應、轉發、收藏、多圖、限時動態、分類版、每日投票、處理通知與申訴、透明度報告、個人過濾、徽章 */

const REACTIONS = ['❤️', '😂', '😮', '😢', '😡'];
const MOD_REASONS = [['spam', '垃圾訊息或廣告'], ['scam', '詐騙'], ['harassment', '騷擾或人身攻擊'], ['privacy', '公開他人個資'], ['unmarked_sensitive', '敏感內容未標記'], ['copyright', '侵權'], ['illegal', '違法內容'], ['violence', '暴力威脅'], ['other', '其他']];

// ---------- 小工具 ----------
function popMenu(anchorWrap, items) {
  if (anchorWrap.querySelector('.pop')) { anchorWrap.querySelector('.pop').remove(); return; }
  const pop = h('div', { class: 'pop', role: 'menu' }, items.filter(Boolean).map(([label, fn, danger]) => h('button', { role: 'menuitem', style: danger ? 'color:#A32D2D' : null, onclick: () => { pop.remove(); fn(); } }, label)));
  anchorWrap.append(pop);
  setTimeout(() => document.addEventListener('click', () => pop.remove(), { once: true }), 0);
}

/** GM 處理別人的內容時選原因（會通知本人） */
function reasonModal(title, onSubmit, defaultReason = '') {
  let chosen = defaultReason;
  const detail = h('textarea', { rows: '2', maxlength: '300', placeholder: '補充說明（選填，本人會看到）' });
  const err = h('span', { class: 'err' });
  const opts = MOD_REASONS.map(([v, l]) => h('label', { class: 'check', style: 'color:var(--text);font-size:14px' }, h('input', { type: 'radio', name: 'modreason', value: v, checked: v === chosen ? true : null, onchange: () => { chosen = v; err.textContent = ''; } }), l));
  const m = modal(title, h('span', { class: 'muted' }, '本人會收到通知，看到原因並可以申訴。'), h('div', { class: 'field' }, ...opts), h('label', { class: 'field' }, h('span', { class: 'sr' }, '補充說明'), detail), err,
    h('button', { class: 'btn danger', onclick: async () => {
      if (!chosen) { err.textContent = '請選擇原因'; return; }
      try { await onSubmit(chosen, detail.value.trim()); m.remove(); } catch (e) { err.textContent = e.message; }
    } }, '確定'));
  return m;
}

// ---------- 表情回應 ----------
function reactionControl(p) {
  const wrap = h('div', { class: 'react' });
  const btn = h('button', { class: 'icon-btn' });
  const sum = h('button', { class: 'react-sum', 'aria-label': '查看回應名單', onclick: () => likesModal(p.id) });
  const draw = () => {
    btn.replaceChildren(p.reaction && p.reaction !== '❤️' ? h('span', { class: 'emo' }, p.reaction) : icon(p.reaction ? 'heartFill' : 'heart'), String(p.like_count));
    btn.classList.toggle('on', !!p.reaction);
    btn.setAttribute('aria-pressed', String(!!p.reaction));
    btn.setAttribute('aria-label', p.reaction ? '收回回應' : '按讚（長按選擇表情）');
    const top = (p.reactions || []).filter((r) => r.n > 0).slice(0, 3);
    sum.replaceChildren(...top.map((r) => h('span', null, r.emoji)));
    sum.hidden = !top.length || (top.length === 1 && top[0].emoji === '❤️');
  };
  const bump = (emoji, delta) => {
    const r = (p.reactions = p.reactions || []).find((x) => x.emoji === emoji);
    if (r) r.n += delta; else if (delta > 0) p.reactions.push({ emoji, n: 1 });
    p.reactions.sort((a, b) => b.n - a.n);
  };
  const set = async (emoji) => {
    if (!S.me) return needLogin();
    const was = p.reaction;
    if (was === emoji) emoji = null;
    p.reaction = emoji;
    if (was) bump(was, -1);
    if (emoji) bump(emoji, 1);
    p.like_count += (emoji ? 1 : 0) - (was ? 1 : 0);
    draw(); closePicker();
    try { await api(emoji ? 'POST' : 'DELETE', `/api/posts/${p.id}/like`, emoji ? { emoji } : undefined); }
    catch (e) { toast(e.message); }
  };
  const picker = h('div', { class: 'react-pick', role: 'menu', hidden: true }, REACTIONS.map((e) => h('button', { role: 'menuitem', 'aria-label': `回應 ${e}`, onclick: (ev) => { ev.stopPropagation(); set(e); } }, e)));
  const openPicker = () => { picker.hidden = false; setTimeout(() => document.addEventListener('click', closePicker, { once: true }), 0); };
  const closePicker = () => { picker.hidden = true; };
  let timer = null, longPressed = false;
  btn.addEventListener('pointerdown', () => { longPressed = false; timer = setTimeout(() => { longPressed = true; openPicker(); }, 450); });
  ['pointerup', 'pointerleave'].forEach((ev) => btn.addEventListener(ev, () => clearTimeout(timer)));
  btn.addEventListener('contextmenu', (e) => { e.preventDefault(); openPicker(); });
  btn.addEventListener('click', () => { if (longPressed) return; set(p.reaction ? p.reaction : '❤️'); });
  const more = h('button', { class: 'icon-btn react-more', 'aria-label': '選擇表情', onclick: (e) => { e.stopPropagation(); if (!S.me) return needLogin(); picker.hidden ? openPicker() : closePicker(); } }, '＋');
  draw();
  wrap.append(btn, more, sum, picker);
  return wrap;
}

// ---------- 多張圖片 ----------
function imageGrid(p) {
  const imgs = p.images && p.images.length ? p.images : p.image_url ? [p.image_url] : [];
  if (!imgs.length) return null;
  const grid = h('div', { class: `pimg grid g${imgs.length} ${p.sensitive ? 'blur' : ''}` },
    imgs.map((src, i) => h('img', { src, alt: `貼文圖片 ${i + 1}`, loading: 'lazy', onclick: () => { if (!grid.classList.contains('blur')) lightbox(imgs.map((url) => ({ url })), i); } })));
  if (p.image_credit) grid.append(h('a', { class: 'credit', href: p.image_credit.url, target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, `攝影：${p.image_credit.name}／Pexels`));
  if (p.sensitive) {
    const cover = h('button', { class: 'cover', 'aria-label': '敏感內容，點擊查看' }, icon('eyeoff'), h('b', null, '敏感內容'), h('span', null, '發文者已標記 · 點擊查看'));
    cover.addEventListener('click', (e) => { e.stopPropagation(); grid.classList.remove('blur'); cover.remove(); });
    grid.append(cover);
  }
  return grid;
}

/** 發文框的多圖選擇（最多 4 張） */
function multiImagePicker(max = 4) {
  const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', multiple: true, class: 'sr' });
  const preview = h('div', { class: 'mpreview' });
  const err = h('span', { class: 'err' });
  let items = [];
  const draw = () => preview.replaceChildren(...items.map((it, i) => h('div', { class: 'thumb' }, h('img', { src: it.url, alt: `預覽 ${i + 1}` }),
    h('button', { type: 'button', 'aria-label': `移除第 ${i + 1} 張`, onclick: () => { items.splice(i, 1); draw(); } }, '×'))));
  file.addEventListener('change', async () => {
    err.textContent = '';
    const files = [...file.files].slice(0, max - items.length);
    if (file.files.length > files.length) err.textContent = `一篇最多 ${max} 張圖片`;
    for (const f of files) {
      try { const d = await uploadImage(f); items.push({ key: d.key, url: d.url }); draw(); }
      catch (e) { err.textContent = e.message; }
    }
    file.value = '';
  });
  const btn = h('button', { type: 'button', class: 'icon-btn', style: 'color:var(--primary)', 'aria-label': '加入圖片（最多 4 張）', onclick: () => { if (items.length >= max) { err.textContent = `一篇最多 ${max} 張圖片`; return; } file.click(); } }, icon('image'));
  return { btn, file, preview, err, keys: () => items.map((x) => x.key), reset: () => { items = []; draw(); } };
}

// ---------- 轉發、引用、收藏 ----------
function quoteCard(q) {
  if (!q) return null;
  if (q.deleted) return h('div', { class: 'quote deleted' }, '原文已刪除或無法查看');
  return h('a', { class: 'quote', href: `/p/${q.id}` },
    h('div', { class: 'meta' }, avatar(q.author, 'xs'), h('b', null, q.author.name), q.author.is_content ? h('span', { class: 'star' }, '✦') : null, h('span', { class: 'time' }, timeAgo(q.created_at))),
    q.text ? h('div', { class: 'text' }, q.text.length > 200 ? q.text.slice(0, 200) + '…' : q.text) : null,
    q.images && q.images.length ? h('div', { class: 'qimgs' }, h('img', { src: q.images[0], alt: '', loading: 'lazy', class: q.sensitive ? 'blurimg' : '' }), q.images.length > 1 ? h('span', null, `+${q.images.length - 1}`) : null) : null);
}

function repostControl(p) {
  const wrap = h('div', { class: 'menu', style: 'margin-left:0' });
  const btn = h('button', { class: 'icon-btn', 'aria-label': '轉發' }, icon('repost'), String(p.repost_count || 0));
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!S.me) return needLogin();
    const mine = S.me.id === p.author.id;
    let reposted = false;
    if (!mine) { try { reposted = (await api('GET', `/api/posts/${p.id}/repost`)).reposted; } catch {} }
    popMenu(wrap, [
      mine ? null : [reposted ? '取消轉發' : '轉發', async () => {
        try {
          await api(reposted ? 'DELETE' : 'POST', `/api/posts/${p.id}/repost`);
          p.repost_count = Math.max(0, (p.repost_count || 0) + (reposted ? -1 : 1));
          btn.replaceChildren(icon('repost'), String(p.repost_count));
          toast(reposted ? '已取消轉發' : '已轉發到你的個人頁');
        } catch (err) { toast(err.message); }
      }],
      ['引用轉發', () => quoteModal(p)],
    ]);
  });
  wrap.append(btn);
  return wrap;
}

function quoteModal(p) {
  const ta = h('textarea', { rows: '3', maxlength: '1000', placeholder: '說說你的想法…' });
  const err = h('span', { class: 'err' });
  const m = modal('引用轉發', h('label', null, h('span', { class: 'sr' }, '引用內容'), ta), quoteCard(p), err,
    h('button', { class: 'btn', onclick: async () => {
      if (!ta.value.trim()) { err.textContent = '寫點什麼吧'; return; }
      try { await api('POST', '/api/posts', { text: ta.value, quote_of: p.id }); m.remove(); toast('已發布'); }
      catch (e) { err.textContent = e.message; }
    } }, '發布'));
  attachSuggest && m.querySelector('.modal').append(attachSuggest(ta));
  setTimeout(() => ta.focus(), 50);
}

async function toggleBookmark(p) {
  if (!S.me) return needLogin();
  try {
    await api(p.bookmarked ? 'DELETE' : 'POST', `/api/posts/${p.id}/bookmark`);
    p.bookmarked = !p.bookmarked;
    toast(p.bookmarked ? '已收藏，可以在「收藏」找到' : '已取消收藏');
  } catch (e) { toast(e.message); }
}

async function bookmarksPage() {
  if (!S.me) return shell('/bookmarks', h('main', { class: 'main' }, h('div', { class: 'card glass' }, h('h2', null, '收藏'), h('span', null, '登入後就能收藏喜歡的文章'), loginButton())));
  const pl = postList(async (st) => (await api('GET', `/api/me/bookmarks${st.before ? `?before=${st.before}` : ''}`)).posts, '還沒有收藏任何文章。在文章的「⋯」選單按「收藏」就會出現在這裡。');
  shell('/bookmarks', h('main', { class: 'main' }, pageTitle('收藏'), h('span', { class: 'muted', style: 'margin:0 4px' }, '只有你自己看得到'), pl.el));
  pl.load(true);
}

// ---------- 限時動態 ----------
const STORY_BGS = ['#2E6A4E', '#1F5FA8', '#C2561D', '#7A3E9D', '#B23A48', '#1C1C1A'];

function storiesBar() {
  const bar = h('div', { class: 'stories', role: 'list', 'aria-label': '限時動態' });
  const load = async () => {
    try {
      const d = await api('GET', '/api/stories');
      const mineGroup = d.groups.find((g) => g.mine);
      const add = S.me ? h('button', { class: 'story add', role: 'listitem', onclick: () => storyComposer(load) },
        h('span', { class: 'ring none' }, avatar(S.me), h('i', null, '+')), h('small', null, '新增動態')) : null;
      bar.replaceChildren(...[add, ...d.groups.map((g, i) => h('button', { class: 'story', role: 'listitem', onclick: () => storyViewer(d.groups, i, load) },
        h('span', { class: `ring ${g.all_viewed ? 'seen' : ''}` }, avatar(g.user)), h('small', null, g.mine ? '你的動態' : g.user.name)))].filter(Boolean));
      bar.hidden = !bar.children.length || (!d.groups.length && !S.me);
      if (mineGroup && add) add.querySelector('small').textContent = '再新增';
    } catch { bar.hidden = true; }
  };
  load();
  return bar;
}

function storyComposer(onDone) {
  let bg = STORY_BGS[0], key = null;
  const ta = h('textarea', { rows: '3', maxlength: '200', placeholder: '寫點什麼…（24 小時後消失）' });
  const stage = h('div', { class: 'story-stage small' }, ta);
  const paint = () => { stage.style.background = key ? '#000' : bg; };
  const swatches = h('div', { class: 'row', style: 'gap:6px' }, STORY_BGS.map((c) => h('button', { type: 'button', class: 'swatch', style: `background:${c}`, 'aria-label': '背景顏色', onclick: () => { bg = c; paint(); } })));
  const pick = imagePicker((k) => { key = k; paint(); });
  const err = h('span', { class: 'err' });
  const m = modal('新增限時動態', stage, swatches, pick.preview, pick.err, err,
    h('div', { class: 'row between' }, h('div', { class: 'row' }, pick.btn, pick.file, h('span', { class: 'muted' }, '可加一張照片')),
      h('button', { class: 'btn', onclick: async () => {
        if (!ta.value.trim() && !key) { err.textContent = '寫點字或放張照片吧'; return; }
        try { await api('POST', '/api/stories', { text: ta.value, image_key: key, bg }); m.remove(); toast('已發布，24 小時後會自動消失'); onDone?.(); }
        catch (e) { err.textContent = e.message; }
      } }, '發布')));
  paint();
  setTimeout(() => ta.focus(), 50);
}

function storyViewer(groups, gi, onClose) {
  let g = gi, s = groups[g].stories.findIndex((x) => !x.viewed);
  if (s < 0) s = 0;
  let timer = null;
  const bg = h('div', { class: 'story-view', role: 'dialog', 'aria-modal': 'true', 'aria-label': '限時動態' });
  const close = () => { clearTimeout(timer); bg.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const next = () => { if (s < groups[g].stories.length - 1) s++; else if (g < groups.length - 1) { g++; s = 0; } else return close(); draw(); };
  const prev = () => { if (s > 0) s--; else if (g > 0) { g--; s = groups[g].stories.length - 1; } draw(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') next(); if (e.key === 'ArrowLeft') prev(); };
  document.addEventListener('keydown', onKey);
  const draw = () => {
    clearTimeout(timer);
    const grp = groups[g], st = grp.stories[s];
    if (!st.viewed) { st.viewed = true; api('POST', `/api/stories/${st.id}/view`).catch(() => {}); }
    grp.all_viewed = grp.stories.every((x) => x.viewed);
    const bars = h('div', { class: 'sbars' }, grp.stories.map((_, i) => h('i', { class: i < s ? 'done' : i === s ? 'now' : '' })));
    const tools = h('div', { class: 'row', style: 'gap:4px' });
    if (grp.mine) {
      tools.append(h('button', { class: 'icon-btn light', onclick: async (e) => { e.stopPropagation(); clearTimeout(timer); const d = await api('GET', `/api/stories/${st.id}/viewers`); modal(`${d.users.length} 人看過`, h('div', { class: 'ulist' }, d.users.length ? d.users.map((u) => h('a', { class: 'uitem', href: `/u/${u.handle}` }, avatar(u, 'sm'), u.name)) : h('span', { class: 'muted' }, '還沒有人看過'))); } }, '誰看過'));
    }
    if (grp.mine || S.me?.role === 'gm') {
      tools.append(h('button', { class: 'icon-btn light', onclick: async (e) => { e.stopPropagation(); if (!confirm('刪除這則限時動態？')) return; await api('DELETE', `/api/stories/${st.id}`); grp.stories.splice(s, 1); if (!grp.stories.length) { groups.splice(g, 1); if (!groups.length) return close(); g = Math.min(g, groups.length - 1); s = 0; } else s = Math.min(s, grp.stories.length - 1); draw(); } }, '刪除'));
    }
    const card = h('div', { class: 'story-stage', style: `background:${st.image_url ? '#000' : st.bg}` },
      bars,
      h('div', { class: 'shead' }, h('a', { href: `/u/${grp.user.handle}`, onclick: close, class: 'row', style: 'gap:8px;color:#fff;text-decoration:none' }, avatar(grp.user, 'sm'), h('b', null, grp.user.name), h('small', null, timeAgo(st.created_at))), h('span', { style: 'flex:1' }), tools,
        h('button', { class: 'icon-btn light', 'aria-label': '關閉', onclick: close }, icon('x'))),
      st.image_url ? h('img', { src: st.image_url, alt: '' }) : null,
      st.text ? h('p', { class: st.image_url ? 'scap' : 'stext' }, st.text) : null,
      h('button', { class: 'snav prev', 'aria-label': '上一則', onclick: prev }),
      h('button', { class: 'snav next', 'aria-label': '下一則', onclick: next }));
    bg.replaceChildren(card);
    timer = setTimeout(next, 6000);
  };
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  document.body.append(bg);
  draw();
}

// ---------- 每日投票 ----------
function dailyPollCard() {
  const box = h('div');
  api('GET', '/api/daily-poll').then((d) => {
    if (!d.post) return;
    box.replaceChildren(h('section', { class: 'daily glass' }, h('div', { class: 'row between' }, h('b', null, '📊 今日投票'), h('a', { href: `/p/${d.post.id}`, class: 'muted', style: 'font-size:13px' }, `${d.post.comment_count} 則留言 ›`)),
      h('div', { class: 'text' }, d.post.text.replace(/^【今日投票】/, '').replace(/\n?#每日投票\s*$/, '')), pollBox(d.post)));
  }).catch(() => {});
  return box;
}

// ---------- 分類版（只有官方，GM 在後台管理） ----------
async function communitiesPage() {
  const main = h('main', { class: 'main' }, h('div', { class: 'empty' }, '載入中…'));
  shell('/communities', main);
  try {
    const d = await api('GET', '/api/communities');
    main.replaceChildren(pageTitle('分類版'), h('span', { class: 'muted', style: 'margin:0 4px' }, '發文時選一個分類版，文章就會出現在那裡。'),
      ...d.communities.map((c) => h('a', { class: 'ccard glass', href: `/c/${c.slug}` }, h('span', { class: 'cicon' }, c.icon || '💬'),
        h('div', { class: 'body' }, h('b', null, c.name), h('span', { class: 'muted' }, c.description || ''), h('small', { class: 'muted' }, `${c.post_count} 篇文章`)))));
  } catch (e) { main.replaceChildren(h('div', { class: 'empty err' }, e.message)); }
}

async function communityPage(slug) {
  const main = h('main', { class: 'main' }, h('div', { class: 'empty' }, '載入中…'));
  shell('/communities', main);
  try {
    const first = await api('GET', `/api/communities/${slug}`);
    const c = first.community;
    const head = h('section', { class: 'card glass chead' },
      h('div', { class: 'row', style: 'gap:14px' }, h('span', { class: 'cicon lg' }, c.icon || '💬'),
        h('div', null, h('h1', { style: 'font-size:22px;margin:0' }, c.name), h('span', { class: 'muted' }, `${c.post_count} 篇文章`))),
      c.description ? h('p', { style: 'margin:0' }, c.description) : null,
      S.me?.role === 'gm' ? h('a', { class: 'btn ghost small', href: '/admin/boards', style: 'align-self:flex-start' }, '在後台管理分類版') : null);
    const pl = postList(async (st) => (st.before ? (await api('GET', `/api/communities/${slug}?before=${st.before}`)).posts : first.posts), '這個分類版還沒有文章，來發第一篇吧');
    const comp = S.me ? composer(() => communityPage(slug), { communityId: c.id, communityName: c.name }) : h('div', { class: 'card glass' }, h('span', null, '登入後就能在這裡發文'), loginButton());
    main.replaceChildren(head, comp, pl.el);
    pl.load(true);
  } catch (e) { main.replaceChildren(h('div', { class: 'empty glass' }, e.message)); }
}

/** 發文框的分類版選單：一定要選一個，預設「暢所欲言」 */
function communitySelect(fixed) {
  const sel = h('select', { class: 'csel', 'aria-label': '發到哪個分類版' });
  if (fixed) { sel.append(h('option', { value: fixed.communityId }, `發到「${fixed.communityName}」`)); sel.disabled = true; return sel; }
  sel.append(h('option', { value: 'cm_free' }, '💬 暢所欲言'));
  api('GET', '/api/communities').then((d) => {
    sel.replaceChildren(...d.communities.map((c) => h('option', { value: c.id, selected: c.id === 'cm_free' ? true : null }, `${c.icon} ${c.name}`)));
  }).catch(() => {});
  return sel;
}

// ---------- 處理紀錄與申訴 ----------
function statusBanner() {
  if (!S.me || S.me.status === 'active') return null;
  return h('div', { class: 'status-banner' }, h('b', null, S.me.status === 'banned' ? '你的帳號已被停權' : '你的帳號目前暫停使用'),
    h('span', null, '暫時無法發文與互動。'), h('a', { href: '/moderation' }, '查看原因與申訴 ›'));
}

async function moderationPage() {
  const main = h('main', { class: 'main' }, h('div', { class: 'empty' }, '載入中…'));
  shell('', main);
  if (!S.me) { main.replaceChildren(h('div', { class: 'card glass' }, h('h2', null, '處理紀錄'), loginButton())); return; }
  try {
    const d = await api('GET', '/api/me/moderation');
    const ST = { pending: ['審查中', 'warn'], accepted: ['申訴通過', 'ok'], rejected: ['維持原處理', ''] };
    const T = { post: '文章', comment: '留言', account: '帳號' };
    const item = (a) => {
      const box = h('section', { class: 'card glass' },
        h('div', { class: 'row between wrap' }, h('b', null, `${T[a.target_type]}：${a.action_label}`), h('span', { class: 'time' }, new Date(a.created_at).toLocaleString('zh-TW'))),
        h('div', null, h('span', { class: 'muted' }, '原因：'), a.reason_label, a.detail ? h('div', { class: 'muted', style: 'font-size:14px' }, `補充說明：${a.detail}`) : null),
        a.snapshot ? h('blockquote', { class: 'snap' }, a.snapshot) : null,
        a.target_type === 'post' && a.action !== 'delete' ? h('a', { href: `/p/${a.target_id}`, style: 'font-size:14px' }, '查看文章') : null);
      if (a.appeal_status !== 'none') {
        box.append(h('div', { class: 'appeal' }, h('span', { class: `pill ${ST[a.appeal_status][1]}` }, ST[a.appeal_status][0]),
          h('div', { style: 'font-size:14px' }, h('span', { class: 'muted' }, '你的申訴：'), a.appeal_text),
          a.appeal_reply ? h('div', { style: 'font-size:14px' }, h('span', { class: 'muted' }, '管理團隊回覆：'), a.appeal_reply) : null,
          a.appeal_status === 'accepted' && !a.reversed ? h('span', { class: 'muted', style: 'font-size:13px' }, '已刪除的內容無法復原，這次處理已記錄為誤判。') : null));
      } else if (a.can_appeal) {
        const ta = h('textarea', { rows: '3', maxlength: '1000', placeholder: '說明你認為處理有誤的原因' });
        const err = h('span', { class: 'err' });
        const form = h('div', { class: 'stack', style: 'gap:8px', hidden: true }, ta, err, h('button', { class: 'btn small', style: 'align-self:flex-start', onclick: async () => {
          try { await api('POST', `/api/moderation/${a.id}/appeal`, { text: ta.value }); toast('已送出申訴，管理團隊會盡快回覆'); moderationPage(); } catch (e) { err.textContent = e.message; }
        } }, '送出申訴'));
        box.append(h('button', { class: 'btn ghost small', style: 'align-self:flex-start', onclick: (e) => { e.target.remove(); form.hidden = false; ta.focus(); } }, '我要申訴'), form);
      } else box.append(h('span', { class: 'muted', style: 'font-size:13px' }, `已超過 ${d.appeal_days} 天申訴期限`));
      return box;
    };
    main.replaceChildren(pageTitle('處理紀錄與申訴'),
      h('p', { class: 'muted', style: 'margin:0 4px' }, `窩Woo！不會無預警刪文或封號。每次處理都會告訴你原因，處理後 ${d.appeal_days} 天內都可以申訴，由真人審查。`, h('a', { href: '/transparency' }, '看全站透明度報告')),
      ...(d.actions.length ? d.actions.map(item) : [h('div', { class: 'empty glass' }, '你沒有任何處理紀錄 👍')]));
  } catch (e) { main.replaceChildren(h('div', { class: 'empty err' }, e.message)); }
}

async function transparencyPage() {
  const main = h('main', { class: 'main' }, h('div', { class: 'empty' }, '載入中…'));
  shell('/transparency', main);
  try {
    const d = await api('GET', '/api/transparency');
    const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
    const month = (m) => {
      const total = sum(m.actions);
      const rows = (obj, labels) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, n]) => h('div', { class: 'tbar' }, h('span', null, labels[k] || k), h('i', { style: `width:${total ? Math.max(4, (n / total) * 100) : 0}%` }), h('b', null, n)));
      return h('section', { class: 'card glass' }, h('h2', null, m.month.replace('-', ' 年 ') + ' 月'),
        h('div', { class: 'tstats' },
          h('div', null, h('b', null, m.posts.toLocaleString()), h('small', null, '真人發文')),
          h('div', null, h('b', null, m.reports), h('small', null, '收到檢舉')),
          h('div', null, h('b', null, total), h('small', null, '處理件數')),
          h('div', null, h('b', null, m.posts ? `${((total / m.posts) * 100).toFixed(2)}%` : '0%'), h('small', null, '處理比例')),
          h('div', null, h('b', null, sum(m.appeals)), h('small', null, '申訴')),
          h('div', null, h('b', null, m.appeals.accepted || 0), h('small', null, '申訴通過'))),
        total ? [h('h3', { class: 'subhead' }, '處理方式'), ...rows(m.actions, d.action_labels), h('h3', { class: 'subhead' }, '原因'), ...rows(m.reasons, d.reason_labels)] : h('span', { class: 'muted' }, '這個月沒有任何處理。'));
    };
    main.replaceChildren(pageTitle('透明度報告'),
      h('section', { class: 'card glass' }, h('p', { style: 'margin:0' }, '窩Woo！主張言論自由、暢所欲言。我們只處理違法或嚴重違反社群規範的內容，不會因為觀點或立場刪文封號。'),
        h('p', { style: 'margin:0' }, '每一次處理都會通知本人、說明原因，而且可以申訴。這一頁公開每個月的處理統計，讓大家看得到我們做了什麼。'),
        h('span', { class: 'muted', style: 'font-size:13px' }, '統計不含 ✦ 平台內容帳號，每次重新整理都是即時數字。')),
      ...(d.months.length ? d.months.map(month) : [h('div', { class: 'empty glass' }, '目前還沒有任何處理紀錄。')]));
  } catch (e) { main.replaceChildren(h('div', { class: 'empty err' }, e.message)); }
}

// ---------- 個人過濾 ----------
function mutedSection() {
  const sec = h('section', { class: 'card glass' }, h('h2', null, '我的過濾器'),
    h('span', { class: 'muted' }, '不想看到的字詞或 #標籤，加進來就不會出現在你的動態牆、搜尋和標籤頁。只影響你自己，別人看得到的內容不變。'));
  if (!S.me) { sec.append(loginButton()); return sec; }
  const list = h('div', { class: 'tag-row' });
  const input = h('input', { maxlength: '30', placeholder: '例如：劇透、#政治', class: 'tag-input', style: 'border:1px solid rgba(0,0,0,.12);border-radius:10px;padding:8px 10px' });
  const load = async () => {
    const d = await api('GET', '/api/me/muted');
    list.replaceChildren(...(d.words.length ? d.words.map((w) => h('span', { class: 'chip' }, w, h('button', { type: 'button', 'aria-label': `移除 ${w}`, onclick: async () => { await api('DELETE', '/api/me/muted', { word: w }); load(); } }, '×'))) : [h('span', { class: 'muted' }, '還沒有過濾任何字詞')]));
  };
  const add = async () => { if (!input.value.trim()) return; try { await api('POST', '/api/me/muted', { word: input.value }); input.value = ''; load(); } catch (e) { toast(e.message); } };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  sec.append(h('div', { class: 'row' }, input, h('button', { class: 'btn small', onclick: add }, '加入')), list);
  load().catch(() => {});
  return sec;
}

// ---------- 徽章 ----------
function badgeRow(badges) {
  if (!badges || !badges.length) return null;
  return h('div', { class: 'badges' }, badges.map((b) => h('span', { class: 'badge', title: b.desc, tabindex: '0', onclick: () => toast(`${b.icon} ${b.label}：${b.desc}`) }, b.icon, ' ', b.label)));
}

// ---------- 路由 ----------
routes.push(
  [/^\/bookmarks$/, () => bookmarksPage()],
  [/^\/communities$/, () => communitiesPage()],
  [/^\/c\/([a-z0-9-]+)$/, (m) => communityPage(m[1])],
  [/^\/moderation$/, () => moderationPage()],
  [/^\/transparency$/, () => transparencyPage()],
);
