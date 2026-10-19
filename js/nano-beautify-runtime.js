// ============================================================
// nano-beautify-runtime.js — 美化模板的「最高权限」运行时（CSS + JS；JS 也能造 HTML）
// ------------------------------------------------------------
// 美化模板里除了 CSS，还能写脚本块（被脚本包住的部分不当作 CSS）：
//   /* @js
//     // 直接用 mount / $ / $$ / on / observe / el / onCleanup / document / window
//     mount.appendChild(el('div', { style: { position:'fixed', top:'0' } }, ['你好']));
//     onCleanup(() => {});          // 还原时自动执行
//   */
// 点「还原 / 清空」时：清空该区域样式、清空 mount、执行所有 onCleanup，回到初始 UI。
// 区域：global / chat / heart / offline。
//
// 该文件由 appearance.js 按需动态加载；独立页面（如 heart-setting.html）可直接引入。
// ============================================================
(function () {
    'use strict';
    if (window.NanoBeautifyRT) return;
    var registry = {};

    function parse(text) {
        var t = String(text == null ? '' : text);
        var js = '';
        var re = /\/\*\s*@js([\s\S]*?)\*\//gi;
        var m;
        while ((m = re.exec(t))) js += '\n' + m[1];
        var css = t.replace(/\/\*\s*@js[\s\S]*?\*\//gi, '');
        return { css: css, js: js };
    }

    function ensureMount(area, parent) {
        var id = 'nb-mount-' + area;
        var el = document.getElementById(id);
        if (!el) {
            el = document.createElement('div');
            el.id = id;
            el.className = 'nb-mount';
            (parent || document.body || document.documentElement).appendChild(el);
        }
        return el;
    }

    function runCleanups(area) {
        var rec = registry[area];
        if (!rec || !rec.cleanups) return;
        rec.cleanups.forEach(function (fn) { try { fn(); } catch (e) {} });
        rec.cleanups = [];
    }

    function makeEl(tag, props, kids) {
        var el = document.createElement(tag);
        if (props) Object.keys(props).forEach(function (k) {
            var v = props[k];
            if (k === 'style' && v && typeof v === 'object') { try { Object.assign(el.style, v); } catch (e) {} }
            else if (k === 'html') el.innerHTML = v;
            else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
            else if (v != null) el.setAttribute(k, v);
        });
        (Array.isArray(kids) ? kids : (kids != null ? [kids] : [])).forEach(function (c) {
            if (c == null) return;
            el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
        return el;
    }

    // js 为空 = 清空该区域（清 mount + 跑清理）
    function run(area, js, opts) {
        opts = opts || {};
        runCleanups(area);
        var mount = ensureMount(area, opts.mountParent);
        try { mount.innerHTML = ''; } catch (e) {}
        registry[area] = registry[area] || { cleanups: [] };
        registry[area].mount = mount;
        var code = String(js == null ? '' : js);
        if (!code.trim()) return false;
        var ctx = {
            area: area,
            mount: mount,
            document: document,
            window: window,
            root: document,
            body: document.body,
            onCleanup: function (fn) { if (typeof fn === 'function') registry[area].cleanups.push(fn); },
            on: function (target, ev, fn, o) {
                try {
                    target.addEventListener(ev, fn, o);
                    registry[area].cleanups.push(function () { try { target.removeEventListener(ev, fn, o); } catch (e) {} });
                } catch (e) {}
            },
            $: function (sel, root) { return (root || mount).querySelector(sel); },
            $$: function (sel, root) { return Array.prototype.slice.call((root || mount).querySelectorAll(sel || '*')); },
            el: makeEl,
            observe: function (target, cb, o) {
                try {
                    var mo = new MutationObserver(cb);
                    mo.observe(target, o || { childList: true, subtree: true });
                    registry[area].cleanups.push(function () { try { mo.disconnect(); } catch (e) {} });
                    return mo;
                } catch (e) { return null; }
            },
            log: function () { try { console.log.apply(console, ['[Beautify:' + area + ']'].concat([].slice.call(arguments))); } catch (e) {} }
        };
        try {
            (new Function('ctx', 'with(ctx){\n' + code + '\n}'))(ctx);
            return true;
        } catch (e) {
            try { console.warn('[Beautify:' + area + '] JS 出错：', e && e.message ? e.message : e); } catch (e2) {}
            return false;
        }
    }

    function clear(area) {
        runCleanups(area);
        var mount = document.getElementById('nb-mount-' + area);
        if (mount) { try { mount.innerHTML = ''; } catch (e) {} }
    }

    window.NanoBeautifyRT = { parse: parse, run: run, clear: clear, mountId: function (a) { return 'nb-mount-' + a; } };
})();
