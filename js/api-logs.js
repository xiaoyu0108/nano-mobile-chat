/* ============================================================
   api-logs.js — 全局 API 后台日志
   ------------------------------------------------------------
   只记录「API 请求」：地址、方法、状态码、耗时、错误摘要、页面。
   不记录聊天正文 / Key / Authorization；请求体只提取 model 等元信息。
   日志存在 localStorage，最多 300 条，设置页可筛选、导出、清空。
   ============================================================ */
(function () {
  'use strict';
  var VERSION = '20261023b';
  if (window.NanoApiLogs && window.NanoApiLogs.VERSION === VERSION) return;

  var KEY = 'nano_api_logs_v1';
  var MAX = 300;
  var API_RE = /\/(chat\/completions|responses|messages|generateContent|embeddings|models|images\/(generations|edits)|audio\/(speech|transcriptions)|tts|videos?\/|mcp\/proxy|market\/|link\/preview|hot(?:\?|$)|auto\/call|peek\/|schedule|subscribe|vapid|send|push)/i;
  var SKIP_RE = /\/auto\/(pending|config)|\/market\/list(?:\?|$)|\.(js|css|png|jpe?g|webp|gif|svg|woff2?|ico)(?:\?|$)/i;

  function currentUserId() {
    try { if (window.NanoUserScope && NanoUserScope.currentUserId) return NanoUserScope.currentUserId(); } catch (e) {}
    try {
      var d = JSON.parse(localStorage.getItem('nano_mask_data') || 'null');
      if (d && d.currentMaskId) return String(d.currentMaskId);
    } catch (e) {}
    return '';
  }

  function headerKind(init) {
    try {
      var h = init && init.headers;
      if (!h) return '';
      if (typeof h.get === 'function') return String(h.get('X-Nano-Kind') || '').trim().toLowerCase();
      if (Array.isArray(h)) {
        for (var i = 0; i < h.length; i++) {
          if (h[i] && String(h[i][0] || '').toLowerCase() === 'x-nano-kind') return String(h[i][1] || '').trim().toLowerCase();
        }
        return '';
      }
      for (var k in h) {
        if (String(k).toLowerCase() === 'x-nano-kind') return String(h[k] || '').trim().toLowerCase();
      }
    } catch (e) {}
    return '';
  }

  // 调用方可以用 X-Nano-App 标记自己属于哪个 App（例如 Q&A），
  // 这样在后台日志里可以按 App 筛选，而不是全部记到 index.html。
  function headerApp(init) {
    try {
      var h = init && init.headers;
      if (!h) return '';
      if (typeof h.get === 'function') return String(h.get('X-Nano-App') || '').trim().toLowerCase();
      if (Array.isArray(h)) {
        for (var i = 0; i < h.length; i++) {
          if (h[i] && String(h[i][0] || '').toLowerCase() === 'x-nano-app') return String(h[i][1] || '').trim().toLowerCase();
        }
        return '';
      }
      for (var k in h) {
        if (String(k).toLowerCase() === 'x-nano-app') return String(h[k] || '').trim().toLowerCase();
      }
    } catch (e) {}
    return '';
  }

  function kindOf(url, init) {
    var hinted = headerKind(init);
    if (hinted) return hinted;
    var u = String(url || '');
    if (/chat\/completions|responses|generateContent/i.test(u)) return 'chat';
    if (/images\/(generations|edits)/i.test(u)) return 'image';
    if (/audio\/(speech|transcriptions)|\btts\b/i.test(u)) return 'tts';
    if (/videos?\//i.test(u)) return 'video';
    if (/embeddings/i.test(u)) return 'memory';
    if (/mcp\/proxy/i.test(u)) return 'mcp';
    if (/market\//i.test(u)) return 'market';
    if (/link\/preview|\/hot(?:\?|$)/i.test(u)) return 'link';
    if (/auto\/|peek\/|schedule|subscribe|vapid|send|push/i.test(u)) return 'push';
    return 'other';
  }

  function redactUrl(url) {
    try {
      var u = new URL(String(url || ''), location.href);
      ['token', 'key', 'api_key', 'apikey', 'access_token', 'authorization', 'secret'].forEach(function (k) {
        if (u.searchParams.has(k)) u.searchParams.set(k, '***');
      });
      return u.href.slice(0, 800);
    } catch (e) {
      return String(url || '').slice(0, 800);
    }
  }

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter(Boolean) : [];
    } catch (e) { return []; }
  }

  function write(list) {
    try { localStorage.setItem(KEY, JSON.stringify((list || []).slice(0, MAX))); } catch (e) {}
  }

  function extractError(text, status) {
    var raw = String(text || '').trim();
    if (!raw) return status ? ('HTTP ' + status) : '请求失败';
    try {
      var j = JSON.parse(raw);
      var e = j && (j.error || j.err || j);
      var msg = (e && (e.message || e.msg || e.detail)) || (j && (j.message || j.detail)) || '';
      if (msg) return String(msg).slice(0, 400);
    } catch (e) {}
    return raw.replace(/\s+/g, ' ').slice(0, 400);
  }

  function bodyMeta(init) {
    var body = init && init.body;
    if (typeof body !== 'string' || body.length > 300000) return {};
    try {
      var j = JSON.parse(body);
      var m = {};
      if (j && typeof j === 'object') {
        if (j.model) m.model = String(j.model).slice(0, 80);
        if (Array.isArray(j.messages)) m.messages = j.messages.length;
        if (j.max_tokens != null) m.maxTokens = j.max_tokens;
        if (j.stream != null) m.stream = !!j.stream;
        if (typeof j.input === 'string') m.inputChars = j.input.length;
        else if (Array.isArray(j.input)) m.inputChars = j.input.length;
      }
      return m;
    } catch (e) { return {}; }
  }

  function shouldLog(url) {
    var u = String(url || '');
    if (!u || u.indexOf('data:') === 0 || u.indexOf('blob:') === 0) return false;
    if (SKIP_RE.test(u)) return false;
    return API_RE.test(u);
  }

  function add(entry) {
    if (!entry) return null;
    var e = Object.assign({
      id: 'log_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      at: Date.now(),
      page: (location.pathname || '').split('/').pop() || 'index.html',
      pageTitle: document.title || '',
      app: '',
      userId: currentUserId(),
      method: 'GET',
      url: '',
      kind: 'other',
      status: 0,
      ok: false,
      duration: 0,
      error: '',
      detail: '',
      meta: {}
    }, entry);
    e.url = redactUrl(e.url);
    var list = read();
    list.unshift(e);
    write(list);
    try { window.dispatchEvent(new CustomEvent('NANO_API_LOG', { detail: e })); } catch (x) {}
    return e;
  }

  function installFetch() {
    if (!window.fetch || window.fetch.__nanoLogged) return;
    var orig = window.fetch.bind(window);
    var wrapped = function (input, init) {
      var url = '';
      try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (e) {}
      if (!shouldLog(url)) return orig(input, init);
      var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      var meta = bodyMeta(init);
      var t0 = (window.performance && window.performance.now) ? window.performance.now() : Date.now();
      var base = { url: url, method: method, kind: kindOf(url, init), app: headerApp(init), meta: meta };
      return orig(input, init).then(function (res) {
        var dur = ((window.performance && window.performance.now) ? window.performance.now() : Date.now()) - t0;
        if (res && res.ok) {
          add(Object.assign({}, base, { status: res.status || 200, ok: true, duration: Math.round(dur) }));
        } else {
          var status = (res && res.status) || 0;
          try {
            res.clone().text().then(function (text) {
              add(Object.assign({}, base, {
                status: status,
                ok: false,
                duration: Math.round(dur),
                error: extractError(text, status),
                detail: String(text || '').slice(0, 1200)
              }));
            }).catch(function () {
              add(Object.assign({}, base, { status: status, ok: false, duration: Math.round(dur), error: 'HTTP ' + status }));
            });
          } catch (e) {
            add(Object.assign({}, base, { status: status, ok: false, duration: Math.round(dur), error: 'HTTP ' + status }));
          }
        }
        return res;
      }, function (err) {
        var dur = ((window.performance && window.performance.now) ? window.performance.now() : Date.now()) - t0;
        add(Object.assign({}, base, {
          status: 0,
          ok: false,
          duration: Math.round(dur),
          error: (err && err.message) || '网络请求失败'
        }));
        throw err;
      });
    };
    wrapped.__nanoLogged = true;
    window.fetch = wrapped;
  }

  function clear() { try { localStorage.removeItem(KEY); } catch (e) {} }
  function remove(id) { write(read().filter(function (x) { return x && x.id !== id; })); }
  function exportJson() { return JSON.stringify({ exportedAt: Date.now(), logs: read() }, null, 2); }

  installFetch();

  window.NanoApiLogs = {
    VERSION: VERSION,
    KEY: KEY,
    MAX: MAX,
    read: read,
    add: add,
    clear: clear,
    remove: remove,
    exportJson: exportJson,
    kindOf: kindOf,
    extractError: extractError
  };
})();
