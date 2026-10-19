/* ============================================================
   refresh-notify.js — 跨页面「刷新成功 / 刷新失败」提示（子页面侧）

   作用：任何页面在后台刷新完成后，通知主框架（index.html）弹提示：
     · 失败：不管用户当前在哪个页面都弹出错误提示
     · 成功且用户已经不在这个页面：弹出「刷新成功」+「去看看」（点击回到该页面）
     · 聊天类（私聊/群聊/一起听/一起看/ins/halo 聊天）成功时不要弹窗
       —— 传 chat:true 即可，主框架会自动跳过（那些已有通知+提示音）

   用法（放在页面自己脚本之前/之后都行，只在点击刷新时调用）：
     NanoRefresh.define({ id:'phone', name:'手机', url:'phone.html', title:'手机' });
     NanoRefresh.start({ key:'gen', label:'生成' });                 // 刷新开始
     NanoRefresh.success('已生成 3 个 App 的内容', { key:'gen' });    // 刷新成功
     NanoRefresh.fail(err, { key:'gen' });                          // 刷新失败（err 可以是 Error 或字符串）
     NanoRefresh.start({ key:'dm', label:'私信', chat:true });        // 聊天类：成功不会弹窗

   说明：
   · 只做提示，不改任何生成/刷新逻辑；页面内的 toast / 弹窗照旧
   · 不在 iframe 里（单独打开页面）时什么都不做
   ============================================================ */
(function () {
    'use strict';

    var def = { id: '', name: '', url: '', title: '', chat: false, source: '' };

    function build(opts) {
        opts = opts || {};
        return {
            id: def.id,
            name: opts.name || def.name,
            url: opts.url || def.url,
            title: opts.title || def.title || def.name,
            source: opts.source || def.source || '',
            chat: (opts.chat === undefined) ? !!def.chat : !!opts.chat,
            key: opts.key || opts.label || 'main',
            label: opts.label || ''
        };
    }

    function post(msg) {
        try {
            if (window.parent === window) return;      // 不是 iframe，无法提示
            msg.type = 'nanoRefresh';
            window.parent.postMessage(msg, '*');
        } catch (e) {}
    }

    function bodyOf(err) {
        if (err == null) return '';
        if (typeof err === 'string') return err;
        if (err.message) return String(err.message);
        try { return JSON.stringify(err); } catch (e) { return String(err); }
    }

    window.NanoRefresh = {
        define: function (meta) {
            if (meta) {
                for (var k in meta) {
                    if (Object.prototype.hasOwnProperty.call(meta, k)) def[k] = meta[k];
                }
            }
            return window.NanoRefresh;
        },
        start: function (opts) {
            var m = build(opts);
            m.phase = 'start';
            post(m);
            return m;
        },
        success: function (body, opts) {
            var m = build(opts);
            m.phase = 'success';
            m.body = (typeof body === 'string') ? body : '';
            post(m);
        },
        fail: function (err, opts) {
            var m = build(opts);
            m.phase = 'fail';
            m.body = bodyOf(err);
            post(m);
        },
        // 便捷写法：NanoRefresh.run(() => doRefresh(), { key:'gen', label:'生成' })
        run: function (fn, opts) {
            var self = window.NanoRefresh;
            var o = opts || {};
            self.start(o);
            return Promise.resolve()
                .then(fn)
                .then(function (r) {
                    self.success(typeof r === 'string' ? r : '', o);
                    return r;
                }, function (e) {
                    self.fail(e, o);
                    throw e;
                });
        }
    };
})();
