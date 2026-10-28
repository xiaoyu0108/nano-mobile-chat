/* nano-image-settings.js — Nano 生图设置独立页面
   读写与生图室共用的 nano_image_studio_v1 状态，管理正面 / 反面提示词与预设。 */
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

  function defaultStore() {
    return {
      sessions: [], currentId: '', presets: [], basePresetId: '', importedApiName: '',
      useBasePrompt: true, basePositive: '', baseNegative: '', size: '768x1344', mode: 'image',
      savedAt: 0
    };
  }
  function normalize(s) {
    if (!s || typeof s !== 'object') s = defaultStore();
    if (!Array.isArray(s.sessions)) s.sessions = [];
    if (!Array.isArray(s.presets)) s.presets = [];
    s.useBasePrompt = s.useBasePrompt !== false;
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
    return s;
  }
  function loadLocal() {
    try {
      var raw = localStorage.getItem(KEY);
      return applyTombstones(normalize(raw ? JSON.parse(raw) : null));
    } catch (e) { return applyTombstones(normalize(null)); }
  }
  // 和生图室共用同一份状态：完整记录（含图片）在 IndexedDB，localStorage 只是精简镜像。
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
    catch (e) { try { localStorage.removeItem(KEY); } catch (e2) {} }
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
    if (lt > ht || (lt === ht && localHasChanges(light, heavy))) {
      var heavyById = {};
      (heavy.sessions || []).forEach(function (hs) { if (hs && hs.id) heavyById[hs.id] = hs; });
      (light.sessions || []).forEach(function (ls) {
        var hs = ls && ls.id ? heavyById[ls.id] : null;
        if (hs) fillHeavyMedia(ls, hs);
      });
      return normalize(light);
    }
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
  function idbReady() { return !!(window.NanoIDB && window.NanoIDB.get && window.NanoIDB.set); }
  var hydrated = false;
  var saveChain = Promise.resolve();
  var idbTimer = null;

  function hydrate() {
    return new Promise(function (resolve) {
      if (!idbReady()) { hydrated = true; resolve(); return; }
      window.NanoIDB.get(KEY).then(function (heavy) {
        var local = loadLocal();
        state = applyTombstones(heavy ? mergeHeavyLight(heavy, local) : local);
        hydrated = true;
        writeLocal(state);
        resolve();
      }).catch(function () { hydrated = true; resolve(); });
    });
  }

  var state = loadLocal();

  var apiData = {};
  var apiNames = [];
  var apiCurrent = { positive: [], negative: [] };
  var savedTimer = null;

  function savedLabel(text) {
    var el = $('nisSaved');
    if (!el) return;
    el.textContent = text || '修改会自动保存';
    clearTimeout(savedTimer);
    if (text) savedTimer = setTimeout(function () { el.textContent = '修改会自动保存'; }, 1800);
  }

  function writeIdb() {
    if (!idbReady() || !hydrated) return;
    var snapshot = {
      basePositive: state.basePositive,
      baseNegative: state.baseNegative,
      useBasePrompt: state.useBasePrompt,
      presets: state.presets,
      basePresetId: state.basePresetId,
      importedApiName: state.importedApiName,
      size: state.size
    };
    var localSessions = state.sessions || [];
    var localCurrentId = state.currentId;
    saveChain = saveChain.then(function () {
      return window.NanoIDB.get(KEY);
    }).then(function (latest) {
      var next = normalize(latest || state);
      Object.keys(snapshot).forEach(function (k) { next[k] = snapshot[k]; });
      // 设置页只改提示词；但「清空本窗口记录」也会改 sessions。
      // 按窗口 updatedAt 合并，避免这里用 IDB 里的旧记录把刚清空的聊天又写回来。
      var localById = {};
      localSessions.forEach(function (ls) { if (ls && ls.id) localById[ls.id] = ls; });
      next.sessions = (next.sessions || []).map(function (hs) {
        var ls = hs && hs.id ? localById[hs.id] : null;
        if (ls && (Number(ls.updatedAt) || 0) >= (Number(hs.updatedAt) || 0)) return ls;
        return hs;
      });
      var currentId = localCurrentId;
      if (!next.sessions.some(function (s) { return s && s.id === currentId; })) {
        currentId = next.sessions.length ? next.sessions[0].id : '';
      }
      next.currentId = currentId;
      next = applyTombstones(next);
      next.savedAt = Math.max(Date.now(), (Number(next.savedAt) || 0) + 1);
      state = next;
      writeLocal(state);
      return window.NanoIDB.set(KEY, state);
    }).catch(function () {});
  }

  function save(show) {
    state = applyTombstones(state);
    state.savedAt = Math.max(Date.now(), (Number(state.savedAt) || 0) + 1);
    writeLocal(state);
    if (idbReady() && hydrated) {
      clearTimeout(idbTimer);
      idbTimer = setTimeout(writeIdb, 260);
    }
    if (show !== false) savedLabel('已保存');
    return true;
  }

  function joinPromptList(v) {
    if (Array.isArray(v)) return v.filter(Boolean).join('，');
    return String(v || '').trim();
  }

  /* ---------- API 预设读取 ---------- */
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
    if (list && Array.isArray(list.prompt)) list.prompt.forEach(function (n) { if (n) names.push(String(n)); });
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

  function renderPresetOptions() {
    var sel = $('nisPreset');
    if (!sel) return;
    var nanoOpts = state.presets.map(function (p) {
      return '<option value="nano:' + esc(p.id) + '">' + esc(p.name) + '</option>';
    }).join('');
    var apiOpts = '<option value="api:__current__">当前 API 提示词</option>' + apiNames.map(function (n) {
      return '<option value="api:' + esc(n) + '">' + esc(n) + '</option>';
    }).join('');
    sel.innerHTML = '<option value="">自定义 / 不套预设</option>' +
      '<optgroup label="Nano 预设">' + (nanoOpts || '<option value="" disabled>还没有 Nano 预设</option>') + '</optgroup>' +
      '<optgroup label="生图 API 预设（只读导入）">' + apiOpts + '</optgroup>';
    if (state.importedApiName) sel.value = 'api:' + state.importedApiName;
    else if (state.basePresetId && state.presets.some(function (p) { return p.id === state.basePresetId; })) sel.value = 'nano:' + state.basePresetId;
    else sel.value = '';
  }

  function apiConfig(name) {
    if (!name || name === '__current__') {
      return { positive: joinPromptList(apiCurrent.positive), negative: joinPromptList(apiCurrent.negative) };
    }
    var cfg = apiData && apiData['prompt_' + name];
    return cfg
      ? { positive: joinPromptList(cfg.positive), negative: joinPromptList(cfg.negative) }
      : { positive: '', negative: '' };
  }

  function loadApiPresets() {
    return Promise.all([apiGet(PRESET_DATA_KEY), apiGet(PRESET_LIST_KEY), apiGet(PROMPTS_KEY)]).then(function (res) {
      apiData = res[0] || {};
      apiNames = apiPresetNames(apiData, res[1] || {});
      apiCurrent = res[2] || { positive: [], negative: [] };
      renderPresetOptions();
      var hint = $('nisPresetHint');
      if (hint) {
        hint.textContent = apiNames.length
          ? ('已同步 ' + apiNames.length + ' 个生图 API 预设；选择后会填入正面 / 反面。')
          : '还没有生图 API 提示词预设；这里的正面 / 反面只保存在 Nano 生图室。';
      }
    }).catch(function () {
      var hint = $('nisPresetHint');
      if (hint) hint.textContent = '读取生图 API 提示词失败，可稍后重试。';
    });
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
      var raw = await file.text();
      return jsonPromptSections(raw) || textPromptSections(raw);
    }
    if (/\.docx$/.test(name)) return textPromptSections(await readDocxText(file));
    if (/\.doc$/.test(name)) return textPromptSections(readLegacyDocText(await file.arrayBuffer()));
    return textPromptSections(await file.text());
  }

  /* ---------- 表单 ---------- */
  function fillFields(pos, neg) {
    var p = $('nisPositive');
    var n = $('nisNegative');
    if (p) p.value = pos || '';
    if (n) n.value = neg || '';
  }
  function readFields() {
    return {
      positive: $('nisPositive') ? String($('nisPositive').value || '') : '',
      negative: $('nisNegative') ? String($('nisNegative').value || '') : ''
    };
  }
  function syncFromFields(keepSelection) {
    var v = readFields();
    state.basePositive = v.positive;
    state.baseNegative = v.negative;
    if (!keepSelection) {
      state.basePresetId = '';
      state.importedApiName = '';
      var sel = $('nisPreset');
      if (sel) sel.value = '';
    }
    save();
  }
  function applyNanoPreset(id) {
    var hit = state.presets.filter(function (p) { return p.id === id; })[0];
    if (!hit) return;
    fillFields(hit.positive || '', hit.negative || '');
    state.basePositive = hit.positive || '';
    state.baseNegative = hit.negative || '';
    state.basePresetId = id;
    state.importedApiName = '';
    save();
  }
  function applyApiPreset(name) {
    var cfg = apiConfig(name);
    fillFields(cfg.positive, cfg.negative);
    state.basePositive = cfg.positive;
    state.baseNegative = cfg.negative;
    state.basePresetId = '';
    state.importedApiName = name;
    save();
  }
  function savePreset(asNew) {
    var v = readFields();
    if (!v.positive.trim() && !v.negative.trim()) { savedLabel('先填写正面或反面提示词'); return; }
    var sel = $('nisPreset');
    var val = sel ? sel.value : '';
    var id = (val && val.indexOf('nano:') === 0) ? val.slice(5) : '';
    if (asNew || !id) {
      var name = '';
      try { name = prompt('预设名称', '我的画风'); } catch (e) { return; }
      if (name == null) return;
      name = String(name).replace(/\s+/g, ' ').trim().slice(0, 24);
      if (!name) { savedLabel('名字不能为空'); return; }
      var exist = state.presets.filter(function (p) { return p.name === name; })[0];
      if (exist) {
        exist.positive = v.positive;
        exist.negative = v.negative;
        state.basePresetId = exist.id;
      } else {
        var rec = { id: uid('pr'), name: name, positive: v.positive, negative: v.negative };
        state.presets.push(rec);
        state.basePresetId = rec.id;
      }
    } else {
      var hit = state.presets.filter(function (p) { return p.id === id; })[0];
      if (!hit) { savedLabel('预设不存在'); return; }
      hit.positive = v.positive;
      hit.negative = v.negative;
      state.basePresetId = hit.id;
    }
    state.importedApiName = '';
    state.basePositive = v.positive;
    state.baseNegative = v.negative;
    save();
    renderPresetOptions();
  }
  function deletePreset() {
    var sel = $('nisPreset');
    var val = sel ? sel.value : '';
    if (!val) { savedLabel('先选择一个预设'); return; }
    if (val.indexOf('api:') === 0) { savedLabel('生图 API 预设是只读的'); return; }
    var id = val.indexOf('nano:') === 0 ? val.slice(5) : val;
    var hit = state.presets.filter(function (p) { return p.id === id; })[0];
    if (!hit) return;
    if (!confirm('删除 Nano 预设「' + hit.name + '」？')) return;
    state.presets = state.presets.filter(function (p) { return p.id !== id; });
    if (state.basePresetId === id) state.basePresetId = '';
    save();
    renderPresetOptions();
    savedLabel('已删除预设');
  }

  function goBack() {
    try {
      if (history.length > 1) { history.back(); return; }
    } catch (e) {}
    location.href = 'nano-image.html';
  }

  function bind() {
    var back = $('nisBack');
    if (back) back.addEventListener('click', goBack);

    var use = $('nisUseBase');
    if (use) use.addEventListener('change', function () {
      state.useBasePrompt = !!this.checked;
      save();
    });
    ['nisPositive', 'nisNegative'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('input', function () { syncFromFields(false); });
    });
    var preset = $('nisPreset');
    if (preset) preset.addEventListener('change', function () {
      var v = this.value;
      if (!v) {
        state.basePresetId = '';
        state.importedApiName = '';
        save();
        return;
      }
      if (v.indexOf('nano:') === 0) applyNanoPreset(v.slice(5));
      else if (v.indexOf('api:') === 0) applyApiPreset(v.slice(4));
    });
    var add = $('nisAdd');
    if (add) add.addEventListener('click', function () { savePreset(true); });
    var saveBtn = $('nisSave');
    if (saveBtn) saveBtn.addEventListener('click', function () { savePreset(false); });
    var del = $('nisDelete');
    if (del) del.addEventListener('click', deletePreset);

    var importBtn = $('nisImport');
    var fileInput = $('nisImportFile');
    if (importBtn && fileInput) {
      importBtn.addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', async function () {
        var f = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        if (!f) return;
        if (f.size > 8 * 1024 * 1024) { savedLabel('文件不能超过 8MB'); return; }
        try {
          var parts = await readPromptSections(f);
          var pos = String(parts.positive || '').trim();
          var neg = String(parts.negative || '').trim();
          if (!pos && !neg) { savedLabel('文件里没有可导入的提示词'); return; }
          var cur = readFields();
          fillFields(cur.positive ? (cur.positive + '\n\n' + pos) : pos, cur.negative ? (cur.negative + '\n\n' + neg) : neg);
          syncFromFields(false);
          savedLabel('已导入提示词');
        } catch (err) {
          savedLabel((err && err.message) || '导入失败');
        }
      });
    }

    var clearBtn = $('nisClearSession');
    if (clearBtn) clearBtn.addEventListener('click', clearCurrentSession);
  }

  function currentSession() {
    if (!Array.isArray(state.sessions) || !state.sessions.length) return null;
    var hit = state.sessions.filter(function (s) { return s && s.id === state.currentId; })[0];
    return hit || state.sessions[0];
  }

  function clearCurrentSession() {
    var s = currentSession();
    if (!s) { savedLabel('当前没有可清空的窗口'); return; }
    if (!(s.items || []).length) { savedLabel('当前窗口没有记录'); return; }
    if (!confirm('清空当前窗口的聊天与生成记录？')) return;
    var ids = (s.items || []).map(function (x) { return x && x.id; });
    s.items = [];
    s.updatedAt = Math.max(Date.now(), (Number(s.updatedAt) || 0) + 1);
    save();
    tombstoneItems(ids);
    savedLabel('已清空本窗口记录');
  }

  function init() {
    hydrate().then(function () {
      bind();
      fillFields(state.basePositive, state.baseNegative);
      var use = $('nisUseBase');
      if (use) use.checked = state.useBasePrompt !== false;
      renderPresetOptions();
      loadApiPresets();
      window.addEventListener('pagehide', function () {
        if (idbTimer) { clearTimeout(idbTimer); idbTimer = null; }
        try { writeIdb(); } catch (e) {}
      });
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden && idbTimer) { clearTimeout(idbTimer); idbTimer = null; writeIdb(); }
      });
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: 'setTitle', title: '生图设置' }, '*');
          window.parent.postMessage({ type: 'pageLoaded', page: 'nano_image_settings' }, '*');
        }
      } catch (e) {}
    });
  }

  init();
})();
