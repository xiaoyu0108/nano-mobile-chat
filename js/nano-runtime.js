(function () {
  'use strict';

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
    var versionMap = null;
    var versionPromise = null;

    function loadVersions() {
      if (versionPromise) return versionPromise;
      versionPromise = new Promise(function (resolve) {
        if (!indexedDB.databases) { resolve(null); return; }
        try {
          indexedDB.databases().then(function (list) {
            var map = {};
            (list || []).forEach(function (d) { if (d && d.name) map[d.name] = d.version; });
            versionMap = map;
            resolve(map);
          }).catch(function () { resolve(null); });
        } catch (e) { resolve(null); }
      });
      return versionPromise;
    }

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

      loadVersions().then(function (map) {
        var existing = map && map[name];
        realOpen(existing && Number(existing) > Number(version) ? null : version);
      });

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
  function imageToDataUrl(u) {
    u = String(u || '').trim();
    if (!u) return Promise.resolve('');
    if (/^data:image\//i.test(u)) return Promise.resolve(u);
    if (!/^https?:\/\//i.test(u)) return Promise.resolve('');
    if (imageCache[u]) return imageCache[u];
    var attempts = [
      u,
      'https://wsrv.nl/?url=' + encodeURIComponent(u) + '&w=1400&output=jpg&q=85',
      'https://images.weserv.nl/?url=' + encodeURIComponent(u) + '&w=1400&output=jpg&q=85'
    ];
    var p = (async function () {
      for (var i = 0; i < attempts.length; i++) {
        var blob = await fetchImageBlob(attempts[i], i === 0 ? 8000 : 10000);
        if (blob) {
          var data = await blobToDataUrl(blob);
          if (data) return data;
        }
      }
      return '';
    })();
    imageCache[u] = p;
    p.then(function (v) { if (!v) delete imageCache[u]; });
    return p;
  }
  window.NanoImageCache = { toDataUrl: imageToDataUrl };

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

    if (enabled() && isFinite(custom) && custom >= 0) top = custom;
    else if (top > 0) top = Math.min(top, 54);
    else if (enabled() && standalone() && /iPhone|iPad|iPod/i.test(navigator.userAgent || '')) top = 48;
    else if (enabled() && standalone() && /Android/i.test(navigator.userAgent || '')) top = 40;
    else top = 0;

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
