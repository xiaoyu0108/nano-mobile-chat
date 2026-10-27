/* nano-push.js — 真实后台推送（Web Push）客户端。
 *
 * 真后台推送需要一个推送服务器（本文件不包含服务器，请按教程部署 Cloudflare Worker）。
 * 服务器只需负责「到点把通知发到手机」，通知内容由本地调用 schedule() 预约。
 *
 * 用法（在控制台或你自己的设置页里）：
 *   NanoPush.setup('https://你的-worker.workers.dev', '你的VAPID公钥');        // 只需一次
 *   NanoPush.setup('https://...workers.dev', 'VAPID公钥', '你的PUSH_TOKEN');  // 若服务器设了 token
 *   NanoPush.enable();                                                       // 需在用户点击后调用
 *   NanoPush.schedule([{ at: Date.now() + 60000, title: '某某', body: '在吗？', target: 'chat:角色id' }]);
 */
(function () {
    'use strict';

    // 必须用当前页面所在目录：部署在 GitHub Pages 子路径（/nano-mobile-chat/）时，
    // new URL('../') 会跑到站点根目录，SW 注册 404，安卓订阅就会失败。
    var DEFAULT_SW = (window.NANO_ROOT || new URL('./', location.href).href) + 'sw.js';

    // 站点身份：同一套 Worker 被 Nano / 纳米 / 其它部署共用时，用它隔离订阅与自动推送。
    // 算法必须和 sw.js 的 appIdFromRoot 完全一致，否则 SW 会丢弃自己的推送。
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

    function readConfig() {
        var endpoint = '', vapid = '', token = '';
        try {
            endpoint = (localStorage.getItem('nano_push_endpoint') || localStorage.getItem('nano_peek_url') || '').trim();
            vapid = (localStorage.getItem('nano_push_vapid') || '').trim();
            token = (localStorage.getItem('nano_push_token') || localStorage.getItem('nano_peek_token') || '').trim();
        } catch (e) {}
        endpoint = endpoint.replace(/\/+$/, '');
        // 旧测试 Worker 仍带 Bark / KV 逻辑，读到就自动迁回正式 Worker。
        if (endpoint && (/(^|\.)peek-test\.nano315\.online$/i.test(endpoint) || /nano-test-ceshi/i.test(endpoint))) {
            endpoint = 'https://nanopush.nano315.online';
            try { localStorage.setItem('nano_push_endpoint', endpoint); } catch (e) {}
        }
        return { endpoint: endpoint, vapid: vapid, token: token };
    }

    function saveConfig(endpoint, vapid, token) {
        try {
            localStorage.setItem('nano_push_endpoint', String(endpoint || '').trim().replace(/\/+$/, ''));
            localStorage.setItem('nano_push_vapid', String(vapid || '').trim());
            localStorage.setItem('nano_push_token', String(token || '').trim());
        } catch (e) {}
    }

    // 把 VAPID 公钥（base64url）转成订阅需要的 Uint8Array
    function urlBase64ToUint8Array(base64String) {
        var padding = new Array((4 - (base64String.length % 4)) % 4 + 1).join('=');
        var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        var raw = atob(base64);
        var out = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
        return out;
    }

    function swSupported() {
        return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    }

    function platform() {
        var ua = String(navigator.userAgent || '');
        return {
            android: /Android/i.test(ua),
            ios: /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1),
            chrome: /Chrome|CriOS|EdgA|SamsungBrowser|MiuiBrowser|HuaweiBrowser|HeyTapBrowser/i.test(ua),
            ua: ua
        };
    }

    function friendlyError(err) {
        var raw = String((err && (err.message || err.name)) || err || '');
        var p = platform();
        if (/push service error|Registration failed/i.test(raw)) {
            if (p.android) {
                return '安卓没有可用的系统推送服务（Push service error）。Web Push 在安卓依赖 Chrome 与 Google Play 服务；国产浏览器 / 无 GMS 的设备无法建立订阅。请用 Chrome 打开并安装本应用后重试；仍失败时只能用「保活」在前台/后台运行时接收。';
            }
            return '浏览器没有可用的推送服务（Push service error），请换用 Chrome / Edge 后重试。';
        }
        if (/permission|denied|NotAllowed/i.test(raw)) {
            return '通知权限未授予：请在浏览器或系统设置里允许 Nano 的通知，然后重试。';
        }
        if (/applicationServerKey|InvalidAccess|InvalidCharacter/i.test(raw)) {
            return 'VAPID 公钥无效或已过期，请重新获取服务端公钥后再开启。';
        }
        return raw || '开启推送失败';
    }

    function registerSW() {
        return navigator.serviceWorker.register(DEFAULT_SW, { updateViaCache: 'none' })
            .then(function () { return navigator.serviceWorker.ready; });
    }

    function subscribe(reg) {
        var cfg = readConfig();
        var opts = { userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(cfg.vapid) };
        function once() { return reg.pushManager.subscribe(opts); }
        return once().catch(function (err) {
            // 安卓常见：旧订阅 / 旧 Service Worker 残留导致 push service error。
            // 清掉旧订阅、等一会儿再订阅一次；仍然失败就返回可读原因。
            return reg.pushManager.getSubscription().then(function (old) {
                return old && old.unsubscribe ? old.unsubscribe().catch(function () {}) : null;
            }).then(function () {
                return new Promise(function (resolve) { setTimeout(resolve, 700); });
            }).then(once).catch(function (err2) {
                var e = new Error(friendlyError(err2 || err));
                e.cause = err2 || err;
                e.code = 'PUSH_SUBSCRIBE_FAILED';
                throw e;
            });
        });
    }

    function autoDeviceId() {
        var id = '';
        try { id = localStorage.getItem('nano_device_id') || ''; } catch (e) {}
        if (!id) {
            id = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
            try { localStorage.setItem('nano_device_id', id); } catch (e) {}
        }
        return id || 'default';
    }

    function currentAutoUserId() {
        try {
            var raw = localStorage.getItem('nano_mask_data');
            var home = raw ? JSON.parse(raw) : null;
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

    function postJSON(url, data) {
        var headers = { 'Content-Type': 'application/json' };
        var cfg = readConfig();
        if (cfg.token) headers['X-Push-Token'] = cfg.token;
        return fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(data)
        }).then(function (r) { return r.json().catch(function () { return {}; }); });
    }

    function enable(force) {
        var cfg = readConfig();
        if (!cfg.endpoint || !cfg.vapid) {
            return Promise.reject(new Error('未配置推送服务器：请先 NanoPush.setup(服务器地址, VAPID公钥)'));
        }
        if (!swSupported()) {
            var p0 = platform();
            return Promise.reject(new Error(p0.android
                ? '当前安卓浏览器不支持 Web Push：请用 Chrome / Edge 打开，并确认设备有 Google Play 服务'
                : '当前环境不支持后台推送（iOS 需先把网页「添加到主屏幕」后用 PWA 打开）'));
        }
        return Notification.requestPermission().then(function (perm) {
            if (perm !== 'granted') throw new Error('通知权限未授予：请在浏览器或系统设置里允许 Nano 的通知');
            return registerSW();
        }).then(function (reg) {
            var usedKey = '';
            try { usedKey = localStorage.getItem('nano_push_vapid_used') || ''; } catch (e) {}
            var keyChanged = !!(usedKey && usedKey !== cfg.vapid);
            return reg.pushManager.getSubscription().then(function (sub) {
                if (sub && !force && !keyChanged) return sub;
                // 用户点「重新订阅」或服务端 VAPID 换过：旧订阅对新公钥无效，必须重建
                if (sub && (force || keyChanged)) {
                    return sub.unsubscribe().catch(function () {}).then(function () { return subscribe(reg); });
                }
                return subscribe(reg);
            });
        }).then(function (sub) {
            try { localStorage.setItem('nano_push_vapid_used', cfg.vapid); } catch (e) {}
            return postJSON(cfg.endpoint + '/subscribe', {
                subscription: sub.toJSON ? sub.toJSON() : sub,
                userId: currentAutoUserId(),
                deviceId: autoDeviceId(),
                appId: appId(),
                ua: navigator.userAgent,
                platform: platform().android ? 'android' : (platform().ios ? 'ios' : 'other'),
                ts: Date.now()
            }).then(function () { return sub; });
        }).catch(function (err) {
            var e = err && err.code === 'PUSH_SUBSCRIBE_FAILED' ? err : new Error(friendlyError(err));
            e.cause = e.cause || err;
            throw e;
        });
    }

    function disable() {
        if (!swSupported()) return Promise.resolve(false);
        return navigator.serviceWorker.getRegistration().then(function (reg) {
            if (!reg) return false;
            return reg.pushManager.getSubscription().then(function (sub) {
                if (!sub) return false;
                var cfg = readConfig();
                var endpoint = sub.endpoint;
                return sub.unsubscribe().then(function () {
                    if (cfg.endpoint) postJSON(cfg.endpoint + '/unsubscribe', { endpoint: endpoint }).catch(function () {});
                    return true;
                });
            });
        });
    }

    // 预约一条/多条后台推送；at 为毫秒时间戳
    function schedule(items) {
        var cfg = readConfig();
        if (!cfg.endpoint) return Promise.reject(new Error('未配置推送服务器'));
        var list = (Array.isArray(items) ? items : [items]).filter(function (it) { return it && it.at; });
        if (!list.length) return Promise.resolve({ ok: true, count: 0 });
        // 每条预约都绑定站点 / 设备 / 用户，服务端只投递给对应订阅，避免多开互相串。
        list = list.map(function (it) {
            return Object.assign({}, it, {
                appId: appId(),
                deviceId: autoDeviceId(),
                userId: currentAutoUserId()
            });
        });
        return postJSON(cfg.endpoint + '/schedule', { appId: appId(), deviceId: autoDeviceId(), userId: currentAutoUserId(), items: list });
    }

    function cancel(ids) {
        var cfg = readConfig();
        if (!cfg.endpoint) return Promise.resolve({ ok: true, count: 0 });
        var list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
        if (!list.length) return Promise.resolve({ ok: true, count: 0 });
        return postJSON(cfg.endpoint + '/schedule/cancel', { appId: appId(), deviceId: autoDeviceId(), userId: currentAutoUserId(), ids: list });
    }

    function status() {
        var cfg = readConfig();
        var out = { configured: !!(cfg.endpoint && cfg.vapid), endpoint: cfg.endpoint, permission: (typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'), subscribed: false, appId: appId(), deviceId: autoDeviceId(), userId: currentAutoUserId() };
        if (!swSupported()) return Promise.resolve(out);
        return navigator.serviceWorker.getRegistration().then(function (reg) {
            if (!reg) return out;
            return reg.pushManager.getSubscription().then(function (sub) { out.subscribed = !!sub; return out; });
        }).catch(function () { return out; });
    }

    // 已授权设备在启动时把 deviceId 补写到服务端；旧订阅也能自动升级成“按设备推送”
    function refreshSubscription() {
        try {
            if (!swSupported() || Notification.permission !== 'granted') return Promise.resolve(false);
            var cfg = readConfig();
            if (!cfg.endpoint || !cfg.vapid) return Promise.resolve(false);
            // 服务端公钥变了：旧订阅已经无效，自动重建一次，否则后台推送会静默失败。
            var usedKey = '';
            try { usedKey = localStorage.getItem('nano_push_vapid_used') || ''; } catch (e) {}
            if (usedKey && usedKey !== cfg.vapid) {
                return enable(true).then(function () { return true; }).catch(function () { return false; });
            }
            var last = parseInt(localStorage.getItem('nano_push_meta_sync_at') || '0', 10) || 0;
            var identity = appId() + '|' + autoDeviceId() + '|' + currentAutoUserId();
            var lastIdentity = localStorage.getItem('nano_push_meta_identity') || '';
            // 切换面具 / 站点、或升级到带 appId 的版本后必须立刻重写订阅元数据，
            // 否则服务端仍会按旧身份把它当成别的用户/别的站点推送。
            if (lastIdentity === identity && Date.now() - last < 10 * 60 * 1000) return Promise.resolve(false);
            return registerSW().then(function (reg) {
                return reg.pushManager.getSubscription();
            }).then(function (sub) {
                if (!sub) return false;
                return postJSON(cfg.endpoint + '/subscribe', {
                    subscription: sub.toJSON ? sub.toJSON() : sub,
                    userId: currentAutoUserId(),
                    deviceId: autoDeviceId(),
                    // 必须带上 appId：Worker 按 sub2:<appId>:<deviceId>:<userId> 存订阅，
                    // 漏传会被存成 legacy，之后服务端自动推送就查不到这个订阅。
                    appId: appId(),
                    ua: navigator.userAgent,
                    platform: platform().android ? 'android' : (platform().ios ? 'ios' : 'other'),
                    ts: Date.now()
                }).then(function () {
                    try {
                        localStorage.setItem('nano_push_meta_sync_at', String(Date.now()));
                        localStorage.setItem('nano_push_meta_identity', identity);
                    } catch (e) {}
                    return true;
                });
            }).catch(function () { return false; });
        } catch (e) { return Promise.resolve(false); }
    }

    // 服务端可能因为重新部署/清 KV 换掉 VAPID。旧订阅对新公钥无效时，
    // 浏览器不会报错但会静默收不到推送；启动时对一下公钥并自动重建订阅。
    function syncVapid() {
        try {
            var cfg = readConfig();
            if (!cfg.endpoint) return Promise.resolve(false);
            return fetch(cfg.endpoint.replace(/\/+$/, '') + '/vapid', { cache: 'no-store' })
                .then(function (r) { return r.json(); })
                .then(function (j) {
                    var key = (j && (j.publicKey || j.vapid || j.key)) || '';
                    if (!key) return false;
                    var used = '';
                    try { used = localStorage.getItem('nano_push_vapid_used') || ''; } catch (e) {}
                    // 只要还没用当前公钥重建过订阅，就重建一次；旧订阅在服务端换钥后会静默失效。
                    if (key !== cfg.vapid) saveConfig(cfg.endpoint, key, cfg.token);
                    if (key === used) return false;
                    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                        return enable(true).then(function () { return true; }).catch(function () { return false; });
                    }
                    return true;
                }).catch(function () { return false; });
        } catch (e) { return Promise.resolve(false); }
    }

    window.NanoPush = {
        setup: function (endpoint, vapid, token) { saveConfig(endpoint, vapid, token); return readConfig(); },
        enable: enable,
        refreshSubscription: refreshSubscription,
        disable: disable,
        schedule: schedule,
        cancel: cancel,
        status: status,
        appId: appId,
        deviceId: autoDeviceId,
        userId: currentAutoUserId,
        config: readConfig
    };
    try { setTimeout(function () { syncVapid().then(function () { refreshSubscription(); }); }, 1600); } catch (e) {}
})();
