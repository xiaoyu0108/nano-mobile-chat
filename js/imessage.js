/* ============================================================
   iMessage · 独立消息存储 + 与线上记忆互通
   - 消息存 IndexedDB(nano_imessage_db/chats)，与线上聊天记录分开（两个 App）
   - 长期记忆与线上共用 nano_vector_memory_db (memlist_<charId>)
   - 马甲=匿名：用马甲发消息会进入独立卡片与聊天窗口，对方不知道是你
   - 表情包来源：nano_api_db / emoji_data / nano_emoji_data
   ============================================================ */
(function () {
'use strict';

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/* ---------------- 基础工具 ---------------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function nowHHMM() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function uid(p) { return (p || 'im_') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function safeParse(s, d) { try { return JSON.parse(s); } catch (e) { return d; } }
function isMine(m) { return m && (m.who === 'me' || m.type === 'right'); }

/* ---------------- IndexedDB ---------------- */
function openDB(name, version, upgrade) {
  return new Promise(resolve => {
    try {
      const req = version ? indexedDB.open(name, version) : indexedDB.open(name);
      req.onupgradeneeded = e => { try { upgrade && upgrade(e.target.result, e.target.transaction); } catch (err) {} };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch (e) { resolve(null); }
  });
}
function dbGetAll(db, store) {
  return new Promise(resolve => {
    if (!db) return resolve([]);
    try {
      const r = db.transaction(store, 'readonly').objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => resolve([]);
    } catch (e) { resolve([]); }
  });
}
function dbGet(db, store, key) {
  return new Promise(resolve => {
    if (!db) return resolve(null);
    try {
      const r = db.transaction(store, 'readonly').objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => resolve(null);
    } catch (e) { resolve(null); }
  });
}
function dbPut(db, store, val) {
  return new Promise(resolve => {
    if (!db) return resolve(false);
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(val);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch (e) { resolve(false); }
  });
}
function dbDelete(db, store, key) {
  return new Promise(resolve => {
    if (!db) return resolve(false);
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch (e) { resolve(false); }
  });
}
function imChatUpgrade(db) {
  if (!db.objectStoreNames.contains('chats')) db.createObjectStore('chats', { keyPath: 'id' });
  if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
}
function openIMDB() {
  // 先按现有版本打开（不存在则自动建库）；若表缺失再升级一次补齐，避免旧库导致“怎么写都存不住”
  return openDB('nano_imessage_db', 0, imChatUpgrade).then(db => {
    if (db && db.objectStoreNames && !db.objectStoreNames.contains('chats')) {
      const next = (db.version || 1) + 1;
      try { db.close(); } catch (e) {}
      return openDB('nano_imessage_db', next, imChatUpgrade);
    }
    return db;
  });
}
function openVectorDB() {
  return openDB('nano_vector_memory_db', 0, db => {
    if (!db.objectStoreNames.contains('config')) db.createObjectStore('config', { keyPath: 'key' });
    if (!db.objectStoreNames.contains('chat_state')) db.createObjectStore('chat_state', { keyPath: 'chatId' });
    if (!db.objectStoreNames.contains('chat_messages')) db.createObjectStore('chat_messages', { keyPath: 'chatId' });
    if (!db.objectStoreNames.contains('memories')) db.createObjectStore('memories', { keyPath: 'id' });
  });
}
// emoji 数据源（与 emoji 应用一致）
function openApiDB() {
  return openDB('nano_api_db', 0, db => {
    if (!db.objectStoreNames.contains('emoji_data')) db.createObjectStore('emoji_data', { keyPath: 'key' });
    if (!db.objectStoreNames.contains('api_data')) db.createObjectStore('api_data', { keyPath: 'key' });
  });
}
function idbValue(rec) { return rec && rec.value !== undefined ? rec.value : rec; }
function loadEmojiData() {
  return openApiDB().then(db => dbGet(db, 'emoji_data', 'nano_emoji_data')).then(rec => {
    const v = idbValue(rec);
    if (v && v.emojiGroups && v.emojiGroups.length) return v;
    return openApiDB().then(db => dbGet(db, 'emoji_data', 'peach_home_data')).then(rec2 => {
      const v2 = idbValue(rec2);
      if (v2 && v2.emojiGroups && v2.emojiGroups.length) return v2;
      return safeParse(localStorage.getItem('nano_emoji_data'), null) || safeParse(localStorage.getItem('peach_home_data'), null);
    });
  }).catch(() => null);
}

/* ---------------- 世界书（与线上共用 nano_worldbook_data_v5 / nano_worldbook_db） ---------------- */
let allWorldbooks = [];
const WB_LOCAL_KEY = 'nano_worldbook_data_v5';
const WB_LEGACY_KEYS = ['nano_worldbook_data', 'peach_worldbook_data'];
function normalizeWorldbook(f) {
  if (!f) return null;
  const entries = Array.isArray(f.entries) ? f.entries : [];
  const content = typeof f.content === 'string' ? f.content : '';
  let list = entries.filter(e => e && e.content && String(e.content).trim());
  if (!list.length && content && content.trim()) {
    list = [{ title: f.name || '', keywords: '', keywordEnabled: false, permanent: true, content: content, position: (f.position === 'front' ? 'before_char' : (f.position === 'back' ? 'after_chat' : 'after_char')) }];
  }
  if (!list.length) return null;
  return { id: f.id, name: f.name || '未命名', group: f.group || '', scope: f.scope || 'global', boundCharacters: Array.isArray(f.boundCharacters) ? f.boundCharacters : [], entries: list };
}
function loadWorldbooksFromDB() {
  const keys = [WB_LOCAL_KEY].concat(WB_LEGACY_KEYS);
  for (const k of keys) {
    try {
      const raw = localStorage.getItem(k);
      if (raw) { const d = safeParse(raw, null); if (d && Array.isArray(d.files)) { allWorldbooks = d.files.map(normalizeWorldbook).filter(Boolean); break; } }
    } catch (e) {}
  }
  try {
    const req = indexedDB.open('nano_worldbook_db');
    req.onupgradeneeded = e => { try { const db = e.target.result; if (!db.objectStoreNames.contains('worldbook_data')) db.createObjectStore('worldbook_data', { keyPath: 'key' }); } catch (err) {} };
    req.onsuccess = e => {
      try {
        const db = e.target.result;
        const r = db.transaction('worldbook_data', 'readonly').objectStore('worldbook_data').get('data');
        r.onsuccess = () => {
          const d = r.result ? r.result.value : null;
          if (d && Array.isArray(d.files)) { allWorldbooks = d.files.map(normalizeWorldbook).filter(Boolean); try { localStorage.setItem(WB_LOCAL_KEY, JSON.stringify(d)); } catch (err) {} }
          try { db.close(); } catch (err) {}
        };
        r.onerror = () => { try { db.close(); } catch (err) {} };
      } catch (err) {}
    };
    req.onerror = () => {};
  } catch (e) {}
}
function wbRecentText(msgs) {
  const parts = [];
  const arr = Array.isArray(msgs) ? msgs : [];
  for (let i = arr.length - 1; i >= 0 && parts.length < 80; i--) {
    const m = arr[i]; if (!m || m.recalled || m.type === 'system') continue;
    const t = m.text || (m.imageData && m.imageData.emojiName) || '';
    if (t && String(t).trim()) parts.unshift(String(t).trim());
  }
  return parts.join('\n');
}
function wbEntryHit(entry, recent) {
  const kw = String(entry.keywords || '').trim();
  if (!kw) return false;
  const lower = recent.toLowerCase();
  return kw.split(/[,，、；\s]+/).filter(Boolean).some(k => k && lower.indexOf(k.toLowerCase()) > -1);
}
function wbShouldInclude(entry, recent) {
  if (entry.enabled === false) return false;
  if (!entry.content || !String(entry.content).trim()) return false;
  if (entry.permanent === true) return true;
  if (entry.keywordEnabled !== false) { if (!String(entry.keywords || '').trim()) return true; return wbEntryHit(entry, recent); }
  return true;
}
function getWorldbookText(ch, msgs) {
  const recent = wbRecentText(msgs);
  const chObj = ch || {};
  const idCandidates = [chObj.id, chObj.name].filter(Boolean).map(String);
  const bindIds = {};
  try { ((chObj && chObj.worldbookBindings) || []).forEach(b => { if (b && b.id) bindIds[String(b.id)] = true; }); } catch (e) {}
  const front = [], middle = [], back = [];
  allWorldbooks.forEach(w => {
    if (!w) return;
    if ((w.scope || 'global') === 'local') {
      const hit = bindIds[String(w.id)] || w.boundCharacters.some(b => idCandidates.indexOf(String(b)) !== -1);
      if (!hit) return;
    }
    w.entries.forEach(en => {
      if (!wbShouldInclude(en, recent)) return;
      const pos = en.position || 'after_char';
      const content = String(en.content || '').trim();
      const text = (en.title ? '【' + en.title + '】\n' : '') + content;
      if (pos === 'before_char') front.push(text);
      else if (pos === 'after_chat') back.push(text);
      else middle.push(text);
    });
  });
  return {
    front: front.length ? '\n【世界书 · 关键设定】\n' + front.join('\n\n') + '\n' : '',
    middle: middle.length ? '\n【世界书】\n' + middle.join('\n\n') + '\n' : '',
    back: back.length ? '\n【世界书 · 补充】\n' + back.join('\n\n') + '\n' : ''
  };
}
const LANG_BY_NAT = {
  '美国': '英文', '英国': '英文', '澳大利亚': '英文', '加拿大': '英文',
  '日本': '日文', '韩国': '韩文', '法国': '法文', '德国': '德文',
  '西班牙': '西班牙文', '意大利': '意大利文', '俄罗斯': '俄文',
  '巴西': '葡萄牙文', '墨西哥': '西班牙文', '印度': '英文'
};
function charLanguage(ch) {
  const direct = String((ch && ch.language) || '').trim();
  if (direct) return direct;
  const nat = String((ch && ch.nationality) || '').trim();
  for (const k in LANG_BY_NAT) { if (nat.indexOf(k) !== -1) return LANG_BY_NAT[k]; }
  return '英文';
}
// 全局核心准则（与主聊天共用，确保各 App 行为一致）
const CORE_POLICY = '\n【核心准则 · 每次都要遵守】\n'
  + '1. 关于性的中庸之道：性是爱情的调味剂。情侣之间可以偶尔有一点荤话、些许隐晦的调情与暧昧，但绝不能一直开黄腔，不把开黄腔当成情趣；正常聊天大部分与性无关，只偶尔隐晦地调情，必须少量，不能显得低俗油腻。中庸乃最优解。若对方（你聊天的人）的人设是朋友、亲人等非情侣关系，则绝对禁止任何性相关荤话。\n'
  + '2. 【世界书】【记忆库】【记忆宫殿】【人设】都是必读项，可自主读取其中较重要的内容，输出时必须遵守；你就是{{char}}，一个活生生的人。记忆是重中之重，必须完善、完整，角色不能随时失忆；线上、线下以及各类 App 的记忆大多互通。记忆宫殿是调节角色记忆的地方，能让角色更好地记住重要的东西，分门别类的记忆线索也更利于角色查找、读取记忆。\n';
function readGlobalBuiltinPrompt() {
  try {
    if (window.NanoPrompts && NanoPrompts.activeText) return String(NanoPrompts.activeText('social') || '').trim();
    return (localStorage.getItem('nano_builtin_prompt') || '').trim();
  } catch (e) { return ''; }
}

/* ---------------- 用户 / 角色 ---------------- */
function readCurrentUser() {
  try {
    const keys = ['nano_mask_data', 'nano_home_data', 'peach_home_data'];
    for (const k of keys) {
      const raw = localStorage.getItem(k);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && Array.isArray(d.masks)) return (d.masks || []).find(m => m.id === d.currentMaskId) || null;
      }
    }
  } catch (e) {}
  return null;
}
function loadCharacters() {
  return openDB('nano_characters_db', 0, db => {
    if (!db.objectStoreNames.contains('characters')) db.createObjectStore('characters', { keyPath: 'id' });
  }).then(db => dbGetAll(db, 'characters')).then(list => (list || []).filter(c => c && c.id && c.name));
}
/* ---------------- 用户隔离 ---------------- */
// 当前人设（user）命名空间；不同人设之间 iMessage 互不可见
function currentNs() {
  try {
    const u = readCurrentUser();
    if (u && u.id != null && u.id !== '') return String(u.id);
  } catch (e) {}
  return 'default';
}
// 判断角色是否属于当前人设：绑定角色，或本人生成的「小号」（isAltProbe 且 origin 属于当前人设）
function isCharOfUser(ch, all) {
  if (!ch) return false;
  if (typeof isAssistantChar === 'function' && isAssistantChar(ch)) return false; // 纳米不在社交软件里
  const ns = currentNs();
  if (ch.bindUser != null && String(ch.bindUser) === ns) return true;
  if (ch.isAltProbe && ch.altOriginId) {
    const origin = (all || state.allChars || []).find(x => x && x.id === ch.altOriginId);
    if (origin && origin.bindUser != null && String(origin.bindUser) === ns) return true;
  }
  // 兼容旧数据的 NPC（没有 bindUser 也没有小号来源）：不归属任何绑定角色，保留以免丢会话
  if (ch.isNpc && (ch.bindUser == null || ch.bindUser === '') && !ch.altOriginId) return true;
  return false;
}
function filterCharsForUser(list) {
  return (list || []).filter(c => isCharOfUser(c, list));
}
// 推断某个会话归属：优先用显式 owner，其次用绑定角色，最后归到当前人设
function inferOwner(c) {
  try {
    if (c && c.owner != null && c.owner !== '') return String(c.owner);
    const cid = c && (c.charId || c.altOf);
    if (cid) {
      const ch = (state.allChars || []).find(x => x && x.id === cid);
      if (ch && ch.bindUser != null && ch.bindUser !== '') return String(ch.bindUser);
    }
  } catch (e) {}
  return currentNs();
}
function claimAndFilterChats(list) {
  const ns = currentNs();
  return (list || []).filter(c => c && c.id).map(c => {
    if (c.owner == null || c.owner === '') c.owner = inferOwner(c);
    return c;
  }).filter(c => String(c.owner) === ns);
}

/* ---------------- 设置 ---------------- */
function getSetting(charId, key, def) {
  try {
    const v = localStorage.getItem('chat_setting_' + key + '_' + charId);
    if (v === null) return def;
    return safeParse(v, v);
  } catch (e) { return def; }
}
function setSetting(charId, key, val) {
  try { localStorage.setItem('chat_setting_' + key + '_' + charId, JSON.stringify(val)); } catch (e) {}
}

/* ---------------- 主 API ---------------- */
function readApiConfig() {
  return openApiDB().then(db => dbGet(db, 'api_data', 'nano_api_config')).then(rec => {
    const cfg = idbValue(rec);
    if (cfg && cfg.mainUrl) return cfg;
    return safeParse(localStorage.getItem('nano_api_config'), null);
  });
}
function apiBase(url) {
  let b = String(url || '').trim().replace(/\/+$/, '');
  if (!/\/v1$/.test(b)) b += '/v1';
  return b;
}
function sendApiFetch(payload, tokenOverride, resultKeyOverride) {
  return new Promise(resolve => {
    const token = tokenOverride || ('im' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
    const resultKey = resultKeyOverride || ('chat_api_result_' + token);
    let done = false;
    function finish(data) {
      if (done) return; done = true;
      try { localStorage.removeItem(resultKey); } catch (e) {}
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('message', onMsg);
      resolve(data);
    }
    function onStorage(e) { if (e && e.key === resultKey && e.newValue) finish(safeParse(e.newValue, null)); }
    function onMsg(e) {
      const d = e.data;
      if (d && d.type === 'chatApiDone' && d.token === token) {
        let v = null; try { v = localStorage.getItem(resultKey); } catch (err) {}
        finish(v ? safeParse(v, null) : null);
      }
    }
    window.addEventListener('storage', onStorage);
    window.addEventListener('message', onMsg);
    let useProxy = false;
    try { useProxy = window.parent && window.parent !== window; } catch (e) { useProxy = false; }
    if (useProxy) {
      try {
        window.parent.postMessage({
          type: 'chatApiFetch', token: token, resultKey: resultKey,
          url: payload.url, method: payload.method || 'POST',
          headers: payload.headers || {}, body: payload.body
        }, '*');
      } catch (e) { useProxy = false; }
    }
    if (!useProxy) {
      fetch(payload.url, { method: payload.method || 'POST', headers: payload.headers || {}, body: payload.body })
        .then(r => r.json().then(j => ({ ok: r.ok, data: j })).catch(() => ({ ok: r.ok, data: null })))
        .then(res => finish(res.data))
        .catch(() => finish(null));
      return;
    }
    let n = 0;
    const iv = setInterval(() => {
      n++;
      let v = null;
      try { v = localStorage.getItem(resultKey); } catch (e) {}
      if (v) { clearInterval(iv); finish(safeParse(v, null)); }
      else if (n > 120) { clearInterval(iv); finish(null); }
    }, 250);
  });
}
let lastApiError = '';
function pendingKey() { return 'nano_imessage_pending_' + currentNs(); }
function loadPending() { return safeParse(localStorage.getItem(pendingKey()), []) || []; }
function savePending(l) { try { localStorage.setItem(pendingKey(), JSON.stringify(l)); } catch (e) {} }
function addPending(p) { const l = loadPending(); l.push(p); savePending(l); updatePendingIndicator(); }
function removePending(token) { savePending(loadPending().filter(p => p.token !== token)); updatePendingIndicator(); }
let busyLabel = '';
function typingActive() {
  try {
    if (busyLabel && busyLabel.indexOf('回复') >= 0) return true;
    return loadPending().some(p => p.kind === 'reply' || p.kind === 'blocking');
  } catch (e) { return false; }
}
function syncTypingRow() {
  const box = $('#messages');
  if (!box) return;
  let row = $('#imTypingRow');
  if (!typingActive()) {
    if (row) row.remove();
    return;
  }
  if (!row) {
    row = document.createElement('div');
    row.id = 'imTypingRow';
    row.className = 'im-typing-row';
  } else {
    row.remove();
  }
  const c = state.current || {};
  const initial = String(c.name || '?').slice(0, 1);
  const av = c.avatar
    ? `<img src="${esc(c.avatar)}" alt="">`
    : `<span>${esc(initial)}</span>`;
  row.innerHTML = `<div class="im-typing-avatar">${av}</div><div class="im-typing-bubble"><i></i><i></i><i></i></div>`;
  var before = box.scrollHeight;
  box.appendChild(row);
  // 内容很少时把「正在输入」压到输入栏上方，而不是飘在消息顶部
  var gap = box.clientHeight - before - row.offsetHeight;
  row.style.marginTop = gap > 0 ? gap + 'px' : '8px';
  box.scrollTop = box.scrollHeight;
}
function updatePendingIndicator() {
  const list = loadPending();
  syncTypingRow();
  if (list.length) startPendingWatch();
}
function setBusy(label) { busyLabel = label || ''; updatePendingIndicator(); }
let pendingWatch = null;
async function reloadChatsFromDB() {
  try {
    const chats = await dbGetAll(imdb, 'chats');
    state.chats = claimAndFilterChats(chats);
    state.chats.forEach(c => { if (!Array.isArray(c.history)) c.history = []; });
    // 合并 localStorage 镜像（外部写入时 DB 万一没落盘也能拿到）
    const lsChats = claimAndFilterChats(loadChatsFromLS());
    if (lsChats.length) {
      const byId = {};
      state.chats.forEach(c => { byId[c.id] = c; });
      lsChats.forEach(lc => {
        const cur = byId[lc.id];
        if (!cur) { state.chats.push(lc); byId[lc.id] = lc; }
        else if ((lc.history || []).length > (cur.history || []).length) cur.history = lc.history;
      });
    }
    const curId = state.current && state.current.id;
    if (curId) {
      const nc = state.chats.find(c => c.id === curId);
      if (nc) { state.current = nc; state.messages = nc.history || []; renderMessages(); renderBanner(nc); }
    }
    renderList();
  } catch (e) {}
}
function startPendingWatch() {
  if (pendingWatch) return;
  let sawExternal = loadPending().some(p => p.kind === 'blocking');
  pendingWatch = setInterval(async () => {
    const list = loadPending();
    if (list.some(p => p.kind === 'blocking')) sawExternal = true;
    updatePendingIndicator();
    if (!list.length) {
      clearInterval(pendingWatch); pendingWatch = null;
      // 只有外部（拉黑让角色联系）才需要从库里重载；自己发起的回复/刷新已就地写入，避免“闪现又消失”
      if (sawExternal) setTimeout(() => { reloadChatsFromDB(); }, 800);
    }
  }, 1500);
}
function notifyApp(title, body, opts) {
  opts = opts || {};
  // iMessage 只走系统通知，不再经过内置通知栏
  try {
    if (!('Notification' in window)) return;
    const payload = {
      body: String(body || '').slice(0, 160),
      tag: 'imessage-' + Date.now(),
      renotify: true,
      data: { target: 'imessage' }
    };
    if (opts.icon) payload.icon = opts.icon;
    function legacy() {
      try {
        const n = new Notification(title || 'iMessage', payload);
        n.onclick = function () {
          try { window.focus(); } catch (e) {}
          try { if (window.parent !== window) window.parent.postMessage({ type: 'notifyOpen', target: 'imessage' }, '*'); } catch (e) {}
          try { n.close(); } catch (e) {}
        };
      } catch (e) {}
    }
    function show() {
      if (Notification.permission !== 'granted') return;
      try {
        if (navigator.serviceWorker && navigator.serviceWorker.ready) {
          let done = false;
          const t = setTimeout(function () { if (!done) { done = true; legacy(); } }, 500);
          navigator.serviceWorker.ready.then(function (reg) {
            if (done) return;
            done = true; clearTimeout(t);
            if (reg && reg.showNotification) { try { reg.showNotification(title || 'iMessage', payload); return; } catch (e) {} }
            legacy();
          }).catch(function () { if (!done) { done = true; clearTimeout(t); legacy(); } });
        } else legacy();
      } catch (e) { legacy(); }
    }
    if (Notification.permission === 'granted') show();
    else if (Notification.permission === 'default') Notification.requestPermission().then(function (p) { if (p === 'granted') show(); }).catch(function () {});
  } catch (e) {}
}
function extractContent(data) {
  if (!data) return null;
  try {
    if (typeof data.text === 'string') { if (data.ok === false) return null; data = safeParse(data.text, null); }
    if (!data) return null;
    if (data.error) { lastApiError = '接口报错：' + (data.error.message || JSON.stringify(data.error)).slice(0, 120); return null; }
    const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content);
    return content || null;
  } catch (e) { return null; }
}
async function callApi(history, opts, meta) {
  opts = opts || {};
  lastApiError = '';
  const cfg = await readApiConfig();
  if (!cfg || !cfg.mainUrl || !cfg.mainKey || !cfg.mainModel) {
    lastApiError = '没有找到主 API 配置（请在 API 小窗填写 地址 / Key / 模型）';
    return null;
  }
  // 重roll 纠正：只作用于本轮回复，插在系统提示之后
  try {
    if (meta && meta.kind === 'reply' && window.__imessageRerollReason) {
      const rr = String(window.__imessageRerollReason || '').trim();
      window.__imessageRerollReason = '';
      if (rr) {
        const block = (window.NanoReroll && NanoReroll.block) ? NanoReroll.block(rr) : ('\n\n【本次重roll必须修正】' + rr);
        history = history.slice();
        if (history.length && history[0].role === 'system') history.splice(1, 0, { role: 'system', content: block.trim() });
        else history.unshift({ role: 'system', content: block.trim() });
      }
    }
  } catch (e) {}
  const payload = {
    url: apiBase(cfg.mainUrl) + '/chat/completions',
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + String(cfg.mainKey).trim(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.mainModel,
      messages: history,
      max_tokens: opts.maxTokens || 400,
      temperature: (opts.temperature != null) ? opts.temperature : (Number(cfg.mainTemp) || 0.8)
    })
  };
  const token = 'im' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const resultKey = 'chat_api_result_' + token;
  // 记录待处理请求：切页/关页后回来仍能接收结果
  if (meta && meta.kind) addPending({ token: token, resultKey: resultKey, kind: meta.kind, chatId: meta.chatId || '', extra: meta.extra || null, ts: Date.now(), payload: payload });
  const data = await sendApiFetch(payload, token, resultKey);
  if (meta && meta.kind) removePending(token);
  if (!data) { lastApiError = '请求失败：网络错误，或该接口不允许跨域调用'; return null; }
  const content = extractContent(data);
  if (!content) { if (!lastApiError) lastApiError = '接口没有返回有效回复'; return null; }
  return content;
}

