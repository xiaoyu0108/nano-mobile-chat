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

    // 读当前 user（面具）ID。必须用原生 getItem，避免下面的作用域补丁递归。
    var rawGetItem = null;
    function currentUid() {
        try {
            var get = rawGetItem || (rawGetItem = localStorage.getItem.bind(localStorage));
            var raw = get('nano_mask_data') || get('nano_home_data') || get('peach_home_data');
            if (raw) {
                var d = JSON.parse(raw);
                if (d && d.currentMaskId != null && d.currentMaskId !== '') return String(d.currentMaskId);
            }
        } catch (e) {}
        return 'default';
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
    try { ready(); patchStorage(); } catch (e) {}

    window.GroupStore = {
        ready: ready,
        isGroupKey: isGroupKey,
        currentUid: currentUid,
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
