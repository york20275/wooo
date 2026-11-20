'use strict';
/* 窩Woo！GM 後台 */

async function adminPage(tab) {
  if (!S.me || S.me.role !== 'gm') { shell('', h('main', { class: 'main' }, h('div', { class: 'empty glass' }, '只有 GM 可以使用後台'))); return; }
  const tabs = [['dashboard', '儀表板'], ['users', '用戶管理'], ['posts', '內容管理'], ['reports', '檢舉處理'], ['appeals', '申訴'], ['content', '✦ 內容帳號'], ['news', '新聞來源'], ['audit', '操作紀錄']];
  const nav = h('nav', { 'aria-label': '後台選單' },
    h('a', { href: '/', style: 'margin-bottom:12px' }, '← 回到網站'),
    tabs.map(([k, l]) => h('a', { href: k === 'dashboard' ? '/admin' : `/admin/${k}`, class: tab === k ? 'active' : '' }, l)));
  const main = h('main', null, h('div', { class: 'empty' }, '載入中…'));
  app.replaceChildren(header(), h('div', { class: 'admin' }, nav, main));
  try { await ADMIN[tab]?.(main); } catch (e) { main.replaceChildren(h('div', { class: 'empty err' }, e.message)); }
}
const fmt = (t) => (t ? new Date(t).toLocaleString('zh-TW', { hour12: false }) : '—');
const REASON = { spam: '垃圾訊息', harassment: '騷擾', copyright: '侵權', unmarked_sensitive: '未標記敏感內容', illegal: '違法內容', other: '其他' };
const GROUP = { news: '時事', game: '遊戲', mixed: '綜合', fun: '趣事' };
const MODELS = [['@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'Llama 3.3 70B（品質最好）', 40], ['@cf/meta/llama-4-scout-17b-16e-instruct', 'Llama 4 Scout 17B（中等）', 20], ['@cf/meta/llama-3.1-8b-instruct-fp8-fast', 'Llama 3.1 8B（最便宜，中文較普通）', 7]];
function table(cols, rows) {
  return h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, h('tr', null, cols.map((c) => h('th', { scope: 'col' }, c)))), h('tbody', null, rows)));
}
function sw(on, onToggle, label) {
  const b = h('button', { class: 'switch', role: 'switch', 'aria-checked': String(!!on), 'aria-label': label });
  b.addEventListener('click', async () => { const next = b.getAttribute('aria-checked') !== 'true'; try { await onToggle(next); b.setAttribute('aria-checked', String(next)); } catch (e) { toast(e.message); } });
  return b;
}
/** 簡單長條圖（14 天），每天一組長條 */
function barChart(days, series) {
  const max = Math.max(1, ...days.flatMap((d) => series.map((s) => d[s.key])));
  return h('div', { class: 'chart' },
    h('div', { class: 'legend' }, series.map((s) => h('span', { class: 'row', style: 'gap:6px' }, h('i', { class: 'key', style: `background:${s.color}` }), s.label))),
    h('div', { class: 'bars', role: 'img', 'aria-label': series.map((s) => `${s.label}：${days.map((d) => d[s.key]).join('、')}`).join('；') },
      days.map((d) => h('div', { class: 'col', title: `${d.day}\n${series.map((s) => `${s.label} ${d[s.key]}`).join('\n')}` },
        h('div', { class: 'stack-bars' }, series.map((s) => h('i', { style: `height:${Math.round((d[s.key] / max) * 100)}%;background:${s.color}` }))),
        h('small', null, d.day.slice(5).replace('-', '/'))))));
}
const ADMIN = {
  async dashboard(main) {
    const [d, st] = await Promise.all([api('GET', '/api/admin/dashboard'), api('GET', '/api/admin/stats?days=14')]);
    const s = d.stats;
    const stat = (l, v) => h('div', { class: 'stat glass' }, h('span', { class: 'muted' }, l), h('b', null, v));
    const paused = d.content.paused_until > Date.now();
    main.replaceChildren(h('h1', null, '儀表板'),
      h('div', { class: 'stats' }, stat('今日新用戶', s.newUsers), stat('今日真人發文', s.realPosts), stat('今日 ✦ 發文', s.contentPosts), stat('待處理檢舉', s.openReports)),
      h('section', { class: 'card glass' }, h('h2', null, '近 14 天'),
        barChart(st.days, [{ key: 'active_users', label: '活躍用戶', color: '#2E6A4E' }, { key: 'new_users', label: '新用戶', color: '#2F74AE' }]),
        barChart(st.days, [{ key: 'real_posts', label: '真人發文', color: '#2E6A4E' }, { key: 'content_posts', label: '✦ 發文', color: '#A8CFF2' }])),
      h('section', { class: 'card glass' }, h('div', { class: 'row between wrap' },
        h('div', null, h('h2', null, '✦ 內容帳號自動發文'), h('span', { class: 'muted' }, `${d.content.enabled_accounts} 個帳號啟用中 · 預估每天 ${d.content.posts_per_day} 則${paused ? ` · 暫停到 ${fmt(d.content.paused_until)}` : ''}`)),
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
      h('section', { class: 'card glass' }, table(['用戶', 'Email', '角色', '年齡驗證', '文章', '加入', '狀態', ''], d.users.map((u) => {
        const self = u.id === S.me.id;
        const sel = h('select', { 'aria-label': `${u.name} 的狀態`, disabled: self ? true : null }, Object.entries(statusLabel).map(([v, l]) => h('option', { value: v, selected: u.status === v ? true : null }, l)));
        sel.addEventListener('change', async () => {
          const next = sel.value;
          if (next === 'active') { try { await api('POST', `/api/admin/users/${u.id}/status`, { status: next }); u.status = next; toast('已恢復'); } catch (e) { toast(e.message); sel.value = u.status; } return; }
          sel.value = u.status;
          const m = reasonModal(`${next === 'banned' ? '停權' : '暫停'} ${u.name}`, async (reason, detail) => {
            await api('POST', `/api/admin/users/${u.id}/status`, { status: next, reason, detail }); u.status = next; sel.value = next; toast('已處理並通知本人');
          });
        });
        const role = h('select', { 'aria-label': `${u.name} 的角色`, disabled: self ? true : null }, [['user', '用戶'], ['gm', 'GM']].map(([v, l]) => h('option', { value: v, selected: u.role === v ? true : null }, l)));
        role.addEventListener('change', async () => { if (role.value === 'gm' && !confirm(`確定讓 ${u.name} 成為 GM？GM 可以管理所有內容與用戶。`)) { role.value = u.role; return; } try { await api('POST', `/api/admin/users/${u.id}/role`, { role: role.value }); u.role = role.value; toast('已更新'); } catch (e) { toast(e.message); role.value = u.role; } });
        return h('tr', null, h('td', null, h('a', { href: `/u/${u.handle}` }, u.name), h('br'), h('span', { class: 'muted' }, `@${u.handle}`)), h('td', null, u.email || '—'), h('td', null, role),
          h('td', null, u.age_verified ? '已驗證' : '—'), h('td', null, u.posts), h('td', null, fmt(u.created_at)), h('td', null, sel),
          h('td', null, self || u.role === 'gm' ? null : h('button', { class: 'btn danger small', onclick: async () => { if (!confirm(`永久刪除 ${u.name} 的帳號與所有資料？這個動作無法復原。`)) return; try { await api('DELETE', `/api/admin/users/${u.id}`); toast('已刪除'); ADMIN.users(main); } catch (e) { toast(e.message); } } }, '刪除帳號')));
      }))));
  },
  async posts(main) {
    const src = new URLSearchParams(location.search).get('source') || '';
    const d = await api('GET', `/api/admin/posts${src ? `?source=${src}` : ''}`);
    const NAMES = { hide: '隱藏', delete: '刪除', mark_sensitive: '標記敏感' };
    const act = async (id, action) => {
      if (action === 'unhide') { await api('POST', `/api/admin/posts/${id}`, { action }); return ADMIN.posts(main); }
      reasonModal(`${NAMES[action]}這篇文章`, async (reason, detail) => { await api('POST', `/api/admin/posts/${id}`, { action, reason, detail }); toast('已處理並通知作者'); ADMIN.posts(main); }, action === 'mark_sensitive' ? 'unmarked_sensitive' : '');
    };
    const f = (v, l) => h('button', { class: src === v ? 'on' : '', onclick: () => navigate(`/admin/posts${v ? `?source=${v}` : ''}`) }, l);
    main.replaceChildren(h('h1', null, '內容管理'), h('div', { class: 'tabs' }, f('', '全部'), f('user', '真人'), f('content', '✦ 內容帳號')),
      h('section', { class: 'card glass' }, table(['作者', '內容', '讚（真人）', '留言', '時間', '狀態', '處理'], d.posts.map((p) => h('tr', null,
        h('td', null, p.name, p.is_content ? ' ✦' : ''), h('td', { style: 'max-width:280px' }, h('a', { href: `/p/${p.id}` }, (p.title ? `【網誌】${p.title}` : p.text || '（圖片）').slice(0, 60))),
        h('td', null, `${p.like_count}（${p.real_like_count}）`), h('td', null, p.comment_count), h('td', null, fmt(p.created_at)),
        h('td', null, p.hidden ? h('span', { class: 'pill warn' }, '已隱藏') : '顯示', p.sensitive ? h('span', { class: 'pill' }, '敏感') : null),
        h('td', { style: 'white-space:nowrap' }, h('button', { class: 'btn ghost small', onclick: () => act(p.id, p.hidden ? 'unhide' : 'hide') }, p.hidden ? '取消隱藏' : '隱藏'), ' ',
          p.sensitive ? null : h('button', { class: 'btn ghost small', onclick: () => act(p.id, 'mark_sensitive') }, '標記敏感'), ' ',
          h('button', { class: 'btn danger small', onclick: () => act(p.id, 'delete') }, '刪除')))))));
  },
  async reports(main) {
    const st = new URLSearchParams(location.search).get('status') || 'open';
    const d = await api('GET', `/api/admin/reports?status=${st}`);
    const MAP = { spam: 'spam', harassment: 'harassment', unmarked_sensitive: 'unmarked_sensitive', copyright: 'copyright', illegal: 'illegal', other: 'other' };
    const act = async (id, action, rr) => {
      if (action === 'dismiss') { await api('POST', `/api/admin/reports/${id}`, { action }); toast('已略過'); return ADMIN.reports(main); }
      reasonModal(action === 'hide' ? '隱藏被檢舉的內容' : '標記為敏感內容', async (reason, detail) => { await api('POST', `/api/admin/reports/${id}`, { action, reason, detail }); toast('已處理並通知本人'); ADMIN.reports(main); }, action === 'mark_sensitive' ? 'unmarked_sensitive' : MAP[rr] || 'other');
    };
    const f = (v, l) => h('button', { class: st === v ? 'on' : '', onclick: () => navigate(`/admin/reports?status=${v}`) }, l);
    main.replaceChildren(h('h1', null, '檢舉處理'), h('div', { class: 'tabs' }, f('open', '待處理'), f('resolved', '已處理'), f('dismissed', '已略過')),
      h('section', { class: 'card glass' }, d.reports.length ? table(['時間', '被檢舉內容', '原因', '次數', '處理'], d.reports.map((r) => h('tr', null,
        h('td', null, fmt(r.created_at)), h('td', { style: 'max-width:300px' }, r.post_id ? h('a', { href: `/p/${r.post_id}` }, (r.content || '（已刪除）').slice(0, 60)) : (r.content || '（已刪除）').slice(0, 60), r.detail ? h('div', { class: 'muted' }, `補充：${r.detail}`) : null),
        h('td', null, h('span', { class: 'pill warn' }, REASON[r.reason] || r.reason)), h('td', null, r.count),
        h('td', { style: 'white-space:nowrap' }, st === 'open' ? [h('button', { class: 'btn small', onclick: () => act(r.id, 'hide', r.reason) }, '隱藏'), ' ',
          r.post_id ? h('button', { class: 'btn ghost small', onclick: () => act(r.id, 'mark_sensitive', r.reason) }, '標記敏感') : null, ' ',
          h('button', { class: 'btn ghost small', onclick: () => act(r.id, 'dismiss') }, '略過')] : '—')))) : h('div', { class: 'empty' }, '沒有檢舉')));
  },
  async appeals(main) {
    const st = new URLSearchParams(location.search).get('status') || 'pending';
    const d = await api('GET', `/api/admin/appeals?status=${st}`);
    const f = (v, l) => h('button', { class: st === v ? 'on' : '', onclick: () => navigate(`/admin/appeals?status=${v}`) }, l);
    const T = { post: '文章', comment: '留言', account: '帳號' };
    const card = (x) => {
      const reply = h('textarea', { rows: '2', maxlength: '500', placeholder: '回覆申訴人（選填，對方會看到）' });
      const decide = async (decision) => {
        if (decision === 'accept' && !confirm('接受申訴並撤銷處理？')) return;
        try { const r = await api('POST', `/api/admin/appeals/${x.id}`, { decision, reply: reply.value }); toast(decision === 'accept' ? (r.reversed ? '已接受並恢復' : '已接受（刪除的內容無法恢復）') : '已駁回'); ADMIN.appeals(main); } catch (e) { toast(e.message); }
      };
      return h('section', { class: 'card glass' },
        h('div', { class: 'row between wrap' }, h('b', null, h('a', { href: `/u/${x.user.handle}` }, x.user.name), ` 的${T[x.target_type]}被${x.action_label}`), h('span', { class: 'muted' }, `申訴時間 ${fmt(x.appealed_at)}`)),
        h('div', null, h('span', { class: 'muted' }, '處理原因：'), x.reason_label, x.detail ? h('span', { class: 'muted' }, `（${x.detail}）`) : null, h('span', { class: 'muted' }, ` · 處理時間 ${fmt(x.created_at)}`)),
        x.snapshot ? h('blockquote', { class: 'snap' }, x.snapshot) : null,
        h('div', null, h('span', { class: 'muted' }, '申訴理由：'), x.appeal_text),
        st === 'pending' ? [reply, h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => decide('accept') }, '接受（撤銷處理）'), h('button', { class: 'btn ghost small', onclick: () => decide('reject') }, '駁回（維持處理）'))]
          : h('div', null, h('span', { class: 'muted' }, '回覆：'), x.appeal_reply || '—'));
    };
    main.replaceChildren(h('h1', null, '申訴'), h('span', { class: 'muted' }, '用戶被處理後 30 天內可以申訴。接受申訴會自動撤銷隱藏、敏感標記或停權；刪除的內容無法恢復，但會記錄為誤判並計入透明度報告。'),
      h('div', { class: 'tabs' }, f('pending', '待處理'), f('accepted', '已接受'), f('rejected', '已駁回')),
      ...(d.appeals.length ? d.appeals.map(card) : [h('div', { class: 'empty glass' }, '沒有申訴')]));
  },
  async content(main) {
    const g = new URLSearchParams(location.search).get('group') || '';
    const d = await api('GET', `/api/admin/content${g ? `?group=${g}` : ''}`);
    const s = d.settings;
    const set = (k, v) => api('PATCH', '/api/admin/settings', { [k]: v });
    const groupCard = (k) => {
      const info = d.groups[k] || { total: 0, enabled: 0 };
      return h('section', { class: 'card glass' }, h('div', { class: 'row between' }, h('h2', null, GROUP[k]), sw(s[`group_${k}`] !== '0', (v) => api('POST', `/api/admin/content/group/${k}`, { enabled: v }).then(() => ADMIN.content(main)), `${GROUP[k]}分組開關`)),
        h('span', { class: 'muted' }, `${info.enabled}／${info.total} 個帳號啟用 · 今日已發 ${d.today[k] || 0} 則`));
    };
    const enabledTotal = Object.entries(d.groups).reduce((n, [k, g]) => n + (s[`group_${k}`] === '0' ? 0 : g.enabled), 0);
    const dailySel = h('select', { 'aria-label': '全站每天發文則數' }, [50, 100, 200, 300, 500, 1000, 2000].map((v) => h('option', { value: String(v), selected: v === d.posts_per_day ? true : null }, `每天約 ${v} 則`)));
    dailySel.addEventListener('change', () => set('daily_posts', dailySel.value).then(() => { toast('已儲存'); ADMIN.content(main); }));
    const cycle = d.posts_per_day ? enabledTotal / d.posts_per_day : 0;
    const photoSel = h('select', { 'aria-label': '附照片的比例' }, [0, 10, 20, 30, 50, 70].map((v) => h('option', { value: String(v), selected: String(v) === String(s.photo_ratio ?? '30') ? true : null }, v ? `約 ${v}% 的貼文` : '不附照片')));
    photoSel.addEventListener('change', () => set('photo_ratio', photoSel.value).then(() => toast('已儲存')));
    const pexKey = h('input', { type: 'password', placeholder: s.pexels_key ? '已設定（輸入新的會覆蓋）' : '貼上 Pexels API Key', autocomplete: 'off' });
    const curModel = s.ai_model || d.default_model;
    const modelSel = h('select', { 'aria-label': 'AI 模型' }, MODELS.map(([v, l]) => h('option', { value: v, selected: v === curModel ? true : null }, l)));
    const perPost = (MODELS.find(([v]) => v === curModel) || MODELS[0])[2];
    const neurons = d.posts_per_day * perPost * 1.2;
    const monthly = Math.max(0, neurons - 10000) * 0.011 / 1000 * 30;
    modelSel.addEventListener('change', () => set('ai_model', modelSel.value).then(() => { toast('已儲存'); ADMIN.content(main); }));
    const cmSel = h('select', { 'aria-label': '發到官方社團的比例' }, [0, 10, 30, 50, 100].map((v) => h('option', { value: String(v), selected: String(v) === String(s.community_ratio ?? '30') ? true : null }, v ? `約 ${v}% 的貼文` : '不發到社團')));
    cmSel.addEventListener('change', () => set('community_ratio', cmSel.value).then(() => toast('已儲存')));
    const ratioSel = h('select', { 'aria-label': '熱門動態牆中 ✦ 內容比例上限' }, [0, 20, 30, 50, 70, 100].map((v) => h('option', { value: String(v), selected: String(v) === String(s.feed_content_ratio ?? '50') ? true : null }, v === 100 ? '不限制' : `最多 ${v}%`)));
    ratioSel.addEventListener('change', () => set('feed_content_ratio', ratioSel.value).then(() => toast('已儲存')));
    const oldMode = h('select', { 'aria-label': '停用後的舊文' }, [['keep', '保留顯示'], ['hide', '全部隱藏']].map(([v, l]) => h('option', { value: v, selected: s.old_posts_mode === v ? true : null }, l)));
    oldMode.addEventListener('change', () => set('old_posts_mode', oldMode.value).then(() => toast('已儲存')));
    const f = (v, l) => h('button', { class: g === v ? 'on' : '', onclick: () => navigate(`/admin/content${v ? `?group=${v}` : ''}`) }, l);
    main.replaceChildren(
      h('div', { class: 'row between wrap' }, h('div', null, h('h1', null, '✦ 內容帳號'), h('span', { class: 'muted' }, `啟用中的帳號輪流發文 · 全站每天約 ${d.posts_per_day} 則`)),
        h('div', { class: 'row wrap' },
          h('span', { class: 'row' }, '總開關', sw(s.content_enabled === '1', (v) => set('content_enabled', v ? '1' : '0'), '自動發文總開關')),
          h('button', { class: 'btn ghost small', onclick: async () => { const r = await api('POST', '/api/admin/content/run-now'); toast(r.posted ? `${r.account} 已發文` : `未發文：${r.skipped}`); ADMIN.content(main); } }, '立刻發一則'),
          h('button', { class: 'btn danger small', onclick: async () => { if (!confirm('確定停用全部內容帳號？')) return; await api('POST', '/api/admin/content/disable-all'); toast('已全部停用'); ADMIN.content(main); } }, '一鍵停用全部'))),
      h('section', { class: 'card glass' }, h('h2', null, '發文量'),
        h('div', { class: 'groups' }, h('label', { class: 'field' }, '全站每天', dailySel),
          h('div', { class: 'field' }, '輪流狀況', h('b', { style: 'font-size:20px' }, cycle ? `每個帳號約 ${cycle < 1 ? Math.round(cycle * 24) + ' 小時' : cycle.toFixed(1) + ' 天'}輪到一次` : '—'),
            h('span', { class: 'muted' }, `${enabledTotal} 個帳號輪流，每次挑最久沒發文的那個。分組關掉就不會輪到。`)))),
      h('div', { class: 'groups four' }, groupCard('news'), groupCard('game'), groupCard('mixed'), groupCard('fun')),
      h('section', { class: 'card glass' }, h('h2', null, '真實照片'),
        h('span', { class: 'muted' }, '時事以外的貼文，部分會從免費圖庫 Pexels 找一張符合內容的真實照片，照片右下角會標示攝影者。到 pexels.com/api 免費申請金鑰（每小時 200 次、每月 2 萬次）。'),
        h('div', { class: 'groups' }, h('label', { class: 'field' }, '附照片的比例', photoSel),
          h('label', { class: 'field' }, `Pexels API Key${s.pexels_key ? '（已設定）' : '（未設定，不會附照片）'}`, h('div', { class: 'row' }, pexKey, h('button', { class: 'btn small', onclick: async () => { if (!pexKey.value.trim()) return; await set('pexels_key', pexKey.value.trim()); toast('已儲存'); ADMIN.content(main); } }, '儲存'))))),
      h('section', { class: 'card glass' }, h('h2', null, 'AI 模型與費用'),
        h('div', { class: 'groups' }, h('label', { class: 'field' }, 'AI 模型', modelSel),
          h('div', { class: 'field' }, '預估 AI 費用', h('b', { style: 'font-size:20px' }, monthly < 0.5 ? '免費額度內' : `約 US$${monthly.toFixed(0)}／月`), h('span', { class: 'muted' }, `每天約 ${Math.round(neurons).toLocaleString()} neurons，免費 10,000／天，超過每 1,000 收 US$0.011${monthly < 0.5 ? '。' : '，而且需要 Workers 付費方案 US$5／月。'}`)))),
      h('section', { class: 'card glass' }, h('h2', null, '發文與互動設定'),
        h('div', { class: 'groups' },
          h('label', { class: 'field' }, '熱門動態牆 ✦ 比例上限', ratioSel),
          h('div', { class: 'field' }, '內容帳號互相按讚', sw(s.interact_like === '1', (v) => set('interact_like', v ? '1' : '0'), '互相按讚')),
          h('div', { class: 'field' }, '內容帳號互相留言', sw(s.interact_comment === '1', (v) => set('interact_comment', v ? '1' : '0'), '互相留言')),
          h('label', { class: 'field' }, '停用後的舊文', oldMode),
          h('label', { class: 'field' }, '發到官方社團的比例', cmSel),
          h('div', { class: 'field' }, '每日熱門投票（每天 10 點）', h('div', { class: 'row' }, sw(s.daily_poll !== '0', (v) => set('daily_poll', v ? '1' : '0'), '每日投票'),
            h('button', { class: 'btn ghost small', onclick: async () => { const r = await api('POST', '/api/admin/content/daily-poll'); toast(r.posted ? `已發布：${r.question}` : r.skipped); } }, '立刻發一題'))))),
      h('section', { class: 'card glass' },
        h('div', { class: 'tabs' }, f('', '全部'), f('news', '時事'), f('game', '遊戲'), f('mixed', '綜合'), f('fun', '趣事')),
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
  async audit(main) {
    const d = await api('GET', '/api/admin/audit');
    const LABEL = { 'user_status:active': '恢復帳號', 'user_status:suspended': '停權', 'user_status:banned': '封鎖', 'user_role:gm': '設為 GM', 'user_role:user': '取消 GM', user_delete: '刪除帳號', post_hide: '隱藏文章', post_unhide: '取消隱藏', post_mark_sensitive: '標記敏感', post_delete: '刪除文章', report_hide: '檢舉：隱藏', report_mark_sensitive: '檢舉：標記敏感', report_dismiss: '檢舉：略過', content_account_edit: '編輯內容帳號', content_disable_all: '停用全部內容帳號', setting: '修改設定', appeal_accept: '申訴：接受', appeal_reject: '申訴：駁回', comment_delete: '刪除留言', community_delete: '刪除社團', daily_poll_now: '發每日投票' };
    main.replaceChildren(h('h1', null, '操作紀錄'), h('span', { class: 'muted' }, '所有 GM 的管理操作都會記錄在這裡（最近 200 筆）。'),
      h('section', { class: 'card glass' }, d.items.length ? table(['時間', 'GM', '動作', '對象', '說明'], d.items.map((x) => h('tr', null, h('td', null, fmt(x.created_at)), h('td', null, x.gm || '—'), h('td', null, LABEL[x.action] || x.action), h('td', { class: 'muted' }, x.target || '—'), h('td', { class: 'muted', style: 'max-width:260px' }, x.detail || '')))) : h('div', { class: 'empty' }, '還沒有紀錄')));
  },
};
function editPersona(a, main) {
  const name = h('input', { value: a.name, maxlength: '40' });
  const persona = h('textarea', { rows: '3', maxlength: '300' }); persona.value = a.persona || '';
  const m = modal('編輯內容帳號', h('label', { class: 'field' }, '名稱', name), h('label', { class: 'field' }, '個性／主題（AI 會依照這段寫文）', persona),
    h('button', { class: 'btn', onclick: async () => { await api('PATCH', `/api/admin/content/${a.id}`, { name: name.value, persona: persona.value }); m.remove(); ADMIN.content(main); } }, '儲存'));
}
