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
    var base = String(u || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
    try {
      var url = new URL(base);
      if (/^(localhost|127\.0\.0\.1)$/i.test(url.hostname) && location.hostname && !/^(localhost|127\.0\.0\.1)$/i.test(location.hostname)) {
        url.hostname = location.hostname;
        base = url.origin + url.pathname.replace(/\/+$/, '');
      }
    } catch (e) {}
    if (base && !/\/v1$/i.test(base)) base += '/v1';
    return base;
  }

  async function callApi(messages, opts) {
    opts = opts || {};
    var cfg = await readApiConfig();
    if (!cfg) throw new Error('未配置主 API，请先在 API 页面填写地址 / Key / 模型');
    var url = apiBase(cfg.mainUrl) + '/chat/completions';
    var resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + String(cfg.mainKey || '').trim()
      },
      body: JSON.stringify({
        model: cfg.mainModel,
        messages: messages,
        max_tokens: opts.maxTokens || 8192,
        temperature: opts.temperature != null ? opts.temperature : 0.9
      })
    });
    if (!resp.ok) {
      var txt = '';
      try { txt = await resp.text(); } catch (e) {}
      var msg = '';
      try {
        var j = JSON.parse(txt);
        msg = (j && j.error && j.error.message) || (j && j.message) || '';
      } catch (e) {}
      throw new Error('API ' + resp.status + (msg ? '：' + msg : ''));
    }
    var data = await resp.json();
    var out = '';
    try {
      out = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!out) out = data.choices && data.choices[0] && data.choices[0].text;
      if (!out) out = data.reply || data.text || '';
    } catch (e) {}
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
