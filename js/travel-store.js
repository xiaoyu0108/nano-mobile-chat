/* ============================================================
   js/travel-store.js — 「旅途」共享数据层
   ------------------------------------------------------------
   负责：
   - 按 user 面具隔离角色（nano_mask_data）
   - 角色出行 / 我的出行 / 我们共同的旅程
   - 与私聊互通：把旅途卡片写回 chat_messages_<charId>
   - 与长期记忆互通：把旅行总结写入 memlist_<charId>
   - 「一起去」邀请、旅程报备、随机拍立得状态
   ============================================================ */
(function () {
  'use strict';
  if (window.NanoTravelStore) return;

  var KEY = 'nano_travel_v1';
  var LS_KEY = 'nano_travel_v1_ls';
  var cache = null;
  var loading = null;

  function now() { return Date.now(); }
  function uid(prefix) {
    return (prefix || 'tr') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function dstr(d) {
    d = d instanceof Date ? d : new Date(d || Date.now());
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function hhmm(d) {
    d = d instanceof Date ? d : new Date(d || Date.now());
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function empty() {
    return { version: 1, lastCharId: '', updatedAt: 0, chars: {}, users: {} };
  }
  function normalize(o) {
    if (!o || typeof o !== 'object') return empty();
    if (!o.chars || typeof o.chars !== 'object') o.chars = {};
    if (!o.users || typeof o.users !== 'object') o.users = {};
    o.version = 1;
    return o;
  }
  function light(o) {
    try {
      return JSON.parse(JSON.stringify(o, function (k, v) {
        if (k === 'embedding') return undefined;
        if ((k === 'polaroid' || k === 'img' || k === 'imageUrl' || k === 'avatar') &&
            typeof v === 'string' && v.indexOf('data:') === 0 && v.length > 80000) return '';
        return v;
      }));
    } catch (e) { return empty(); }
  }
  function readLocal() {
    try {
      var raw = localStorage.getItem(LS_KEY) || localStorage.getItem(KEY);
      if (!raw) return null;
      return normalize(JSON.parse(raw));
    } catch (e) { return null; }
  }
  // 独立 KV：与 js/nano-idb.js 使用同一个数据库和 store
  var _kvPromise = null;
  function kvOpen() {
    if (_kvPromise) return _kvPromise;
    _kvPromise = new Promise(function (resolve, reject) {
      try {
        var req = indexedDB.open('nano_app_storage', 1);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error || new Error('indexedDB open failed')); };
      } catch (e) { reject(e); }
    }).catch(function (e) { _kvPromise = null; throw e; });
    return _kvPromise;
  }
  function kvGet(key) {
    return kvOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          var req = db.transaction('kv', 'readonly').objectStore('kv').get(key);
          req.onsuccess = function () { resolve(req.result === undefined ? null : req.result); };
          req.onerror = function () { reject(req.error); };
        } catch (e) { reject(e); }
      });
    }).catch(function () { return null; });
  }
  function kvSet(key, value) {
    return kvOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          var tx = db.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(value, key);
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { reject(tx.error); };
          tx.onabort = function () { reject(tx.error); };
        } catch (e) { reject(e); }
      });
    }).catch(function () { return false; });
  }
  function load(force) {
    if (cache && !force) return Promise.resolve(cache);
    if (loading && !force) return loading;
    loading = (async function () {
      try { await loadMask(force); } catch (e) {}
      var o = null;
      try {
        if (window.NanoIDB) o = await NanoIDB.get(KEY);
        else o = await kvGet(KEY);
      } catch (e) {}
      if (!o) o = readLocal();
      cache = normalize(o);
      return cache;
    })().then(function (v) { loading = null; return v; }, function () { loading = null; cache = cache || empty(); return cache; });
    return loading;
  }
  function save() {
    var d = normalize(cache || empty());
    d.updatedAt = now();
    var p;
    try {
      if (window.NanoIDB) p = NanoIDB.set(KEY, d).catch(function () {}).then(function () { return d; });
      else p = kvSet(KEY, d).then(function () { return d; });
    } catch (e) { p = Promise.resolve(d); }
    try {
      var txt = JSON.stringify(light(d));
      if (txt.length < 4300000) localStorage.setItem(LS_KEY, txt);
    } catch (e) {}
    return p;
  }

  /* ---------- 面具 / 角色 ---------- */
  var maskCache = null;
  var maskLoading = null;
  function readMaskLocal() {
    var keys = ['nano_mask_data', 'nano_home_data', 'peach_home_data'];
    for (var i = 0; i < keys.length; i++) {
      try {
        var raw = localStorage.getItem(keys[i]);
        if (!raw) continue;
        var d = JSON.parse(raw);
        if (d && Array.isArray(d.masks) && d.masks.length) return d;
      } catch (e) {}
    }
    return null;
  }
  function readMaskIdb() {
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.open('nano_mask_db');
        req.onupgradeneeded = function (e) {
          try {
            var db = e.target.result;
            if (!db.objectStoreNames.contains('mask_data')) db.createObjectStore('mask_data', { keyPath: 'key' });
          } catch (err) {}
        };
        req.onsuccess = function (e) {
          var db = e.target.result;
          try {
            if (!db.objectStoreNames.contains('mask_data')) { resolve(null); try { db.close(); } catch (err) {} return; }
            var r = db.transaction('mask_data', 'readonly').objectStore('mask_data').get('data');
            r.onsuccess = function () { resolve(r.result ? r.result.value : null); try { db.close(); } catch (err) {} };
            r.onerror = function () { resolve(null); try { db.close(); } catch (err) {} };
          } catch (err) { resolve(null); try { db.close(); } catch (e2) {} }
        };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }
  function maskFromData(d) {
    if (!d || !Array.isArray(d.masks) || !d.masks.length) {
      return { id: '', name: '我', setting: '', gender: '', nationality: '' };
    }
    var list = d.masks;
    var m = list.find(function (x) { return x && String(x.id) === String(d.currentMaskId); }) || list[0] || {};
    return {
      id: m.id == null ? '' : String(m.id),
      name: m.name || '我',
      setting: String(m.setting || ''),
      gender: String(m.gender || ''),
      nationality: String(m.nationality || ''),
      mask: m,
      data: d
    };
  }
  function mergeMaskData(local, idb) {
    var l = local && Array.isArray(local.masks) ? local : null;
    var i = idb && Array.isArray(idb.masks) ? idb : null;
    if (!l || !l.masks.length) return (i && i.masks.length) ? i : null;
    if (!i || !i.masks.length) return l;
    var iNewer = Number(i.updatedAt || 0) > Number(l.updatedAt || 0) ||
      (Number(i.updatedAt || 0) === Number(l.updatedAt || 0) && i.masks.length > l.masks.length);
    var newer = iNewer ? i : l;
    var older = iNewer ? l : i;
    var list = newer.masks.slice();
    older.masks.forEach(function (m) {
      if (m && !list.some(function (x) { return String(x.id) === String(m.id); })) list.push(m);
    });
    return Object.assign({}, newer, {
      masks: list,
      currentMaskId: newer.currentMaskId || older.currentMaskId || (list[0] && list[0].id)
    });
  }
  function loadMask(force) {
    if (maskCache && !force) return Promise.resolve(maskCache);
    if (maskLoading && !force) return maskLoading;
    maskLoading = (async function () {
      var local = readMaskLocal();
      var idb = await readMaskIdb();
      var chosen = mergeMaskData(local, idb) || { masks: [], currentMaskId: null };
      maskCache = maskFromData(chosen);
      try { localStorage.setItem('nano_mask_data', JSON.stringify(chosen)); } catch (e) {}
      return maskCache;
    })().then(function (v) { maskLoading = null; return v; }, function () { maskLoading = null; maskCache = maskFromData(readMaskLocal()); return maskCache; });
    return maskLoading;
  }
  function getMask() {
    return maskCache || maskFromData(readMaskLocal());
  }
  function loadCharactersFromDB() {
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.open('nano_characters_db');
        req.onupgradeneeded = function (e) {
          try {
            var db = e.target.result;
            if (!db.objectStoreNames.contains('characters')) db.createObjectStore('characters', { keyPath: 'id' });
          } catch (err) {}
        };
        req.onsuccess = function (e) {
          var db = e.target.result;
          try {
            if (!db.objectStoreNames.contains('characters')) { resolve([]); return; }
            var r = db.transaction('characters', 'readonly').objectStore('characters').getAll();
            r.onsuccess = function () { resolve(r.result || []); try { db.close(); } catch (err) {} };
            r.onerror = function () { resolve([]); try { db.close(); } catch (err) {} };
          } catch (err) { resolve([]); }
        };
        req.onerror = function () { resolve([]); };
        req.onblocked = function () { resolve([]); };
        setTimeout(function () { try { resolve([]); } catch (e) {} }, 8000);
      } catch (e) { resolve([]); }
    });
  }
  function loadChars() {
    return loadMask(false).then(function (mask) {
      return loadCharactersFromDB().then(function (all) {
        var list = (all || []).filter(function (c) {
          if (!c || c.id == null || !c.name || c.nanoAssistant) return false;
          if (!mask || !mask.id) return true;
          var b = String(c.bindUser || ''), mid = String(mask.id || '');
          return !b || b === mid || b.replace(/^m/i, '') === mid.replace(/^m/i, '');
        });
        return list.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'zh'); });
      });
    }).catch(function () { return []; });
  }
  function getCharData(cid) {
    var d = normalize(cache || loadCachedSync());
    var id = String(cid);
    if (!d.chars[id]) {
      d.chars[id] = {
        settings: { charId: id, name: '', avatar: '', persona: '', bindUser: '' },
        trips: [], pendingReports: [], lastPolaroidAt: 0, lastReportAt: 0, lastChatAt: 0
      };
    }
    var c = d.chars[id];
    if (!Array.isArray(c.trips)) c.trips = [];
    if (!Array.isArray(c.pendingReports)) c.pendingReports = [];
    if (!c.settings) c.settings = { charId: id };
    return c;
  }
  function loadCachedSync() { return cache || readLocal() || empty(); }
  function ensureChar(c) {
    if (!c || c.id == null) return null;
    var d = normalize(cache || loadCachedSync());
    var cid = String(c.id);
    if (!d.chars[cid]) d.chars[cid] = { settings: {}, trips: [], pendingReports: [] };
    var cd = d.chars[cid];
    cd.settings = Object.assign({}, cd.settings || {}, {
      charId: cid,
      name: c.name || (cd.settings && cd.settings.name) || '',
      avatar: c.avatar || (cd.settings && cd.settings.avatar) || '',
      persona: String(c.setting || c.desc || c.persona || (cd.settings && cd.settings.persona) || ''),
      bindUser: c.bindUser == null ? ((cd.settings && cd.settings.bindUser) || '') : String(c.bindUser),
      nationality: String(c.nationality || (cd.settings && cd.settings.nationality) || '')
    });
    if (!Array.isArray(cd.trips)) cd.trips = [];
    cache = d;
    return cd;
  }
  function userData(uid) {
    var d = normalize(cache || loadCachedSync());
    var id = String(uid || getMask().id || 'default');
    if (!d.users[id]) d.users[id] = { name: '', trips: [], together: [] };
    var u = d.users[id];
    if (!Array.isArray(u.trips)) u.trips = [];
    if (!Array.isArray(u.together)) u.together = [];
    cache = d;
    return u;
  }
  function ensureUser(name) {
    var mask = getMask();
    var u = userData(mask.id);
    u.name = name || mask.name || u.name || '我';
    u.maskId = mask.id;
    u.persona = mask.setting || u.persona || '';
    cache = normalize(cache);
    return u;
  }

  /* ---------- 出行记录 ---------- */
  function listCharTrips(cid) {
    var cd = getCharData(cid);
    return cd.trips.slice().sort(function (a, b) {
      return String((b.date || '') + (b.time || '')).localeCompare(String((a.date || '') + (a.time || '')));
    });
  }
  function listUserTrips(uid) {
    var u = userData(uid || getMask().id);
    return u.trips.slice().sort(function (a, b) {
      return String((b.date || '') + (b.time || '')).localeCompare(String((a.date || '') + (a.time || '')));
    });
  }
  function listTogether(uid, cid) {
    var u = userData(uid || getMask().id);
    return u.together.filter(function (p) {
      return !cid || String(p.charId || '') === String(cid);
    }).sort(function (a, b) {
      return String(b.date || '').localeCompare(String(a.date || ''));
    });
  }
  function addCharTrip(cid, trip) {
    var cd = getCharData(cid);
    trip = Object.assign({}, trip || {});
    trip.id = trip.id || uid('trip');
    trip.owner = 'char';
    trip.charId = String(cid);
    trip.createdAt = trip.createdAt || now();
    cd.trips.push(trip);
    return save().then(function () { return trip; });
  }
  function addUserTrip(uid, trip) {
    var u = userData(uid || getMask().id);
    trip = Object.assign({}, trip || {});
    trip.id = trip.id || uid('trip');
    trip.owner = 'me';
    trip.userId = String(uid || getMask().id || '');
    trip.createdAt = trip.createdAt || now();
    u.trips.push(trip);
    return save().then(function () { return trip; });
  }
  function addTogether(uid, cid, trip) {
    var u = userData(uid || getMask().id);
    trip = Object.assign({}, trip || {});
    trip.id = trip.id || uid('us');
    trip.owner = 'us';
    trip.charId = String(cid || '');
    trip.userId = String(uid || getMask().id || '');
    trip.createdAt = trip.createdAt || now();
    u.together.push(trip);
    return save().then(function () { return trip; });
  }
  function updateTrip(tripId, patch) {
    var d = normalize(cache || loadCachedSync());
    var found = null;
    Object.keys(d.chars).forEach(function (cid) {
      (d.chars[cid].trips || []).forEach(function (t) { if (t && String(t.id) === String(tripId)) found = t; });
    });
    Object.keys(d.users).forEach(function (uid2) {
      var u = d.users[uid2];
      (u.trips || []).forEach(function (t) { if (t && String(t.id) === String(tripId)) found = t; });
      (u.together || []).forEach(function (t) { if (t && String(t.id) === String(tripId)) found = t; });
    });
    if (!found) return Promise.resolve(null);
    Object.assign(found, patch || {});
    return save().then(function () { return found; });
  }
  function deleteTrip(tripId) {
    var d = normalize(cache || loadCachedSync());
    var hit = false;
    Object.keys(d.chars).forEach(function (cid) {
      var before = (d.chars[cid].trips || []).length;
      d.chars[cid].trips = (d.chars[cid].trips || []).filter(function (t) {
        return !(t && (String(t.id) === String(tripId) || String(t.tripId || '') === String(tripId)));
      });
      if ((d.chars[cid].trips || []).length !== before) hit = true;
    });
    Object.keys(d.users).forEach(function (uid2) {
      var u = d.users[uid2];
      var b1 = (u.trips || []).length;
      u.trips = (u.trips || []).filter(function (t) {
        return !(t && (String(t.id) === String(tripId) || String(t.tripId || '') === String(tripId)));
      });
      var b2 = (u.together || []).length;
      u.together = (u.together || []).filter(function (t) {
        return !(t && (String(t.id) === String(tripId) || String(t.tripId || '') === String(tripId)));
      });
      if ((u.trips || []).length !== b1 || (u.together || []).length !== b2) hit = true;
    });
    cache = d;
    return hit ? save() : Promise.resolve(d);
  }
  function findTrip(tripId) {
    var d = normalize(cache || loadCachedSync());
    var out = null;
    Object.keys(d.chars).forEach(function (cid) {
      (d.chars[cid].trips || []).forEach(function (t) {
        if (t && (String(t.id) === String(tripId) || String(t.tripId || '') === String(tripId))) out = { trip: t, kind: 'char', charId: cid };
      });
    });
    Object.keys(d.users).forEach(function (uid2) {
      var u = d.users[uid2];
      (u.trips || []).forEach(function (t) {
        if (t && (String(t.id) === String(tripId) || String(t.tripId || '') === String(tripId))) out = { trip: t, kind: 'me', userId: uid2 };
      });
      (u.together || []).forEach(function (t) {
        if (t && (String(t.id) === String(tripId) || String(t.tripId || '') === String(tripId))) out = { trip: t, kind: 'us', userId: uid2, charId: t.charId };
      });
    });
    return out;
  }

  /* ---------- 报备 ---------- */
  function addPendingReport(cid, report) {
    var cd = getCharData(cid);
    var item = Object.assign({}, report || {});
    item.id = item.id || uid('report');
    item.charId = String(cid);
    item.at = item.at || now();
    item.delivered = false;
    cd.pendingReports.push(item);
    if (cd.pendingReports.length > 30) cd.pendingReports = cd.pendingReports.slice(-30);
    return save().then(function () {
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: 'nanoTravelReportPending', charId: String(cid) }, '*');
        }
      } catch (e) {}
      return item;
    });
  }
  function takePendingReports(cid) {
    var cd = getCharData(cid);
    var out = [];
    cd.pendingReports.forEach(function (r) {
      if (!r || r.delivered) return;
      r.delivered = true;
      out.push(r);
    });
    if (!out.length) return Promise.resolve([]);
    return save().then(function () { return out; });
  }
  function listPendingReports(cid) {
    return getCharData(cid).pendingReports.filter(function (r) { return r && !r.delivered; });
  }

  /* ---------- 随机拍立得 / 报备节流 ---------- */
  function polaroidState() {
    var mask = getMask();
    var key = 'nano_travel_polaroid_' + (mask.id || 'default');
    try { return JSON.parse(localStorage.getItem(key) || 'null') || {}; } catch (e) { return {}; }
  }
  function savePolaroidState(o) {
    var mask = getMask();
    var key = 'nano_travel_polaroid_' + (mask.id || 'default');
    try { localStorage.setItem(key, JSON.stringify(o || {})); } catch (e) {}
  }
  function recentChatChars(hours) {
    var act = {};
    try { act = JSON.parse(localStorage.getItem('nano_chat_activity') || '{}') || {}; } catch (e) { act = {}; }
    var cutoff = now() - (Number(hours) || 24) * 3600 * 1000;
    return Object.keys(act).filter(function (id) { return Number(act[id]) >= cutoff; });
  }
  function lastChatAt(cid) {
    try {
      var act = JSON.parse(localStorage.getItem('nano_chat_activity') || '{}') || {};
      return Number(act[String(cid)] || 0);
    } catch (e) { return 0; }
  }

  /* ---------- 长期记忆（向量库） ---------- */
  function openMemDB() {
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.open('nano_vector_memory_db');
        req.onupgradeneeded = function (e) {
          try {
            var db = e.target.result;
            if (!db.objectStoreNames.contains('memories')) db.createObjectStore('memories', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('config')) db.createObjectStore('config', { keyPath: 'key' });
            if (!db.objectStoreNames.contains('chat_state')) db.createObjectStore('chat_state', { keyPath: 'chatId' });
            if (!db.objectStoreNames.contains('chat_messages')) db.createObjectStore('chat_messages', { keyPath: 'chatId' });
          } catch (err) {}
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }
  function memGetListDirect(cid) {
    return openMemDB().then(function (db) {
      return new Promise(function (resolve) {
        if (!db) { resolve([]); return; }
        try {
          var r = db.transaction('config', 'readonly').objectStore('config').get('memlist_' + String(cid));
          r.onsuccess = function () { resolve(r.result && Array.isArray(r.result.value) ? r.result.value : []); try { db.close(); } catch (e) {} };
          r.onerror = function () { resolve([]); try { db.close(); } catch (e) {} };
        } catch (e) { resolve([]); try { db.close(); } catch (e2) {} }
      });
    });
  }
  function memPutListDirect(cid, list) {
    return openMemDB().then(function (db) {
      return new Promise(function (resolve) {
        if (!db) { resolve(false); return; }
        try {
          var tx = db.transaction('config', 'readwrite');
          tx.objectStore('config').put({ key: 'memlist_' + String(cid), value: list });
          tx.oncomplete = function () { resolve(true); try { db.close(); } catch (e) {} };
          tx.onerror = function () { resolve(false); try { db.close(); } catch (e) {} };
        } catch (e) { resolve(false); try { db.close(); } catch (e2) {} }
      });
    });
  }
  function readMemories(cid) {
    if (window.NanoMemLink && NanoMemLink.readList) {
      return NanoMemLink.readList(cid).catch(function () { return memGetListDirect(cid); });
    }
    return memGetListDirect(cid);
  }
  function appendMemory(charId, item) {
    if (window.NanoMemLink && NanoMemLink.append) {
      return NanoMemLink.append(charId, [item]).catch(function () { return false; });
    }
    return memGetListDirect(charId).then(function (list) {
      if (list.some(function (x) { return x && x.id === item.id; })) return true;
      list.push(item);
      return memPutListDirect(charId, list);
    });
  }
  function readTravelMemories(charId) {
    return readMemories(charId).then(function (list) {
      return (list || []).filter(function (it) {
        return it && (it.source === 'travel' || it.travelMeta);
      }).sort(function (a, b) { return Number(b.ts || 0) - Number(a.ts || 0); });
    });
  }
  function addTravelMemory(opts) {
    opts = opts || {};
    var ts = Number(opts.ts) || now();
    var charId = String(opts.charId || '');
    var item = {
      id: 'mem_tr_' + ts.toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      type: '共同经历',
      content: String(opts.summary || '').trim(),
      embedding: Array.isArray(opts.embedding) ? opts.embedding : null,
      hasVector: !!(opts.embedding && opts.embedding.length),
      ts: ts,
      date: new Date(ts).toISOString(),
      relatedChar: String(opts.charName || ''),
      chatId: charId,
      source: 'travel',
      importance: 4,
      travelMeta: Object.assign({
        charId: charId,
        userId: String(opts.userId || ''),
        tripId: String(opts.tripId || ''),
        date: String(opts.date || dstr(ts)),
        places: Array.isArray(opts.places) ? opts.places : []
      }, opts.meta || {})
    };
    return appendMemory(charId, item).then(function () { return item; });
  }

  /* ---------- 私聊消息互通 ---------- */
  function readChatMessages(charId) {
    var key = 'chat_messages_' + String(charId);
    function fromLocalForage() {
      if (typeof localforage === 'undefined' || !localforage.getItem) return Promise.resolve(null);
      return localforage.getItem(key).catch(function () { return null; });
    }
    return fromLocalForage().then(function (arr) {
      if (Array.isArray(arr) && arr.length) return arr;
      if (window.NanoMemLink && NanoMemLink.readMessages) {
        return NanoMemLink.readMessages(charId).catch(function () { return []; });
      }
      return [];
    }).then(function (arr) {
      if (Array.isArray(arr) && arr.length) return arr;
      try { var raw = localStorage.getItem(key); if (raw) { var l = JSON.parse(raw); if (Array.isArray(l)) return l; } } catch (e) {}
      return [];
    });
  }
  function writeChatMessages(charId, list) {
    var key = 'chat_messages_' + String(charId);
    var tasks = [];
    try { if (typeof localforage !== 'undefined') tasks.push(localforage.setItem(key, list).catch(function () {})); } catch (e) {}
    try { localStorage.setItem(key, JSON.stringify(list.slice(-200))); } catch (e) {}
    tasks.push(openMemDB().then(function (db) {
      return new Promise(function (resolve) {
        if (!db) { resolve(false); return; }
        try {
          var tx = db.transaction('chat_messages', 'readwrite');
          tx.objectStore('chat_messages').put({ chatId: String(charId), messages: list, updatedAt: now() });
          tx.oncomplete = function () { resolve(true); try { db.close(); } catch (e) {} };
          tx.onerror = function () { resolve(false); try { db.close(); } catch (e) {} };
        } catch (e) { resolve(false); try { db.close(); } catch (e2) {} }
      });
    }));
    try {
      var act = JSON.parse(localStorage.getItem('nano_chat_activity') || '{}') || {};
      act[String(charId)] = now();
      localStorage.setItem('nano_chat_activity', JSON.stringify(act));
    } catch (e) {}
    return Promise.all(tasks);
  }
  function notifyCard(charId, msg) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'nanoTravelCardAdded', charId: String(charId), message: msg }, '*');
      }
    } catch (e) {}
    try { window.dispatchEvent(new CustomEvent('nanoTravelCardAdded', { detail: { charId: String(charId), message: msg } })); } catch (e) {}
  }
  function appendChatMessage(charId, msg) {
    if (!charId || !msg) return Promise.resolve(false);
    return readChatMessages(charId).then(function (list) {
      if (list.some(function (m) { return m && String(m.id) === String(msg.id); })) return list;
      list.push(msg);
      return writeChatMessages(charId, list).then(function () { notifyCard(charId, msg); return list; });
    });
  }
  function baseMessage(fields) {
    var t = now();
    return Object.assign({
      id: uid('msg'),
      type: 'left',
      text: '',
      time: hhmm(t),
      status: null,
      recalled: false,
      isCard: true,
      cardData: {},
      isVoice: false,
      voiceData: null,
      isImage: false,
      imageData: null,
      quote: null,
      transcript: null,
      translation: null,
      favorite: false,
      turn: null,
      ts: t
    }, fields || {});
  }
  function appendSystemNotice(charId, text) {
    var msg = baseMessage({
      type: 'right', text: String(text || ''), isCard: false,
      cardData: { systemNotice: true }
    });
    return appendChatMessage(charId, msg);
  }
  function shareTripToChat(opts) {
    opts = opts || {};
    var cid = String(opts.charId || '');
    if (!cid || !opts.trip) return Promise.resolve(false);
    var trip = opts.trip || {};
    var mask = getMask();
    var card = {
      cardType: 'travelShare',
      travelKind: 'share',
      direction: 'user',
      status: 'sent',
      tripId: String(trip.tripId || trip.id || ''),
      title: String(trip.place || trip.to || trip.title || '一段旅程'),
      place: String(trip.place || trip.to || ''),
      date: String(trip.date || ''),
      thought: String(opts.thought || trip.noteMe || trip.noteChar || trip.thought || trip.note || ''),
      caption: String(trip.caption || ''),
      img: String(trip.polaroid || ''),
      note: String(opts.message || '').trim(),
      fromName: String(opts.fromName || mask.name || '我'),
      sharedAt: now()
    };
    var msg = baseMessage({ type: 'right', cardData: card, text: '' });
    return appendChatMessage(cid, msg).then(function () { return msg; });
  }
  function sendInvite(opts) {
    opts = opts || {};
    var cid = String(opts.charId || '');
    if (!cid) return Promise.resolve(false);
    var mask = getMask();
    var t = now();
    var card = {
      cardType: 'travelInvite',
      travelKind: 'invite',
      direction: 'user',
      status: 'pending',
      inviteId: uid('invite'),
      dest: String(opts.dest || '').trim(),
      date: String(opts.date || dstr(t)),
      time: String(opts.time || ''),
      days: String(opts.days || '1'),
      note: String(opts.note || '').trim(),
      fromName: String(opts.fromName || mask.name || '我'),
      toName: String(opts.toName || ''),
      tripId: '',
      createdAt: t
    };
    var msg = baseMessage({ type: 'right', cardData: card, text: '' });
    return appendChatMessage(cid, msg).then(function () { return msg; });
  }
  function updateChatCard(charId, cardId, patch) {
    return readChatMessages(charId).then(function (list) {
      var changed = null;
      list.forEach(function (m) {
        if (!m || !m.cardData) return;
        if (String(m.id) === String(cardId) || String(m.cardData.inviteId || '') === String(cardId) ||
            String(m.cardData.tripId || '') === String(cardId)) {
          Object.assign(m.cardData, patch || {});
          changed = m;
        }
      });
      if (!changed) return null;
      return writeChatMessages(charId, list).then(function () {
        try {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'nanoTravelUpdated', charId: String(charId), cardId: String(cardId), patch: patch || {} }, '*');
          }
        } catch (e) {}
        return changed;
      });
    });
  }

  window.NanoTravelStore = {
    KEY: KEY,
    load: load,
    save: save,
    reload: function () { return load(true); },
    uid: uid,
    dstr: dstr,
    hhmm: hhmm,
    now: now,
    getMask: getMask,
    loadMask: loadMask,
    loadChars: loadChars,
    ensureChar: ensureChar,
    ensureUser: ensureUser,
    userData: userData,
    getCharData: getCharData,
    listCharTrips: listCharTrips,
    listUserTrips: listUserTrips,
    listTogether: listTogether,
    addCharTrip: addCharTrip,
    addUserTrip: addUserTrip,
    addTogether: addTogether,
    updateTrip: updateTrip,
    deleteTrip: deleteTrip,
    findTrip: findTrip,
    addPendingReport: addPendingReport,
    takePendingReports: takePendingReports,
    listPendingReports: listPendingReports,
    polaroidState: polaroidState,
    savePolaroidState: savePolaroidState,
    recentChatChars: recentChatChars,
    lastChatAt: lastChatAt,
    readMemories: readMemories,
    readTravelMemories: readTravelMemories,
    addTravelMemory: addTravelMemory,
    readChatMessages: readChatMessages,
    writeChatMessages: writeChatMessages,
    appendChatMessage: appendChatMessage,
    appendSystemNotice: appendSystemNotice,
    shareTripToChat: shareTripToChat,
    sendInvite: sendInvite,
    updateChatCard: updateChatCard,
    baseMessage: baseMessage
  };
})();
