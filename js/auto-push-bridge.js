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
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
    }
    function enc(s) { return encodeURIComponent(String(s == null ? '' : s)); }

    function baseUrl() {
        var b = '';
        try { b = (localStorage.getItem('nano_push_endpoint') || '').trim(); } catch (e) {}
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
    function currentUserId() {
        var home = readJSON('nano_mask_data', null);
        if (home && home.currentMaskId) return String(home.currentMaskId);
        if (home && Array.isArray(home.masks) && home.masks[0] && home.masks[0].id) return String(home.masks[0].id);
        return '';
    }
    function currentOpenChat() {
        try {
            var f = document.getElementById('chatInnerFrame');
            var src = f ? (f.getAttribute('src') || '') : '';
            if (!src || src.indexOf('chat_inner.html') < 0) return '';
            return new URL(src, location.href).searchParams.get('chat') || '';
        } catch (e) { return ''; }
    }
    function bumpUnread(chatId) {
        if (!chatId) return;
        var a = readJSON(ACT_KEY, {});
        a[chatId] = Date.now();
        writeJSON(ACT_KEY, a);
        var u = readJSON(UNREAD_KEY, {});
        u[chatId] = (parseInt(u[chatId] || 0, 10) || 0) + 1;
        writeJSON(UNREAD_KEY, u);
    }
    function markRead(chatId) {
        if (!chatId) return;
        var u = readJSON(UNREAD_KEY, {});
        if (u[chatId]) { delete u[chatId]; writeJSON(UNREAD_KEY, u); }
    }

    function putMoment(post) {
        return new Promise(function (resolve) {
            if (!post || !post.id) { resolve(false); return; }
            // 先写 localStorage 兜底
            try {
                var arr = readJSON('nano_moments_data', []);
                if (!Array.isArray(arr)) arr = [];
                if (!arr.some(function (x) { return x && x.id === post.id; })) arr.unshift(post);
                writeJSON('nano_moments_data', arr.slice(0, 500));
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
                        tx.onerror = function () { try { d.close(); } catch (e) {} resolve(false); };
                    } catch (e) { resolve(false); }
                };
                req.onerror = function () { resolve(false); };
            } catch (e) { resolve(false); }
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
            var url = baseUrl() + '/auto/pending?userId=' + enc(uid) + '&token=' + enc(token());
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

        // ===== 主动消息 =====
        if (messages.length) {
            var store = readJSON(PENDING_MSGS, {});
            if (!store || typeof store !== 'object') store = {};
            var openChat = currentOpenChat();
            messages.forEach(function (m) {
                if (!m || !m.id || !m.chatId) return;
                var bubbles = Array.isArray(m.bubbles) ? m.bubbles.slice() : [];
                if (!bubbles.length && m.text) bubbles = [m.text];
                bubbles = bubbles.map(function (s) { return String(s || '').trim(); }).filter(Boolean);
                if (!bubbles.length) return;
                if (openChat && String(openChat) === String(m.chatId) && window.__nanoShell && window.__nanoShell.postToChat) {
                    // 当前正开着这个聊天：直接插入，不再重复暂存
                    try {
                        bubbles.forEach(function (t) {
                            window.__nanoShell.postToChat({ type: 'NANO_CHAR_SAY', chatId: String(m.chatId), text: t });
                        });
                        markRead(String(m.chatId));
                        return;
                    } catch (e) {}
                }
                var list = Array.isArray(store[m.chatId]) ? store[m.chatId] : [];
                if (!list.some(function (x) { return x && x.id === m.id; })) {
                    list.push({ id: m.id, name: m.name || '', bubbles: bubbles, ts: m.ts || Date.now() });
                    store[m.chatId] = list;
                    bumpUnread(String(m.chatId));
                }
            });
            writeJSON(PENDING_MSGS, store);
        }

        // ===== 朋友圈 =====
        if (moments.length) {
            var okAny = false;
            for (var i = 0; i < moments.length; i++) {
                if (await putMoment(moments[i])) okAny = true;
            }
            if (okAny) {
                try {
                    var mf = document.getElementById('momentsFrame');
                    if (mf && mf.contentWindow) mf.contentWindow.postMessage({ type: 'momentsDataUpdated' }, '*');
                } catch (e) {}
            }
        }

        // 拉取成功后从服务端删除，避免下次重复
        var mIds = messages.map(function (m) { return m && m.id; }).filter(Boolean);
        var pIds = moments.map(function (p) { return p && p.id; }).filter(Boolean);
        if (mIds.length || pIds.length) {
            try {
                await fetch(baseUrl() + '/auto/ack', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Push-Token': pushToken(),
                        'X-Peek-Token': peekToken()
                    },
                    body: JSON.stringify({ token: token(), userId: uid, messageIds: mIds, momentIds: pIds })
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
            body: JSON.stringify({ token: token(), userId: uid, chatId: String(chatId), active: !!active })
        }).catch(function () {});
    }

    window.addEventListener('message', function (e) {
        var d = e && e.data;
        if (!d || d.type !== 'nanoCallState') return;
        setCallState(d.chatId || '', !!d.active);
    });

    window.AutoPushBridge = { pull: pull, setCallState: setCallState };

    // App 启动 / 回前台 / 点通知打开时都补拉一次
    setTimeout(function () { pull(true); }, 3000);
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) setTimeout(function () { pull(); }, 1200);
    });
    window.addEventListener('focus', function () { pull(); });
})();
