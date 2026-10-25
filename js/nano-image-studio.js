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
      mode: 'image'
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
  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) {}
    var s = null;
    try { s = raw ? JSON.parse(raw) : null; } catch (e) { s = null; }
    return normalize(s);
  }
  var state = load();
  var generating = false;
  var pendingImage = '';

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
  }

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

  function chatHistory() {
    var items = currentSession().items || [];
    var kept = items.filter(function (x) {
      if (!x) return false;
      if (x.role === 'user') return true;
      if (x.role === 'ai' && x.kind === 'chat' && x.status === 'done') return true;
      if (x.role === 'ai' && x.kind !== 'chat' && x.status === 'done') return true;
      return false;
    }).slice(-14);
    return kept.map(function (x) {
      if (x.role === 'user') {
        if (x.image) {
          return {
            role: 'user',
            content: [
              { type: 'text', text: String(x.text || '请描述这张图片') },
              { type: 'image_url', image_url: { url: x.image } }
            ]
          };
        }
        return { role: 'user', content: String(x.text || '') };
      }
      if (x.kind === 'chat') return { role: 'assistant', content: String(x.text || '') };
      return { role: 'assistant', content: '[已生成图片] ' + String(x.fullPrompt || x.prompt || '') };
    });
  }

  async function sendChat(text, image) {
    if (generating) return;
    var session = currentSession();
    var userItem = { id: uid('it'), role: 'user', text: text, image: image || '', at: Date.now() };
    session.items.push(userItem);
    var ai = { id: uid('it'), role: 'ai', kind: 'chat', status: 'loading', at: Date.now() };
    session.items.push(ai);
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
      var messages = [{ role: 'system', content: sys }].concat(chatHistory());
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
    } catch (err) {
      ai.status = 'error';
      ai.error = String((err && err.message) || err || '聊天失败');
      if (image) ai.error += '\n如果模型不支持图片输入，请换用支持视觉的模型。';
    } finally {
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
    var gen = $('niGenerate');
    if (gen && !generating) gen.textContent = '发送';
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
        return '<div class="ni-item user" data-msg-id="' + esc(item.id) + '" data-msg-role="user"><div class="ni-user-bubble">' +
          (item.image ? '<img class="ni-bubble-img" src="' + esc(item.image) + '" alt="">' : '') +
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
          '<button data-act="ref" data-id="' + esc(item.id) + '">用作参考图</button>' +
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
  function setGenerating(on) {
    generating = !!on;
    var btn = $('niGenerate');
    if (btn) {
      btn.disabled = generating;
      btn.textContent = generating ? '发送中…' : '发送';
    }
  }

  function detectSize(text) {
    var t = String(text || '');
    if (/(?:1\s*[:：]\s*1|正方形|方图|头像)/i.test(t)) return '1024x1024';
    if (/(?:16\s*[:：]\s*9|横屏|横图|横版|宽屏|电脑壁纸|桌面壁纸)/i.test(t)) return '1344x768';
    if (/(?:3\s*[:：]\s*2|4\s*[:：]\s*3)/.test(t)) return '1536x1024';
    if (/(?:2\s*[:：]\s*3|3\s*[:：]\s*4)/.test(t)) return '1024x1536';
    if (/(?:9\s*[:：]\s*16|竖屏|竖图|手机壁纸|长图|竖版)/.test(t)) return '768x1344';
    return '768x1344';
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
    if (!opts.noUser) {
      session.items.push({ id: uid('it'), role: 'user', text: text, image: image || '', at: Date.now() });
    }
    var ai = { id: uid('it'), role: 'ai', kind: 'image', status: 'loading', prompt: text, at: Date.now() };
    session.items.push(ai);
    session.updatedAt = Date.now();
    save();
    render();
    scrollBottom();
    setGenerating(true);
    try {
      var full = await buildPrompt(text);
      if (image) {
        full = '参考上传图片的画风、配色、构图与光线，但不要照搬具体内容。\n' + full;
      }
      ai.fullPrompt = full;
      var size = detectSize(text);
      var url = await NanoImage.generate(full, { size: size, faceRef: image || '' });
      if (!url) throw new Error('接口没有返回图片');
      ai.url = url;
      ai.size = size;
      ai.status = 'done';
      ai.saved = false;
      try {
        if (window.NanoGallery && /^(data:image\/|https?:\/\/)/i.test(String(url))) {
          NanoGallery.add({ url: url, source: 'Nano 生图室', prompt: full, createdAt: Date.now() });
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
      toast('想聊点什么，或者直接说要画什么？');
      try { input.focus(); } catch (e) {}
      return;
    }
    if (!text) {
      text = '帮我看看这张图片的画风、构图、光影和配色，并给出可以复用的生图提示词。';
    }
    if (input) input.value = '';
    try { input.style.height = 'auto'; } catch (e) {}
    setPendingImage('');
    closeSheet('niMoreSheet');
    closeSheet('niMsgSheet');
    try { if (input) input.blur(); } catch (e) {}
    if (isImageRequest(text)) await generateImage(text, image);
    else await sendChat(text, image);
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
    state.sessions = state.sessions.filter(function (x) { return x.id !== id; });
    if (!state.sessions.length) {
      state.sessions.push({ id: uid('ni'), name: '生图 1', items: [], createdAt: Date.now(), updatedAt: Date.now() });
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
      currentSession().items = list.filter(function (x) { return x && x.id !== last.id && x.id !== user.id; });
      save();
      sendChat(user.text || '', user.image || '');
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
    s.items = [];
    s.updatedAt = Date.now();
    save();
    render();
    toast('已清空当前窗口');
  }

  var menuMsgId = '';

  function openMessageMenu(id) {
    var item = findItem(id);
    if (!item || item.status === 'loading') return;
    menuMsgId = id;
    var title = $('niMsgTitle');
    var preview = $('niMsgPreview');
    if (title) title.textContent = item.role === 'user' ? '我的消息' : 'Nano 回复';
    if (preview) preview.textContent = String(item.text || (item.image ? '图片' : '') || item.fullPrompt || item.prompt || '').trim().slice(0, 180);
    var reroll = $('niMsgReroll');
    if (reroll) reroll.style.display = item.role === 'ai' ? '' : 'none';
    openSheet('niMsgSheet');
  }

  function copyMessage(id) {
    var item = findItem(id);
    if (!item) return;
    var text = String(item.text || item.fullPrompt || item.prompt || '').trim();
    if (!text) return;
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
    render();
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
    if (!user) { toast('没有找到对应的提问'); return; }
    currentSession().items = list.filter(function (x) { return x && x.id !== item.id && x.id !== user.id; });
    save();
    sendChat(user.text || '', user.image || '');
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
        if (e.target === msgSheet) { closeSheet('niMsgSheet'); return; }
        var btn = e.target && e.target.closest ? e.target.closest('[data-msg-act]') : null;
        if (!btn) return;
        var act = btn.getAttribute('data-msg-act');
        var id = menuMsgId;
        closeSheet('niMsgSheet');
        if (act === 'copy') copyMessage(id);
        else if (act === 'reroll') rerollMessage(id);
        else if (act === 'delete') setTimeout(function () { deleteMessage(id); }, 60);
      });
    }
    var msgCancel = $('niMsgCancel');
    if (msgCancel) msgCancel.addEventListener('click', function () { closeSheet('niMsgSheet'); });

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
      var btn = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      var id = btn.getAttribute('data-id');
      var item = findItem(id);
      if (!item) return;
      if (act === 'save') {
        if (item.saved) { toast('已经在图库里了'); return; }
        try {
          NanoGallery.add({ url: item.url, source: 'Nano 生图室', prompt: item.fullPrompt || item.prompt || '', createdAt: Date.now() });
          item.saved = true;
          save();
          renderFeed();
          toast('已保存到图库');
        } catch (err) { toast('保存失败'); }
      } else if (act === 'ref') {
        if (!item.url) return;
        setPendingImage(item.url);
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
        currentSession().items = list.filter(function (x) { return x && x.id !== id && x.id !== user.id; });
        save();
        sendChat(user.text || '', user.image || '');
      } else if (act === 'del') {
        currentSession().items = currentSession().items.filter(function (x) { return x.id !== id; });
        currentSession().updatedAt = Date.now();
        save();
        render();
      }
    });

    if (feed) {
      feed.addEventListener('dblclick', function (e) {
        var el = e.target && e.target.closest ? e.target.closest('[data-msg-id]') : null;
        if (!el) return;
        e.preventDefault();
        openMessageMenu(el.getAttribute('data-msg-id'));
      });
      var lastTapId = '';
      var lastTapAt = 0;
      feed.addEventListener('touchstart', function (e) {
        var el = e.target && e.target.closest ? e.target.closest('[data-msg-id]') : null;
        if (!el) { lastTapId = ''; lastTapAt = 0; return; }
        var id = el.getAttribute('data-msg-id');
        var now = Date.now();
        if (id === lastTapId && now - lastTapAt < 340) {
          lastTapId = '';
          lastTapAt = 0;
          openMessageMenu(id);
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
        try {
          state = load();
          renderBasePrompt();
          render();
        } catch (e) {}
        try { loadApiPresets(); } catch (e) {}
      }
    });
    window.addEventListener('pageshow', function () {
      try {
        state = load();
        renderBasePrompt();
        render();
        loadApiPresets();
        if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'setTitle', title: 'Nano 生图室' }, '*');
      } catch (e) {}
    });
    window.addEventListener('message', function (e) {
      if (!e || !e.data || e.data.type !== 'nanoOverlayReopen') return;
      closeSheet('niSessionSheet');
      closeSheet('niSettingsSheet');
      closeSheet('niMoreSheet');
      try { render(); loadApiPresets(); } catch (err) {}
    });
  }

  function init() {
    bind();
    renderBasePrompt();
    var size = $('niSize'); if (size) size.value = state.size || '1024x1024';
    renderMode();
    render();
    loadApiPresets().then(function () {
      try { renderBasePresetOptions(); renderChips(); } catch (e) {}
    });
    try { window.parent.postMessage({ type: 'setTitle', title: 'Nano 生图室' }, '*'); } catch (e) {}
  }

  init();
})();
