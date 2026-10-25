/* nano-image-studio.js — Nano 独立绘图板块
   功能：多窗口（新建/切换/改名/删除）、基础提示词开关与预设、
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
      size: '1024x1024'
    };
  }
  function normalize(s) {
    if (!s || typeof s !== 'object') s = defaultStore();
    if (!Array.isArray(s.sessions)) s.sessions = [];
    if (!Array.isArray(s.presets)) s.presets = [];
    s.useBasePrompt = s.useBasePrompt !== false;
    // 兼容旧版单条“基础提示词”数据
    if (s.basePositive == null && s.basePrompt != null) s.basePositive = String(s.basePrompt || '');
    s.basePositive = String(s.basePositive || '');
    s.baseNegative = String(s.baseNegative || '');
    s.basePresetId = String(s.basePresetId || '');
    s.importedApiName = String(s.importedApiName || '');
    s.size = String(s.size || '1024x1024');
    s.presets.forEach(function (p) {
      if (!p) return;
      if (p.positive == null && p.content != null) p.positive = String(p.content || '');
      p.positive = String(p.positive || '');
      p.negative = String(p.negative || '');
    });
    s.sessions.forEach(function (x) {
      if (!x) return;
      if (!Array.isArray(x.items)) x.items = [];
      x.name = String(x.name || '绘图窗口');
    });
    if (!s.sessions.length) {
      s.sessions.push({ id: uid('ni'), name: '绘图 1', items: [], createdAt: Date.now(), updatedAt: Date.now() });
    }
    if (!s.currentId || !s.sessions.some(function (x) { return x.id === s.currentId; })) {
      s.currentId = s.sessions[0].id;
    }
    return s;
  }
  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) {}
    var s = null;
    try { s = raw ? JSON.parse(raw) : null; } catch (e) { s = null; }
    return normalize(s);
  }
  var state = load();
  var generating = false;

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
    catch (e) {
      toast('保存失败：本地存储空间不足，可先删除旧图片');
      return false;
    }
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
          ? ('已同步 ' + apiPresetCache.length + ' 个生图 API 提示词预设。选择后会复制到上面的正面 / 反面，生成时还会读取 API 最新内容；在 Nano 里修改不会影响 API 预设。当前 API 提示词：正面 ' + pos + ' 条 / 反面 ' + neg + ' 条。')
          : ('生图 API 里还没有提示词预设。上面的正面 / 反面只保存在 Nano 绘图，不会影响其他生图。');
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
      '<span class="ni-chip ' + (state.useBasePrompt ? 'on' : '') + '"><i></i>Nano 提示词 ' + (state.useBasePrompt ? '开' : '关') + (label ? ' · ' + esc(label) : '') + '</span>' +
      '<span class="ni-chip"><i></i>' + esc(state.size || '1024x1024') + '</span>';
  }

  function render() {
    var session = currentSession();
    var nameEl = $('niSessionName');
    if (nameEl) nameEl.textContent = session.name || '绘图窗口';
    var subEl = $('niSub');
    if (subEl) subEl.textContent = session.items.filter(function (x) { return x && x.role === 'ai' && x.status === 'done'; }).length + ' 张图片 · ' + (state.sessions.length) + ' 个窗口';
    renderChips();
    renderFeed();
    renderSessionList();
    var sizeSel = $('niSize');
    if (sizeSel) sizeSel.value = state.size || '1024x1024';
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
      if (item.role === 'user') {
        return '<div class="ni-item user"><div class="ni-user-bubble">' + esc(item.text || '') + '</div></div>';
      }
      if (item.role !== 'ai') return '';
      if (item.status === 'loading') {
        return '<div class="ni-item ai"><div class="ni-image-card">' +
          '<div class="ni-image-wrap"><div class="ni-image-loading"><div class="ni-spinner"></div>正在生成…</div></div>' +
          '<div class="ni-image-meta">' + esc(item.prompt || '') + '</div>' +
          '</div></div>';
      }
      if (item.status === 'error') {
        return '<div class="ni-item ai"><div class="ni-image-card">' +
          '<div class="ni-image-meta" style="padding-top:14px;color:#ff6b6b">生成失败：' + esc(item.error || '未知错误') + '</div>' +
          '<div class="ni-image-actions"><button data-act="retry" data-id="' + esc(item.id) + '" class="accent">重试</button>' +
          '<button data-act="del" data-id="' + esc(item.id) + '" class="danger">删除</button></div>' +
          '</div></div>';
      }
      return '<div class="ni-item ai"><div class="ni-image-card">' +
        (item.url ? '<div class="ni-image-wrap"><img src="' + esc(item.url) + '" alt="" loading="lazy"></div>' : '') +
        '<div class="ni-image-meta">' + esc(item.fullPrompt || item.prompt || '') + '</div>' +
        '<div class="ni-image-actions">' +
          '<button data-act="save" data-id="' + esc(item.id) + '" class="' + (item.saved ? '' : 'accent') + '">' + (item.saved ? '已存图库' : '保存到图库') + '</button>' +
          '<button data-act="again" data-id="' + esc(item.id) + '">再生成</button>' +
          '<button data-act="del" data-id="' + esc(item.id) + '" class="danger">删除</button>' +
        '</div></div></div>';
    }).join('');
  }

  function renderSessionList() {
    var box = $('niSessionList'); if (!box) return;
    box.innerHTML = state.sessions.map(function (s) {
      var count = (s.items || []).filter(function (x) { return x && x.role === 'ai' && x.status === 'done'; }).length;
      return '<div class="ni-session-row' + (s.id === state.currentId ? ' active' : '') + '">' +
        '<button type="button" class="ni-session-main" data-switch="' + esc(s.id) + '">' +
          '<b>' + esc(s.name || '绘图窗口') + '</b>' +
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

  /* ---------- 生成 ---------- */
  function setGenerating(on) {
    generating = !!on;
    var btn = $('niGenerate');
    if (btn) { btn.disabled = generating; btn.textContent = generating ? '生成中…' : '生成'; }
  }
  async function generate() {
    if (generating) return;
    var input = $('niPrompt');
    var text = input ? String(input.value || '').trim() : '';
    if (!text) { toast('先写一下想生成什么画面'); try { input.focus(); } catch (e) {} return; }
    if (!window.NanoImage || !NanoImage.generate) { toast('生图模块没有加载，请重开页面'); return; }

    var session = currentSession();
    var oldName = session.name || '';
    if (/^绘图\s*\d*$/.test(oldName) || oldName === '新窗口' || oldName === '绘图窗口') {
      session.name = text.replace(/\s+/g, ' ').slice(0, 16) || oldName;
    }
    session.items.push({ id: uid('it'), role: 'user', text: text, at: Date.now() });
    var ai = { id: uid('it'), role: 'ai', status: 'loading', prompt: text, at: Date.now() };
    session.items.push(ai);
    session.updatedAt = Date.now();
    save();
    render();
    scrollBottom();
    setGenerating(true);
    try {
      var full = await buildPrompt(text);
      ai.fullPrompt = full;
      var size = state.size || '1024x1024';
      var url = await NanoImage.generate(full, { size: size });
      if (!url) throw new Error('接口没有返回图片');
      ai.url = url;
      ai.size = size;
      ai.status = 'done';
      ai.saved = false;
      try {
        if (window.NanoGallery && /^(data:image\/|https?:\/\/)/i.test(String(url))) {
          NanoGallery.add({ url: url, source: 'Nano 绘图', prompt: full, createdAt: Date.now() });
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

  /* ---------- 窗口 ---------- */
  function newSession() {
    var n = state.sessions.length + 1;
    var s = { id: uid('ni'), name: '绘图 ' + n, items: [], createdAt: Date.now(), updatedAt: Date.now() };
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
    try { next = prompt('重命名绘图窗口', s.name || '绘图窗口'); } catch (e) { return; }
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
    if (!confirm('删除「' + (s.name || '绘图窗口') + '」？里面的生成记录会一起删除。')) return;
    state.sessions = state.sessions.filter(function (x) { return x.id !== id; });
    if (!state.sessions.length) {
      state.sessions.push({ id: uid('ni'), name: '绘图 1', items: [], createdAt: Date.now(), updatedAt: Date.now() });
    }
    if (!state.sessions.some(function (x) { return x.id === state.currentId; })) {
      state.currentId = state.sessions[0].id;
    }
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

  /* ---------- 弹窗 ---------- */
  function openSheet(id) { var el = $(id); if (el) el.classList.add('on'); }
  function closeSheet(id) { var el = $(id); if (el) el.classList.remove('on'); }

  /* ---------- 事件 ---------- */
  function bind() {
    var back = $('niBack');
    if (back) back.addEventListener('click', function () {
      if (window.parent && window.parent !== window) {
        try { window.parent.postMessage({ type: 'closeFullscreen' }, '*'); return; } catch (e) {}
      }
      try { history.back(); } catch (e) {}
    });

    var gen = $('niGenerate');
    if (gen) gen.addEventListener('click', generate);
    var input = $('niPrompt');
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); generate(); }
      });
      input.addEventListener('input', function () {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight || 44, 130) + 'px';
      });
    }
    var size = $('niSize');
    if (size) size.addEventListener('change', function () { state.size = this.value || '1024x1024'; save(); renderChips(); });

    var feed = $('niFeed');
    if (feed) feed.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      var id = btn.getAttribute('data-id');
      var item = findItem(id);
      if (!item) return;
      if (act === 'save') {
        if (item.saved) { toast('已经在图库里了'); return; }
        try {
          NanoGallery.add({ url: item.url, source: 'Nano 绘图', prompt: item.fullPrompt || item.prompt || '', createdAt: Date.now() });
          item.saved = true;
          save();
          renderFeed();
          toast('已保存到图库');
        } catch (err) { toast('保存失败'); }
      } else if (act === 'again') {
        if (input) { input.value = item.prompt || ''; input.dispatchEvent(new Event('input', { bubbles: true })); }
        generate();
      } else if (act === 'retry') {
        currentSession().items = currentSession().items.filter(function (x) { return x.id !== id; });
        if (input) { input.value = item.prompt || ''; input.dispatchEvent(new Event('input', { bubbles: true })); }
        save();
        generate();
      } else if (act === 'del') {
        currentSession().items = currentSession().items.filter(function (x) { return x.id !== id; });
        currentSession().updatedAt = Date.now();
        save();
        render();
      }
    });

    var renameBtn = $('niRenameBtn');
    if (renameBtn) renameBtn.addEventListener('click', function () { renameSession(state.currentId); });
    var sessionsBtn = $('niSessionsBtn');
    if (sessionsBtn) sessionsBtn.addEventListener('click', function () { renderSessionList(); openSheet('niSessionSheet'); });
    var sessionsClose = $('niSessionClose');
    if (sessionsClose) sessionsClose.addEventListener('click', function () { closeSheet('niSessionSheet'); });
    var sessionSheet = $('niSessionSheet');
    if (sessionSheet) sessionSheet.addEventListener('click', function (e) { if (e.target === sessionSheet) closeSheet('niSessionSheet'); });
    var newBtn = $('niNewSession');
    if (newBtn) newBtn.addEventListener('click', newSession);
    var sList = $('niSessionList');
    if (sList) sList.addEventListener('click', function (e) {
      var sw = e.target && e.target.closest ? e.target.closest('[data-switch]') : null;
      if (sw) { state.currentId = sw.getAttribute('data-switch'); save(); render(); closeSheet('niSessionSheet'); scrollBottom(); return; }
      var rn = e.target && e.target.closest ? e.target.closest('[data-rename]') : null;
      if (rn) { renameSession(rn.getAttribute('data-rename')); return; }
      var del = e.target && e.target.closest ? e.target.closest('[data-del-session]') : null;
      if (del) { deleteSession(del.getAttribute('data-del-session')); return; }
    });

    var settingsBtn = $('niSettingsBtn');
    if (settingsBtn) settingsBtn.addEventListener('click', function () { renderBasePrompt(); openSheet('niSettingsSheet'); });
    var settingsClose = $('niSettingsClose');
    if (settingsClose) settingsClose.addEventListener('click', function () { closeSheet('niSettingsSheet'); });
    var settingsDone = $('niSettingsDone');
    if (settingsDone) settingsDone.addEventListener('click', function () { closeSheet('niSettingsSheet'); renderChips(); });
    var settingsSheet = $('niSettingsSheet');
    if (settingsSheet) settingsSheet.addEventListener('click', function (e) { if (e.target === settingsSheet) closeSheet('niSettingsSheet'); });

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

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        try { renderChips(); } catch (e) {}
        try { loadApiPresets(); } catch (e) {}
      }
    });
    window.addEventListener('pageshow', function () { try { loadApiPresets(); } catch (e) {} });
    window.addEventListener('message', function (e) {
      if (!e || !e.data || e.data.type !== 'nanoOverlayReopen') return;
      closeSheet('niSessionSheet');
      closeSheet('niSettingsSheet');
      try { render(); loadApiPresets(); } catch (err) {}
    });
  }

  function init() {
    bind();
    renderBasePrompt();
    var size = $('niSize'); if (size) size.value = state.size || '1024x1024';
    render();
    loadApiPresets().then(function () {
      try { renderBasePresetOptions(); renderChips(); } catch (e) {}
    });
    try { window.parent.postMessage({ type: 'setTitle', title: 'Nano 绘图' }, '*'); } catch (e) {}
  }

  init();
})();