/* ---------------- 记忆（与线上共享） ---------------- */
async function loadMemHints(charId) {
  const db = await openVectorDB();
  let rawList;
  if (window.NanoMemLink && window.NanoMemLink.readList) {
    rawList = await window.NanoMemLink.readList(charId);   // 大号 + 小号 合并
  } else {
    const rec = await dbGet(db, 'config', 'memlist_' + charId);
    rawList = (rec && Array.isArray(rec.value)) ? rec.value : [];
  }
  const list = Array.isArray(rawList) ? rawList : [];
  const priv = list.filter(it => it && !it.groupId);
  const must = priv.filter(it => Number(it.importance) >= 4);
  const rest = priv.filter(it => !(Number(it.importance) >= 4));
  const picked = must.concat(rest.slice(-24));
  return picked.length ? picked.map(it => '· ' + (it.content || it.text || '')).join('\n') : '';
}
function notifyMemoryUpdated(charId) {
  try { if (window.parent !== window) window.parent.postMessage({ type: 'NANO_MEMORY_UPDATED', chatId: charId }, '*'); } catch (e) {}
}
async function maybeSummarize(charId, charName, history) {
  try {
    const db = await openVectorDB();
    const cfgRec = await dbGet(db, 'config', 'autoSummary');
    const auto = cfgRec ? !!cfgRec.value : true;
    if (!auto) return;
    const thRec = await dbGet(db, 'config', 'autoThreshold');
    const threshold = thRec && thRec.value ? parseInt(thRec.value, 10) : 20;
    const stateRec = await dbGet(db, 'chat_state', charId);
    const done = stateRec && stateRec.summarizedCount ? stateRec.summarizedCount : 0;
    const pending = history.slice(done).filter(m => m && m.text && !m.isCard && !m.recalled);
    if (pending.length < threshold) return;
    const convo = pending.map(m => (isMine(m) ? '用户：' : (charName + '：')) + (m.text || '')).join('\n').slice(0, 8000);
    const sys = '你是记忆整理助手。把下面这段对话中值得长期记住的信息，提炼成 1-6 条记忆，每条单独一行，'
      + '格式必须是【类型】内容。类型只能从这些里选：重要事件、用户偏好、情感、社交关系、地点、习惯、说话方式、禁忌、愿望、身世、秘密、其他。'
      + '内容要具体、简短（30字内），只写事实，不要评价、不要解释、不要输出多余文字。';
    const out = await callApi([{ role: 'system', content: sys }, { role: 'user', content: convo }], { maxTokens: 500, temperature: 0.3 });
    if (!out) return;
    const items = [];
    String(out).split(/\n+/).forEach(line => {
      const m = line.match(/^\s*[【\[]\s*([^】\]]+?)\s*[】\]]\s*(.+?)\s*$/);
      if (m && m[2]) items.push({
        id: uid('mem_'), type: m[1].trim(), content: m[2].trim(),
        embedding: null, hasVector: false, date: new Date().toISOString(),
        relatedChar: charName, chatId: charId, source: 'imessage'
      });
    });
    if (!items.length) return;
    if (window.NanoMemLink && window.NanoMemLink.append) {
      await window.NanoMemLink.append(charId, items);   // 小号记忆计入大号记忆库
    } else {
      const memRec = await dbGet(db, 'config', 'memlist_' + charId);
      const list = (memRec && Array.isArray(memRec.value)) ? memRec.value : [];
      await dbPut(db, 'config', { key: 'memlist_' + charId, value: list.concat(items) });
    }
    await dbPut(db, 'chat_state', { chatId: charId, summarizedCount: history.length });
    notifyMemoryUpdated(charId);
  } catch (e) {}
}

