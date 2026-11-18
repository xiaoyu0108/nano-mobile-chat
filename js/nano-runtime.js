(function () {
  'use strict';

  // APK 原生桥：把账号登录态备份到 SharedPreferences，并在冷启动时补回 localStorage。
  // 部分安卓 ROM 清理 WebView 数据/配额写满时，localStorage 里的 token 可能丢失，
  // 表现为“退出一次就要重新登录”；原生备份不受 localStorage 配额影响。
  (function nativeBoot() {
    var app = null;
    try { app = window.NanoApp || (window.top !== window ? window.top.NanoApp : null); } catch (e) {}
    if (!app) return;
    window.__NANO_NATIVE__ = true;
    try {
      if (app.getSession) {
        var raw = app.getSession();
        if (raw) {
          var s = JSON.parse(raw);
          if (s && s.token && s.username) {
            try { if (!localStorage.getItem('nano_account_token')) localStorage.setItem('nano_account_token', s.token); } catch (e) {}
            try { if (!localStorage.getItem('nano_account_user')) localStorage.setItem('nano_account_user', s.username); } catch (e) {}
          }
          if (s && s.deviceId) {
            try { if (!localStorage.getItem('nano_device_id')) localStorage.setItem('nano_device_id', s.deviceId); } catch (e) {}
          }
        }
      }
    } catch (e) {}
    try {
      if (app.getInsets) {
        var ins = JSON.parse(app.getInsets() || '{}');
        var top = Number(ins.top) || 0;
        var bottom = Number(ins.bottom) || 0;
        window.__NANO_NATIVE_TOP_INSET__ = top;
        window.__NANO_NATIVE_BOTTOM_INSET__ = bottom;
        var de = document.documentElement;
        if (de) {
          de.style.setProperty('--safe-inset-top', top + 'px');
          de.style.setProperty('--safe-top', top + 'px');
          de.style.setProperty('--safe-t', top + 'px');
          de.style.setProperty('--safe-bottom', bottom + 'px');
          de.style.setProperty('--safe-b', bottom + 'px');
          de.style.setProperty('--nano-safe-bottom', bottom + 'px');
        }
      }
    } catch (e) {}
  })();

  // 旧测试 Worker（nano-test-ceshi / peek-test）仍在运行 Bark 推送和旧 KV 配额。
  // 一旦本机还保存着它们的地址，这里自动切回正式 Worker，避免继续往旧服务发请求。
  try {
    var ep = String(localStorage.getItem('nano_push_endpoint') || '').trim().replace(/\/+$/, '');
    if (ep && (/(^|\.)peek-test\.nano315\.online$/i.test(ep) || /nano-test-ceshi/i.test(ep))) {
      localStorage.setItem('nano_push_endpoint', 'https://nanopush.nano315.online');
    }
  } catch (e) {}

  /* ============================================================
     IndexedDB 防降级 shim
     ------------------------------------------------------------
     备份导入 / 旧版本 App 可能把某个库升级到更高 version，
     而页面里大量代码仍写死 indexedDB.open(name, 1)。
     浏览器遇到「请求版本 < 现有版本」会直接抛
     VersionError: An attempt was made to open a database using
     a lower version than the existing version.
     这里统一包一层：只要现有版本更高，就自动改为「不指定版本」打开，
     并把事件 / result / error 原样转发，调用方代码无需修改。
     ============================================================ */
  (function installIdbShim() {
    if (!window.indexedDB || indexedDB.__nanoSafeOpen) return;
    var nativeOpen = indexedDB.open.bind(indexedDB);

    function safeOpen(name, version) {
      var self = {
        _inner: null,
        _handlers: {},
        _listeners: {},
        _retried: false
      };

      ['result', 'error', 'readyState', 'source', 'transaction'].forEach(function (prop) {
        Object.defineProperty(self, prop, {
          configurable: true,
          enumerable: true,
          get: function () { return self._inner ? self._inner[prop] : undefined; }
        });
      });

      ['onupgradeneeded', 'onsuccess', 'onerror', 'onblocked'].forEach(function (prop) {
        Object.defineProperty(self, prop, {
          configurable: true,
          enumerable: true,
          get: function () { return self._handlers[prop] || null; },
          set: function (fn) { self._handlers[prop] = typeof fn === 'function' ? fn : null; }
        });
      });

      function dispatch(type, event) {
        var key = 'on' + type;
        var handler = self._handlers[key];
        if (typeof handler === 'function') {
          try { handler.call(self, event); } catch (e) { setTimeout(function () { throw e; }, 0); }
        }
        var list = self._listeners[type];
        if (list && list.length) {
          list.slice().forEach(function (fn) {
            try { fn.call(self, event); } catch (e) { setTimeout(function () { throw e; }, 0); }
          });
        }
      }

      self.addEventListener = function (type, fn) {
        if (typeof fn !== 'function') return;
        (self._listeners[type] = self._listeners[type] || []).push(fn);
      };
      self.removeEventListener = function (type, fn) {
        var list = self._listeners[type];
        if (!list) return;
        var i = list.indexOf(fn);
        if (i !== -1) list.splice(i, 1);
      };

      function bind(inner) {
        self._inner = inner;
        inner.onupgradeneeded = function (e) { dispatch('upgradeneeded', e); };
        inner.onsuccess = function (e) { dispatch('success', e); };
        inner.onblocked = function (e) { dispatch('blocked', e); };
        inner.onerror = function (e) {
          var err = inner.error;
          // 版本降级：不把错误抛给业务代码，改成「不指定版本」重开一次
          if (err && err.name === 'VersionError' && version != null && !self._retried) {
            self._retried = true;
            try { inner.onerror = null; } catch (e2) {}
            try { inner.onupgradeneeded = inner.onsuccess = inner.onblocked = null; } catch (e3) {}
            var retry = nativeOpen(name);
            bind(retry);
            return;
          }
          dispatch('error', e);
        };
      }

      function realOpen(useVersion) {
        var req;
        try { req = useVersion == null ? nativeOpen(name) : nativeOpen(name, useVersion); }
        catch (e) {
          self._inner = { error: e, readyState: 'done' };
          setTimeout(function () { dispatch('error', { target: self, error: e }); }, 0);
          return;
        }
        bind(req);
      }

      // 直接按调用方版本打开；只有真的遇到 VersionError 才无版本重试。
      // 不再先调 indexedDB.databases()：这个预检在移动端经常要几十到几百毫秒，
      // 而每个页面启动都要开好几个库，会明显拖慢首屏和聊天加载。
      realOpen(version);

      return self;
    }

    indexedDB.open = function (name, version) {
      if (version === undefined || version === null) return nativeOpen(name);
      return safeOpen(name, version);
    };
    try { indexedDB.__nanoSafeOpen = true; } catch (e) {}
  })();

  var script = document.currentScript;
  var root = './';
  try {
    if (script && script.src) root = new URL('../', script.src).href;
  } catch (e) {}
  window.NANO_ROOT = root;

  // 申请持久化存储：iOS/安卓在存储紧张时可能回收 IndexedDB，表现为“大退一次图片就没了”。
  // 申请失败不影响使用，只是没拿到免回收保护。
  try {
    if (navigator.storage && navigator.storage.persist && !navigator.storage.__nanoPersistRequested) {
      navigator.storage.__nanoPersistRequested = true;
      navigator.storage.persist().catch(function () {});
    }
  } catch (e) {}

  // 锁脸参考统一读取：localStorage 优先，旧的大图只写进 IndexedDB 时回退到 localforage。
  // 所有生图入口（私聊 / 日程 / 朋友圈 / INS / 线下 / 群聊）共用这一份，避免各页面各读各的。
  function faceRefKey(id) { return 'chat_setting_faceRef_' + String(id || ''); }
  function faceRefSync(id) {
    try {
      var raw = localStorage.getItem(faceRefKey(id));
      if (!raw) return '';
      try { return String(JSON.parse(raw) || ''); } catch (e) { return String(raw || ''); }
    } catch (e) { return ''; }
  }
  function faceRefGet(id) {
    var local = faceRefSync(id);
    if (local) return Promise.resolve(local);
    try {
      if (typeof localforage !== 'undefined' && typeof localforage.getItem === 'function') {
        return localforage.getItem(faceRefKey(id)).then(function (v) {
          return v ? String(v) : '';
        }).catch(function () { return ''; });
      }
    } catch (e) {}
    // 少数页面没有加载 localforage：直接读它默认的 IndexedDB 库，旧的大图也能取到。
    return new Promise(function (resolve) {
      try {
        if (typeof indexedDB === 'undefined') { resolve(''); return; }
        var req = indexedDB.open('localforage');
        // 库不存在时不要顺手创建空库，否则会破坏 localforage 自己的建表流程。
        req.onupgradeneeded = function (e) {
          try { e.target.transaction.abort(); } catch (err) {}
          resolve('');
        };
        req.onsuccess = function (e) {
          try {
            var db = e.target.result;
            if (!db.objectStoreNames.contains('keyvaluepairs')) { try { db.close(); } catch (err) {} resolve(''); return; }
            var g = db.transaction('keyvaluepairs', 'readonly').objectStore('keyvaluepairs').get(faceRefKey(id));
            g.onsuccess = function () { try { db.close(); } catch (err) {} resolve(g.result ? String(g.result) : ''); };
            g.onerror = function () { try { db.close(); } catch (err) {} resolve(''); };
          } catch (err) { resolve(''); }
        };
        req.onerror = function () { resolve(''); };
        req.onblocked = function () { resolve(''); };
      } catch (e) { resolve(''); }
    });
  }
  window.NanoFaceRef = { key: faceRefKey, sync: faceRefSync, get: faceRefGet };

  // ============================================================
  // 统一锁脸（单人 / 双人 / 多人）
  // ------------------------------------------------------------
  // 只锁「五官 + 脸型 + 肤色 + 发色/发型」，不锁姿势、位置、头部角度、表情、
  // 服装、身材、背景和构图。双人/多人时把每张参考图对应到具体的人，避免换脸/混脸。
  // 线上私聊、线下、INS、朋友圈、旅途、日程、群聊都走这一份，避免各处各写一套。
  // ============================================================
  function chatSettingKey(id, key) { return 'chat_setting_' + key + '_' + String(id || ''); }
  function chatSettingSync(id, key, def) {
    try {
      var raw = localStorage.getItem(chatSettingKey(id, key));
      if (raw === null || raw === '') return def;
      try { var v = JSON.parse(raw); return v == null ? def : v; } catch (e) { return raw; }
    } catch (e) { return def; }
  }
  function chatSettingAsync(id, key, def) {
    var v = chatSettingSync(id, key, '');
    if (v !== '' && v != null) return Promise.resolve(v);
    try {
      if (typeof localforage !== 'undefined' && typeof localforage.getItem === 'function') {
        return localforage.getItem(chatSettingKey(id, key)).then(function (x) {
          return (x == null || x === '') ? def : x;
        }).catch(function () { return def; });
      }
    } catch (e) {}
    return Promise.resolve(def);
  }
  function currentMaskData() {
    try {
      var raw = localStorage.getItem('nano_mask_data');
      if (!raw) return null;
      var d = JSON.parse(raw), arr = (d && d.masks) || [];
      for (var i = 0; i < arr.length; i++) {
        if (String(arr[i].id) === String(d.currentMaskId)) return arr[i];
      }
      return arr[0] || null;
    } catch (e) { return null; }
  }
  function maskAvatarById(id) {
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.open('MaskAvatarDB', 1);
        req.onupgradeneeded = function (e) {
          try { var db = e.target.result; if (!db.objectStoreNames.contains('avatars')) db.createObjectStore('avatars', { keyPath: 'id' }); } catch (err) {}
        };
        req.onsuccess = function (e) {
          try {
            var db = e.target.result;
            if (!db.objectStoreNames.contains('avatars')) { db.close(); resolve(''); return; }
            var g = db.transaction('avatars', 'readonly').objectStore('avatars').get(id);
            g.onsuccess = function () { try { db.close(); } catch (err) {} resolve(g.result ? String(g.result.data || '') : ''); };
            g.onerror = function () { try { db.close(); } catch (err) {} resolve(''); };
          } catch (err) { resolve(''); }
        };
        req.onerror = function () { resolve(''); };
      } catch (e) { resolve(''); }
    });
  }
  var __faceLockChars = null, __faceLockCharsAt = 0;
  function allCharacterList() {
    if (__faceLockChars && Date.now() - __faceLockCharsAt < 20000) return Promise.resolve(__faceLockChars);
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.open('nano_characters_db', 1);
        req.onupgradeneeded = function (e) {
          try { var db = e.target.result; if (!db.objectStoreNames.contains('characters')) db.createObjectStore('characters', { keyPath: 'id' }); } catch (err) {}
        };
        req.onsuccess = function (e) {
          try {
            var db = e.target.result;
            if (!db.objectStoreNames.contains('characters')) { db.close(); resolve(__faceLockChars || []); return; }
            var g = db.transaction('characters', 'readonly').objectStore('characters').getAll();
            g.onsuccess = function () {
              try { db.close(); } catch (err) {}
              __faceLockChars = g.result || [];
              __faceLockCharsAt = Date.now();
              resolve(__faceLockChars);
            };
            g.onerror = function () { try { db.close(); } catch (err) {} resolve(__faceLockChars || []); };
          } catch (err) { resolve(__faceLockChars || []); }
        };
        req.onerror = function () { resolve(__faceLockChars || []); };
      } catch (e) { resolve([]); }
    });
  }
  function faceLockNote(labels) {
    labels = (labels || []).filter(Boolean);
    if (!labels.length) return '';
    var mapping = labels.map(function (n, i) { return '第' + (i + 1) + '张=' + n; }).join('，');
    var note = '【锁脸 · 只锁五官】只锁定' + (labels.length > 1 ? '每个人的' : '') +
      '五官、脸型、肤色、发色与发型；参考图里的姿势、头部角度、表情、服装、身材、位置、背景和构图都不要照搬，可以自由变化。';
    if (labels.length > 1) {
      note += '参考图对应：' + mapping + '；如果只提供一张左右/网格拼接图，就按从左到右、从上到下依次对应。画面里出现这些人时，每个人的脸必须分别与对应参考图一致，不能混合、互换或换成另一个人。';
    } else {
      note += '参考图是「' + labels[0] + '」本人：脸要和参考图一致，但姿势、服装、场景、镜头可以换。';
    }
    return note;
  }
  function loadFaceImage(src) {
    return new Promise(function (resolve, reject) {
      try {
        var img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function () { resolve(img); };
        img.onerror = function () { reject(new Error('image load failed')); };
        img.src = src;
      } catch (e) { reject(e); }
    });
  }
  // 只接受单张参考图的网关：把多人参考按顺序拼成一张（从左到右、从上到下）。
  async function combineFaceRefs(refs) {
    try {
      var imgs = await Promise.all(refs.map(loadFaceImage));
      if (!imgs.length) return refs[0] || '';
      var n = imgs.length;
      var cols = n <= 2 ? n : (n <= 4 ? 2 : 3);
      var rows = Math.ceil(n / cols);
      var tile = 512;
      var cv = document.createElement('canvas');
      cv.width = cols * tile; cv.height = rows * tile;
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#f2f2f2';
      ctx.fillRect(0, 0, cv.width, cv.height);
      imgs.forEach(function (img, i) {
        var x = (i % cols) * tile, y = Math.floor(i / cols) * tile;
        var scale = Math.max(tile / (img.width || 1), tile / (img.height || 1));
        var w = (img.width || 1) * scale, h = (img.height || 1) * scale;
        ctx.drawImage(img, x + (tile - w) / 2, y + (tile - h) / 2, w, h);
      });
      return cv.toDataURL('image/jpeg', 0.92);
    } catch (e) {
      return refs[0] || '';
    }
  }
  function normNat(v) {
    return String(v || '').replace(/\s+/g, '').replace(/国$/, '');
  }
  function isCrossCountryMask(mask, ch) {
    if (!ch) return false;
    var a = normNat(mask && mask.nationality) || '中国';
    var b = normNat(ch.nationality || ch.country);
    if (!b || b === '未知' || b === '未设定') return false;
    return a !== b;
  }
  function hasRemoteFlag(charId) {
    try {
      var f = JSON.parse(localStorage.getItem('nano_travel_remote_' + String(charId || '')) || 'null');
      return !!(f && Date.now() - Number(f.at || 0) < 120 * 86400000);
    } catch (e) { return false; }
  }
  function isSceneOnlyText(text) {
    var s = String(text || '');
    if (/(无人|空镜|只拍场景|只有风景|不要人物|没有人物|无人物)/.test(s)) return true;
    var personCue = /(我|自己|人物|人像|脸|五官|自拍|全身|半身|特写|站|坐|躺|走|跑|笑|看镜头|穿|戴|抱|牵|回头|侧脸|男朋友|女朋友|男友|女友|老公|老婆|对象|恋人|伴侣|双人|两人|我们|一起|合照|合影|男生|女生|男孩|女孩|男人|女人|他|她)/;
    var sceneCue = /(夕阳|日落|天空|云|海|海浪|沙滩|街景|街道|咖啡|桌面|电脑|食物|美食|花|树|猫|狗|雨|雪|风景|山|湖|夜景|窗|房间|书|手机)/;
    return sceneCue.test(s) && !personCue.test(s);
  }
  // 返回：refs（按提示词顺序）、labels、faceRef（兼容只收单图的网关）、note
  async function buildFaceLocks(charId, prompt, opts) {
    opts = opts || {};
    var text = String(prompt || '');
    var maxRefs = Math.max(1, Math.min(6, parseInt(opts.maxRefs, 10) || 4));
    var mode = String(await chatSettingAsync(charId, 'coupleFaceMode', 'none') || 'none');
    var charRef = '';
    try { charRef = await faceRefGet(charId); } catch (e) {}
    if (!charRef) { try { charRef = String(await chatSettingAsync(charId, 'coupleFaceChar', '') || ''); } catch (e) {} }
    var charName = String(opts.charName || '当前角色');
    var mask = currentMaskData();
    var chars = [];
    try { chars = await allCharacterList(); } catch (e) {}
    var charObj = null;
    for (var ci = 0; ci < chars.length; ci++) {
      if (chars[ci] && String(chars[ci].id) === String(charId)) { charObj = chars[ci]; break; }
    }
    if (charObj && charObj.name && charName === '当前角色') charName = String(charObj.name);
    // 出场人物优先读 AI 写好的「人物：...」。没有才用关键词兜底。
    var mm = text.match(/(?:^|[\n。；;])\s*(?:【)?人物(?:】)?[：:]\s*([^\n。；;]+)/);
    var marker = mm ? String(mm[1] || '').trim() : '';
    var absent = /(异国|异地|不在身边|见不到|看不到|隔着屏幕|视频通话|电话里|屏幕|远方|两地|分开|独自|一个人|单人|自拍|只有我|只有TA|只有他|只有她)/;
    var screen = /(视频|电话|屏幕|直播|截图)/;
    var strongTogether = /(见面|在一起|来到|陪你|身边|面前|面对面|牵手|拥抱|靠在|同框|合照|合影|双人|两人|两个人|约会|同居|住在一起|同行)/;
    var weakTogether = /(我们|和你|与你|你和我|我和你|你俩|你们俩|我们俩|我们两个)/;
    var multiCue = /(多人|一群人|几个人|大家|所有人|朋友们|好友们|同学|同事|聚会|派对|聚餐|集体|出游|出去玩|合照|合影|同框|group photo|friends|everyone|party|together)/i;
    var groupCue = /(大家|所有人|全部人|全群|群里|群成员|我们几个|几个人一起|everyone|whole group|all of us)/i;
    var sceneOnly = false;
    var userPresent = false;
    var charPresent = true;
    var extraNames = [];
    if (marker) {
      if (/(无人|空镜|无人物|只拍场景|只有风景|不要人物|没有人物)/.test(marker)) {
        sceneOnly = true;
        charPresent = false;
      } else {
        userPresent = /(用户|对方|你和我|我和你|你俩|你们俩|我们|双人|两人|两个人|TA|他|她)/.test(marker)
          && !/(没有用户|不含用户|不要用户|不见用户)/.test(marker);
        var realCharName = (charObj && charObj.name) ? String(charObj.name) : charName;
        var mentionsMe = /(我|自己|角色)/.test(marker) || marker.indexOf(charName) >= 0 || marker.indexOf(realCharName) >= 0;
        var othersInMarker = [];
        (chars || []).forEach(function (c) {
          if (!c || c.id == null || String(c.id) === String(charId)) return;
          var nm = String(c.name || '').trim();
          if (nm.length < 2) return;
          var idx = marker.indexOf(nm);
          if (idx >= 0) othersInMarker.push({ id: c.id, name: nm, idx: idx });
        });
        charPresent = mentionsMe || (!userPresent && !othersInMarker.length);
        extraNames = othersInMarker;
      }
    } else {
      sceneOnly = isSceneOnlyText(text);
      if (!sceneOnly) {
        var maskName = String(mask && mask.name || '').trim();
        var enCouple = /(couple|together|holding hands|hug|hugging|embrace|kiss|date|two people|2 people|1girl.*1boy|1boy.*1girl|companion|accompany)/i;
        var enSolo = /(solo|alone|single person|only one|selfie)/i;
        var hasAbsent = absent.test(text) || screen.test(text);
        var hasStrong = strongTogether.test(text);
        var hasWeak = weakTogether.test(text);
        var hasUserMention = /(用户|对方|你和我|我和你|你俩|你们俩|我们俩|我们两个)/.test(text);
        var partnerCue = /(男朋友|女朋友|男友|女友|老公|老婆|对象|恋人|爱人|伴侣|未婚夫|未婚妻)/.test(text);
        var partnerDateCue = partnerCue && /(一起|约会|见面|旅行|旅游|出游|出去玩|合照|合影)/.test(text);
        var nameMention = !!(maskName.length >= 2 && text.indexOf(maskName) >= 0);
        userPresent = !hasAbsent && (hasStrong || hasUserMention || hasWeak || partnerCue || nameMention || enCouple.test(text));
        if (enSolo.test(text) && !enCouple.test(text)) userPresent = false;
        // 没有「人物：」标记时，异地/异国默认不把用户画进同一张照片；真的见面/在一起/同行才例外。
        var cross = isCrossCountryMask(mask, charObj) || hasRemoteFlag(charId);
        var togetherScene = !!(opts.offline || opts.together || enCouple.test(text) || /(同行者|同行)/.test(text) || partnerDateCue);
        if (cross && !togetherScene && !(hasStrong && !screen.test(text))) userPresent = false;
        if (multiCue.test(text)) {
          (chars || []).forEach(function (c) {
            if (!c || c.id == null || String(c.id) === String(charId)) return;
            var nm = String(c.name || '').trim();
            if (nm.length < 2) return;
            var idx = text.indexOf(nm);
            if (idx >= 0) extraNames.push({ id: c.id, name: nm, idx: idx });
          });
        }
      }
    }
    // 群聊默认是线上：除非剧情明确写到线下见面/现场，否则照片里不放用户。
    if (opts.groupOnline && !/(线下|见面|来到|现场|在一起|同居|约会)/.test(text)) userPresent = false;
    // 锁「我」只影响用户参考；单人照仍然锁角色。
    if (mode === 'none' || mode === 'char') userPresent = false;
    if (mode === 'user' && userPresent) charPresent = false;
    var refs = [], labels = [];
    if (!sceneOnly) {
      if (userPresent) {
        var userRef = '';
        try { userRef = String(await chatSettingAsync(charId, 'coupleFaceUser', '') || ''); } catch (e) {}
        if (!userRef && mask) {
          if (mask.id != null) { try { userRef = await maskAvatarById(mask.id); } catch (e) {} }
          if (!userRef) userRef = String(mask.avatar || '');
        }
        if (userRef) { refs.push(userRef); labels.push(opts.userName || '用户本人'); }
      }
      if (charPresent && charRef) {
        refs.push(charRef);
        labels.push(charName);
      }
    }
    // 多人：只补提示词里真的写了名字的角色；群聊在没有「人物：」时可以用成员表兜底。
    if (!sceneOnly) {
      var wanted = extraNames.slice();
      if (!marker && groupCue.test(text)) {
        var seen = {};
        if (charId != null) seen[String(charId)] = 1;
        wanted.forEach(function (x) { seen[String(x.id)] = 1; });
        (opts.extraIds || []).forEach(function (id) {
          id = (id == null ? '' : String(id));
          if (!id || seen[id]) return;
          seen[id] = 1;
          var nm = '';
          try { if (opts.nameOf) nm = String(opts.nameOf(id) || ''); } catch (e) {}
          wanted.push({ id: id, name: nm || '同伴', idx: 9999 });
        });
      }
      wanted.sort(function (a, b) { return (a.idx - b.idx) || String(a.name).localeCompare(String(b.name)); });
      for (var wi = 0; wi < wanted.length && refs.length < maxRefs; wi++) {
        var r = '';
        try { r = await faceRefGet(wanted[wi].id); } catch (e) {}
        if (r) { refs.push(r); labels.push(wanted[wi].name); }
      }
    }
    var singleRef = refs[0] || '';
    if (refs.length > 1 && refs.every(function (x) { return String(x).indexOf('data:') === 0; })) {
      singleRef = await combineFaceRefs(refs);
    }
    var castLine = '';
    if (sceneOnly) {
      castLine = '【出场人物】无人，只拍场景，不要画人。';
    } else if (marker) {
      castLine = '【出场人物】' + marker + '。按这个名单画，不要加入名单之外的人。';
    } else {
      var castLabels = labels.slice();
      extraNames.forEach(function (x) { if (castLabels.indexOf(x.name) < 0) castLabels.push(x.name); });
      var cast = castLabels.join('、') || (charPresent ? charName : '');
      var unnamedPool = text.replace(/(男朋友|女朋友|男友|女友)/g, '');
      var unnamed = extraNames.length === 0 && /(朋友|同事|同学|大家|人群|路人|当地人|其他人|多人|几个|一群|friends|people|group|company)/i.test(unnamedPool);
      castLine = '【出场人物】' + (cast || '按画面描述') + (unnamed ? '，以及画面描述里提到的其他人物（不要求锁脸）' : '') + '。';
    }
    var note = [castLine, faceLockNote(labels)].filter(Boolean).join('\n');
    return { refs: refs, labels: labels, faceRef: singleRef, note: note, sceneOnly: sceneOnly, userPresent: userPresent, charPresent: charPresent };
  }
  window.NanoFaceLock = { build: buildFaceLocks, note: faceLockNote, getRef: faceRefGet, setting: chatSettingAsync };

  // ============================================================
  // 生图提示词预设（正面 / 反面 / 画师串）
  // ------------------------------------------------------------
  // 之前只有 NAI 和生图室会读取 API 里的提示词预设，普通生图（私聊、群聊、
  // 朋友圈、INS、日程、旅途、自定义 App）经常只发画面描述，画风串和反面词全丢。
  // 这里做一份公共读取器，所有生图入口都能用同一套预设。
  // ============================================================
  function promptJoinValue(v) {
    if (Array.isArray(v)) return v.map(function (x) { return String(x == null ? '' : x).trim(); }).filter(Boolean).join(', ');
    return String(v == null ? '' : v).trim();
  }
  function readPromptPresetsLocal() {
    try {
      var raw = localStorage.getItem('nano_api_prompts');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function readPromptPresets() {
    var local = readPromptPresetsLocal();
    return new Promise(function (resolve) {
      var done = false;
      function finish(v) { if (done) return; done = true; resolve(v || local || {}); }
      if (typeof indexedDB === 'undefined') { finish(local); return; }
      function openExisting() {
        try {
          // 不要用固定版本号创建库：其他模块（表情包等）也用 nano_api_db，
          // 这里只读；库不存在就让 onupgradeneeded 回滚，绝不建一个缺 store 的库。
          var req = indexedDB.open('nano_api_db');
          req.onupgradeneeded = function (e) { try { e.target.transaction.abort(); } catch (err) {} finish(local); };
          req.onerror = function () { finish(local); };
          req.onblocked = function () { finish(local); };
          req.onsuccess = function (e) {
            var db = e.target.result;
            try {
              if (!db.objectStoreNames.contains('api_data')) { finish(local); return; }
              var g = db.transaction('api_data', 'readonly').objectStore('api_data').get('nano_api_prompts');
              g.onsuccess = function () { finish(g.result ? (g.result.value || g.result) : local); };
              g.onerror = function () { finish(local); };
            } catch (err) { finish(local); }
          };
        } catch (e) { finish(local); }
      }
      try {
        if (indexedDB.databases) {
          indexedDB.databases().then(function (list) {
            var has = (list || []).some(function (d) { return d && d.name === 'nano_api_db'; });
            if (has) openExisting(); else finish(local);
          }).catch(openExisting);
        } else {
          openExisting();
        }
      } catch (e) { finish(local); }
    });
  }
  function augmentImagePrompt(prompt, opts) {
    opts = opts || {};
    return readPromptPresets().then(function (p) {
      var positive = promptJoinValue(p && p.positive);
      var negative = promptJoinValue(p && p.negative);
      var out = String(prompt == null ? '' : prompt).trim();
      if (positive && out.indexOf(positive) < 0) out = positive + (opts.separator || ', ') + out;
      // 普通生图模型大多没有 negative_prompt 参数；把反面词写进正面提示词里才真的生效。
      if (negative && opts.appendNegative) {
        var marker = opts.negativeLabel || '避免：';
        if (out.indexOf(negative) < 0 && out.indexOf(marker) < 0) out += '\n' + marker + negative;
      }
      return { prompt: out, positive: positive, negative: negative };
    }).catch(function () {
      return { prompt: String(prompt == null ? '' : prompt), positive: '', negative: '' };
    });
  }
  window.NanoImagePrompt = { read: readPromptPresets, augment: augmentImagePrompt, join: promptJoinValue };

  // 生图接口经常返回会过期的临时 URL。消息里如果只存这个 URL，过几天就会变成问号；
  // 所以在入库前尽量抓成 dataURL（直连 → wsrv 图片代理），失败才保留原地址。
  var imageCache = {};
  function blobToDataUrl(blob) {
    return new Promise(function (resolve) {
      try {
        var fr = new FileReader();
        fr.onload = function () { resolve(String(fr.result || '')); };
        fr.onerror = function () { resolve(''); };
        fr.readAsDataURL(blob);
      } catch (e) { resolve(''); }
    });
  }
  function fetchImageBlob(u, timeout) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(null); } }, timeout || 10000);
      try {
        fetch(u, { mode: 'cors', cache: 'no-store', credentials: 'omit' }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.blob();
        }).then(function (b) {
          if (!b || !/^image\//i.test(b.type || '') || b.size > 8 * 1024 * 1024) throw new Error('bad image');
          if (done) return;
          done = true; clearTimeout(timer); resolve(b);
        }).catch(function () {
          if (done) return;
          done = true; clearTimeout(timer); resolve(null);
        });
      } catch (e) { if (!done) { done = true; clearTimeout(timer); resolve(null); } }
    });
  }
  // 国内直连 wsrv / 生图 CDN 经常被墙或不允许跨域，图片就永远转不成 base64，
  // 临时 URL 一过期就变成问号。走自己的 Worker 代理最稳：手机只要能连上 Worker，
  // 由 Worker 去取图（优先经过 wsrv 压缩）再回传，浏览器侧不存在 CORS 问题。
  function imageProxyBase() {
    try {
      var b = String(localStorage.getItem('nano_push_endpoint') || localStorage.getItem('nano_peek_url') || '').trim().replace(/\/+$/, '');
      if (b) return b.replace(/\/peek$/i, '');
    } catch (e) {}
    return 'https://nanopush.nano315.online';
  }
  function imageProxyToken() {
    try {
      var t = String(localStorage.getItem('nano_peek_token') || localStorage.getItem('nano_push_token') || '').trim();
      if (!t) {
        t = 'pk_' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
        localStorage.setItem('nano_peek_token', t);
        if (!localStorage.getItem('nano_peek_token_initial')) localStorage.setItem('nano_peek_token_initial', t);
      }
      return t;
    } catch (e) { return ''; }
  }
  // 统一把转存后的图片压到「够看又便宜」的尺寸：生图原图动辄 2~5MB，
  // 聊天消息和图库各存一份就会把 IndexedDB 配额撑爆，写入失败后整条消息/图片都会消失。
  function shrinkDataUrl(dataUrl, maxSide, quality) {
    return new Promise(function (resolve) {
      try {
        if (!/^data:image\//i.test(String(dataUrl || ''))) return resolve(dataUrl || '');
        var img = new Image();
        img.onload = function () {
          try {
            var w = img.naturalWidth || img.width || 0;
            var h = img.naturalHeight || img.height || 0;
            if (!w || !h) return resolve(dataUrl);
            var scale = Math.min(1, (maxSide || 1400) / Math.max(w, h));
            if (scale >= 0.999 && dataUrl.length < 700 * 1024) return resolve(dataUrl);
            var c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(w * scale));
            c.height = Math.max(1, Math.round(h * scale));
            var ctx = c.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, c.width, c.height);
            ctx.drawImage(img, 0, 0, c.width, c.height);
            var out = c.toDataURL('image/jpeg', quality || 0.85);
            resolve(out && out.length < dataUrl.length ? out : dataUrl);
          } catch (e) { resolve(dataUrl); }
        };
        img.onerror = function () { resolve(dataUrl); };
        img.src = dataUrl;
      } catch (e) { resolve(dataUrl || ''); }
    });
  }
  function imageToDataUrl(u) {
    u = String(u || '').trim();
    if (!u) return Promise.resolve('');
    if (/^data:image\//i.test(u)) return Promise.resolve(u);
    // 用户相机 / 本地选图常常是 blob: 临时地址，刷新就失效，先转成 base64。
    if (/^blob:/i.test(u)) {
      if (imageCache[u]) return imageCache[u];
      var bp = fetchImageBlob(u, 8000).then(function (b) {
        return b ? blobToDataUrl(b).then(function (d) { return shrinkDataUrl(d, 1400, 0.85); }) : '';
      }).catch(function () { return ''; });
      imageCache[u] = bp;
      bp.then(function (v) { if (!v) delete imageCache[u]; });
      return bp;
    }
    if (!/^https?:\/\//i.test(u)) return Promise.resolve('');
    if (imageCache[u]) return imageCache[u];
    var attempts = [u];
    var proxyBase = imageProxyBase();
    if (proxyBase) {
      attempts.push(proxyBase + '/img?url=' + encodeURIComponent(u) + '&token=' + encodeURIComponent(imageProxyToken()));
    }
    attempts.push(
      'https://wsrv.nl/?url=' + encodeURIComponent(u) + '&w=1400&output=jpg&q=85',
      'https://images.weserv.nl/?url=' + encodeURIComponent(u) + '&w=1400&output=jpg&q=85'
    );
    var p = (async function () {
      for (var i = 0; i < attempts.length; i++) {
        var blob = await fetchImageBlob(attempts[i], i === 0 ? 8000 : 10000);
        if (blob) {
          var data = await blobToDataUrl(blob);
          if (data) return await shrinkDataUrl(data, 1400, 0.85);
        }
      }
      return '';
    })();
    imageCache[u] = p;
    p.then(function (v) { if (!v) delete imageCache[u]; });
    return p;
  }
  window.NanoImageCache = { toDataUrl: imageToDataUrl, shrinkDataUrl: shrinkDataUrl };

  // 全局 API 日志：设置页「后台日志」读取。异步加载，不阻塞首屏。
  try {
    if (!window.NanoApiLogs) {
      var logScript = document.createElement('script');
      logScript.src = root + 'js/api-logs.js?v=20261023b';
      logScript.async = false;
      (document.head || document.documentElement).appendChild(logScript);
    }
  } catch (e) {}

  function enabled() {
    try {
      var v = localStorage.getItem('nano_top_inset_enabled');
      if (v === '1') return true;
      if (v === '0') return false;
    } catch (e) {}
    try { return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || ''); } catch (e) { return false; }
  }

  function standalone() {
    try {
      if (navigator.standalone === true) return true;
      if (window.matchMedia && (matchMedia('(display-mode: standalone)').matches ||
          matchMedia('(display-mode: fullscreen)').matches ||
          matchMedia('(display-mode: minimal-ui)').matches)) return true;
    } catch (e) {}
    return false;
  }

  function insets() {
    var top = 0, bottom = 0;
    try {
      var probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;visibility:hidden;' +
        'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);';
      document.body.appendChild(probe);
      var cs = getComputedStyle(probe);
      top = parseFloat(cs.paddingTop) || 0;
      bottom = parseFloat(cs.paddingBottom) || 0;
      probe.parentNode.removeChild(probe);
    } catch (e) {}

    var custom = NaN;
    try { custom = parseFloat(localStorage.getItem('nano_top_inset')); } catch (e) {}

    var nativeTop = window.__NANO_NATIVE_TOP_INSET__;
    var nativeBottom = window.__NANO_NATIVE_BOTTOM_INSET__;
    if (isFinite(nativeTop) && nativeTop >= 0) top = nativeTop;
    else if (enabled() && isFinite(custom) && custom >= 0) top = custom;
    else if (top > 0) top = Math.min(top, 54);
    else if (enabled() && standalone() && /iPhone|iPad|iPod/i.test(navigator.userAgent || '')) top = 48;
    else if (enabled() && standalone() && /Android/i.test(navigator.userAgent || '')) top = 40;
    else top = 0;
    if (isFinite(nativeBottom) && nativeBottom >= 0) bottom = nativeBottom;

    return { top: Math.round(top), bottom: Math.round(bottom) };
  }

  function apply() {
    try {
      var v = insets();
      var de = document.documentElement;
      de.style.setProperty('--safe-top', v.top + 'px');
      de.style.setProperty('--safe-t', v.top + 'px');
      de.style.setProperty('--safe-inset-top', v.top + 'px');
      de.style.setProperty('--safe-bottom', v.bottom + 'px');
      de.style.setProperty('--safe-b', v.bottom + 'px');
      de.style.setProperty('--nano-safe-bottom', v.bottom + 'px');
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply, { once: true });
  } else {
    apply();
  }
  window.addEventListener('pageshow', apply);
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  try { if (window.visualViewport) window.visualViewport.addEventListener('resize', apply); } catch (e) {}

  // 通知宿主页面「这一帧已经可以显示」，用来尽早收起「正在打开…」。
  // nano-runtime 是每个子页面最早加载的脚本，不用等其它重脚本全部执行完。
  function notifyFrameReady() {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'nanoFrameReady' }, '*');
      }
    } catch (e) {}
  }
  if (document.readyState === 'complete') notifyFrameReady();
  else {
    document.addEventListener('DOMContentLoaded', notifyFrameReady, { once: true });
    window.addEventListener('load', notifyFrameReady, { once: true });
  }
})();
