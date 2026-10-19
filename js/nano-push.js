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

    var DEFAULT_SW = (window.NANO_ROOT || new URL('../', location.href).href) + 'sw.js';

    function readConfig() {
        var endpoint = '', vapid = '', token = '';
        try {
            endpoint = (localStorage.getItem('nano_push_endpoint') || '').trim();
            vapid = (localStorage.getItem('nano_push_vapid') || '').trim();
            token = (localStorage.getItem('nano_push_token') || '').trim();
        } catch (e) {}
        return { endpoint: endpoint.replace(/\/+$/, ''), vapid: vapid, token: token };
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

    function registerSW() {
        return navigator.serviceWorker.register(DEFAULT_SW, { updateViaCache: 'none' })
            .then(function () { return navigator.serviceWorker.ready; });
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

    function enable() {
        var cfg = readConfig();
        if (!cfg.endpoint || !cfg.vapid) {
            return Promise.reject(new Error('未配置推送服务器：请先 NanoPush.setup(服务器地址, VAPID公钥)'));
        }
        if (!swSupported()) {
            return Promise.reject(new Error('当前环境不支持后台推送（iOS 需先把网页「添加到主屏幕」后用 PWA 打开）'));
        }
        return Notification.requestPermission().then(function (perm) {
            if (perm !== 'granted') throw new Error('通知权限未授予');
            return registerSW();
        }).then(function (reg) {
            return reg.pushManager.getSubscription().then(function (sub) {
                if (sub) return sub;
                return reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(cfg.vapid)
                });
            });
        }).then(function (sub) {
            return postJSON(cfg.endpoint + '/subscribe', {
                subscription: sub.toJSON ? sub.toJSON() : sub,
                ua: navigator.userAgent,
                ts: Date.now()
            }).then(function () { return sub; });
        });
    }

    function disable() {
        if (!swSupported()) return Promise.resolve(false);
        return navigator.serviceWorker.getRegistration(DEFAULT_SW).then(function (reg) {
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
        return postJSON(cfg.endpoint + '/schedule', { items: list });
    }

    function status() {
        var cfg = readConfig();
        var out = { configured: !!(cfg.endpoint && cfg.vapid), endpoint: cfg.endpoint, permission: (typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'), subscribed: false };
        if (!swSupported()) return Promise.resolve(out);
        return navigator.serviceWorker.getRegistration(DEFAULT_SW).then(function (reg) {
            if (!reg) return out;
            return reg.pushManager.getSubscription().then(function (sub) { out.subscribed = !!sub; return out; });
        }).catch(function () { return out; });
    }

    window.NanoPush = {
        setup: function (endpoint, vapid, token) { saveConfig(endpoint, vapid, token); return readConfig(); },
        enable: enable,
        disable: disable,
        schedule: schedule,
        status: status,
        config: readConfig
    };
})();