/* ---------------- 状态 ---------------- */
const state = {
  chars: [],
  allChars: [],     // 全部角色（含其它人设，仅用于归属推断）
  chats: [],        // 所有 iMessage 会话（独立存储）
  hidden: [],       // 从列表隐藏的空角色卡片（charId）
  aliases: [],      // 马甲
  current: null,
  messages: [],
  emojiData: null,
  currentEmojiGroup: null
};
let imdb = null;
let editing = false;

/* ---------------- 会话持久化（IndexedDB + localStorage 双写兜底） ---------------- */
function lsIndexKey() { return 'nano_imessage_chat_index_' + currentNs(); }
function lsChatKey(id) { return 'nano_imessage_chat_' + currentNs() + '_' + id; }
function readLSIndex() { return safeParse(localStorage.getItem(lsIndexKey()), []) || []; }
function writeLSIndex(list) { try { localStorage.setItem(lsIndexKey(), JSON.stringify(list)); } catch (e) {} }
function mirrorChat(chat) {
  if (!chat || !chat.id) return;
  try { localStorage.setItem(lsChatKey(chat.id), JSON.stringify(chat)); }
  catch (e) {
    // 超出配额：去掉图片数据后再存一份文本镜像，保证消息文字不丢
    try {
      const tiny = Object.assign({}, chat, {
        history: (chat.history || []).map(m => (m && (m.isImage || m.imageData))
          ? Object.assign({}, m, { imageData: { emojiName: (m.imageData && m.imageData.emojiName) || '' }, imageDropped: true })
          : m)
      });
      localStorage.setItem(lsChatKey(chat.id), JSON.stringify(tiny));
    } catch (e2) {}
  }
  try { const idx = readLSIndex(); if (idx.indexOf(chat.id) === -1) { idx.push(chat.id); writeLSIndex(idx); } } catch (e) {}
}
function loadChatsFromLS() {
  try {
    const out = [];
    readLSIndex().forEach(id => {
      const c = safeParse(localStorage.getItem(lsChatKey(id)), null);
      if (c && c.id) { if (!Array.isArray(c.history)) c.history = []; out.push(c); }
    });
    return out;
  } catch (e) { return []; }
}
function dropChatLS(id) {
  try { localStorage.removeItem(lsChatKey(id)); } catch (e) {}
  try { writeLSIndex(readLSIndex().filter(x => x !== id)); } catch (e) {}
}
function saveChat(chat) {
  const p = (imdb && chat) ? dbPut(imdb, 'chats', chat) : Promise.resolve(false);
  try { mirrorChat(chat); } catch (e) {}
  return p;
}
function persistCurrent(opts) {
  opts = opts || {};
  const c = state.current;
  if (!c) return Promise.resolve();
  c.history = state.messages;
  const last = state.messages.slice(-1)[0];
  c.preview = last ? (isMine(last) ? '你：' + (last.text || (last.isImage ? '[表情]' : '')) : (last.text || (last.isImage ? '[表情]' : ''))) : '';
  c.lastTime = last ? last.time : '';
  c.sortTime = last ? (last.ts || Date.now()) : (c.sortTime || Date.now());
  if (!opts.keepUnread) c.unread = 0;
  return saveChat(c).then(() => {
    renderList();
    if (c.kind === 'char' && c.charId && !opts.skipSummary) {
      return maybeSummarize(c.charId, c.name, state.messages);
    }
    return null;
  });
}

/* ---------------- 线程列表 ---------------- */
function isAssistantChar(c) {
  const id = String(c && c.id || '').toLowerCase(), nm = String(c && c.name || '').trim();
  if (id === 'nano' || id.indexOf('nano_') === 0 || id.indexOf('assistant') !== -1) return true;
  if (c && (c.isNano || c.isAssistant)) return true;
  if (nm === '纳米' || nm === '娜娜' || nm === 'Nano') return true;
  return false;
}
function buildThreads() {
  const out = state.chats.map(c => ({
    key: c.id, kind: c.kind, chat: c,
    name: c.name,
    avatar: c.avatar || '',
    preview: c.preview || (c.kind === 'stranger' ? (c.setting || '') : ''),
    time: c.lastTime || '', unread: c.unread || 0, sortTime: c.sortTime || 0,
    isAlias: c.kind === 'alias', isStranger: c.kind === 'stranger'
  }));
  // 角色卡片默认就出现在列表里（无消息），方便直接开聊
  const have = {};
  state.chats.forEach(c => { if (c.kind === 'char') have[c.charId] = 1; });
  state.chars.forEach(c => {
    if (have[c.id] || state.hidden.indexOf(c.id) !== -1 || isAssistantChar(c)) return;
    out.push({
      key: 'c:' + c.id, kind: 'char', chat: null, name: c.name, avatar: c.avatar || '',
      preview: '', time: '', unread: 0, sortTime: 0, isEmpty: true
    });
  });
  out.sort((a, b) => {
    const am = a.sortTime || 0, bm = b.sortTime || 0;
    if (am !== bm) return bm - am;
    if (!!a.isEmpty !== !!b.isEmpty) return a.isEmpty ? 1 : -1;
    return String(a.name).localeCompare(String(b.name), 'zh');
  });
  return out;
}
function renderList() {
  const box = $('#threadList');
  const threads = buildThreads();
  box.innerHTML = threads.map(t => {
    const av = t.avatar
      ? `<img src="${esc(t.avatar)}" alt="">`
      : `<svg viewBox="0 0 52 52"><circle cx="26" cy="19" r="9" fill="#fff"/><path d="M9 46c0-9.4 7.6-15 17-15s17 5.6 17 15z" fill="#fff"/></svg>`;
    return `<div class="thread-wrap">
      <button class="delete-action" data-delete type="button">删除</button>
      <div class="thread" data-key="${esc(t.key)}" data-kind="${t.kind}">
        <span class="select-box"></span>
        <div class="avatar">${av}</div>
        <div class="thread-main">
          <div class="thread-head">
            <div class="thread-name">${esc(t.name)}${t.isAlias ? '<span class="thread-kind">马甲</span>' : ''}${t.isStranger ? '<span class="thread-kind">陌生</span>' : ''}</div>
            ${t.time ? `<span class="thread-time">${esc(t.time)}</span>` : ''}
          </div>
          <div class="thread-preview">${esc((t.preview || '').slice(0, 40))}</div>
        </div>
        <div class="thread-tail">${t.unread ? `<span class="thread-unread">${t.unread}</span>` : ''}<span class="chev"></span></div>
      </div>
    </div>`;
  }).join('') || '<div class="ss-empty" style="padding:40px 0;text-align:center;color:#8e8e93">还没有会话，点右上角「⋯ → 新增消息」开始</div>';
  bindThreads();
}

