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
  function sessionDeletedMap(sess) {
    if (!sess) return {};
    if (!sess.deletedIds || typeof sess.deletedIds !== 'object' || Array.isArray(sess.deletedIds)) sess.deletedIds = {};
    return sess.deletedIds;
  }
  function mergeDeletedMaps(target, source) {
    target = (target && typeof target === 'object' && !Array.isArray(target)) ? target : {};
    if (source && typeof source === 'object' && !Array.isArray(source)) {
      Object.keys(source).forEach(function (k) {
        if (k && (!target[k] || Number(source[k]) > Number(target[k]))) target[k] = source[k];
      });
    }
    return target;
  }
  function collectDeleted(s) {
    var map = readTombstones();
    if (s && s.deleted && typeof s.deleted === 'object') mergeDeletedMaps(map, s.deleted);
    ((s && s.sessions) || []).forEach(function (sess) {
      if (sess && sess.deletedIds) mergeDeletedMaps(map, sess.deletedIds);
    });
    return map;
  }
  function persistTombstones(map) {
    if (!idbReady()) return;
    try { window.NanoIDB.set(TOMB_KEY, map || {}).catch(function () {}); } catch (e) {}
  }
  function tombstoneItems(ids) {
    var map = readTombstones();
    var now = Date.now();
    var added = {};
    (ids || []).forEach(function (id) { if (id) { map[id] = now; added[id] = now; } });
    writeTombstones(map);
    // 同时把删除标记写进业务状态本身。localStorage 配额满/被清掉时，
    // 仅靠 TOMB_KEY 不够，旧快照会把删掉的消息又合并回来。
    try {
      if (state) {
        if (!state.deleted || typeof state.deleted !== 'object') state.deleted = {};
        (ids || []).forEach(function (id) { if (id) state.deleted[id] = map[id] || now; });
        var keys = Object.keys(state.deleted);
        if (keys.length > 3000) {
          keys.sort(function (a, b) { return (state.deleted[a] || 0) - (state.deleted[b] || 0); });
          keys.slice(0, keys.length - 3000).forEach(function (k) { delete state.deleted[k]; });
        }
        // 再把删除标记放进对应窗口自己的记录里。这样即使设置页/旧 IDB 快照
        // 覆盖了全局标记，窗口级标记仍会随该窗口一起保留。
        (state.sessions || []).forEach(function (sess) {
          if (!sess) return;
          var relevant = sess.id === state.currentId || (sess.items || []).some(function (it) {
            return it && added[it.id];
          });
          if (!relevant) return;
          var own = sessionDeletedMap(sess);
          Object.keys(added).forEach(function (id) { own[id] = added[id]; });
        });
      }
    } catch (e) {}
    persistTombstones(collectDeleted(state));
  }
  function applyTombstones(s) {
    if (!s) return s;
    var map = collectDeleted(s);
    s.deleted = map;
    (s.sessions || []).forEach(function (sess) {
      if (!sess) return;
      var own = mergeDeletedMaps({}, sess.deletedIds);
      (sess.items || []).forEach(function (it) { if (it && map[it.id]) own[it.id] = map[it.id]; });
      sess.deletedIds = own;
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
        // 多张参考图同样只留在 IndexedDB，localStorage 只放精简镜像。
        if (Array.isArray(i2.images) && i2.images.some(function (u) { return /^data:/i.test(String(u)); })) i2.images = [];
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
      if ((!it.images || !it.images.length) && h.images && h.images.length) it.images = h.images;
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
    var lightTotal = 0, heavyTotal = 0;
    (light.sessions || []).forEach(function (s) { lightTotal += ((s && s.items) || []).length; });
    (heavy.sessions || []).forEach(function (s) { heavyTotal += ((s && s.items) || []).length; });
    var preferLight = lt > ht || (lt === ht && localHasChanges(light, heavy));
    // 本地只剩一个空壳、IDB 里还有完整记录时，别把历史消息“隐藏”掉；
    // 真正清空/删除的条目由 tombstone 在合并后统一过滤。
    if (preferLight && lightTotal === 0 && heavyTotal > 0) preferLight = false;
    // 两边携带的删除标记都要合并，避免选了较新的 IDB 副本后丢掉刚删除的 id。
    var mergedDeleted = {};
    if (heavy.deleted && typeof heavy.deleted === 'object') Object.keys(heavy.deleted).forEach(function (k) { mergedDeleted[k] = heavy.deleted[k]; });
    if (light.deleted && typeof light.deleted === 'object') Object.keys(light.deleted).forEach(function (k) {
      if (!mergedDeleted[k] || Number(light.deleted[k]) > Number(mergedDeleted[k])) mergedDeleted[k] = light.deleted[k];
    });
    (heavy.sessions || []).forEach(function (hs) { if (hs && hs.deletedIds) mergeDeletedMaps(mergedDeleted, hs.deletedIds); });
    (light.sessions || []).forEach(function (ls) { if (ls && ls.deletedIds) mergeDeletedMaps(mergedDeleted, ls.deletedIds); });
    // 本地更新，或同级但确实清空/改过窗口时，以本地为准；避免 IDB 旧记录顶掉刚清空的聊天。
    if (preferLight) {
      light.deleted = mergedDeleted;
      var heavyById = {};
      (heavy.sessions || []).forEach(function (hs) { if (hs && hs.id) heavyById[hs.id] = hs; });
      (light.sessions || []).forEach(function (ls) {
        var hs = ls && ls.id ? heavyById[ls.id] : null;
        if (hs) {
          ls.deletedIds = mergeDeletedMaps(mergeDeletedMaps({}, hs.deletedIds), ls.deletedIds);
          fillHeavyMedia(ls, hs);
        }
      });
      return normalize(light);
    }
    // IDB 更新时，仍尊重本地刚清空/刚改过的那一个窗口。
    var lightById = {};
    (light.sessions || []).forEach(function (ls) { if (ls && ls.id) lightById[ls.id] = ls; });
    var merged = [];
    (heavy.sessions || []).forEach(function (hs) {
      var ls = hs && hs.id ? lightById[hs.id] : null;
      var lsEmpty = ls && !((ls.items || []).length);
      var hsHasItems = !!((hs.items || []).length);
      if (ls && (Number(ls.updatedAt) || 0) >= (Number(hs.updatedAt) || 0) && !(lsEmpty && hsHasItems)) {
        ls.deletedIds = mergeDeletedMaps(mergeDeletedMaps({}, hs.deletedIds), ls.deletedIds);
        fillHeavyMedia(ls, hs);
        merged.push(ls);
      } else {
        hs.deletedIds = mergeDeletedMaps(mergeDeletedMaps({}, ls && ls.deletedIds), hs.deletedIds);
        merged.push(hs);
      }
    });
    (light.sessions || []).forEach(function (ls) {
      if (ls && ls.id && (ls.items || []).length && !(heavy.sessions || []).some(function (hs) { return hs && hs.id === ls.id; })) merged.push(ls);
    });
    heavy.sessions = merged;
    heavy.deleted = mergedDeleted;
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
        ss.deletedIds = mergeDeletedMaps(mergeDeletedMaps({}, ms && ms.deletedIds), ss.deletedIds);
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
  function mergeIdbTombstones(tomb) {
    if (!tomb || typeof tomb !== 'object') return;
    var cur = readTombstones();
    mergeDeletedMaps(cur, tomb);
    writeTombstones(cur);
  }
  function hydrate() {
    return new Promise(function (resolve) {
      if (!idbReady()) { hydrated = true; resolve(); return; }
      Promise.all([window.NanoIDB.get(KEY), window.NanoIDB.get(TOMB_KEY)]).then(function (rows) {
        var heavy = rows[0];
        mergeIdbTombstones(rows[1]);
        var local = state; // 启动时已经读过 localStorage，不再重复解析大 JSON
        state = applyTombstones(heavy ? mergeHeavyLight(heavy, local) : local);
        hydrated = true;
        if (!heavy || (Number(local.savedAt) || 0) >= (Number(heavy.savedAt) || 0)) {
          try { window.NanoIDB.set(KEY, state); } catch (e) {}
        }
        persistTombstones(state.deleted || {});
        writeLocal(state);
        resolve();
      }).catch(function () { hydrated = true; resolve(); });
    });
  }
  function reloadState() {
    // 正在出图时不要用 IndexedDB 快照替换内存状态：否则新插入的 loading 项
    // 和生成结果可能被旧快照顶掉，表现成“退出又回来图没了 / 删掉的消息复活”。
    if (generating) return Promise.resolve();
    return saveChain.catch(function () {}).then(function () {
      if (!idbReady()) return;
      return Promise.all([window.NanoIDB.get(KEY), window.NanoIDB.get(TOMB_KEY)]).then(function (rows) {
        mergeIdbTombstones(rows[1]);
        // 以当前内存状态为准，只接受 localStorage/IDB 里确实更新的窗口。
        // 这样删除/新消息刚发生时，不会被旧记录顶掉；设置页清空后也能正确同步回来。
        var memory = mergeStoredIntoMemory(state, loadLocal());
        state = applyTombstones(rows[0] ? mergeHeavyLight(rows[0], memory) : memory);
        persistTombstones(state.deleted || {});
      }).catch(function () {});
    });
  }
  var state = loadLocal();
  var generating = false;
  var submitLock = false;
  var pendingImages = [];
  var MAX_PENDING_IMAGES = 9;
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

  function renderPendingImages() {
    var box = $('niAttachPreview');
    if (!box) return;
    box.hidden = !pendingImages.length;
    box.innerHTML = pendingImages.map(function (src, i) {
      return '<span class="ni-attach-item">' +
        '<img src="' + esc(src) + '" alt="参考图 ' + (i + 1) + '">' +
        '<button type="button" class="ni-attach-remove" data-remove-img="' + i + '" aria-label="移除图片">×</button>' +
        '</span>';
    }).join('');
    renderChips();
    syncSendButton();
  }

  function addPendingImages(list) {
    (list || []).forEach(function (src) {
      src = String(src || '');
      if (!src) return;
      if (pendingImages.length >= MAX_PENDING_IMAGES) return;
      if (pendingImages.indexOf(src) >= 0) return;
      pendingImages.push(src);
    });
    renderPendingImages();
    if ((list || []).length && pendingImages.length >= MAX_PENDING_IMAGES) toast('最多同时参考 ' + MAX_PENDING_IMAGES + ' 张图片');
  }

  function setPendingImage(dataUrl) {
    pendingImages = dataUrl ? [String(dataUrl)] : [];
    renderPendingImages();
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
    if (!text && (item.url || item.image || (item.images && item.images.length))) text = '一张图片';
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
        return window.NanoIDB.set(TOMB_KEY, state.deleted || {});
      }).then(function () {
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
  function previousUserImages(id) {
    var list = currentSession().items || [];
    var idx = -1;
    list.some(function (x, i) { if (x && x.id === id) { idx = i; return true; } return false; });
    for (var i = idx - 1; i >= 0; i--) {
      var it = list[i];
      if (!it || it.role !== 'user') continue;
      if (it.images && it.images.length) return it.images.slice();
      if (it.image) return [it.image];
    }
    return [];
  }
  function previousUserImage(id) {
    var imgs = previousUserImages(id);
    return imgs[0] || '';
  }
  function refsForImageItem(item) {
    if (item && Array.isArray(item.refImages) && item.refImages.length) return item.refImages.slice();
    if (item && item.image) return [item.image];
    if (item && item.id) {
      var prev = previousUserImages(item.id);
      if (prev.length) return prev;
    }
    return pendingImages.slice();
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
    var images = Array.isArray(image) ? image.filter(Boolean) : (image ? [image] : []);
    var userItem = { id: uid('it'), role: 'user', text: text, image: images[0] || '', images: images, at: Date.now(), awaitingReply: true };
    if (quote) userItem.quote = { who: String(quote.who || ''), text: String(quote.text || '') };
    session.items.push(userItem);
    session.updatedAt = Date.now();
    save();
    render();
    scrollBottom();
    return userItem;
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

    // 生图室只负责生图：任何消息都直接生成图片，不再走文本聊天。
    session.updatedAt = Date.now();
    save();
    render();
    scrollBottom();
    try {
      await generateImage(userItem.text || '', userItem.images || userItem.image || '', {
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
      (pendingImages.length ? '<span class="ni-chip on"><i></i>参考图 ' + pendingImages.length + ' 张</span>' : '');
  }

  function renderMode() {
    var input = $('niPrompt');
    if (input) input.placeholder = '描述想生成的图片；发送后清空输入框，再点「回复」开始生成';
    syncSendButton();
    var empty = $('niEmpty');
    if (empty) {
      var b = empty.querySelector('b');
      if (b) b.textContent = '先描述想画什么，发送后点「回复」生成';
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
        var userImgs = (item.images && item.images.length) ? item.images : (item.image ? [item.image] : []);
        var userImgsHtml = userImgs.length
          ? '<div class="ni-user-imgs' + (userImgs.length > 1 ? ' multi' : '') + '">' + userImgs.map(function (src) {
              return '<img class="ni-bubble-img" src="' + esc(src) + '" alt="" title="查看大图" data-img-src="' + esc(src) + '">';
            }).join('') + '</div>'
          : '';
        return '<div class="ni-item user" data-msg-id="' + esc(item.id) + '" data-msg-role="user"><div class="ni-user-bubble">' +
          quoteHtml + userImgsHtml + esc(item.text || '') + '</div></div>';
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
    var hasContent = !!(input && String(input.value || '').trim()) || pendingImages.length > 0;
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

  function notifyImageBusy(on) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'nanoImageBusy',
          id: 'nano-image',
          busy: !!on,
          ttl: 20 * 60 * 1000
        }, '*');
      }
    } catch (e) {}
  }

  function setGenerating(on) {
    generating = !!on;
    notifyImageBusy(generating);
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

  // 普通生图也要参照最近几轮生图上下文，保持人物、服装和场景连续，而不是每次从零画。
  function recentStudioContext(excludeText) {
    var arr = [];
    var items = currentSession().items || [];
    var ex = String(excludeText || '').trim();
    for (var i = items.length - 1; i >= 0 && arr.length < 4; i--) {
      var it = items[i];
      if (!it || it.status === 'loading') continue;
      var t = String(it.text || it.fullPrompt || it.prompt || '').trim();
      if (!t || (ex && t === ex)) continue;
      arr.push((it.role === 'user' ? '用户' : '你') + '：' + t.replace(/\s+/g, ' ').slice(0, 180));
    }
    return arr.reverse().join('\n');
  }

  async function generateImage(text, image, opts) {
    if (generating) return;
    if (!window.NanoImage || !NanoImage.generate) { toast('生图模块没有加载，请重开页面'); return; }
    opts = opts || {};
    var images = Array.isArray(image) ? image.filter(Boolean) : (image ? [image] : []);
    var session = currentSession();
    var oldName = session.name || '';
    if (/^(绘图|生图)\s*\d*$/.test(oldName) || oldName === '新窗口' || oldName === '生图窗口') {
      session.name = text.replace(/\s+/g, ' ').slice(0, 16) || oldName;
    }
    var quote = opts.quote || null;
    if (!opts.noUser) {
      var userItem = { id: uid('it'), role: 'user', text: text, image: images[0] || '', images: images, at: Date.now() };
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
      var ctx = recentStudioContext(text);
      var promptText = (ctx ? ('【最近生图上下文，用于保持人物/场景一致】\n' + ctx + '\n') : '')
        + (quote ? ('引用内容：' + quote.text + '\n') : '') + text;
      var full = await buildPrompt(promptText);
      if (images.length) {
        full = (images.length > 1 ? ('参考上传的 ' + images.length + ' 张图片的画风、配色、构图与光线，并保持其中的人物一致。') : '参考上传图片的画风、配色、构图与光线，但不要照搬具体内容。') + '\n' + full;
      }
      ai.fullPrompt = full;
      var size = detectSize(text, state.size);
      var url = await NanoImage.generate(full, { size: size, faceRef: images[0] || '', faceRefs: images });
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
    // 「帮我画一张」「画个女孩」「生成一张夜景」这类最常见，之前的规则会漏掉而走成聊天。
    if (/(?:帮我|给我|请|麻烦|能不能|可以|我想|我要|想要|想看|要)\s*.{0,10}(?:生成|绘制|画|出图|生图|重绘|改图|做|拍|来).{0,24}(?:图片|照片|图|画像|插画|壁纸|头像|海报|封面|画面|图像|自拍|写真|场景|人物|角色|女孩|男孩|猫|狗|动漫)/.test(t)) return true;
    if (/^(?:帮我|给我|请|麻烦|我想要|我要)?\s*(?:生成|绘制|画|出图|生图|重绘|改图|做|拍|来)\s*(?:一|两|几)?\s*(?:张|幅|个|只|位|下)/.test(t)) return true;
    if (/(?:^|[\s，,。！？])(?:帮我|给我|请)?\s*(?:生成|画|绘制|出图|生图|重绘|改图)(?:一|两|几)?(?:张|幅|个)/.test(t)) return true;
    if (/(?:生成|绘制|画|出图|生图|重绘|改图|做|来|拍)(?:一|两|几)?(?:张|幅|个)?(?:图片|照片|图|画像|插画|壁纸|头像|海报|封面|画面|图像|自拍|写真)/.test(t)) return true;
    if (/(?:帮我|给我|请|能不能|可以).{0,10}(?:生成|画|绘制|做|拍|出).{0,12}(?:图片|照片|图|插画|壁纸|头像|海报|封面|画面|图像|自拍)/.test(t)) return true;
    if (/(?:要|想要|需要|给我)(?:一|两|几)?张(?:图|照片|图片|插画|壁纸|头像|海报|封面|画面)/.test(t)) return true;
    if (/(?:^|\s)(?:draw|generate|make|create)\b.{0,30}(?:image|picture|photo|art|illustration)/i.test(t)) return true;
    return false;
  }

  async function submit() {
    if (generating || submitLock) return;
    submitLock = true;
    try {
      var input = $('niPrompt');
      var text = input ? String(input.value || '').trim() : '';
      var images = pendingImages.slice();
      if (!text && !images.length) {
        var pending = latestPendingUserItem();
        if (pending) { await replyToUserItem(pending.id); return; }
        toast('想画什么？直接描述画面，或先添加参考图');
        try { input.focus(); } catch (e) {}
        return;
      }
      if (!text) {
        text = images.length > 1
          ? '参考这些照片里的人物、画风与氛围，生成一张新的图片。'
          : '参考这张照片里的人物、画风与氛围，生成一张新的图片。';
      }
      var quote = pendingQuote;
      if (input) input.value = '';
      try { input.style.height = 'auto'; } catch (e) {}
      setPendingImage('');
      setPendingQuote(null);
      closeSheet('niMoreSheet');
      closeMsgMenu();
      try { if (input) input.blur(); } catch (e) {}
      // 发送只落气泡，不直接调用生图 API。
      // 等输入框清空、按钮变成「回复」后，用户再点一次才生成。
      await sendChat(text, images, quote);
    } finally {
      submitLock = false;
      syncSendButton();
    }
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
    tombstoneItems(ids);
    save();
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
      var userImage = (user.images && user.images.length) ? user.images : (user.image || '');
      var userQuote = user.quote || null;
      currentSession().items = list.filter(function (x) { return x && x.id !== last.id && x.id !== user.id; });
      tombstoneItems([last.id, user.id]);
      save();
      sendChat(userText, userImage, userQuote);
      var after = currentSession().items || [];
      for (var k = after.length - 1; k >= 0; k--) {
        if (after[k] && after[k].role === 'user') { replyToUserItem(after[k].id); break; }
      }
      return;
    }
    var ref = refsForImageItem(last);
    currentSession().items = list.filter(function (x) { return x && x.id !== last.id; });
    tombstoneItems([last.id]);
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
    tombstoneItems(ids);
    save();
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
    var hasImage = !!(item.url || item.image || (item.images && item.images.length));
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
    // 先记删除标记，再保存完整状态：这样即便 IndexedDB 里还有旧快照，
    // 下次合并时也会被 state.deleted 过滤掉，不会在发新消息后复活。
    tombstoneItems([id]);
    save();
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

  function isIOSDevice() {
    try {
      return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    } catch (e) { return false; }
  }
  function shareOnIOS(blob, name) {
    if (!isIOSDevice()) return false;
    try {
      if (!navigator.share) return false;
      var file = new File([blob], name, { type: blob.type || 'image/png' });
      if (navigator.canShare && !navigator.canShare({ files: [file] })) return false;
      navigator.share({ files: [file], title: name }).catch(function () {});
      return true;
    } catch (e) { return false; }
  }
  function downloadMessage(id, srcOverride) {
    var item = findItem(id);
    var src = srcOverride || (item && (item.url || item.image));
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
    // iOS：系统分享半屏面板，避免全屏下载页退不回来。
    if (isIOSDevice() && navigator.share) {
      fetch(url).then(function (r) {
        if (!r || !r.ok) throw new Error('http');
        return r.blob();
      }).then(function (blob) {
        if (!shareOnIOS(blob, name)) direct(url, false);
      }).catch(function () { direct(url, false); });
      return;
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
  var ivSrc = '';

  function openImageViewer(id, srcOverride) {
    var item = findItem(id);
    var src = srcOverride || (item && (item.url || item.image));
    if (!src) return;
    ivMsgId = id;
    ivSrc = src;
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
    ivSrc = '';
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
      var ref = refsForImageItem(item);
      currentSession().items = list.filter(function (x) { return x && x.id !== item.id; });
      tombstoneItems([item.id]);
      save();
      generateImage(item.prompt || '', ref, { noUser: true });
      return;
    }
    if (!user) { toast('没有找到对应的提问'); return; }
    var quote = user.quote || null;
    var userText = user.text || '';
    var userImage = (user.images && user.images.length) ? user.images : (user.image || '');
    currentSession().items = list.filter(function (x) { return x && x.id !== item.id && x.id !== user.id; });
    tombstoneItems([item.id, user.id]);
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
        var files = [];
        for (var i = 0; i < items.length; i++) {
          if (items[i].type && items[i].type.indexOf('image/') === 0) {
            var f = items[i].getAsFile();
            if (f) files.push(f);
          }
        }
        if (files.length) {
          e.preventDefault();
          Promise.all(files.map(function (f) {
            return compressImage(f).catch(function () { return ''; });
          })).then(function (list) { addPendingImages(list.filter(Boolean)); });
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
          if (src) { addPendingImages([src]); toast('已添加为参考图'); }
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
    if (ivDownload) ivDownload.addEventListener('click', function () { if (ivMsgId) downloadMessage(ivMsgId, ivSrc); });
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
        var files = Array.prototype.slice.call(imageFile.files || []);
        imageFile.value = '';
        if (!files.length) return;
        var room = MAX_PENDING_IMAGES - pendingImages.length;
        if (room <= 0) { toast('最多同时参考 ' + MAX_PENDING_IMAGES + ' 张图片'); return; }
        var valid = [];
        files.forEach(function (f) {
          if (!f) return;
          if (f.size > 12 * 1024 * 1024) { toast('单张图片不能超过 12MB'); return; }
          if (valid.length < room) valid.push(f);
        });
        if (!valid.length) return;
        Promise.all(valid.map(function (f) {
          return compressImage(f).catch(function () { return ''; });
        })).then(function (list) {
          addPendingImages(list.filter(Boolean));
        });
      });
    }
    var attachBox = $('niAttachPreview');
    if (attachBox) attachBox.addEventListener('click', function (e) {
      var rm = e.target && e.target.closest ? e.target.closest('[data-remove-img]') : null;
      if (!rm) return;
      var idx = Number(rm.getAttribute('data-remove-img'));
      if (idx >= 0 && idx < pendingImages.length) {
        pendingImages.splice(idx, 1);
        renderPendingImages();
      }
    });
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
    // 参考图删除由上面的 #niAttachPreview 事件委托处理。

    var feed = $('niFeed');
    if (feed) feed.addEventListener('click', function (e) {
      if (e.target && e.target.tagName === 'IMG') {
        var imgRow = e.target.closest ? e.target.closest('[data-msg-id]') : null;
        var imgItem = imgRow ? findItem(imgRow.getAttribute('data-msg-id')) : null;
        var clickedSrc = e.target.getAttribute && e.target.getAttribute('data-img-src');
        if (imgItem && (clickedSrc || imgItem.url || imgItem.image)) { openImageViewer(imgItem.id, clickedSrc || ''); return; }
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
        addPendingImages([refSrc]);
        toast('已添加为参考图');
      } else if (act === 'copy-chat') {
        var text = String(item.text || '');
        if (!text) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { toast('已复制'); }).catch(function () { toast('复制失败'); });
        } else toast('复制失败');
      } else if (act === 'again') {
        generateImage(item.prompt || '', refsForImageItem(item), { noUser: true });
      } else if (act === 'retry') {
        var retryRef = refsForImageItem(item);
        currentSession().items = currentSession().items.filter(function (x) { return x.id !== id; });
        tombstoneItems([id]);
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
        var retryImage = (user.images && user.images.length) ? user.images : (user.image || '');
        var retryQuote = user.quote || null;
        currentSession().items = list.filter(function (x) { return x && x.id !== id && x.id !== user.id; });
        tombstoneItems([id, user.id]);
        save();
        sendChat(retryText, retryImage, retryQuote);
        var retryList = currentSession().items || [];
        for (var j = retryList.length - 1; j >= 0; j--) {
          if (retryList[j] && retryList[j].role === 'user') { replyToUserItem(retryList[j].id); break; }
        }
      } else if (act === 'del') {
        currentSession().items = currentSession().items.filter(function (x) { return x.id !== id; });
        currentSession().updatedAt = Date.now();
        tombstoneItems([id]);
        save();
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
    // 从设置页 / 其它页面回到生图室时，重新读一次 IndexedDB 再渲染，避免只显示新消息。
    window.addEventListener('focus', function () {
      reloadState().then(function () {
        try { render(); } catch (e) {}
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
