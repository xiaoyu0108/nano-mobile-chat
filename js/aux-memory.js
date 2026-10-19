/* ============================================================
   aux-memory.js — 辅助场景记忆（音乐「一起听」/ 图书「一起看」）
   ------------------------------------------------------------
   目的：让 char 的长期记忆也能读到音乐/图书里的聊天内容。
   做法：把这两个场景里的对话单独存起来，攒够一定条数（或会话结束时）
         用记忆页配置的总结 API 提炼成记忆，写进 memlist_<charId>。
   因为 memlist_<charId> 就是聊天、朋友圈、手机等所有模块读取的
   长期记忆库，所以写入后 char 在任何地方都能读到这些内容。

   存储位置：IndexedDB nano_vector_memory_db / config
     - auxchat_<charId>   原始对话 [{role,text,source,ts}]
     - auxmeta_<charId>    {charName,userName}
     - auxstate_<charId>   {summarizedCount}
     - memlist_<charId>    提炼后的记忆条目（char 实际读取的记忆库）
   ============================================================ */
(function () {
  'use strict';
  if (window.AuxMemory) return;

  var DB_NAME = 'nano_vector_memory_db';
  var DB_VERSION = 5;
  var STORE = 'config';

  function openDB() {
    return new Promise(function (resolve, reject) {
      try {
        var req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function (e) {
          var d = e.target.result, tx = e.target.transaction;
          try {
            if (!d.objectStoreNames.contains('memories')) {
              var s = d.createObjectStore('memories', { keyPath: 'id' });
              s.createIndex('chatId', 'chatId', { unique: false });
              s.createIndex('type', 'type', { unique: false });
              s.createIndex('hasVector', 'hasVector', { unique: false });
            } else {
              var s2 = tx.objectStore('memories');
              if (!s2.indexNames.contains('chatId')) s2.createIndex('chatId', 'chatId', { unique: false });
              if (!s2.indexNames.contains('type')) s2.createIndex('type', 'type', { unique: false });
              if (!s2.indexNames.contains('hasVector')) s2.createIndex('hasVector', 'hasVector', { unique: false });
            }
            if (!d.objectStoreNames.contains('config')) d.createObjectStore('config', { keyPath: 'key' });
            if (!d.objectStoreNames.contains('chat_state')) d.createObjectStore('chat_state', { keyPath: 'chatId' });
            if (!d.objectStoreNames.contains('chat_messages')) d.createObjectStore('chat_messages', { keyPath: 'chatId' });
          } catch (err) {}
        };
        req.onsuccess = function () {
          var db = req.result;
          db.onversionchange = function () { try { db.close(); } catch (e) {} };
          resolve(db);
        };
        req.onerror = function () { reject(req.error); };
      } catch (e) { reject(e); }
    });
  }

  function getV(key) {
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
          r.onsuccess = function () { resolve(r.result ? r.result.value : null); try { db.close(); } catch (e) {} };
          r.onerror = function () { resolve(null); try { db.close(); } catch (e) {} };
        } catch (e) { resolve(null); try { db.close(); } catch (e2) {} }
      });
    }).catch(function () { return null; });
  }

  function putV(key, value) {
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put({ key: key, value: value });
          tx.oncomplete = function () { resolve(true); try { db.close(); } catch (e) {} };
          tx.onerror = function () { resolve(false); try { db.close(); } catch (e) {} };
        } catch (e) { resolve(false); try { db.close(); } catch (e2) {} }
      });
    }).catch(function () { return false; });
  }

  function getUserName() {
    try {
      var raw = localStorage.getItem('nano_mask_data')
        || localStorage.getItem('nano_home_data')
        || localStorage.getItem('peach_home_data');
      if (raw) {
        var d = JSON.parse(raw);
        if (d && Array.isArray(d.masks)) {
          var u = d.masks.filter(function (m) { return m.id === d.currentMaskId; })[0];
          if (u && u.name) return u.name;
        }
      }
    } catch (e) {}
    return '用户';
  }

  // 同一角色的写入串行化，避免并发覆盖
  var queues = {};

  function track(charId, info) {
    charId = String(charId == null ? '' : charId).trim();
    if (!charId) return Promise.resolve();
    return getV('auxmeta_' + charId).then(function (meta) {
      meta = meta || {};
      if (info && info.charName) meta.charName = info.charName;
      meta.userName = meta.userName || (info && info.userName) || getUserName();
      return putV('auxmeta_' + charId, meta);
    }).catch(function () {});
  }

  function push(charId, source, role, text, info) {
    charId = String(charId == null ? '' : charId).trim();
    text = String(text == null ? '' : text).trim();
    if (!charId || !text) return Promise.resolve();
    var prev = queues[charId] || Promise.resolve();
    var next = prev.then(function () {
      return getV('auxchat_' + charId).then(function (list) {
        list = Array.isArray(list) ? list : [];
        list.push({ role: role === 'user' ? 'user' : 'char', text: text, source: source || '', ts: Date.now() });
        if (list.length > 600) list = list.slice(-600);
        return putV('auxchat_' + charId, list).then(function () {
          if (info && (info.charName || info.userName)) return track(charId, info);
        });
      });
    }).catch(function () {});
    queues[charId] = next;
    return next;
  }

  function baseUrl(u) {
    u = String(u || '').trim().replace(/\/+$/, '');
    if (u && !/\/v1$/i.test(u)) u += '/v1';
    return u;
  }

  function callLlm(url, key, model, sys, userText) {
    return fetch(baseUrl(url) + '/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'system', content: sys }, { role: 'user', content: userText }],
        max_tokens: 4000,
        temperature: 0.5
      })
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      return (d.choices && d.choices[0] && d.choices[0].message) ? (d.choices[0].message.content || '') : '';
    });
  }

  function buildPrompt(charName, userName, sourceLabel) {
    return '你是记忆提取助手，正在从「' + charName + '」和「' + userName + '」' + (sourceLabel || '') +
      '时的聊天记录里提取值得长期记住的信息，用于构建向量记忆库。\n\n' +
      '必须重点提取、尽量详细记录：\n' +
      '1. 重要事件：两人一起听过/看过的作品、聊到的话题、约定、心情变化。\n' +
      '2. ' + userName + '的习惯与偏好：音乐口味、阅读口味、作息、喜好、雷区、口头禅。\n' +
      '3. 双方关系与情感：相处模式、称呼、亲昵方式、暧昧或默契的细节。\n' +
      '4. ' + charName + '自己的态度：喜欢/讨厌的歌或书、说过的话、答应过的事。\n' +
      '5. 其他值得长期记住的细节。\n\n' +
      '格式：每条独立一行，以【类型】开头，例如：\n' +
      '【共同经历】' + charName + '和' + userName + '一起听了《某首歌》，' + userName + '说这让他想起高中。\n' +
      '【' + userName + '偏好】' + userName + '喜欢民谣和慢歌，不太听电子乐。\n\n' +
      '要求：\n' +
      '- 记忆是长期使用的，越具体越详细越好，保留歌名、书名、名字、地点等细节。\n' +
      '- 每条 40~120 字，宁可写多不要写少。\n' +
      '- 只输出有实质内容的记忆，不要泛泛而谈。';
  }

  function parseSummary(summary, charName, charId) {
    var items = [];
    String(summary || '').split('\n').forEach(function (line) {
      line = line.trim();
      if (!line) return;
      var type = '其他', content = line;
      var m = line.match(/^【(.+?)】/);
      if (m) { type = m[1]; content = line.replace(/^【.+?】/, '').trim(); }
      if (!content) return;
      items.push({
        id: 'mem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        type: type,
        content: content,
        embedding: null,
        hasVector: false,
        date: new Date().toISOString(),
        relatedChar: charName,
        chatId: charId,
        source: 'aux'
      });
    });
    return items;
  }

  function appendMemories(charId, items) {
    // 小号一起听/一起看产生的记忆，也计入大号记忆库
    if (window.NanoMemLink && window.NanoMemLink.append) {
      return window.NanoMemLink.append(charId, items);
    }
    return getV('memlist_' + charId).then(function (rec) {
      var list = Array.isArray(rec) ? rec : [];
      items.forEach(function (it) { list.push(it); });
      return putV('memlist_' + charId, list);
    });
  }

  var busy = {};
  // force=true 时无视阈值（用于结束「一起听 / 一起看」时收尾）
  function maybeSummarize(charId, opts) {
    charId = String(charId == null ? '' : charId).trim();
    if (!charId || busy[charId]) return Promise.resolve();
    opts = opts || {};
    return Promise.all([getV('autoSummary'), getV('autoThreshold')]).then(function (v) {
      // 自动总结开关只控制「攒够阈值时」的自动触发；
      // 结束一起听 / 退出一起看时的收尾（force）不受该开关限制
      if (!v[0] && !opts.force) return null;
      var threshold = parseInt(v[1]) || 20;
      return getV('auxchat_' + charId).then(function (list) {
        list = Array.isArray(list) ? list : [];
        return getV('auxstate_' + charId).then(function (state) {
          var done = (state && state.summarizedCount) || 0;
          var pending = list.slice(done);
          if (!pending.length) return null;
          if (!opts.force && pending.length < threshold) return null;
          return { pending: pending, done: done };
        });
      });
    }).then(function (res) {
      if (!res) return null;
      busy[charId] = true;
      return Promise.all([
        getV('llmUrl'), getV('llmKey'), getV('llmModel'), getV('auxmeta_' + charId)
      ]).then(function (cfg) {
        var url = cfg[0], key = cfg[1], model = cfg[2], meta = cfg[3] || {};
        if (!url || !key || !model) return null;
        var charName = meta.charName || '角色';
        var userName = meta.userName || getUserName();
        var sourceLabel = '';
        var srcs = {};
        res.pending.forEach(function (m) { if (m.source) srcs[m.source] = true; });
        var names = Object.keys(srcs).map(function (s) {
          return s === 'music' ? '一起听歌' : (s === 'books' ? '一起看书' : s);
        });
        if (names.length) sourceLabel = names.join('、');
        var chatText = res.pending.map(function (m) {
          return (m.role === 'user' ? userName : charName) + '：' + m.text;
        }).join('\n');
        return callLlm(url, key, model, buildPrompt(charName, userName, sourceLabel), chatText).then(function (summary) {
          var items = parseSummary(summary, charName, charId);
          // 一起看 / 一起听：一次只留一张总结卡片就够了（线下等其它场景不受限）
          var onlyAux = res.pending.every(function (m) { return m.source === 'books' || m.source === 'music'; });
          if (onlyAux && items.length > 1) items = items.slice(0, 1);
          if (!items.length) return null;
          return appendMemories(charId, items).then(function () {
            return putV('auxstate_' + charId, { summarizedCount: res.done + res.pending.length });
          });
        });
      }).then(function (r) {
        busy[charId] = false;
        if (r) {
          try {
            if (window.parent && window.parent !== window) {
              window.parent.postMessage({ type: 'NANO_MEMORY_UPDATED', chatId: charId }, '*');
            }
          } catch (e) {}
        }
        return r;
      }).catch(function (e) {
        busy[charId] = false;
        console.warn('[AuxMemory] 总结失败', e);
      });
    });
  }

  window.AuxMemory = {
    push: push,
    track: track,
    maybeSummarize: maybeSummarize,
    getUserName: getUserName
  };

  // 顶层页面兜底：图书页退出时 iframe 会被销毁，把收尾总结交给常驻的父页面执行
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (d && d.type === 'AuxMemorySummarize' && d.charId) {
      try { maybeSummarize(d.charId, { force: !!d.force }); } catch (err) {}
    }
  });
})();