/* ---------------- 打开会话 ---------------- */
function openThread(key) {
  let c = state.chats.find(x => x.id === key);
  if (!c && key.indexOf('c:') === 0) {
    const ch = state.chars.find(x => x.id === key.slice(2));
    if (ch) c = ensureCharChat(ch);
  }
  if (!c) return;
  state.current = c;
  state.messages = c.history || [];
  c.unread = 0; saveChat(c);
  applyHeader(c);
  renderBanner(c);
  applyChatBg(c);
  renderMessages();
  $('#chatScreen').classList.add('show');
  $('#plusSheet').classList.remove('show');
}
function applyHeader(c) {
  $('#chatName').innerHTML = esc(c.name) + '<span class="chev-down"></span>';
  const mini = $('#chatAvatar');
  if (c.avatar) {
    mini.style.background = 'transparent';
    mini.innerHTML = `<img src="${esc(c.avatar)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else {
    mini.style.background = c.kind === 'stranger' ? 'linear-gradient(145deg,#d7d7dc,#a9a9b2)' : 'linear-gradient(145deg,#e8ecf5,#c8d2e6)';
    mini.innerHTML = '<svg viewBox="0 0 52 52"><circle cx="26" cy="19" r="9" fill="#fff"/><path d="M9 46c0-9.4 7.6-15 17-15s17 5.6 17 15z" fill="#fff"/></svg>';
  }
  $('#csName').textContent = c.name;
  $('#valRemark').textContent = c.remark || c.name;
  const cs = $('#csAvatar'); cs.innerHTML = mini.innerHTML; cs.style.background = mini.style.background;
  $('#valBg').textContent = c.bg ? '自定义图片' : '默认';
}
function renderBanner(c) {
  // 横幅现在随消息一起滚动（在 renderMessages 里渲染），这里只隐藏旧的固定栏
  const b = $('#chatBanner');
  if (b) b.hidden = true;
}
function unblockInChat(c) {
  if (!c || c.kind !== 'char') return;
  setSetting(c.charId, 'blocked', false);
  try { localStorage.removeItem('chat_setting_blockedContacted_' + c.charId); } catch (e) {}
  try { if (window.parent !== window) window.parent.postMessage({ type: 'nanoBlockChanged', chatId: c.charId, blocked: false, text: '已加回好友' }, '*'); } catch (e) {}
  c.history = c.history || [];
  c.history.push({ id: uid(), type: 'system', text: '已加回好友', time: nowHHMM(), ts: Date.now() });
  const last = c.history[c.history.length - 1];
  c.preview = last.text; c.lastTime = last.time; c.sortTime = last.ts;
  saveChat(c);
  if (state.current && state.current.id === c.id) state.messages = c.history;
  renderBanner(c); renderMessages();
  toastMsg('已加回好友');
}
$('#messages').addEventListener('click', e => {
  if (!e.target.closest('[data-im-unblock]')) return;
  if (state.current) unblockInChat(state.current);
});
function applyChatBg(c) {
  const bg = $('#chatBg');
  if (c && c.bg) { bg.style.backgroundImage = 'url(' + c.bg + ')'; bg.style.backgroundSize = 'cover'; bg.style.backgroundPosition = 'center'; }
  else { bg.style.backgroundImage = ''; bg.style.background = '#fff'; }
}

/* ---------------- 渲染消息 ---------------- */
function bannerHtml(c) {
  if (!c || c.kind !== 'char') return '';
  if (getSetting(c.charId, 'blocked', false)) {
    return `<div class="im-banner">你在线上拉黑了 TA（iMessage 仍可正常聊天）· <button type="button" data-im-unblock="1">取消拉黑</button></div>`;
  }
  if (getSetting(c.charId, 'charBlocked', false)) {
    return `<div class="im-banner info">TA 关掉了线上聊天：给 TA 发条消息，看 TA 愿不愿意加回你。</div>`;
  }
  return '';
}
function renderMessages() {
  const box = $('#messages');
  const list = state.messages || [];
  let lastTime = null;
  box.innerHTML = bannerHtml(state.current) + list.map((m, idx) => {
    if (m.isCard || m.recalled) return '';
    if (m.type === 'system') return `<div class="sys-line">${esc(m.text || '')}</div>`;
    let html = '';
    const tMin = m.time ? (parseInt(m.time.split(':')[0], 10) * 60 + parseInt(m.time.split(':')[1] || '0', 10)) : null;
    if (m.time && (lastTime === null || tMin - lastTime >= 10)) { lastTime = tMin; html += `<div class="time-sep">${esc(m.time)}</div>`; }
    const mine = isMine(m);
    const isSticker = !!(m.isImage && m.imageData && m.imageData.emojiName);
    const isImageMsg = !!(m.isImage && m.imageData && m.imageData.url && !isSticker);
    const cls = 'msg ' + (mine ? 'me' : 'them') + (isSticker ? ' sticker' : '') + (isImageMsg ? ' img' : '');
    html += `<div class="msg-row ${mine ? 'me' : ''}"><div class="${cls}" data-index="${idx}">`;
    if (m.quote) html += `<span class="quote">${esc(m.quote)}</span>`;
    if (m.isImage && m.imageData && m.imageData.url) {
      if (isSticker) html += `<img class="sticker-img" src="${esc(m.imageData.url)}" alt="">`;
      else html += `<img src="${esc(m.imageData.url)}" alt="">`;
    }
    // 双语：内联「外文||中文」或 m.trans 都在气泡内单独显示中文翻译
    let text = m.text || '', trans = m.trans || '';
    const di = text.indexOf('||');
    if (di !== -1) { if (!trans) trans = text.slice(di + 2).trim(); text = text.slice(0, di).trim(); }
    if (text) html += `<span class="text">${esc(text)}</span>`;
    if (trans) html += `<span class="trans">${esc(trans)}</span>`;
    if (isSticker && !mine && m.imageData.emojiName) html += `<span class="sticker-name">${esc(m.imageData.emojiName)}</span>`;
    html += '</div></div>';
    return html;
  }).join('');
  box.scrollTop = box.scrollHeight;
  syncTypingRow();
}

/* ---------------- 发送 / 回复 ---------------- */
const waveBtn = $('#waveBtn');
function syncWave() { waveBtn.classList.toggle('send-mode', $('#messageInput').value.trim().length > 0); }
$('#messageInput').addEventListener('input', syncWave);

function splitByChars(line, chars) {
  const res = []; let buf = '';
  for (const ch of line) { buf += ch; if (chars.indexOf(ch) !== -1) { res.push(buf); buf = ''; } }
  if (buf) res.push(buf);
  return res;
}
function splitBubbles(text) {
  const out = [];
  const push = s => { s = String(s).trim(); if (s) out.push(s); };
  String(text || '').split(/\n+/).forEach(line => {
    line = line.trim(); if (!line) return;
    // 先按句末标点切成独立气泡（即使很短也分开，像真人连发）
    splitByChars(line, '。！？!?…~；;').forEach(seg => {
      if (seg.length <= 26) { push(seg); return; }
      // 长句再按逗号切
      splitByChars(seg, '，,').forEach(p => {
        if (p.length <= 30) { push(p); return; }
        let buf = '';
        for (const ch of p) { buf += ch; if (buf.length >= 30) { push(buf); buf = ''; } }
        if (buf) push(buf);
      });
    });
  });
  const MAX = 8;
  if (out.length > MAX) {
    // 不丢内容：把超出的合并进最后一条
    const rest = out.slice(MAX - 1).join('');
    out.length = MAX - 1;
    out.push(rest);
  }
  return out;
}
// 去掉模型输出的思维链（[think]...[/think]、<think>、【思考】等），包括未闭合、跑到结尾的
function stripThinkTags(text) {
  let s = String(text || '');
  // ```json ... ``` 之类：抽正文；若整段是 {"bubbles":[...]} 就转成逐条文本
  s = s.replace(/```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/g, function (m, inner) {
    const t = String(inner || '').trim();
    try {
      const o = JSON.parse(t);
      const arr = o && (o.bubbles || o.messages || o.lines || o.reply || o.text);
      if (Array.isArray(arr)) return arr.map(function (x) { return typeof x === 'string' ? x : ((x && (x.text || x.content)) || ''); }).filter(Boolean).join('\n');
      if (typeof arr === 'string') return arr;
    } catch (e) {}
    return t;
  });
  s = s.replace(/```/g, ' ');
  const TW = 'think(?:ing)?|thought|reasoning|analysis|cot|思考|思维链';
  s = s.replace(new RegExp('\\[\\s*(?:' + TW + ')\\s*:[\\s\\S]*?\\]', 'gi'), ' ');
  s = s.replace(new RegExp('\\[\\s*(?:' + TW + ')\\s*\\][\\s\\S]*?\\[\\s*\\/\\s*(?:' + TW + ')\\s*\\]', 'gi'), ' ');
  s = s.replace(new RegExp('<\\s*(?:' + TW + ')\\s*>[\\s\\S]*?<\\s*\\/\\s*(?:' + TW + ')\\s*>', 'gi'), ' ');
  s = s.replace(new RegExp('【\\s*(?:' + TW + ')\\s*】[\\s\\S]*?【\\s*\\/\\s*(?:' + TW + ')\\s*】', 'gi'), ' ');
  s = s.replace(new RegExp('\\[\\s*(?:' + TW + ')\\s*\\][\\s\\S]*$', 'i'), ' ');
  s = s.replace(new RegExp('<\\s*(?:' + TW + ')\\s*>[\\s\\S]*$', 'i'), ' ');
  s = s.replace(new RegExp('\\[\\s*\\/?\\s*(?:' + TW + ')\\s*\\]', 'gi'), ' ');
  s = s.replace(new RegExp('【\\s*\\/?\\s*(?:' + TW + ')\\s*】', 'gi'), ' ');
  s = s.replace(new RegExp('<\\s*\\/?\\s*(?:' + TW + ')\\s*>', 'gi'), ' ');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}
function bubblesToMessages(bubbles, kind) {
  const msgs = [];
  (bubbles || []).forEach(b => {
    let text = String(b || '').trim(), trans = '';
    const i = text.indexOf('||');
    if (i !== -1) { trans = text.slice(i + 2).trim(); text = text.slice(0, i).trim(); }
    if (!text) return;
    const m = { id: uid(), text: text, time: nowHHMM(), ts: Date.now(), via: 'imessage' };
    if (trans) m.trans = trans;
    if (kind === 'char') m.type = 'left'; else m.who = 'them';
    msgs.push(m);
  });
  return msgs;
}
function appendToCurrent(msg) { state.messages.push(msg); }

async function handleSendOrReply() {
  const c = state.current;
  if (!c) return;
  const v = $('#messageInput').value.trim();
  if (v) {
    const msg = { id: uid(), text: v, time: nowHHMM(), ts: Date.now() };
    if (c.kind === 'stranger' || c.kind === 'alias') msg.who = 'me'; else msg.type = 'right';
    appendToCurrent(msg);
    $('#messageInput').value = ''; syncWave();
    renderMessages();
    await persistCurrent();
  } else {
    await doReply();
  }
}
waveBtn.addEventListener('click', handleSendOrReply);
$('#composer').addEventListener('submit', e => { e.preventDefault(); handleSendOrReply(); });
$('#messageInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendOrReply(); } });

// 把消息写入指定会话（即使中途切换了会话，也不会写错）
function appendToChat(chat, msgs) {
  if (!chat || !msgs || !msgs.length) return Promise.resolve();
  chat.history = chat.history || [];
  msgs.forEach(m => chat.history.push(m));
  const last = chat.history[chat.history.length - 1];
  chat.preview = isMine(last) ? ('你：' + (last.text || '[表情]')) : (last.text || '[表情]');
  chat.lastTime = last.time; chat.sortTime = last.ts || Date.now(); chat.unread = (chat.unread || 0) + msgs.length;
  return saveChat(chat);
}
// 角色在 iMessage 里说要把你加回微信 → 往 Meet 好友申请中心推一条（同意即解除拉黑）
function maybePushMeetReadd(charId, charName, chat) {
  if (!charId) return;
  try {
    var KEY = 'nano_friend_requests';
    var all = [];
    try { all = JSON.parse(localStorage.getItem(KEY) || '[]') || []; } catch (e) {}
    if (all.some(function (r) { return r && r.status === 'pending' && String(r.unblockCharId) === String(charId); })) return;
    var owner = '';
    try {
      var md = JSON.parse(localStorage.getItem('nano_mask_data') || localStorage.getItem('nano_home_data') || 'null');
      if (md) owner = String(md.currentMaskId || (md.masks && md.masks[0] && md.masks[0].id) || '');
    } catch (e) {}
    if (!owner) owner = 'default';
    var ch = null;
    try { ch = state.chars.find(function (x) { return String(x.id) === String(charId); }); } catch (e) {}
    all.push({
      id: 'fr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 5),
      owner: owner, name: (ch && ch.name) || charName || '角色', avatar: (ch && ch.avatar) || '',
      source: 'other', setting: '在吗？我想在微信上把你加回来。', originId: '', altOriginId: '',
      requestNote: '想把你加回来', unblockCharId: charId, ts: Date.now(), status: 'pending'
    });
    try { localStorage.setItem(KEY, JSON.stringify(all.slice(-400))); } catch (e) {}
    try { window.parent.postMessage({ type: 'homeDataUpdated' }, '*'); } catch (e) {}
  } catch (e) {}
}

async function doReply() {
  const c = state.current;
  if (!c) return;
  // 线上拉黑不影响 iMessage：这是两个 App，仍可正常聊天
  setBusy('回复中…');
  let out = null;
  try {
    if (c.kind === 'char') out = await genCharReply(c);
    else if (c.kind === 'alias') out = await genAliasReply(c);
    else out = await genStrangerReply(c);
  } finally { setBusy(''); }
  if (!out || !out.bubbles || !out.bubbles.length) { toastMsg('没有收到回复' + (lastApiError ? ('：' + lastApiError) : '')); return; }
  // 关键：始终写入发起回复的那个会话 c，而不是当前打开的会话
  if (c.kind === 'char') {
    out.bubbles = (out.bubbles || []).map(function (b) { return String(b).replace(/\[(加好友|加微信|加回我|加我)\]/g, '').trim(); }).filter(Boolean);
  }
  await appendToChat(c, bubblesToMessages(out.bubbles, c.kind));
  if (c.kind === 'char') {
    if (/\[加回我\]|\[取消拉黑\]|\[unblockuser\]/.test(out.raw || '')) { setSetting(c.charId, 'charBlocked', false); try { window.parent.postMessage({ type: 'nanoCharUnblocked', chatId: c.charId }, '*'); } catch (e) {} }
    if (/\[继续拉黑\]|\[blockuser\]/.test(out.raw || '')) { setSetting(c.charId, 'charBlocked', true); try { window.parent.postMessage({ type: 'nanoCharBlocked', chatId: c.charId }, '*'); } catch (e) {} }
    if (/\[(加好友|加微信|加回我|加我)\]/.test(out.raw || '')) maybePushMeetReadd(c.charId, c.name, c);
    if (state.current && state.current.id === c.id) renderBanner(c);
    try { maybeSummarize(c.charId, c.name, c.history); } catch (e) {}
  }
  if (state.current && state.current.id === c.id) {
    state.messages = c.history;
    renderMessages();
  }
  renderList();
}

function historyForApi(limit, source) {
  const all = (source || state.messages || []).filter(m => m && !m.isCard && !m.recalled && (m.text || m.isImage));
  const msgs = all.slice(-(limit || 20));
  // 最近几张用户发的图片以多模态 content 数组带给模型，让 TA 能识别图片内容
  const imgIdx = [];
  msgs.forEach((m, i) => {
    if (isMine(m) && m.isImage && m.imageData && typeof m.imageData.url === 'string' && m.imageData.url.indexOf('data:image') === 0) imgIdx.push(i);
  });
  const keepImg = {};
  imgIdx.slice(-3).forEach(i => { keepImg[i] = true; });
  return msgs.map((m, i) => {
    const role = isMine(m) ? 'user' : 'assistant';
    let text = m.text || '';
    if (!text && m.isImage) {
      text = (m.imageData && m.imageData.emojiName) ? ('[表情包：' + m.imageData.emojiName + ']') : (keepImg[i] ? '（用户发来一张图片，请先识别图片内容，再自然地回应）' : '（用户发来一张图片）');
    }
    if (keepImg[i]) {
      return { role: role, content: [
        { type: 'text', text: text || '（用户发来一张图片，请先识别图片内容，再自然地回应）' },
        { type: 'image_url', image_url: { url: m.imageData.url } }
      ] };
    }
    return { role: role, content: text };
  });
}
async function genCharReply(c) {
  const ch = state.chars.find(x => x.id === c.charId) || { id: c.charId, name: c.name, setting: c.setting };
  const user = readCurrentUser();
  const userName = user ? user.name : '用户';
  const ctx = await charContextText(ch, c.history);
  let sys = '你现在通过 iMessage 和「' + userName + '」聊天。iMessage 与站内是不同的 App，消息各自独立，但你对 TA 的人设、记忆、世界书都是同一份，请保持完全一致。\n';
  sys += '你是「' + (ch.name || c.name) + '」。\n';
  sys += ctx;
  if (getSetting(c.charId, 'blocked', false)) sys += '【状态】用户把你在线上聊天里拉黑了，但这里是 iMessage，你们仍能正常聊天。你可以主动一点，试着沟通、解释或挽回。\n';
  if (getSetting(c.charId, 'charBlocked', false)) sys += '【状态】你之前关掉了线上聊天（拉黑了用户）。你可以决定是否加回：愿意就单独输出一行 [加回我]，否则输出 [继续拉黑]。\n';
  sys += '【加回微信】如果你愿意重新在微信/Meet 里把 TA 加为好友（会把好友申请发到 TA 的 Meet），单独输出一行 [加好友]。\n';
  sys += '【表情包】用户可能发来 [表情包：名称]，那代表用户发了一张该含义的表情包，只表达当下的心情/态度（例如“喝酒”=烦躁无语、“哭哭”=感动委屈），不代表用户真的去做了什么；按心情自然回应即可，绝对不要当真去追问“你怎么又喝酒了/你怎么哭了”。（不需要自己也发表情标签）。\n';
  sys += '【短信风格】像真人连发消息那样：把想说的话自然拆成 2-5 条短消息，每条独立成行，每条约 5-25 字；不要把一整段塞进一条，也不要只蹦几个字让意思不完整。\n';
  sys += '【务必完整】每条消息都要是一句完整的话，不要说到一半就断掉；整体意思要表达完。';
  try {
    const cyc = window.NanoCycle && NanoCycle.promptBlock(c.charId);
    if (cyc) sys += '\n\n' + cyc;
  } catch (e) {}
  const foreign = isForeignChar(ch);
  const history = [{ role: 'system', content: sys }].concat(historyForApi(20, c.history));
  // 即使还没有用户消息，点击“回复”也让 TA 主动发一条，而不是没反应
  if (!history.slice(1).some(m => m.role === 'user')) history.push({ role: 'user', content: '（主动给 TA 发条 iMessage 短信）' });
  const raw = await callApi(history, { maxTokens: 900 }, { kind: 'reply', chatId: c.id });
  if (!raw) return null;
  let body = String(raw).replace(/\[(加回我|取消拉黑|解除拉黑|unblockuser|继续拉黑|拉黑用户|拉黑我|blockuser)\]/g, '');
  body = stripThinkTags(body);
  // 只要不是中文（外国角色、或没填国籍但说了外语），都补上中文翻译
  if (foreign || looksNonChinese(body)) {
    const lines = await ensureTranslatedLines(ch, String(body).split(/\n+/).map(s => s.trim()).filter(Boolean).slice(0, 6));
    return { raw: String(raw), bubbles: lines };
  }
  return { raw: String(raw), bubbles: splitBubbles(body) };
}
function looksNonChinese(s) {
  const t = String(s || '');
  const kana = (t.match(/[\u3040-\u30ff]/g) || []).length;
  const cyr = (t.match(/[\u0400-\u04ff]/g) || []).length;
  const han = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (t.match(/[A-Za-z]/g) || []).length;
  const letters = kana + cyr + han + latin;
  if (!letters) return false;
  if (kana + cyr > 0) return true;
  return han < 3 && latin > letters * 0.5;
}
async function translateLines(lines) {
  try {
    const out = await callApi([
      { role: 'system', content: '把下面每一行翻译成自然的中文，保持行数完全一致，只输出译文，每行一行，不要编号、引号或解释。' },
      { role: 'user', content: (lines || []).join('\n') }
    ], { maxTokens: 600, temperature: 0.3 });
    if (!out) return [];
    return String(out).split(/\n+/).map(s => s.replace(/^\s*\d+[.、)]\s*/, '').trim()).filter(Boolean);
  } catch (e) { return []; }
}
// 已翻译缓存：同一句原文只翻译一次，避免反复调用翻译 API 烧 token
const __transCache = (function () {
  try { return JSON.parse(localStorage.getItem('nano_trans_cache') || '{}') || {}; } catch (e) { return {}; }
})();
function __transCacheSave() {
  try {
    const keys = Object.keys(__transCache);
    if (keys.length > 400) { keys.slice(0, keys.length - 400).forEach(k => delete __transCache[k]); }
    localStorage.setItem('nano_trans_cache', JSON.stringify(__transCache));
  } catch (e) {}
}
// 确保每一行都有「原文||中文」：外语角色或说外语时自动补翻译（和线上一致）
async function ensureTranslatedLines(ch, lines) {
  const arr = (lines || []).map(l => String(l || '').trim()).filter(Boolean);
  if (!arr.length) return [];
  const needIdx = [];
  arr.forEach((l, i) => {
    const p = l.split('||');
    const zh = p.length > 1 ? String(p[1] || '').trim() : '';
    if (zh) return;
    arr[i] = p[0].trim();
    if (arr[i]) needIdx.push(i);
  });
  if (!needIdx.length) return arr;
  const anyForeign = isForeignChar(ch) || needIdx.some(i => looksNonChinese(arr[i]));
  if (!anyForeign) return arr;
  const natives = needIdx.map(i => arr[i]);
  const zhOut = new Array(natives.length).fill('');
  natives.forEach((t, k) => { if (__transCache[t]) zhOut[k] = __transCache[t]; });
  const missIdx = [], missTexts = [];
  natives.forEach((t, k) => { if (!zhOut[k]) { missIdx.push(k); missTexts.push(t); } });
  if (missTexts.length) {
    let res = await translateLines(missTexts);
    // 仅在完全失败（没有结果）时才重试一次，避免行数不符就重复调用、翻倍烧 token
    if (!res || !res.length) { const retry = await translateLines(missTexts); if (retry && retry.length) res = retry; }
    missIdx.forEach((k, j) => {
      const t = (res && res[j]) ? String(res[j]).trim() : '';
      if (t) { zhOut[k] = t; __transCache[natives[k]] = t; }
    });
    if (missIdx.length) __transCacheSave();
  }
  needIdx.forEach((i, k) => {
    const t = zhOut[k] ? String(zhOut[k]).trim() : '';
    if (t) arr[i] = arr[i] + '||' + t;
  });
  return arr;
}
function isForeignChar(ch) {
  const nat = String((ch && ch.nationality) || '').trim();
  if (!nat) return false;
  if (/中国|中國|china|chinese|华|華|汉|漢/i.test(nat)) return false;
  if (nat === '未知' || /^unknown$/i.test(nat)) return false;
  return true;
}
// 角色上下文：角色人设 + 用户（c/u）人设 + 共享长期记忆 + 世界书 + 外语要求
async function charContextText(ch, msgs) {
  const u = readCurrentUser() || {};
  const userName = u.name || '用户';
  const uSetting = String(u.setting || u.persona || '').trim();
  const setting = String((ch && (ch.setting || ch.desc || ch.persona)) || '');
  const nat = String((ch && ch.nationality) || '').trim();
  const mem = await loadMemHints((ch && ch.id) || '');
  const wb = getWorldbookText(ch, msgs);
  let s = '';
  if (nat && nat !== '未知') s += '你的国籍是' + nat + '。\n';
  if (wb.front) s += wb.front;
  if (setting) s += '【你的人设 · 必须严格遵守】\n' + setting.slice(0, 8000) + '\n';
  if (wb.middle) s += wb.middle;
  if (uSetting) s += '\n【对方的设定 · 你正在聊天的人（' + userName + '）】\n' + uSetting.slice(0, 4000) + '\n';
  if (mem) s += '\n【长期记忆 · 你应当记得的事】\n' + mem + '\n';
  if (wb.back) s += wb.back;
  s += '\n称呼对方用 TA 的名字「' + userName + '」或自然亲昵的称呼，禁止用“对方/这女人/那丫头/这姑娘”等泛称。\n';
  if (isForeignChar(ch)) {
    const lang = charLanguage(ch);
    s += '【外国人 · 语言】你的母语是' + lang + '，必须用' + lang + '输出正文，绝对不要只用英文或中文；每行用「' + lang + '原文||中文翻译」格式，原文和中文翻译都写完整。\n';
  }
  s += CORE_POLICY;
  const gbp = readGlobalBuiltinPrompt();
  if (gbp) s += '\n【全局内置提示词 · 必须遵守】\n' + gbp + '\n';
  return s;
}
async function genAliasReply(c) {
  const ch = state.chars.find(x => x.id === c.charId) || { id: c.charId, name: c.name, setting: c.setting };
  const setting = String(ch.setting || '');
  const alias = c.aliasName || '陌生人';
  const nat = String(ch.nationality || '').trim();
  const foreign = isForeignChar(ch);
  const wb = getWorldbookText(ch, c.history);
  // 匿名：不让角色知道这是用户，也不注入与用户的共同记忆
  let sys = '你是「' + (ch.name || c.name) + '」，正在用 iMessage 和一个陌生号码聊天。对方自称「' + alias + '」，你并不知道对方真实身份。\n';
  if (nat && nat !== '未知') sys += '你的国籍是' + nat + '。\n';
  if (wb.front) sys += wb.front;
  if (setting) sys += '【你的设定】\n' + setting.slice(0, 6000) + '\n';
  if (wb.middle) sys += wb.middle;
  if (c.aliasSetting) sys += '【对方（' + alias + '）的公开信息】\n' + String(c.aliasSetting).slice(0, 1000) + '\n';
  if (wb.back) sys += wb.back;
  sys += '【表情包】对方可能发来 [表情包：名称]，按该含义理解即可。\n';
  if (foreign) sys += '【语言】你的母语是' + charLanguage(ch) + '，必须用母语输出正文，绝对不能只用英文或中文；每行用「母语原文||中文翻译」格式，原文和中文都写完整。\n';
  sys += '【要求】按你本人的性格与这个陌生人聊天：可以好奇、试探、戒备或礼貌；绝对不要表现出你认识对方。'
    + '回复拆成 2-4 条短消息、每条独立成行（每条约 5-25 字），像真人连发，不要标签旁白。';
  sys += CORE_POLICY;
  const gbp = readGlobalBuiltinPrompt();
  if (gbp) sys += '\n【全局内置提示词 · 必须遵守】\n' + gbp + '\n';
  const history = [{ role: 'system', content: sys }].concat(historyForApi(16, c.history));
  const raw = await callApi(history, { maxTokens: 400, temperature: 0.9 }, { kind: 'reply', chatId: c.id });
  if (!raw) return null;
  const body = stripThinkTags(raw);
  if (foreign || looksNonChinese(body)) {
    const lines = await ensureTranslatedLines(ch, body.split(/\n+/).map(s => s.trim()).filter(Boolean).slice(0, 6));
    return { raw: body, bubbles: lines };
  }
  return { raw: body, bubbles: splitBubbles(body) };
}
async function genStrangerReply(c) {
  // 角色小号：表面上以陌生身份「c.name」聊天，内心遵循本人设定（不让用户发现）
  if (c.altOf) {
    const ch = state.chars.find(x => x.id === c.altOf) || { id: c.altOf, name: c.name };
    const u = readCurrentUser() || {};
    const userName = u.name || '用户';
    const ctx = await charContextText(ch, c.history);
    let sys = '你其实是「' + (ch.name || '角色') + '」本人，用网名「' + c.name + '」的小号在 iMessage 里接近并试探「' + userName + '」，' + userName + ' 不知道小号是你。\n';
    if (c.setting) sys += '小号的公开身份 / 简介：' + c.setting + '。\n';
    sys += '以「' + c.name + '」这个陌生身份说话，但你的说话方式、性格、内心与目的都遵循你本人设定；默认不主动暴露你就是' + (ch.name || '角色') + '。\n';
    sys += '可以有试探意味（打听 TA 的感情、平时和谁聊天、是不是一个人等），但别太露骨。\n';
    sys += '如果对方已经非常笃定、证据十足地认定你就是' + (ch.name || '角色') + '，别一味硬撑或复读“你认错人”，可按本人脾气半推半就地承认或恼羞成怒地承认；也可以直接不回或冷处理。\n';
    sys += ctx;
    sys += '拆成 1-3 条短消息、每条独立成行（每条约 5-30 字），不要输出多余说明。';
    const history = [{ role: 'system', content: sys }].concat(historyForApi(16, c.history));
    const raw = await callApi(history, { maxTokens: 360, temperature: 0.95 }, { kind: 'reply', chatId: c.id });
    if (!raw) return null;
    return { raw: String(raw), bubbles: splitBubbles(stripThinkTags(raw)) };
  }
  const setting = c.setting || '';
  const u = readCurrentUser() || {};
  const userName = u.name || '用户';
  const uSetting = String(u.setting || u.persona || '').trim();
  const sys = '你是「' + c.name + '」。' + (setting ? ('你的身份/意图：' + setting + '。') : '')
    + '对方可能发来 [表情包：名称]，按该含义理解即可。你在给「' + userName + '」发短信。'
    + (uSetting ? ('对方的设定：' + uSetting.slice(0, 500) + '。') : '')
    + '称呼对方时只能用「' + userName + '」或「你好 / 您」；不知道名字就不要乱称呼，绝对禁止编造或叫错对方的名字。'
    + '按这个身份继续对话，拆成 1-3 条短消息、每条独立成行（每条约 5-30 字）。不要输出多余说明。';
  const history = [{ role: 'system', content: sys }].concat(historyForApi(16, c.history));
  const raw = await callApi(history, { maxTokens: 320, temperature: 0.95 }, { kind: 'reply', chatId: c.id });
  if (!raw) return null;
  return { raw: String(raw), bubbles: splitBubbles(stripThinkTags(raw)) };
}

/* ---------------- 重 roll：删掉本轮对方的所有回复 ---------------- */
async function doReroll() {
  const c = state.current;
  if (!c) return;
  if (window.NanoReroll) {
    const reason = await NanoReroll.ask({ title: '重roll iMessage', subtitle: '上一版哪里不对？留空也可以直接重写' });
    if (reason === null) return;
    window.__imessageRerollReason = reason || '';
  }
  let lastMe = -1;
  for (let i = state.messages.length - 1; i >= 0; i--) { if (isMine(state.messages[i])) { lastMe = i; break; } }
  // 删除最后一条“我”之后的所有对方消息 = 本轮回复
  state.messages.splice(lastMe + 1);
  renderMessages();
  await persistCurrent({ skipSummary: true });
  await doReply();
}

/* ---------------- 刷新消息：一次 API 生成陌生人 + 随机角色的消息 ---------------- */
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function showRefreshError(reason) {
  showSheet('刷新失败', `<div style="padding:10px 4px 6px;font-size:15px;color:#c0281f;line-height:1.5">${esc(reason || '未知原因')}</div>
    <div style="padding:4px 4px 12px;font-size:13px;color:#8e8e93;line-height:1.6">排查：① 到「API 小窗」确认地址 / Key / 模型；② 接口需允许跨域；③ 网络是否正常。修好后重试即可。</div>`);
}
function extractJsonObj(raw) {
  let s = String(raw || '').replace(/```(?:json)?/gi, '').trim();
  let i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i !== -1 && j > i) { const o = safeParse(s.slice(i, j + 1), null); if (o && typeof o === 'object') return o; }
  i = s.indexOf('['); j = s.lastIndexOf(']');
  if (i !== -1 && j > i) { const arr = safeParse(s.slice(i, j + 1), null); if (Array.isArray(arr)) return { strangers: arr, chars: [] }; }
  return null;
}
// 模型不按 JSON 输出时的兜底：从文本里抓取内容，而不是直接失败
function salvageRefresh(raw) {
  const out = [];
  const re = /(?:text|内容|消息)\s*[：:]\s*([^\n*#]+)/gi; let m;
  while ((m = re.exec(raw))) { const t = m[1].trim().replace(/^["'「]|["'」]$/g, ''); if (t && t.length > 1) out.push({ name: '未知号码', setting: '', text: t.slice(0, 60) }); }
  if (!out.length) { const t = String(raw || '').replace(/[*#`>「」]/g, ' ').replace(/\s+/g, ' ').trim(); if (t) out.push({ name: '未知号码', setting: '', text: t.slice(0, 80) }); }
  return { strangers: out.slice(0, 3), chars: [] };
}
// 归一化解析：优先「竖线行」格式（最稳），再退回 JSON / 文本兜底
function parseAnyRefresh(raw) {
  const res = { strangers: [], charsMap: {} };
  const lines = String(raw || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
  let hit = false;
  lines.forEach(line => {
    const clean = line.replace(/^[-*•\d.、)）\s]+/, '').replace(/[`"「」]/g, '').trim();
    const parts = clean.split(/[|｜]/).map(s => s.trim());
    if (parts.length >= 4 && /^S$/i.test(parts[0])) { res.strangers.push({ name: parts[1] || '陌生号码', setting: parts[2] || '', text: parts[3] }); hit = true; }
    else if (parts.length >= 4 && /^C$/i.test(parts[0])) { res.charsMap[parts[1] || ''] = parts[3]; hit = true; }
  });
  if (hit) return res;
  const obj = extractJsonObj(raw);
  if (obj) {
    (Array.isArray(obj.strangers) ? obj.strangers : []).forEach(o => { if (o && o.text) res.strangers.push({ name: o.name || '陌生号码', setting: o.setting || '', text: o.text }); });
    (Array.isArray(obj.chars) ? obj.chars : []).forEach(c => { if (c && c.name && c.text) res.charsMap[c.name] = c.text; });
    if (res.strangers.length || Object.keys(res.charsMap).length) return res;
  }
  salvageRefresh(raw).strangers.forEach(o => res.strangers.push(o));
  return res;
}
async function applyRefreshRaw(raw, picks) {
  picks = picks || [];
  const parsed = parseAnyRefresh(raw);
  let added = 0, charNotified = false;
  for (const o of parsed.strangers.slice(0, 5)) {
    if (!o || !o.text) continue;
    const text = String(o.text).replace(/^["'「]|["'」]$/g, '').trim();
    if (!text) continue;
    if (state.chats.some(s => s.kind === 'stranger' && s.name === o.name && (s.history || []).some(h => h.text === text))) continue;
    const sc = {
      id: 's:' + uid('sg_'), kind: 'stranger', owner: currentNs(), name: String(o.name || '陌生号码').slice(0, 20),
      setting: String(o.setting || '').slice(0, 40), avatar: '',
      history: [{ id: uid(), who: 'them', text: text.slice(0, 60), time: nowHHMM(), ts: Date.now() }],
      preview: text.slice(0, 60), lastTime: nowHHMM(), sortTime: Date.now(), unread: 1
    };
    state.chats.push(sc);
    await saveChat(sc);
    added++;
  }
  for (const pc of picks) {
    const ch = state.chars.find(x => x.id === pc.id);
    if (!ch) continue;
    const isBlocked = (pc.blocked != null) ? !!pc.blocked : getSetting(pc.id, 'blocked', false);
    // 每个角色单独生成：完整读取 c/u 人设、共享记忆、世界书（批量 C 行做不到这些）
    const chat = ensureCharChat(ch);
    const text = await proactiveCharText(ch, isBlocked, chat.history);
    if (!text) continue;
    const rawLines = String(text).split(/\n+/).map(s => s.replace(/^["'「]|["'」]$/g, '').trim()).filter(Boolean).slice(0, 3);
    if (!rawLines.length) continue;
    const lines = await ensureTranslatedLines(ch, rawLines); // 外语角色补中文翻译
    const msgs = bubblesToMessages(lines, 'char');
    if (!msgs.length) continue;
    chat.history = chat.history || [];
    msgs.forEach(m => chat.history.push(m));
    const last = chat.history[chat.history.length - 1];
    chat.preview = last.text; chat.lastTime = last.time; chat.sortTime = last.ts; chat.unread = (chat.unread || 0) + msgs.length;
    await saveChat(chat);
    notifyApp(ch.name, msgs[0].text || lines[0], { icon: ch.avatar, group: ch.name }); charNotified = true;
    added++;
    try { maybeSummarize(ch.id, ch.name, chat.history); } catch (e) {}
  }
  if (!added) return 0;
  if (!charNotified) notifyApp('iMessage', '收到 ' + added + ' 条新消息');
  renderList();
  return added;
}
/* ---------------- 小号试探：刷新时随机来一条「角色小号」的搭话 ---------------- */
async function maybeAltProbe() {
  try {
    if (localStorage.getItem('nano_imessage_altprobe_' + currentNs()) === '0') return 0;
    // 全站每天最多生成一个小号
    const _d = new Date();
    const dayKey = _d.getFullYear() + '-' + (_d.getMonth() + 1) + '-' + _d.getDate();
    if (localStorage.getItem('nano_imessage_altprobe_day_' + currentNs()) === dayKey) return 0;
    const pool = state.chars.filter(c => c && c.id && !/^alt_/.test(c.id) && !c.isAltProbe && !isAssistantChar(c))
      .filter(c => {
        // 同一角色 14 天内只小号试探一次
        const lastChar = parseInt(localStorage.getItem('nano_imessage_altprobe_char_' + currentNs() + '_' + c.id) || '0', 10) || 0;
        return Date.now() - lastChar >= 14 * 24 * 3600 * 1000;
      });
    if (!pool.length) return 0;
    if (Math.random() > 0.4) return 0;                       // 有资格时约四成概率触发（日限兜底）
    const ch = pool[Math.floor(Math.random() * pool.length)];
    const u = readCurrentUser() || {};
    const userName = u.name || '用户';
    const ctx = await charContextText(ch, []);
    const sys = '你是「' + ch.name + '」本人。你现在注册了一个小号，想用一个「陌生人 / 新朋友」的身份在 iMessage 里接近并试探「' + userName + '」，' + userName + ' 完全不知道这个小号是你本人。\n' +
      '要求：\n' +
      '1. 起一个真实的网络昵称（姓名或网名都行，禁止用「小号 / 陌生人 / 新朋友」这类词当名字）。\n' +
      '2. 写一句小号的公开简介 / 身份（为什么加 TA，如「同城摄影」「朋友介绍」「旧同学换号」，要合理）。\n' +
      '3. 写 1-2 条发给 TA 的开场消息：自然、像真人搭话，能勾住 TA 回应、忍不住多聊；可以带一点试探意味（问 TA 有没有对象、平时和谁聊天、是不是一个人），但不要一上来就露骨，也不要主动暴露你就是' + ch.name + '（但若对方非常笃定地认出来，后续可以按本人脾气松口承认）。\n' +
      '4. 你内心与行为逻辑仍遵循本人设定。\n' +
      '只输出 JSON：{"name":"网名","bio":"简介","messages":["第一条","第二条"]}\n' +
      ctx;
    const raw = await callApi([{ role: 'system', content: sys }, { role: 'user', content: '（生成小号与开场消息）' }], { maxTokens: 420, temperature: 1.0 });
    if (!raw) return 0;
    const o = extractJsonObj(raw);
    const name = o && o.name ? String(o.name).replace(/[<>]/g, '').slice(0, 16) : '';
    const bio = o && o.bio ? String(o.bio).slice(0, 40) : '';
    const msgs = (o && Array.isArray(o.messages)) ? o.messages.map(s => String(s || '').trim()).filter(Boolean).slice(0, 2) : [];
    if (!name || !msgs.length) return 0;
    const lines = await ensureTranslatedLines(ch, msgs);
    let chat = state.chats.find(x => x && x.altOf === ch.id);
    if (!chat) {
      chat = { id: 'alt:' + ch.id, kind: 'stranger', owner: currentNs(), name: name, setting: bio, avatar: '', altOf: ch.id, isAlt: true, history: [], preview: '', lastTime: nowHHMM(), sortTime: Date.now(), unread: 0 };
      state.chats.push(chat);
    } else { chat.name = name; chat.setting = bio; }
    const list = bubblesToMessages(lines, 'stranger');
    if (!list.length) return 0;
    chat.history = chat.history || [];
    list.forEach(m => chat.history.push(m));
    const lastM = chat.history[chat.history.length - 1];
    chat.preview = lastM.text; chat.lastTime = lastM.time; chat.sortTime = lastM.ts; chat.unread = (chat.unread || 0) + list.length;
    await saveChat(chat);
    localStorage.setItem('nano_imessage_altprobe_at_' + currentNs(), String(Date.now()));
    const _dd = new Date();
    localStorage.setItem('nano_imessage_altprobe_day_' + currentNs(), _dd.getFullYear() + '-' + (_dd.getMonth() + 1) + '-' + _dd.getDate());
    localStorage.setItem('nano_imessage_altprobe_char_' + currentNs() + '_' + ch.id, String(Date.now()));
    notifyApp(name, list[0].text || lines[0], { group: name });
    if (state.current && state.current.id === chat.id) { state.messages = chat.history; renderMessages(); renderBanner(chat); }
    else renderList();
    return list.length;
  } catch (e) { return 0; }
}

async function proactiveCharText(ch, isBlocked, msgs) {
  const userName = (readCurrentUser() || {}).name || '用户';
  const ctx = await charContextText(ch, msgs || []);
  let sys = '你是「' + ch.name + '」。用 iMessage 主动给「' + userName + '」发 1-2 条短消息（主动找 TA，不要等 TA 先说），每条独立一行，每条约 5-25 字，不要标签旁白。\n';
  sys += ctx;
  if (isBlocked) sys += '\n【状态】用户刚刚在线上把你拉黑了，你只能通过短信联系 TA，你非常在意这件事。这轮消息必须围绕「被拉黑 / 被冷落 / 想挽回或质问」展开，不要聊无关内容。';
  const raw = await callApi([{ role: 'system', content: sys }], { maxTokens: 260, temperature: 0.95 });
  if (!raw) return '';
  return String(raw).split(/\n+/).map(s => s.trim()).filter(Boolean).slice(0, 2).join('\n');
}
function buildRefreshReq() {
  const pool = state.chars.filter(c => !/^alt_/.test(c.id) && !c.isAltProbe && !isAssistantChar(c));
  // 被拉黑的角色必须包含；最多 2 个角色（角色消息改为逐个单独生成，能读全 c/u 人设 + 记忆 + 世界书）
  const blocked = pool.filter(c => getSetting(c.id, 'blocked', false));
  const others = shuffle(pool.filter(c => !getSetting(c.id, 'blocked', false)));
  const picks = blocked.concat(others).slice(0, 2).map(c => ({ id: c.id, name: c.name, blocked: getSetting(c.id, 'blocked', false) }));
  const strangersCount = Math.max(1, 5 - picks.length);
  const u = readCurrentUser() || {};
  const userName = u.name || '用户';
  const uSetting = String(u.setting || u.persona || '').replace(/\s+/g, ' ').slice(0, 200);
  const sys = '你是短信内容生成器。只输出纯文本，每行一条，用竖线 | 分隔；不要输出任何解释、标题、编号、Markdown 或多余文字。\n'
    + '陌生人短信格式：S|发件人|身份或意图|短信内容\n'
    + '请生成 ' + strangersCount + ' 条 S 行（场景：发错号码、电话推销、App订阅扣费、快递、诈骗、验证码、外卖等）。\n'
    + '收件人是「' + userName + '」' + (uSetting ? ('，TA 的设定：' + uSetting) : '') + '。\n'
    + '陌生人 / 推销 / 诈骗短信里不要凭空编造或叫错收件人的名字；不确定就用「你好」「您」或不带称呼，禁止乱叫名字。';
  return { history: [{ role: 'system', content: sys }, { role: 'user', content: '开始（只输出 S 行）' }], picks: picks };
}
// 切页/关页后回来，把后台已完成的结果补上
async function applyReplyRaw(chatId, raw) {
  const c = state.chats.find(x => x.id === chatId);
  if (!c) return;
  const body = String(raw || '').replace(/\[(加回我|取消拉黑|解除拉黑|unblockuser|继续拉黑|拉黑用户|拉黑我|blockuser)\]/g, '');
  let lines = splitBubbles(body);
  if (c.kind === 'char') {
    const ch = state.chars.find(x => x.id === c.charId);
    if (ch) lines = await ensureTranslatedLines(ch, lines);
  }
  const msgs = bubblesToMessages(lines, c.kind);
  if (!msgs.length) return;
  c.history = c.history || [];
  msgs.forEach(m => c.history.push(m));
  const last = c.history[c.history.length - 1];
  c.preview = last.text; c.lastTime = last.time; c.sortTime = last.ts; c.unread = (c.unread || 0) + 1;
  if (c.kind === 'char') {
    if (/\[加回我\]|\[取消拉黑\]|\[unblockuser\]/.test(String(raw))) { setSetting(c.charId, 'charBlocked', false); try { window.parent.postMessage({ type: 'nanoCharUnblocked', chatId: c.charId }, '*'); } catch (e) {} }
    if (/\[继续拉黑\]|\[blockuser\]/.test(String(raw))) { setSetting(c.charId, 'charBlocked', true); try { window.parent.postMessage({ type: 'nanoCharBlocked', chatId: c.charId }, '*'); } catch (e) {} }
    if (/\[(加好友|加微信|加回我|加我)\]/.test(String(raw))) maybePushMeetReadd(c.charId, c.name, c);
  }
  saveChat(c);
  if (state.current && state.current.id === c.id) { state.messages = c.history; renderMessages(); renderBanner(c); }
  else renderList();
  if (c.kind === 'char') maybeSummarize(c.charId, c.name, c.history);
}
async function resumePending() {
  const list = loadPending();
  if (!list.length) return;
  for (const p of list) {
    if (Date.now() - (p.ts || 0) > 10 * 60 * 1000) { removePending(p.token); continue; }
    let data = null;
    try { const v = localStorage.getItem(p.resultKey); if (v) data = safeParse(v, null); } catch (e) {}
    if (!data && p.payload) { try { data = await sendApiFetch(p.payload, p.token, p.resultKey); } catch (e) { data = null; } }
    removePending(p.token);
    const raw = extractContent(data);
    if (!raw) continue;
    if (p.kind === 'reply') await applyReplyRaw(p.chatId, raw);
    else if (p.kind === 'refresh') await applyRefreshRaw(raw, (p.extra && p.extra.picks) || []);
  }
}
async function refreshStrangers() {
  setBusy('刷新中…');
  let raw = null;
  try {
    const req = buildRefreshReq();
    raw = await callApi(req.history, { maxTokens: 1000, temperature: 0.9 }, { kind: 'refresh', extra: { picks: req.picks } });
    if (!raw) { showRefreshError(lastApiError || '接口没有返回内容'); return; }
    const added = await applyRefreshRaw(raw, req.picks);
    let altAdded = 0;
    try { altAdded = await maybeAltProbe(); } catch (e) {}
    const total = added + altAdded;
    toastMsg(total ? ('收到 ' + total + ' 条新消息') : '暂时没有新消息（可重试或检查 API）');
  } catch (e) {
    showRefreshError('刷新出错：' + ((e && e.message) || e));
  } finally { setBusy(''); }
}

/* ---------------- 新建会话（我 / 马甲） ---------------- */
function ensureCharChat(charRec) {
  const id = 'c:' + charRec.id;
  const hi = state.hidden.indexOf(charRec.id);
  if (hi !== -1) { state.hidden.splice(hi, 1); saveHidden(); }
  let c = state.chats.find(x => x.id === id);
  if (!c) {
    c = { id: id, kind: 'char', charId: charRec.id, owner: currentNs(), name: charRec.name, avatar: charRec.avatar || '', setting: charRec.setting || '', history: [], preview: '', lastTime: '', sortTime: 0, unread: 0 };
    state.chats.push(c); saveChat(c);
  }
  return c;
}
function saveHidden() { if (imdb) dbPut(imdb, 'meta', { key: 'hidden:' + currentNs(), value: state.hidden }); }
function ensureAliasChat(charRec, alias) {
  const id = 'a:' + alias.id + ':' + charRec.id;
  let c = state.chats.find(x => x.id === id);
  if (!c) {
    c = {
      id: id, kind: 'alias', charId: charRec.id, owner: currentNs(), aliasId: alias.id, aliasName: alias.name,
      aliasSetting: alias.setting || '', name: charRec.name, avatar: charRec.avatar || '',
      history: [], preview: '', lastTime: '', sortTime: 0, unread: 0
    };
    state.chats.push(c); saveChat(c);
  }
  return c;
}

/* ---------------- 马甲管理 ---------------- */
function saveAliases() { if (imdb) dbPut(imdb, 'meta', { key: 'aliases', value: state.aliases }); }
function openAliasEditor(alias) {
  const isEdit = !!alias;
  $('#aliasSheet').classList.remove('show');
  showSheet(isEdit ? '编辑马甲' : '新建马甲', `<input class="sheet-input" id="aliasNameInput" placeholder="昵称 / 号码" value="${isEdit ? esc(alias.name) : ''}">
    <textarea class="sheet-input" id="aliasSettingInput" placeholder="设定（可不写）" style="height:80px;padding:10px 14px">${isEdit ? esc(alias.setting || '') : ''}</textarea>
    <button id="aliasSaveBtn" style="width:100%;height:48px;border-radius:12px;color:#0a84ff;font-size:17px">保存</button>`);
  $('#aliasSaveBtn').onclick = () => {
    const name = $('#aliasNameInput').value.trim() || ('马甲' + Math.floor(1000 + Math.random() * 9000));
    const setting = $('#aliasSettingInput').value.trim();
    if (isEdit) {
      alias.name = name; alias.setting = setting;
      // 同步已存在的马甲会话，改名后立即生效
      state.chats.forEach(c => {
        if (c.kind === 'alias' && c.aliasId === alias.id) { c.aliasName = name; c.aliasSetting = setting; saveChat(c); }
      });
    } else {
      state.aliases.push({ id: uid('al_'), name: name, setting: setting });
    }
    saveAliases(); hideSheet(); renderAliasSheet(); $('#aliasSheet').classList.add('show');
    toastMsg(isEdit ? '马甲已保存' : ('马甲已保存：' + name));
  };
}
function renderAliasSheet() {
  const body = $('#asBody'); body.innerHTML = '';
  const real = document.createElement('div'); real.className = 'as-item';
  real.innerHTML = `<span class="s-avatar"><svg viewBox="0 0 52 52"><circle cx="26" cy="19" r="9" fill="#fff"/><path d="M9 46c0-9.4 7.6-15 17-15s17 5.6 17 15z" fill="#fff"/></svg></span><span class="s-name">我</span><span class="s-tag">真实身份</span>`;
  body.appendChild(real);
  state.aliases.forEach(a => {
    const item = document.createElement('div'); item.className = 'as-item';
    item.innerHTML = `<span class="s-avatar"><svg viewBox="0 0 52 52"><circle cx="26" cy="19" r="9" fill="#fff"/><path d="M9 46c0-9.4 7.6-15 17-15s17 5.6 17 15z" fill="#fff"/></svg></span><span class="s-name">${esc(a.name)}</span><span class="s-actions"><button class="as-edit" type="button">编辑</button><button class="as-del" type="button">删除</button></span>`;
    item.querySelector('.as-edit').onclick = () => openAliasEditor(a);
    item.querySelector('.as-del').onclick = () => {
      state.aliases = state.aliases.filter(x => x.id !== a.id);
      saveAliases(); renderAliasSheet();
      toastMsg('已删除马甲');
    };
    body.appendChild(item);
  });
  const add = document.createElement('div'); add.className = 'as-item add';
  add.innerHTML = `<span class="s-avatar" style="background:rgba(120,120,128,.12)">＋</span><span class="s-name">新增马甲</span>`;
  add.onclick = () => openAliasEditor(null);
  body.appendChild(add);
}
$('#asCancel').addEventListener('click', () => $('#aliasSheet').classList.remove('show'));
$('#asSave').addEventListener('click', () => $('#aliasSheet').classList.remove('show'));

/* ---------------- 列表交互 ---------------- */
let swipe = null;
const listScroll = $('#threadList');
function bindThreads() {
  $$('#threadList .thread').forEach(t => {
    t.addEventListener('click', e => {
      if (editing) { const box = e.target.closest('.select-box'); if (box) { box.classList.toggle('checked'); updateCount(); } return; }
      if (t.dataset.swipeLocked === '1') { closeSwipe(t); return; }
      openThread(t.dataset.key);
    });
  });
  $$('#threadList .select-box').forEach(box => {
    box.addEventListener('click', e => { e.stopPropagation(); if (!editing) return; box.classList.toggle('checked'); updateCount(); });
  });
  $$('#threadList [data-delete]').forEach(btn => btn.onclick = e => {
    e.stopPropagation();
    const threadEl = btn.closest('.thread-wrap').querySelector('.thread');
    const key = threadEl && threadEl.dataset.key;
    if (key) deleteChat(key);
    btn.closest('.thread-wrap').remove();
    toastMsg('已删除');
  });
}
function closeSwipe(threadEl) {
  threadEl.classList.remove('swiped'); threadEl.style.transform = ''; threadEl.dataset.swipeLocked = '0';
  const w = threadEl.closest('.thread-wrap'); if (w) w.classList.remove('swiped');
}
function deleteChat(key) {
  state.chats = state.chats.filter(c => c.id !== key);
  if (imdb) dbDelete(imdb, 'chats', key);
  dropChatLS(key);
  if (key.indexOf('c:') === 0) {
    const cid = key.slice(2);
    if (state.hidden.indexOf(cid) === -1) { state.hidden.push(cid); saveHidden(); }
  }
}
listScroll.addEventListener('pointerdown', e => {
  if (editing || e.target.closest('.select-box')) return;
  const thread = e.target.closest('.thread');
  if (!thread) return;
  swipe = { thread: thread, startX: e.clientX, startY: e.clientY, dx: 0, active: true };
  try { thread.setPointerCapture(e.pointerId); } catch (err) {}
});
listScroll.addEventListener('pointermove', e => {
  if (!swipe || !swipe.active) return;
  const dx = e.clientX - swipe.startX, dy = e.clientY - swipe.startY;
  if (Math.abs(dy) > Math.abs(dx) + 8) { swipe.active = false; return; }
  swipe.dx = Math.max(-100, Math.min(0, dx));
  swipe.thread.style.transition = 'none';
  swipe.thread.style.transform = 'translateX(' + swipe.dx + 'px)';
});
function endSwipe() {
  if (!swipe) return; const s = swipe; swipe = null;
  const wrap = s.thread.closest('.thread-wrap');
  s.thread.style.transition = '';
  if (s.dx < -40) {
    s.thread.classList.add('swiped'); s.thread.style.transform = 'translateX(-88px)'; s.thread.dataset.swipeLocked = '1';
    if (wrap) wrap.classList.add('swiped');
  } else {
    closeSwipe(s.thread);
    if (wrap) wrap.classList.remove('swiped');
  }
}
listScroll.addEventListener('pointerup', endSwipe);
listScroll.addEventListener('pointercancel', endSwipe);
listScroll.addEventListener('pointerleave', endSwipe);

$('#editBtn').addEventListener('click', () => {
  editing = !editing;
  $('#listScreen').classList.toggle('editing', editing);
  $('#editBtn').textContent = editing ? '取消' : '编辑';
  if (!editing) { $$('#threadList .select-box.checked').forEach(x => x.classList.remove('checked')); updateCount(); }
});
function updateCount() {
  const n = $$('#threadList .select-box.checked').length;
  $('#editCount').textContent = n ? ('已选择 ' + n + ' 个') : '未选择';
  $('#deleteSelected').disabled = (n === 0);
}
$('#deleteSelected').addEventListener('click', () => {
  const selected = $$('#threadList .select-box.checked');
  if (!selected.length) return;
  selected.forEach(box => {
    const t = box.closest('.thread-wrap').querySelector('.thread');
    if (t && t.dataset.key) deleteChat(t.dataset.key);
    box.closest('.thread-wrap').remove();
  });
  toastMsg('已删除 ' + selected.length + ' 个对话');
  $('#editBtn').click();
});

const listMenu = $('#listMenu');
$('#listMenuBtn').addEventListener('click', e => { e.stopPropagation(); listMenu.classList.toggle('show'); });
document.addEventListener('click', e => { if (!e.target.closest('#listMenu') && !e.target.closest('#listMenuBtn')) listMenu.classList.remove('show'); });
$('#menuNew').addEventListener('click', () => { listMenu.classList.remove('show'); openNewMsg(); });
$('#menuRefresh').addEventListener('click', () => { listMenu.classList.remove('show'); refreshStrangers(); });
$('#menuAlias').addEventListener('click', () => { listMenu.classList.remove('show'); renderAliasSheet(); $('#aliasSheet').classList.add('show'); });
// 首页搜索栏右边的按钮 = 马甲管理
$('#composeBtn').addEventListener('click', () => { renderAliasSheet(); $('#aliasSheet').classList.add('show'); });

/* ---------------- 搜索 ---------------- */
$('#searchDock').addEventListener('click', () => {
  $('#ssInput').value = ''; $('#ssResults').innerHTML = '';
  $('#overlay').classList.add('show'); $('#searchSheet').classList.add('show');
  setTimeout(() => $('#ssInput').focus(), 50);
});
$('#ssCancel').addEventListener('click', () => { $('#overlay').classList.remove('show'); $('#searchSheet').classList.remove('show'); });
$('#ssInput').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  const box = $('#ssResults');
  if (!q) { box.innerHTML = ''; return; }
  const hits = buildThreads().filter(c => c.name.toLowerCase().indexOf(q) !== -1);
  box.innerHTML = hits.length ? hits.map(c => `<div class="hit" data-key="${esc(c.key)}"><span>${esc(c.name)}</span></div>`).join('') : '<div class="ss-empty">没有找到相关的人</div>';
  $$('.ss-results .hit').forEach(h => h.addEventListener('click', () => {
    $('#overlay').classList.remove('show'); $('#searchSheet').classList.remove('show');
    openThread(h.dataset.key);
  }));
});

/* ---------------- 聊天设置 / 气泡菜单 ---------------- */
$('#chatBack').addEventListener('click', () => { $('#chatScreen').classList.remove('show'); $('#plusSheet').classList.remove('show'); renderList(); });
$('#chatVideo').addEventListener('click', () => toastMsg('视频通话'));
$('#chatPerson').addEventListener('click', () => { if (state.current && state.current.kind === 'char') { $('#chatSettings').classList.add('show'); } else { toastMsg('该会话没有资料页'); } });
$('#csBack').addEventListener('click', () => $('#chatSettings').classList.remove('show'));
$('#rowRemark').addEventListener('click', () => {
  const c = state.current; if (!c) return;
  showSheet('修改备注', `<input class="sheet-input" id="remarkInput" value="${esc(c.remark || c.name)}">
    <button id="remarkSave" style="width:100%;height:48px;border-radius:12px;color:#0a84ff;font-size:17px">保存</button>`);
  $('#remarkSave').onclick = () => {
    const v = $('#remarkInput').value.trim() || c.name;
    c.remark = v; saveChat(c);
    $('#valRemark').textContent = v; $('#csName').textContent = v;
    $('#chatName').innerHTML = esc(v) + '<span class="chev-down"></span>';
    hideSheet(); toastMsg('备注已修改');
  };
});
$('#rowBg').addEventListener('click', () => {
  showSheet('聊天背景', `<button id="bgPick" style="width:100%;height:48px;border-radius:12px;color:#0a84ff;font-size:17px">从相册选择</button>
    <button id="bgWhite" style="width:100%;height:48px;border-radius:12px;color:#0a84ff;font-size:17px">默认白色</button>`);
  $('#bgPick').onclick = () => { hideSheet(); $('#bgFile').click(); };
  $('#bgWhite').onclick = () => { const c = state.current; if (c) { c.bg = ''; saveChat(c); applyChatBg(c); } hideSheet(); };
});
$('#bgFile').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => { const c = state.current; if (c) { c.bg = r.result; saveChat(c); applyChatBg(c); toastMsg('背景已更新'); } };
  r.readAsDataURL(f);
  e.target.value = '';
});
$('#rowSearch').addEventListener('click', () => {
  showSheet('查找记录', `<input class="sheet-input" id="chatSearchInput" placeholder="输入关键词">
    <div id="chatSearchResults" style="max-height:40vh;overflow:auto"></div>`);
  $('#chatSearchInput').addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    const box = $('#chatSearchResults');
    if (!q) { box.innerHTML = ''; return; }
    const hits = (state.messages || []).map((m, i) => ({ m: m, i: i })).filter(x => x.m.text && x.m.text.toLowerCase().indexOf(q) !== -1);
    box.innerHTML = hits.length ? hits.map(x => `<div class="search-hit" data-i="${x.i}" style="padding:12px 0;border-bottom:0.5px solid var(--line);font-size:15px">${esc(x.m.text)}</div>`).join('') : '<div class="ss-empty">没有找到相关消息</div>';
  });
});
$('#rowClear').addEventListener('click', () => {
  showSheet('清空记录', `<div style="text-align:center;padding:12px 10px 15px;color:#666;font-size:14px">将删除该会话的全部消息。</div>
    <button id="confirmClear" style="width:100%;height:48px;border-radius:12px;color:#ff3b30;font-size:17px">清空记录</button>`);
  $('#confirmClear').onclick = () => { const c = state.current; if (!c) return; state.messages = []; persistCurrent({ skipSummary: true }); renderMessages(); hideSheet(); toastMsg('已清空'); };
});
function showSheet(title, body) { $('#sheetTitle').textContent = title; $('#sheetBody').innerHTML = body; $('#overlay').classList.add('show'); $('#sheet').classList.add('show'); }
function hideSheet() { $('#overlay').classList.remove('show'); $('#sheet').classList.remove('show'); }
$('#sheetCancel').addEventListener('click', hideSheet);
$('#overlay').addEventListener('click', () => {
  ['#pickerSheet', '#searchSheet', '#sheet', '#editSheet'].forEach(s => { const el = $(s); if (el) el.classList.remove('show'); });
  $('#overlay').classList.remove('show');
});

const bubbleMenu = $('#bubbleMenu'), reactionBar = $('#reactionBar');
let targetIndex = -1;
$('#messages').addEventListener('dblclick', e => {
  const b = e.target.closest('.msg'); if (!b) return;
  targetIndex = +b.dataset.index;
  const r = b.getBoundingClientRect();
  bubbleMenu.style.left = Math.min(r.left, window.innerWidth - 160) + 'px';
  bubbleMenu.style.top = (r.bottom + 8) + 'px';
  bubbleMenu.classList.add('show'); reactionBar.classList.remove('show');
});
$('#bmQuote').addEventListener('click', () => {
  const m = state.messages[targetIndex];
  if (m) { $('#quoteText').textContent = m.text || ''; $('#quoteBar').classList.add('show'); }
  bubbleMenu.classList.remove('show');
});
$('#quoteClose').addEventListener('click', () => $('#quoteBar').classList.remove('show'));
$('#bmEdit').addEventListener('click', () => {
  const m = state.messages[targetIndex];
  if (m) { $('#esInput').value = m.text || ''; $('#overlay').classList.add('show'); $('#editSheet').classList.add('show'); }
  bubbleMenu.classList.remove('show');
});
$('#esCancel').addEventListener('click', () => { $('#overlay').classList.remove('show'); $('#editSheet').classList.remove('show'); });
$('#esSave').addEventListener('click', async () => {
  const m = state.messages[targetIndex];
  if (m) m.text = $('#esInput').value.trim() || m.text;
  renderMessages(); await persistCurrent();
  $('#overlay').classList.remove('show'); $('#editSheet').classList.remove('show');
});
$('#bmDelete').addEventListener('click', async () => {
  state.messages.splice(targetIndex, 1);
  renderMessages(); await persistCurrent({ skipSummary: true });
  bubbleMenu.classList.remove('show'); toastMsg('已删除');
});
document.addEventListener('click', e => { if (!e.target.closest('#bubbleMenu')) bubbleMenu.classList.remove('show'); });

/* ---------------- 更多（三个悬浮功能，无外层包裹） ---------------- */
$('#plusBtn').addEventListener('click', () => $('#plusSheet').classList.toggle('show'));
document.addEventListener('click', e => {
  if (!e.target.closest('#plusSheet') && !e.target.closest('#plusBtn')) $('#plusSheet').classList.remove('show');
});
$('#plusReroll').addEventListener('click', async () => { $('#plusSheet').classList.remove('show'); await doReroll(); });
$('#plusImage').addEventListener('click', () => { $('#plusSheet').classList.remove('show'); $('#imgFile').click(); });
$('#imgFile').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = async () => {
    const c = state.current;
    const msg = { id: uid(), isImage: true, imageData: { url: r.result }, time: nowHHMM(), ts: Date.now() };
    if (c && c.kind === 'char') msg.type = 'right'; else msg.who = 'me';
    appendToCurrent(msg); renderMessages(); await persistCurrent(); toastMsg('图片已发送');
  };
  r.readAsDataURL(f);
  e.target.value = '';
});
$('#plusSticker').addEventListener('click', () => { $('#plusSheet').classList.remove('show'); openEmojiPanel(); });

/* ---------------- 表情包（来源 emoji 数据） ---------------- */
function openEmojiPanel() {
  const overlay = $('#imEmojiOverlay');
  overlay.classList.add('show');
  loadEmojiData().then(data => {
    state.emojiData = data;
    const groups = (data && data.emojiGroups) || [];
    const gbox = $('#imEmojiGroups');
    const grid = $('#imEmojiGrid');
    const empty = $('#imEmojiEmpty');
    if (!groups.length) { gbox.innerHTML = ''; grid.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    gbox.innerHTML = groups.map((g, i) => `<button class="im-ep-tab${i === 0 ? ' on' : ''}" data-id="${esc(g.id)}">${esc(g.name || '未命名')}</button>`).join('');
    state.currentEmojiGroup = groups[0].id;
    renderEmojiGrid(groups[0].emojis || []);
    gbox.querySelectorAll('.im-ep-tab').forEach(btn => btn.onclick = () => {
      gbox.querySelectorAll('.im-ep-tab').forEach(x => x.classList.toggle('on', x === btn));
      const g = groups.find(x => String(x.id) === String(btn.dataset.id));
      renderEmojiGrid(g ? (g.emojis || []) : []);
    });
  });
}
function renderEmojiGrid(emojis) {
  const grid = $('#imEmojiGrid');
  if (!emojis.length) { grid.innerHTML = '<div class="im-ep-empty2">这个分组还没有表情包</div>'; return; }
  grid.innerHTML = emojis.map(e => `<button class="im-ep-item" data-url="${esc(e.url)}" data-name="${esc(e.name || '')}"><img src="${esc(e.url)}" alt=""><span>${esc(e.name || '')}</span></button>`).join('');
  grid.querySelectorAll('.im-ep-item').forEach(btn => btn.onclick = () => {
    sendSticker(btn.dataset.url, btn.dataset.name);
  });
}
async function sendSticker(url, name) {
  const c = state.current;
  if (!c) return;
  const msg = { id: uid(), isImage: true, imageData: { url: url, emojiName: name }, text: '', time: nowHHMM(), ts: Date.now() };
  if (c.kind === 'char') msg.type = 'right'; else msg.who = 'me';
  appendToCurrent(msg);
  closeEmojiPanel();
  renderMessages();
  await persistCurrent();
  toastMsg('表情已发送');
}
function closeEmojiPanel() { $('#imEmojiOverlay').classList.remove('show'); }
$('#imEmojiClose').addEventListener('click', closeEmojiPanel);
$('#imEmojiOverlay').addEventListener('click', e => { if (e.target === $('#imEmojiOverlay')) closeEmojiPanel(); });

/* ---------------- 新信息页 ---------------- */
let nmRecipient = null, nmSender = null;
function openNewMsg() {
  nmRecipient = null; nmSender = null;
  $('#nmRecipientValue').textContent = '选择人物'; $('#nmRecipientValue').classList.add('empty');
  $('#nmSenderValue').textContent = '我 / 马甲'; $('#nmSenderValue').classList.add('empty');
  $('#nmInput').value = ''; syncSend(); $('#newmsgScreen').classList.add('show');
}
$('#nmCancel').addEventListener('click', () => $('#newmsgScreen').classList.remove('show'));
function syncSend() { $('#nmSend').disabled = !(nmRecipient && nmSender && $('#nmInput').value.trim()); }
$('#nmRecipientRow').addEventListener('click', () => {
  openPicker('选择收件人', state.chars.map(c => ({ name: c.name, raw: c })), item => {
    nmRecipient = item.raw; $('#nmRecipientValue').textContent = item.name; $('#nmRecipientValue').classList.remove('empty'); syncSend();
  });
});
$('#nmSenderRow').addEventListener('click', () => {
  const list = [{ name: '我', group: '真实身份', alias: null }].concat(state.aliases.map(a => ({ name: a.name, group: '马甲', alias: a })));
  openPicker('选择发送人', list, item => {
    nmSender = item; $('#nmSenderValue').textContent = item.name + (item.group ? '（' + item.group + '）' : ''); $('#nmSenderValue').classList.remove('empty'); syncSend();
  });
});
$('#nmInput').addEventListener('input', syncSend);
$('#nmSend').addEventListener('click', doNewSend);
$('#nmPlus').addEventListener('click', () => toastMsg('附件功能'));
async function doNewSend() {
  const text = $('#nmInput').value.trim();
  if (!nmRecipient || !nmSender || !text) return;
  $('#newmsgScreen').classList.remove('show');
  const chat = nmSender.alias ? ensureAliasChat(nmRecipient, nmSender.alias) : ensureCharChat(nmRecipient);
  // 马甲会话是独立卡片/窗口；用马甲发送 = 匿名
  const msg = { id: uid(), text: text, time: nowHHMM(), ts: Date.now() };
  if (chat.kind === 'char') msg.type = 'right'; else msg.who = 'me';
  chat.history = chat.history || [];
  chat.history.push(msg);
  await saveChat(chat);
  openThread(chat.id);
  toastMsg(nmSender.alias ? ('已用「' + nmSender.alias.name + '」发送') : '已发送');
}
function openPicker(title, list, cb) {
  $('#pickerTitle').textContent = title;
  const box = $('#pickerList'); box.innerHTML = '';
  list.forEach(item => {
    const b = document.createElement('button'); b.type = 'button';
    b.innerHTML = `<span class="s-avatar"><svg viewBox="0 0 52 52"><circle cx="26" cy="19" r="9" fill="#fff"/><path d="M9 46c0-9.4 7.6-15 17-15s17 5.6 17 15z" fill="#fff"/></svg></span><span>${esc(item.name)}</span>${item.group ? `<span style="margin-left:auto;color:#8e8e93;font-size:13px">${esc(item.group)}</span>` : ''}`;
    b.onclick = () => { closePicker(); cb(item); };
    box.appendChild(b);
  });
  $('#overlay').classList.add('show'); $('#pickerSheet').classList.add('show');
}
function closePicker() { $('#overlay').classList.remove('show'); $('#pickerSheet').classList.remove('show'); }
$('#pickerCancel').addEventListener('click', closePicker);

/* ---------------- Toast / 标题返回 ---------------- */
let toastTimer;
function toastMsg(t) {
  const el = $('#toast'); if (!el) return;
  el.textContent = t; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}
$('#listTitle').addEventListener('click', () => {
  if ($('#chatSettings').classList.contains('show')) { $('#chatSettings').classList.remove('show'); return; }
  if ($('#chatScreen').classList.contains('show')) { $('#chatScreen').classList.remove('show'); $('#plusSheet').classList.remove('show'); renderList(); return; }
  if ($('#newmsgScreen').classList.contains('show')) { $('#newmsgScreen').classList.remove('show'); return; }
  // 列表页点「信息」→ 返回 Discover
  if (window.parent !== window) { try { window.parent.postMessage({ type: 'backToDiscover' }, '*'); } catch (e) {} }
  else { history.back(); }
});

/* ---------------- 启动 ---------------- */
async function loadIM() {
  imdb = await openIMDB();
  const chats = await dbGetAll(imdb, 'chats');
  state.chats = claimAndFilterChats(chats);
  state.chats.forEach(c => { if (!Array.isArray(c.history)) c.history = []; });
  // 兜底：IndexedDB 不可用 / 被清空时，用 localStorage 镜像恢复（切页不丢消息）
  const lsChats = claimAndFilterChats(loadChatsFromLS());
  if (lsChats.length) {
    const byId = {};
    state.chats.forEach(c => { byId[c.id] = c; });
    lsChats.forEach(lc => {
      const cur = byId[lc.id];
      if (!cur) { state.chats.push(lc); byId[lc.id] = lc; }
      else if ((lc.history || []).length > (cur.history || []).length) cur.history = lc.history;
    });
  }
  // 两处对齐：把最终结果写回镜像与 DB，任一存储缺失都不会丢消息
  state.chats.forEach(c => {
    try { mirrorChat(c); } catch (e) {}
    if (imdb) { try { dbPut(imdb, 'chats', c); } catch (e) {} }
  });
  const aliasRec = await dbGet(imdb, 'meta', 'aliases');
  state.aliases = (aliasRec && Array.isArray(aliasRec.value)) ? aliasRec.value : [];
  const hiddenRec = await dbGet(imdb, 'meta', 'hidden:' + currentNs());
  state.hidden = (hiddenRec && Array.isArray(hiddenRec.value)) ? hiddenRec.value : [];
}
(async function boot() {
  try { loadWorldbooksFromDB(); } catch (e) {}
  try { state.allChars = await loadCharacters(); } catch (e) { state.allChars = []; }
  state.chars = filterCharsForUser(state.allChars);
  state.chars.forEach(c => { const r = getSetting(c.id, 'remark', null); if (r) c.remark = r; });
  try { await loadIM(); } catch (e) {}
  syncWave();
  renderList();
  updatePendingIndicator();
  try { await resumePending(); } catch (e) {}
  updatePendingIndicator();
  window.addEventListener('message', e => {
    const d = e.data;
    if (d && (d.type === 'contactsDataUpdated' || d.type === 'currentMaskChanged' || d.type === 'homeDataUpdated')) {
      loadCharacters().then(list => {
        state.allChars = list;
        state.chars = filterCharsForUser(list);
        state.chars.forEach(c => { const r = getSetting(c.id, 'remark', null); if (r) c.remark = r; });
        if (d.type === 'currentMaskChanged') { loadIM().then(() => renderList()).catch(() => {}); }
      });
    }
    if (d && (d.type === 'nanoIMessageUpdated' || d.type === 'nanoBlockChanged' || d.type === 'nanoCharBlocked' || d.type === 'nanoCharUnblocked')) {
      reloadChatsFromDB();
      if ((d.type === 'nanoBlockChanged' || d.type === 'nanoCharBlocked' || d.type === 'nanoCharUnblocked') && state.current) renderBanner(state.current);
    }
  });
})();

})();
