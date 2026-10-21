// ============================================================
// group-store.js — 群聊数据（群资料/消息/设置/背景/群列表）持久化到 IndexedDB
// 说明：保留 localStorage 作为同步缓存，所有写入同时镜像到 IndexedDB；
//       页面加载时若 localStorage 缺失（例如被清理过），从 IndexedDB 回填。
// ============================================================
(function () {
    'use strict';

    var DB_NAME = 'nano_groups_db';
    var DB_VERSION = 1;
    var STORE = 'kv';
    var SCOPE_MARK = '__u__';
    var SCOPE_OWNER_KEY = 'nano_group_scope_owner';
    var UID_SESSION_KEY = 'nano_current_mask_id';
    var activeUid = '';

    function isScopedGroupKey(k) {
        return typeof k === 'string' && k.indexOf(SCOPE_MARK) !== -1;
    }

    function isBaseGroupKey(k) {
        if (typeof k !== 'string' || isScopedGroupKey(k)) return false;
        return k.indexOf('group_') === 0 || k === 'nano_groups_data' || k === 'nano_group_settings' || k === 'nano_group_create_count';
    }

    function isGroupKey(k) {
        if (typeof k !== 'string') return false;
        if (isScopedGroupKey(k)) {
            return k.indexOf('group_') === 0 || k.indexOf('nano_groups_data') === 0 || k.indexOf('nano_group_settings') === 0 || k.indexOf('nano_group_create_count') === 0;
        }
        return isBaseGroupKey(k);
    }

    // 从面具数据里取当前 user id；currentMaskId 缺失时退回第一个面具。
    function uidFromMaskData(d) {
        if (!d || !Array.isArray(d.masks) || !d.masks.length) return '';
        if (d.currentMaskId != null && d.currentMaskId !== '') return String(d.currentMaskId);
        var first = d.masks[0];
        return first && first.id != null ? String(first.id) : '';
    }

    // 读当前 user（面具）ID。必须用原生 getItem，避免下面的作用域补丁递归。
    // localStorage 被聊天图片/头像写满时，nano_mask_data 可能只剩在 IndexedDB 里；
    // 此时旧逻辑会退化成 'default'，导致所有面具共用同一份群聊。这里加多层兜底：
    // 页面显式 setCurrentUid → localStorage 面具数据 → 轻量 sessionStorage → IndexedDB 异步补写。
    var rawGetItem = null;
    function currentUid() {
        if (activeUid) return activeUid;
        try {
            var get = rawGetItem || (rawGetItem = localStorage.getItem.bind(localStorage));
            var keys = ['nano_mask_data', 'nano_home_data', 'peach_home_data'];
            for (var i = 0; i < keys.length; i++) {
                var raw = get(keys[i]);
                if (!raw) continue;
                var uid = uidFromMaskData(JSON.parse(raw));
                if (uid) { activeUid = uid; return uid; }
            }
        } catch (e) {}
        try {
            var sid = sessionStorage.getItem(UID_SESSION_KEY);
            if (sid) { activeUid = String(sid); return activeUid; }
        } catch (e) {}
        return 'default';
    }

    function setCurrentUid(uid) {
        uid = (uid == null ? '' : String(uid)).trim();
        if (!uid) return '';
        activeUid = uid;
        try { sessionStorage.setItem(UID_SESSION_KEY, uid); } catch (e) {}
        return uid;
    }

    // 面具数据只存在 IndexedDB 时，异步把 uid 补进缓存，后续群列表/群消息立即按正确 user 读取。
    function hydrateUidFromMaskDB() {
        try {
            var req = indexedDB.open('nano_mask_db', 1);
            req.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains('mask_data')) db.createObjectStore('mask_data', { keyPath: 'key' });
            };
            req.onsuccess = function () {
                var db = req.result;
                try {
                    if (!db.objectStoreNames.contains('mask_data')) { db.close(); return; }
                    var rq = db.transaction('mask_data', 'readonly').objectStore('mask_data').get('data');
                    rq.onsuccess = function () {
                        try {
                            var row = rq.result;
                            var uid = uidFromMaskData(row && row.value);
                            if (uid && !activeUid) {
                                activeUid = uid;
                                try { sessionStorage.setItem(UID_SESSION_KEY, uid); } catch (e) {}
                            }
                        } catch (e) {}
                        try { db.close(); } catch (e) {}
                    };
                    rq.onerror = function () { try { db.close(); } catch (e) {} };
                } catch (e) { try { db.close(); } catch (e2) {} }
            };
            req.onerror = function () {};
        } catch (e) {}
    }

    function scopedKey(k, uid) {
        return String(k) + SCOPE_MARK + encodeURIComponent(uid || currentUid());
    }

    function openDB() {
        return new Promise(function (resolve, reject) {
            try {
                var req = indexedDB.open(DB_NAME, DB_VERSION);
                req.onupgradeneeded = function (e) {
                    var db = e.target.result;
                    if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
                };
                req.onsuccess = function (e) { resolve(e.target.result); };
                req.onerror = function (e) { reject(e.target.error); };
            } catch (e) { reject(e); }
        });
    }

    function idbPut(key, value) {
        return openDB().then(function (db) {
            return new Promise(function (resolve) {
                try {
                    var tx = db.transaction(STORE, 'readwrite');
                    tx.objectStore(STORE).put({ key: key, value: String(value) });
                    tx.oncomplete = function () { db.close(); resolve(); };
                    tx.onerror = function () { db.close(); resolve(); };
                } catch (e) { resolve(); }
            });
        }).catch(function () {});
    }

    function idbDelete(key) {
        return openDB().then(function (db) {
            return new Promise(function (resolve) {
                try {
                    var tx = db.transaction(STORE, 'readwrite');
                    tx.objectStore(STORE).delete(key);
                    tx.oncomplete = function () { db.close(); resolve(); };
                    tx.onerror = function () { db.close(); resolve(); };
                } catch (e) { resolve(); }
            });
        }).catch(function () {});
    }

    var patched = false;
    var rawSetItem = null;
    var rawRemoveItem = null;

    function claimScopeOwner(uid) {
        try {
            var owner = rawGetItem(SCOPE_OWNER_KEY);
            if (!owner) {
                rawSetItem(SCOPE_OWNER_KEY, uid);
                return uid;
            }
            return String(owner);
        } catch (e) { return uid; }
    }

    // 作用域读取：优先当前 user 的副本；旧版共享数据只在「第一个认领的 user」可见，
    // 认领后立即迁移到该 user 的命名空间并删除旧键，后续 user 不会串数据。
    function readScopedGroupValue(k) {
        var uid = currentUid();
        var sk = scopedKey(k, uid);
        try {
            var own = rawGetItem(sk);
            if (own !== null) return own;
        } catch (e) {}
        var legacy = null;
        try { legacy = rawGetItem(k); } catch (e) {}
        if (legacy === null) return null;
        // 面具数据可能还在 IndexedDB 里没同步到 localStorage：先不要认领旧数据，
        // 否则会把所有权记到 default，真正 user 加载后就看不到自己的群了。
        if (uid === 'default') return legacy;
        var owner = claimScopeOwner(uid);
        if (owner !== uid) return null;
        try { rawSetItem(sk, legacy); } catch (e) {}
        try { rawRemoveItem(k); } catch (e) {}
        idbPut(sk, legacy);
        idbDelete(k);
        return legacy;
    }

    function patchStorage() {
        if (patched) return;
        patched = true;
        try {
            var origGet = localStorage.getItem.bind(localStorage);
            var origSet = localStorage.setItem.bind(localStorage);
            var origRemove = localStorage.removeItem.bind(localStorage);
            rawGetItem = origGet;
            rawSetItem = origSet;
            rawRemoveItem = origRemove;
            localStorage.getItem = function (k) {
                if (isBaseGroupKey(k)) return readScopedGroupValue(k);
                return origGet(k);
            };
            localStorage.setItem = function (k, v) {
                if (isBaseGroupKey(k)) {
                    var uid = currentUid();
                    k = scopedKey(k, uid);
                    claimScopeOwner(uid);
                    idbPut(k, v);
                } else if (isScopedGroupKey(k) && isGroupKey(k)) {
                    idbPut(k, v);
                }
                try { origSet(k, v); } catch (e) {}
            };
            localStorage.removeItem = function (k) {
                if (isBaseGroupKey(k)) {
                    var uid = currentUid();
                    var sk = scopedKey(k, uid);
                    if (claimScopeOwner(uid) === uid) {
                        idbDelete(sk);
                        try { origRemove(k); } catch (e) {}
                    }
                    try { origRemove(sk); } catch (e) {}
                    return;
                }
                if (isScopedGroupKey(k) && isGroupKey(k)) idbDelete(k);
                try { origRemove(k); } catch (e) {}
            };
        } catch (e) {}
    }

    var readyPromise = null;
    function ready() {
        if (readyPromise) return readyPromise;
        readyPromise = openDB().then(function (db) {
            return new Promise(function (resolve) {
                try {
                    var tx = db.transaction(STORE, 'readonly');
                    var req = tx.objectStore(STORE).getAll();
                    req.onsuccess = function () { resolve(req.result || []); };
                    req.onerror = function () { resolve([]); };
                } catch (e) { resolve([]); }
            }).then(function (rows) {
                try { db.close(); } catch (e) {}
                rows.forEach(function (row) {
                    try {
                        if (!row || row.key == null) return;
                        var k = String(row.key);
                        var uid = currentUid();
                        // 旧版共享行：只有 scope owner 能恢复；否则跳过，避免串到别的 user。
                        if (isBaseGroupKey(k) && !isScopedGroupKey(k)) {
                            if (uid === 'default') {
                                if (rawGetItem(k) === null) rawSetItem(k, row.value);
                                return;
                            }
                            var owner = claimScopeOwner(uid);
                            if (owner !== uid) return;
                            if (rawGetItem(k) !== null) return;
                            if (rawGetItem(scopedKey(k, uid)) !== null) return;
                        }
                        // 别的 user 命名空间的群数据不要写进当前页面的 localStorage
                        if (isScopedGroupKey(k)) {
                            var tail = k.slice(k.indexOf(SCOPE_MARK) + SCOPE_MARK.length);
                            var rowUid = tail;
                            try { rowUid = decodeURIComponent(tail); } catch (e2) { rowUid = tail; }
                            if (String(rowUid) !== String(uid)) return;
                        }
                        if (rawGetItem(k) === null) {
                            if (rawSetItem) rawSetItem(k, row.value);
                            else localStorage.setItem(k, row.value);
                        }
                    } catch (e) {}
                });
            });
        }).catch(function () {});
        return readyPromise;
    }

    // 立即启动一次回填并挂上写入镜像（不阻塞页面脚本）
    try { ready(); patchStorage(); hydrateUidFromMaskDB(); } catch (e) {}

    // 其它页面切换面具时，失效缓存并重新从面具数据取 uid
    try {
        window.addEventListener('storage', function (e) {
            if (!e || !e.key) return;
            if (e.key === 'nano_mask_data' || e.key === 'nano_home_data' || e.key === 'peach_home_data') {
                activeUid = '';
                try {
                    var d = JSON.parse(e.newValue || 'null');
                    var uid = uidFromMaskData(d);
                    if (uid) activeUid = uid;
                } catch (err) {}
            }
        });
    } catch (e) {}

    // 群成员按创建者 user 记录；旧群没有 ownerUid 时不做过滤，保持兼容。
    function groupBelongsToCurrentUser(g) {
        if (!g || typeof g !== 'object') return false;
        if (!g.ownerUid) return true;
        return String(g.ownerUid) === String(currentUid());
    }

    window.GroupStore = {
        ready: ready,
        isGroupKey: isGroupKey,
        currentUid: currentUid,
        setCurrentUid: setCurrentUid,
        groupBelongsToCurrentUser: groupBelongsToCurrentUser,
        scopeKey: function (k) { return isBaseGroupKey(k) ? scopedKey(k, currentUid()) : k; },
        set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
        remove: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
    };

    // ===== 群邀请（群聊 ⇄ 私聊互通的邀请卡片数据） =====
    var INVITE_KEY = 'group_invites';
    function readInvites() {
        try {
            var raw = localStorage.getItem(INVITE_KEY);
            var arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch (e) { return []; }
    }
    function writeInvites(arr) {
        try { localStorage.setItem(INVITE_KEY, JSON.stringify((arr || []).slice(-200))); } catch (e) {}
    }
    window.GroupInvites = {
        list: readInvites,
        add: function (data) {
            var arr = readInvites();
            var inv = Object.assign({
                id: 'inv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                status: 'pending',
                createdAt: Date.now()
            }, data || {});
            arr.push(inv);
            writeInvites(arr);
            return inv;
        },
        find: function (id) { return readInvites().find(function (x) { return x && x.id === id; }) || null; },
        findPendingFor: function (charId) {
            return readInvites().find(function (x) {
                return x && x.status === 'pending' && x.direction === 'user' && x.toCharId === charId;
            }) || null;
        },
        update: function (id, patch) {
            var arr = readInvites();
            var hit = false;
            arr.forEach(function (x) { if (x && x.id === id) { Object.assign(x, patch || {}); hit = true; } });
            if (hit) writeInvites(arr);
            return hit;
        },
        remove: function (id) { writeInvites(readInvites().filter(function (x) { return x && x.id !== id; })); }
    };
})();
