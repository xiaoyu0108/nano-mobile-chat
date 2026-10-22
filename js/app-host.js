// ============================================================
// app-host.js — 运行一个「应用」，并给应用提供 Nano.* 能力
// 应用 HTML 存在 nano_appstore_db/apps，被注入到同源 iframe（srcdoc）里执行。
// ============================================================
(function () {
  'use strict';

  var DB_NAME = 'nano_appstore_db';
  var DB_VERSION = 2;
  var APP_STORE = 'apps';
  var DATA_STORE = 'appdata';

  var hostMsg = document.getElementById('hostMsg');
  var hostMsgText = document.getElementById('hostMsgText');
  var appFrame = document.getElementById('appFrame');

  var appId = '';
  try { appId = new URLSearchParams(location.search).get('id') || ''; } catch (e) { appId = ''; }

  function fail(text) {
    if (hostMsg) hostMsg.style.display = 'flex';
    if (hostMsgText) hostMsgText.textContent = text || '应用无法打开';
  }
  function hideMsg() { if (hostMsg) hostMsg.style.display = 'none'; }

  /* ---------------- IndexedDB ---------------- */
  function openDB(name, version, upgrade) {
    return new Promise(function (resolve, reject) {
      try {
        var req = version ? indexedDB.open(name, version) : indexedDB.open(name);
        req.onupgradeneeded = function (e) { try { upgrade && upgrade(e.target.result); } catch (err) {} };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      } catch (e) { reject(e); }
    });
  }
  function openStoreDB() {
    return openDB(DB_NAME, DB_VERSION, function (db) {
      if (!db.objectStoreNames.contains(APP_STORE)) db.createObjectStore(APP_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(DATA_STORE)) db.createObjectStore(DATA_STORE, { keyPath: 'key' });
    });
  }
  function idbGet(store, key) {
    return openStoreDB().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var r = db.transaction(store, 'readonly').objectStore(store).get(key);
          r.onsuccess = function () { resolve(r.result || null); db.close(); };
          r.onerror = function () { resolve(null); db.close(); };
        } catch (e) { resolve(null); }
      });
    }).catch(function () { return null; });
  }
  function idbPut(store, value) {
    return openStoreDB().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(store, 'readwrite');
          tx.objectStore(store).put(value);
          tx.oncomplete = function () { resolve(true); db.close(); };
          tx.onerror = function () { resolve(false); db.close(); };
        } catch (e) { resolve(false); }
      });
    }).catch(function () { return false; });
  }
  function idbGetAll(store) {
    return openStoreDB().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var r = db.transaction(store, 'readonly').objectStore(store).getAll();
          r.onsuccess = function () { resolve(r.result || []); db.close(); };
          r.onerror = function () { resolve([]); db.close(); };
        } catch (e) { resolve([]); }
      });
    }).catch(function () { return []; });
  }
  function idbDelete(store, key) {
    return openStoreDB().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(store, 'readwrite');
          tx.objectStore(store).delete(key);
          tx.oncomplete = function () { resolve(true); db.close(); };
          tx.onerror = function () { resolve(false); db.close(); };
        } catch (e) { resolve(false); }
      });
    }).catch(function () { return false; });
  }

  /* ---------------- 数据读取 ---------------- */
  function readJSON(key) { try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }

  function currentUser() {
    var home = readJSON('nano_mask_data') || readJSON('nano_home_data') || readJSON('peach_home_data');
    if (!home) return { id: '', name: '我', avatar: '', setting: '' };
    var masks = home.masks || [];
    var cur = masks.find(function (m) { return m && m.id === home.currentMaskId; }) || masks[0] || {};
    return { id: cur.id || '', name: cur.name || '我', avatar: cur.avatar || '', setting: cur.setting || cur.persona || '' };
  }

  function listCharacters() {
    return openDB('nano_characters_db', 1, function (db) {
      if (!db.objectStoreNames.contains('characters')) db.createObjectStore('characters', { keyPath: 'id' });
    }).then(function (db) {
      return new Promise(function (resolve) {
        try {
          var r = db.transaction('characters', 'readonly').objectStore('characters').getAll();
          r.onsuccess = function () {
            db.close();
            resolve((r.result || []).filter(function (c) { return c && !c.nanoAssistant; }).map(function (c) {
              return {
                id: c.id, name: c.name || '角色', avatar: c.avatar || '',
                gender: c.gender || '', nationality: c.nationality || '',
                setting: c.setting || c.desc || c.persona || '', isNpc: !!c.isNpc
              };
            }));
          };
          r.onerror = function () { db.close(); resolve([]); };
        } catch (e) { resolve([]); }
      });
    }).catch(function () { return []; });
  }

  function loadWorldbookFiles() {
    // 优先 localStorage 缓存，其次 IndexedDB
    var keys = ['nano_worldbook_data_v5', 'nano_worldbook_data', 'peach_worldbook_data'];
    for (var i = 0; i < keys.length; i++) {
      var d = readJSON(keys[i]);
      if (d && Array.isArray(d.files)) return Promise.resolve(d.files);
    }
    return openDB('nano_worldbook_db', 1, function (db) {
      if (!db.objectStoreNames.contains('worldbook_data')) db.createObjectStore('worldbook_data', { keyPath: 'key' });
    }).then(function (db) {
      return new Promise(function (resolve) {
        try {
          var r = db.transaction('worldbook_data', 'readonly').objectStore('worldbook_data').get('data');
          r.onsuccess = function () { db.close(); resolve((r.result && r.result.value && r.result.value.files) || []); };
          r.onerror = function () { db.close(); resolve([]); };
        } catch (e) { resolve([]); }
      });
    }).catch(function () { return []; });
  }

  function collectWorldbookText(charIds) {
    return loadWorldbookFiles().then(function (files) {
      var out = [];
      (files || []).forEach(function (f) {
        if (!f) return;
        var scope = f.scope || 'global';
        var bound = Array.isArray(f.boundCharacters) ? f.boundCharacters : [];
        var applies = false;
        if (scope === 'global') applies = true;
        else if (charIds && charIds.length) {
          applies = charIds.some(function (id) { return bound.indexOf(id) > -1; });
        }
        if (!applies) return;
        var entries = Array.isArray(f.entries) ? f.entries : [];
        var lines = [];
        entries.forEach(function (e) {
          if (!e || !e.content) return;
          var t = (e.title ? ('【' + e.title + '】') : '') + String(e.content).trim();
          if (t) lines.push(t);
        });
        if (!lines.length && typeof f.content === 'string' && f.content.trim()) lines.push(f.content.trim());
        if (lines.length) out.push('《' + (f.name || '世界书') + '》\n' + lines.join('\n'));
      });
      return out.join('\n\n');
    });
  }

  function collectMemory(charIds) {
    // 记忆库真实版本是 5：不能指定低版本，也不能自行建表，只读现有结构
    return openDB('nano_vector_memory_db').then(function (db) {
      return new Promise(function (resolve) {
        try {
          if (!db.objectStoreNames.contains('config')) { db.close(); resolve([]); return; }
          var store = db.transaction('config', 'readonly').objectStore('config');
          var keys = (charIds || []).map(function (id) { return 'memlist_' + id; });
          if (!keys.length) { db.close(); resolve([]); return; }
          var done = 0; var out = [];
          keys.forEach(function (k) {
            var r = store.get(k);
            r.onsuccess = function () {
              var v = r.result && (r.result.value || r.result);
              var arr = Array.isArray(v) ? v : [];
              arr.forEach(function (m) { if (m) out.push(typeof m === 'string' ? m : (m.text || m.content || '')); });
              if (++done === keys.length) { db.close(); resolve(out.filter(Boolean)); }
            };
            r.onerror = function () { if (++done === keys.length) { db.close(); resolve(out.filter(Boolean)); } };
          });
        } catch (e) { resolve([]); }
      });
    }).catch(function () { return []; });
  }

  /* ---------------- 主 API ---------------- */
  function getApiConfig() {
    return openDB('nano_api_db', 2, function (db) {
      if (!db.objectStoreNames.contains('api_data')) db.createObjectStore('api_data', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('emoji_data')) db.createObjectStore('emoji_data', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('favorite_data')) db.createObjectStore('favorite_data', { keyPath: 'key' });
    }).then(function (db) {
      return new Promise(function (resolve) {
        try {
          var r = db.transaction('api_data', 'readonly').objectStore('api_data').get('nano_api_config');
          r.onsuccess = function () {
            db.close();
            var v = r.result && r.result.value;
            if (v) resolve(v);
            else resolve(readJSON('nano_api_config'));
          };
          r.onerror = function () { db.close(); resolve(readJSON('nano_api_config')); };
        } catch (e) { resolve(readJSON('nano_api_config')); }
      });
    }).catch(function () { return readJSON('nano_api_config'); });
  }
  function resolveApiHost(raw) {
    try {
      var u = new URL(String(raw || '').trim());
      var h = u.hostname, cur = location.hostname;
      if ((h === 'localhost' || h === '127.0.0.1' || h === '[::1]') && cur && cur !== 'localhost' && cur !== '127.0.0.1' && cur !== '0.0.0.0') u.hostname = cur;
      return u.toString();
    } catch (e) { return raw; }
  }
  function toV1Base(u) {
    var s = String(u || '').trim().replace(/\/+$/, '');
    if (!/\/v1$/i.test(s)) s += '/v1';
    return s;
  }
  function toImageBase(u) {
    var s = String(u || '').trim().replace(/\/+$/, '');
    s = s.replace(/\/images\/(generations|edits)$/i, '');
    if (!/\/v1$/i.test(s)) s += '/v1';
    return s;
  }

  function dataUrlToBlob(u) {
    var comma = String(u).indexOf(',');
    var mime = (String(u).slice(5, comma).split(';')[0]) || 'image/png';
    var bin = atob(String(u).slice(comma + 1));
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function generateImage(prompt, opts) {
    opts = opts || {};
    return getApiConfig().then(function (cfg) {
      if (!cfg) throw new Error('未配置 API');
      var rawUrl = String(cfg.imgUrl || '').trim();
      var key = String(cfg.imgKey || '').trim();
      var model = String(cfg.imgModel || '').trim();
      if (!rawUrl || !key || !model) throw new Error('请先在 API → 生图里配置地址、Key 和模型');
      var base = toImageBase(resolveApiHost(rawUrl));
      var size = opts.size || '1024x1024';
      var faceRef = String(opts.faceRef || '');
      if (faceRef && faceRef.indexOf('data:') === 0) {
        try {
          var fd = new FormData();
          fd.append('model', model);
          fd.append('prompt', String(prompt || ''));
          fd.append('n', '1');
          fd.append('size', size);
          fd.append('image', dataUrlToBlob(faceRef), 'ref.png');
          return fetch(base + '/images/edits', {
            method: 'POST', headers: { 'Authorization': 'Bearer ' + key }, body: fd
          }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
          }).then(function (d) {
            var it = d && d.data && d.data[0];
            if (it && it.url) return it.url;
            if (it && it.b64_json) return 'data:image/png;base64,' + it.b64_json;
            throw new Error('生图接口未返回图片');
          }).catch(function () { return generateImageJson(base, key, model, prompt, size, ''); });
        } catch (e) {}
      }
      return generateImageJson(base, key, model, prompt, size, faceRef);
    });
  }
  function generateImageJson(base, key, model, prompt, size, faceRef) {
    var body = { model: model, prompt: String(prompt || ''), n: 1, size: size };
    if (faceRef) { body.image = faceRef; body.reference_image = [faceRef]; body.input_reference_image = [faceRef]; }
    return fetch(base + '/images/generations', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          var msg = 'HTTP ' + r.status;
          try { var d = JSON.parse(t); msg = (d.error && d.error.message) || d.message || msg; } catch (e) {}
          throw new Error(msg);
        });
      }
      return r.json();
    }).then(function (d) {
      var it = d && d.data && d.data[0];
      if (it && it.url) return it.url;
      if (it && it.b64_json) return 'data:image/png;base64,' + it.b64_json;
      throw new Error('生图接口未返回图片');
    });
  }

  function speakText(text, opts) {
    text = String(text || '').trim();
    if (!text) return Promise.resolve(false);
    if (window.NanoTTS && typeof window.NanoTTS.speak === 'function') {
      try { return Promise.resolve(window.NanoTTS.speak(text, opts || {})).catch(function () { return nativeSpeak(text, opts); }); } catch (e) {}
    }
    return nativeSpeak(text, opts);
  }
  function clipboardWrite(text) {
    text = String(text == null ? '' : text);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch (e) { return false; }
  }
  function clipboardRead() {
    if (navigator.clipboard && navigator.clipboard.readText) {
      return navigator.clipboard.readText().catch(function () { return ''; });
    }
    return Promise.resolve('');
  }
  function nativeSpeak(text, opts) {
    return new Promise(function (resolve) {
      try {
        if (!('speechSynthesis' in window)) { resolve(false); return; }
        var u = new SpeechSynthesisUtterance(text);
        opts = opts || {};
        if (opts.rate) u.rate = Number(opts.rate) || 1;
        if (opts.pitch) u.pitch = Number(opts.pitch) || 1;
        if (opts.lang) u.lang = String(opts.lang);
        u.onend = function () { resolve(true); };
        u.onerror = function () { resolve(false); };
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
        setTimeout(function () { resolve(true); }, 1200 + text.length * 90);
      } catch (e) { resolve(false); }
    });
  }

  function callChatApi(messages, maxTokens, temperature) {
    return getApiConfig().then(function (cfg) {
      if (!cfg || !cfg.mainUrl || !cfg.mainKey || !cfg.mainModel) throw new Error('未配置主 API（请先到 API 页填写）');
      var base = toV1Base(resolveApiHost(cfg.mainUrl));
      var token = 'app_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      var resultKey = 'app_api_result_' + token;
      var body = JSON.stringify({
        model: cfg.mainModel,
        messages: messages,
        max_tokens: maxTokens || 1200,
        temperature: (typeof temperature === 'number') ? temperature : (parseFloat(cfg.mainTemp) || 0.8)
      });
      return new Promise(function (resolve, reject) {
        var settled = false, poll = null, timeout = null;
        function finish(r) {
          if (settled) return;
          settled = true;
          if (poll) clearInterval(poll);
          if (timeout) clearTimeout(timeout);
          window.removeEventListener('message', onMsg);
          resolve(r);
        }
        function take() {
          try {
            var raw = localStorage.getItem(resultKey);
            if (raw) { localStorage.removeItem(resultKey); finish(JSON.parse(raw)); return true; }
          } catch (e) {}
          return false;
        }
        function onMsg(e) {
          var d = e.data;
          if (d && d.type === 'chatApiDone' && d.token === token) { if (!take()) finish({ ok: false, error: '未取到结果' }); }
        }
        if (take()) return;
        window.addEventListener('message', onMsg);
        try {
          parent.postMessage({
            type: 'chatApiFetch', token: token, resultKey: resultKey,
            url: base + '/chat/completions', method: 'POST',
            headers: { 'Authorization': 'Bearer ' + String(cfg.mainKey).trim(), 'Content-Type': 'application/json' },
            body: body
          }, '*');
        } catch (e) { finish({ ok: false, error: '无法请求父页面' }); return; }
        poll = setInterval(function () { take(); }, 1000);
        timeout = setTimeout(function () { if (!settled) finish({ ok: false, error: '请求超时' }); }, 180000);
      }).then(function (r) {
        if (!r || !r.ok) throw new Error((r && r.error) || ('API 错误（' + (r && r.status) + '）'));
        var data = {}; try { data = JSON.parse(r.text || '{}'); } catch (e) {}
        var c = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (!c) throw new Error('API 没有返回内容');
        return c;
      });
    });
  }

  function buildChatMessages(opts, charsById) {
    var user = currentUser();
    var parts = [];
    var ids = (opts.charIds && opts.charIds.length) ? opts.charIds.slice() : (opts.charId ? [opts.charId] : []);
    var chars = ids.map(function (id) { return charsById[id]; }).filter(Boolean);

    var head = opts.system ? String(opts.system).trim() : '';
    if (chars.length > 1) {
      head = (head || '') + '\n你正在参与一个群聊，群里有多个人（角色）。请根据每个人的性格分别说话。';
    }
    if (head) parts.push(head);

    if (opts.useCharPersona !== false) {
      chars.forEach(function (c) {
        var s = '【角色人设 · ' + c.name + '】\n';
        s += '- 姓名：' + c.name;
        if (c.gender) s += '\n- 性别：' + c.gender;
        if (c.nationality) s += '\n- 国籍：' + c.nationality;
        if (c.setting) s += '\n' + c.setting;
        parts.push(s);
      });
      if (chars.length > 1) {
        parts.push('回复格式：每条发言用「角色名：内容」开头，可以有多条不同角色的发言。');
      }
    }

    if (opts.useUserPersona !== false && user.setting && String(user.setting).trim()) {
      parts.push('【对方（' + user.name + '）的设定】\n' + String(user.setting).trim());
    }
    parts.push('你正在和「' + user.name + '」说话；称呼对方用名字或自然的称呼。');

    var sys = parts.filter(Boolean).join('\n\n');

    return (opts.useWorldbook || opts.useMemory)
      ? Promise.all([
          opts.useWorldbook ? collectWorldbookText(ids) : Promise.resolve(''),
          opts.useMemory ? collectMemory(ids) : Promise.resolve([])
        ]).then(function (r) {
          var all = sys;
          if (r[0]) all += '\n\n【世界书 · 必须遵守】\n' + r[0];
          if (r[1] && r[1].length) all += '\n\n【长期记忆】\n' + r[1].join('\n');
          return all;
        })
      : Promise.resolve(sys);
  }

  /* ---------------- 处理应用请求 ---------------- */
  function respond(win, id, ok, result, error) {
    try { win.postMessage({ __nanoAppResp: true, id: id, ok: !!ok, result: ok ? result : undefined, error: ok ? undefined : String(error || '') }, '*'); } catch (e) {}
  }

  var dataKey = function (k) { return appId + ':' + k; };

  function handleRequest(win, data) {
    var id = data.id;
    var method = data.method;
    var args = data.args || [];
    var charsById = {};

    function preload() { return listCharacters().then(function (list) { list.forEach(function (c) { charsById[c.id] = c; }); return list; }); }

    var task;
    switch (method) {
      case 'ready':
        task = Promise.resolve({ appId: appId, version: 1 });
        break;
      case 'store.get':
        task = idbGet(DATA_STORE, dataKey(args[0])).then(function (rec) { return rec ? rec.value : null; });
        break;
      case 'store.set':
        task = idbPut(DATA_STORE, { key: dataKey(args[0]), value: args[1] });
        break;
      case 'store.remove':
        task = idbDelete(DATA_STORE, dataKey(args[0]));
        break;
      case 'characters':
        task = preload();
        break;
      case 'currentUser':
        task = Promise.resolve(currentUser());
        break;
      case 'persona':
        task = preload().then(function () { return { user: currentUser(), char: charsById[args[0]] || null }; });
        break;
      case 'worldbook':
        task = collectWorldbookText(args[0] ? [args[0]] : []);
        break;
      case 'memory':
        task = collectMemory(args[0] ? [args[0]] : []);
        break;
      case 'apiConfig':
        task = getApiConfig().then(function (cfg) {
          return { connected: !!(cfg && cfg.mainUrl && cfg.mainKey && cfg.mainModel), model: cfg && cfg.mainModel || '' };
        });
        break;
      case 'permissions':
        task = idbGet(APP_STORE, appId).then(function (rec) {
          var list = (rec && Array.isArray(rec.permissions)) ? rec.permissions : [];
          return { all: true, list: list, note: 'Nano AppStore 默认授予全部能力' };
        });
        break;
      case 'image.generate':
        task = generateImage(args[0], args[1] || {});
        break;
      case 'tts.speak':
        task = speakText(args[0], args[1] || {});
        break;
      case 'files.add':
        task = (window.NanoFiles ? NanoFiles.add(args[0] || {}) : Promise.reject(new Error('文件库未加载')));
        break;
      case 'files.list':
        task = (window.NanoFiles ? NanoFiles.list() : Promise.resolve([]));
        break;
      case 'files.remove':
        task = (window.NanoFiles ? NanoFiles.remove(args[0]) : Promise.resolve(false));
        break;
      case 'gallery.add':
        if (window.NanoGallery) NanoGallery.add(args[0] || {});
        task = Promise.resolve(true);
        break;
      case 'gallery.list':
        task = (window.NanoGallery ? (NanoGallery.allAsync ? NanoGallery.allAsync() : Promise.resolve(NanoGallery.all())) : Promise.resolve([]));
        break;
      case 'gallery.remove':
        task = Promise.resolve(window.NanoGallery ? NanoGallery.remove(args[0]) : 0);
        break;
      case 'gallery.clear':
        if (window.NanoGallery) NanoGallery.clear();
        task = Promise.resolve(true);
        break;
      case 'clipboard.write':
        task = clipboardWrite(args[0]);
        break;
      case 'clipboard.read':
        task = clipboardRead();
        break;
      case 'chat':
        (function () {
          var opts = args[0] || {};
          task = preload().then(function () { return buildChatMessages(opts, charsById); }).then(function (sys) {
            var history = [{ role: 'system', content: sys }];
            (opts.messages || []).forEach(function (m) {
              if (m && m.content) history.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) });
            });
            if (history.length < 2) history.push({ role: 'user', content: '你好' });
            return callChatApi(history, opts.maxTokens || 1400, opts.temperature);
          });
        })();
        break;
      case 'openUrl':
        try { parent.postMessage({ type: 'openFullscreen', url: args[0], title: args[1] || '', source: 'appstore', showBack: false }, '*'); } catch (e) {}
        task = Promise.resolve(true);
        break;
      case 'toast':
        try { parent.postMessage({ type: 'nanoToast', text: args[0] }, '*'); } catch (e) {}
        task = Promise.resolve(true);
        break;

      // 本应用自己的清单（名称 / 图标 / 颜色 / 描述）
      case 'getManifest':
        task = idbGet(APP_STORE, appId).then(function (rec) {
          return rec ? { id: rec.id, name: rec.name, icon: rec.icon, color: rec.color, desc: rec.desc, version: rec.version } : null;
        });
        break;
      // 应用在运行中设计自己的图标 / 改名（写回 AppStore 已安装区）
      case 'setManifest':
        task = idbGet(APP_STORE, appId).then(function (rec) {
          if (!rec) throw new Error('应用记录不存在');
          var p = args[0] || {};
          if (p.name != null) rec.name = String(p.name).slice(0, 40);
          if (p.icon != null) rec.icon = String(p.icon).slice(0, 200000);
          if (p.color != null) rec.color = String(p.color).slice(0, 32);
          if (p.desc != null) rec.desc = String(p.desc).slice(0, 160);
          if (p.version != null) rec.version = String(p.version).slice(0, 24);
          return idbPut(APP_STORE, rec).then(function () {
            try { parent.postMessage({ type: 'nanoAppManifestChanged', appId: appId, name: rec.name, icon: rec.icon, color: rec.color, desc: rec.desc }, '*'); } catch (e) {}
            return { id: rec.id, name: rec.name, icon: rec.icon, color: rec.color, desc: rec.desc, version: rec.version };
          });
        });
        break;
      // 已安装应用列表（可以互相打开 / 展示在应用里）
      case 'apps':
        task = idbGetAll(APP_STORE).then(function (list) {
          return (list || []).map(function (a) {
            return { id: a.id, name: a.name, icon: a.icon, color: a.color, desc: a.desc, version: a.version };
          });
        });
        break;
      // 打开另一个已安装的应用
      case 'openApp':
        try {
          parent.postMessage({ type: 'openFullscreen', url: 'app-host.html?id=' + encodeURIComponent(args[0]), title: args[1] || '应用', showBack: false, source: 'appstore' }, '*');
        } catch (e) {}
        task = Promise.resolve(true);
        break;
      // 关闭当前应用：默认回到 AppStore
      case 'close':
        try {
          if (window.parent && window.parent !== window) {
            parent.postMessage({ type: 'nanoAppExit', appId: appId }, '*');
          } else {
            location.href = 'appstore.html';
          }
        } catch (e) {
          try { location.href = 'appstore.html'; } catch (e2) {}
        }
        task = Promise.resolve(true);
        break;
      // 系统 / 应用内通知
      case 'notify':
        try { parent.postMessage({ type: 'appNotify', title: args[0] || '应用', body: args[1] || '', app: appId, avatar: args[2] || '', name: args[0] || '应用' }, '*'); } catch (e) {}
        task = Promise.resolve(true);
        break;
      case 'user':
      case 'avatar':
        task = Promise.resolve(currentUser());
        break;

      // 手势返回交给内层应用决定；不处理则默认回 AppStore
      default:
        respond(win, id, false, null, '未知方法 ' + method);
        return;
    }
    Promise.resolve(task).then(function (result) {
      respond(win, id, true, result);
    }).catch(function (err) {
      respond(win, id, false, null, (err && err.message) || err);
    });
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || typeof data !== 'object') return;

    // 外壳的手势/返回请求：先问内层应用要不要自己处理
    if (data.type === 'nanoRequestBack') {
      var handled = false;
      var onInner = function (e) {
        var d = e.data;
        if (d && d.__nanoBackHandled) { handled = true; window.removeEventListener('message', onInner); }
      };
      window.addEventListener('message', onInner);
      try { if (appFrame && appFrame.contentWindow) appFrame.contentWindow.postMessage({ __nanoBack: true }, '*'); } catch (e) {}
      setTimeout(function () {
        window.removeEventListener('message', onInner);
        try { parent.postMessage({ type: handled ? 'nanoBackHandled' : 'nanoBackUnhandled' }, '*'); } catch (e) {}
      }, 650);
      return;
    }

    if (!data.__nanoApp) return;
    if (appFrame && event.source !== appFrame.contentWindow) return;
    handleRequest(event.source, data);
  });

  /* ---------------- 启动 ---------------- */
  function injectBridge(html, id) {
    var root = '';
    try { root = new URL('../', location.href).href; } catch (e) {}
    var tag = '<script>window.__NANO_APP_ID__=' + JSON.stringify(String(id)) + ';<\/script>' +
              '<script src="' + root + 'js/nano-app-bridge.js?v=20261023d"><\/script>' +
              '<script src="' + root + 'js/appearance.js?v=20261023a"><\/script>';
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, function (m) { return m + tag; });
    if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, function (m) { return m + '<head>' + tag + '</head>'; });
    return tag + html;
  }

  function syncSafeArea() {
    try {
      var cs = getComputedStyle(document.documentElement);
      var top = (cs.getPropertyValue('--safe-top') || '').trim() || '0px';
      var bot = (cs.getPropertyValue('--safe-bottom') || '').trim() || '0px';
      var de = appFrame && appFrame.contentDocument && appFrame.contentDocument.documentElement;
      if (!de) return;
      de.style.setProperty('--safe-top', top);
      de.style.setProperty('--safe-t', top);
      de.style.setProperty('--safe-inset-top', top);
      de.style.setProperty('--safe-bottom', bot);
      de.style.setProperty('--safe-b', bot);
      de.style.setProperty('--nano-safe-bottom', bot);
    } catch (e) {}
  }

  function start() {
    if (!appId) { fail('缺少应用 id'); return; }
    idbGet(APP_STORE, appId).then(function (rec) {
      if (!rec || !rec.html) { fail('没有找到该应用'); return; }
      var doc = injectBridge(String(rec.html), appId);
      appFrame.addEventListener('load', function () {
        syncSafeArea();
        [30, 80, 160, 320, 700, 1400].forEach(function (t) {
          setTimeout(syncSafeArea, t);
        });
        setTimeout(hideMsg, 120);
      });
      window.addEventListener('resize', syncSafeArea);
      try { appFrame.srcdoc = doc; } catch (e) { fail('应用载入失败'); }
    }).catch(function () { fail('读取应用失败'); });
  }

  start();
})();
