/* sw.js — 用于 PWA 安装、通知点击聚焦、静态资源加速。
   缓存策略（解决“每次打开都要好几秒”）：
     · HTML：首屏 index.html 先联网（no-store，绕过 GitHub 的 HTTP 缓存），最多等 0.25 秒就先用缓存；
       带 ?v= / ?nb= 的页面（首页 iframe、App 内页都走 nb）内容随构建号变化，直接缓存秒开；
       其余子页面先用缓存秒开，后台静默更新
     · CSS / JS / 图片 / 图标 / 字体：先用缓存秒开；带 ?v= 的直接用缓存，不带版本号的后台静默更新
       —— 改 JS/CSS 时一定要同步改对应的 ?v=，否则会继续命中旧缓存
     · 跨域（CDN）请求不拦截，交给浏览器自己的缓存
   注意：Service Worker 无法在应用被关闭后持续运行 AI 生成，
   “后台回复”依赖页面常驻 + 音频保活；真正的“关闭也能收到”需要服务端配合（见 push 事件）。 */
'use strict';

var CACHE = 'nano-static-v382';
var STATIC_RE = /\.(css|js|png|jpg|jpeg|webp|svg|gif|ico|woff2?|ttf|mp3)$/i;
var HTML_NET_TIMEOUT_MS = 250;        // 首屏 HTML 有缓存时最多等 0.25 秒，超时立刻上缓存

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

function offlinePage() {
    return new Response(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>离线</title><div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:32px 20px;color:#333">' +
        '<h2 style="font-size:18px;margin:0 0 8px">当前网络不可用</h2>' +
        '<p style="font-size:14px;color:#777;margin:0">请检查网络后重试，或返回上一页。</p></div>',
        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
}

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
        // 首屏 index.html 始终先联网，避免旧页面一直压住新构建号；
        // 但只等 0.25 秒，网络慢时立刻用缓存，不再让每次打开都卡 0.7 秒。
        // 子页面（尤其带 ?v= / ?nb= 的 iframe 页面）直接命中缓存秒开：
        // nb 跟随 window.__NANO_BUILD__ 变化，构建号一换就是新缓存键，不会串旧页面。
        // 不带版本号的子页面走「先用缓存，后台静默更新」，下次打开就是最新。
        var isRoot = /\/$/.test(url.pathname) || /\/index\.html?$/i.test(url.pathname);
        var versioned = url.searchParams.has('v') || url.searchParams.has('nb');
        event.respondWith(
            caches.open(CACHE).then(function (cache) {
                return cache.match(req).then(function (cached) {
                    if (cached && versioned) return cached;

                    var network = fetch(req, { cache: 'no-store' }).then(function (res) {
                        try {
                            var h = new Headers(res.headers);
                            h.set('x-nano-at', String(Date.now()));
                            cache.put(req, new Response(res.clone().body, {
                                status: res.status, statusText: res.statusText, headers: h
                            }));
                        } catch (e) {}
                        return res;
                    }).catch(function () { return null; });

                    if (!cached) {
                        return network.then(function (res) {
                            if (res) return res;
                            if (!isRoot) return offlinePage();
                            return caches.match('./index.html').then(function (r) {
                                return r || offlinePage();
                            });
                        });
                    }
                    if (!isRoot) {
                        // 子页面先用缓存显示，网络结果只用来更新缓存，不阻塞进入。
                        event.waitUntil(network.catch(function () {}));
                        return cached;
                    }
                    return Promise.race([
                        network.then(function (res) { return res || cached; }),
                        new Promise(function (resolve) { setTimeout(function () { resolve(cached); }, HTML_NET_TIMEOUT_MS); })
                    ]).catch(function () { return cached; });
                });
            })
        );
        return;
    }

    // JS 采用「先用缓存秒开，后台静默更新」（stale-while-revalidate）：
    // 带 ?v= 的资源是版本化资源，内容不会变，直接命中缓存，不再每次回源；
    // 不带版本号的脚本才在后台静默更新，避免一次打开几十个脚本时把网络占满。
    if (/\.js$/i.test(url.pathname)) {
        event.respondWith(
            caches.open(CACHE).then(function (cache) {
                return cache.match(req).then(function (cached) {
                    if (cached) {
                        if (!url.searchParams.has('v')) {
                            event.waitUntil(fetch(req).then(function (res) {
                                try { if (res && res.status === 200) cache.put(req, res.clone()); } catch (e) {}
                            }).catch(function () {}));
                        }
                        return cached;
                    }
                    return fetch(req).then(function (res) {
                        try { if (res && res.status === 200) cache.put(req, res.clone()); } catch (e) {}
                        return res;
                    }).catch(function () { return cached; });
                });
            })
        );
        return;
    }

    if (!STATIC_RE.test(url.pathname)) return;
    event.respondWith(
        caches.open(CACHE).then(function (cache) {
            return cache.match(req).then(function (cached) {
                // 有缓存就立刻返回，不再等网络（之前会先等最多 700ms，导致每次打开都慢半拍）。
                if (cached) {
                    if (!url.searchParams.has('v')) {
                        event.waitUntil(fetch(req).then(function (res) {
                            try { if (res && res.status === 200) cache.put(req, res.clone()); } catch (e) {}
                        }).catch(function () {}));
                    }
                    return cached;
                }
                return fetch(req).then(function (res) {
                    try { if (res && res.status === 200) cache.put(req, res.clone()); } catch (e) {}
                    return res;
                }).catch(function () { return cached; });
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
