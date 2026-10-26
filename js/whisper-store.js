/* 悄悄话卡片持久化：IndexedDB 为主，localStorage 只做同步缓存。 */
(function () {
  'use strict';
  var DB_NAME = 'nano_whisper_db';
  var STORE = 'records';
  var _db = null;
  function open() {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    if (_db) return Promise.resolve(_db);
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        };
        req.onsuccess = function () { _db = req.result; resolve(_db); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }
  function putAll(list) {
    return open().then(function (db) {
      if (!db) return false;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(STORE, 'readwrite');
          var st = tx.objectStore(STORE);
          (list || []).forEach(function (r) { if (r && r.id) st.put(r); });
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { resolve(false); };
        } catch (e) { resolve(false); }
      });
    }).catch(function () { return false; });
  }
  function getAll() {
    return open().then(function (db) {
      if (!db) return [];
      return new Promise(function (resolve) {
        try {
          var req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
          req.onsuccess = function () { resolve(Array.isArray(req.result) ? req.result : []); };
          req.onerror = function () { resolve([]); };
        } catch (e) { resolve([]); }
      });
    }).catch(function () { return []; });
  }
  function del(id) {
    return open().then(function (db) {
      if (!db) return false;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).delete(String(id));
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { resolve(false); };
        } catch (e) { resolve(false); }
      });
    }).catch(function () { return false; });
  }
  function clear() {
    return open().then(function (db) {
      if (!db) return false;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).clear();
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { resolve(false); };
        } catch (e) { resolve(false); }
      });
    }).catch(function () { return false; });
  }
  window.NanoWhisperStore = { putAll: putAll, getAll: getAll, del: del, clear: clear };
})();
