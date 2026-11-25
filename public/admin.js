'use strict';
/* 窩Woo！GM 後台 */

async function adminPage(tab) {
  if (!S.me || S.me.role !== 'gm') { shell('', h('main', { class: 'main' }, h('div', { class: 'empty glass' }, '只有 GM 可以使用後台'))); return; }
  const tabs = [['dashboard', '儀表板'], ['users', '用戶管理'], ['posts', '內容管理'], ['reports', '檢舉處理'], ['appeals', '申訴'], ['boards', '分類版'], ['content', '✦ 內容帳號'], ['queue', '排程發文'], ['news', '新聞來源'], ['server', '伺服器'], ['audit', '操作紀錄']];
  const nav = h('nav', { 'aria-label': '後台選單' },
    h('a', { href: '/', style: 'margin-bottom:12px' }, '← 回到網站'),
    tabs.map(([k, l]) => h('a', { href: k === 'dashboard' ? '/admin' : `/admin/${k}`, class: tab === k ? 'active' : '' }, l)));
  const main = h('main', null, h('div', { class: 'empty' }, '載入中…'));
  app.replaceChildren(header(), h('div', { class: 'admin' }, nav, main));
  try { await ADMIN[tab]?.(main); } catch (e) { main.replaceChildren(h('div', { class: 'empty err' }, e.message)); }
}
const fmt = (t) => (t ? new Date(t).toLocaleString('zh-TW', { hour12: false }) : '—');
const REASON = { spam: '垃圾訊息', harassment: '騷擾', copyright: '侵權', unmarked_sensitive: '未標記敏感內容', illegal: '違法內容', other: '其他' };
const GROUP = { news: '時事', game: '遊戲', mixed: '綜合', fun: '趣事', commenter: '留言' };
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
/** 熱門話題：遊戲帳號會依這裡的已知資訊發文（例如 GTA6） */
function topicsCard(s, set) {
  let topics = [];
  try { topics = JSON.parse(s.hot_topics || '[]'); } catch {}
  const box = h('section', { class: 'card glass' });
  const draw = () => {
    const rows = topics.map((t, i) => {
      const name = h('input', { value: t.name, maxlength: '30', placeholder: '話題名稱，例如 GTA6' });
      const ratio = h('select', null, [10, 20, 30, 40, 60, 80].map((v) => h('option', { value: String(v), selected: v === Number(t.ratio) ? true : null }, `遊戲帳號約 ${v}% 的文`)));
      const facts = h('textarea', { rows: '4', maxlength: '1500', placeholder: '已知的真實資訊（AI 只會用這裡的內容講具體細節，避免亂編）' }); facts.value = t.facts || '';
      const sync = () => { topics[i] = { name: name.value, ratio: Number(ratio.value), facts: facts.value, groups: t.groups || ['game'] }; };
      [name, ratio, facts].forEach((x) => x.addEventListener('input', sync));
      ratio.addEventListener('change', sync);
      return h('div', { class: 'stack', style: 'gap:6px;padding:10px;border-radius:12px;background:rgba(255,255,255,.5)' }, h('div', { class: 'row' }, name, ratio, h('button', { class: 'btn ghost small', onclick: () => { topics.splice(i, 1); draw(); } }, '刪除')), facts);
    });
    box.replaceChildren(h('h2', null, '熱門話題'), h('span', { class: 'muted' }, '遊戲帳號會依比例發這些話題的心得、吐槽、新手建議，自動帶入最近相關新聞標題。具體細節只會用你填的資訊，不會亂編。'),
      ...rows, h('div', { class: 'row' }, h('button', { class: 'btn ghost small', onclick: () => { topics.push({ name: '', ratio: 30, facts: '', groups: ['game'] }); draw(); } }, '＋ 新增話題'),
        h('button', { class: 'btn small', onclick: async () => { await set('hot_topics', topics.filter((t) => t.name.trim())); toast('已儲存'); } }, '儲存話題')));
  };
  draw();
  return box;
}

/** 伺服器用量：每 30 秒自動更新 */
function meter(label, value, limit, fmtV = (x) => x.toLocaleString()) {
  const pct = limit ? Math.min(100, (value / limit) * 100) : 0;
  const color = pct >= 90 ? '#C0392B' : pct >= 70 ? '#D68910' : 'var(--primary)';
  return h('div', { class: 'meter' }, h('div', { class: 'row between' }, h('span', null, label), h('b', null, `${fmtV(value)}${limit ? ` / ${fmtV(Math.round(limit))}` : ''}`)),
    limit ? h('div', { class: 'mbar' }, h('i', { style: `width:${pct}%;background:${color}` })) : null,
    limit ? h('small', { class: 'muted' }, `${pct.toFixed(1)}%${pct >= 90 ? '　⚠️ 快到上限了' : pct >= 70 ? '　注意' : ''}`) : null);
}

