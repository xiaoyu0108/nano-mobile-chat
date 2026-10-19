(function () {
  'use strict';

  var DB_NAME = 'nano_app_storage';
  var DB_VERSION = 1;
  var STORE = 'kv';
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      try {
        var req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        req.onsuccess = function (e) { resolve(e.target.result); };
        req.onerror = function () { reject(req.error || new Error('indexedDB open failed')); };
      } catch (e) { reject(e); }
    }).catch(function (e) { dbPromise = null; throw e; });
    return dbPromise;
  }

  function request(mode, makeRequest) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode);
        var req;
        try { req = makeRequest(tx.objectStore(STORE)); } catch (e) { reject(e); return; }
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
        tx.onabort = function () { reject(tx.error); };
      });
    });
  }

  function get(key) {
    return request('readonly', function (store) { return store.get(key); })
      .then(function (v) { return v === undefined ? null : v; })
      .catch(function () { return null; });
  }

  function set(key, value) {
    return request('readwrite', function (store) { return store.put(value, key); })
      .then(function () { return true; })
      .catch(function () { return false; });
  }

  function del(key) {
    return request('readwrite', function (store) { return store.delete(key); })
      .then(function () { return true; })
      .catch(function () { return false; });
  }

  function keys() {
    return request('readonly', function (store) { return store.getAllKeys(); })
      .then(function (v) { return v || []; })
      .catch(function () { return []; });
  }

  window.NanoIDB = { get: get, set: set, del: del, keys: keys, open: open };
})();
