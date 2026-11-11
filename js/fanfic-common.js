/* ============================================================
   fanfic-common.js — 同人文：本地书库、API、题材
   ============================================================ */
(function () {
  'use strict';
  if (window.NanoFanfic) return;

  var KEY = 'nano_fanfic_library_v1';
  var CUSTOM_KEY = 'nano_fanfic_custom_v1';

  var GENRES = [
    {
      group: '世界',
      items: ['修仙', '玄幻', '武侠', '仙侠', '西幻', '星际', '末世', '废土', '赛博朋克', '克苏鲁', '灵异', '无限流', '快穿', '穿越', '重生', '系统', '全息游戏', '神话', '蒸汽朋克', '末日废土', '洪荒', '赛博修仙', '规则怪谈', '无限游戏', '异星殖民', '深海', '蒸汽都市', '都市异能', '超能力', '时间循环', '平行世界', '梦境', '末日种田', '废土公路', '人外', '克苏鲁神话', '灵异校园', '民俗怪谈', '太空歌剧']
    },
    {
      group: '关系',
      items: ['ABO', '哨向', '年上', '年下', '竹马', '天降', '暗恋', '双向暗恋', '破镜重圆', '先婚后爱', '契约婚姻', '追妻火葬场', '强强', '群像', '替身', '白月光', '双向救赎', '宿命', '师徒', '宿敌', '主仆', '青梅竹马', '先恨后爱', '假戏真做', '协议恋爱', '隐婚', '追夫', '追妻', '火葬场', '双向奔赴', '年龄差', '替身转正', '久别重逢', '一见钟情', '暗恋成真', '破镜', '强取豪夺', '相爱相杀', '并肩作战']
    },
    {
      group: '背景',
      items: ['校园', '都市', '职场', '娱乐圈', '豪门', '宫廷', '宅斗', '民国', '年代', '种田', '美食', '旅居', '海岛', '小镇', '医院', '刑侦', '律政', '军旅', '电竞', '直播', '选秀', '商战', '航海', '边疆', '高中', '大学', '研究生', '实验室', '法医', '警局', '法庭', '军队', '渔村', '古镇', '茶楼', '客栈', '战场', '江湖', '朝堂', '后宫', '王府', '侯门', '世家', '综艺', '剧组', '经纪公司', '电竞战队', '直播平台', '美食街', '咖啡馆', '书店', '花店', '旅店', '飞机', '火车', '游轮']
    },
    {
      group: '风格',
      items: ['悬疑', '惊悚', '治愈', '沙雕', '甜宠', '虐恋', '日常', '公路', '童话', '意识流', '轻松', '黑色幽默', '成长', '救赎', '复仇', '群像', '慢热', '强剧情', '致郁', '单元剧', '散文', '电影感', '白描', '古典', '轻小说', '荒诞', '诗性', '热血', '温馨', '暗黑', '反套路', '群像剧', '双向暗恋', '细水长流']
    }
  ];

  var STYLES = ['细腻克制', '冷峻疏离', '温柔治愈', '幽默轻快', '古典雅致', '电影感', '白描', '意识流', '甜宠', '虐心', '悬疑冷感', '口语化', '诗性', '强情节', '轻小说', '黑色幽默', '热血', '致郁'];

  var LENGTHS = {
    short: { label: '短篇', range: '6–9 章', planned: 8 },
    medium: { label: '中篇', range: '10–15 章', planned: 12 },
    long: { label: '长篇', range: '16–20 章', planned: 18 }
  };
  var ENDINGS = { HE: 'HE', BE: 'BE', OE: 'OE' };

  function uid() {
    return 'ff_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  // ---- 本地书库：IndexedDB 为主，localStorage 作为同步缓存 ----
  // 同人文一章可能上万字，单靠 localStorage（约 5MB）很容易写满后静默失败，
  // 表现就是生成完/刷新后提示“找不到这篇故事”。这里改成双写：
  //   * localStorage：保留同步读取能力（小数据秒开）
  //   * IndexedDB：主存储，容量大，正文再长也不会把整本书挤丢
  var MEM = null;
  var READY = null;
  var DB_NAME = 'nano_fanfic_db';
  var DB_STORE = 'kv';

  function cleanList(arr) {
    return Array.isArray(arr) ? arr.filter(function (s) { return s && s.id; }) : [];
  }
  function sortList(arr) {
    return arr.slice().sort(function (a, b) {
      return (Number(b.updatedAt || b.createdAt) || 0) - (Number(a.updatedAt || a.createdAt) || 0);
    });
  }
  function readLS() {
    try {
      var raw = localStorage.getItem(KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return cleanList(arr);
    } catch (e) { return []; }
  }
  function writeLS(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
  }
  function setMem(list) {
    MEM = sortList(cleanList(list));
    return MEM;
  }
  function load() {
    if (MEM) return MEM;
    return setMem(readLS());
  }
  function openDB() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      var req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'k' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB open failed')); };
      req.onblocked = function () { reject(new Error('IndexedDB blocked')); };
    });
  }
  function dbGet(k) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          var tx = db.transaction(DB_STORE, 'readonly');
          var rq = tx.objectStore(DB_STORE).get(k);
          rq.onsuccess = function () {
            try { db.close(); } catch (e) {}
            var rec = rq.result;
            resolve(rec && Array.isArray(rec.v) ? rec.v : null);
          };
          rq.onerror = function () { try { db.close(); } catch (e) {} reject(rq.error); };
        } catch (e) { try { db.close(); } catch (e2) {} reject(e); }
      });
    });
  }
  function dbPut(k, v) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          var tx = db.transaction(DB_STORE, 'readwrite');
          tx.objectStore(DB_STORE).put({ k: k, v: v });
          tx.oncomplete = function () { try { db.close(); } catch (e) {} resolve(true); };
          tx.onerror = function () { try { db.close(); } catch (e) {} reject(tx.error); };
          tx.onabort = function () { try { db.close(); } catch (e) {} reject(tx.error || new Error('aborted')); };
        } catch (e) { try { db.close(); } catch (e2) {} reject(e); }
      });
    });
  }
  function mergeLists(a, b) {
    var map = {};
    (a || []).concat(b || []).forEach(function (s) {
      if (!s || !s.id) return;
      var prev = map[s.id];
      var t = Number(s.updatedAt || s.createdAt) || 0;
      var pt = prev ? (Number(prev.updatedAt || prev.createdAt) || 0) : -1;
      if (!prev || t >= pt) map[s.id] = s;
    });
    return sortList(Object.keys(map).map(function (k) { return map[k]; }));
  }
  function ready() {
    if (READY) return READY;
    READY = new Promise(function (resolve) {
      var settled = false;
      function done() { if (!settled) { settled = true; resolve(load()); } }
      var timer = setTimeout(done, 4000);
      (async function () {
        var ls = readLS();
        var idb = null;
        try { idb = await dbGet('library'); } catch (e) {}
        var merged = mergeLists(ls, idb);
        setMem(merged);
        // 只有「IndexedDB 缺失 / 条数不同 / 某本更新时间不同」才回写，避免每次打开都重写整库
        var needWrite = !idb || !idb.length || merged.length !== idb.length;
        if (!needWrite) {
          for (var i = 0; i < merged.length; i++) {
            var hit = idb.find(function (x) { return x.id === merged[i].id; });
            if (!hit || Number(hit.updatedAt || hit.createdAt || 0) !== Number(merged[i].updatedAt || merged[i].createdAt || 0)) {
              needWrite = true;
              break;
            }
          }
        }
        if (needWrite) {
          try { await dbPut('library', merged); } catch (e) {}
          writeLS(merged);
        } else if (ls.length !== merged.length) {
          writeLS(merged);
        }
        clearTimeout(timer);
        done();
      })().catch(function () {
        setMem(readLS());
        clearTimeout(timer);
        done();
      });
    });
    return READY;
  }
  function queueDBWrite(list) {
    try {
      ready().then(function () { return dbPut('library', list); }).catch(function () {});
    } catch (e) {}
  }
  function applyStory(story) {
    var list = load().slice();
    var i = list.findIndex(function (s) { return s.id === story.id; });
    if (i >= 0) list[i] = story; else list.unshift(story);
    return setMem(list);
  }
  function saveAll(list) {
    var arr = setMem(list);
    writeLS(arr);
    queueDBWrite(arr);
    return arr;
  }
  function save(story) {
    var list = applyStory(story);
    writeLS(list);
    queueDBWrite(list);
    return story;
  }
  // 关键保存（新建 / 每章正文）：同时等 IndexedDB 落盘，返回是否至少有一处成功
  async function saveAsync(story) {
    try { await ready(); } catch (e) {}
    var list = applyStory(story);
    var local = writeLS(list);
    var remote = false;
    try { await dbPut('library', list); remote = true; } catch (e) {}
    return { ok: !!(local || remote), local: local, idb: remote };
  }
  function get(id) {
    return load().find(function (s) { return s.id === id; }) || null;
  }
  function remove(id) {
    var list = load().filter(function (s) { return s.id !== id; });
    setMem(list);
    writeLS(list);
    queueDBWrite(list);
  }
  function planFor(type) { return LENGTHS[type] || LENGTHS.medium; }
  function loadCustom() {
    try {
      var raw = localStorage.getItem(CUSTOM_KEY);
      var d = raw ? JSON.parse(raw) : null;
      return {
        genres: Array.isArray(d && d.genres) ? d.genres.filter(function (x) { return x && x.title; }) : [],
        styles: Array.isArray(d && d.styles) ? d.styles.filter(function (x) { return x && x.title; }) : []
      };
    } catch (e) { return { genres: [], styles: [] }; }
  }
  function saveCustom(d) {
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(d || { genres: [], styles: [] })); } catch (e) {}
  }

  function openApiDB() {
    return new Promise(function (resolve, reject) {
      try {
        var req = indexedDB.open('nano_api_db');
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains('api_data')) db.createObjectStore('api_data', { keyPath: 'key' });
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      } catch (e) { reject(e); }
    });
  }
  function readApiConfig() {
    return new Promise(function (resolve) {
      function fallback() {
        try {
          var raw = localStorage.getItem('nano_api_config');
          var v = raw ? JSON.parse(raw) : null;
          if (v && v.mainUrl && v.mainKey && v.mainModel) { resolve(v); return; }
        } catch (e) {}
        resolve(null);
      }
      openApiDB().then(function (db) {
        try {
          var tx = db.transaction('api_data', 'readonly');
          var rq = tx.objectStore('api_data').get('nano_api_config');
          rq.onsuccess = function () {
            try { db.close(); } catch (e) {}
            var rec = rq.result;
            var v = rec && rec.value && typeof rec.value === 'object' ? rec.value : rec;
            if (v && v.mainUrl && v.mainKey && v.mainModel) resolve(v);
            else fallback();
          };
          rq.onerror = function () { try { db.close(); } catch (e) {} fallback(); };
        } catch (e) { try { db.close(); } catch (err) {} fallback(); }
      }).catch(fallback);
    });
  }

  function apiBase(u) {
    var s = String(u || '').trim().replace(/\/+$/, '').replace(/([^:])\/{2,}/g, '$1/');
    try {
      var url = new URL(s);
      var host = url.hostname;
      var cur = window.location.hostname;
      var isLan = cur && (/^(localhost|127\.0\.0\.1|\[::1\]|::1)$/i.test(cur) || /^10\./.test(cur) || /^192\.168\./.test(cur) || /^172\.(1[6-9]|2\d|3[01])\./.test(cur) || /\.local$/i.test(cur));
      // 只有页面本身也在本地 / 局域网时，才把 localhost 换成当前主机；
      // 公网部署下保留原地址，避免把用户的本机 API 地址改成不可达的公网域名。
      if ((host === 'localhost' || host === '127.0.0.1' || host === '[::1]') && isLan) {
        url.hostname = cur;
        s = url.toString().replace(/\/+$/, '').replace(/([^:])\/{2,}/g, '$1/');
      }
    } catch (e) {}
    s = s.replace(/\/chat\/completions$/i, '').replace(/\/embeddings$/i, '').replace(/\/images\/(generations|edits)$/i, '/v1');
    if (!/\/v1$/i.test(s)) s += '/v1';
    return s;
  }

  function sendApiRequest(payload) {
    return new Promise(function (resolve) {
      var token = 'ff' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      var resultKey = 'chat_api_result_' + token;
      var done = false;
      var poll = null;
      var cap = null;
      function finish(r) {
        if (done) return;
        done = true;
        if (poll) clearInterval(poll);
        if (cap) clearTimeout(cap);
        try { window.removeEventListener('storage', onStorage); } catch (e) {}
        try { window.removeEventListener('message', onMsg); } catch (e) {}
        try { window.removeEventListener('message', onStream); } catch (e) {}
        try { localStorage.removeItem(resultKey); } catch (e) {}
        resolve(r || { ok: false, status: 0, error: 'API 请求失败' });
      }
      function onStorage(e) {
        if (!e || e.key !== resultKey || !e.newValue) return;
        var r = null;
        try { r = JSON.parse(e.newValue); } catch (err) {}
        if (r) finish(r);
      }
      function onMsg(e) {
        var d = e && e.data;
        if (!d || d.type !== 'chatApiDone' || d.token !== token) return;
        if (d.result) { finish(d.result); return; }
        var v = null;
        var parsed = null;
        try { v = localStorage.getItem(resultKey); } catch (err) {}
        if (v) { try { parsed = JSON.parse(v); } catch (err) {} }
        finish(parsed || { ok: false, status: 0, error: '未取到 API 结果' });
      }
      function onStream(e) {
        var d = e && e.data;
        if (!d || d.type !== 'chatApiStream' || d.token !== token) return;
        if (typeof payload.onDelta !== 'function') return;
        try { payload.onDelta(String(d.delta || '')); } catch (err) {}
      }
      window.addEventListener('storage', onStorage);
      window.addEventListener('message', onMsg);
      if (typeof payload.onDelta === 'function') window.addEventListener('message', onStream);
      // 只有「父页面就是最外层」时才走父页面代理（正常全屏 App 都是这样）。
      // 这样可以避开 CORS / 某些中转站只认主页面请求的问题。
      var useProxy = false;
      try { useProxy = !!(window.parent && window.parent !== window && window.parent === window.top); } catch (e) { useProxy = false; }
      if (useProxy) {
        try {
          window.parent.postMessage({
            type: 'chatApiFetch', token: token, resultKey: resultKey,
            url: payload.url, method: 'POST', headers: payload.headers, body: payload.body,
            stream: !!payload.stream
          }, '*');
        } catch (e) { useProxy = false; }
      }
      if (!useProxy) {
        var body = payload.body;
        if (payload.stream) {
          try {
            var obj = JSON.parse(body);
            delete obj.stream;
            body = JSON.stringify(obj);
          } catch (e) {}
        }
        fetch(payload.url, { method: 'POST', headers: payload.headers, body: body })
          .then(function (r) {
            return r.text().then(function (t) { return { ok: r.ok, status: r.status, text: t }; });
          })
          .then(finish)
          .catch(function (err) {
            finish({ ok: false, status: 0, error: String((err && err.message) || err) });
          });
        return;
      }
      poll = setInterval(function () {
        try {
          var v = localStorage.getItem(resultKey);
          if (!v) return;
          var r = JSON.parse(v);
          if (r) finish(r);
        } catch (e) {}
      }, 400);
      cap = setTimeout(function () { finish({ ok: false, status: 0, error: 'API 请求超时' }); }, 180000);
    });
  }

  function apiMessage(res) {
    var text = String((res && res.text) || '');
    var msg = '';
    try {
      var j = JSON.parse(text);
      var e = j && j.error;
      if (typeof e === 'string') msg = e;
      else if (e && e.message) msg = e.message;
      if (!msg && j) msg = j.message || j.detail || j.msg || j.error_msg || '';
      if (msg && typeof msg !== 'string') msg = JSON.stringify(msg);
    } catch (e) {}
    if (!msg) msg = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!msg && res && res.error) msg = String(res.error);
    return msg;
  }
  function apiError(res) {
    var msg = apiMessage(res);
    if (!msg && res && (res.status === 400 || res.status === 422)) {
      msg = '参数被接口拒绝（已自动改用保守参数）；可换个模型或查看控制台日志';
    }
    if (res && (res.status === 400 || res.status === 422)) {
      return new Error('接口拒绝了这次请求' + (msg ? ('：' + msg) : '') + '（已自动尝试保守参数）');
    }
    var status = (res && res.status && res.status !== 200)
      ? ('API ' + res.status)
      : (res && res.status === 200 ? 'API 返回错误' : 'API 请求失败');
    return new Error(status + (msg ? ('：' + msg) : ''));
  }
  function trimMessages(messages, budget) {
    budget = Math.max(900, Number(budget) || 5200);
    return (messages || []).map(function (m) {
      var c = String((m && m.content) || '');
      if (c.length <= budget) return { role: (m && m.role) || 'user', content: c };
      // 保留开头（配对/题材/角色设定）和结尾（硬性要求/去油红线），
      // 中间的长设定、前情摘要在小上下文模型上先牺牲。
      var head = Math.max(260, Math.floor(budget * 0.42));
      var tail = Math.max(320, budget - head - 20);
      return {
        role: (m && m.role) || 'user',
        content: c.slice(0, head) + '\n\n……（中间省略）……\n\n' + c.slice(-tail)
      };
    });
  }
  function withoutSystem(messages) {
    return (messages || []).map(function (m) {
      var isSystem = m && m.role === 'system';
      return {
        role: isSystem ? 'user' : ((m && m.role) || 'user'),
        content: isSystem ? ('【系统设定】\n' + String(m.content || '')) : String((m && m.content) || '')
      };
    });
  }
  function withUserMessage(messages) {
    var arr = (messages || []).map(function (m) {
      return { role: (m && m.role) || 'user', content: String((m && m.content) || '') };
    });
    // 有些接口不接受「只有 system、没有 user」的请求，直接 400。
    if (!arr.some(function (m) { return m.role === 'user'; })) {
      arr.push({ role: 'user', content: '请直接按上面的要求输出内容，不要解释。' });
    }
    return arr;
  }

  async function callApi(messages, opts) {
    opts = opts || {};
    var cfg = await readApiConfig();
    if (!cfg) throw new Error('未配置主 API，请先在 API 页面填写地址 / Key / 模型');
    var url = apiBase(cfg.mainUrl) + '/chat/completions';
    var headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + String(cfg.mainKey || '').trim()
    };
    // 第一次请求就必须足够小：很多模型是先看「输入 + max_tokens」再决定收不收，
    // 提示词保持完整；这里只做一个 12000 字的极端保护，正常同人文设定远小于它。
    // 不把字数 / token 限制写进 prompt 文本，输出预算只放在接口参数里。
    var limit = Math.max(256, Math.min(Number(opts.maxTokens) || 8192, 16384));
    var initialMessages = withUserMessage(messages);
    var PROMPT_BUDGET = 12000;
    var initialChars = initialMessages.reduce(function (n, m) { return n + String((m && m.content) || '').length; }, 0);
    if (initialChars > PROMPT_BUDGET) {
      initialMessages = trimMessages(initialMessages, PROMPT_BUDGET);
      initialChars = initialMessages.reduce(function (n, m) { return n + String((m && m.content) || '').length; }, 0);
    }
    var body = {
      model: cfg.mainModel,
      messages: initialMessages,
      max_tokens: limit,
      temperature: opts.temperature != null ? opts.temperature : 0.9
    };
    var useProxy = false;
    try { useProxy = !!(window.parent && window.parent !== window && window.parent === window.top); } catch (e) { useProxy = false; }
    var wantStream = !!opts.onDelta && useProxy;
    if (wantStream) body.stream = true;
    var sendOpts = { url: url, headers: headers, body: JSON.stringify(body), stream: wantStream, onDelta: opts.onDelta };
    var res = await sendApiRequest(sendOpts);
    var tries = 0;
    var trimBudget = 0;
    var lastResort = false;
    var safeMode = false;
    try {
      console.info('[Fanfic API] prompt chars =', initialChars, 'max_tokens =', limit, 'url =', url);
    } catch (e) {}
    while (res && !res.ok && (res.status === 400 || res.status === 422) && tries < 6) {
      var msg = apiMessage(res);
      var changed = false;
      // 1) 新模型要求 max_completion_tokens
      if (body.max_tokens != null && /(max[_\s-]?tokens|max[_\s-]?completion[_\s-]?tokens)/i.test(msg) && /(max_completion_tokens|not supported|unsupported|不支持|only support)/i.test(msg)) {
        body.max_completion_tokens = body.max_tokens;
        delete body.max_tokens;
        changed = true;
      }
      // 2) 模型不支持 temperature
      else if (body.temperature != null && /temperature/i.test(msg) && /(not supported|unsupported|does not support|only support|invalid|不支持)/i.test(msg)) {
        delete body.temperature;
        changed = true;
      }
      // 3) 内容审核拦截：去掉提示词里的反例词 / 内容尺度，保留完整故事设定再试
      else if (!safeMode && /content.?policy|content.?filter|flagged|safety|moderation|敏感|违规|审核|不安全/i.test(msg)) {
        safeMode = true;
        body.messages = (body.messages || []).map(function (m) {
          var c = String((m && m.content) || '');
          c = c.replace(/【全篇表达红线[\s\S]*$/, '');
          c = c.replace(/【内容尺度】[^\n]*\n?/g, '');
          c = c.replace(/【你的全局提示词[\s\S]*?(?=\n【|$)/, '');
          return { role: (m && m.role) || 'user', content: c + '\n文风克制、具体、生活化；对话自然。\n' };
        });
        changed = true;
      }
      // 4) 输出预算 / 上下文超限：逐档减半，并逐档缩短提示词
      else if (/(max[_\s-]?tokens|max[_\s-]?completion[_\s-]?tokens|maximum context|context length|token limit|too many tokens|上下文|超出.*长度)/i.test(msg)) {
        var cur = Number(body.max_tokens != null ? body.max_tokens : body.max_completion_tokens) || limit;
        if (cur > 512) {
          var next = Math.max(512, Math.floor(cur / 2));
          if (body.max_tokens != null) body.max_tokens = next;
          else body.max_completion_tokens = next;
          changed = true;
        } else if (trimBudget < 1000) {
          trimBudget = 1000;
          body.messages = trimMessages(body.messages, 1000);
          changed = true;
        }
        if (/(context|上下文|length|maximum|too many|超出)/i.test(msg)) {
          trimBudget = trimBudget ? Math.max(900, Math.floor(trimBudget * 0.55)) : 5200;
          body.messages = trimMessages(body.messages, trimBudget);
          changed = true;
        }
      }
      // 5) 个别模型不接受 system role
      else if (/system/i.test(msg) && /(role|message)/i.test(msg) && /(not supported|unsupported|不支持|invalid)/i.test(msg)) {
        body.messages = withoutSystem(body.messages);
        changed = true;
      }
      // 6) 某些中转站只回一个笼统的 400：最后用最保守的参数再试一次
      if (!changed && res.status === 400 && !lastResort) {
        lastResort = true;
        delete body.temperature;
        delete body.max_completion_tokens;
        body.max_tokens = 400;
        body.messages = trimMessages(body.messages, 1000);
        changed = true;
      }
      if (!changed) break;
      try {
        console.warn('[Fanfic API] retry', tries + 1, 'status', res.status, 'max_tokens', body.max_tokens || body.max_completion_tokens, 'trim', trimBudget, 'reason', msg.slice(0, 160));
      } catch (e) {}
      res = await sendApiRequest({
        url: url, headers: headers, body: JSON.stringify(body),
        stream: wantStream, onDelta: opts.onDelta
      });
      tries++;
    }
    if (!res || !res.ok) {
      try { console.warn('[Fanfic API]', res && res.status, apiMessage(res)); } catch (e) {}
      throw apiError(res);
    }
    var data = {};
    try { data = JSON.parse(res.text || '{}'); } catch (e) {}
    if (data && data.error) throw apiError({ ok: false, status: 200, text: res.text });
    var out = '';
    try {
      out = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!out) out = data.choices && data.choices[0] && data.choices[0].text;
      if (!out) out = data.reply || data.text || (data.output && data.output.text) || '';
    } catch (e) {}
    if (Array.isArray(out)) {
      out = out.map(function (p) { return typeof p === 'string' ? p : ((p && p.text) || ''); }).join('');
    }
    if (!String(out || '').trim()) {
      try { console.warn('[Fanfic API] empty response', String(res.text || '').slice(0, 500)); } catch (e) {}
      throw new Error('API 没有返回正文' + (res.text ? ('：' + String(res.text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 300)) : ''));
    }
    return String(out || '').trim();
  }

  function parseJson(raw) {
    var s = String(raw || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a > -1 && b > a) s = s.slice(a, b + 1);
    try { return JSON.parse(s); } catch (e) { return null; }
  }

  window.NanoFanfic = {
    KEY: KEY,
    GENRES: GENRES,
    STYLES: STYLES,
    LENGTHS: LENGTHS,
    ENDINGS: ENDINGS,
    uid: uid,
    esc: esc,
    ready: ready,
    load: load,
    save: save,
    saveAsync: saveAsync,
    saveAll: saveAll,
    get: get,
    remove: remove,
    planFor: planFor,
    loadCustom: loadCustom,
    saveCustom: saveCustom,
    readApiConfig: readApiConfig,
    callApi: callApi,
    parseJson: parseJson
  };
})();
