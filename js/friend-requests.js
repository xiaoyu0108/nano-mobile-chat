/* friend-requests.js — 好友申请中心（Meet）
   存于 localStorage: nano_friend_requests（数组），每条按 owner(=当前 user/人设 id) 归属，绝不串 user。
   accept() 会在 nano_characters_db 里创建一个 bindUser=owner 的角色，从而进入该 user 的好友区/角色库。
   ins / halo 的陌生人在你告知微信号后会自动发来申请；小号试探 / 群 NPC 的申请也汇总到这里。 */
(function () {
    'use strict';
    var KEY = 'nano_friend_requests';

    function ownerNs() {
        try {
            var d = JSON.parse(localStorage.getItem('nano_mask_data') || localStorage.getItem('nano_home_data') || 'null');
            if (d && d.currentMaskId != null && d.currentMaskId !== '') return String(d.currentMaskId);
            if (d && Array.isArray(d.masks) && d.masks.length) return String(d.masks[0].id);
        } catch (e) {}
        return 'default';
    }
    function readAll() {
        try { return JSON.parse(localStorage.getItem(KEY) || '[]') || []; } catch (e) { return []; }
    }
    function writeAll(a) {
        try { localStorage.setItem(KEY, JSON.stringify((a || []).slice(-400))); } catch (e) {}
        try { window.dispatchEvent(new CustomEvent('nanoFriendRequestsChanged')); } catch (e) {}
    }
    function uid() { return 'fr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6); }

    function add(req) {
        req = req || {};
        var all = readAll();
        var owner = String(req.owner || ownerNs());
        // 去重：同 owner + 同名/同来源 且仍是 pending 时只保留一条
        var dup = all.find(function (r) {
            return r && r.status === 'pending' && String(r.owner) === owner && r.source === (req.source || 'other') &&
                ((req.originId && r.originId === req.originId) || (r.name && r.name === req.name));
        });
        if (dup) return dup;
        var rec = {
            id: uid(), owner: owner,
            name: String(req.name || '陌生人').slice(0, 24),
            avatar: req.avatar || '',
            source: req.source || 'other',      // alt | groupnpc | ins | halo | other
            app: req.app || '',
            setting: String(req.setting || '').slice(0, 4000),
            originId: req.originId || '',
            altOriginId: req.altOriginId || '',
            requestNote: String(req.requestNote || '').slice(0, 200),
            ts: Date.now(), status: 'pending'
        };
        all.push(rec); writeAll(all);
        try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'homeDataUpdated' }, '*'); } catch (e) {}
        return rec;
    }

    function list(owner) {
        owner = String(owner || ownerNs());
        return readAll().filter(function (r) {
            return r && r.status === 'pending' && String(r.owner) === owner;
        }).sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    }
    function pendingCount(owner) { return list(owner).length; }

    function setStatus(id, status) {
        var all = readAll(), r = all.find(function (x) { return x && x.id === id; });
        if (r) { r.status = status; r.at = Date.now(); writeAll(all); }
        return r;
    }
    function reject(id) { return setStatus(id, 'rejected'); }

    function putCharacter(rec) {
        return new Promise(function (resolve) {
            try {
                var req = indexedDB.open('nano_characters_db', 1);
                req.onupgradeneeded = function (e) {
                    try { var d = e.target.result; if (!d.objectStoreNames.contains('characters')) d.createObjectStore('characters', { keyPath: 'id' }); } catch (err) {}
                };
                req.onsuccess = function () {
                    try {
                        var db = req.result;
                        var charRec = {
                            id: 'fr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
                            name: rec.name, avatar: rec.avatar || '', gender: '未知', nationality: '未知',
                            setting: rec.setting || '', isNpc: true, bindUser: String(rec.owner || ownerNs())
                        };
                        // 小号试探：标明是小号并记录大号 id，方便记忆库互通
                        if (rec.source === 'alt') {
                            charRec.isAltProbe = true;
                            charRec.altOriginId = rec.altOriginId || '';
                        }
                        var tx = db.transaction('characters', 'readwrite');
                        tx.objectStore('characters').put(charRec);
                        tx.oncomplete = function () { db.close(); resolve(charRec); };
                        tx.onerror = function () { db.close(); resolve(null); };
                    } catch (e) { resolve(null); }
                };
                req.onerror = function () { resolve(null); };
            } catch (e) { resolve(null); }
        });
    }

    function accept(id) {
        var all = readAll(), r = all.find(function (x) { return x && x.id === id; });
        if (!r) return Promise.resolve(null);
        return putCharacter(r).then(function (charRec) {
            r.status = 'accepted';
            r.charId = charRec && charRec.id;
            r.at = Date.now();
            writeAll(all);
            try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'homeDataUpdated' }, '*'); } catch (e) {}
            try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'NANO_FRIEND_ADDED', chatId: r.charId, name: r.name }, '*'); } catch (e) {}
            return charRec;
        });
    }

    // 微信号直接取自当前 user 的「面具(Mask)」——每个 user 在 mask 里单独设置
    function wechat(owner) {
        try {
            var d = JSON.parse(localStorage.getItem('nano_mask_data') || localStorage.getItem('nano_home_data') || 'null');
            var id = String(owner || ownerNs());
            if (d && Array.isArray(d.masks)) {
                var m = d.masks.find(function (x) { return x && String(x.id) === id; });
                if (m && m.wechat && m.wechat !== '未设置') return String(m.wechat);
            }
        } catch (e) {}
        return '';
    }
    function setWechat() { /* 微信号在 Mask 页设置，这里不再单独存 */ }

    window.NanoFriend = {
        ownerNs: ownerNs, add: add, list: list, pendingCount: pendingCount,
        accept: accept, reject: reject, setStatus: setStatus,
        wechat: wechat, setWechat: setWechat, readAll: readAll
    };
})();
