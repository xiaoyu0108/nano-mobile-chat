// nano-notify.js — 通知中心（系统通知 + 内置提示音，可在「更多 → 其他」里开关与切换）
(function () {
    'use strict';

    // 应用根目录：nano-notify.js 同时被 index.html 和 html/ 下的 iframe 引用，
    // 不能用 location.href 猜（会被解析成 /html/）。用脚本自身地址向上退一级。
    var NANO_ROOT = (function () {
        try {
            if (window.NANO_ROOT) return window.NANO_ROOT;
            var cur = document.currentScript;
            if (!cur) {
                var ss = document.getElementsByTagName('script');
                for (var i = ss.length - 1; i >= 0; i--) {
                    if (ss[i] && /nano-notify\.js/.test(ss[i].src || '')) { cur = ss[i]; break; }
                }
            }
            if (cur && cur.src) return new URL('../', cur.src).href;
        } catch (e) {}
        return new URL('../', location.href).href;
    })();

    // ===== 一次性清理：早期把 base64 图片（头像/bg/聊天图片）写进了 localStorage，
    // 会把配额（约 5MB）塞满，导致之后所有设置（通知开关、铃声等）都写不进去。
    // 这里清掉可安全重建的部分，腾出空间。=====
    function storageHasRoom() {
        try { localStorage.setItem('nano_quota_probe', '1'); localStorage.removeItem('nano_quota_probe'); return true; }
        catch (e) { return false; }
    }
    function deepStripDataUrls(obj, counter) {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) { obj.forEach(function (v) { deepStripDataUrls(v, counter); }); return; }
        Object.keys(obj).forEach(function (k) {
            var v = obj[k];
            if (typeof v === 'string') {
                if (v.indexOf('data:image') === 0 || v.indexOf('data:audio') === 0 || v.indexOf('data:video') === 0) {
                    obj[k] = null; counter.n++;
                }
            } else if (v && typeof v === 'object') {
                deepStripDataUrls(v, counter);
            }
        });
    }
    function sweepBigStorage() {
        // 早年的版本会在启动时把聊天/朋友圈 localStorage 副本里的 base64 图片清空，
        // 理由是有 IndexedDB 备份；但部分页面/旧数据并没有备份，结果就是
        // “大退一次 Nano，照片全没了”。现在不再删除任何图片数据：
        // 配额不足交给 IndexedDB 和浏览器自己的清理策略，用户数据优先。
        try { localStorage.setItem('nano_storage_swept_v3', '1'); } catch (e) {}
    }
    // 只在顶层窗口执行一次清理，且延后到首屏渲染之后再跑，避免打开/切换页面时长时间空白
    try {
        if (window.parent === window) {
            try { setTimeout(sweepBigStorage, 900); } catch (e) { sweepBigStorage(); }
        }
    } catch (e) {}

    var ENABLE_KEY = 'nano_notify_enabled';
    var SOUND_KEY = 'nano_notify_sound';
    var DEFAULT_SOUND = 'ding';

    var SOUNDS = [
        { id: 'ding', name: '清脆' },
        { id: 'drop', name: '水滴' },
        { id: 'pop', name: '气泡' },
        { id: 'chime', name: '和弦' },
        { id: 'tri', name: '三全音' },
        { id: 'none', name: '静音' }
    ];

    function enabled() {
        try { return localStorage.getItem(ENABLE_KEY) === '1'; } catch (e) { return false; }
    }
    function currentSound() {
        try { return localStorage.getItem(SOUND_KEY) || DEFAULT_SOUND; } catch (e) { return DEFAULT_SOUND; }
    }

    // ===== 分应用提示音：每个 App 可以单独指定声音，没设就跟随全局 =====
    var CHANNEL_KEY = 'nano_notify_channel_sounds';
    var CHANNELS = [
        { id: 'chat', name: '私聊' },
        { id: 'group', name: '群聊' },
        { id: 'music', name: '一起听' },
        { id: 'books', name: 'Books' },
        { id: 'ins', name: 'Instagram' },
        { id: 'halo', name: 'Halo' },
        { id: 'moment', name: '朋友圈 / 自动发帖' }
    ];
    function channelMap() {
        try { return JSON.parse(localStorage.getItem(CHANNEL_KEY) || '{}') || {}; } catch (e) { return {}; }
    }
    function channelSound(ch) {
        var m = channelMap();
        return (ch && m[ch]) ? m[ch] : '';
    }
    function setChannelSound(ch, soundId) {
        if (!ch) return;
        var m = channelMap();
        if (soundId) m[ch] = soundId; else delete m[ch];
        try { localStorage.setItem(CHANNEL_KEY, JSON.stringify(m)); } catch (e) {}
    }
    function soundFor(opts) {
        opts = opts || {};
        return channelSound(opts.channel) || opts.sound || currentSound();
    }

    var audioCtx = null;
    function getCtx() {
        try {
            if (!audioCtx) {
                var AC = window.AudioContext || window.webkitAudioContext;
                if (!AC) return null;
                audioCtx = new AC();
            }
            if (audioCtx.state === 'suspended') { try { audioCtx.resume(); } catch (e) {} }
            return audioCtx;
        } catch (e) { return null; }
    }

    function tone(ctx, freq, start, dur, type, peak) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(peak || 0.28, ctx.currentTime + start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + dur + 0.02);
    }

    // ===== 自定义 MP3 铃声 =====
    var customSoundUrl = '';
    function setCustomSound(url) {
        customSoundUrl = String(url || '');
    }
    function getCustomSound() { return customSoundUrl; }
    function loadCustomSound() {
        try {
            var req = indexedDB.open('nano_app_storage', 1);
            req.onupgradeneeded = function (e) {
                try {
                    var db = e.target.result;
                    if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
                } catch (err) {}
            };
            req.onsuccess = function (e) {
                var db = e.target.result;
                try {
                    var get = db.transaction('kv', 'readonly').objectStore('kv').get('nano_custom_sound');
                    get.onsuccess = function () {
                        var v = get.result;
                        if (v && v.url) customSoundUrl = v.url;
                        try { db.close(); } catch (err) {}
                    };
                    get.onerror = function () { try { db.close(); } catch (err) {} };
                } catch (err) { try { db.close(); } catch (err2) {} }
            };
        } catch (e) {}
    }
    try { loadCustomSound(); } catch (e) {}

    function playSound(name) {
        name = name || currentSound();
        if (name === 'none') return;
        if (name === 'custom') {
            if (!customSoundUrl) return;
            try {
                var audio = new Audio(customSoundUrl);
                audio.volume = 0.85;
                audio.play().catch(function () {});
            } catch (e) {}
            return;
        }
        var ctx = getCtx();
        if (!ctx) return;
        var doPlay = function () {
            try {
                if (name === 'drop') {
                    tone(ctx, 880, 0, 0.16, 'sine', 0.25);
                    tone(ctx, 1420, 0.05, 0.18, 'sine', 0.18);
                } else if (name === 'pop') {
                    tone(ctx, 420, 0, 0.09, 'triangle', 0.3);
                    tone(ctx, 780, 0.05, 0.12, 'triangle', 0.22);
                } else if (name === 'chime') {
                    tone(ctx, 660, 0, 0.3, 'sine', 0.2);
                    tone(ctx, 990, 0.06, 0.34, 'sine', 0.17);
                    tone(ctx, 1320, 0.12, 0.36, 'sine', 0.14);
                } else if (name === 'tri') {
                    tone(ctx, 1046, 0, 0.18, 'sine', 0.24);
                    tone(ctx, 784, 0.16, 0.26, 'sine', 0.2);
                } else {
                    tone(ctx, 1174, 0, 0.16, 'sine', 0.28);
                    tone(ctx, 1568, 0.06, 0.2, 'sine', 0.2);
                }
            } catch (e) {}
        };
        // iOS 上 AudioContext 需在用户手势里 resume 才会出声；若被挂起，先恢复再播放
        if (ctx.state === 'suspended') {
            try {
                var p = ctx.resume();
                if (p && typeof p.then === 'function') { p.then(doPlay).catch(function () {}); return; }
            } catch (e) {}
        }
        doPlay();
    }

    // 首次用户手势时解锁音频：播放一个 0 长度 buffer，之后通知提示音才出得来
    function unlockAudio() {
        var ctx = getCtx();
        if (!ctx) return;
        try {
            if (ctx.state === 'suspended') { var p = ctx.resume(); if (p && p.catch) p.catch(function () {}); }
            var b = ctx.createBuffer(1, 1, 22050);
            var s = ctx.createBufferSource();
            s.buffer = b; s.connect(ctx.destination);
            try { s.start(0); } catch (e) {}
        } catch (e) {}
    }
    try {
        var _unlockOnce = function () {
            unlockAudio();
            try {
                document.removeEventListener('touchend', _unlockOnce, true);
                document.removeEventListener('click', _unlockOnce, true);
            } catch (e) {}
        };
        document.addEventListener('touchend', _unlockOnce, true);
        document.addEventListener('click', _unlockOnce, true);
    } catch (e) {}

    function notifyWindow() {
        try {
            if (window.top && window.top !== window && window.top.Notification) return window.top;
        } catch (e) {}
        return window;
    }
    function notifyPermission() {
        try {
            var w = notifyWindow();
            return (w.Notification && w.Notification.permission) || '';
        } catch (e) { return ''; }
    }
    function ensurePermission() {
        try {
            var w = notifyWindow();
            if (w.Notification && w.Notification.permission === 'default') {
                w.Notification.requestPermission();
            }
        } catch (e) {}
    }

    function nanoIconUrl() {
        try { return NANO_ROOT + 'icons/icon-192.png'; } catch (e) { return ''; }
    }

    // 是否「真的在前台」。不能只依赖 document.hasFocus()：开启保活音频后，PWA 切到
    // 后台仍可能被系统判定为 focused/visible，导致后台系统通知永远不触发（这就是之前的根因）。
    // 现在用 focus / blur / visibilitychange 一起判断，并让顶层窗口把状态共享给 iframe。
    var _pageFocused = true;
    function _syncFocus(on) { _pageFocused = !!on; }
    try {
        document.addEventListener('visibilitychange', function () { _syncFocus(!document.hidden); });
        window.addEventListener('focus', function () { _syncFocus(true); });
        window.addEventListener('blur', function () { _syncFocus(false); });
        window.addEventListener('pagehide', function () { _syncFocus(false); });
        if (window.top === window) {
            window.__nanoPageFocused = true;
            window.addEventListener('focus', function () { window.__nanoPageFocused = true; });
            window.addEventListener('blur', function () { window.__nanoPageFocused = false; });
            document.addEventListener('visibilitychange', function () { window.__nanoPageFocused = !document.hidden; });
        }
    } catch (e) {}
    function isForeground() {
        try {
            if (document.hidden) return false;
            if (!_pageFocused) return false;
            if (window.top && window.top !== window) {
                try {
                    if (window.top.document && window.top.document.hidden) return false;
                } catch (e) {}
                if (window.top.__nanoPageFocused === false) return false;
            }
            return true;
        } catch (e) { return !document.hidden; }
    }

    function notify(title, body, opts) {
        opts = opts || {};
        var inApp = enabled() || !!opts.force;
        if (!inApp) return;
        // 去重：同一条通知在极短时间内被多个通道/多次调用触发时只弹一次，
        // 解决「系统通知内容重复两次」的问题（标题+内容+target 作为 key）。
        try {
            var dk = String(title || '') + '|' + String(body || '') + '|' + String(opts.target || '');
            var now = Date.now();
            notify._seen = notify._seen || {};
            if (notify._seen[dk] && now - notify._seen[dk] < 1500) return;
            notify._seen[dk] = now;
            if (Object.keys(notify._seen).length > 60) notify._seen = {};
        } catch (e) {}
        var soundId = soundFor(opts);
        // 当前文档有焦点 → 它自己播放（这个 iframe 一定被用户点过，AudioContext 已解锁）；
        // 后台聊天帧没有焦点 → 交给顶层 showAppNotify 播放，避免整个应用静音。
        var localSound = false;
        try { localSound = !!document.hasFocus(); } catch (e) {}
        if (localSound && soundId) {
            try { playSound(soundId); } catch (e) {}
        }
        // 前台统一走内置通知栏：头像 + 昵称 + 具体信息（后台走系统通知 / Web Push）
        try {
            if (isForeground()) {
                var inAppPayload = {
                    type: 'appNotify',
                    title: title,
                    body: body,
                    app: opts.app || opts.channel || '',
                    icon: opts.icon || '',
                    avatar: opts.avatar || '',
                    name: opts.name || title,
                    target: opts.target || '',
                    action: opts.action || '',
                    url: opts.url || '',
                    sound: localSound ? false : soundId,
                    channel: opts.channel || ''
                };
                if (window.top && window.top !== window && window.top.__nanoAppNotify) {
                    window.top.__nanoAppNotify(title, body, inAppPayload.app, inAppPayload);
                    return;
                }
                if (window.parent !== window) {
                    window.parent.postMessage(inAppPayload, '*');
                    return;
                }
                if (window.__nanoAppNotify) {
                    window.__nanoAppNotify(title, body, inAppPayload.app, inAppPayload);
                    return;
                }
            }
        } catch (e) {
            try {
                if (inApp && window.parent !== window) {
                    window.parent.postMessage({ type: 'appNotify', title: title, body: body, app: opts.app || opts.channel || '', icon: opts.icon || '', name: opts.name || title, target: opts.target || '', sound: localSound ? false : soundId, channel: opts.channel || '' }, '*');
                    return;
                }
            } catch (err) {}
        }
        // 头像作为大图标（icon），Nano 图标作为右下角角标（badge）
        var defIcon = nanoIconUrl();
        var icon = opts.icon || defIcon;
        var badge = opts.badge || defIcon;
        systemNotify();

        function systemNotify() {
        // 已按要求去掉应用内的黑色横幅（appNotify）；前台只保留提示音 + 未读红点
        var payload = {
            body: String(body || '').slice(0, 120),
            tag: opts.tag || ('nano-' + Date.now()),
            // silent:true 在部分安卓机型上会只进通知中心、不弹顶部；改成普通通知。
            silent: false,
            renotify: true,
            vibrate: [90, 50, 90],
            data: { target: opts.target || '', name: opts.name || title || '' }
        };
        if (icon) payload.icon = icon;
        if (badge) payload.badge = badge;
        // Android 网页通知支持「文本动作」：下拉/长按通知可直接输入回复（iOS 不支持，忽略即可）
        if (opts.reply && String(opts.target || '').indexOf('ss-reply:') === 0) {
            try { payload.actions = [{ action: 'reply', type: 'text', title: '回复', placeholder: '回复 ' + (title || 'TA') + '…' }]; } catch (e) {}
        }
        function legacy() {
            try {
                var n = new Notification(title || 'Nano', payload);
                n.onclick = function () {
                    try { window.focus(); } catch (e) {}
                    try { if (window.parent !== window) window.parent.postMessage({ type: 'notifyOpen', target: opts.target || '' }, '*'); } catch (e) {}
                    try { n.close(); } catch (e) {}
                };
            } catch (e) {}
        }
        try {
            var __pw = notifyWindow();
            if (!__pw.Notification || __pw.Notification.permission !== 'granted') return;
            // 优先走 Service Worker：应用退到后台/锁屏时也能稳定弹出，点击由 sw.js 带回 target
            if (navigator.serviceWorker && navigator.serviceWorker.ready) {
                var settled = false;
                // SW 未注册时 ready 永不 resolve，加超时兜底改用 new Notification
                var fb = setTimeout(function () {
                    if (settled) return;
                    settled = true;
                    legacy();
                }, 600);
                navigator.serviceWorker.ready.then(function (reg) {
                    if (settled) return;
                    settled = true;
                    clearTimeout(fb);
                    if (reg && reg.showNotification) {
                        try { reg.showNotification(title || 'Nano', payload); return; } catch (e) {}
                    }
                    legacy();
                }).catch(function () {
                    if (settled) return;
                    settled = true;
                    clearTimeout(fb);
                    legacy();
                });
            } else {
                legacy();
            }
        } catch (e) {}
        }
    }

    window.NanoNotify = {
        notify: notify,
        playSound: playSound,
        unlockAudio: unlockAudio,
        ensurePermission: ensurePermission,
        enabled: enabled,
        isForeground: isForeground,
        currentSound: currentSound,
        sounds: SOUNDS,
        channels: CHANNELS,
        channelSound: channelSound,
        setChannelSound: setChannelSound,
        soundFor: soundFor,
        setCustomSound: setCustomSound,
        getCustomSound: getCustomSound
    };
})();
