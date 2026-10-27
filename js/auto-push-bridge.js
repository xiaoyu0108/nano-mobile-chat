/* ============================================================
   auto-push-bridge.js — 无后台主动消息 / 朋友圈的客户端合并
   Worker 到点生成内容并推送；这里在 App 回到前台时拉取 pending：
   · 消息 → 暂存到 localStorage，进入对应聊天时补发；当前聊天直接插入
   · 朋友圈 → 写入 NanoMomentsDB + localStorage，并刷新朋友圈页
   ============================================================ */
(function () {
    'use strict';

    var PENDING_MSGS = 'nano_auto_pending_msgs';
    var UNREAD_KEY = 'nano_unread_counts';
    var ACT_KEY = 'nano_chat_activity';
    var lastPull = 0;
    var busy = false;

    function readJSON(key, fallback) {
        try {
            var raw = localStorage.getItem(key);
            var v = raw ? JSON.parse(raw) : fallback;
            return v == null ? fallback : v;
        } catch (e) { return fallback; }
    }
    function writeJSON(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
    }
    function enc(s) { return encodeURIComponent(String(s == null ? '' : s)); }
    // 与 nano-push.js / sw.js 完全一致的站点身份，用于隔离不同部署的 pending。
    function appId() {
        var s = '';
        try {
            var root = window.NANO_ROOT || new URL('./', location.href).href;
            var u = new URL(root, location.href);
            s = u.origin + u.pathname.replace(/\/+$/, '');
        } catch (e) { s = String(location.origin || '') + String(location.pathname || ''); }
        var h = 2166136261;
        for (var i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
        }
        return 'app_' + h.toString(36);
    }
    // 与 chat-core 使用同一个稳定 userId：没有面具时也绝不退化成空字符串，
    // 否则服务端按 default 存 pending，客户端却永远拉不到（点开通知没有内容）。
    function autoUserId() {
        try {
            var home = readJSON('nano_mask_data', null);
            if (home && home.currentMaskId) return String(home.currentMaskId);
            if (home && Array.isArray(home.masks) && home.masks[0] && home.masks[0].id) return String(home.masks[0].id);
        } catch (e) {}
        var stable = '';
        try { stable = localStorage.getItem('nano_auto_user_id') || ''; } catch (e) {}
        if (!stable) {
            stable = 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            try { localStorage.setItem('nano_auto_user_id', stable); } catch (e) {}
        }
        return stable || 'default';
    }

    function baseUrl() {
        var b = '';
        try { b = (localStorage.getItem('nano_push_endpoint') || localStorage.getItem('nano_peek_url') || '').trim(); } catch (e) {}
        if (!b) b = 'https://nanopush.nano315.online';
        return b.replace(/\/+$/, '');
    }
    function peekToken() {
        try { return localStorage.getItem('nano_peek_token') || ''; } catch (e) { return ''; }
    }
    function pushToken() {
        try { return localStorage.getItem('nano_push_token') || ''; } catch (e) { return ''; }
    }
    function token() { return peekToken() || pushToken(); }
    function currentUserId() { return autoUserId(); }
    function autoDeviceId() {
        var id = '';
        try { id = localStorage.getItem('nano_device_id') || ''; } catch (e) {}
        if (!id) {
            id = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
            try { localStorage.setItem('nano_device_id', id); } catch (e) {}
        }
        return id || 'default';
    }
    // 朋友圈按「当前面具」隔离；没有面具时 moments.js 统一用 default
    function currentMaskId() {
        try {
            var home = readJSON('nano_mask_data', null);
            if (home && home.currentMaskId) return String(home.currentMaskId);
            if (home && Array.isArray(home.masks) && home.masks[0] && home.masks[0].id) return String(home.masks[0].id);
        } catch (e) {}
        return 'default';
    }
    function currentOpenChat() {
        try {
            var f = document.getElementById('chatInnerFrame');
            var src = f ? (f.getAttribute('data-loaded-url') || f.getAttribute('src') || '') : '';
            if (!src || src.indexOf('chat_inner.html') < 0) return '';
            return new URL(src, location.href).searchParams.get('chat') || '';
        } catch (e) { return ''; }
    }
    function chatReadyFor(chatId) {
        try {
            if (document.hidden) return false;
            var f = document.getElementById('chatInnerFrame');
            if (!f || !f.contentWindow) return false;
            // 聊天帧可能只是被隐藏（用户已经回到聊天列表），这时不能再当成“正在看”，
            // 否则消息会静默插进隐藏的聊天里，聊天列表也没有未读红点。
            if (f.style && f.style.display === 'none') return false;
            try {
                var cs = window.getComputedStyle(f);
                if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
            } catch (e) {}
            if (f.getClientRects && f.getClientRects().length === 0) return false;
            var loaded = String(f.getAttribute('data-loaded-url') || f.getAttribute('src') || '');
            if (chatId && loaded && loaded.indexOf('chat=' + encodeURIComponent(chatId)) < 0 && loaded.indexOf('chat=' + chatId) < 0) return false;
            if (!f.contentWindow.__nanoChatReady) return false;
            return String(f.contentWindow.__nanoChatReadyChat || '') === String(chatId || '');
        } catch (e) { return false; }
    }
    function splitBubbles(list) {
        var arr = (list || []).map(function (s) { return String(s || '').trim(); }).filter(Boolean);
        var out = [];
        arr.forEach(function (s) {
            var sep = s.indexOf('||');
            if (sep > -1) {
                // 外文：原文和译文分别按句拆开，再一一配对，保证每条气泡都带自己的翻译
                var orig = s.slice(0, sep).trim();
                var trans = s.slice(sep + 2).trim();
                var os = orig.split(/(?<=[。！？!?…\.])\s*/).map(function (x) { return x.trim(); }).filter(Boolean);
                var ts = trans.split(/(?<=[。！？!?…\.])\s*/).map(function (x) { return x.trim(); }).filter(Boolean);
                if (os.length > 1) {
                    os.forEach(function (x, i) { out.push(x + '||' + (ts[i] || trans)); });
                    return;
                }
            }
            if (s.indexOf('||') < 0 && s.length > 16) {
                var parts = s.split(/(?<=[。！？!?…])/).map(function (x) { return x.trim(); }).filter(Boolean);
                if (parts.length > 1) { out = out.concat(parts); return; }
            }
            out.push(s);
        });
        return out.slice(0, 3);
    }
    function deliverLive(chatId, m, bubbles) {
        try {
            var f = document.getElementById('chatInnerFrame');
            var w = f && f.contentWindow;
            if (!w) return false;
            bubbles.forEach(function (t, i) {
                var id = i === 0 ? String(m.id) : (String(m.id) + '_' + i);
                w.postMessage({
                    type: 'NANO_CHAR_SAY',
                    chatId: String(chatId),
                    text: String(t),
                    id: id,
                    heart: i === 0 ? (m.heart || null) : null,
                    think: i === 0 ? String(m.think || '') : ''
                }, '*');
            });
            return true;
        } catch (e) { return false; }
    }
    function bumpUnread(chatId) {
        if (!chatId) return;
        var a = readJSON(ACT_KEY, {});
        a[chatId] = Date.now();
        writeJSON(ACT_KEY, a);
        var u = readJSON(UNREAD_KEY, {});
        u[chatId] = (parseInt(u[chatId] || 0, 10) || 0) + 1;
        writeJSON(UNREAD_KEY, u);
        // 让聊天列表/通知栏立刻刷新，不用等重新打开页面。
        try { window.postMessage({ type: 'nanoUnreadUpdated', chatId: String(chatId) }, '*'); } catch (e) {}
    }
    function markRead(chatId) {
        if (!chatId) return;
        var u = readJSON(UNREAD_KEY, {});
        if (u[chatId]) { delete u[chatId]; writeJSON(UNREAD_KEY, u); }
    }
    // 只接收本设备实际存在的角色；已被删除/不属于当前设备的长按消息直接丢弃并 ack
    function existingCharIds() {
        return new Promise(function (resolve) {
            try {
                var req = indexedDB.open('nano_characters_db', 1);
                req.onupgradeneeded = function (e) {
                    var db = e.target.result;
                    if (!db.objectStoreNames.contains('characters')) db.createObjectStore('characters', { keyPath: 'id' });
                };
                req.onsuccess = function () {
                    try {
                        var db = req.result;
                        if (!db.objectStoreNames.contains('characters')) { try { db.close(); } catch (e) {} resolve(null); return; }
                        var rq = db.transaction('characters', 'readonly').objectStore('characters').getAll();
                        rq.onsuccess = function () {
                            var ids = {}, mask = currentMaskId();
                            (rq.result || []).forEach(function (c) {
                                if (!c || !c.id) return;
                                if (mask !== 'default' && c.bindUser && String(c.bindUser) !== String(mask)) return;
                                ids[String(c.id)] = 1;
                            });
                            try { db.close(); } catch (e) {}
                            resolve(ids);
                        };
                        rq.onerror = function () { try { db.close(); } catch (e) {} resolve(null); };
                    } catch (e) { resolve(null); }
                };
                req.onerror = function () { resolve(null); };
            } catch (e) { resolve(null); }
        });
    }

    function putMoment(post) {
        return new Promise(function (resolve) {
            if (!post || !post.id) { resolve(false); return; }
            // 服务端可能用 default / 旧面具 id 生成，这里强制改成当前面具，
            // 否则 moments.js 的 normalizeMaskScoped 会把它过滤掉（通知有、朋友圈没有）。
            post.maskId = currentMaskId();
            var localOk = false;
            // 先写 localStorage 兜底
            try {
                var arr = readJSON('nano_moments_data', []);
                if (!Array.isArray(arr)) arr = [];
                if (!arr.some(function (x) { return x && x.id === post.id; })) arr.unshift(post);
                localOk = writeJSON('nano_moments_data', arr.slice(0, 500));
            } catch (e) {}
            try {
                var req = indexedDB.open('NanoMomentsDB', 1);
                req.onupgradeneeded = function (e) {
                    var d = e.target.result;
                    if (!d.objectStoreNames.contains('moments')) d.createObjectStore('moments', { keyPath: 'id' });
                };
                req.onsuccess = function () {
                    try {
                        var d = req.result;
                        var tx = d.transaction('moments', 'readwrite');
                        tx.objectStore('moments').put(post);
                        tx.oncomplete = function () { try { d.close(); } catch (e) {} resolve(true); };
                        tx.onerror = function () { try { d.close(); } catch (e) {} resolve(localOk); };
                    } catch (e) { resolve(localOk); }
                };
                req.onerror = function () { resolve(localOk); };
            } catch (e) { resolve(localOk); }
        });
    }

    async function pull(force) {
        if (busy) return;
        var uid = currentUserId();
        if (!uid) return;
        if (!force && Date.now() - lastPull < 60000) return;
        busy = true;
        lastPull = Date.now();
        var messages = [], moments = [];
        try {
            var url = baseUrl() + '/auto/pending?userId=' + enc(uid) + '&deviceId=' + enc(autoDeviceId()) + '&appId=' + enc(appId()) + '&token=' + enc(token());
            var resp = await fetch(url, {
                cache: 'no-store',
                headers: { 'X-Push-Token': pushToken(), 'X-Peek-Token': peekToken() }
            });
            if (!resp.ok) return;
            var data = await resp.json().catch(function () { return {}; });
            messages = Array.isArray(data.messages) ? data.messages : [];
            moments = Array.isArray(data.moments) ? data.moments : [];
        } catch (e) { return; }
        finally { busy = false; }

        var charIds = await existingCharIds();
        // 只有「真正写进本地 / 真正插进当前聊天」的条目才 ack。
        // 之前无条件 ack 全部，任何一步失败都会出现「通知有、点进去没有」的假消息。
        var handledMsgIds = [], handledMomentIds = [], liveIds = [];

        // ===== 主动消息 =====
        if (messages.length) {
            var store = readJSON(PENDING_MSGS, {});
            if (!store || typeof store !== 'object') store = {};
            var openChat = currentOpenChat();
            var canLive = !!(openChat && window.__nanoShell && window.__nanoShell.postToChat && chatReadyFor(openChat));
            messages.forEach(function (m) {
                if (!m || !m.id || !m.chatId) { if (m && m.id) handledMsgIds.push(m.id); return; }
                if (charIds && !charIds[String(m.chatId)]) { handledMsgIds.push(m.id); return; }
                var bubbles = Array.isArray(m.bubbles) ? m.bubbles.slice() : [];
                if (!bubbles.length && m.text) bubbles = [m.text];
                bubbles = splitBubbles(bubbles);
                if (!bubbles.length) { handledMsgIds.push(m.id); return; }   // 空内容直接丢弃，避免反复推
                try {
                    if (m.avatar && window.__nanoUpdateNotifyAvatar) {
                        window.__nanoUpdateNotifyAvatar('chat:' + String(m.chatId), m.avatar);
                    }
                } catch (e) {}
                if (canLive && String(openChat) === String(m.chatId)) {
                    if (deliverLive(String(m.chatId), m, bubbles)) {
                        markRead(String(m.chatId));
                        handledMsgIds.push(m.id);
                        liveIds.push(m.id);
                        return;
                    }
                }
                var list = Array.isArray(store[m.chatId]) ? store[m.chatId] : [];
                if (!list.some(function (x) { return x && x.id === m.id; })) {
                    list.push({
                        id: m.id, name: m.name || '', bubbles: bubbles,
                        heart: m.heart || null, think: String(m.think || ''),
                        ts: m.ts || Date.now()
                    });
                    store[m.chatId] = list;
                    bumpUnread(String(m.chatId));
                    // App 还开着但不在这个私聊时，也弹一次内置/系统通知；
                    // 这样即使 Web Push 被系统限制，也不会完全不知道 TA 发了消息。
                    try {
                        if (window.NanoNotify && NanoNotify.notify) {
                            NanoNotify.notify(m.name || 'TA', bubbles[0] || '你有一条新消息', {
                                channel: 'chat', target: 'chat:' + String(m.chatId),
                                avatar: m.avatar || '', name: m.name || 'TA', force: true
                            });
                        }
                    } catch (e) {}
                }
                handledMsgIds.push(m.id);
            });
            if (!writeJSON(PENDING_MSGS, store)) {
                // localStorage 写失败：只保留已经真正插进聊天的条目
                handledMsgIds = handledMsgIds.filter(function (id) { return liveIds.indexOf(id) >= 0; });
            }
        }

        // ===== 朋友圈 =====
        if (moments.length) {
            for (var i = 0; i < moments.length; i++) {
                var ok = await putMoment(moments[i]);
                if (ok) handledMomentIds.push(moments[i].id);
            }
            try {
                if (moments[0] && moments[0].avatar && window.__nanoUpdateNotifyAvatar) {
                    window.__nanoUpdateNotifyAvatar('moments', moments[0].avatar);
                }
            } catch (e) {}
            if (handledMomentIds.length) {
                try {
                    var mf = document.getElementById('momentsFrame');
                    if (mf && mf.contentWindow) mf.contentWindow.postMessage({ type: 'momentsDataUpdated' }, '*');
                } catch (e) {}
                try { window.postMessage({ type: 'nanoUnreadUpdated' }, '*'); } catch (e) {}
                try {
                    if (window.NanoNotify && NanoNotify.notify) {
                        NanoNotify.notify('朋友圈', (moments[0] && moments[0].author ? (moments[0].author + ' 发了新动态') : '朋友圈有新动态'), {
                            channel: 'moment', target: 'moments', force: true
                        });
                    }
                } catch (e) {}
            }
        }

        // 只从服务端删除已经落地的条目；失败的留到下次重试
        if (handledMsgIds.length || handledMomentIds.length) {
            try {
                await fetch(baseUrl() + '/auto/ack', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Push-Token': pushToken(),
                        'X-Peek-Token': peekToken()
                    },
                    body: JSON.stringify({ token: token(), userId: uid, deviceId: autoDeviceId(), appId: appId(), messageIds: handledMsgIds, momentIds: handledMomentIds })
                });
            } catch (e) {}
        }
    }

    // 通话中：本地标记 + 同步给 Worker，避免角色在电话里还发“睡了吗”
    function setCallState(chatId, active) {
        if (!chatId) return;
        try {
            if (active) localStorage.setItem('nano_call_active_' + chatId, String(Date.now()));
            else localStorage.removeItem('nano_call_active_' + chatId);
        } catch (e) {}
        var uid = currentUserId();
        if (!uid) return;
        fetch(baseUrl() + '/auto/call', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Push-Token': pushToken(),
                'X-Peek-Token': peekToken()
            },
            body: JSON.stringify({ token: token(), userId: uid, deviceId: autoDeviceId(), appId: appId(), chatId: String(chatId), active: !!active })
        }).catch(function () {});
    }

    window.addEventListener('message', function (e) {
        var d = e && e.data;
        if (!d || d.type !== 'nanoCallState') return;
        setCallState(d.chatId || '', !!d.active);
    });

    window.AutoPushBridge = { pull: pull, setCallState: setCallState, appId: appId };

    // App 启动 / 回前台 / 点通知打开时都补拉一次
    setTimeout(function () { pull(true); }, 3000);
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) setTimeout(function () { pull(); }, 1200);
    });
    window.addEventListener('focus', function () { pull(); });
})();
