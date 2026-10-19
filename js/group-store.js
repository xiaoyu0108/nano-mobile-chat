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

    function isGroupKey(k) {
        return typeof k === 'string' && (
            k.indexOf('group_') === 0 ||
            k === 'nano_groups_data' ||
            k === 'nano_group_settings'
        );
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
    function patchStorage() {
        if (patched) return;
        patched = true;
        try {
            var origSet = localStorage.setItem.bind(localStorage);
            var origRemove = localStorage.removeItem.bind(localStorage);
            rawSetItem = origSet;
            localStorage.setItem = function (k, v) {
                if (isGroupKey(k)) idbPut(k, v);
                try { origSet(k, v); } catch (e) {}
            };
            localStorage.removeItem = function (k) {
                if (isGroupKey(k)) idbDelete(k);
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
                        if (row && row.key != null && localStorage.getItem(row.key) === null) {
                            if (rawSetItem) rawSetItem(row.key, row.value);
                            else localStorage.setItem(row.key, row.value);
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
