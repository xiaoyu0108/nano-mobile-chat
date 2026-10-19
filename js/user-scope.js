/* ============================================================
   user-scope.js — 当前 user（面具）与角色隔离
   所有列出 char 的 App 都应只展示当前 user 可用的角色：
   未绑定 user 的角色 + 绑定到当前 user 的角色；绝不展示绑定其他 user 的角色。
   ============================================================ */
(function () {
  'use strict';
  if (window.NanoUserScope) return;

  function readHome() {
    var keys = ['nano_mask_data', 'nano_home_data', 'peach_home_data'];
    for (var i = 0; i < keys.length; i++) {
      try {
        var raw = localStorage.getItem(keys[i]);
        if (!raw) continue;
        var d = JSON.parse(raw);
        if (d && Array.isArray(d.masks) && d.masks.length) return d;
      } catch (e) {}
    }
    return null;
  }

  function currentUser() {
    var d = readHome();
    if (!d) return null;
    var list = Array.isArray(d.masks) ? d.masks : [];
    return list.find(function (m) { return m && String(m.id) === String(d.currentMaskId); }) || list[0] || null;
  }

  function currentUserId() {
    var u = currentUser();
    return u && u.id != null ? String(u.id) : '';
  }

  function currentUserName() {
    var u = currentUser();
    return u && u.name ? String(u.name) : '我';
  }

  function openCharDB() {
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.open('nano_characters_db', 1);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains('characters')) db.createObjectStore('characters', { keyPath: 'id' });
        };
        req.onsuccess = function () {
          var db = req.result;
          try {
            var tx = db.transaction('characters', 'readonly');
            var rq = tx.objectStore('characters').getAll();
            rq.onsuccess = function () { resolve(rq.result || []); db.close(); };
            rq.onerror = function () { resolve([]); db.close(); };
          } catch (e) { resolve([]); try { db.close(); } catch (err) {} }
        };
        req.onerror = function () { resolve([]); };
      } catch (e) { resolve([]); }
    });
  }

  function filterForCurrentUser(list) {
    var uid = currentUserId();
    var arr = Array.isArray(list) ? list : [];
    return arr.filter(function (c) {
      if (!c || !c.id || !c.name || c.nanoAssistant) return false;
      if (!uid) return true;
      return !c.bindUser || String(c.bindUser) === uid;
    });
  }

  async function loadChars() {
    return filterForCurrentUser(await openCharDB());
  }

  window.NanoUserScope = {
    currentUser: currentUser,
    currentUserId: currentUserId,
    currentUserName: currentUserName,
    loadChars: loadChars,
    filterForCurrentUser: filterForCurrentUser
  };
})();
