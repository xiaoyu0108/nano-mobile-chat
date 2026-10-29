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

    // 必须指向站点根目录的 sw.js。设置页/通知页在 /html/ 子目录的 iframe 里，
    // new URL('./') 会算成 /html/sw.js（404），这也是安卓订阅失败、控制台一直报错的常见原因。
    var DEFAULT_SW = (function () {
        try {
            if (window.NANO_ROOT) return String(window.NANO_ROOT).replace(/\/?$/, '/') + 'sw.js';
            var p = String(location.pathname || '/');
            var idx = p.indexOf('/html/');
            var base = idx >= 0 ? p.slice(0, idx + 1) : p.replace(/[^/]*$/, '');
            if (!/\/$/.test(base)) base += '/';
            return location.origin + base + 'sw.js';
        } catch (e) { return new URL('./', location.href).href + 'sw.js'; }
    })();

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

    // 默认公共 Worker（与设置页保持一致）。
    // 注意：这里不再内置 VAPID 公钥。Worker 换过密钥后，硬编码的旧公钥会让
    // 浏览器订阅到一把服务端已经没有私钥的 key，表现就是“已订阅但永远收不到”。
    // 所有订阅前都从 /vapid 取服务端当前公钥。
    var DEFAULT_ENDPOINT = 'https://nanopush.nano315.online';
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
            endpoint = DEFAULT_ENDPOINT;
            try { localStorage.setItem('nano_push_endpoint', endpoint); } catch (e) {}
        }
        if (!endpoint) endpoint = DEFAULT_ENDPOINT;
        return { endpoint: endpoint, vapid: vapid, token: token };
    }

    // 取服务端当前 VAPID 公钥。订阅前必须调用：旧订阅/旧公钥在服务端换钥后会静默失效。
    function fetchVapid(endpoint, timeoutMs) {
        endpoint = String(endpoint || '').replace(/\/+$/, '');
        if (!endpoint) return Promise.reject(new Error('未配置推送服务器'));
        var ctrl = null, timer = null;
        try {
            ctrl = new AbortController();
            timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, timeoutMs || 8000);
        } catch (e) {}
        function clear() { if (timer) { clearTimeout(timer); timer = null; } }
        return fetch(endpoint + '/vapid', { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
            .then(function (r) { return r.json().catch(function () { return {}; }); })
            .then(function (j) {
                clear();
                var key = (j && (j.key || j.publicKey || j.vapid)) || '';
                if (!key) throw new Error((j && j.error) || '服务端没有返回 VAPID 公钥');
                return key;
            }, function (err) {
                clear();
                if (err && err.name === 'AbortError') throw new Error('获取 VAPID 公钥超时，请检查推送服务器 / 网络');
                throw err;
            });
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
        if (/Failed to fetch|NetworkError|Load failed|Network request failed/i.test(raw)) {
            return '连不上推送服务器：请检查服务端地址、网络，或服务端是否允许跨域（CORS）。';
        }
        if (/HTTP 401|unauthorized|X-Push-Token|token/i.test(raw)) {
            return '推送服务器要求令牌：请在「服务端地址」旁边填写与 Worker 一致的 PUSH_TOKEN。';
        }
        if (/HTTP 5\d\d/i.test(raw)) {
            return '推送服务器内部错误：' + raw.slice(0, 200) + '（请检查 Worker 的 D1 绑定和部署版本）';
        }
        return raw || '开启推送失败';
    }

    function registerSW() {
        return navigator.serviceWorker.register(DEFAULT_SW, { updateViaCache: 'none' })
            .then(function (reg) {
                // ready 在注册异常时可能永远不 resolve，加超时避免设置页一直卡在“开启中”。
                return Promise.race([
                    navigator.serviceWorker.ready,
                    new Promise(function (_, reject) {
                        setTimeout(function () {
                            reject(new Error('Service Worker 启动超时：请刷新页面后重试（或检查 sw.js 是否能正常访问）'));
                        }, 12000);
                    })
                ]).then(function () { return reg; });
            });
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
        if (cfg.token) { headers['X-Push-Token'] = cfg.token; headers['X-Peek-Token'] = cfg.token; }
        var ctrl = null, timer = null;
        try {
            ctrl = new AbortController();
            timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 15000);
        } catch (e) {}
        return fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(data),
            signal: ctrl ? ctrl.signal : undefined
        }).then(function (r) {
            return r.text().then(function (txt) {
                var j = {};
                try { j = txt ? JSON.parse(txt) : {}; } catch (e) {}
                if (!r.ok) {
                    throw new Error((j && j.error) ? ('HTTP ' + r.status + '：' + j.error) : ('HTTP ' + r.status + '：' + String(txt || '服务端返回错误').slice(0, 160)));
                }
                if (!j || typeof j !== 'object') throw new Error('服务端返回格式异常（HTTP ' + r.status + '）');
                return j;
            });
        }).catch(function (err) {
            if (err && err.name === 'AbortError') throw new Error('连接推送服务器超时：请检查服务端地址 / 网络');
            throw err;
        }).then(function (j) {
            if (timer) clearTimeout(timer);
            return j;
        }, function (err) {
            if (timer) clearTimeout(timer);
            throw err;
        });
    }

    function enable(force) {
        var cfg = readConfig();
        if (!cfg.endpoint) {
            return Promise.reject(new Error('未配置推送服务器：请先 NanoPush.setup(服务器地址, VAPID公钥)'));
        }
        // 每次开启/重新订阅都先问服务端要当前公钥：本地缓存可能是换钥前的旧公钥，
        // 用旧公钥 new 出来的订阅，服务端没有对应私钥，推送会静默失败。
        return fetchVapid(cfg.endpoint, 8000).then(function (key) {
            cfg.vapid = key;
            saveConfig(cfg.endpoint, key, cfg.token);
            return enableWithConfig(cfg, force);
        }).catch(function (err) {
            var e = new Error(friendlyError(err));
            e.cause = err;
            throw e;
        });
    }

    function enableWithConfig(cfg, force) {
        if (!cfg.vapid) {
            return Promise.reject(new Error('服务端没有返回 VAPID 公钥，无法订阅'));
        }
        if (!swSupported()) {
            var p0 = platform();
            return Promise.reject(new Error(p0.android
                ? '当前安卓浏览器不支持 Web Push：请用 Chrome / Edge 打开，并确认设备有 Google Play 服务'
                : '当前环境不支持后台推送（iOS 需先把网页「添加到主屏幕」后用 PWA 打开）'));
        }
        var p1 = platform();
        if (p1.ios) {
            var standalone = false;
            try { standalone = (window.navigator.standalone === true) || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches); } catch (e) {}
            if (!standalone) {
                return Promise.reject(new Error('iOS 需要先把 Nano「添加到主屏幕」，再从桌面图标打开；在 Safari 标签页里无法开启 Web Push'));
            }
        }
        // 权限已经是 granted 时不要再调用 requestPermission：
        // 在 iframe / 非用户手势（例如设置页自动补登记）里再次请求，部分浏览器会
        // 直接返回 denied 或抛错，表现就是「系统里明明开了通知，这里却说没开」。
        function notifyPermission() {
            try {
                if (typeof Notification === 'undefined') return 'unsupported';
                // 设置页可能在 iframe 里：优先信任顶层窗口的真实权限，
                // 避免 iframe 报 denied、系统/浏览器其实已经允许的情况。
                var topPerm = '';
                try {
                    if (window.top && window.top !== window && window.top.Notification) {
                        topPerm = window.top.Notification.permission;
                        if (topPerm === 'granted') return 'granted';
                        // 设置页/通知页在 iframe 里：浏览器只认可顶层窗口的权限请求，
                        // 在 iframe 里 requestPermission 很容易直接返回 denied。
                        if (topPerm === 'default') {
                            var tp = window.top.Notification.requestPermission();
                            return (tp && typeof tp.then === 'function') ? tp : Promise.resolve(tp);
                        }
                    }
                } catch (e) {}
                if (Notification.permission === 'granted' || Notification.permission === 'denied') return Notification.permission;
                var p = Notification.requestPermission();
                return (p && typeof p.then === 'function') ? p : Promise.resolve(p);
            } catch (e) {
                try { return (typeof Notification !== 'undefined' && Notification.permission) || 'denied'; } catch (e2) { return 'denied'; }
            }
        }
        return Promise.resolve(notifyPermission()).then(function (perm) {
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
            }).then(function (r) {
                // 以前不检查返回值：Worker 没保存成功也会显示“已开启”，
                // 结果就是设置页一直提示“服务端没有订阅记录”。
                if (r && r.ok === false) {
                    throw new Error('服务端没有保存订阅：' + (r.error || '未知错误'));
                }
                return sub;
            });
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
                    if (cfg.endpoint) {
                        // 必须带上 appId/deviceId/userId：服务端订阅键是
                        // sub2:<app>:<device>:<user>:<id>，只传 endpoint 删不掉。
                        postJSON(cfg.endpoint + '/unsubscribe', {
                            endpoint: endpoint,
                            appId: appId(),
                            deviceId: autoDeviceId(),
                            userId: currentAutoUserId()
                        }).catch(function () {});
                    }
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
        var permission = (typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
        try {
            if (permission !== 'granted' && window.top && window.top !== window && window.top.Notification && window.top.Notification.permission === 'granted') {
                permission = 'granted';
            }
        } catch (e) {}
        var out = { configured: !!cfg.endpoint, endpoint: cfg.endpoint, permission: permission, subscribed: false, appId: appId(), deviceId: autoDeviceId(), userId: currentAutoUserId() };
        if (!swSupported()) return Promise.resolve(out);
        return navigator.serviceWorker.getRegistration().then(function (reg) {
            if (!reg) return out;
            return reg.pushManager.getSubscription().then(function (sub) { out.subscribed = !!sub; return out; });
        }).catch(function () { return out; });
    }

    // 已授权设备在启动时把 deviceId 补写到服务端；旧订阅也能自动升级成“按设备推送”
    function refreshSubscription() {
        try {
            if (!swSupported()) return Promise.resolve(false);
            var perm = Notification.permission;
            try {
                if (perm !== 'granted' && window.top && window.top !== window && window.top.Notification && window.top.Notification.permission === 'granted') perm = 'granted';
            } catch (e) {}
            if (perm !== 'granted') return Promise.resolve(false);
            var cfg = readConfig();
            if (!cfg.endpoint) return Promise.resolve(false);
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
                }).then(function (r) {
                    if (r && r.ok === false) throw new Error('服务端没有保存订阅：' + (r.error || '未知错误'));
                    try {
                        localStorage.setItem('nano_push_meta_sync_at', String(Date.now()));
                        localStorage.setItem('nano_push_meta_identity', identity);
                    } catch (e) {}
                    return true;
                });
            }).catch(function () { return false; });
        } catch (e) { return Promise.resolve(false); }
    }

    function test() {
        if (!swSupported()) return Promise.reject(new Error('当前环境不支持系统通知'));
        return registerSW().then(function (reg) {
            var opts = {
                body: 'Web Push 已连接：关闭 App 后也能收到后台提醒。',
                icon: (window.NANO_ROOT || './') + 'icons/icon-192.png',
                badge: (window.NANO_ROOT || './') + 'icons/icon-192.png',
                tag: 'nano-push-test',
                renotify: true
            };
            return reg.showNotification('Nano 通知测试', opts).then(function () { return true; });
        });
    }

    // 只把「浏览器里已有的订阅」重新登记到服务端：不申请权限、不重建订阅。
    // 用于设置页发现服务端没有订阅记录时自动补登记，避免非用户手势下
    // requestPermission / subscribe 被浏览器拒绝，最后显示成“补登记失败”。
    function syncSubscription() {
        try {
            if (!swSupported()) return Promise.resolve(false);
            var cfg = readConfig();
            if (!cfg.endpoint) return Promise.resolve(false);
            return navigator.serviceWorker.getRegistration().then(function (reg) {
                if (!reg) return null;
                return reg.pushManager.getSubscription();
            }).then(function (sub) {
                if (!sub) return false;
                return postJSON(cfg.endpoint + '/subscribe', {
                    subscription: sub.toJSON ? sub.toJSON() : sub,
                    userId: currentAutoUserId(),
                    deviceId: autoDeviceId(),
                    appId: appId(),
                    ua: navigator.userAgent,
                    platform: platform().android ? 'android' : (platform().ios ? 'ios' : 'other'),
                    ts: Date.now()
                }).then(function (r) {
                    if (r && r.ok === false) throw new Error('服务端没有保存订阅：' + (r.error || '未知错误'));
                    try {
                        localStorage.setItem('nano_push_meta_sync_at', String(Date.now()));
                        localStorage.setItem('nano_push_meta_identity', appId() + '|' + autoDeviceId() + '|' + currentAutoUserId());
                    } catch (e) {}
                    return true;
                });
            });
        } catch (e) { return Promise.resolve(false); }
    }

    // 服务端可能因为重新部署/清 KV 换掉 VAPID。旧订阅对新公钥无效时，
    // 浏览器不会报错但会静默收不到推送；启动时对一下公钥并自动重建订阅。
    function syncVapid() {
        try {
            var cfg = readConfig();
            if (!cfg.endpoint) return Promise.resolve(false);
            var ctrl = null, timer = null;
            try { ctrl = new AbortController(); timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 6000); } catch (e) {}
            return fetch(cfg.endpoint.replace(/\/+$/, '') + '/vapid', { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
                .then(function (r) { if (timer) clearTimeout(timer); return r.json(); })
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
                }).catch(function () { if (timer) clearTimeout(timer); return false; });
        } catch (e) { return Promise.resolve(false); }
    }

    window.NanoPush = {
        setup: function (endpoint, vapid, token) { saveConfig(endpoint, vapid, token); return readConfig(); },
        enable: enable,
        refreshSubscription: refreshSubscription,
        syncSubscription: syncSubscription,
        test: test,
        disable: disable,
        schedule: schedule,
        cancel: cancel,
        status: status,
        appId: appId,
        deviceId: autoDeviceId,
        userId: currentAutoUserId,
        config: readConfig
    };
    // 只让顶层窗口做后台自检；设置/通知等 iframe 里的这个实例不要重复注册 SW 或订阅，
    // 否则会出现 /html/sw.js 404、重复 requestPermission 等假错误。
    try {
        if (window.top === window) {
            setTimeout(function () { syncVapid().then(function () { refreshSubscription(); }); }, 1600);
        }
    } catch (e) {}
})();
