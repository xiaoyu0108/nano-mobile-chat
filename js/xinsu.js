/* ============================================================
   js/xinsu.js
   「心愫」：角色写给用户的交心小作文
   - 私聊里和气泡同一次 API 输出，用 [xinsu:标题|正文] 标记
   - 不做定时任务：只在交心/deeptalk/用户情绪波动时，由角色自己决定要不要写
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
  var OPEN_META_P = 'nano_xinsu_open_meta_';
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
      .replace(/[。．.!！?？~～，,、；;：:]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 10);
  }
  // 模型偶尔会把标题写成「我有点怕了」「我很想你」这种大白话。
  // 命中时从正文里挑一个带画面的短句当标题，仍然是正文总结，不是内置文案。
  function isFlatTitle(t) {
    var s = String(t || '').trim();
    if (!s) return true;
    if (/^(我|俺)?(真的|有点|好|很|突然|其实|只是|还是)?(怕|害怕|想|喜欢|爱|难过|伤心|开心|累|烦|睡不着|舍不得|担心|想你|爱你|喜欢你|不想睡|心情)/.test(s)) return true;
    return /^(心里话|心事|独白|深夜|碎碎念|无题)$/.test(s);
  }
  function titleFromBody(body) {
    var clauses = String(body || '').replace(/\n+/g, '。').split(/[。！？!?；;，,、：:]+/)
      .map(function (x) {
        return String(x).replace(/^[\s"“'‘「『]+|[\s"”'’」』]+$/g, '')
          .replace(/^(其实|只是|但是|然后|所以|因为|如果|好像|大概|也许|不过|而且|还是)/, '')
          .trim();
      })
      .filter(function (x) { return x.length >= 4 && x.length <= 12; });
    if (!clauses.length) return '';
    var IMG = /(风|雨|雪|云|雾|夜|海|天|街|灯|花|月|路|车|窗|光|树|酒|咖啡|歌|河|桥|山|星|阳|晨|暮|春|夏|秋|冬|潮|浪|雪)/;
    var pick = clauses.filter(function (x) {
      return IMG.test(x) && !/^(我|你|他|她)/.test(x);
    }).sort(function (a, b) {
      return Math.abs(a.length - 7) - Math.abs(b.length - 7);
    })[0];
    if (!pick) pick = clauses.filter(function (x) { return !/^(我|你|他|她)/.test(x); })[0];
    if (!pick) pick = clauses[0];
    return cleanTitle(pick);
  }
  function readOpenMeta(charId) {
    try {
      var raw = sessionStorage.getItem(OPEN_META_P + String(charId));
      if (!raw) return null;
      var v = JSON.parse(raw);
      return (v && typeof v === 'object') ? v : null;
    } catch (e) { return null; }
  }
  function writeOpenMeta(charId, meta) {
    try {
      if (!charId || !meta) return;
      var rec = {};
      if (meta.name) rec.name = String(meta.name).slice(0, 40);
      if (meta.avatar) rec.avatar = String(meta.avatar);
      if (rec.name || rec.avatar) sessionStorage.setItem(OPEN_META_P + String(charId), JSON.stringify(rec));
    } catch (e) {}
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
    if (isFlatTitle(title)) {
      var better = titleFromBody(body);
      if (better) title = better;
    }
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
  // 不写死版本号：别人的角色库可能升级过，用 1 会直接 VersionError。
  function idbGetCharacter(charId, anyName) {
    return new Promise(function (resolve) {
      try {
        if (typeof indexedDB === 'undefined') { resolve(null); return; }
        var req = indexedDB.open('nano_characters_db');
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
              // 老卡片/分享链接里的 id 对不上时，按昵称再找一次。
              if (!hit && anyName) {
                var want = String(anyName).trim();
                if (want) {
                  for (var j = 0; j < rows.length; j++) {
                    var c = rows[j];
                    if (!c) continue;
                    if (String(c.nickname || '').trim() === want || String(c.name || '').trim() === want) { hit = c; break; }
                  }
                }
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
    var opened = readOpenMeta(charId) || {};
    var paramName = '';
    try { paramName = new URLSearchParams(location.search).get('name') || ''; } catch (e) {}
    return Promise.all([idbGetMeta(charId), idbGetCharacter(charId, opened.name || paramName)]).then(function (res) {
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
        (opened && opened.name) ||
        (lastChat && lastChat.name) ||
        (m && m.name) ||
        local.name || ''
      ).trim();
      var av = String(
        (c && c.avatar) ||
        (opened && opened.avatar) ||
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
    delete st.nextAt;
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
  // 只由「交心 / deeptalk / 用户情绪明显波动」触发，不再按天数定时打卡。
  // 前提：近 24h 有真实聊天、由用户这轮发起、至少聊过一小段、认识至少一天。
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
    if (!detectDeepTalk(arr)) return false;               // 只有真的聊到心里时才给机会

    var sinceLast = st.lastAt ? now - Number(st.lastAt) : Infinity;
    var sinceAsk = st.lastAskAt ? now - Number(st.lastAskAt) : Infinity;
    if (sinceLast < DEEP_COOLDOWN) return false;
    if (sinceAsk < DEEP_ASK_GAP) return false;
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
    return '【心愫 · 可选的一次深夜心里话】\n' +
      '不是任务，也不是打卡。只有当你此刻真的有一句想对对方说、却不适合直接发在聊天框里的话，才在气泡写完之后另起一行输出：\n' +
      '[xinsu:标题|正文]\n' +
      '如果这一刻你并没有特别想说的，就正常聊天，不要输出这个标签。\n' +
      '写作要求：\n' +
      '- 像深夜真的在打字，不是在交作文：第一人称，可以有短句、停顿、重复、突然想起的一件小事，允许一点笨拙。\n' +
      '- 一定要落到具体：你们聊过的某句话、一个称呼、一件外套、一段路、那天的天气、一个约定、一次吵架或和好。不要空泛地谈人生、意义、永远。\n' +
      '- 可以直接说喜欢、想念、害怕、感谢，但要让情绪长在具体的事上，不要喊口号，不要每段都升华。\n' +
      '- 可以有口语的重复、停顿、突然又补一句，但不要工整排比、不要金句总结、不要每句都比喻；不要 AI 腔、不要范文感、不要油腻/霸总/说教。\n' +
      '- 正文 500~700 个汉字，分 2~4 段，段落之间用真实换行；不要开头称呼、不要落款、不要小标题。\n' +
      '- 不要提 AI、模型、用户、提示词、设定；正文里不要出现方括号标签或 Markdown。\n' +
      '- 标题 2~10 个字，必须从正文里提炼一个最有画面的意象或短句，像随手写在扉页上的一句；不要照抄正文第一句，也不要“我有点怕了”“我很想你”这种情绪大白话。可参考（不要照抄）：悠悠我心/ 晴天 / 同淋雪 / 我喻我以长青 / 世界被一首赞歌填满。\n' +
      '- 普通聊天气泡照常写 1~3 条，不要因为写心愫就省略聊天。\n' +
      '- 本轮最多输出一个 [xinsu:...]，不要重复，不要输出 [/xinsu]。';
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
      // 把卡片上当前的昵称/头像带给页面，角色库读取失败时也不会退回 “TA”。
      var cardName = '';
      var cardAvatar = '';
      try {
        var nameEl = inner.querySelector ? inner.querySelector('.xs-card-name') : null;
        if (nameEl) cardName = String(nameEl.textContent || '').replace(/\s+/g, ' ').trim();
        var avEl = inner.querySelector ? inner.querySelector('img.xs-avatar') : null;
        if (avEl && avEl.src) cardAvatar = String(avEl.src);
      } catch (err) {}
      try { writeOpenMeta(charId, { name: cardName, avatar: cardAvatar }); } catch (err) {}
      var pageUrl = 'xinsu.html?char=' + encodeURIComponent(charId) +
        (essayId ? ('&id=' + encodeURIComponent(essayId)) : '') +
        (cardName ? ('&name=' + encodeURIComponent(cardName)) : '') +
        '&v=20261126a';
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
    var avKey = String(m.avatar || '');
    var key = rec.id + '|' + (rec.at || 0) + '|' + String(rec.body || '').length + '|' + name + '|' + avKey.length + '|' + avKey.slice(0, 24) + '|' + avKey.slice(-24);
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
    // 先用手上的昵称/头像兜底：卡片 DOM、sessionStorage、分享链接里的 name。
    var opened = readOpenMeta(charId) || {};
    metaEl.avatar = opened.avatar || metaEl.avatar;
    metaEl.name = opened.name || param('name') || metaEl.name;
    listAsyncCached = list(charId);
    renderEssay(get(charId, essayId));
    refreshEssay(true);
    // 角色库/头像可能在页面打开后才写完，再补一次同步。
    setTimeout(function () { try { refreshEssay(true); } catch (e) {} }, 900);
    // 角色改名 / 换头像后实时刷新（外壳会广播 nanoCharUpdated）。
    window.addEventListener('message', function (e) {
      var d = e && e.data;
      if (!d || (d.type !== 'nanoCharUpdated' && d.type !== 'remarkChanged')) return;
      if (d.chatId && String(d.chatId) !== String(charId)) return;
      setTimeout(function () { try { refreshEssay(true); } catch (err) {} }, 120);
    });
    window.addEventListener('storage', function (e) {
      var k = e && e.key ? String(e.key) : '';
      if (k && (k === 'chat_setting_remark_' + charId || k === 'chat_setting_online_name_' + charId)) {
        setTimeout(function () { try { refreshEssay(true); } catch (err) {} }, 120);
      }
    });
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
