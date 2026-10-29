/* sw.js — 用于 PWA 安装、通知点击聚焦、静态资源加速。
   缓存策略（解决“每次打开都要好几秒”）：
     · HTML：先联网（保证拿到最新版本），断网时用缓存兜底
     · CSS / JS / 图片 / 图标 / 字体：先用缓存秒开，后台静默更新（stale-while-revalidate）
       —— 改了代码刷新两次即可看到新版；不想等可以给 CACHE 换个版本号
     · 跨域（CDN）请求不拦截，交给浏览器自己的缓存
   注意：Service Worker 无法在应用被关闭后持续运行 AI 生成，
   “后台回复”依赖页面常驻 + 音频保活；真正的“关闭也能收到”需要服务端配合（见 push 事件）。 */
'use strict';

var CACHE = 'nano-static-v351';
var STATIC_RE = /\.(css|js|png|jpg|jpeg|webp|svg|gif|ico|woff2?|ttf|mp3)$/i;
var HTML_FRESH_MS = 10 * 60 * 1000;   // 10 分钟内直接用缓存 HTML（页面切换秒开），后台静默更新
var NET_TIMEOUT_MS = 1200;            // 有缓存时，网络最多等 1.2 秒，超时先上缓存

// 与客户端 NanoScope.appId 使用同一套算法：用「站点根目录」区分不同部署。
// 例如 /nano-mobile-chat/ 和 /nano/ 会得到不同 appId，旧 Nano 的推送不会弹到新纳米。
function appIdFromRoot(root) {
    var s = '';
    try {
        var u = new URL(root, self.location.href);
        s = u.origin + u.pathname.replace(/\/+$/, '');
    } catch (e) { s = String(root || self.location.href); }
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return 'app_' + h.toString(36);
}
var APP_ID = appIdFromRoot(self.registration.scope);

self.addEventListener('install', function (event) {
    self.skipWaiting();
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
        }).then(function () { return self.clients.claim(); })
    );
});

self.addEventListener('fetch', function (event) {
    var req = event.request;
    if (req.method !== 'GET') return;
    var url;
    try { url = new URL(req.url); } catch (e) { return; }
    if (url.origin !== self.location.origin) return;

    var isHTML = req.mode === 'navigate' || /\.html?$/i.test(url.pathname) || /\/$/.test(url.pathname);
    if (isHTML) {
        // 10 分钟内直接命中缓存（页面之间切换秒开）；否则联网拿最新。
        // 有缓存时最多等 2.5 秒网络，超时就先用缓存显示，后台继续更新，
        // 避免网络慢/节点卡时整个页面卡住几十秒。
        event.respondWith(
            caches.open(CACHE).then(function (cache) {
                return cache.match(req).then(function (cached) {
                    var at = 0;
                    try { at = parseInt((cached && cached.headers.get('x-nano-at')) || '0', 10) || 0; } catch (e) {}
                    if (cached && (Date.now() - at < HTML_FRESH_MS)) return cached;

                    var network = fetch(req).then(function (res) {
                        try {
                            var h = new Headers(res.headers);
                            h.set('x-nano-at', String(Date.now()));
                            cache.put(req, new Response(res.clone().body, {
                                status: res.status, statusText: res.statusText, headers: h
                            }));
                        } catch (e) {}
                        return res;
                    });

                    if (!cached) {
                        return network.catch(function () { return caches.match('./index.html'); });
                    }
                    return Promise.race([
                        network,
                        new Promise(function (resolve) { setTimeout(function () { resolve(cached); }, NET_TIMEOUT_MS); })
                    ]).catch(function () { return cached; });
                });
            })
        );
        return;
    }

    // JS 采用「先用缓存秒开，后台静默更新」（stale-while-revalidate）：
    // 改完代码刷新两次即可看到新版；带 ?v= 的资源是新缓存键，会直接走网络。
    if (/\.js$/i.test(url.pathname)) {
        event.respondWith(
            caches.open(CACHE).then(function (cache) {
                return cache.match(req).then(function (cached) {
                    var network = fetch(req).then(function (res) {
                        try { if (res && res.status === 200) cache.put(req, res.clone()); } catch (e) {}
                        return res;
                    });
                    if (cached) {
                        event.waitUntil(network.catch(function () {}));
                        return cached;
                    }
                    return network.catch(function () { return cached; });
                });
            })
        );
        return;
    }

    if (!STATIC_RE.test(url.pathname)) return;
    event.respondWith(
        caches.open(CACHE).then(function (cache) {
            return cache.match(req).then(function (cached) {
                var network = fetch(req).then(function (res) {
                    try { if (res && res.status === 200) cache.put(req, res.clone()); } catch (e) {}
                    return res;
                }).catch(function () { return cached; });
                if (!cached) return network;
                return Promise.race([
                    network,
                    new Promise(function (resolve) { setTimeout(function () { resolve(cached); }, NET_TIMEOUT_MS); })
                ]).catch(function () { return cached; });
            });
        })
    );
});

