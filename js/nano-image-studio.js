/* nano-image-studio.js — Nano 生图室
   功能：多窗口（新建/切换/改名/删除）、聊天 + 生图双模式、
        图片上传与风格参考、基础提示词开关与预设、
        兼容生图 API 的正面/反面提示词预设、生成图片并保存到图库。 */
(function () {
  'use strict';

  var KEY = 'nano_image_studio_v1';
  var DB_NAME = 'nano_api_db';
  var DB_VERSION = 2;
  var STORE = 'api_data';
  var PRESET_DATA_KEY = 'nano_api_presets_data';
  var PRESET_LIST_KEY = 'nano_api_preset_list';
  var PROMPTS_KEY = 'nano_api_prompts';
  var TOMB_KEY = KEY + '_deleted';

  function readTombstones() {
    try {
      var raw = localStorage.getItem(TOMB_KEY);
      var obj = raw ? JSON.parse(raw) : {};
      return obj && typeof obj === 'object' ? obj : {};
    } catch (e) { return {}; }
  }
  function writeTombstones(map) {
    try {
      var keys = Object.keys(map);
      if (keys.length > 3000) {
        keys.sort(function (a, b) { return (map[a] || 0) - (map[b] || 0); });
        keys.slice(0, keys.length - 3000).forEach(function (k) { delete map[k]; });
      }
      localStorage.setItem(TOMB_KEY, JSON.stringify(map));
    } catch (e) {}
  }
  function tombstoneItems(ids) {
    var map = readTombstones();
    var now = Date.now();
    (ids || []).forEach(function (id) { if (id) map[id] = now; });
    writeTombstones(map);
  }
  function applyTombstones(s) {
    if (!s) return s;
    var map = readTombstones();
    (s.sessions || []).forEach(function (sess) {
      if (!sess) return;
      sess.items = (sess.items || []).filter(function (it) { return it && !map[it.id]; });
    });
    return s;
  }

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid(prefix) { return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function toast(msg) {
    var el = $('niToast'); if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, 1800);
  }
  function defaultStore() {
    return {
      sessions: [],
      currentId: '',
      presets: [],
      basePresetId: '',
      importedApiName: '',
      useBasePrompt: true,
      basePositive: '',
      baseNegative: '',
      size: '768x1344',
      mode: 'image',
      savedAt: 0
    };
  }
  function normalize(s) {
    if (!s || typeof s !== 'object') s = defaultStore();
    if (!Array.isArray(s.sessions)) s.sessions = [];
    if (!Array.isArray(s.presets)) s.presets = [];
    s.useBasePrompt = s.useBasePrompt !== false;
    s.mode = s.mode === 'chat' ? 'chat' : 'image';
    // 兼容旧版单条“基础提示词”数据
    if (s.basePositive == null && s.basePrompt != null) s.basePositive = String(s.basePrompt || '');
    s.basePositive = String(s.basePositive || '');
    s.baseNegative = String(s.baseNegative || '');
    s.basePresetId = String(s.basePresetId || '');
    s.importedApiName = String(s.importedApiName || '');
    s.size = String(s.size || '768x1344');
    s.savedAt = Number(s.savedAt) || 0;
    s.presets.forEach(function (p) {
      if (!p) return;
      if (p.positive == null && p.content != null) p.positive = String(p.content || '');
      p.positive = String(p.positive || '');
      p.negative = String(p.negative || '');
    });
    s.sessions.forEach(function (x) {
      if (!x) return;
      if (!Array.isArray(x.items)) x.items = [];
      x.name = String(x.name || '生图窗口');
    });
    if (!s.sessions.length) {
      s.sessions.push({ id: uid('ni'), name: '生图 1', items: [], createdAt: Date.now(), updatedAt: Date.now() });
    }
    if (!s.currentId || !s.sessions.some(function (x) { return x.id === s.currentId; })) {
      s.currentId = s.sessions[0].id;
    }
    return s;
  }
  function loadLocal() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) {}
    var s = null;
    try { s = raw ? JSON.parse(raw) : null; } catch (e) { s = null; }
    return applyTombstones(normalize(s));
  }
  // 聊天/生图记录里的图片是 data URL，一张就有几 MB。localStorage 只有约 5MB，
  // 写不下时 save() 会失败，删掉的消息下次打开又回来。这里把完整记录放进 IndexedDB，
  // localStorage 只留一份不带大图的可同步镜像，并用 savedAt 判断哪一份更新。
  function lightState(src) {
    src = src || {};
    var copy = {};
    Object.keys(src).forEach(function (k) { copy[k] = src[k]; });
    copy.sessions = (src.sessions || []).map(function (sess) {
      if (!sess) return sess;
      var s2 = {};
      Object.keys(sess).forEach(function (k) { s2[k] = sess[k]; });
      s2.items = (sess.items || []).map(function (it) {
        if (!it) return it;
        var i2 = {};
        Object.keys(it).forEach(function (k) { i2[k] = it[k]; });
        if (typeof i2.url === 'string' && /^data:/i.test(i2.url)) i2.url = '';
        if (typeof i2.image === 'string' && /^data:/i.test(i2.image)) i2.image = '';
        return i2;
      });
      return s2;
    });
    return copy;
  }
  function writeLocal(src) {
    try { localStorage.setItem(KEY, JSON.stringify(lightState(src))); }
    catch (e) {
      try { localStorage.removeItem(KEY); } catch (e2) {}
    }
  }
  function fillHeavyMedia(targetSession, heavySession) {
    var byId = {};
    ((heavySession && heavySession.items) || []).forEach(function (it) {
      if (it && it.id) byId[it.id] = it;
    });
    ((targetSession && targetSession.items) || []).forEach(function (it) {
      var h = it && it.id ? byId[it.id] : null;
      if (!h) return;
      if (!it.url && h.url) it.url = h.url;
      if (!it.image && h.image) it.image = h.image;
    });
  }
  function localHasChanges(light, heavy) {
    var heavyById = {};
    (heavy.sessions || []).forEach(function (hs) { if (hs && hs.id) heavyById[hs.id] = hs; });
    return (light.sessions || []).some(function (ls) {
      if (!ls) return false;
      var hs = ls.id ? heavyById[ls.id] : null;
      if (!hs) return (ls.items || []).length > 0;
      return (Number(ls.updatedAt) || 0) > (Number(hs.updatedAt) || 0) ||
        ((ls.items || []).length !== (hs.items || []).length);
    });
  }
  function mergeHeavyLight(heavy, light) {
    if (!heavy) return normalize(light);
    if (!light) return normalize(heavy);
    var ht = Number(heavy.savedAt) || 0;
    var lt = Number(light.savedAt) || 0;
    // 本地更新，或同级但确实清空/改过窗口时，以本地为准；避免 IDB 旧记录顶掉刚清空的聊天。
    if (lt > ht || (lt === ht && localHasChanges(light, heavy))) {
      var heavyById = {};
      (heavy.sessions || []).forEach(function (hs) { if (hs && hs.id) heavyById[hs.id] = hs; });
      (light.sessions || []).forEach(function (ls) {
        var hs = ls && ls.id ? heavyById[ls.id] : null;
        if (hs) fillHeavyMedia(ls, hs);
      });
      return normalize(light);
    }
    // IDB 更新时，仍尊重本地刚清空/刚改过的那一个窗口。
    var lightById = {};
    (light.sessions || []).forEach(function (ls) { if (ls && ls.id) lightById[ls.id] = ls; });
    var merged = [];
    (heavy.sessions || []).forEach(function (hs) {
      var ls = hs && hs.id ? lightById[hs.id] : null;
      if (ls && (Number(ls.updatedAt) || 0) >= (Number(hs.updatedAt) || 0)) {
        fillHeavyMedia(ls, hs);
        merged.push(ls);
      } else {
        merged.push(hs);
      }
    });
    (light.sessions || []).forEach(function (ls) {
      if (ls && ls.id && (ls.items || []).length && !(heavy.sessions || []).some(function (hs) { return hs && hs.id === ls.id; })) merged.push(ls);
    });
    heavy.sessions = merged;
    return normalize(heavy);
  }
  function mergeStoredIntoMemory(memory, stored) {
    if (!memory || !stored) return memory;
    if ((Number(stored.savedAt) || 0) >= (Number(memory.savedAt) || 0)) {
      memory.basePositive = stored.basePositive;
      memory.baseNegative = stored.baseNegative;
      memory.useBasePrompt = stored.useBasePrompt;
      memory.presets = stored.presets;
      memory.basePresetId = stored.basePresetId;
      memory.importedApiName = stored.importedApiName;
      memory.size = stored.size;
    }
    var byId = {};
    (stored.sessions || []).forEach(function (ss) { if (ss && ss.id) byId[ss.id] = ss; });
    (memory.sessions || []).forEach(function (ms, i) {
      var ss = ms && ms.id ? byId[ms.id] : null;
      // 只接受存储里确实更新的窗口；设置页只改提示词时，不会用旧的 sessions 覆盖当前聊天。
      if (ss && (Number(ss.updatedAt) || 0) > (Number(ms.updatedAt) || 0)) {
        memory.sessions[i] = ss;
      }
    });
    return memory;
  }
  function idbReady() {
    return !!(window.NanoIDB && window.NanoIDB.get && window.NanoIDB.set);
  }
  var hydrated = false;
  var saveChain = Promise.resolve();
  function hydrate() {
    return new Promise(function (resolve) {
      if (!idbReady()) { hydrated = true; resolve(); return; }
      window.NanoIDB.get(KEY).then(function (heavy) {
        var local = state; // 启动时已经读过 localStorage，不再重复解析大 JSON
        state = applyTombstones(heavy ? mergeHeavyLight(heavy, local) : local);
        hydrated = true;
        if (!heavy || (Number(local.savedAt) || 0) >= (Number(heavy.savedAt) || 0)) {
          try { window.NanoIDB.set(KEY, state); } catch (e) {}
        }
        writeLocal(state);
        resolve();
      }).catch(function () { hydrated = true; resolve(); });
    });
  }
  function reloadState() {
    return saveChain.catch(function () {}).then(function () {
      if (!idbReady()) return;
      return window.NanoIDB.get(KEY).then(function (heavy) {
        // 以当前内存状态为准，只接受 localStorage/IDB 里确实更新的窗口。
        // 这样删除/新消息刚发生时，不会被旧记录顶掉；设置页清空后也能正确同步回来。
        var memory = mergeStoredIntoMemory(state, loadLocal());
        state = applyTombstones(heavy ? mergeHeavyLight(heavy, memory) : memory);
      }).catch(function () {});
    });
  }
  var state = loadLocal();
  var generating = false;
  var pendingImage = '';
  var pendingQuote = null;

  function readAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result || '')); };
      r.onerror = function () { reject(new Error('图片读取失败')); };
      r.readAsDataURL(file);
    });
  }

  function compressImage(file) {
    return readAsDataURL(file).then(function (dataUrl) {
      if (!/^data:image\//i.test(dataUrl)) throw new Error('不是有效的图片');
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
          var max = 896;
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          if (!w || !h) { resolve(dataUrl); return; }
          var scale = Math.min(1, max / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale));
          var ch = Math.max(1, Math.round(h * scale));
          if (scale === 1 && dataUrl.length < 900 * 1024) { resolve(dataUrl); return; }
          try {
            var c = document.createElement('canvas');
            c.width = cw; c.height = ch;
            var ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0, cw, ch);
            resolve(c.toDataURL('image/jpeg', 0.86));
          } catch (e) { resolve(dataUrl); }
        };
        img.onerror = function () { resolve(dataUrl); };
        img.src = dataUrl;
      });
    });
  }

  function setPendingImage(dataUrl) {
    pendingImage = String(dataUrl || '');
    var box = $('niAttachPreview');
    var thumb = $('niAttachThumb');
    if (box) box.hidden = !pendingImage;
    if (thumb) thumb.src = pendingImage || '';
    renderChips();
    syncSendButton();
  }

  function svgIcon(name) {
    var paths = {
      redo: '<path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4"/>',
      download: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>',
      quote: '<path d="M9 17l-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
      ref: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5-5 5-3-3-5 5"/>',
      del: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
      copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
      edit: '<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M13.5 6.5l3 3"/>',
      star: '<path d="M12 3l2.6 5.3 5.9.9-4.3 4.2 1 5.9-5.2-2.7-5.2 2.7 1-5.9L3.5 9.2l5.9-.9z"/>'
    };
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      (paths[name] || '') + '</svg>';
  }

  function setPendingQuote(quote) {
    pendingQuote = quote ? {
      who: String(quote.who || ''),
      text: String(quote.text || '').slice(0, 500)
    } : null;
    var bar = $('niQuoteBar');
    var whoEl = $('niQuoteWho');
    var textEl = $('niQuoteText');
    if (bar) bar.hidden = !pendingQuote;
    if (whoEl) whoEl.textContent = pendingQuote ? (pendingQuote.who || '消息') : '';
    if (textEl) textEl.textContent = pendingQuote ? pendingQuote.text : '';
  }

  function quoteMessage(id) {
    var item = findItem(id);
    if (!item) return;
    var text = String(item.text || item.fullPrompt || item.prompt || '').trim();
    if (!text && (item.url || item.image)) text = '一张图片';
    if (!text) { toast('这条消息没有可引用的内容'); return; }
    setPendingQuote({ who: item.role === 'user' ? '我' : 'Nano', text: text });
    closeMsgMenu();
    var input = $('niPrompt');
    if (input) { try { input.focus(); } catch (e) {} }
    toast('已引用，输入你的回复');
  }

  function save() {
    state = applyTombstones(state);
    state.savedAt = Math.max(Date.now(), (Number(state.savedAt) || 0) + 1);
    writeLocal(state);
    if (idbReady() && hydrated) {
      saveChain = saveChain.then(function () {
        return window.NanoIDB.set(KEY, state);
      }).catch(function () {});
    }
    return true;
  }
  function currentSession() {
    var s = state.sessions.find(function (x) { return x.id === state.currentId; });
    if (!s) { s = state.sessions[0]; state.currentId = s.id; }
    return s;
  }
  function findItem(id) {
    var list = currentSession().items;
    return list.find(function (x) { return x && x.id === id; }) || null;
  }
  function previousUserImage(id) {
    var list = currentSession().items || [];
    var idx = -1;
    list.some(function (x, i) { if (x && x.id === id) { idx = i; return true; } return false; });
    for (var i = idx - 1; i >= 0; i--) {
      if (list[i] && list[i].role === 'user' && list[i].image) return list[i].image;
    }
    return '';
  }

  /* ---------- API 提示词读取 ---------- */
  function openApiDB() {
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }
  function apiGet(key) {
    return openApiDB().then(function (db) {
      if (!db) throw new Error('no db');
      return new Promise(function (resolve, reject) {
        try {
          var r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
          r.onsuccess = function () {
            try { db.close(); } catch (e) {}
            var v = r.result;
            var val = v ? (v.value !== undefined ? v.value : v) : null;
            if (val == null) {
              try {
                var lr = localStorage.getItem(key);
                if (lr) val = JSON.parse(lr);
              } catch (err) {}
            }
            resolve(val);
          };
          r.onerror = function () { try { db.close(); } catch (e) {} reject(r.error); };
        } catch (e) { try { db.close(); } catch (err) {} reject(e); }
      });
    }).catch(function () {
      try {
        var raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    });
  }
  function apiPresetNames(data, list) {
    var names = [];
    if (list && Array.isArray(list.prompt)) {
      list.prompt.forEach(function (n) { if (n) names.push(String(n)); });
    }
    if (data && typeof data === 'object') {
      Object.keys(data).forEach(function (k) {
        if (k.indexOf('prompt_') === 0) {
          var n = k.slice(7);
          if (n && names.indexOf(n) < 0) names.push(n);
        }
      });
    }
    return names;
  }
  var apiPresetCache = [];
  var apiPresetDataCache = {};
  var apiCurrentPromptsCache = { positive: [], negative: [] };

  function loadApiPresets() {
    return Promise.all([
      apiGet(PRESET_DATA_KEY),
      apiGet(PRESET_LIST_KEY),
      apiGet(PROMPTS_KEY)
    ]).then(function (res) {
      apiPresetDataCache = res[0] || {};
      var list = res[1] || {};
      apiCurrentPromptsCache = res[2] || { positive: [], negative: [] };
      apiPresetCache = apiPresetNames(apiPresetDataCache, list);
      try { renderBasePresetOptions(); } catch (e) {}
      var hint = $('niApiHint');
      if (hint) {
        var pos = (apiCurrentPromptsCache && Array.isArray(apiCurrentPromptsCache.positive)) ? apiCurrentPromptsCache.positive.length : 0;
        var neg = (apiCurrentPromptsCache && Array.isArray(apiCurrentPromptsCache.negative)) ? apiCurrentPromptsCache.negative.length : 0;
        hint.textContent = apiPresetCache.length
          ? ('已同步 ' + apiPresetCache.length + ' 个生图 API 预设；选择后会填入正面 / 反面。当前 API 提示词：正面 ' + pos + ' 条 / 反面 ' + neg + ' 条。')
          : ('还没有生图 API 提示词预设；这里的正面 / 反面只保存在 Nano 生图室。');
      }
      return { data: apiPresetDataCache, prompts: apiCurrentPromptsCache };
    }).catch(function () {
      var hint = $('niApiHint');
      if (hint) hint.textContent = '读取生图 API 提示词失败，可稍后重试。';
      return { data: {}, prompts: {} };
    });
  }
  function joinPromptList(v) {
    if (Array.isArray(v)) return v.filter(Boolean).join('，');
    return String(v || '').trim();
  }
  async function apiPromptConfig(name) {
    var data = apiPresetDataCache;
    if (!data || !Object.keys(data).length) {
      data = await apiGet(PRESET_DATA_KEY) || {};
      apiPresetDataCache = data;
    }
    if (name && name !== '__current__') {
      var cfg = data['prompt_' + name];
      return cfg
        ? { positive: joinPromptList(cfg.positive), negative: joinPromptList(cfg.negative) }
        : { positive: '', negative: '' };
    }
    var prompts = apiCurrentPromptsCache;
    if (!prompts || (!prompts.positive && !prompts.negative)) {
      prompts = await apiGet(PROMPTS_KEY) || {};
      apiCurrentPromptsCache = prompts;
    }
    return {
      positive: joinPromptList(prompts && prompts.positive),
      negative: joinPromptList(prompts && prompts.negative)
    };
  }
  async function buildPrompt(userPrompt) {
    var parts = [];
    if (state.useBasePrompt) {
      var pos = String(state.basePositive || '').trim();
      var neg = String(state.baseNegative || '').trim();
      // 从 API 预设导入时，生成时再读一次，保证和 API 里的最新内容同步。
      if (state.importedApiName) {
        var cfg = await apiPromptConfig(state.importedApiName);
        if (cfg.positive || cfg.negative) {
          pos = cfg.positive;
          neg = cfg.negative;
        }
      }
      if (pos) parts.push(pos);
      if (neg) parts.push('避免：' + neg);
    }
    parts.push(String(userPrompt || '').trim());
    return parts.filter(Boolean).join('\n');
  }

  /* ---------- 聊天（主 API） ---------- */
  function toV1Url(raw) {
    var url = String(raw || '').trim().replace(/\/+$/, '');
    if (/\/chat\/completions$/i.test(url)) return url.replace(/\/chat\/completions$/i, '');
    if (/\/v1$/i.test(url)) return url;
    return url + '/v1';
  }

  function readMainConfigLocal() {
    try {
      var raw = localStorage.getItem('nano_api_config');
      var v = raw ? JSON.parse(raw) : null;
      return v && (v.value || v);
    } catch (e) { return null; }
  }

  function getMainConfig() {
    return apiGet('nano_api_config').then(function (cfg) {
      if (!cfg) cfg = readMainConfigLocal();
      cfg = cfg && (cfg.value || cfg) || {};
      var url = String(cfg.mainUrl || '').trim();
      var key = String(cfg.mainKey || '').trim();
      var model = String(cfg.mainModel || '').trim();
      if (!url || !key || !model) throw new Error('请先在「API → 主 API」配置地址、Key 和模型');
      return { url: toV1Url(url), key: key, model: model };
    }).catch(function (err) {
      var cfg = readMainConfigLocal();
      if (cfg && cfg.mainUrl && cfg.mainKey && cfg.mainModel) {
        return { url: toV1Url(cfg.mainUrl), key: String(cfg.mainKey).trim(), model: String(cfg.mainModel).trim() };
      }
      throw err || new Error('请先在「API → 主 API」配置地址、Key 和模型');
    });
  }

  function messageText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map(function (x) {
        if (typeof x === 'string') return x;
        return (x && (x.text || x.content)) || '';
      }).join('');
    }
    return (content && (content.text || '')) || '';
  }

  function chatHistory(source) {
    var items = source || currentSession().items || [];
    var kept = items.filter(function (x) {
      if (!x) return false;
      if (x.role === 'user') return true;
      if (x.role === 'ai' && x.kind === 'chat' && x.status === 'done') return true;
      if (x.role === 'ai' && x.kind !== 'chat' && x.status === 'done') return true;
      return false;
    }).slice(-14);
    return kept.map(function (x) {
      if (x.role === 'user') {
        var userText = (x.quote ? ('引用' + (x.quote.who || '') + '：' + x.quote.text + '\n') : '') + String(x.text || '');
        if (x.image) {
          return {
            role: 'user',
            content: [
              { type: 'text', text: userText || '请描述这张图片' },
              { type: 'image_url', image_url: { url: x.image } }
            ]
          };
        }
        return { role: 'user', content: userText };
      }
      if (x.kind === 'chat') return { role: 'assistant', content: String(x.text || '') };
      return { role: 'assistant', content: '[已生成图片] ' + String(x.fullPrompt || x.prompt || '') };
    });
  }

  async function sendChat(text, image, quote) {
    if (generating) return;
    var session = currentSession();
    var userItem = { id: uid('it'), role: 'user', text: text, image: image || '', at: Date.now(), awaitingReply: true };
    if (quote) userItem.quote = { who: String(quote.who || ''), text: String(quote.text || '') };
    session.items.push(userItem);
    session.updatedAt = Date.now();
    save();
    render();
    scrollBottom();
  }

  async function replyToUserItem(id) {
    if (generating) return;
    var session = currentSession();
    var list = session.items || [];
    var idx = -1;
    list.some(function (x, i) { if (x && x.id === id) { idx = i; return true; } return false; });
    if (idx < 0) return;
    var userItem = list[idx];
    if (!userItem || userItem.role !== 'user' || userItem.replying) return;
    userItem.awaitingReply = false;
    userItem.replying = true;

    // 生图指令也走同一个「回复」按钮：第一次发送只落气泡，点回复才生成。
    if (isImageRequest(userItem.text || '')) {
      session.updatedAt = Date.now();
      save();
      render();
      scrollBottom();
      try {
        await generateImage(userItem.text || '', userItem.image || '', {
          noUser: true,
          quote: userItem.quote || null,
          afterId: userItem.id
        });
        userItem.replied = true;
      } finally {
        userItem.replying = false;
        userItem.awaitingReply = false;
        session.updatedAt = Date.now();
        save();
        render();
        scrollBottom();
      }
      return;
    }

    var ai = { id: uid('it'), role: 'ai', kind: 'chat', status: 'loading', at: Date.now() };
    list.splice(idx + 1, 0, ai);
    session.updatedAt = Date.now();
    save();
    render();
    scrollBottom();
    setGenerating(true);
    try {
      var cfg = await getMainConfig();
      var sys = '你是 Nano，一个可以自然聊天的 AI 助手，同时非常擅长图像生成与画风分析。' +
        '聊天时像朋友一样自然、简洁、有温度，不要端着，也不要编造自己看不到图片。' +
        '用户发图片时，认真观察画面，说明画风、构图、光影、色彩、材质与氛围，并给出可以直接用于生图的提示词。' +
        '如果用户只是闲聊，就正常聊天，不要强行转成生图。';
      if (state.useBasePrompt && String(state.basePositive || '').trim()) {
        sys += '\n用户常用的生图风格偏好：' + String(state.basePositive).trim();
        if (String(state.baseNegative || '').trim()) sys += '\n需要避免：' + String(state.baseNegative).trim();
      }
      var messages = [{ role: 'system', content: sys }].concat(chatHistory(list.slice(0, idx + 1)));
      var resp = await fetch(cfg.url + '/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + cfg.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: cfg.model, messages: messages, temperature: 0.85, max_tokens: 1400, stream: false })
      });
      if (!resp.ok) {
        var msg = 'HTTP ' + resp.status;
        try {
          var d = await resp.json();
          msg = (d.error && d.error.message) || d.message || msg;
        } catch (e) {}
        throw new Error(msg);
      }
      var data = await resp.json();
      var out = data && data.choices && data.choices[0] && data.choices[0].message;
      var reply = messageText(out && out.content).trim();
      if (!reply) throw new Error('接口没有返回内容');
      ai.text = reply;
      ai.status = 'done';
      userItem.replied = true;
    } catch (err) {
      ai.status = 'error';
      ai.error = String((err && err.message) || err || '聊天失败');
      if (userItem.image) ai.error += '\n如果模型不支持图片输入，请换用支持视觉的模型。';
    } finally {
      userItem.replying = false;
      setGenerating(false);
      session.updatedAt = Date.now();
      save();
      render();
      scrollBottom();
    }
  }

  /* ---------- 渲染 ---------- */
  function currentPresetLabel() {
    if (!state.useBasePrompt) return '';
    if (state.importedApiName) return state.importedApiName === '__current__' ? 'API · 当前提示词' : 'API · ' + state.importedApiName;
    var hit = state.presets.find(function (p) { return p.id === state.basePresetId; });
    return hit ? hit.name : '';
  }
  function renderChips() {
    var box = $('niChips'); if (!box) return;
    var label = currentPresetLabel();
    box.innerHTML =
      '<span class="ni-chip ' + (state.useBasePrompt ? 'on' : '') + '"><i></i>提示词 ' + (state.useBasePrompt ? '开' : '关') + (label ? ' · ' + esc(label) : '') + '</span>' +
      (pendingImage ? '<span class="ni-chip on"><i></i>图片已添加</span>' : '');
  }

  function renderMode() {
    var input = $('niPrompt');
    if (input) input.placeholder = '和 Nano 聊天，或直接说「画一张雨夜东京街头的照片」…';
    syncSendButton();
    var empty = $('niEmpty');
    if (empty) {
      var b = empty.querySelector('b');
      if (b) b.textContent = '和 Nano 聊天，或直接说「画一张…」';
    }
  }

  function render() {
    var session = currentSession();
    var nameEl = $('niSessionName');
    if (nameEl) nameEl.textContent = session.name || '生图窗口';
    var subEl = $('niSub');
    if (subEl) {
      var pics = session.items.filter(function (x) { return x && x.role === 'ai' && x.kind !== 'chat' && x.status === 'done'; }).length;
      var chats = session.items.filter(function (x) { return x && x.role === 'ai' && x.kind === 'chat' && x.status === 'done'; }).length;
      subEl.textContent = pics + ' 张图片 · ' + chats + ' 条回复 · ' + (state.sessions.length) + ' 个窗口';
    }
    renderChips();
    renderMode();
    renderFeed();
    renderSessionList();
    var sizeSel = $('niSize');
    if (sizeSel) sizeSel.value = state.size || '768x1344';
  }

  function renderFeed() {
    var feed = $('niFeed');
    var empty = $('niEmpty');
    if (!feed) return;
    var session = currentSession();
    var items = session.items || [];
    if (!items.length) {
      feed.innerHTML = '';
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';
    feed.innerHTML = items.map(function (item) {
      if (!item) return '';
      var quoteHtml = item.quote ? ('<div class="ni-quote-inline"><b>' + esc(item.quote.who || '消息') + '</b>' + esc(item.quote.text || '') + '</div>') : '';
      if (item.role === 'user') {
        return '<div class="ni-item user" data-msg-id="' + esc(item.id) + '" data-msg-role="user"><div class="ni-user-bubble">' +
          quoteHtml +
          (item.image ? '<img class="ni-bubble-img" src="' + esc(item.image) + '" alt="" title="查看大图">' : '') +
          esc(item.text || '') + '</div></div>';
      }
      if (item.role !== 'ai') return '';
      if (item.kind === 'chat') {
        if (item.status === 'loading') {
          return '<div class="ni-item ai"><div class="ni-chat-bubble"><span class="ni-chat-loading"><i></i><i></i><i></i>思考中…</span></div></div>';
        }
        if (item.status === 'error') {
          return '<div class="ni-item ai" data-msg-id="' + esc(item.id) + '" data-msg-role="ai"><div class="ni-chat-bubble error">' + esc(item.error || '回复失败') + '</div></div>';
        }
        return '<div class="ni-item ai" data-msg-id="' + esc(item.id) + '" data-msg-role="ai"><div class="ni-chat-bubble">' + esc(item.text || '') + '</div></div>';
      }
      if (item.status === 'loading') {
        return '<div class="ni-item ai"><div class="ni-image-card">' +
          '<div class="ni-image-wrap"><div class="ni-image-loading"><div class="ni-spinner"></div>正在生成…</div></div>' +
          '<div class="ni-image-meta">' + esc(item.prompt || '') + '</div>' +
          '</div></div>';
      }
      if (item.status === 'error') {
        return '<div class="ni-item ai" data-msg-id="' + esc(item.id) + '" data-msg-role="ai"><div class="ni-image-card">' +
          '<div class="ni-image-meta" style="padding-top:14px;color:#ff6b6b">生成失败：' + esc(item.error || '未知错误') + '</div>' +
          '<div class="ni-image-actions">' +
            '<button type="button" class="ni-act" data-act="retry" data-id="' + esc(item.id) + '" title="重试" aria-label="重试">' + svgIcon('redo') + '</button>' +
            '<button type="button" class="ni-act danger" data-act="del" data-id="' + esc(item.id) + '" title="删除" aria-label="删除">' + svgIcon('del') + '</button>' +
          '</div>' +
          '</div></div>';
      }
      return '<div class="ni-item ai" data-msg-id="' + esc(item.id) + '" data-msg-role="ai"><div class="ni-image-card">' +
        (item.url ? '<div class="ni-image-wrap"><img src="' + esc(item.url) + '" alt="" loading="lazy" title="查看大图"></div>' : '') +
        '<div class="ni-image-meta">' + esc(item.fullPrompt || item.prompt || '') + '</div>' +
        '<div class="ni-image-actions">' +
          '<button type="button" class="ni-act" data-act="again" data-id="' + esc(item.id) + '" title="重roll" aria-label="重roll">' + svgIcon('redo') + '</button>' +
          '<button type="button" class="ni-act" data-act="download" data-id="' + esc(item.id) + '" title="下载" aria-label="下载">' + svgIcon('download') + '</button>' +
          '<button type="button" class="ni-act" data-act="quote" data-id="' + esc(item.id) + '" title="引用" aria-label="引用">' + svgIcon('quote') + '</button>' +
          '<button type="button" class="ni-act" data-act="ref" data-id="' + esc(item.id) + '" title="作为参考图" aria-label="作为参考图">' + svgIcon('ref') + '</button>' +
          '<button type="button" class="ni-act danger" data-act="del" data-id="' + esc(item.id) + '" title="删除" aria-label="删除">' + svgIcon('del') + '</button>' +
        '</div></div></div>';
    }).join('');
  }

  function renderSessionList() {
    var box = $('niSessionList'); if (!box) return;
    box.innerHTML = state.sessions.map(function (s) {
      var count = (s.items || []).filter(function (x) { return x && x.role === 'ai' && x.status === 'done'; }).length;
      return '<div class="ni-session-row' + (s.id === state.currentId ? ' active' : '') + '">' +
        '<button type="button" class="ni-session-main" data-switch="' + esc(s.id) + '">' +
          '<b>' + esc(s.name || '生图窗口') + '</b>' +
          '<small>' + count + ' 张 · ' + esc(timeLabel(s.updatedAt)) + (s.id === state.currentId ? ' · 当前' : '') + '</small>' +
        '</button>' +
        '<button type="button" class="ni-icon-btn" data-rename="' + esc(s.id) + '" aria-label="改名">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M13.5 6.5l3 3"/></svg>' +
        '</button>' +
        '<button type="button" class="ni-icon-btn" data-del-session="' + esc(s.id) + '" aria-label="删除">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
        '</button>' +
      '</div>';
    }).join('');
  }
  function timeLabel(ts) {
    var d = new Date(ts || Date.now());
    var now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
    return (d.getMonth() + 1) + '/' + d.getDate();
  }
  function scrollBottom() {
    var el = $('niScroll');
    if (!el) return;
    setTimeout(function () { el.scrollTop = el.scrollHeight; }, 60);
  }

  /* ---------- 生成 / 发送 ---------- */
  function latestPendingUserItem() {
    var list = currentSession().items || [];
    for (var i = list.length - 1; i >= 0; i--) {
      var x = list[i];
      if (x && x.role === 'user' && x.awaitingReply && !x.replying) return x;
    }
    return null;
  }

  function syncSendButton() {
    var btn = $('niGenerate');
    if (!btn) return;
    if (generating) {
      btn.disabled = true;
      btn.textContent = '处理中…';
      btn.dataset.mode = '';
      return;
    }
    var input = $('niPrompt');
    var hasContent = !!(input && String(input.value || '').trim()) || !!pendingImage;
    var pending = latestPendingUserItem();
    if (hasContent) {
      btn.disabled = false;
      btn.textContent = '发送';
      btn.dataset.mode = 'send';
    } else if (pending) {
      btn.disabled = false;
      btn.textContent = '回复';
      btn.dataset.mode = 'reply';
      btn.dataset.id = pending.id;
    } else {
      btn.disabled = true;
      btn.textContent = '发送';
      btn.dataset.mode = '';
      delete btn.dataset.id;
    }
  }

  function setGenerating(on) {
    generating = !!on;
    syncSendButton();
  }

  function detectSize(text, fallback) {
    var t = String(text || '');
    // 指令里写的比例优先于底部下拉按钮；没写才用下拉里的设置。
    if (/(?:4\s*[:：比]\s*4|1\s*[:：比]\s*1|正方形|方图|头像)/i.test(t)) return '1024x1024';
    if (/(?:9\s*[:：比]\s*16|竖屏|竖图|手机壁纸|长图|竖版)/i.test(t)) return '768x1344';
    if (/(?:16\s*[:：比]\s*9|横屏|横图|横版|宽屏|电脑壁纸|桌面壁纸)/i.test(t)) return '1344x768';
    if (/(?:3\s*[:：比]\s*4)/.test(t)) return '768x1024';
    if (/(?:4\s*[:：比]\s*3)/.test(t)) return '1024x768';
    if (/(?:2\s*[:：比]\s*3)/.test(t)) return '1024x1536';
    if (/(?:3\s*[:：比]\s*2)/.test(t)) return '1536x1024';
    return String(fallback || state.size || '768x1344');
  }

  async function generateImage(text, image, opts) {
    if (generating) return;
    if (!window.NanoImage || !NanoImage.generate) { toast('生图模块没有加载，请重开页面'); return; }
    opts = opts || {};
    var session = currentSession();
    var oldName = session.name || '';
    if (/^(绘图|生图)\s*\d*$/.test(oldName) || oldName === '新窗口' || oldName === '生图窗口') {
      session.name = text.replace(/\s+/g, ' ').slice(0, 16) || oldName;
    }
    var quote = opts.quote || null;
    if (!opts.noUser) {
      var userItem = { id: uid('it'), role: 'user', text: text, image: image || '', at: Date.now() };
      if (quote) userItem.quote = { who: String(quote.who || ''), text: String(quote.text || '') };
      session.items.push(userItem);
    }
    var ai = { id: uid('it'), role: 'ai', kind: 'image', status: 'loading', prompt: text, at: Date.now() };
    if (opts.afterId) {
      var at = -1;
      session.items.some(function (x, i) { if (x && x.id === opts.afterId) { at = i; return true; } return false; });
      if (at >= 0) session.items.splice(at + 1, 0, ai);
      else session.items.push(ai);
    } else {
      session.items.push(ai);
    }
    session.updatedAt = Date.now();
    save();
    render();
    scrollBottom();
    setGenerating(true);
    try {
      var promptText = (quote ? ('引用内容：' + quote.text + '\n') : '') + text;
      var full = await buildPrompt(promptText);
      if (image) {
        full = '参考上传图片的画风、配色、构图与光线，但不要照搬具体内容。\n' + full;
      }
      ai.fullPrompt = full;
      var size = detectSize(text, state.size);
      var url = await NanoImage.generate(full, { size: size, faceRef: image || '' });
      if (!url) throw new Error('接口没有返回图片');
      ai.url = url;
      ai.size = size;
      ai.status = 'done';
      ai.saved = false;
      try {
        if (window.NanoGallery && /^(data:image\/|https?:\/\/)/i.test(String(url))) {
          NanoGallery.add({ url: url, source: 'Nano 生图室', prompt: full, generated: true, createdAt: Date.now() });
          ai.saved = true;
        }
      } catch (e) {}
    } catch (err) {
      ai.status = 'error';
      ai.error = String((err && err.message) || err || '生成失败');
    } finally {
      setGenerating(false);
      session.updatedAt = Date.now();
      save();
      render();
      scrollBottom();
    }
  }

  function isImageRequest(text) {
    var t = String(text || '').trim();
    if (!t) return false;
    if (/^\/(?:img|draw|image|gen)\b/i.test(t)) return true;
    if (/(?:^|[\s，,。！？])(?:帮我|给我|请)?\s*(?:生成|画|绘制|出图|生图|重绘|改图)(?:一|两|几)?(?:张|幅|个)/.test(t)) return true;
    if (/(?:生成|绘制|画|出图|生图|重绘|改图|做|来|拍)(?:一|两|几)?(?:张|幅|个)?(?:图片|照片|图|画像|插画|壁纸|头像|海报|封面|画面|图像|自拍|写真)/.test(t)) return true;
    if (/(?:帮我|给我|请|能不能|可以).{0,10}(?:生成|画|绘制|做|拍|出).{0,12}(?:图片|照片|图|插画|壁纸|头像|海报|封面|画面|图像|自拍)/.test(t)) return true;
    if (/(?:^|[\s，,。！？])(?:画|来|拍|做)(?:一|两|几)?张(?:图|照片|图片)?/.test(t)) return true;
    if (/(?:要|想要|需要|给我)(?:一|两|几)?张(?:图|照片|图片|插画|壁纸|头像|海报|封面|画面)/.test(t)) return true;
    if (/(?:^|\s)(?:draw|generate|make|create)\b.{0,30}(?:image|picture|photo|art|illustration)/i.test(t)) return true;
    return false;
  }

  async function submit() {
    if (generating) return;
    var input = $('niPrompt');
    var text = input ? String(input.value || '').trim() : '';
    var image = pendingImage;
    if (!text && !image) {
      var pending = latestPendingUserItem();
      if (pending) { await replyToUserItem(pending.id); return; }
      toast('想聊点什么，或者直接说要画什么？');
      try { input.focus(); } catch (e) {}
      return;
    }
    if (!text) {
      text = '帮我看看这张图片的画风、构图、光影和配色，并给出可以复用的生图提示词。';
    }
    var quote = pendingQuote;
    if (input) input.value = '';
    try { input.style.height = 'auto'; } catch (e) {}
    setPendingImage('');
    setPendingQuote(null);
    closeSheet('niMoreSheet');
    closeMsgMenu();
    try { if (input) input.blur(); } catch (e) {}
    // 第一次点击只把消息放进气泡；输入框清空后按钮变成「回复」，再点才调用 API。
    await sendChat(text, image, quote);
    syncSendButton();
  }

  /* ---------- 窗口 ---------- */
  function newSession() {
    var n = state.sessions.length + 1;
    var s = { id: uid('ni'), name: '生图 ' + n, items: [], createdAt: Date.now(), updatedAt: Date.now() };
    state.sessions.unshift(s);
    state.currentId = s.id;
    save();
    render();
    scrollBottom();
    closeSheet('niSessionSheet');
  }
  function renameSession(id) {
    var s = state.sessions.find(function (x) { return x.id === id; });
    if (!s) return;
    var next = '';
    try { next = prompt('重命名生图窗口', s.name || '生图窗口'); } catch (e) { return; }
    if (next == null) return;
    next = String(next).replace(/\s+/g, ' ').trim().slice(0, 24);
    if (!next) { toast('名字不能为空'); return; }
    s.name = next;
    s.updatedAt = Date.now();
    save();
    render();
    toast('已改名');
  }
  function deleteSession(id) {
    var s = state.sessions.find(function (x) { return x.id === id; });
    if (!s) return;
    var ids = (s.items || []).map(function (x) { return x && x.id; });
    state.sessions = state.sessions.filter(function (x) { return x.id !== id; });
    if (!state.sessions.length) {
      state.sessions.push({ id: uid('ni'), name: '生图 1', items: [], createdAt: Date.now(), updatedAt: Date.now() });
    }
    if (!state.sessions.some(function (x) { return x.id === state.currentId; })) {
      state.currentId = state.sessions[0].id;
    }
    save();
    tombstoneItems(ids);
    render();
    toast('已删除窗口');
  }

  /* ---------- 提示词预设 ---------- */
  function renderBasePresetOptions() {
    var sel = $('niBasePreset'); if (!sel) return;
    var nanoOpts = state.presets.map(function (p) {
      return '<option value="nano:' + esc(p.id) + '">' + esc(p.name) + '</option>';
    }).join('');
    var apiOpts = '<option value="api:__current__">当前 API 提示词</option>' + apiPresetCache.map(function (n) {
      return '<option value="api:' + esc(n) + '">' + esc(n) + '</option>';
    }).join('');
    sel.innerHTML = '<option value="">自定义 / 不套预设</option>' +
      '<optgroup label="Nano 预设">' + (nanoOpts || '<option value="" disabled>还没有 Nano 预设</option>') + '</optgroup>' +
      '<optgroup label="生图 API 预设（只读导入）">' + apiOpts + '</optgroup>';
    if (state.importedApiName) {
      var apiVal = 'api:' + state.importedApiName;
      sel.value = apiVal;
      // API 预设列表是异步加载的：首次渲染找不到选项时保留 importedApiName，
      // 等 loadApiPresets 完成后再重新渲染，避免把已导入的预设清掉。
    } else if (state.basePresetId && state.presets.some(function (p) { return p.id === state.basePresetId; })) {
      sel.value = 'nano:' + state.basePresetId;
    } else {
      sel.value = '';
    }
  }
  function paintPromptFields() {
    var pos = $('niBasePositive'); if (pos) pos.value = state.basePositive || '';
    var neg = $('niBaseNegative'); if (neg) neg.value = state.baseNegative || '';
  }
  function renderBasePrompt() {
    paintPromptFields();
    var sw = $('niUseBase'); if (sw) sw.checked = state.useBasePrompt !== false;
    var st = $('niBaseState'); if (st) st.textContent = state.useBasePrompt !== false ? '开启：会拼在你每次的指令前面' : '关闭后只用你的指令';
    renderBasePresetOptions();
  }
  function saveBasePreset(asNew) {
    var pos = $('niBasePositive'); var neg = $('niBaseNegative');
    var positive = pos ? String(pos.value || '').trim() : '';
    var negative = neg ? String(neg.value || '').trim() : '';
    if (!positive && !negative) { toast('正面 / 反面提示词都是空的'); return; }
    var sel = $('niBasePreset');
    var val = sel ? sel.value : '';
    var id = (val && val.indexOf('nano:') === 0) ? val.slice(5) : state.basePresetId;
    if (asNew || !id) {
      var name = '';
      try { name = prompt('预设名称', '我的画风'); } catch (e) { return; }
      if (name == null) return;
      name = String(name).replace(/\s+/g, ' ').trim().slice(0, 24);
      if (!name) { toast('名字不能为空'); return; }
      var exist = state.presets.find(function (p) { return p.name === name; });
      if (exist) {
        exist.positive = positive; exist.negative = negative;
        state.basePresetId = exist.id;
        toast('已更新预设「' + name + '」');
      } else {
        var rec = { id: uid('pr'), name: name, positive: positive, negative: negative };
        state.presets.push(rec);
        state.basePresetId = rec.id;
        toast('已新增预设「' + name + '」');
      }
    } else {
      var hit = state.presets.find(function (p) { return p.id === id; });
      if (!hit) { toast('预设不存在'); return; }
      hit.positive = positive; hit.negative = negative;
      state.basePresetId = hit.id;
      toast('已保存到预设「' + hit.name + '」');
    }
    state.importedApiName = '';
    state.basePositive = positive;
    state.baseNegative = negative;
    save();
    renderBasePresetOptions();
    renderChips();
  }
  function deleteBasePreset() {
    var sel = $('niBasePreset');
    var val = sel ? sel.value : '';
    if (!val) { toast('先选择一个预设'); return; }
    if (val.indexOf('api:') === 0) { toast('生图 API 预设是只读的，不能在这里删除'); return; }
    var id = val.indexOf('nano:') === 0 ? val.slice(5) : val;
    var hit = state.presets.find(function (p) { return p.id === id; });
    if (!hit) return;
    if (!confirm('删除 Nano 预设「' + hit.name + '」？')) return;
    state.presets = state.presets.filter(function (p) { return p.id !== id; });
    if (state.basePresetId === id) state.basePresetId = '';
    save();
    renderBasePresetOptions();
    renderChips();
    toast('已删除预设');
  }
  async function selectBasePreset(val) {
    if (!val) {
      state.basePresetId = '';
      state.importedApiName = '';
      save();
      renderChips();
      return;
    }
    if (val.indexOf('nano:') === 0) {
      var id = val.slice(5);
      var hit = state.presets.find(function (p) { return p.id === id; });
      if (!hit) return;
      state.basePresetId = id;
      state.importedApiName = '';
      state.basePositive = hit.positive || '';
      state.baseNegative = hit.negative || '';
      paintPromptFields();
      save();
      renderChips();
      return;
    }
    if (val.indexOf('api:') === 0) {
      var name = val.slice(4);
      var cfg = await apiPromptConfig(name);
      if (!cfg.positive && !cfg.negative) { toast('这个 API 提示词预设是空的'); return; }
      state.basePositive = cfg.positive;
      state.baseNegative = cfg.negative;
      state.basePresetId = '';
      state.importedApiName = name;
      paintPromptFields();
      save();
      renderChips();
      toast('已导入 API 预设，可点「保存」存为 Nano 预设');
    }
  }

  /* ---------- 提示词文件导入 ---------- */
  function docxXmlToText(xml) {
    return String(xml || '')
      .replace(/<w:tab[^>]*\/>/gi, '\t')
      .replace(/<w:br[^>]*\/>/gi, '\n')
      .replace(/<\/w:p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  async function readDocxText(file) {
    if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持读取 docx，请另存为 txt');
    var buf = await file.arrayBuffer();
    var dv = new DataView(buf);
    var off = 0;
    while (off + 30 <= buf.byteLength) {
      if (dv.getUint32(off, true) !== 0x04034b50) break;
      var flags = dv.getUint16(off + 6, true);
      var method = dv.getUint16(off + 8, true);
      var csize = dv.getUint32(off + 18, true);
      var nlen = dv.getUint16(off + 26, true);
      var elen = dv.getUint16(off + 28, true);
      var name = new TextDecoder('utf-8').decode(new Uint8Array(buf, off + 30, nlen));
      var start = off + 30 + nlen + elen;
      var data = new Uint8Array(buf, start, csize);
      if (name === 'word/document.xml') {
        if (method === 8) {
          var stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
          data = new Uint8Array(await new Response(stream).arrayBuffer());
        }
        return docxXmlToText(new TextDecoder('utf-8').decode(data));
      }
      off = start + csize;
      if (!csize && (flags & 0x08)) {
        var p = start;
        while (p + 4 <= buf.byteLength) {
          if (dv.getUint32(p, true) === 0x04034b50) break;
          p++;
        }
        off = p;
      }
    }
    throw new Error('docx 中没有找到正文');
  }

  function readLegacyDocText(buf) {
    function score(s) {
      var m = s.match(/[\u4e00-\u9fff]/g);
      return m ? m.length : 0;
    }
    var u8 = new TextDecoder('utf-8').decode(buf).replace(/[^\x09\x0a\x0d\x20-\x7e\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, ' ');
    var u16 = new TextDecoder('utf-16le').decode(buf).replace(/[^\x09\x0a\x0d\x20-\x7e\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, ' ');
    var best = score(u16) > score(u8) ? u16 : u8;
    var out = best.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (out.length < 8) throw new Error('无法读取这个 .doc，请另存为 docx 或 txt');
    return out;
  }

  function jsonPromptSections(raw) {
    var d;
    try { d = JSON.parse(raw); } catch (e) { return null; }
    if (Array.isArray(d)) {
      var arr = d.map(function (x) { return typeof x === 'string' ? x : ''; }).filter(Boolean);
      return arr.length ? { positive: arr.join('\n'), negative: '' } : null;
    }
    if (!d || typeof d !== 'object') return null;
    var posKeys = ['positive', 'positivePrompt', '正面', '正面提示词', 'prompt', 'content'];
    var negKeys = ['negative', 'negativePrompt', '反面', '反面提示词', '负面', '负面提示词'];
    function pick(keys) {
      for (var i = 0; i < keys.length; i++) {
        var v = d[keys[i]];
        if (Array.isArray(v)) v = v.filter(Boolean).join('，');
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
      return '';
    }
    var pos = pick(posKeys);
    var neg = pick(negKeys);
    return (pos || neg) ? { positive: pos, negative: neg } : null;
  }

  function textPromptSections(text) {
    var raw = String(text || '').replace(/\r\n?/g, '\n').trim();
    if (!raw) return { positive: '', negative: '' };
    var re = /(?:^|\n)\s*(?:反面|负面|反向|negative)\s*(?:提示词|prompt)?\s*[:：]?\s*/i;
    var m = raw.match(re);
    var pos = raw;
    var neg = '';
    if (m) {
      pos = raw.slice(0, m.index);
      neg = raw.slice(m.index + m[0].length);
    }
    pos = pos.replace(/^\s*(?:正面|positive)\s*(?:提示词|prompt)?\s*[:：]?\s*/i, '').trim();
    neg = neg.replace(/^\s*(?:反面|负面|反向|negative)\s*(?:提示词|prompt)?\s*[:：]?\s*/i, '').trim();
    return { positive: pos, negative: neg };
  }

  async function readPromptSections(file) {
    var name = String(file.name || '').toLowerCase();
    if (/\.json$/.test(name)) {
      var json = jsonPromptSections(await file.text());
      if (json) return json;
      return textPromptSections(await file.text());
    }
    if (/\.docx$/.test(name)) return textPromptSections(await readDocxText(file));
    if (/\.doc$/.test(name)) return textPromptSections(readLegacyDocText(await file.arrayBuffer()));
    return textPromptSections(await file.text());
  }

  function applyPromptFields(parts) {
    var pos = String(parts.positive || '').trim();
    var neg = String(parts.negative || '').trim();
    if (!pos && !neg) { toast('文件里没有可导入的提示词'); return false; }
    var posEl = $('niBasePositive');
    var negEl = $('niBaseNegative');
    if (posEl && pos) {
      var curPos = String(posEl.value || '').trim();
      posEl.value = curPos ? (curPos + '\n\n' + pos) : pos;
    }
    if (negEl && neg) {
      var curNeg = String(negEl.value || '').trim();
      negEl.value = curNeg ? (curNeg + '\n\n' + neg) : neg;
    }
    state.basePositive = posEl ? String(posEl.value || '') : pos;
    state.baseNegative = negEl ? String(negEl.value || '') : neg;
    state.basePresetId = '';
    state.importedApiName = '';
    var sel = $('niBasePreset');
    if (sel) sel.value = '';
    save();
    renderBasePresetOptions();
    renderChips();
    return true;
  }

  async function importPromptFile(file) {
    try {
      var parts = await readPromptSections(file);
      if (applyPromptFields(parts)) toast('已导入提示词');
    } catch (err) {
      toast((err && err.message) || '导入失败');
    }
  }

  /* ---------- 弹窗 ---------- */
  function openSheet(id) { var el = $(id); if (el) el.classList.add('on'); }
  function closeSheet(id) { var el = $(id); if (el) el.classList.remove('on'); }

  function openSettingsPage() {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'openFullscreen', url: 'nano-image-settings.html', title: '生图设置', showBack: true, source: 'settings' }, '*');
        return;
      }
    } catch (e) {}
    location.href = 'nano-image-settings.html';
  }

  function openSessions() {
    openSheet('niSessionSheet');
    try { renderSessionList(); } catch (e) {}
  }

  async function readChatFile(file) {
    var name = String(file.name || '').toLowerCase();
    if (/\.docx$/.test(name)) return readDocxText(file);
    if (/\.doc$/.test(name)) return readLegacyDocText(await file.arrayBuffer());
    return file.text();
  }

  function rerollLast() {
    if (generating) { toast('正在处理，稍等一下'); return; }
    var list = currentSession().items || [];
    var idx = -1;
    var last = null;
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i] && list[i].role === 'ai') { idx = i; last = list[i]; break; }
    }
    if (!last) { toast('没有可重roll的回复'); return; }
    if (last.kind === 'chat') {
      var user = null;
      for (var j = idx - 1; j >= 0; j--) {
        if (list[j] && list[j].role === 'user') { user = list[j]; break; }
      }
      if (!user) { toast('没有找到对应的提问'); return; }
      var userText = user.text || '';
      var userImage = user.image || '';
      var userQuote = user.quote || null;
      currentSession().items = list.filter(function (x) { return x && x.id !== last.id && x.id !== user.id; });
      save();
      sendChat(userText, userImage, userQuote);
      var after = currentSession().items || [];
      for (var k = after.length - 1; k >= 0; k--) {
        if (after[k] && after[k].role === 'user') { replyToUserItem(after[k].id); break; }
      }
      return;
    }
    var ref = last.image || previousUserImage(last.id) || pendingImage;
    currentSession().items = list.filter(function (x) { return x && x.id !== last.id; });
    save();
    generateImage(last.prompt || '', ref, { noUser: true });
  }

  function clearCurrentSession() {
    var s = currentSession();
    if (!(s.items || []).length) { toast('当前窗口已经是空的'); return; }
    if (!confirm('清空当前窗口的聊天与生成记录？')) return;
    var ids = (s.items || []).map(function (x) { return x && x.id; });
    s.items = [];
    s.updatedAt = Math.max(Date.now(), (Number(s.updatedAt) || 0) + 1);
    save();
    tombstoneItems(ids);
    render();
    toast('已清空当前窗口');
  }

  var menuMsgId = '';

  function setMsgAct(id, show) {
    var el = $(id);
    if (el) el.style.display = show ? '' : 'none';
  }

  function closeMsgMenu() {
    var menu = $('niMsgSheet');
    if (menu) menu.classList.remove('on');
    menuMsgId = '';
  }

  function placeMsgMenu(anchor) {
    var menu = $('niMsgSheet');
    if (!menu) return;
    var vw = window.innerWidth || 1;
    var vh = window.innerHeight || 1;
    var pad = 8;
    var mw = menu.offsetWidth || 170;
    var mh = menu.offsetHeight || 300;
    var rect = null;
    try {
      var bubble = anchor && (anchor.querySelector('.ni-user-bubble, .ni-chat-bubble, .ni-image-card') || anchor);
      if (bubble && bubble.getBoundingClientRect) rect = bubble.getBoundingClientRect();
    } catch (e) {}
    if (!rect) rect = { left: vw / 2, right: vw / 2, width: 0, top: vh / 2, bottom: vh / 2 };
    var left = Math.round(rect.left + (rect.width || 0) / 2 - mw / 2);
    left = Math.max(pad, Math.min(vw - mw - pad, left));
    var top = rect.bottom + 8;
    if (top + mh > vh - pad) top = rect.top - mh - 8;
    top = Math.max(pad, Math.min(vh - mh - pad, top));
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }

  function openMessageMenu(id, anchor) {
    var item = findItem(id);
    if (!item || item.status === 'loading') return;
    menuMsgId = id;
    var hasText = !!String(item.text || item.fullPrompt || item.prompt || '').trim();
    var hasImage = !!(item.url || item.image);
    var isAiImage = item.role === 'ai' && item.kind !== 'chat' && item.status === 'done' && !!item.url;
    setMsgAct('niMsgCopy', hasText);
    setMsgAct('niMsgQuote', hasText || hasImage);
    setMsgAct('niMsgEdit', item.role === 'user');
    setMsgAct('niMsgFavorite', isAiImage);
    setMsgAct('niMsgReroll', item.role === 'ai' && item.status === 'done');
    setMsgAct('niMsgDownload', hasImage);
    setMsgAct('niMsgRef', hasImage);
    var menu = $('niMsgSheet');
    if (!menu) return;
    menu.classList.add('on');
    requestAnimationFrame(function () { placeMsgMenu(anchor); });
  }

  function copyMessage(id) {
    var item = findItem(id);
    if (!item) return;
    var text = String(item.text || item.fullPrompt || item.prompt || '').trim();
    if (!text) { toast('这条消息没有可复制的文字'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('已复制'); }).catch(function () { toast('复制失败'); });
    } else {
      toast('复制失败');
    }
  }

  function deleteMessage(id) {
    var item = findItem(id);
    if (!item) return;
    if (!confirm('删除这条消息？')) return;
    currentSession().items = currentSession().items.filter(function (x) { return x && x.id !== id; });
    currentSession().updatedAt = Date.now();
    save();
    // 先写轻量镜像腾出 localStorage 空间，再写删除标记，避免存储满时标记写不进去。
    tombstoneItems([id]);
    render();
  }

  function editMessage(id) {
    var item = findItem(id);
    if (!item || item.role !== 'user') { toast('只能编辑自己发的消息'); return; }
    var next = '';
    try { next = prompt('编辑消息', String(item.text || '')); } catch (e) { return; }
    if (next == null) return;
    item.text = String(next);
    currentSession().updatedAt = Date.now();
    save();
    render();
    toast('已保存');
  }

  function saveImageToGallery(id) {
    var item = findItem(id);
    if (!item || !item.url) { toast('这条消息没有图片'); return; }
    if (item.saved) { toast('已经在图库里了'); return; }
    try {
      if (!window.NanoGallery) throw new Error('no gallery');
      NanoGallery.add({ url: item.url, source: 'Nano 生图室', prompt: item.fullPrompt || item.prompt || '', generated: true, createdAt: Date.now() });
      item.saved = true;
      save();
      renderFeed();
      toast('已保存到图库');
    } catch (e) { toast('保存失败'); }
  }

  function downloadMessage(id) {
    var item = findItem(id);
    var src = item && (item.url || item.image);
    if (!src) { toast('这条消息没有图片'); return; }
    var url = String(src);
    var name = 'nano-' + Date.now() + '.png';
    function direct(u, revoke) {
      var a = document.createElement('a');
      a.href = u;
      a.download = name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (revoke) setTimeout(function () { try { URL.revokeObjectURL(u); } catch (e) {} }, 4000);
    }
    if (/^data:image\//i.test(url) || /^blob:/i.test(url)) { direct(url, /^blob:/i.test(url)); return; }
    fetch(url).then(function (r) {
      if (!r || !r.ok) throw new Error('http');
      return r.blob();
    }).then(function (blob) {
      direct(URL.createObjectURL(blob), true);
    }).catch(function () { direct(url, false); });
  }

  var ivMsgId = '';

  function openImageViewer(id) {
    var item = findItem(id);
    var src = item && (item.url || item.image);
    if (!src) return;
    ivMsgId = id;
    var viewer = $('niImageViewer');
    var img = $('niIvImg');
    if (!viewer || !img) return;
    img.src = src;
    var reroll = $('niIvReroll');
    if (reroll) reroll.style.display = (item.role === 'ai' && item.kind !== 'chat') ? 'flex' : 'none';
    viewer.classList.add('on');
  }

  function closeImageViewer() {
    var viewer = $('niImageViewer');
    if (viewer) viewer.classList.remove('on');
    ivMsgId = '';
  }

  function rerollMessage(id) {
    var list = currentSession().items || [];
    var idx = -1;
    list.some(function (x, i) { if (x && x.id === id) { idx = i; return true; } return false; });
    if (idx < 0) return;
    var item = list[idx];
    if (!item || item.role !== 'ai') { toast('这条消息不能重roll'); return; }
    var user = null;
    for (var i = idx - 1; i >= 0; i--) {
      if (list[i] && list[i].role === 'user') { user = list[i]; break; }
    }
    if (item.kind === 'image' || (item.kind !== 'chat' && (item.url || item.fullPrompt || item.size))) {
      var ref = item.image || previousUserImage(item.id) || pendingImage;
      currentSession().items = list.filter(function (x) { return x && x.id !== item.id; });
      save();
      generateImage(item.prompt || '', ref, { noUser: true });
      return;
    }
    if (!user) { toast('没有找到对应的提问'); return; }
    var quote = user.quote || null;
    var userText = user.text || '';
    var userImage = user.image || '';
    currentSession().items = list.filter(function (x) { return x && x.id !== item.id && x.id !== user.id; });
    save();
    sendChat(userText, userImage, quote);
    var after = currentSession().items || [];
    for (var j = after.length - 1; j >= 0; j--) {
      if (after[j] && after[j].role === 'user') { replyToUserItem(after[j].id); break; }
    }
  }

  /* ---------- 事件 ---------- */
  function bind() {
    // 顶栏按钮用事件委托，避免其他脚本异常导致按钮完全无响应
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('#niSessionsBtn, #niSettingsBtn') : null;
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      if (btn.id === 'niSessionsBtn') openSessions();
      else openSettingsPage();
    });

    // 窗口列表也走事件委托：关闭 / 新增 / 切换 / 改名 / 删除
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('#niSessionClose')) { closeSheet('niSessionSheet'); return; }
      if (t.closest('#niNewSession')) { newSession(); return; }
      var sw = t.closest('[data-switch]');
      if (sw) { state.currentId = sw.getAttribute('data-switch'); save(); render(); closeSheet('niSessionSheet'); scrollBottom(); return; }
      var rn = t.closest('[data-rename]');
      if (rn) { renameSession(rn.getAttribute('data-rename')); return; }
      var del = t.closest('[data-del-session]');
      if (del) { deleteSession(del.getAttribute('data-del-session')); return; }
      if (t.id === 'niSessionSheet') closeSheet('niSessionSheet');
    });

    var back = $('niBack');
    if (back) back.addEventListener('click', function () {
      if (window.parent && window.parent !== window) {
        try { window.parent.postMessage({ type: 'closeFullscreen' }, '*'); return; } catch (e) {}
      }
      try { history.back(); } catch (e) {}
    });

    var gen = $('niGenerate');
    if (gen) gen.addEventListener('click', submit);
    var input = $('niPrompt');
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
      });
      input.addEventListener('input', function () {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight || 44, 130) + 'px';
        syncSendButton();
      });
      input.addEventListener('paste', function (e) {
        var items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        for (var i = 0; i < items.length; i++) {
          if (items[i].type && items[i].type.indexOf('image/') === 0) {
            var f = items[i].getAsFile();
            if (!f) continue;
            e.preventDefault();
            compressImage(f).then(setPendingImage).catch(function (err) { toast((err && err.message) || '图片读取失败'); });
            break;
          }
        }
      });
    }

    var plusBtn = $('niPlusBtn');
    if (plusBtn) plusBtn.addEventListener('click', function () { openSheet('niMoreSheet'); });
    var sizeSelect = $('niSize');
    if (sizeSelect) sizeSelect.addEventListener('change', function () {
      state.size = String(this.value || '768x1344');
      save();
      var label = this.options[this.selectedIndex] ? this.options[this.selectedIndex].textContent : this.value;
      toast('图片比例：' + (label || this.value));
    });
    var moreSheet = $('niMoreSheet');
    if (moreSheet) {
      moreSheet.addEventListener('click', function (e) {
        if (e.target === moreSheet) closeSheet('niMoreSheet');
        var item = e.target && e.target.closest ? e.target.closest('[data-more]') : null;
        if (!item) return;
        var act = item.getAttribute('data-more');
        closeSheet('niMoreSheet');
        if (act === 'image') {
          var f = $('niImageFile'); if (f) f.click();
        } else if (act === 'file') {
          var d = $('niDocFile'); if (d) d.click();
        } else if (act === 'settings') {
          openSettingsPage();
        } else if (act === 'sessions') {
          renderSessionList(); openSheet('niSessionSheet');
        } else if (act === 'reroll') {
          rerollLast();
        } else if (act === 'clear') {
          clearCurrentSession();
        }
      });
    }
    var moreCancel = $('niMoreCancel');
    if (moreCancel) moreCancel.addEventListener('click', function () { closeSheet('niMoreSheet'); });

    var msgSheet = $('niMsgSheet');
    if (msgSheet) {
      msgSheet.addEventListener('click', function (e) {
        e.stopPropagation();
        var btn = e.target && e.target.closest ? e.target.closest('[data-msg-act]') : null;
        if (!btn) return;
        var act = btn.getAttribute('data-msg-act');
        var id = menuMsgId;
        closeMsgMenu();
        if (act === 'copy') copyMessage(id);
        else if (act === 'quote') quoteMessage(id);
        else if (act === 'edit') setTimeout(function () { editMessage(id); }, 60);
        else if (act === 'favorite') saveImageToGallery(id);
        else if (act === 'download') downloadMessage(id);
        else if (act === 'reroll') rerollMessage(id);
        else if (act === 'ref') {
          var it = findItem(id);
          var src = it && (it.url || it.image);
          if (src) { setPendingImage(src); toast('已添加为参考图'); }
        }
        else if (act === 'delete') setTimeout(function () { deleteMessage(id); }, 60);
      });
    }
    document.addEventListener('click', function (e) {
      if (!e.target || !e.target.closest || !e.target.closest('#niMsgSheet')) closeMsgMenu();
    });
    var ivViewer = $('niImageViewer');
    if (ivViewer) ivViewer.addEventListener('click', function (e) {
      if (e.target === ivViewer) closeImageViewer();
    });
    var ivClose = $('niIvClose');
    if (ivClose) ivClose.addEventListener('click', closeImageViewer);
    var ivDownload = $('niIvDownload');
    if (ivDownload) ivDownload.addEventListener('click', function () { if (ivMsgId) downloadMessage(ivMsgId); });
    var ivReroll = $('niIvReroll');
    if (ivReroll) ivReroll.addEventListener('click', function () {
      var id = ivMsgId;
      closeImageViewer();
      if (id) rerollMessage(id);
    });
    var quoteClose = $('niQuoteClose');
    if (quoteClose) quoteClose.addEventListener('click', function () { setPendingQuote(null); });

    var imageFile = $('niImageFile');
    if (imageFile) {
      imageFile.addEventListener('change', function () {
        var f = imageFile.files && imageFile.files[0];
        imageFile.value = '';
        if (!f) return;
        if (f.size > 12 * 1024 * 1024) { toast('图片不能超过 12MB'); return; }
        compressImage(f).then(setPendingImage).catch(function (err) { toast((err && err.message) || '图片读取失败'); });
      });
    }
    var docFile = $('niDocFile');
    if (docFile) {
      docFile.addEventListener('change', async function () {
        var f = docFile.files && docFile.files[0];
        docFile.value = '';
        if (!f) return;
        try {
          var text = await readChatFile(f);
          text = String(text || '').trim();
          if (!text) { toast('文件里没有可读取的文字'); return; }
          if (text.length > 20000) text = text.slice(0, 20000) + '\n\n（文件内容较长，已截断）';
          if (input) {
            var cur = String(input.value || '').trim();
            input.value = cur ? (cur + '\n\n' + text) : text;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus();
          }
          toast('已添加文件内容');
        } catch (err) {
          toast((err && err.message) || '读取文件失败');
        }
      });
    }
    var attachRemove = $('niAttachRemove');
    if (attachRemove) attachRemove.addEventListener('click', function () { setPendingImage(''); });

    var feed = $('niFeed');
    if (feed) feed.addEventListener('click', function (e) {
      if (e.target && e.target.tagName === 'IMG') {
        var imgRow = e.target.closest ? e.target.closest('[data-msg-id]') : null;
        var imgItem = imgRow ? findItem(imgRow.getAttribute('data-msg-id')) : null;
        if (imgItem && (imgItem.url || imgItem.image)) { openImageViewer(imgItem.id); return; }
      }
      var btn = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      var id = btn.getAttribute('data-id');
      var item = findItem(id);
      if (!item) return;
      if (act === 'save') {
        saveImageToGallery(id);
      } else if (act === 'download') {
        downloadMessage(id);
      } else if (act === 'quote') {
        quoteMessage(id);
      } else if (act === 'ref') {
        var refSrc = item.url || item.image;
        if (!refSrc) return;
        setPendingImage(refSrc);
        toast('已添加为参考图');
      } else if (act === 'copy-chat') {
        var text = String(item.text || '');
        if (!text) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { toast('已复制'); }).catch(function () { toast('复制失败'); });
        } else toast('复制失败');
      } else if (act === 'again') {
        generateImage(item.prompt || '', item.image || previousUserImage(id), { noUser: true });
      } else if (act === 'retry') {
        var retryRef = item.image || previousUserImage(id);
        currentSession().items = currentSession().items.filter(function (x) { return x.id !== id; });
        save();
        generateImage(item.prompt || '', retryRef, { noUser: true });
      } else if (act === 'retry-chat') {
        var list = currentSession().items;
        var idx = -1;
        list.some(function (x, i) { if (x && x.id === id) { idx = i; return true; } return false; });
        var user = null;
        for (var i = idx - 1; i >= 0; i--) {
          if (list[i] && list[i].role === 'user') { user = list[i]; break; }
        }
        if (!user) { toast('找不到对应的提问'); return; }
        var retryText = user.text || '';
        var retryImage = user.image || '';
        var retryQuote = user.quote || null;
        currentSession().items = list.filter(function (x) { return x && x.id !== id && x.id !== user.id; });
        save();
        sendChat(retryText, retryImage, retryQuote);
        var retryList = currentSession().items || [];
        for (var j = retryList.length - 1; j >= 0; j--) {
          if (retryList[j] && retryList[j].role === 'user') { replyToUserItem(retryList[j].id); break; }
        }
      } else if (act === 'del') {
        currentSession().items = currentSession().items.filter(function (x) { return x.id !== id; });
        currentSession().updatedAt = Date.now();
        save();
        tombstoneItems([id]);
        render();
      }
    });

    if (feed) {
      feed.addEventListener('dblclick', function (e) {
        if (e.target && e.target.closest && e.target.closest('button,select,a,input,textarea,[data-act],img')) return;
        var el = e.target && e.target.closest ? e.target.closest('[data-msg-id]') : null;
        if (!el) return;
        e.preventDefault();
        openMessageMenu(el.getAttribute('data-msg-id'), el);
      });
      var lastTapId = '';
      var lastTapAt = 0;
      feed.addEventListener('touchstart', function (e) {
        if (e.target && e.target.closest && e.target.closest('button,select,a,input,textarea,[data-act],img')) { lastTapId = ''; lastTapAt = 0; return; }
        var el = e.target && e.target.closest ? e.target.closest('[data-msg-id]') : null;
        if (!el) { lastTapId = ''; lastTapAt = 0; return; }
        var id = el.getAttribute('data-msg-id');
        var now = Date.now();
        if (id === lastTapId && now - lastTapAt < 340) {
          lastTapId = '';
          lastTapAt = 0;
          openMessageMenu(id, el);
        } else {
          lastTapId = id;
          lastTapAt = now;
        }
      }, { passive: true });
    }
    if (renameBtn) renameBtn.addEventListener('click', function () { renameSession(state.currentId); });

    var useBase = $('niUseBase');
    if (useBase) useBase.addEventListener('change', function () {
      state.useBasePrompt = !!this.checked;
      save(); renderBasePrompt(); renderChips();
    });
    function onPromptInput() {
      var pos = $('niBasePositive');
      var neg = $('niBaseNegative');
      state.basePositive = pos ? String(pos.value || '') : '';
      state.baseNegative = neg ? String(neg.value || '') : '';
      state.basePresetId = '';
      state.importedApiName = '';
      var sel = $('niBasePreset'); if (sel) sel.value = '';
      save();
      renderChips();
    }
    var basePositive = $('niBasePositive');
    if (basePositive) basePositive.addEventListener('input', onPromptInput);
    var baseNegative = $('niBaseNegative');
    if (baseNegative) baseNegative.addEventListener('input', onPromptInput);
    var basePreset = $('niBasePreset');
    if (basePreset) basePreset.addEventListener('change', function () { selectBasePreset(this.value); });
    var presetSave = $('niPresetSave');
    if (presetSave) presetSave.addEventListener('click', function () { saveBasePreset(true); });
    var presetUpdate = $('niPresetUpdate');
    if (presetUpdate) presetUpdate.addEventListener('click', function () { saveBasePreset(false); });
    var presetDelete = $('niPresetDelete');
    if (presetDelete) presetDelete.addEventListener('click', deleteBasePreset);

    var presetImport = $('niPresetImport');
    var promptImportFile = $('niPromptImportFile');
    if (presetImport && promptImportFile) {
      presetImport.addEventListener('click', function () { promptImportFile.click(); });
      promptImportFile.addEventListener('change', function () {
        var f = promptImportFile.files && promptImportFile.files[0];
        promptImportFile.value = '';
        if (!f) return;
        if (f.size > 8 * 1024 * 1024) { toast('文件不能超过 8MB'); return; }
        importPromptFile(f);
      });
    }

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        reloadState().then(function () {
          try { renderBasePrompt(); render(); } catch (e) {}
        });
        try { loadApiPresets(); } catch (e) {}
      }
    });
    window.addEventListener('pageshow', function () {
      reloadState().then(function () {
        try {
          renderBasePrompt();
          render();
          loadApiPresets();
          if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'setTitle', title: 'Nano 生图室' }, '*');
        } catch (e) {}
      });
    });
    window.addEventListener('storage', function (e) {
      if (!e || e.key !== KEY) return;
      reloadState().then(function () {
        try { renderBasePrompt(); render(); } catch (err) {}
      });
    });
    window.addEventListener('message', function (e) {
      if (!e || !e.data || e.data.type !== 'nanoOverlayReopen') return;
      closeSheet('niSessionSheet');
      closeSheet('niSettingsSheet');
      closeSheet('niMoreSheet');
      reloadState().then(function () {
        try { renderBasePrompt(); render(); loadApiPresets(); } catch (err) {}
      });
    });
  }

  function init() {
    // 先等 IndexedDB 里的完整记录（含图片）加载完，再绑定和渲染，避免用精简镜像覆盖它。
    hydrate().then(function () {
      bind();
      renderBasePrompt();
      var size = $('niSize'); if (size) size.value = state.size || '768x1344';
      renderMode();
      render();
      loadApiPresets().then(function () {
        try { renderBasePresetOptions(); renderChips(); } catch (e) {}
      });
      try { window.parent.postMessage({ type: 'setTitle', title: 'Nano 生图室' }, '*'); } catch (e) {}
    });
  }

  init();
})();
