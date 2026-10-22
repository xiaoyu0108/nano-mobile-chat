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
    // 会把配额（约 5MB）塞满，导致之后所有设置（通知开关、Bark 密钥等）都写不进去。
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
        try {
            if (localStorage.getItem('nano_storage_swept_v3') === '1' && storageHasRoom()) return;
            var keys = [];
            for (var i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
            keys.forEach(function (k) {
                if (!k) return;
                try {
                    // 这几类都有 IndexedDB 完整备份，去掉 localStorage 里的 base64 不会丢数据
                    if (k.indexOf('chat_messages_') === 0 || k.indexOf('group_msgs_') === 0 || k.indexOf('nano_ins_chat_') === 0) {
                        var arr = JSON.parse(localStorage.getItem(k) || 'null');
                        if (Array.isArray(arr)) {
                            var c = { n: 0 };
                            deepStripDataUrls(arr, c);
                            if (c.n) localStorage.setItem(k, JSON.stringify(arr));
                        }
                    } else if (k === 'nano_moments_data') {
                        // 朋友圈图片只在 localStorage，保留最新 12 条的图片，其余清掉
                        var posts = JSON.parse(localStorage.getItem(k) || 'null');
                        if (Array.isArray(posts)) {
                            var changed = false;
                            posts.forEach(function (p, idx) {
                                if (idx >= 12 && p && Array.isArray(p.images) && p.images.length) { p.images = []; changed = true; }
                            });
                            if (changed) localStorage.setItem(k, JSON.stringify(posts));
                        }
                    }
                    // 注意：朋友圈封面（nanoMomentsCover_*）不再在这里删除。
                    // 之前会删掉 data: 开头的封面，导致用户刚换的背景图刷新后就没了（“换了没反应”）。
                } catch (e) {}
            });
            try { localStorage.setItem('nano_storage_swept_v3', '1'); } catch (e) {}
        } catch (e) {}
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

    function ensurePermission() {
        try {
            if ('Notification' in window && Notification.permission === 'default') {
                Notification.requestPermission();
            }
        } catch (e) {}
    }

    // ===== Bark：iPhone 系统推送（国内直连，无需梯子/FCM）=====
    // 在「更多 → 其他」或控制台执行 NanoNotify.setBarkKey('你的Bark密钥') 即可开启。
    var BARK_KEY = 'nano_bark_key';
    var BARK_ENABLED = 'nano_bark_enabled';        // Bark 推送总开关（关掉后不再向 Bark 发任何请求）
    var BARK_LEVEL = 'nano_bark_level';            // Bark 级别：passive=静默不震动（默认），active/timeSensitive/critical
    var BARK_CLEARED = 'nano_bark_key_cleared';    // 用户主动清空密钥的标记，避免又从 IndexedDB 读回旧密钥
    // localStorage 写满时密钥可能只写进了 IndexedDB，这里缓存一份，保证 notify() 同步取得到
    var barkCache = '';
    function barkKey() {
        try {
            // 用户主动清空过：以清空为准，忽略内存缓存（否则其它 iframe 仍会用旧密钥继续推送）
            if (localStorage.getItem(BARK_CLEARED) === '1') return '';
            var v = (localStorage.getItem(BARK_KEY) || '').trim();
            return v || barkCache;
        } catch (e) { return barkCache; }
    }
    // 其它页面/iframe 清空或修改密钥时，通过 storage 事件同步（localStorage 是同源共享的）
    try {
        window.addEventListener('storage', function (e) {
            if (!e || !e.key || e.key === BARK_KEY || e.key === BARK_CLEARED) {
                try { barkCache = (localStorage.getItem(BARK_KEY) || '').trim(); } catch (err) { barkCache = ''; }
            }
        });
    } catch (e) {}
    function barkKeyAsync() {
        var local = '';
        var cleared = false;
        try { local = (localStorage.getItem(BARK_KEY) || '').trim(); } catch (e) {}
        try { cleared = localStorage.getItem(BARK_CLEARED) === '1'; } catch (e) {}
        if (local) { barkCache = local; return Promise.resolve(local); }
        // 用户主动清空过：不要再用 IndexedDB 里的旧密钥复活它
        if (cleared) { barkCache = ''; return Promise.resolve(''); }
        if (typeof localforage === 'undefined') return Promise.resolve('');
        return localforage.getItem(BARK_KEY).then(function (v) {
            var k = String(v || '').trim();
            if (k) barkCache = k;
            return k;
        }).catch(function () { return ''; });
    }
    function setBarkKey(key) {
        key = String(key || '').trim();
        barkCache = key;
        var ok = false;
        try { localStorage.setItem(BARK_KEY, key); ok = true; } catch (e) { ok = false; }
        try { localStorage.setItem(BARK_CLEARED, key ? '0' : '1'); } catch (e) {}
        if (typeof localforage !== 'undefined') {
            // 清空时必须把 IndexedDB 里的旧值也一并清掉，否则下次启动会读回旧密钥继续推送
            try { localforage.setItem(BARK_KEY, key); } catch (e) {}
        }
        return ok;
    }
    // Bark 开关：默认开启（只要填了密钥）。用户可在「更多 → 其他」里单独关掉。
    function barkEnabled() {
        try { return localStorage.getItem(BARK_ENABLED) !== '0'; } catch (e) { return true; }
    }
    function setBarkEnabled(on) {
        try { localStorage.setItem(BARK_ENABLED, on ? '1' : '0'); } catch (e) {}
    }
    // Bark 推送级别：active 才会在锁屏/后台弹横幅；声音单独用 sound=none 关掉
    function barkLevel() {
        try {
            var v = (localStorage.getItem(BARK_LEVEL) || 'active').trim();
            // 旧版本默认写过 passive（只进通知中心、不弹横幅），这里统一改成 active
            return (!v || v === 'passive') ? 'active' : v;
        } catch (e) { return 'active'; }
    }
    function setBarkLevel(level) {
        try { localStorage.setItem(BARK_LEVEL, String(level || 'active').trim() || 'active'); } catch (e) {}
    }
    // 兼容 body 被写成对象的情况，避免通知正文显示成 "[object Object]" / "body"
    function pushText(v, fallback) {
        var s = '';
        if (v && typeof v === 'object') s = v.body || v.text || v.message || v.content || v.title || '';
        else s = (v == null ? '' : v);
        s = String(s || '').trim();
        return s || String(fallback || '');
    }
    function barkPush(title, body, opts, keyOverride) {
        var key = String(keyOverride || barkKey() || '').trim();
        if (!key) return Promise.resolve({ ok: false, error: 'no-key' });
        opts = opts || {};
        // 通知标题优先用「角色昵称」，正文优先用真实消息内容。
        // 之前的调用链里偶尔只传了 title/body 的空壳（例如 schedule 的占位文案），
        // 结果 Bark 只显示通用的 "Nano / 你有一条新消息"。这里用 opts.name / opts.preview
        // 兜底，保证每条推送都带角色名和具体内容。
        var nameHint = pushText(opts.name, '');
        var bodyHint = pushText(opts.preview, '');
        title = pushText(title, nameHint || 'Nano');
        body = pushText(body, bodyHint || '你有一条新消息');
        if (nameHint && /^(Nano|新消息|通知|消息|朋友圈|TA)$/i.test(String(title).trim())) title = nameHint;
        if (/^(title|body|undefined|null)$/i.test(String(title).trim())) title = nameHint || 'Nano';
        if (bodyHint && /^(你有一条新消息|新消息|收到就说明配置成功.?)$/i.test(String(body).trim())) body = bodyHint;
        if (/^(title|body|undefined|null)$/i.test(String(body).trim())) body = bodyHint || '你有一条新消息';
        var base = key.indexOf('http') === 0 ? key.replace(/\/+$/, '') : ('https://api.day.app/' + encodeURIComponent(key));
        var full = base + '/' + encodeURIComponent(title) + '/' + encodeURIComponent(body.slice(0, 150));
        // level=active：后台/锁屏弹横幅；sound=none：不要提示音，也尽量避免震动
        var q = [
            'group=' + encodeURIComponent(opts.group || 'Nano'),
            'level=' + encodeURIComponent(opts.level || barkLevel()),
            'sound=' + encodeURIComponent(opts.sound || 'none')
        ];
        var target = opts.target || '';
        if (target) {
            try { q.push('url=' + encodeURIComponent(NANO_ROOT + 'index.html?open=' + encodeURIComponent(target))); } catch (e) {}
        }
        // 有头像就用头像当图标；Bark 需要可访问的 http 图片，data: 头像则退回 Nano 图标
        try {
            var bi = (opts.icon && /^https?:/i.test(opts.icon)) ? opts.icon : nanoIconUrl();
            if (bi) q.push('icon=' + encodeURIComponent(bi));
        } catch (e) {}
        var url = full + '?' + q.join('&');
        return fetch(url, { cache: 'no-store' }).then(function (r) {
            return r.json().catch(function () { return {}; });
        }).then(function (j) {
            var ok = !(j && j.code && Number(j.code) !== 200);
            return {
                ok: ok,
                resp: j,
                error: ok ? '' : String((j && (j.message || j.error)) || ('Bark code ' + (j && j.code)))
            };
        }).catch(function () {
            // 读取响应被 CORS 拦截时，退化成不可读请求再发一次（请求仍会送达 Bark）
            try { fetch(url, { mode: 'no-cors' }).catch(function () {}); } catch (e) {}
            return { ok: true, cors: true };
        });
    }

    function nanoIconUrl() {
        try { return NANO_ROOT + 'icons/icon-192.png'; } catch (e) { return ''; }
    }

    // 是否「真的在前台」。只看 document.hidden 不够：开启保活音频后，PWA 切到后台
    // 仍可能保持 visible，导致通知被当成前台胶囊吞掉（表现为后台收不到系统提醒）。
    function isForeground() {
        try {
            if (document.hidden) return false;
            var topDoc = null;
            try { topDoc = (window.top && window.top !== window) ? window.top.document : null; } catch (e) { topDoc = null; }
            if (topDoc && topDoc.hidden) return false;
            var d = topDoc || document;
            if (typeof d.hasFocus === 'function') return d.hasFocus();
            return !document.hidden;
        } catch (e) { return !document.hidden; }
    }

    function notify(title, body, opts) {
        opts = opts || {};
        if (!enabled() && !opts.force) return;
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
        // 前台统一走内置通知栏：头像 + 昵称 + 具体信息（后台仍走系统通知 / Bark）
        try {
            if (isForeground()) {
                // 只有人在前台时才播放应用内提示音；后台交给 Bark（sound=none）静音推送
                playSound(soundFor(opts));
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
                    url: opts.url || ''
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
                if (window.parent !== window) {
                    window.parent.postMessage({ type: 'appNotify', title: title, body: body, app: opts.app || opts.channel || '', icon: opts.icon || '', name: opts.name || title, target: opts.target || '' }, '*');
                    return;
                }
            } catch (err) {}
        }
        // 头像作为大图标（icon），Nano 图标作为右下角角标（badge）
        var defIcon = nanoIconUrl();
        var icon = opts.icon || defIcon;
        var badge = opts.badge || defIcon;
        // Bark：应用退到后台/锁屏时，通过苹果推送弹真正的系统通知（国内可用）
        var barkSent = false;
        try {
            var hidden = !isForeground();
            if (barkEnabled() && barkKey() && (hidden || opts.force || opts.bark)) {
                var bopts = Object.assign({}, opts, {
                    icon: icon,
                    name: opts.name || title,
                    preview: body,
                    group: opts.group || opts.name || title || 'Nano'
                });
                barkPush(title, body, bopts);
                barkSent = true;
            }
        } catch (e) {}
        // Bark 已经弹过系统通知：不再走 ServiceWorker / new Notification，避免同一条弹两次
        if (barkSent) return;
        // 已按要求去掉应用内的黑色横幅（appNotify）；前台只保留提示音 + 未读红点
        var payload = {
            body: String(body || '').slice(0, 120),
            tag: opts.tag || ('nano-' + Date.now()),
            // silent:true 在部分安卓机型上会只进通知中心、不弹顶部；改成普通通知。
            silent: false,
            renotify: true,
            vibrate: [90, 50, 90],
            data: { target: opts.target || '' }
        };
        if (icon) payload.icon = icon;
        if (badge) payload.badge = badge;
        // Android 网页通知支持「文本动作」：下拉/长按通知可直接输入回复（iOS 不支持，忽略即可）
        if (opts.reply && String(opts.target || '').indexOf('ss-reply:') === 0) {
            try { payload.actions = [{ action: 'reply', type: 'text', title: '回复', placeholder: '回复 TA…' }]; } catch (e) {}
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
            if (!('Notification' in window) || Notification.permission !== 'granted') return;
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

    // 启动时把 IndexedDB 里的 Bark 密钥读进缓存（localStorage 写满时的兜底），
    // 这样后台生成消息时 notify() 也能同步拿到密钥并推送。
    try { barkKeyAsync(); } catch (e) {}
    try { window.addEventListener('load', function () { barkKeyAsync(); }); } catch (e) {}

    window.NanoNotify = {
        notify: notify,
        playSound: playSound,
        unlockAudio: unlockAudio,
        ensurePermission: ensurePermission,
        enabled: enabled,
        currentSound: currentSound,
        sounds: SOUNDS,
        channels: CHANNELS,
        channelSound: channelSound,
        setChannelSound: setChannelSound,
        soundFor: soundFor,
        barkKey: barkKey,
        barkKeyAsync: barkKeyAsync,
        setBarkKey: setBarkKey,
        barkEnabled: barkEnabled,
        setBarkEnabled: setBarkEnabled,
        barkLevel: barkLevel,
        setBarkLevel: setBarkLevel,
        barkPush: barkPush,
        setCustomSound: setCustomSound,
        getCustomSound: getCustomSound
    };
})();