// 真正的「应用已关闭也能收到」推送需要服务端配合（Web Push）：
// 服务端拿 VAPID 私钥向这里的订阅端点发 push，下面的 push 事件就会弹系统通知。
// 主动消息 / 朋友圈可由 Worker cron 到点生成后推送；内容暂存在服务端，App 打开后再合并。
self.addEventListener('push', function (event) {
    var data = { title: 'Nano', body: '你有一条新消息', target: '' };
    try {
        if (event.data) {
            try { Object.assign(data, event.data.json()); }
            catch (e) { data.body = event.data.text ? event.data.text() : data.body; }
        }
    } catch (e) {}
    // 服务端如果误把别的站点/别的用户的消息发到这个订阅，直接丢弃。
    // appId 是站点根目录的哈希，不包含用户隐私；旧推送没有 appId 时按旧逻辑放行。
    if (data.appId && data.appId !== APP_ID) {
        event.waitUntil(Promise.resolve());
        return;
    }
    event.waitUntil((async function () {
        // 只有「真正在前台且窗口有焦点」时才交给内置胶囊通知栏。
        // 不能只用 visibilityState：开启保活音频后，PWA 退到后台仍可能被判定为
        // visible，结果系统通知被吞掉。这里改成「先投递内置通知，等 App 回执」：
        // App 真的收到并显示后才不再弹系统通知；没回执（后台/被冻结）才走系统通知。
        var pushId = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        var acked = false;
        var onAck = function (e) {
            try {
                if (e && e.data && e.data.type === 'nanoPushAck' && String(e.data.id || '') === pushId) acked = true;
            } catch (err) {}
        };
        try {
            var list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
            var live = (list || []).filter(function (c) {
                if (!c) return false;
                return (typeof c.focused === 'boolean') ? c.focused : (c.visibilityState === 'visible');
            });
            if (live.length) {
                try { self.addEventListener('message', onAck); } catch (e) {}
                live.forEach(function (c) {
                    try {
                        c.postMessage({
                            type: 'appNotify',
                            title: data.title || 'Nano',
                            body: data.body || '',
                            app: data.channel || '',
                            avatar: data.icon || '',
                            name: data.name || data.title || '',
                            target: data.target || '',
                            fromPush: true,
                            pushId: pushId
                        });
                    } catch (e) {}
                });
                await new Promise(function (resolve) { setTimeout(resolve, 1500); });
                try { self.removeEventListener('message', onAck); } catch (e) {}
                if (acked) return;
            }
        } catch (e) {}
        return self.registration.showNotification(data.title || 'Nano', (function () {
            var o = {
                body: data.body || '',
                tag: data.tag || ('nano-push-' + Date.now()),
                icon: data.icon || 'icons/icon-192.png',
                badge: data.badge || 'icons/icon-192.png',
                silent: data.silent === true,
                renotify: data.renotify !== false,
                vibrate: [90, 50, 90],
                timestamp: Number(data.ts) || Date.now(),
                data: { target: data.target || '', name: data.name || data.title || '', appId: data.appId || APP_ID }
            };
            if (data.reply && String(data.target || '').indexOf('ss-reply:') === 0) {
                o.actions = [{ action: 'reply', type: 'text', title: '回复', placeholder: '回复 ' + (data.name || data.title || 'TA') + '…' }];
            }
            return o;
        })());
    })());
});

self.addEventListener('notificationclick', function (event) {
    var pdata = event.notification.data || {};
    var ptarget = pdata.target || '';
    // 「通知内直接回复」（Android 网页通知的文本动作）：把文本回传页面，不用打开输入页
    if (event.action === 'reply' && event.reply) {
        event.notification.close();
        var rChat = pdata.chatId || '';
        if (ptarget.indexOf('ss-reply:') === 0) {
            var __sr = ptarget.slice(9);
            var __sc = __sr.indexOf(':');
            rChat = __sc === -1 ? __sr : __sr.slice(0, __sc);
        }
        event.waitUntil(
            self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
                for (var i = 0; i < list.length; i++) {
                    var c = list[i];
                    if ('focus' in c) {
                        try { c.postMessage({ type: 'notifyReply', chatId: rChat, text: String(event.reply) }); } catch (e) {}
                        return c.focus();
                    }
                }
                if (self.clients.openWindow) {
                    return self.clients.openWindow('./index.html?ssreply=' + encodeURIComponent(rChat) + '&sstext=' + encodeURIComponent(String(event.reply)));
                }
            })
        );
        return;
    }
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
            for (var i = 0; i < list.length; i++) {
                var c = list[i];
                if ('focus' in c) {
                    try { c.postMessage({ type: 'notifyOpen', target: ptarget }); } catch (e) {}
                    return c.focus();
                }
            }
            if (self.clients.openWindow) {
                // 应用已被关闭：把目标带在 URL 上，冷启动后 index.html 会自己跳转
                var t = ptarget;
                return self.clients.openWindow('./index.html' + (t ? ('?open=' + encodeURIComponent(t)) : ''));
            }
        })
    );
});