const ADMIN = {
  async queue(main) {
    const [d, bd] = await Promise.all([api('GET', '/api/admin/content/queue'), api('GET', '/api/communities')]);
    const boards = bd.communities || bd;
    const text = h('textarea', { rows: '4', maxlength: '1000', placeholder: '要排程的內容（可以加 #標籤）', style: 'width:100%' });
    const when = h('input', { type: 'datetime-local' });
    const t0 = new Date(Date.now() + 3600_000 + 8 * 3600_000); when.value = t0.toISOString().slice(0, 16);
    const board = h('select', null, h('option', { value: '' }, '自動（不指定）'), boards.map((b) => h('option', { value: b.slug }, `${b.icon || ''} ${b.name}`)));
    const as = h('select', null, h('option', { value: 'content' }, '由 ✦ 內容帳號輪流發'), h('option', { value: 'me' }, '用我的帳號發'));
    const msg = h('span', { class: 'muted' });
    const add = h('button', { class: 'btn', onclick: async () => {
      const at = new Date(when.value + ':00+08:00').getTime();
      try { await api('POST', '/api/admin/content/queue', { text: text.value, publish_at: at, board: board.value, as: as.value }); toast('已排程'); ADMIN.queue(main); } catch (e) { msg.textContent = e.message; }
    } }, '加入排程');
    main.replaceChildren(
      h('h1', null, '排程發文'),
      h('div', { class: 'stats' },
        h('div', { class: 'stat glass' }, h('b', null, d.pending), h('span', null, '排程中的文章')),
        h('div', { class: 'stat glass' }, h('b', null, d.until ? new Date(d.until).toLocaleDateString('zh-TW') : '—'), h('span', null, '已經排到')),
        h('div', { class: 'stat glass' }, h('b', null, d.done), h('span', null, '已經發出'))),
      h('section', { class: 'card glass' }, h('h2', null, '新增排程'),
        text, h('div', { class: 'row wrap' }, h('label', { class: 'field' }, '發文時間（台灣時間）', when), h('label', { class: 'field' }, '分類版', board), h('label', { class: 'field' }, '發文帳號', as)), add, msg),
      h('section', { class: 'card glass' }, h('h2', null, '接下來要發的'),
        d.next.length ? h('div', { class: 'stack' }, d.next.map((q) => h('div', { class: 'row between', style: 'gap:10px;padding:8px 0;border-bottom:1px solid rgba(0,0,0,.06)' },
          h('div', { style: 'min-width:0' }, h('small', { class: 'muted' }, `${new Date(q.publish_at).toLocaleString('zh-TW', { hour12: false })} · ${q.author || '✦ 輪流'}${q.board_slug ? ` · ${q.board_slug}` : ''}`), h('div', { style: 'white-space:pre-wrap' }, q.text.slice(0, 120))),
          h('button', { class: 'btn ghost small', onclick: async () => { await api('DELETE', `/api/admin/content/queue/${q.id}`); ADMIN.queue(main); } }, '刪除')))) : h('span', { class: 'muted' }, '目前沒有排程的文章')));
  },
  async server(main) {
    const d = await api('GET', '/api/admin/server');
    const L = d.limits[d.plan];
    const cf = d.cloudflare;
    const wk = cf.workers || [];
    const req = wk.reduce((n, x) => n + x.sum.requests, 0), err = wk.reduce((n, x) => n + x.sum.errors, 0);
    const cpu99 = Math.max(0, ...wk.map((x) => x.quantiles.cpuTimeP99 / 1000));
    const d1 = (cf.d1 || []).reduce((o, x) => ({ r: o.r + x.sum.rowsRead, w: o.w + x.sum.rowsWritten }), { r: 0, w: 0 });
    const planSel = h('select', { 'aria-label': 'Cloudflare 方案' }, [['free', '免費方案'], ['paid', 'Workers 付費方案']].map(([v, l]) => h('option', { value: v, selected: v === d.plan ? true : null }, l)));
    planSel.addEventListener('change', async () => { await api('PATCH', '/api/admin/settings', { cf_plan: planSel.value }); ADMIN.server(main); });
    const hours = wk.slice(-24);
    const maxH = Math.max(1, ...hours.map((x) => x.sum.requests));
    main.replaceChildren(
      h('div', { class: 'row between wrap' }, h('div', null, h('h1', null, '伺服器'), h('span', { class: 'muted' }, `每 30 秒自動更新 · ${fmt(d.time)}`)), h('label', { class: 'field' }, '目前方案', planSel)),
      h('div', { class: 'stats' },
        h('div', { class: 'stat glass' }, h('b', null, d.users.online5), h('span', null, '線上（5 分鐘內）')),
        h('div', { class: 'stat glass' }, h('b', null, d.users.online30), h('span', null, '30 分鐘內活躍')),
        h('div', { class: 'stat glass' }, h('b', null, d.users.active_today), h('span', null, '今日活躍用戶')),
        h('div', { class: 'stat glass' }, h('b', { style: `color:${d.db.latency_ms > 300 ? '#C0392B' : 'inherit'}` }, `${d.db.latency_ms} ms`), h('span', null, '資料庫回應時間')),
        h('div', { class: 'stat glass' }, h('b', { style: `color:${d.cron.healthy ? 'inherit' : '#C0392B'}` }, d.cron.healthy ? '正常' : '異常'), h('span', null, `排程（最後 ${fmt(d.cron.last_run)}）`))),
      h('section', { class: 'card glass' }, h('h2', null, `真人註冊：今天 ${d.signups.today} 人 · 7 天 ${d.signups.week} 人`),
        meter('目標：一週 100 位真人', d.signups.week, 100),
        d.signups.by_day.length ? h('div', { class: 'spark' }, d.signups.by_day.map((x) => h('i', { title: `${x.day}：${x.n} 人`, style: `height:${Math.max(4, (x.n / Math.max(1, ...d.signups.by_day.map((y) => y.n))) * 100)}%` }))) : null,
        h('span', { class: 'muted' }, '註冊來源（u: 開頭是被朋友邀請，src: 開頭是推廣連結的 utm_source）'),
        h('div', { class: 'row wrap', style: 'gap:6px' }, d.signups.by_ref.map((r) => h('span', { class: 'badge' }, `${r.ref}：${r.n}`)))),
      h('section', { class: 'card glass' }, h('h2', null, '今日用量'),
        meter('AI 用量（估算 neurons）', d.ai.neurons_today_est, L.neurons),
        d.db.size_bytes ? meter('資料庫大小（MB）', Math.round(d.db.size_bytes / 1048576), L.d1StorageMB) : null,
        h('div', { class: 'groups' },
          h('div', { class: 'field' }, '今日新文章', h('b', null, d.content.posts_today), h('small', { class: 'muted' }, `✦ ${d.content.ai_posts_today}`)),
          h('div', { class: 'field' }, '今日新留言', h('b', null, d.content.comments_today), h('small', { class: 'muted' }, `✦ ${d.content.ai_comments_today}`)),
          h('div', { class: 'field' }, '真人用戶', h('b', null, d.users.real.toLocaleString())),
          h('div', { class: 'field' }, '上傳圖片', h('b', null, d.content.uploads.toLocaleString())))),
      cf.enabled
        ? h('section', { class: 'card glass' }, h('h2', null, 'Cloudflare 真實用量（最近 24 小時）'),
            meter('網站請求數', req, L.requests),
            meter('資料庫讀取列數', d1.r, L.d1Reads),
            meter('資料庫寫入列數', d1.w, L.d1Writes),
            cf.r2 ? meter('圖片空間（GB）', Number((cf.r2.payloadSize / 1073741824).toFixed(2)), L.r2StorageGB, (x) => String(x)) : null,
            h('div', { class: 'groups' }, h('div', { class: 'field' }, '錯誤數', h('b', { style: `color:${err ? '#C0392B' : 'inherit'}` }, err)), h('div', { class: 'field' }, 'CPU 時間（P99）', h('b', null, `${cpu99.toFixed(1)} ms`), h('small', { class: 'muted' }, `上限 ${L.cpuMs} ms`))),
            hours.length ? h('div', null, h('span', { class: 'muted' }, '每小時請求數'), h('div', { class: 'spark' }, hours.map((x) => h('i', { title: `${new Date(x.dimensions.datetimeHour).toLocaleString('zh-TW', { hour12: false })}：${x.sum.requests}`, style: `height:${Math.max(3, (x.sum.requests / maxH) * 100)}%` })))) : null,
            cf.errors?.length ? h('small', { class: 'err' }, cf.errors.join('；')) : null)
        : h('section', { class: 'card glass' }, h('h2', null, 'Cloudflare 真實用量'),
            h('span', { class: 'muted' }, '上面是網站自己量得到的數字。要看 Cloudflare 的真實請求數、CPU、資料庫讀寫量，需要在 Cloudflare 建立一組「Account Analytics：Read」的 API 權杖，存成 wooo 的密鑰 CF_API_TOKEN。')),
      h('section', { class: 'card glass' }, h('h2', null, '怎麼判斷撐不撐得住'),
        h('ul', { class: 'list' },
          h('li', null, '任何一條超過 70% 會變橘色、90% 變紅色。免費方案到上限會直接停止服務，建議在 70% 左右升級 Workers 付費方案（US$5／月）。'),
          h('li', null, '資料庫回應時間平常在 50 ms 以內；常常超過 300 ms 代表查詢太多，需要優化。'),
          h('li', null, '排程顯示「異常」代表 ✦ 帳號超過 15 分鐘沒動作，通常是 AI 額度用完或程式出錯。'))));
    clearTimeout(ADMIN._srvTimer);
    ADMIN._srvTimer = setTimeout(() => { if (location.pathname === '/admin/server') ADMIN.server(main).catch(() => {}); }, 30000);
  },

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
  async boards(main) {
    const d = await api('GET', '/api/communities');
    const GOPTS = [['', '不指定'], ['news', '時事帳號'], ['game', '遊戲帳號'], ['mixed', '綜合帳號'], ['fun', '趣事帳號']];
    const form = (c) => {
      const name = h('input', { maxlength: '20', value: c?.name || '', placeholder: '例如：美食' });
      const slug = h('input', { maxlength: '24', value: c?.slug || '', placeholder: '例如：food', disabled: c ? true : null });
      const icon_ = h('input', { maxlength: '4', value: c?.icon || '', placeholder: '🍜', style: 'width:80px' });
      const desc = h('textarea', { rows: '2', maxlength: '200', placeholder: '這個分類版在聊什麼？' }); desc.value = c?.description || '';
      const grp = h('select', null, GOPTS.map(([v, l]) => h('option', { value: v, selected: (c?.content_group || '') === v ? true : null }, l)));
      const err = h('span', { class: 'err' });
      const m = modal(c ? `編輯「${c.name}」` : '新增分類版',
        h('label', { class: 'field' }, '名稱', name),
        h('label', { class: 'field' }, '網址代號（英文小寫、數字、-；建立後不能改）', slug),
        h('label', { class: 'field' }, '圖示（一個表情符號）', icon_),
        h('label', { class: 'field' }, '介紹', desc),
        h('label', { class: 'field' }, '哪一組 ✦ 帳號最常來這個版（他們還是會到各版發文）', grp), err,
        h('button', { class: 'btn', onclick: async () => {
          const body = { name: name.value, slug: slug.value, icon: icon_.value, description: desc.value, content_group: grp.value || null };
          try { await api(c ? 'PATCH' : 'POST', c ? `/api/communities/${c.slug}` : '/api/communities', body); m.remove(); toast('已儲存'); ADMIN.boards(main); } catch (e) { err.textContent = e.message; }
        } }, '儲存'));
    };
    main.replaceChildren(h('div', { class: 'row between' }, h('div', null, h('h1', null, '分類版'), h('span', { class: 'muted' }, '用戶不能自己開版，只能在這裡的分類版發文（沒選就放「暢所欲言」）。✦ 帳號會到各版發文，「✦ 帳號」欄是哪一組最常來。')), h('button', { class: 'btn', onclick: () => form(null) }, '＋ 新增分類版')),
      h('section', { class: 'card glass' }, table(['分類版', '介紹', '✦ 常客', '文章', ''], d.communities.map((c) => h('tr', null,
        h('td', null, h('a', { href: `/c/${c.slug}` }, `${c.icon} ${c.name}`), h('br'), h('span', { class: 'muted' }, `/c/${c.slug}`)),
        h('td', { class: 'muted', style: 'max-width:280px' }, c.description || '—'),
        h('td', null, c.content_group ? h('span', { class: 'pill' }, GROUP[c.content_group]) : '—'),
        h('td', null, c.post_count),
        h('td', { style: 'white-space:nowrap' }, h('button', { class: 'btn ghost small', onclick: () => form(c) }, '編輯'), ' ',
          c.id === 'cm_free' ? null : h('button', { class: 'btn danger small', onclick: async () => { if (!confirm(`刪除「${c.name}」？裡面的文章會移到「暢所欲言」。`)) return; try { await api('DELETE', `/api/communities/${c.slug}`); toast('已刪除'); ADMIN.boards(main); } catch (e) { toast(e.message); } } }, '刪除')))))));
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
    const pixKey = h('input', { type: 'password', placeholder: s.pixabay_key ? '已設定（輸入新的會覆蓋）' : '貼上 Pixabay API Key', autocomplete: 'off' });
    const pexKey = h('input', { type: 'password', placeholder: s.pexels_key ? '已設定（輸入新的會覆蓋）' : '貼上 Pexels API Key', autocomplete: 'off' });
    const curModel = s.ai_model || d.default_model;
    const modelSel = h('select', { 'aria-label': 'AI 模型' }, MODELS.map(([v, l]) => h('option', { value: v, selected: v === curModel ? true : null }, l)));
    const perPost = (MODELS.find(([v]) => v === curModel) || MODELS[0])[2];
    const neurons = d.posts_per_day * perPost * 1.2;
    const monthly = Math.max(0, neurons - 10000) * 0.011 / 1000 * 30;
    modelSel.addEventListener('change', () => set('ai_model', modelSel.value).then(() => { toast('已儲存'); ADMIN.content(main); }));
    const RANGES = [['5-50', '每篇 5～50 則'], ['3-20', '每篇 3～20 則'], ['1-10', '每篇 1～10 則'], ['0-0', '不留言']];
    const curRange = `${s.comment_min ?? 5}-${s.comment_max ?? 50}`;
    const commentSel = h('select', { 'aria-label': '每篇留言數' }, (RANGES.some(([v]) => v === curRange) ? RANGES : [[curRange, curRange.replace('-', '～') + ' 則'], ...RANGES]).map(([v, l]) => h('option', { value: v, selected: v === curRange ? true : null }, l)));
    commentSel.addEventListener('change', async () => { const [mn, mx] = commentSel.value.split('-'); await api('PATCH', '/api/admin/settings', { comment_min: mn, comment_max: mx }); toast('已儲存'); });
    const adultSel = h('select', { 'aria-label': '成人梗比例' }, [0, 5, 10, 20, 30].map((v) => h('option', { value: String(v), selected: String(v) === String(s.adult_ratio ?? '10') ? true : null }, v ? `約 ${v}%` : '不發成人梗')));
    adultSel.addEventListener('change', () => set('adult_ratio', adultSel.value).then(() => toast('已儲存')));
    const cModelSel = h('select', { 'aria-label': '留言用的 AI 模型' }, MODELS.map(([v, l]) => h('option', { value: v, selected: v === (s.comment_model || '@cf/meta/llama-3.1-8b-instruct-fp8-fast') ? true : null }, l)));
    cModelSel.addEventListener('change', () => set('comment_model', cModelSel.value).then(() => toast('已儲存')));
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
      h('div', { class: 'groups four' }, groupCard('news'), groupCard('game'), groupCard('mixed'), groupCard('fun'), groupCard('commenter')),
      d.groups.commenter ? null : h('section', { class: 'card glass' }, h('h2', null, '留言專用帳號'), h('span', { class: 'muted' }, '還沒建立 200 個留言專用 ✦ 帳號。'), h('button', { class: 'btn', style: 'align-self:flex-start', onclick: async () => { const r = await api('POST', '/api/admin/content/seed-commenters'); toast(`已建立 ${r.added} 個`); ADMIN.content(main); } }, '建立 200 個留言帳號')),
      topicsCard(s, set),
      (() => {
        const inp = h('input', { type: 'url', placeholder: '貼上文章或影片網址，例如 https://www.threads.com/@xxx/post/...', style: 'flex:1;min-width:260px' });
        const out = h('span', { class: 'muted' });
        const go = h('button', { class: 'btn small', onclick: async () => {
          if (!inp.value.trim()) return;
          go.disabled = true; out.textContent = '轉貼中…（AI 會寫一兩句看法，大約 10 秒）';
          try { const r = await api('POST', '/api/admin/content/share-url', { url: inp.value.trim() }); out.textContent = r.posted ? `✓ 已由「${r.account}」轉貼：${r.title}` : r.error; if (r.posted) inp.value = ''; }
          catch (e) { out.textContent = e.message; }
          go.disabled = false;
        } }, '轉貼');
        return h('section', { class: 'card glass' }, h('h2', null, '轉貼網址'), h('span', { class: 'muted' }, '看到不錯的文章或影片，貼上網址，會由一個 ✦ 帳號轉貼：附一兩句看法和原文連結、縮圖，不複製原文內容。政治文會自動保持中立。'), h('div', { class: 'row wrap' }, inp, go), out);
      })(),
      h('section', { class: 'card glass' }, h('h2', null, '真實照片'),
        h('span', { class: 'muted' }, '時事以外的貼文，部分會從免費圖庫找一張符合內容的真實照片，右下角標示攝影者。不填金鑰也會用 Openverse（CC0／公眾領域／CC BY 授權）；填了 Pixabay 金鑰（pixabay.com/api/docs 免費申請）畫質更好。'),
        h('div', { class: 'groups' }, h('label', { class: 'field' }, '附照片的比例', photoSel),
          h('label', { class: 'field' }, `Pixabay API Key${s.pixabay_key ? '（已設定）' : '（選填）'}`, h('div', { class: 'row' }, pixKey, h('button', { class: 'btn small', onclick: async () => { if (!pixKey.value.trim()) return; await set('pixabay_key', pixKey.value.trim()); toast('已儲存'); ADMIN.content(main); } }, '儲存'))),
          h('label', { class: 'field' }, `Pexels API Key${s.pexels_key ? '（已設定）' : '（選填，目前 Pexels 暫停發新金鑰）'}`, h('div', { class: 'row' }, pexKey, h('button', { class: 'btn small', onclick: async () => { if (!pexKey.value.trim()) return; await set('pexels_key', pexKey.value.trim()); toast('已儲存'); ADMIN.content(main); } }, '儲存'))))),
      h('section', { class: 'card glass' }, h('h2', null, 'AI 模型與費用'),
        h('div', { class: 'groups' }, h('label', { class: 'field' }, 'AI 模型', modelSel),
          h('div', { class: 'field' }, '預估 AI 費用', h('b', { style: 'font-size:20px' }, monthly < 0.5 ? '免費額度內' : `約 US$${monthly.toFixed(0)}／月`), h('span', { class: 'muted' }, `每天約 ${Math.round(neurons).toLocaleString()} neurons，免費 10,000／天，超過每 1,000 收 US$0.011${monthly < 0.5 ? '。' : '，而且需要 Workers 付費方案 US$5／月。'}`)))),
      h('section', { class: 'card glass' }, h('h2', null, '發文與互動設定'),
        h('div', { class: 'groups' },
          h('label', { class: 'field' }, '熱門動態牆 ✦ 比例上限', ratioSel),
          h('div', { class: 'field' }, '內容帳號互相按讚', sw(s.interact_like === '1', (v) => set('interact_like', v ? '1' : '0'), '互相按讚')),
          h('div', { class: 'field' }, '內容帳號互相留言', sw(s.interact_comment === '1', (v) => set('interact_comment', v ? '1' : '0'), '互相留言')),
          h('label', { class: 'field' }, '停用後的舊文', oldMode),
          h('label', { class: 'field' }, '每篇 ✦ 文章的留言數', commentSel),
          h('label', { class: 'field' }, '成人梗比例（會標記敏感）', adultSel),
          h('label', { class: 'field' }, '留言用的 AI 模型', cModelSel),
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
    const LABEL = { 'user_status:active': '恢復帳號', 'user_status:suspended': '停權', 'user_status:banned': '封鎖', 'user_role:gm': '設為 GM', 'user_role:user': '取消 GM', user_delete: '刪除帳號', post_hide: '隱藏文章', post_unhide: '取消隱藏', post_mark_sensitive: '標記敏感', post_delete: '刪除文章', report_hide: '檢舉：隱藏', report_mark_sensitive: '檢舉：標記敏感', report_dismiss: '檢舉：略過', content_account_edit: '編輯內容帳號', content_disable_all: '停用全部內容帳號', setting: '修改設定', appeal_accept: '申訴：接受', appeal_reject: '申訴：駁回', comment_delete: '刪除留言', board_create: '新增分類版', board_edit: '編輯分類版', board_delete: '刪除分類版', daily_poll_now: '發每日投票' };
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
