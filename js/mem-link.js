/* ============================================================
   mem-link.js — 大号 / 小号 记忆库互通
   ------------------------------------------------------------
   背景：角色的「小号试探」会在角色库里生成一个独立角色
   （isAltProbe:true 且 altOriginId=<大号 id>）。它其实和「大号」
   是同一个人，但原本各存一份 memlist_<charId>，记忆互不可见。

   融合规则（同一个人共用一个记忆库）：
     - 家族 = 大号 id + 所有 altOriginId===大号id 的小号 id
     - 读取：返回整个家族记忆的并集（按 id 去重）——大号能看到
       小号的记忆，小号也能看到大号的记忆。
     - 写入：统一写进「大号」的 memlist_<originId>，即
       「小号的记忆计入大号记忆库」；小号旧数据仍会被读取合并。

   本文件不依赖任何模块，自带 IndexedDB 读写，供聊天 / 线下 /
   iMessage / 辅助场景 / 记忆宫殿等复用。
   ============================================================ */
(function () {
  'use strict';
  if (window.NanoMemLink) return;

  var CHAR_DB = 'nano_characters_db';
  var MEM_DB = 'nano_vector_memory_db';

  var _charMap = null;
  var _originCache = {};

  function openDB(name, upgrade) {
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.open(name);
        req.onupgradeneeded = function (e) { try { upgrade && upgrade(e.target.result, e.target.transaction); } catch (_) {} };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }

  function loadChars() {
    if (_charMap) return Promise.resolve(_charMap);
    return openDB(CHAR_DB, function (db) {
      if (!db.objectStoreNames.contains('characters')) db.createObjectStore('characters', { keyPath: 'id' });
    }).then(function (db) {
      return new Promise(function (resolve) {
        if (!db) { _charMap = {}; resolve(_charMap); return; }
        try {
          var r = db.transaction('characters', 'readonly').objectStore('characters').getAll();
          r.onsuccess = function () {
            var m = {};
            (r.result || []).forEach(function (c) { if (c && c.id != null) m[String(c.id)] = c; });
            _charMap = m; resolve(m);
            try { db.close(); } catch (e) {}
          };
          r.onerror = function () { _charMap = {}; resolve(_charMap); try { db.close(); } catch (e) {} };
        } catch (e) { _charMap = {}; resolve(_charMap); try { db.close(); } catch (e2) {} }
      });
    });
  }

  function originIdOfSync(charId) {
    if (charId == null) return charId;
    var id = String(charId);
    if (_originCache[id] !== undefined) return _originCache[id];
    var c = _charMap && _charMap[id];
    var origin = id;
    if (c && c.isAltProbe && c.altOriginId && _charMap[String(c.altOriginId)]) origin = String(c.altOriginId);
    _originCache[id] = origin;
    return origin;
  }

  function originIdOf(charId) {
    return loadChars().then(function () { return originIdOfSync(charId); });
  }

  // 家族成员 id：[大号, 该大号名下所有小号]
  function familyIdsSync(charId) {
    var origin = originIdOfSync(charId);
    var ids = [origin];
    if (_charMap) {
      Object.keys(_charMap).forEach(function (id) {
        var c = _charMap[id];
        if (c && c.isAltProbe && c.altOriginId && String(c.altOriginId) === origin && id !== origin) ids.push(id);
      });
    }
    return ids;
  }

  function familyIds(charId) {
    return loadChars().then(function () { return familyIdsSync(charId); });
  }

  function memOpen() {
    return openDB(MEM_DB, function (db) {
      if (!db.objectStoreNames.contains('memories')) db.createObjectStore('memories', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('config')) db.createObjectStore('config', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('chat_state')) db.createObjectStore('chat_state', { keyPath: 'chatId' });
      if (!db.objectStoreNames.contains('chat_messages')) db.createObjectStore('chat_messages', { keyPath: 'chatId' });
    });
  }

  function dbGetList(db, key) {
    return new Promise(function (resolve) {
      if (!db) { resolve([]); return; }
      try {
        var r = db.transaction('config', 'readonly').objectStore('config').get(key);
        r.onsuccess = function () { resolve((r.result && Array.isArray(r.result.value)) ? r.result.value : []); };
        r.onerror = function () { resolve([]); };
      } catch (e) { resolve([]); }
    });
  }

  function dbPutList(db, key, value) {
    return new Promise(function (resolve) {
      if (!db) { resolve(false); return; }
      try {
        var tx = db.transaction('config', 'readwrite');
        tx.objectStore('config').put({ key: key, value: value });
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
      } catch (e) { resolve(false); }
    });
  }

  function keyOf(it) {
    if (!it) return null;
    if (it.id != null && it.id !== '') return 'i:' + it.id;
    var txt = String(it.content || it.text || '').trim();
    if (!txt) return null;
    return 't:' + (it.chatId || '') + ':' + txt;
  }

  // 读取整个家族的记忆并集（去重）
  function readList(charId) {
    return loadChars().then(function () {
      var ids = familyIdsSync(charId);
      return memOpen().then(function (db) {
        return Promise.all(ids.map(function (id) { return dbGetList(db, 'memlist_' + id); })).then(function (lists) {
          var seen = {}, out = [];
          lists.forEach(function (list) {
            (list || []).forEach(function (it) {
              if (!it) return;
              var k = keyOf(it);
              if (k && seen[k]) return;
              if (k) seen[k] = 1;
              out.push(it);
            });
          });
          try { db.close(); } catch (e) {}
          return out;
        });
      });
    }).catch(function () { return []; });
  }

  // 写入统一归到「大号」的记忆库
  function append(charId, items) {
    items = Array.isArray(items) ? items : [items];
    items = items.filter(Boolean);
    if (!items.length) return Promise.resolve(false);
    return originIdOf(charId).then(function (origin) {
      return memOpen().then(function (db) {
        return dbGetList(db, 'memlist_' + origin).then(function (list) {
          var seen = {}, seenText = {};
          list.forEach(function (it) {
            var k = keyOf(it);
            if (k) seen[k] = 1;
            var txt = normalize(textOf(it));
            if (txt) seenText[String((it && it.groupId) || '') + '|' + txt] = 1;
          });
          items.forEach(function (it) {
            var k = keyOf(it);
            if (k && seen[k]) return;
            var txt = normalize(textOf(it));
            var tk = txt ? (String((it && it.groupId) || '') + '|' + txt) : '';
            if (tk && seenText[tk]) return;
            if (k) seen[k] = 1;
            if (tk) seenText[tk] = 1;
            list.push(it);
          });
          return dbPutList(db, 'memlist_' + origin, list).then(function (ok) { try { db.close(); } catch (e) {} return ok; });
        });
      });
    }).catch(function () { return false; });
  }

  function memTs(it) {
    if (!it) return 0;
    var n = Number(it.ts || it.at || it.time);
    if (isFinite(n) && n > 0) return n;
    var d = Date.parse(it.date || it.time || '');
    return isFinite(d) ? d : 0;
  }

  function textOf(it) {
    return String((it && (it.content || it.text)) || '').trim();
  }

  function normalize(s) {
    return String(s || '').toLowerCase()
      .replace(/[\s，。！？、,.!?;；:："'“”‘’（）()【】\[\]…—\-_/\\|]+/g, ' ')
      .trim();
  }

  function queryTerms(q) {
    q = normalize(q);
    if (!q) return [];
    var out = {};
    q.split(/\s+/).filter(Boolean).forEach(function (p) {
      if (/^[a-z0-9]+$/.test(p)) {
        if (p.length >= 2) out[p] = 1;
        return;
      }
      if (p.length <= 6) out[p] = 1;
      var max = Math.min(4, p.length);
      for (var n = 2; n <= max; n++) {
        for (var i = 0; i + n <= p.length; i++) out[p.slice(i, i + n)] = 1;
      }
    });
    return Object.keys(out).slice(0, 60);
  }

  function isSpecial(it) {
    if (!it) return false;
    var t = String(it.type || '') + ' ' + textOf(it);
    if (Number(it.importance) < 4 && !it.sourceText) return false;
    return /原话|承诺|答应|约定|表白|吵架|和好|分手|道歉|说过|重要事件|纪念日|求婚|结婚|一直爱|永远|不会离开|等你|别走|回来|对不起|原谅/.test(t);
  }

  function scoreItem(it, terms, now) {
    var txt = normalize(textOf(it));
    var s = (Number(it && it.importance) || 3) * 12;
    var ts = memTs(it);
    if (ts > 0) {
      var days = Math.max(0, now - ts) / 86400000;
      s += Math.max(0, 24 - Math.min(24, days / 12));
    }
    if (terms && terms.length) {
      var hits = 0;
      terms.forEach(function (t) { if (t && txt.indexOf(t) > -1) hits++; });
      s += Math.min(60, hits * 8);
      if (!hits) s -= 18;
    }
    if (isSpecial(it)) s += 30;
    if (it && (it.sourceText || it.sourceSpeaker)) s += 22;
    return s;
  }

  function buildRecall(list, opts) {
    opts = opts || {};
    var now = Number(opts.now) || Date.now();
    var terms = queryTerms(opts.query || '');
    var maxItems = Math.max(4, Math.min(80, Number(opts.maxItems) || 32));
    var maxAnchors = Math.max(2, Math.min(20, Number(opts.maxAnchors) || 10));
    var includeGroups = !!opts.includeGroups;
    var priv = (list || []).filter(function (it) { return it && (includeGroups || !it.groupId); });
    var seen = {};
    var out = [];
    function keyOfItem(it) {
      var txt = normalize(textOf(it));
      if (txt) return 't:' + txt;
      return String(it.id != null && it.id !== '' ? ('i:' + it.id) : 'x:');
    }
    function add(it) {
      var k = keyOfItem(it);
      if (seen[k]) return;
      seen[k] = 1;
      out.push(it);
    }
    var anchors = priv.filter(isSpecial).sort(function (a, b) { return memTs(b) - memTs(a); }).slice(0, maxAnchors);
    anchors.forEach(add);
    var scored = priv.map(function (it) { return { it: it, s: scoreItem(it, terms, now) }; })
      .sort(function (a, b) { return b.s - a.s; });
    priv.filter(function (it) { return Number(it.importance) >= 4; })
      .sort(function (a, b) { return memTs(b) - memTs(a); })
      .forEach(function (it) { if (out.length < maxItems) add(it); });
    if (terms.length) {
      scored.forEach(function (r) { if (out.length < maxItems && r.s > 60) add(r.it); });
    }
    priv.slice().sort(function (a, b) { return memTs(b) - memTs(a); })
      .slice(0, Math.max(12, Math.ceil(maxItems / 2)))
      .forEach(function (it) { if (out.length < maxItems) add(it); });
    scored.forEach(function (r) { if (out.length < maxItems) add(r.it); });
    return {
      items: out.sort(function (a, b) { return memTs(b) - memTs(a); }),
      anchors: anchors,
      terms: terms
    };
  }

  function findQuote(list, query) {
    var q = String(query || '').trim();
    var qn = normalize(q);
    var pool = (list || []).filter(Boolean);
    var terms = q ? queryTerms(q) : [];
    var best = null, bestScore = -1;
    pool.forEach(function (it) {
      var txt = textOf(it), tn = normalize(txt);
      var s = Number(it.importance) || 0;
      if (isSpecial(it)) s += 20;
      if (q) {
        var matched = false;
        if (txt.indexOf(q) > -1) { s += 100; matched = true; }
        else if (qn && tn.indexOf(qn) > -1) { s += 70; matched = true; }
        var hits = 0;
        terms.forEach(function (t) { if (t && tn.indexOf(t) > -1) hits++; });
        if (hits) { s += hits * 5; matched = true; }
        if (!matched) return;
      }
      if (s > bestScore) { bestScore = s; best = it; }
    });
    return best;
  }

  window.NanoMemLink = {
    memTs: memTs,
    textOf: textOf,
    isSpecial: isSpecial,
    buildRecall: buildRecall,
    findQuote: findQuote,
    originIdOf: originIdOf,
    originIdOfSync: originIdOfSync,
    familyIds: familyIds,
    familyIdsSync: familyIdsSync,
    readList: readList,
    append: append,
    getChar: function (charId) {
      return loadChars().then(function () { return (_charMap && _charMap[String(charId)]) || null; });
    },
    readMessages: function (charId) {
      return memOpen().then(function (db) {
        return new Promise(function (resolve) {
          if (!db) { resolve([]); return; }
          try {
            var r = db.transaction('chat_messages', 'readonly').objectStore('chat_messages').get(String(charId));
            r.onsuccess = function () {
              var rec = r.result;
              resolve((rec && Array.isArray(rec.messages)) ? rec.messages : []);
              try { db.close(); } catch (e) {}
            };
            r.onerror = function () { resolve([]); try { db.close(); } catch (e) {} };
          } catch (e) { resolve([]); try { db.close(); } catch (e2) {} }
        });
      }).catch(function () { return []; });
    },
    invalidate: function () { _charMap = null; _originCache = {}; }
  };
})();
