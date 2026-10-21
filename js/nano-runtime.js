(function () {
  'use strict';

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

  // 全局 API 日志：设置页「后台日志」读取。异步加载，不阻塞首屏。
  try {
    if (!window.NanoApiLogs) {
      var logScript = document.createElement('script');
      logScript.src = root + 'js/api-logs.js?v=20261021a';
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
})();
