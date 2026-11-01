/* ============================================================
   js/travel-api.js — 「旅途」主 API / 生图 / 图库 / 向量化
   ------------------------------------------------------------
   配置来源（与 App「API」一致）：
     IndexedDB: nano_api_db  -> api_data -> key = 'nano_api_config'
       { mainUrl, mainKey, mainModel, imgUrl, imgKey, imgModel, imgSize }
     localStorage: nano_api_config（兜底）
   记忆配置（与 App「记忆」一致）：
     IndexedDB: nano_vector_memory_db -> config
       llmUrl / llmKey / llmModel / embUrl / embKey / embModel
   调用方式：
     TravelAPI.callChat({messages, json, maxTokens, temperature})
     TravelAPI.embed(text)
     TravelAPI.generateImage({prompt, charId, size})
   ============================================================ */
(function () {
  'use strict';
  if (window.NanoTravelAPI) return;

  function trim(u) { return String(u || '').trim().replace(/\/+$/, ''); }
  function uid(p) { return (p || 'ta') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function openDB(name, version, upgrade) {
    return new Promise(function (resolve) {
      try {
        var req = version ? indexedDB.open(name, version) : indexedDB.open(name);
        req.onupgradeneeded = function (e) { try { upgrade && upgrade(e.target.result, e.target.transaction); } catch (err) {} };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }

  function readApiConfig() {
    return openDB('nano_api_db', 0, function (db) {
      if (!db.objectStoreNames.contains('api_data')) db.createObjectStore('api_data', { keyPath: 'key' });
    }).then(function (db) {
      return new Promise(function (resolve) {
        if (!db) { resolve(null); return; }
        try {
          var r = db.transaction('api_data', 'readonly').objectStore('api_data').get('nano_api_config');
          r.onsuccess = function () {
            var rec = r.result;
            var v = rec ? (rec.value && typeof rec.value === 'object' ? rec.value : rec) : null;
            if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) {} }
            resolve(v && typeof v === 'object' ? v : null);
            try { db.close(); } catch (e) {}
          };
          r.onerror = function () { resolve(null); try { db.close(); } catch (e) {} };
        } catch (e) { resolve(null); try { db.close(); } catch (e2) {} }
      });
    }).then(function (o) {
      if (!o) { try { o = JSON.parse(localStorage.getItem('nano_api_config') || 'null'); } catch (e) { o = null; } }
      if (o && o.value && typeof o.value === 'object' && !o.mainUrl) o = o.value;
      return o || {};
    }).catch(function () {
      try { return JSON.parse(localStorage.getItem('nano_api_config') || 'null') || {}; } catch (e) { return {}; }
    });
  }

  function readMemoryConfig() {
    return openDB('nano_vector_memory_db').then(function (db) {
      return new Promise(function (resolve) {
        if (!db) { resolve({}); return; }
        try {
          var tx = db.transaction('config', 'readonly');
          var st = tx.objectStore('config');
          var out = {};
          var keys = ['llmUrl', 'llmKey', 'llmModel', 'embUrl', 'embKey', 'embModel'];
          var left = keys.length;
          keys.forEach(function (k) {
            var r = st.get(k);
            r.onsuccess = function () { out[k] = r.result ? r.result.value : ''; if (--left === 0) { resolve(out); try { db.close(); } catch (e) {} } };
            r.onerror = function () { if (--left === 0) { resolve(out); try { db.close(); } catch (e) {} } };
          });
        } catch (e) { resolve({}); try { db.close(); } catch (e2) {} }
      });
    }).catch(function () { return {}; });
  }

  // 与主聊天保持一致：本地/局域网时把 localhost 换成当前主机
  function resolveApiHost(rawUrl) {
    try {
      var s = String(rawUrl || '').trim();
      if (!s) return s;
      var u = new URL(s);
      var host = u.hostname;
      var cur = window.location.hostname;
      var isLan = cur && (/^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(cur) || /^10\./.test(cur) || /^192\.168\./.test(cur) || /^172\.(1[6-9]|2\d|3[01])\./.test(cur) || /\.local$/.test(cur));
      if ((host === 'localhost' || host === '127.0.0.1' || host === '[::1]') && isLan) u.hostname = cur;
      return u.toString();
    } catch (e) { return rawUrl; }
  }
  // 统一补全 /v1，兼容用户把完整端点填进配置
  function toV1Base(u) {
    var s = String(u || '').trim().replace(/\/+$/, '');
    s = s.replace(/\/chat\/completions$/i, '');
    s = s.replace(/\/embeddings$/i, '');
    s = s.replace(/\/images\/(generations|edits)$/i, '/v1');
    if (!/\/v1$/i.test(s)) s = s + '/v1';
    return s;
  }
  function textEndpoint(base) {
    var u = trim(base);
    if (!u) return '';
    return toV1Base(resolveApiHost(u)) + '/chat/completions';
  }
  function imageEndpoint(base) {
    var u = trim(base);
    if (!u) return '';
    return toV1Base(resolveApiHost(u)) + '/images/generations';
  }
  function embedEndpoint(base) {
    var u = trim(base);
    if (!u) return '';
    return toV1Base(resolveApiHost(u)) + '/embeddings';
  }

  function waitParentResult(token, resultKey, timeout) {
    return new Promise(function (resolve, reject) {
      var done = false;
      function finish(fromMsg) {
        if (done) return;
        done = true;
        window.removeEventListener('message', onMsg);
        setTimeout(function () {
          try {
            var raw = localStorage.getItem(resultKey);
            if (!raw) throw new Error('后台没有返回结果');
            localStorage.removeItem(resultKey);
            resolve(JSON.parse(raw));
          } catch (e) { reject(e); }
        }, fromMsg ? 40 : 0);
      }
      function onMsg(ev) {
        if (!ev || !ev.data || ev.data.type !== 'chatApiDone' || ev.data.token !== token) return;
        finish(true);
      }
      window.addEventListener('message', onMsg);
      setTimeout(function () {
        if (done) return;
        done = true;
        window.removeEventListener('message', onMsg);
        var e = new Error('后台仍在生成，可稍后回来查看');
        e.background = true;
        reject(e);
      }, timeout || 120000);
    });
  }
  function requestViaParent(url, headers, body, token, resultKey) {
    return new Promise(function (resolve, reject) {
      if (!(window.parent && window.parent !== window)) {
        reject(new Error('没有可用的代理窗口'));
        return;
      }
      setTimeout(function () {
        try {
          window.parent.postMessage({
            type: 'chatApiFetch', token: token, resultKey: resultKey,
            url: url, method: 'POST', headers: headers, body: body
          }, '*');
        } catch (e) { reject(e); return; }
        waitParentResult(token, resultKey, 120000).then(function (r) {
          if (!r.ok) {
            var msg = r.error || ('HTTP ' + (r.status || ''));
            if (!r.error && r.text) msg += '\n' + String(r.text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 400);
            reject(new Error(msg));
            return;
          }
          resolve(String(r.text || ''));
        }, reject);
      }, 20);
    });
  }
  function postJson(url, headers, body, tag) {
    if (window.parent && window.parent !== window) {
      var token = (tag || 'travel') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      var resultKey = 'travel_result_' + token;
      return requestViaParent(url, headers, body, token, resultKey);
    }
    return fetch(url, { method: 'POST', headers: headers, body: body }).then(function (r) {
      return r.text().then(function (t) {
        if (!r.ok) {
          throw new Error('HTTP ' + r.status + (t ? ' · ' + String(t).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300) : ''));
        }
        return t;
      });
    });
  }

  function repairJsonText(text) {
    var t = String(text == null ? '' : text).replace(/^\uFEFF/, '').trim();
    t = t.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    var first = t.search(/[\[{]/);
    if (first > 0) t = t.slice(first);
    var out = '', stack = [], inStr = false, esc = false, started = false;
    for (var i = 0; i < t.length; i++) {
      var ch = t[i];
      if (inStr) {
        if (esc) { out += ch; esc = false; }
        else if (ch === '\\') { out += ch; esc = true; }
        else if (ch === '"') { out += ch; inStr = false; }
        else if (ch === '\n') out += '\\n';
        else if (ch === '\r') {}
        else if (ch === '\t') out += '\\t';
        else out += ch;
      } else {
        if (ch === '"') { inStr = true; out += ch; }
        else if (ch === '{') { started = true; stack.push('}'); out += ch; }
        else if (ch === '[') { started = true; stack.push(']'); out += ch; }
        else if (ch === '}' || ch === ']') {
          if (stack.length && stack[stack.length - 1] === ch) stack.pop();
          out += ch;
          if (started && !stack.length) break;
        } else out += ch;
      }
    }
    if (inStr) { if (esc) out = out.slice(0, -1); out += '"'; }
    while (stack.length) out += stack.pop();
    return out.replace(/,\s*([}\]])/g, '$1');
  }
  function looseJson(text) {
    var raw = String(text == null ? '' : text).trim();
    if (!raw) return null;
    var candidates = [raw];
    var a = raw.indexOf('{'), b = raw.lastIndexOf('}'), c = raw.indexOf('['), d = raw.lastIndexOf(']');
    var s = Math.min.apply(null, [a, c].filter(function (i) { return i >= 0; }));
    var e = Math.max(b, d);
    if (s >= 0 && e > s) candidates.push(raw.slice(s, e + 1));
    candidates.push(repairJsonText(raw));
    for (var i = 0; i < candidates.length; i++) {
      try { return JSON.parse(candidates[i]); } catch (err) {}
    }
    return null;
  }

  async function callChat(opts) {
    opts = opts || {};
    var cfg = await readApiConfig();
    var url = opts.url || cfg.mainUrl || '';
    var key = opts.key != null ? opts.key : (cfg.mainKey || '');
    var model = opts.model || cfg.mainModel || 'gpt-4o-mini';
    if (!url) throw new Error('还没有配置主 API，请到「API → 主 API」填写地址、Key 和模型');
    var endpoint = textEndpoint(url);
    var headers = { 'Content-Type': 'application/json' };
    if (key) headers.Authorization = 'Bearer ' + key;
    var bodyObj = {
      model: model,
      temperature: opts.temperature == null ? 0.85 : opts.temperature,
      max_tokens: Math.max(400, Number(opts.maxTokens) || 2200),
      stream: false,
      messages: Array.isArray(opts.messages) ? opts.messages : []
    };
    if (opts.json) bodyObj.response_format = { type: 'json_object' };
    async function once(withJson) {
      var b = Object.assign({}, bodyObj);
      if (!withJson) delete b.response_format;
      var raw = await postJson(endpoint, headers, JSON.stringify(b), 'travelchat');
      var j = {};
      try { j = JSON.parse(raw || '{}'); } catch (e) { j = {}; }
      var ch = (j.choices && j.choices[0]) || {};
      var txt = (ch.message && ch.message.content) || ch.text || '';
      if (!txt && ch.message && ch.message.reasoning_content) txt = ch.message.reasoning_content;
      return { txt: String(txt || ''), finish: ch.finish_reason || '' };
    }
    var out;
    try {
      out = await once(!!opts.json);
    } catch (e) {
      if (!opts.json) throw e;
      out = await once(false);
    }
    if (out.finish === 'length' || !out.txt.trim()) {
      try {
        var retry = await once(false);
        if (retry.txt && retry.txt.length >= out.txt.length) out = retry;
      } catch (e) {}
    }
    if (!out.txt.trim()) throw new Error('主 API 没有返回内容');
    return out.txt.trim();
  }

  async function callJson(opts) {
    var txt = await callChat(Object.assign({}, opts || {}, { json: true }));
    var data = looseJson(txt);
    if (data == null) throw new Error('主 API 返回的不是可解析的 JSON');
    return data;
  }

  async function embed(text) {
    var cfg = await readMemoryConfig();
    if (!cfg.embUrl || !cfg.embKey || !cfg.embModel) return null;
    var endpoint = embedEndpoint(cfg.embUrl);
    var headers = { 'Content-Type': 'application/json' };
    if (cfg.embKey) headers.Authorization = 'Bearer ' + cfg.embKey;
    try {
      var raw = await postJson(endpoint, headers, JSON.stringify({ model: cfg.embModel, input: String(text || ''), encoding_format: 'float' }), 'travelemb');
      var j = JSON.parse(raw || '{}');
      var v = j && j.data && j.data[0] && j.data[0].embedding;
      return Array.isArray(v) ? v : null;
    } catch (e) { return null; }
  }

  async function faceRefFor(charId) {
    try { if (window.NanoFaceRef && NanoFaceRef.get) return await NanoFaceRef.get(String(charId || '')); } catch (e) {}
    try {
      if (typeof localforage !== 'undefined' && localforage.getItem) {
        var v = await localforage.getItem('chat_setting_faceRef_' + String(charId || ''));
        if (v) return String(v);
      }
    } catch (e) {}
    try { return String(localStorage.getItem('chat_setting_faceRef_' + String(charId || '')) || ''); } catch (e) { return ''; }
  }

  function parseImageText(txt, prompt) {
    var j = {};
    try { j = JSON.parse(String(txt || '{}')); } catch (e) { throw new Error('生图接口返回的内容不是 JSON'); }
    var item = j && j.data && j.data[0];
    var src = item && (item.url || (item.b64_json ? 'data:image/png;base64,' + item.b64_json : ''));
    if (!src && j) {
      if (j.url) src = j.url;
      else if (j.image) src = j.image;
      else if (j.b64_json) src = 'data:image/png;base64,' + j.b64_json;
      else if (Array.isArray(j.images) && j.images.length) {
        var im = j.images[0];
        src = typeof im === 'string' ? im : (im && (im.url || im.image)) || '';
      }
    }
    if (!src) throw new Error('生图接口没有返回图片地址');
    return { src: src, kind: 'api', prompt: prompt || '' };
  }

  async function finalizeImage(out, prompt, charName) {
    if (!out || !out.src) return out;
    var src = out.src;
    try {
      if (window.NanoImageCache && /^https?:\/\//i.test(src)) {
        var local = await NanoImageCache.toDataUrl(src);
        if (local) src = local;
      }
    } catch (e) {}
    out.src = src;
    try {
      if (window.NanoGallery) {
        NanoGallery.add({
          url: src, source: '旅途', charName: charName || '',
          prompt: String(prompt || '').slice(0, 500), generated: true
        });
      }
    } catch (e) {}
    return out;
  }

  async function generateImage(opts) {
    opts = opts || {};
    var cfg = await readApiConfig();
    var imgUrl = opts.url || cfg.imgUrl || '';
    if (!imgUrl) throw new Error('还没有配置生图 API，请到「API → 生图」填写地址、Key 和模型');
    var key = opts.key != null ? opts.key : (cfg.imgKey || '');
    var model = opts.model || cfg.imgModel || '';
    var size = opts.size || cfg.imgSize || '1024x1024';
    var prompt = String(opts.prompt || '').trim();
    if (!prompt) throw new Error('生图提示词为空');
    var faceRef = '';
    try { faceRef = await faceRefFor(opts.charId || ''); } catch (e) { faceRef = ''; }
    var note = faceRef
      ? '【锁脸说明】人物参考图只用于保持长相（五官、脸型、肤色、发色）一致；请完全忽略参考图的姿势、角度、表情、背景与构图，按当前场景重新构图。\n'
      : '';
    var body = { model: model || undefined, prompt: note + prompt, n: 1, size: size };
    if (faceRef) {
      body.image = faceRef;
      body.reference_image = [faceRef];
      body.input_reference_image = [faceRef];
    }
    var headers = { 'Content-Type': 'application/json' };
    if (key) headers.Authorization = 'Bearer ' + key;
    var raw;
    try {
      raw = await postJson(imageEndpoint(imgUrl), headers, JSON.stringify(body), 'travelimg');
    } catch (e) {
      if (!faceRef) throw e;
      var plain = { model: model || undefined, prompt: prompt, n: 1, size: size };
      raw = await postJson(imageEndpoint(imgUrl), headers, JSON.stringify(plain), 'travelimg');
    }
    return finalizeImage(parseImageText(raw, prompt), prompt, opts.charName || '');
  }

  window.NanoTravelAPI = {
    uid: uid,
    readApiConfig: readApiConfig,
    readMemoryConfig: readMemoryConfig,
    callChat: callChat,
    callJson: callJson,
    embed: embed,
    generateImage: generateImage,
    finalizeImage: finalizeImage,
    faceRefFor: faceRefFor,
    looseJson: looseJson,
    textEndpoint: textEndpoint,
    imageEndpoint: imageEndpoint
  };
})();
