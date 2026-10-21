// ============================================================
// ios-bridge.js — iOS「快捷指令」窥屏桥
// 让 iOS 快捷指令把「屏幕识别文本 / 模型回复」送进 Nano，由角色点评并写进聊天。
// 只在 App 外壳（index.html）里运行。
//
// 支持两种深链参数（挂在外壳地址上，例如：
//   https://你的域名/index.html?nanoScreen=...&nanoChat=ID&nanoName=NAME ）
//   · nanoScreen=<屏幕识别文本>  → 由 Nano 调用主 API，让角色点评这段内容
//   · nanoScreenReply=<模型回复>  → 直接把这段回复当成角色消息写进聊天（快捷指令自己调用 API 时用）
//   · nanoChat / nanoName        → 指定角色；省略则用最近一次会话
//
// 参数会被写进 localStorage 待办队列，当场没跑通时下次打开 App 会自动补上。
// 完整配置步骤见 docs/ios-shortcuts.md，图形化配置见 ios-setting.html。
// ============================================================
(function () {
    'use strict';
    if (window.__nanoIOSBridgeLoaded) return;
    window.__nanoIOSBridgeLoaded = true;

    // 只在顶层外壳运行（深链指向 index.html）
    if (window.top !== window.self) return;

    var PENDING_KEY = 'nano_ios_pending';
    var PARAMS = ['nanoScreen', 'nanoScreenReply', 'nanoChat', 'nanoName'];

    function enc(s) { return encodeURIComponent(String(s == null ? '' : s)); }
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
    function deviceId() {
        var id = '';
        try { id = localStorage.getItem('nano_device_id') || ''; } catch (e) {}
        if (!id) {
            id = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
            try { localStorage.setItem('nano_device_id', id); } catch (e) {}
        }
        return id || 'default';
    }
    function loadPending() { try { var a = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
    function savePending(list) { try { localStorage.setItem(PENDING_KEY, JSON.stringify((list || []).slice(-20))); } catch (e) {} }

    function notify(info, text) {
        var body = String(text || '').replace(/\s*\n+\s*/g, '  ').slice(0, 120);
        try { if (window.NanoNotify && NanoNotify.notify) NanoNotify.notify((info.name || 'TA'), body, { channel: 'chat', force: true, target: 'chat:' + info.id }); } catch (e) {}
    }

    // 读取角色库里的第一个普通角色（兜底目标）
    function readFirstChar() {
        return new Promise(function (resolve) {
            var done = false;
            function finish(v) { if (!done) { done = true; resolve(v); } }
            try {
                if (!('indexedDB' in window)) { finish(null); return; }
                var req = indexedDB.open('nano_characters_db', 1);
                req.onupgradeneeded = function (e) { try { var d = e.target.result; if (!d.objectStoreNames.contains('characters')) d.createObjectStore('characters', { keyPath: 'id' }); } catch (err) {} };
                req.onerror = function () { finish(null); };
                req.onsuccess = function (e) {
                    try {
                        var db = e.target.result;
                        if (!db.objectStoreNames.contains('characters')) { try { db.close(); } catch (x) {} finish(null); return; }
                        var r = db.transaction('characters', 'readonly').objectStore('characters').getAll();
                        r.onsuccess = function () {
                            var list = (r.result || []).filter(function (c) { return c && c.id && !c.nanoAssistant; });
                            var c = list[0];
                            try { db.close(); } catch (x) {}
                            finish(c ? { id: String(c.id), name: String(c.name || c.id), avatar: c.avatar || '' } : null);
                        };
                        r.onerror = function () { try { db.close(); } catch (x) {} finish(null); };
                    } catch (err) { finish(null); }
                };
            } catch (e) { finish(null); }
            setTimeout(function () { finish(null); }, 2500);
        });
    }

    async function resolveTarget(item) {
        if (item && item.chat) return { id: String(item.chat), name: String(item.name || ''), avatar: '' };
        try { var lc = JSON.parse(localStorage.getItem('nano_last_chat') || 'null'); if (lc && lc.id) return { id: String(lc.id), name: String(lc.name || ''), avatar: lc.avatar || '' }; } catch (e) {}
        try { var si = JSON.parse(sessionStorage.getItem('last_chat_info') || 'null'); if (si && si.chatId) return { id: String(si.chatId), name: String(si.chatName || ''), avatar: si.chatAvatar || '' }; } catch (e) {}
        return await readFirstChar();
    }

    // 把一段回复作为角色消息写进聊天（复用外壳的 say：会自动打开对应会话）
    function injectReply(info, reply) {
        var text = String(reply || '').trim();
        if (!text) return false;
        var sh = window.__nanoShell;
        if (!sh) return false;
        try {
            if (sh.say) { sh.say(info.id, info.name, text); return true; }
            if (sh.postToChat) {
                sh.open('chat_inner.html?chat=' + enc(info.id) + '&name=' + enc(info.name), '', 'main');
                setTimeout(function () { try { sh.postToChat({ type: 'NANO_CHAR_SAY', chatId: String(info.id), text: text }); } catch (e) {} }, 900);
                return true;
            }
        } catch (e) {}
        return false;
    }

    async function processItem(item) {
        if (!item) return true;
        var info = await resolveTarget(item);
        if (!info || !info.id) return false;   // 拿不到目标角色：保留在队列里，稍后重试
        if (item.reply) {
            var ok = injectReply(info, item.reply);
            if (ok) {
                notify(info, item.reply);
                try {
                    if (window.NanoKeepAlive && NanoKeepAlive.setNowPlaying) {
                        NanoKeepAlive.setNowPlaying({ title: info.name || 'TA', artist: String(item.reply).split(/\n+/)[0], artwork: info.avatar || '' });
                    }
                } catch (e) {}
            }
            return ok;
        }
        if (item.screen) {
            if (window.ScreenShare && typeof window.ScreenShare.commentText === 'function') {
                try { window.ScreenShare.commentText(info, item.screen); return true; } catch (e) { return false; }
            }
            return false;   // ScreenShare 还没就绪：保留在队列里
        }
        return true;
    }

    var draining = false;
    function drain() {
        if (draining) return;
        var list = loadPending();
        if (!list.length) return;
        draining = true;
        var keep = [], i = 0;
        (function step() {
            if (i >= list.length) { savePending(keep); draining = false; return; }
            var it = list[i++];
            Promise.resolve(processItem(it)).then(function (ok) {
                if (!ok) { it.tries = (it.tries || 0) + 1; if (it.tries < 3) keep.push(it); }
                step();
            }).catch(function () { step(); });
        })();
    }

    function boot() {
        var sp;
        try { sp = new URLSearchParams(location.search); } catch (e) { sp = null; }
        if (sp) {
            var screen = sp.get('nanoScreen');
            var reply = sp.get('nanoScreenReply');
            if (screen || reply) {
                var item = { ts: Date.now(), screen: screen || '', reply: reply || '', chat: sp.get('nanoChat') || '', name: sp.get('nanoName') || '', tries: 0 };
                var list = loadPending();
                // 同一个时间戳不重复入队
                if (!list.some(function (x) { return x.ts === item.ts; })) { list.push(item); savePending(list); }
                // 处理完立刻从地址栏移除，避免刷新 / 再次冷启动重复触发
                try {
                    PARAMS.forEach(function (k) { sp.delete(k); });
                    var qs = sp.toString();
                    history.replaceState(null, '', location.pathname + (qs ? ('?' + qs) : '') + location.hash);
                } catch (e) {}
            }
        }
        // 等外壳初始化 + chat_inner 可被唤起后再处理
        setTimeout(drain, 1600);
        setTimeout(drain, 4200);
        // 屏幕速聊：回前台后补拉并合并暂存轮次
        setTimeout(function () { try { pullPeek(); } catch (e) {} }, 2600);
    }

    // 屏幕速聊：拉取服务端暂存的轮次，按顺序合并进该角色「唯一」的聊天
    async function pullPeek() {
        var base = '', token = '', chat = '';
        try { base = localStorage.getItem('nano_peek_url') || ''; } catch (e) {}
        try { token = localStorage.getItem('nano_peek_token') || ''; } catch (e) {}
        try { chat = localStorage.getItem('nano_peek_chat') || ''; } catch (e) {}
        if (!base || !chat) return;
        base = String(base).trim().replace(/\/+$/, '');
        if (/\/peek$/i.test(base)) base = base.replace(/\/peek$/i, '');
        var sh = window.__nanoShell;
        if (!sh) return;
        var r;
        try { r = await fetch(base + '/peek/pending?chatId=' + enc(chat) + '&appId=' + enc(appId()) + '&token=' + enc(token), { cache: 'no-store' }); } catch (e) { return; }
        if (!r.ok) return;
        var data = null;
        try { data = await r.json(); } catch (e) {}
        var turns = (data && Array.isArray(data.turns)) ? data.turns : [];
        if (!turns.length) return;
        try { if (sh.open) sh.open('chat_inner.html?chat=' + enc(chat) + '&name=' + enc(''), '', 'main'); } catch (e) {}
        await new Promise(function (res) { setTimeout(res, 1100); });
        for (var i = 0; i < turns.length; i++) {
            var t = turns[i] || {};
            if (t.user && t.user !== '[图片]') {
                try { sh.postToChat({ type: 'NANO_USER_SAY', chatId: String(chat), text: String(t.user), silent: true }); } catch (e) {}
                await new Promise(function (res) { setTimeout(res, 400); });
            }
            if (t.char) {
                try { sh.postToChat({ type: 'NANO_CHAR_SAY', chatId: String(chat), text: String(t.char) }); } catch (e) {}
                await new Promise(function (res) { setTimeout(res, 400); });
            }
        }
        try {
            await fetch(base + '/peek/ack', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chatId: String(chat), appId: appId(), deviceId: deviceId(), token: token })
            });
        } catch (e) {}
    }

    window.NanoIOSBridge = {
        version: '20261013b',
        queue: function (item) { var l = loadPending(); l.push(item || {}); savePending(l); },
        drain: drain,
        pullPeek: pullPeek,
        comment: function (info, text) { try { window.ScreenShare.commentText(info, text); } catch (e) {} },
        inject: function (info, reply) { injectReply(info, reply); }
    };

    // 页面重新可见时兜底处理一次（例如从后台切回）
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) {
            setTimeout(drain, 800);
            setTimeout(function () { try { pullPeek(); } catch (e) {} }, 1400);
        }
    });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
