/* ============================================================
   js/xinsu.js
   「心愫」：角色写给用户的交心小作文
   - 私聊里和气泡同一次 API 输出，用 [xinsu:标题|正文] 标记
   - 时间触发（约 4.5~5.5 天一次）之外，交心/deeptalk/用户情绪波动时也可触发
   - 正文同时写入 IndexedDB（主存储）与 localStorage（同步缓存），避免 localStorage 满导致点开空白
   - 聊天里显示 X 风格卡片，点击进入 html/xinsu.html
   - 历史只读当前 char 自己的心愫
   ============================================================ */
(function () {
  'use strict';

  var DAY = 86400000;
  var LIST_P = 'nano_xinsu_list_';
  var META_P = 'nano_xinsu_meta_';
  var STATE_P = 'nano_xinsu_state_';
  var ASK_COOLDOWN = 6 * 3600000;
  var DEEP_COOLDOWN = 12 * 3600000;
  var DEEP_ASK_GAP = 45 * 60000;

  var DB_NAME = 'nano_xinsu_db';
  var DB_VER = 1;
  var STORE_ESSAY = 'essays';
  var STORE_META = 'meta';
  var _dbPromise = null;

  function keyOf(prefix, id) {
    return prefix + String(id == null ? 'default' : id).replace(/[^\w\u4e00-\u9fa5-]/g, '_');
  }
  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }
  // 有些备注键存的是纯字符串而不是 JSON，两种都兼容。
  function readLoose(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw == null || raw === '') return fallback;
      try {
        var v = JSON.parse(raw);
        return v == null ? fallback : v;
      } catch (e) { return raw; }
    } catch (e) { return fallback; }
  }
  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function cleanTitle(s) {
    return String(s || '')
      .replace(/^[\s《「『"“'‘【\[]+/, '')
      .replace(/[》」』"”'’】\]]+$/, '')
      .replace(/[。．.!！?？~～]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 10);
  }
  function cleanBody(s) {
    var t = String(s || '').replace(/\r\n/g, '\n');
    // 模型偶尔会把换行写成字面量 \n
    t = t.replace(/\\n/g, '\n').trim();
    // 不是信：允许模型偶尔手滑写了称呼，落地前去掉开头那半句。
    t = t.replace(/^亲爱的[^，,。.!！\n]{0,12}[，,。.!！:：]\s*/, '');
    t = t.replace(/^[「『"“'‘]+/, '').replace(/[」』"”'’]+$/, '').trim();
    return t;
  }
  function parseEssayPayload(raw) {
    var s = String(raw || '').trim();
    var sep = s.indexOf('|');
    if (sep < 0) sep = s.indexOf('｜');
    var title = sep > -1 ? s.slice(0, sep) : '';
    var body = sep > -1 ? s.slice(sep + 1) : s;
    title = cleanTitle(title);
    body = cleanBody(body);
    if (!body) return null;
    if (body.length < 120) return null;
    return { title: title || '心愫', body: body };
  }

  /* ---------------- IndexedDB（主存储） ---------------- */
  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function (resolve) {
      try {
        if (typeof indexedDB === 'undefined') { resolve(null); return; }
        var req = indexedDB.open(DB_NAME, DB_VER);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_ESSAY)) {
            var st = db.createObjectStore(STORE_ESSAY, { keyPath: 'id' });
            st.createIndex('charId', 'charId', { unique: false });
          }
          if (!db.objectStoreNames.contains(STORE_META)) {
            db.createObjectStore(STORE_META, { keyPath: 'charId' });
          }
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return _dbPromise;
  }
  function idbPutEssay(charId, rec) {
    return openDB().then(function (db) {
      if (!db) return false;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(STORE_ESSAY, 'readwrite');
          tx.objectStore(STORE_ESSAY).put({
            id: rec.id,
            charId: String(charId),
            title: rec.title,
            body: rec.body,
            at: rec.at
          });
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { resolve(false); };
        } catch (e) { resolve(false); }
      });
    }).catch(function () { return false; });
  }
  function idbList(charId) {
    return openDB().then(function (db) {
      if (!db) return [];
      return new Promise(function (resolve) {
        try {
          var idx = db.transaction(STORE_ESSAY, 'readonly').objectStore(STORE_ESSAY).index('charId');
          var rq = idx.getAll(String(charId));
          rq.onsuccess = function () { resolve(Array.isArray(rq.result) ? rq.result : []); };
          rq.onerror = function () { resolve([]); };
        } catch (e) { resolve([]); }
      });
    }).catch(function () { return []; });
  }
  function idbGetMeta(charId) {
    return openDB().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        try {
          var rq = db.transaction(STORE_META, 'readonly').objectStore(STORE_META).get(String(charId));
          rq.onsuccess = function () { resolve(rq.result || null); };
          rq.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    }).catch(function () { return null; });
  }
  function idbPutMeta(charId, record) {
    return openDB().then(function (db) {
      if (!db) return false;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(STORE_META, 'readwrite');
          var rec = record && typeof record === 'object' ? record : {};
          rec.charId = String(charId);
          tx.objectStore(STORE_META).put(rec);
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { resolve(false); };
        } catch (e) { resolve(false); }
      });
    }).catch(function () { return false; });
  }

  // 直接读角色库，拿当前最新的昵称 / 头像（用户改了人设后，心愫页也要同步）。
  function idbGetCharacter(charId) {
    return new Promise(function (resolve) {
      try {
        if (typeof indexedDB === 'undefined') { resolve(null); return; }
        var req = indexedDB.open('nano_characters_db', 1);
        req.onupgradeneeded = function (e) {
          try {
            var db = e.target.result;
            if (!db.objectStoreNames.contains('characters')) db.createObjectStore('characters', { keyPath: 'id' });
          } catch (err) {}
        };
        req.onsuccess = function (e) {
          try {
            var db = e.target.result;
            var rq = db.transaction('characters', 'readonly').objectStore('characters').getAll();
            rq.onsuccess = function () {
              var rows = Array.isArray(rq.result) ? rq.result : [];
              var hit = null;
              for (var i = 0; i < rows.length; i++) {
                if (rows[i] && String(rows[i].id) === String(charId)) { hit = rows[i]; break; }
              }
              resolve(hit);
            };
            rq.onerror = function () { resolve(null); };
          } catch (err) { resolve(null); }
        };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }

  function normalizeRow(r, charId) {
    if (!r || !r.body) return null;
    return {
      id: String(r.id || ''),
      charId: String(charId),
      title: cleanTitle(r.title) || '心愫',
      body: cleanBody(r.body),
      at: Number(r.at) || 0
    };
  }

  /* ---------------- 读缓存（同步） ---------------- */
  function list(charId) {
    var arr = readJson(keyOf(LIST_P, charId), []);
    return Array.isArray(arr) ? arr.map(function (r) { return normalizeRow(r, charId); })
      .filter(function (x) { return x && x.body; }) : [];
  }
  function get(charId, essayId) {
    var arr = list(charId);
    if (essayId) {
      for (var i = arr.length - 1; i >= 0; i--) {
        if (String(arr[i].id) === String(essayId)) return arr[i];
      }
    }
    return arr.length ? arr[arr.length - 1] : null;
  }
  function meta(charId) {
    var m = readJson(keyOf(META_P, charId), null);
    return (m && typeof m === 'object') ? m : {};
  }
  function saveMeta(charId, patch) {
    var m = meta(charId);
    if (patch && patch.charName) m.name = String(patch.charName).slice(0, 40);
    if (patch && patch.charAvatar) {
      var av = String(patch.charAvatar);
      // data URL 头像太大就不塞 localStorage，页面会用首字母兜底。
      if (av.length <= 400000) m.avatar = av;
    }
    m.updatedAt = Date.now();
    writeJson(keyOf(META_P, charId), m);
    return m;
  }
  function state(charId) {
    var st = readJson(keyOf(STATE_P, charId), null);
    return (st && typeof st === 'object') ? st : {};
  }
  function saveState(charId, st) { writeJson(keyOf(STATE_P, charId), st || {}); }

  /* ---------------- 异步合并（页面读取用） ---------------- */
  function mergeRows(charId, idbRows, cacheRows) {
    var map = {};
    (cacheRows || []).forEach(function (r) {
      var n = normalizeRow(r, charId);
      if (n && n.id) map[n.id] = n;
    });
    (idbRows || []).forEach(function (r) {
      var n = normalizeRow(r, charId);
      if (n && n.id) map[n.id] = n;
    });
    var out = Object.keys(map).map(function (k) { return map[k]; });
    out.sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
    return out;
  }
  function listAsync(charId) {
    var cacheRows = list(charId);
    return idbList(charId).then(function (rows) {
      var merged = mergeRows(charId, rows, cacheRows);
      if (merged.length) {
        if (merged.length > 60) merged = merged.slice(-60);
        writeJson(keyOf(LIST_P, charId), merged);
      }
      return merged;
    }).catch(function () { return cacheRows; });
  }
  function metaAsync(charId) {
    return Promise.all([idbGetMeta(charId), idbGetCharacter(charId)]).then(function (res) {
      var m = res[0];
      var c = res[1];
      var local = meta(charId);
      var remark = readLoose('chat_setting_remark_' + charId, '');
      var online = readLoose('chat_setting_online_name_' + charId, '');
      if (typeof remark !== 'string') remark = '';
      if (typeof online !== 'string') online = '';
      var lastChat = readJson('nano_last_chat', null);
      if (!lastChat || String(lastChat.id) !== String(charId)) lastChat = null;
      var nm = String(
        (remark && String(remark)) ||
        (online && String(online)) ||
        (c && (c.nickname || c.name)) ||
        (lastChat && lastChat.name) ||
        (m && m.name) ||
        local.name || ''
      ).trim();
      var av = String(
        (c && c.avatar) ||
        (lastChat && lastChat.avatar) ||
        (m && m.avatar) ||
        local.avatar || ''
      ).trim();
      // 小头像回填 localStorage 缓存；大头像只留在 IndexedDB，避免写满配额。
      if (nm || (av && av.length <= 400000)) {
        var patch = {};
        if (nm) patch.charName = nm;
        if (av && av.length <= 400000) patch.charAvatar = av;
        try { saveMeta(charId, patch); } catch (e) {}
      }
      return { name: nm, avatar: av };
    }).catch(function () { return meta(charId); });
  }

  function add(charId, info) {
    info = info || {};
    var body = cleanBody(info.body);
    if (!body) return null;
    var now = Date.now();
    var rec = {
      id: 'xs_' + now.toString(36) + '_' + Math.random().toString(36).slice(2, 7),
      charId: String(charId),
      title: cleanTitle(info.title) || '心愫',
      body: body,
      at: now
    };
    // 1) localStorage 同步缓存（可能因配额失败，失败不影响卡片）
    var arr = list(charId);
    arr.push(rec);
    if (arr.length > 60) arr = arr.slice(-60);
    writeJson(keyOf(LIST_P, charId), arr);
    var m = saveMeta(charId, info);

    var st = state(charId);
    st.lastAt = now;
    st.lastAskAt = now;
    // 时间触发：4.5~5.5 天一次
    st.nextAt = now + (4.5 + Math.random()) * DAY;
    st.count = (Number(st.count) || 0) + 1;
    saveState(charId, st);

    // 2) IndexedDB 主存储（关键：localStorage 满时仍能读到正文）
    var rawAvatar = String(info.charAvatar || '');
    rec.__persist = Promise.all([
      idbPutEssay(charId, rec),
      idbPutMeta(charId, {
        name: m.name || info.charName || '',
        // 大头像 localStorage 存不下，但 IndexedDB 可以，所以用原始头像而不是过滤后的 m.avatar。
        avatar: rawAvatar || m.avatar || '',
        updatedAt: now,
        state: st
      })
    ]).then(function () { return true; }).catch(function () { return false; });
    return rec;
  }

  // 交心 / deeptalk / 情绪波动：这些状态比“时间到了”更适合写心愫。
  var DEEP_RE = new RegExp([
    '交心', '谈心', '说心里话', '心里话', '真正的想法', '真实想法', 'deeptalk', '认真地问', '认真问',
    '其实我', '其实你', '老实说', '说实话', '坦白',
    '我们.*(关系|以后|未来|算什么)', '你.*(在乎|喜欢|爱).*我吗', '你是不是', '你会不会',
    '离开我', '别走', '不要走', '分手', '冷战', '吵架', '和好', '原谅', '对不起',
    '难过', '伤心', '不安', '焦虑', '孤独', '委屈', '想哭', '眼泪', '脆弱', '害怕', '恐惧',
    '想你', '舍不得', '离不开', '依赖', '秘密', '过去', '童年', '家人', '去世', '离开这个世界',
    '人生', '活着', '意义', '梦想', '未来', '一辈子', '永远'
  ].join('|'), 'i');

  function detectDeepTalk(arr) {
    var recent = arr.slice(-30);
    var hits = 0;
    for (var i = 0; i < recent.length; i++) {
      var m = recent[i];
      if (!m || m.recalled || m.isCard || m.isTip) continue;
      if (m.type !== 'left' && m.type !== 'right') continue;
      var txt = String(m.text || '').trim();
      if (!txt) continue;
      if (DEEP_RE.test(txt)) {
        hits += (txt.length >= 18 ? 2 : 1);
        if (hits >= 3) return true;
      }
    }
    return false;
  }

  // 本轮是否该让角色写心愫：
  // 1) 状态触发：最近在交心 / deeptalk / 用户情绪明显波动 → 至少间隔 12h；
  // 2) 时间触发：约 4.5~5.5 天一次。
  // 共同前提：近 24h 有真实聊天、由用户这轮发起、至少聊过一小段、认识至少一天。
  function shouldWrite(charId, messages) {
    if (!charId) return false;
    var id = String(charId);
    if (id === 'default' || id === 'char' || id === 'nano_ai' || id === 'nano') return false;
    var now = Date.now();
    var st = state(id);
    var arr = Array.isArray(messages) ? messages : [];
    var total = 0, firstTs = 0, lastTs = 0, lastReal = null;
    for (var i = 0; i < arr.length; i++) {
      var m = arr[i];
      if (!m || m.recalled || m.isTip || m.isCard) continue;
      if (m.type !== 'left' && m.type !== 'right') continue;
      var txt = String(m.text || '').trim();
      if (!txt && !m.isVoice) continue;
      total++;
      var ts = Number(m.ts) || 0;
      if (ts) {
        if (!firstTs || ts < firstTs) firstTs = ts;
        if (ts > lastTs) lastTs = ts;
      }
      lastReal = m;
    }
    if (!lastReal) return false;
    if (now - (lastTs || now) > DAY) return false;      // 24 小时内聊过
    if (lastReal.type !== 'right') return false;          // 必须由用户这一轮发起
    if (total < 12) return false;                         // 至少有过一小段真实对话
    if (firstTs && now - firstTs < DAY) return false;     // 认识/聊天至少一天

    var sinceLast = st.lastAt ? now - Number(st.lastAt) : Infinity;
    var sinceAsk = st.lastAskAt ? now - Number(st.lastAskAt) : Infinity;
    var deep = detectDeepTalk(arr);

    if (deep) {
      // 状态触发：不按 5 天时间表，但至少 12h 才写一次、45 分钟才问一次模型。
      if (sinceLast < DEEP_COOLDOWN) return false;
      if (sinceAsk < DEEP_ASK_GAP) return false;
      return true;
    }

    if (st.nextAt && now < Number(st.nextAt)) return false;
    if (sinceAsk < ASK_COOLDOWN) return false;
    return true;
  }

  function markAsked(charId) {
    var st = state(charId);
    st.lastAskAt = Date.now();
    saveState(charId, st);
    idbPutMeta(charId, {
      name: meta(charId).name || '',
      avatar: meta(charId).avatar || '',
      updatedAt: Date.now(),
      state: st
    });
  }

  function promptBlock(charName) {
    return '【心愫 · 本轮额外输出（只此一次）】\n' +
      '此刻有些话你不便直接说出口，想单独写给对方——这就是「心愫」。\n' +
      '在正常聊天气泡写完之后，另起一行输出（这一行不会作为气泡发送，会变成一张卡片）：\n' +
      '[xinsu:短标题|正文]\n' +
      '硬性要求：\n' +
      '- 短标题不超过 10 个字，是一句有文艺气质的总结；不加书名号、引号、句号。\n' +
      '- 正文 500~1000 个汉字，第一人称，分 2~4 段，段落之间用真实换行。\n' +
      '- 它是你对人生、感情、关系的思考，是平时不敢、不好意思直接说的话；有哲理但不端着，易懂但有深度，不是日常大白话。\n' +
      '- 情绪和爱意是暗流涌动的：克制、含蓄、耐人回味，像一壶越品越有味道的茶；不要浓烈表白、不要油腻/霸总、不要说教、不要排比堆砌。\n' +
      '- 必须贴合你的人设、你们共同的记忆和世界书来写，具体、真诚，可以有一点脆弱；不要写成日记或抒情散文。\n' +
      '- 不要以“亲爱的xx”之类的称呼开头，不要落款；不要提 AI、模型、用户、提示词、设定。\n' +
      '- 正文里不要出现方括号标签、Markdown、标题或小标题。\n' +
      '- 普通聊天气泡照常写 1~3 条，不要因为写心愫就省略聊天。\n' +
      '- 本轮只输出一个 [xinsu:...]，不要重复，不要输出 [/xinsu]。';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function dateLabel(ts) {
    try {
      var d = new Date(Number(ts) || Date.now());
      var now = new Date();
      var sameYear = d.getFullYear() === now.getFullYear();
      var mm = d.getMonth() + 1, dd = d.getDate();
      var hh = String(d.getHours()).padStart(2, '0'), mi = String(d.getMinutes()).padStart(2, '0');
      return (sameYear ? '' : (d.getFullYear() + '年')) + mm + '月' + dd + '日 ' + hh + ':' + mi;
    } catch (e) { return ''; }
  }
  function paraphrase(text, n) {
    return String(text || '').replace(/\s+/g, ' ').trim().slice(0, n || 80);
  }

  window.NanoXinSu = {
    list: list,
    listAsync: listAsync,
    get: get,
    meta: meta,
    metaAsync: metaAsync,
    add: add,
    shouldWrite: shouldWrite,
    markAsked: markAsked,
    promptBlock: promptBlock,
    parseEssayPayload: parseEssayPayload,
    dateLabel: dateLabel,
    paraphrase: paraphrase
  };

  /* ---------------- 私聊：卡片点击 ---------------- */
  var isPage = false;
  try { isPage = !!(document.body && document.body.classList.contains('xs-page')); } catch (e) {}
  if (!isPage) {
    document.addEventListener('click', function (e) {
      var t = e.target;
      var hit = null;
      try { hit = t && t.closest ? t.closest('.bubble-card.xinsu, .xs-card') : null; } catch (err) {}
      if (!hit) return;
      var card = hit.closest ? (hit.closest('.bubble-card.xinsu') || hit) : hit;
      var inner = card.querySelector ? (card.querySelector('.xs-card') || card) : card;
      var essayId = inner.getAttribute('data-xs-id') || card.getAttribute('data-xs-id') || '';
      var charId = inner.getAttribute('data-xs-char') || card.getAttribute('data-xs-char') || '';
      if (!charId) {
        try { charId = new URLSearchParams(location.search).get('chat') || ''; } catch (err) {}
      }
      // 老卡片可能没有 essayId：仍然可以打开该角色最新的心愫。
      if (!charId) return;
      e.preventDefault();
      e.stopPropagation();
      var pageUrl = 'xinsu.html?char=' + encodeURIComponent(charId) +
        (essayId ? ('&id=' + encodeURIComponent(essayId)) : '');
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            type: 'openFullscreen',
            url: pageUrl,
            title: '心愫',
            showBack: false,
            source: 'chat_inner'
          }, '*');
        } else {
          location.href = pageUrl;
        }
      } catch (err) {}
    }, true);
    return;
  }

  /* ---------------- 心愫页面 ---------------- */
  function param(name) {
    try { return new URLSearchParams(location.search).get(name) || ''; } catch (e) { return ''; }
  }
  var charId = param('char');
  var essayId = param('id');
  var listEl, metaEl, mainEl, histEl, histListEl;
  var renderedKey = '';
  var bootTries = 0;

  function avatarHtml(src, name, cls) {
    var s = String(src || '');
    if (s) {
      return '<img class="' + cls + '" src="' + esc(s) + '" alt="" referrerpolicy="no-referrer" onerror="this.style.display=\'none\';this.nextElementSibling&&(this.nextElementSibling.style.display=\'flex\');">' +
        '<div class="' + cls + ' xs-avatar-fallback" style="display:none">' + esc((name || '?').trim().charAt(0)) + '</div>';
    }
    return '<div class="' + cls + ' xs-avatar-fallback">' + esc((name || '?').trim().charAt(0)) + '</div>';
  }
  var BADGE = '<svg class="xs-badge" viewBox="0 0 24 24" aria-label="认证"><circle cx="12" cy="12" r="11" fill="#1d9bf0"/><path d="m7 12.4 3.1 3.1L17.4 8" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function renderEssay(rec) {
    if (!rec) {
      var ek = 'empty|' + (metaEl.name || '');
      if (ek !== renderedKey) {
        renderedKey = ek;
        mainEl.innerHTML = '<div class="xs-empty"><div class="xs-empty-title">还没有写下的心愫</div><div class="xs-empty-sub">等一个安静的深夜，TA 会把心里话留在这里。</div></div>';
      }
      return;
    }
    var m = metaEl || {};
    var name = m.name || 'TA';
    var av = avatarHtml(m.avatar, name, 'xs-avatar');
    var key = rec.id + '|' + (rec.at || 0) + '|' + String(rec.body || '').length + '|' + name + '|' + String(m.avatar || '').length;
    if (key === renderedKey && mainEl.children.length) return;
    renderedKey = key;
    var paras = String(rec.body || '').split(/\n+/).map(function (p) { return p.trim(); }).filter(Boolean)
      .map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');
    mainEl.innerHTML =
      '<article class="xs-article">' +
        '<div class="xs-author">' + av +
          '<div class="xs-author-meta">' +
            '<div class="xs-name-row"><span class="xs-name">' + esc(name) + '</span>' + BADGE + '</div>' +
            '<div class="xs-date">' + esc(dateLabel(rec.at)) + '</div>' +
          '</div>' +
        '</div>' +
        '<h1 class="xs-essay-title">' + esc(rec.title || '心愫') + '</h1>' +
        '<div class="xs-essay-body">' + paras + '</div>' +
      '</article>';
    try { document.title = '心愫 · ' + name; } catch (e) {}
  }

  function findIn(arr, id) {
    if (!arr || !arr.length) return null;
    if (id) {
      for (var i = arr.length - 1; i >= 0; i--) {
        if (String(arr[i].id) === String(id)) return arr[i];
      }
    }
    return arr[arr.length - 1];
  }

  // 页面启动：先画本地缓存（秒开），再从 IndexedDB 拉完整数据。
  // 若卡片刚生成、IndexedDB 还没落盘，短轮询几次，避免“点开空白”。
  function refreshEssay(fromBoot) {
    Promise.all([listAsync(charId), metaAsync(charId)]).then(function (res) {
      var arr = res[0] || [];
      var m = res[1] || {};
      if (m && (m.name || m.avatar)) metaEl = m;
      var rec = findIn(arr, essayId);
      if (rec) {
        if (!essayId) essayId = rec.id;
        renderEssay(rec);
        return;
      }
      if (fromBoot && !arr.length && essayId && bootTries < 10) {
        bootTries++;
        setTimeout(function () { refreshEssay(true); }, 300);
        return;
      }
      renderEssay(rec);
    }).catch(function () {});
  }

  function paintHistory(arr) {
    if (!arr.length) {
      histListEl.innerHTML = '<div class="xs-empty"><div class="xs-empty-title">还没有历史心愫</div><div class="xs-empty-sub">TA 写下的每一篇都会留在这里。</div></div>';
      return;
    }
    histListEl.innerHTML = arr.map(function (r) {
      return '<div class="xs-hitem" data-id="' + esc(r.id) + '">' +
        '<div class="xs-hitem-main">' +
          '<div class="xs-hitem-date">' + esc(dateLabel(r.at)) + '</div>' +
          '<div class="xs-hitem-title">' + esc(r.title || '心愫') + '</div>' +
          '<div class="xs-hitem-excerpt">' + esc(paraphrase(r.body, 90)) + '</div>' +
        '</div>' +
        '<svg class="xs-hitem-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>' +
      '</div>';
    }).join('');
    Array.prototype.forEach.call(histListEl.querySelectorAll('.xs-hitem'), function (row) {
      row.addEventListener('click', function () {
        var id = row.getAttribute('data-id') || '';
        essayId = id;
        try { history.replaceState(null, '', 'xinsu.html?char=' + encodeURIComponent(charId) + '&id=' + encodeURIComponent(id)); } catch (e) {}
        renderEssay(findIn(listAsyncCached, id) || get(charId, id));
        showHistory(false);
        try { window.scrollTo(0, 0); } catch (e) {}
      });
    });
  }
  var listAsyncCached = [];
  function renderHistory() {
    var arr = list(charId).slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    paintHistory(arr);
    listAsync(charId).then(function (fresh) {
      if (!fresh || !fresh.length) return;
      listAsyncCached = fresh;
      paintHistory(fresh.slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); }));
    }).catch(function () {});
  }

  function showHistory(on) {
    if (!histEl) return;
    histEl.hidden = !on;
    if (on) renderHistory();
    document.body.classList.toggle('xs-history-open', !!on);
  }

  function initPage() {
    listEl = document.getElementById('xsHistoryList');
    histEl = document.getElementById('xsHistory');
    histListEl = listEl;
    mainEl = document.getElementById('xsMain');
    metaEl = meta(charId);
    // 页面地址里带 name 时兜底（旧卡片/分享链接）
    if (!metaEl.name && param('name')) metaEl.name = param('name');
    listAsyncCached = list(charId);
    renderEssay(get(charId, essayId));
    refreshEssay(true);
    var back = document.getElementById('xsBack');
    if (back) back.addEventListener('click', function () {
      try { if (window.parent && window.parent !== window) { window.parent.postMessage({ type: 'closeFullscreen' }, '*'); return; } } catch (e) {}
      if (history.length > 1) history.back();
    });
    var hb = document.getElementById('xsHistoryBtn');
    if (hb) hb.addEventListener('click', function () { showHistory(true); });
    var hBack = document.getElementById('xsHistoryBack');
    if (hBack) hBack.addEventListener('click', function () { showHistory(false); });
    try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'nanoHideOuterHeader' }, '*'); } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPage);
  else initPage();
})();
