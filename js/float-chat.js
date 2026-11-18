// ============================================================
// float-chat.js — 安卓 APK 系统悬浮聊天窗入口
// 聊天页把当前角色 postMessage 给顶层，这里调用 NanoApp 打开悬浮窗。
// ============================================================
(function () {
    'use strict';
    function api() {
        try {
            return (window.NanoApp && typeof window.NanoApp.startFloatingChat === 'function') ? window.NanoApp : null;
        } catch (e) { return null; }
    }

    function start(d) {
        d = d || {};
        var id = String(d.chatId || d.charId || '');
        if (!id) return;
        var n = api();
        if (!n) {
            try { alert('悬浮聊天需要安卓 APK；网页版请直接在聊天页聊。'); } catch (e) {}
            return;
        }
        var payload;
        try {
            payload = JSON.stringify({
                chatId: id,
                charName: d.charName || d.name || '聊天',
                avatar: d.avatar || ''
            });
        } catch (e) { return; }
        var r = '';
        try { r = n.startFloatingChat(payload); } catch (e) {}
        if (r === 'permission') {
            try { alert('请允许 Nano「显示在其他应用上层」。授权后返回 App，悬浮聊天会自动打开。'); } catch (e) {}
        } else if (r === 'bad_payload') {
            try { alert('没有找到当前角色，先打开一个私聊再试。'); } catch (e) {}
        } else if (r === 'untrusted') {
            try { alert('当前页面不被允许打开悬浮窗。'); } catch (e) {}
        } else if (r === 'started') {
            try {
                if (window.NanoNotify && NanoNotify.notify) {
                    NanoNotify.notify('悬浮聊天', '悬浮球已开启，切到其他 App 也能继续聊天。', { channel: 'chat' });
                }
            } catch (e) {}
        }
    }

    window.addEventListener('message', function (e) {
        var d = e && e.data;
        if (!d || d.type !== 'nanoFloatChat') return;
        start(d);
    });

    window.NanoFloatChat = { start: start };
})();
