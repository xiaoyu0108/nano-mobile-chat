// nano-badge.js — 未读红点 / 最近活跃排序 的共享状态
// 约定：
//   nano_chat_activity : { [chatId]: epochMs }   最近一条消息时间（用于排序）
//   nano_unread_counts : { [chatId]: number }    未读条数（用于红点）
(function () {
    'use strict';

    var UNREAD_KEY = 'nano_unread_counts';
    var ACT_KEY = 'nano_chat_activity';

    function readMap(key) {
        try {
            var raw = localStorage.getItem(key);
            var o = raw ? JSON.parse(raw) : {};
            return (o && typeof o === 'object') ? o : {};
        } catch (e) { return {}; }
    }
    function writeMap(key, obj) {
        try { localStorage.setItem(key, JSON.stringify(obj || {})); } catch (e) {}
    }

    var ctx = { chatId: '', foreground: false };
    var notifyBuffer = {};      // chatId -> { title, texts:[], opts, timer }：合并同一轮的多条消息
    var COALESCE_MS = 1200;     // 攒多久合成一条通知（不再丢弃中间的，只是合并推送）

    function flushNotify(chatId) {
        var buf = notifyBuffer[chatId];
        if (!buf) return;
        delete notifyBuffer[chatId];
        try {
            if (!window.NanoNotify || !window.NanoNotify.enabled()) return;
            var body = buf.texts.join('\n').trim();
            if (body.length > 200) body = body.slice(0, 200) + '…';
            window.NanoNotify.notify(buf.title || '新消息', body || '你有一条新消息', buf.opts || {});
        } catch (e) {}
    }
    function cancelNotify(chatId) {
        var buf = notifyBuffer[chatId];
        if (buf && buf.timer) { try { clearTimeout(buf.timer); } catch (e) {} }
        delete notifyBuffer[chatId];
    }

    function markRead(chatId) {
        if (!chatId) return;
        var u = readMap(UNREAD_KEY);
        if (u[chatId]) { delete u[chatId]; writeMap(UNREAD_KEY, u); }
    }
    function activity(chatId) {
        if (!chatId) return;
        var a = readMap(ACT_KEY);
        a[chatId] = Date.now();
        writeMap(ACT_KEY, a);
    }
    // 收到角色/群消息：更新活跃时间；若当前不在前台则累加未读并触发通知
    function incoming(chatId, title, text, opts) {
        if (!chatId) return;
        activity(chatId);
        var isForeground = (ctx.foreground && ctx.chatId === chatId);
        if (isForeground) {
            markRead(chatId);
            return; // 正在看这个聊天时不再弹通知/响铃
        }
        var u = readMap(UNREAD_KEY);
        u[chatId] = (parseInt(u[chatId] || 0, 10) || 0) + 1;
        writeMap(UNREAD_KEY, u);
        // 同一轮的多条消息合并成一条通知：中间几条不再被丢掉，也不会刷屏
        var buf = notifyBuffer[chatId];
        if (!buf) {
            buf = notifyBuffer[chatId] = { title: title, texts: [], opts: opts, timer: null };
            buf.timer = setTimeout(function () { flushNotify(chatId); }, COALESCE_MS);
        }
        if (title) buf.title = title;
        if (opts) buf.opts = opts;
        if (text) buf.texts.push(String(text));
    }
    function setContext(chatId) {
        ctx.chatId = chatId || '';
        ctx.foreground = true;
        activity(ctx.chatId);
        markRead(ctx.chatId);
        cancelNotify(ctx.chatId);   // 已经回到这个聊天：取消还没发出去的合并通知
    }
    function setForeground(on) {
        ctx.foreground = !!on;
        if (on) { activity(ctx.chatId); markRead(ctx.chatId); cancelNotify(ctx.chatId); }
    }

    // 切到后台/锁屏时，立刻把「前台」标记关掉。
    // 否则 ctx.foreground 一直是 true，后台（保活）生成的角色消息会被当成
    // 「你正在看这个聊天」而被 incoming() 静默丢弃 —— 这就是切走 App 收不到 Bark 推送的原因。
    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', function () {
            setForeground(!document.hidden);
        });
    }

    window.addEventListener('message', function (e) {
        var d = e.data;
        if (!d || typeof d !== 'object') return;
        if (d.type === 'nanoOverlayOpen') {
            if (d.chatId && d.chatId !== ctx.chatId) {
                ctx.foreground = false;
            } else {
                ctx.foreground = true;
                activity(ctx.chatId);
                markRead(ctx.chatId);
            }
        } else if (d.type === 'nanoOverlayClosed') {
            ctx.foreground = false;
        }
    });

    window.NanoBadge = {
        markRead: markRead,
        activity: activity,
        incoming: incoming,
        setContext: setContext,
        setForeground: setForeground,
        getUnread: function (chatId) { return parseInt(readMap(UNREAD_KEY)[chatId] || 0, 10) || 0; },
        getActivity: function (chatId) { return parseInt(readMap(ACT_KEY)[chatId] || 0, 10) || 0; }
    };
})();
