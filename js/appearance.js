// ============================================================
// appearance.js — 美化应用端（每个 Nano 页面都会加载）
// 功能：
//   1. 全局 CSS（beautify_global）注入到非聊天内页，覆盖 index/chat/API/moments/more 等页面 UI
//   2. 聊天 CSS（beautify_chat）注入到单聊/群聊内页（顶栏/底栏/气泡/转账/礼物/语音/通话卡片/引用等）
//   3. 全局字体（beautify_font）应用到所有 Nano 页面
//   4. 监听来自父框架(beautify)的实时消息，立即生效
// beautify 编辑页自身不加载本文件（由 beautify.js 管理自己的编辑器样式与字体）。
// ============================================================

// ============================================================
// NanoBeautifyRT — 美化模板的「最高权限」运行时（CSS + JS；JS 也能造 HTML）
// ------------------------------------------------------------
// 美化模板里除了 CSS，还能写脚本块（被脚本包住的部分不当作 CSS）：
//   /* @js
//     // 直接用 mount / $ / $$ / on / observe / el / onCleanup / document / window
//     const box = el('div', { style: { position:'fixed', top:'0' } }, ['你好']);
//     mount.appendChild(box);
//     onCleanup(() => box.remove());          // 还原时自动执行
//   */
// 点「还原 / 清空」时：清空该区域样式、清空 mount、执行所有 onCleanup，回到初始 UI。
// 区域：global / chat / heart / offline。
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

// ============================================================
(function() {
    'use strict';

    // 全局思维链清洗：各页面在渲染模型回复前调用，彻底移除 [think]/<thinking>/【思考】等标记与内容。
    // 兼容成对、未闭合、残缺标记，以及 thinking/thought/reasoning/analysis/cot 等变体。
    window.nanoStripThink = function (raw) {
        var s = String(raw == null ? '' : raw);
        var W = 'think(?:ing)?|thought|reasoning|analysis|cot|思考|思维链';
        try {
            s = s.replace(new RegExp('\\[\\s*(?:' + W + ')\\s*:[\\s\\S]*?\\]', 'gi'), ' ');
            s = s.replace(new RegExp('\\[\\s*(?:' + W + ')\\s*\\]([\\s\\S]*?)\\[\\s*\\/\\s*(?:' + W + ')\\s*\\]', 'gi'), ' ');
            s = s.replace(new RegExp('<\\s*(?:' + W + ')\\s*>([\\s\\S]*?)<\\s*\\/\\s*(?:' + W + ')\\s*>', 'gi'), ' ');
            s = s.replace(new RegExp('【\\s*(?:' + W + ')\\s*】([\\s\\S]*?)【\\s*\\/\\s*(?:' + W + ')\\s*】', 'gi'), ' ');
            s = s.replace(new RegExp('\\[\\s*(?:' + W + ')\\s*\\]([\\s\\S]*)$', 'i'), ' ');
            s = s.replace(new RegExp('<\\s*(?:' + W + ')\\s*>([\\s\\S]*)$', 'i'), ' ');
            s = s.replace(new RegExp('\\[\\s*\\/?\\s*(?:' + W + ')\\s*\\]', 'gi'), ' ');
            s = s.replace(new RegExp('【\\s*\\/?\\s*(?:' + W + ')\\s*】', 'gi'), ' ');
            s = s.replace(new RegExp('<\\s*\\/?\\s*(?:' + W + ')\\s*>', 'gi'), ' ');
            s = s.replace(/^[ \t]*[\/]?[ \t]*think[ \t]*$/gim, '');
        } catch (e) {}
        return s.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+$/gm, '').trim();
    };

    var fileName = '';
    try {
        fileName = (window.location.pathname.split('/').pop() || '').split('?')[0];
    } catch (e) {}
    // 以目录/根路径打开时 pathname 末尾为空，其文档其实就是 index.html
    if (!fileName || fileName === '/') fileName = 'index.html';
    // beautify 编辑器页面不走这套自注入（避免用户全局 CSS 把编辑器 UI 弄乱）
    if (fileName === 'beautify.html') return;

    // 聊天内页：单聊(chat_inner) / 群聊(groups) 需要注入「聊天 CSS」
    var isChatInterior = fileName === 'chat_inner.html' ||
        fileName.indexOf('groups') === 0;
    function isNanoChatPage() {
        if (fileName !== 'chat_inner.html') return false;
        try {
            var c = new URLSearchParams(location.search).get('chat') || '';
            return c === 'nano_ai' || c.indexOf('nano_ai_') === 0;
        } catch (e) { return false; }
    }

    function getEl(id) {
        return document.getElementById(id);
    }

    // 追加/替换一个 <style>；css 为空则移除旧标签
    function applyStyle(id, css) {
        var old = getEl(id);
        if (!css || !String(css).trim()) {
            if (old && old.parentNode) old.parentNode.removeChild(old);
            return;
        }
        if (old) {
            old.textContent = css;
            return;
        }
        var st = document.createElement('style');
        st.id = id;
        st.textContent = css;
        // 放到 body 末尾，保证晚于各页面自身样式（含 body 内的 style），从而能覆盖原 UI
        var host = document.body || document.head || document.documentElement;
        host.appendChild(st);
    }

    // 运行美化模板里的 @js 脚本块（模板文本里除脚本外的部分仍按 CSS 处理）
    function runBeautifyJs(area, raw) {
        try {
            if (!window.NanoBeautifyRT) return;
            var parsed = window.NanoBeautifyRT.parse(raw || '');
            window.NanoBeautifyRT.run(area, parsed.js, { mountParent: document.body });
        } catch (e) {}
    }
    // 只取模板里的 CSS 部分（去掉 @js 脚本块），避免脚本内容被 CSS 迁移规则误改
    function cssOnly(raw) {
        try { return window.NanoBeautifyRT ? window.NanoBeautifyRT.parse(raw || '').css : (raw || ''); }
        catch (e) { return raw || ''; }
    }

    // 统一隐藏滚动条（保留滚动能力），避免右侧出现"侧边栏"
    try {
        applyStyle('nano-hide-scrollbar',
            'html,body,*{scrollbar-width:none !important;-ms-overflow-style:none !important;}' +
            'html::-webkit-scrollbar,body::-webkit-scrollbar,*::-webkit-scrollbar{width:0 !important;height:0 !important;display:none !important;}');
    } catch (e) {}

    // 全局 CSS 只作用于：index / chat（列表+内页+群聊） / discover / more
    // 其他功能页保持不动，避免被全局样式误改
    var GLOBAL_TARGET_PAGES = [
        'index.html', 'home.html', 'chat.html', 'chat_inner.html', 'groups.html',
        'group-chat.html', 'discover.html', 'api.html'
    ];
    function isGlobalTargetPage() {
        return GLOBAL_TARGET_PAGES.indexOf(fileName) !== -1;
    }
    function applyGlobalCss(css) {
        if (!isGlobalTargetPage()) return;
        // 纳米助手使用专属主题，不跟随全局/聊天美化
        if (isNanoChatPage()) return;
        applyStyle('nano-beautify-global', css || '');
        reorderChatLayers();
        bringAvatarToFront();
    }

    // 头像样式永远放最后，优先级最高（否则头像框会被聊天/全局 CSS 盖掉）
    function bringAvatarToFront() {
        var a = getEl('nano-beautify-chat-avatar');
        if (a && a.parentNode) a.parentNode.appendChild(a);
    }

    // 结构修复：撤回 / 系统提示 / 居中卡片一律居中。
    // 行本身同时带 left/right 与 centered/recalled/sys-notice，若自定义 CSS 把
    // .left/.right 写在居中规则之后会覆盖居中；这里用 !important 兜底，保证永远居中。
    var CHAT_STRUCT_FIX =
        '.message-row.tip-row-wrap,.message-row.centered,.message-row.recalled,' +
        '.message-row.sys-notice{justify-content:center !important;}' +
        '.message-row.tip-row-wrap .message-avatar,.message-row.centered .message-avatar,' +
        '.message-row.recalled .message-avatar,.message-row.sys-notice .message-avatar' +
        '{display:none !important;}' +
        '.message-row.centered .message-content,.message-row.sys-notice .message-content' +
        '{max-width:88%;align-items:center;}' +
        // 撤回消息：外层行、内容盒、气泡全部居中，避免因 left/right 的 align-items 造成偏左
        '.message-row.recalled{flex-direction:row !important;}' +
        '.message-row.recalled .message-content{max-width:100% !important;width:100% !important;' +
        'align-items:center !important;justify-content:center !important;margin:0 auto !important;flex:1 1 auto !important;}' +
        '.message-row.recalled .recall-notice{margin-left:auto !important;margin-right:auto !important;}' +
        // 结构：顶栏贴安全区（不留空隙），底栏避让底部小白条；可用下面两个变量 DIY
        // 注意：不要在这里强制 background:transparent —— 那会盖掉用户在「聊天美化」里设置的
        // 顶栏/底栏背景色（无论加多少 !important 都改不出白底）。背景交给用户 CSS 决定。
        '.chat-container>.topbar{padding-top:var(--chat-topbar-pad,var(--safe-top,0px)) !important;}' +
        '.bottom-bar{padding-bottom:var(--chat-bottom-pad,max(12px,var(--nano-safe-bottom,env(safe-area-inset-bottom,0px)))) !important;}' +
        // 键盘弹出时底部安全区（Home 条）被键盘盖住，不再需要留白，避免输入栏被顶到键盘外看不到字
        'html.keyboard-open .bottom-bar{padding-bottom:8px !important;}';

    // 悬浮顶/底栏结构（!important 强制）：消息区铺满整屏，顶/底栏悬浮其上且默认透明，
    // 气泡滑动时会从栏的下方穿过、清晰可见。美化的聊天 CSS 里常把 .message-scroll 写回
    // flex:1、给 .topbar 加玻璃底，会破坏这个结构，所以这里用高优先级 + !important 兜底。
    // 想给顶/底栏加遮罩：在聊天 CSS 里设置变量即可（默认透明）：
    //   :root{ --chat-topbar-mask: linear-gradient(#fff 60%, transparent); }
    //   :root{ --chat-bottom-mask: linear-gradient(transparent, #fff 40%); }
    // 单聊(chat-inner) 与 群聊(groups) 共用同一套悬浮结构；群聊额外的群公告条也一起悬浮，
    // 避免它继续占用文档流把气泡顶下去、或被美化 CSS 打乱层级。
    // 注意：这里必须把每段选择器都补全成两个完整选择器（不能只写 "body.a,body.b .x"，否则第一段会选中 body 本身）。
    var NANO_FLOAT_SEL = function (part) {
        return 'body.nano-chat-inner ' + part + ',body.nano-groups ' + part;
    };
    var NANO_CHAT_FLOAT_CSS =
        NANO_FLOAT_SEL('.message-scroll') + '{' +
        'position:absolute !important;top:0 !important;left:0 !important;right:0 !important;bottom:0 !important;' +
        'flex:none !important;z-index:1 !important;background:transparent !important;' +
        'padding-top:calc(var(--chat-top-inset,60px) + var(--chat-top-extra,8px)) !important;' +
        'padding-bottom:calc(var(--chat-bottom-inset,72px) + var(--chat-bottom-extra,14px)) !important;}' +
        NANO_FLOAT_SEL('.topbar') + '{' +
        'position:absolute !important;top:0 !important;left:0 !important;right:0 !important;width:auto !important;' +
        'z-index:30 !important;flex-shrink:0 !important;pointer-events:none !important;}' +
        // 底色用 :where() 降到 0 优先级、且不加 !important：
        // 默认取变量 --chat-topbar-mask（透明），美化里既能改这个变量，
        // 也能直接写 .topbar{background:#fff} 覆盖（和线下一致，不再被悬浮层压住）。
        ':where(' + NANO_FLOAT_SEL('.topbar') + '){background:var(--chat-topbar-mask,transparent);}' +
        NANO_FLOAT_SEL('.topbar > *') + '{pointer-events:auto !important;}' +
        NANO_FLOAT_SEL('.multi-select-bar') + '{' +
        'position:absolute !important;top:var(--chat-topbar-h,60px) !important;' +
        'left:12px !important;right:12px !important;margin:0 !important;z-index:31 !important;}' +
        NANO_FLOAT_SEL('.bottom-bar') + '{' +
        'position:absolute !important;left:0 !important;right:0 !important;bottom:0 !important;width:auto !important;' +
        'z-index:40 !important;flex-shrink:0 !important;pointer-events:none !important;}' +
        ':where(' + NANO_FLOAT_SEL('.bottom-bar') + '){background:var(--chat-bottom-mask,transparent);}' +
        NANO_FLOAT_SEL('.bottom-bar > *') + '{pointer-events:auto !important;}' +
        'body.nano-groups .group-notice-bar{' +
        'position:absolute !important;top:var(--chat-topbar-h,60px) !important;' +
        'left:12px !important;right:12px !important;margin:0 !important;z-index:29 !important;}';

    // 层叠顺序（决定覆盖优先级）：聊天CSS -> 结构修复 -> 全局CSS -> 悬浮结构 -> 底栏留白 -> 头像
    function reorderChatLayers() {
        try {
            var host = document.body || document.head || document.documentElement;
            ['nano-beautify-chat', 'nano-beautify-chat-fix', 'nano-beautify-global', 'nano-chat-float', 'nano-flush-fix']
                .forEach(function (id) {
                    var el = getEl(id);
                    if (el && el.parentNode === host) host.appendChild(el);
                });
        } catch (e) {}
    }

    // 旧版卡片美化（.card-main / .icon-wrap / .card-title / .card-sub）是按
    // 「图标 + 文字横向长方形」写的；新初始模板默认竖向居中。检测到旧选择器时
    // 补一层兼容布局，让之前保存的美化继续按长方形显示。
    function legacyCardCompatCss(css) {
        var s = String(css || '');
        // 只给「旧版长方形卡片」补结构：必须有 .card-main/.card-title/.card-sub，
        // 且没有新版 .card-header。新版初始模板不动，保持黑灰状态栏样式。
        if (!/\.bubble-card[^{}]*\.(card-main|card-title|card-sub)/.test(s)) return '';
        if (/\.bubble-card[^{}]*\.card-header/.test(s)) return '';
        var inGroups = !!(document.body && document.body.classList.contains('nano-groups'));
        var hasChatScope = /\.nano-chat-inner\b/.test(s);
        var hasGroupsScope = /\.nano-groups\b/.test(s);
        if (inGroups && hasChatScope && !hasGroupsScope) return '';
        if (!inGroups && hasGroupsScope && !hasChatScope) return '';
        var scope = inGroups ? '.nano-groups ' : '.nano-chat-inner ';
        return scope + '.bubble-card{box-shadow:var(--card-shadow,none);border:var(--card-border,0);}' +
            scope + '.bubble-card .card-header{display:none!important;}' +
            scope + '.bubble-card .info-section{display:none!important;}' +
            scope + '.bubble-card .main-section.card-main{display:flex;flex-direction:row;align-items:center;text-align:left;gap:10px;padding:12px;border-bottom:0;}' +
            scope + '.bubble-card .main-text{display:flex;flex-direction:column;flex:1;min-width:0;align-items:flex-start;gap:2px;}' +
            scope + '.bubble-card .main-icon,' + scope + '.bubble-card .icon-wrap{margin:0;flex-shrink:0;}' +
            scope + '.bubble-card .message-box.card-note{background:transparent;margin:0;padding:0 14px 10px;max-height:none;border-radius:0;font-size:12px;color:inherit;opacity:.8;}';
    }

    function grayPinkTakeoutFix(css) {
    var s = String(css || '');
    // 已保存的旧灰粉模板：补成新版灰粉方卡（上方餐品/店铺/价格，小字备注在地图上方，下方小地图 + 到达时间）
    if (!/--gp-ink|--gp-pink|灰粉对话|gray-pink|#f9d5e0/i.test(s)) return '';
    return '.nano-chat-inner .bubble-card.takeout{display:flex!important;flex-direction:column!important;width:206px!important;max-width:206px!important;min-height:188px!important;background:linear-gradient(180deg,#fffdfd 0%,#faf2f5 100%)!important;border:0.5px solid #eadde3!important;border-radius:18px!important;box-shadow:0 8px 24px rgba(150,120,135,.12)!important;color:#4a4a4a!important;font-size:12px!important;overflow:hidden!important;}' +
        '.nano-chat-inner .bubble-card.takeout .main-section{order:1!important;padding:11px 12px 8px!important;gap:9px!important;border-bottom:0!important;}' +
        '.nano-chat-inner .bubble-card.takeout .main-icon,.nano-chat-inner .bubble-card.takeout .icon-wrap{width:34px!important;height:34px!important;border-radius:11px!important;background:#f7e4ea!important;color:#b97e91!important;}' +
        '.nano-chat-inner .bubble-card.takeout .main-title{font-size:14.5px!important;font-weight:700!important;line-height:1.3!important;color:#4a4a4a!important;white-space:normal!important;}' +
        '.nano-chat-inner .bubble-card.takeout .main-sub{margin-top:2px!important;font-size:11px!important;font-weight:600!important;color:#b97e91!important;}' +
        '.nano-chat-inner .bubble-card.takeout .info-section{display:none!important;}' +
        '.nano-chat-inner .bubble-card.takeout .takeout-map{order:3!important;height:84px!important;margin:0 12px 8px!important;border-radius:14px!important;border:1px solid #ecdde3!important;background:repeating-linear-gradient(0deg,rgba(189,131,149,.08) 0 1px,transparent 1px 15px),repeating-linear-gradient(90deg,rgba(189,131,149,.08) 0 1px,transparent 1px 15px),linear-gradient(145deg,#fdf5f8,#f4e7ec 60%,#f9f0f3)!important;}' +
        '.nano-chat-inner .bubble-card.takeout .tm-route{left:14%!important;top:63%!important;width:60%!important;height:2px!important;background:linear-gradient(90deg,rgba(185,126,145,.18),rgba(185,126,145,.68))!important;transform:rotate(-16deg)!important;}' +
        '.nano-chat-inner .bubble-card.takeout .tm-route::after{background:#b97e91!important;box-shadow:0 0 0 3px rgba(185,126,145,.16)!important;}' +
        '.nano-chat-inner .bubble-card.takeout .tm-pin{background:#b97e91!important;box-shadow:0 2px 6px rgba(150,90,110,.25)!important;}' +
        '.nano-chat-inner .bubble-card.takeout .tm-eta{color:#7e4f60!important;font-size:11.5px!important;}' +
        '.nano-chat-inner .bubble-card.takeout .tm-status{color:#9a7482!important;background:rgba(255,255,255,.72)!important;font-size:10px!important;}' +
        '.nano-chat-inner .bubble-card.takeout .message-box{order:2!important;display:block!important;margin:0 12px 7px!important;padding:4px 8px!important;border:1px dashed #e8d3db!important;border-radius:9px!important;background:#fff9fb!important;color:#9a7886!important;font-size:10px!important;line-height:1.4!important;}' +
        '.nano-chat-inner .bubble-card.takeout .card-footer{order:4!important;padding:0 10px 9px!important;}' +
        '.nano-chat-inner .bubble-card.takeout .card-footer-text{color:#a1838e!important;font-size:10px!important;}';
}
function applyChatCss(css) {
        // 聊天 CSS 仅作用于单聊/群聊内页（额外的聊天专用覆盖）
        if (!isChatInterior) return;
        if (isNanoChatPage()) {
            // Nano 专属主题：清掉用户聊天/全局美化，只保留必要的浮动结构与安全区修正
            applyStyle('nano-beautify-chat', '');
            applyStyle('nano-beautify-chat-fix', CHAT_STRUCT_FIX);
            applyStyle('nano-chat-float', NANO_CHAT_FLOAT_CSS);
            reorderChatLayers();
            return;
        }
        applyStyle('nano-beautify-chat', css || '');
        applyStyle('nano-beautify-chat-fix', CHAT_STRUCT_FIX + legacyCardCompatCss(css) + grayPinkTakeoutFix(css));
        applyStyle('nano-chat-float', NANO_CHAT_FLOAT_CSS);
        reorderChatLayers();
        // 通知聊天页：模板 CSS 已更新（例如 --nano-trans-separate 改变了翻译 DOM 结构）
        try { window.dispatchEvent(new CustomEvent('nano-chat-theme-applied')); } catch (e) {}
        // 头像样式始终放最后，保证头像框不被聊天/全局 CSS 盖掉
        bringAvatarToFront();
    }

    // 头像「方圆 / 大小」调节（美化页滑杆生成，作用聊天内页；优先级高于聊天 CSS）
    function applyChatAvatarCss(css) {
        if (!isChatInterior) return;
        if (isNanoChatPage()) return;
        applyStyle('nano-beautify-chat-avatar', css || '');
        // 头像样式必须放在最后，优先级高于聊天 CSS / 全局 CSS，否则头像框会被后面的样式盖掉
        bringAvatarToFront();
        // 强制一次重排：应用美化模板后 iOS Safari 才会重新合成、显示头像框
        try { void (document.body && document.body.offsetHeight); } catch (e) {}
        applyFrameElements();
    }

    // 头像框不再依赖 ::after（会被模板的 overflow/z-index 裁切或盖住），改为给每个头像
    // 插入一个「真实叠加元素」<span class="nano-avatar-frame">，用行内样式画框。
    function getFrameConfig() {
        try {
            var raw = localStorage.getItem('nano_avatar_frame');
            if (raw) {
                var o = JSON.parse(raw);
                if (o && String(o.url || '').trim()) return o;
            }
        } catch (e) {}
        try {
            var cfg = JSON.parse(localStorage.getItem('beautify_chat_avatar_cfg') || 'null');
            if (cfg && String(cfg.frameUrl || '').trim()) {
                return { url: cfg.frameUrl, scale: cfg.frameScale, radius: cfg.radius, size: cfg.size };
            }
        } catch (e) {}
        // 兜底：从旧的/纳米写入的 CSS 字符串里解析头像框地址
        try {
            var css = localStorage.getItem('beautify_chat_avatar') || '';
            if (/::after/i.test(css)) {
                var m = css.match(/url\(["']?([^"')]+)["']?\)/i);
                if (m && m[1]) {
                    var sm = css.match(/top\s*:\s*(-?\d+)%/i) || css.match(/left\s*:\s*(-?\d+)%/i);
                    return { url: m[1], scale: sm ? Math.abs(parseInt(sm[1], 10)) : 16 };
                }
            }
        } catch (e) {}
        return null;
    }

    // 只用 CSS 负责「方圆 / 大小」；头像框由真实元素负责
    function buildAvatarCssFromCfg() {
        var cfg = null;
        try { cfg = JSON.parse(localStorage.getItem('beautify_chat_avatar_cfg') || 'null'); } catch (e) {}
        if (!cfg) return '';
        var r = (typeof cfg.radius === 'number' ? cfg.radius : 50) + '%';
        var s = (typeof cfg.size === 'number' ? cfg.size : 36) + 'px';
        var avs = [
            'html body.nano-chat-inner .message-avatar',
            'html body.nano-groups .message-avatar',
            'html body.nano-chat-inner .typing-indicator .ti-avatar',
            'html body.nano-groups .typing-indicator .ti-avatar'
        ];
        var avImgs = avs.map(function (x) { return x + ' img'; });
        return avs.join(',') + '{border-radius:' + r + ' !important;width:' + s + ' !important;height:' + s + ' !important;}'
            + avImgs.join(',') + '{border-radius:' + r + ' !important;}';
    }

    // 头像框图片预加载 + 失败重试（避免「转几秒然后空白」）
    var _frameImg = { url: '', ok: false, down: false, tries: 0, work: '' };
    function preloadFrame(url) {
        if (!url) return;
        if (_frameImg.url === url && (_frameImg.ok || _frameImg.down)) return;
        _frameImg = { url: url, ok: false, down: false, tries: 0, work: url };
        var attempt = function () {
            var img = new Image();
            img.decoding = 'async';
            var bust = _frameImg.tries > 0 ? (url + (url.indexOf('?') === -1 ? '?' : '&') + 'nr=' + _frameImg.tries) : url;
            img.onload = function () {
                _frameImg.ok = true;
                _frameImg.work = bust;
                applyFrameElements(true); // 用可用的地址重画一次
            };
            img.onerror = function () {
                _frameImg.tries++;
                if (_frameImg.tries < 3) setTimeout(attempt, 600 * _frameImg.tries);
                else { _frameImg.down = true; }
            };
            try { img.src = bust; } catch (e) {}
        };
        attempt();
    }

    function findFrameChild(node) {
        for (var c = 0; c < node.children.length; c++) {
            if (node.children[c] && node.children[c].className === 'nano-avatar-frame') return node.children[c];
        }
        return null;
    }

    var _frameSig = '';
    function applyFrameElements(force) {
        if (!isChatInterior) return;
        var fc = getFrameConfig();
        var nodes;
        try { nodes = document.querySelectorAll('.message-avatar, .typing-indicator .ti-avatar'); } catch (e) { return; }
        var sig = fc ? (String(fc.url) + '|' + fc.scale + '|' + (_frameImg.url === String(fc.url) ? _frameImg.work : '')) : '';
        var sigChanged = (sig !== _frameSig);
        if (sigChanged) _frameSig = sig;
        if (fc) preloadFrame(String(fc.url));
        var srcUrl = (fc && _frameImg.url === String(fc.url) && _frameImg.work) ? _frameImg.work : (fc ? String(fc.url) : '');
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var existing = findFrameChild(node);
            if (!fc) {
                if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
                try { if (node.style.overflow) node.style.removeProperty('overflow'); if (node.style.position) node.style.removeProperty('position'); } catch (e) {}
                continue;
            }
            // 已处理过、配置没变、且节点已有框：直接跳过，避免每次 DOM 变动都重写样式导致卡顿
            if (!force && !sigChanged && existing && existing.dataset.sig === sig) continue;
            var scale = parseInt(fc.scale, 10);
            if (isNaN(scale)) scale = 16;
            scale = Math.max(0, Math.min(60, scale));
            var inset = -scale;
            var url = String(srcUrl).replace(/"/g, '%22').replace(/\)/g, '%29');
            var el = existing || document.createElement('span');
            el.className = 'nano-avatar-frame';
            el.setAttribute('aria-hidden', 'true');
            el.dataset.sig = sig;
            el.style.cssText = 'position:absolute !important;display:block !important;'
                + 'top:' + inset + '% !important;right:' + inset + '% !important;bottom:' + inset + '% !important;left:' + inset + '% !important;'
                + 'background-image:url("' + url + '") !important;background-position:center center !important;'
                + 'background-size:contain !important;background-repeat:no-repeat !important;'
                // 头像框不受「头像方圆 / 头像大小」影响：不继承圆角，只由「框大小」决定缩放
                + 'border-radius:0 !important;overflow:visible !important;'
                + 'pointer-events:none !important;z-index:2147483000 !important;';
            if (!existing) node.appendChild(el);
            try {
                node.style.setProperty('overflow', 'visible', 'important');
                node.style.setProperty('position', 'relative', 'important');
            } catch (e) {}
            // 原头像内容保持圆形
            var kids = node.querySelectorAll('img, span');
            for (var k = 0; k < kids.length; k++) {
                if (kids[k] === el) continue;
                try { kids[k].style.setProperty('border-radius', 'inherit', 'important'); } catch (e) {}
            }
        }
    }

    var _avatarObserver = null;
    function watchAvatars() {
        if (!isChatInterior || _avatarObserver || typeof MutationObserver === 'undefined') return;
        var scheduled = false;
        _avatarObserver = new MutationObserver(function () {
            if (scheduled) return;
            scheduled = true;
            setTimeout(function () { scheduled = false; applyFrameElements(); }, 60);
        });
        try { _avatarObserver.observe(document.body || document.documentElement, { childList: true, subtree: true }); } catch (e) {}
    }

    function readCss(key) {
        try {
            var v = localStorage.getItem(key);
            return typeof v === 'string' ? v : '';
        } catch (e) { return ''; }
    }

    // 旧版全局模板的两处安全区问题，就地修正已保存的 CSS：
    //   1) 底栏写死 bottom:28px，iOS 上离底部过高 → 改成随安全区自适应
    //   2) 顶栏 padding 未包含安全区，按钮被灵动岛遮住 → 补上 safe-inset-top
    function migrateGlobalCss(css) {
        if (!css) return css;
        var fixed = css;
        if (fixed.indexOf('.bottom-actions') !== -1 && fixed.indexOf('justify-content: space-between') !== -1) {
            fixed = fixed.replace(/(\.bottom-actions\s*\{[^}]*?)justify-content:\s*space-between;/m, '$1justify-content: center;');
        }
        if (fixed.indexOf('.bottom-actions') !== -1) {
            fixed = fixed.replace(/(\.bottom-actions\s*\{[^}]*?)bottom\s*:[^;]*;/m, '$1bottom: 0;');
        }
        if (fixed.indexOf('.overlay-header') !== -1) {
            fixed = fixed.replace(/(\.overlay-header\s*\{[^}]*?)padding\s*:\s*14px\s+0\s+12px\s+0\s*;/m, '$1padding: calc(14px + var(--safe-inset-top, 0px)) 0 12px 0;');
        }
        // 旧版聊天底栏把选中态背景画在 flex:1 的按钮上：宽屏近似正圆，
        // 窄屏按钮被压扁就成了椭圆。这里固定成 46×46 的正方形，选中态永远是正圆。
        if (fixed.indexOf('.dock-btn') !== -1 && fixed.indexOf('/* dock-selected-circle-fix */') === -1) {
            fixed += '\n/* dock-selected-circle-fix */\n' +
                '.nano-chat .dock{justify-content:space-around !important;gap:0 !important;}\n' +
                '.nano-chat .dock-btn{flex:0 0 46px !important;width:46px !important;min-width:46px !important;max-width:46px !important;height:46px !important;border-radius:50% !important;}\n' +
                '.nano-chat .dock-btn.active::before,.nano-chat .dock-btn:not(.active):active::before{width:46px !important;height:46px !important;border-radius:50% !important;}\n';
        }
        if (fixed !== css) {
            try {
                localStorage.setItem('beautify_global_v2', fixed);
                localStorage.setItem('beautify_global', fixed);
            } catch (e) {}
        }
        return fixed;
    }

    // 旧版聊天模板：气泡偏大偏宽、底栏底部留白过多，就地修正已保存的聊天 CSS
    function migrateChatCss(css) {
        if (!css) return css;
        var fixed = css;
        // 老版初始模板把尾巴藏在 .grouped 上，导致「第一条有尾巴、后面没有」。
        // 渲染层现在会给每行打 .tail-end（同侧连发的最后一条），这里把老 CSS 迁移成
        // 只显示 tail-end 的尾巴；新模板本身已经使用该规则。
        var tailBlock = [
            '.nano-chat-inner .bubble.other::after,',
            '.nano-chat-inner .bubble.me::after{display:none;}',
            '.nano-chat-inner .message-row.tail-end .bubble.other::after,',
            '.nano-chat-inner .message-row.tail-end .bubble.me::after{display:block;}',
            '.nano-chat-inner .voice-bubble.left::before,',
            '.nano-chat-inner .voice-bubble.right::before{display:none;}',
            '.nano-chat-inner .message-row.tail-end .voice-bubble.left::before,',
            '.nano-chat-inner .message-row.tail-end .voice-bubble.right::before{display:block;}'
        ].join('');
        var groupTailBlock = [
            '.nano-groups .bubble.other::after,',
            '.nano-groups .bubble.me::after{display:none;}',
            '.nano-groups .message-row.tail-end .bubble.other::after,',
            '.nano-groups .message-row.tail-end .bubble.me::after{display:block;}',
            '.nano-groups .voice-bubble.left::before,',
            '.nano-groups .voice-bubble.right::before{display:none;}',
            '.nano-groups .message-row.tail-end .voice-bubble.left::before,',
            '.nano-groups .message-row.tail-end .voice-bubble.right::before{display:block;}'
        ].join('');
        fixed = fixed.replace(/\.nano-chat-inner\s+\.bubble\.grouped::after\s*\{[^}]*display\s*:\s*none;?\s*\}/g, tailBlock);
        fixed = fixed.replace(/\.nano-groups\s+\.bubble\.grouped::after\s*\{[^}]*display\s*:\s*none;?\s*\}/g, groupTailBlock);
        if (fixed !== css) {
            try {
                localStorage.setItem('beautify_chat_v2', fixed);
                localStorage.setItem('beautify_chat', fixed);
            } catch (e) {}
        }
        // 新版聊天模板（通用卡片：.bubble-card .card-header）不再套用旧版缩小规则，
        // 否则「还原初始模板」后刷新会被改回 6/11/15，和初始 UI 不一致。
        if (/\.nano-chat-inner\s+\.bubble-card\s+\.card-header/.test(fixed)) return fixed;
        if (fixed.indexOf('.nano-chat-inner .bubble') !== -1) {
            fixed = fixed.replace(/(\.nano-chat-inner\s+\.bubble\s*\{[^}]*?)padding\s*:\s*7px\s+16px\s*;/m, '$1padding: 6px 11px;');
            fixed = fixed.replace(/(\.nano-chat-inner\s+\.bubble\s*\{[^}]*?)border-radius\s*:\s*22px\s*;/m, '$1border-radius: 15px;');
            fixed = fixed.replace(/(\.nano-chat-inner\s+\.bubble\s*\{[^}]*?)font-size\s*:\s*15px\s*;/m, '$1font-size: 14px;');
        }
        if (fixed.indexOf('.nano-chat-inner .message-content') !== -1) {
            fixed = fixed.replace(/(\.nano-chat-inner\s+\.message-content\s*\{[^}]*?)max-width\s*:\s*78%\s*;/m, '$1max-width: 64%;');
        }
        if (fixed !== css) {
            try {
                localStorage.setItem('beautify_chat_v2', fixed);
                localStorage.setItem('beautify_chat', fixed);
            } catch (e) {}
        }
        return fixed;
    }

    // 全局模板里给 index 用的「html,body 锁定滚动」不适合 discover/more 等可滚动页，
    // 这里去掉 html,body 上的 position:fixed / overflow:hidden / top / left，避免这些页面无法滑动。
    // index 自身的 CSS 已经有锁定规则，因此移除后 index 表现不变。
    function unlockScrollCss(css) {
        if (!css) return css;
        return css.replace(/(html\s*,\s*body\s*\{)([\s\S]*?)(\})/gi, function (m, head, body, tail) {
            var cleaned = body
                .replace(/position\s*:\s*fixed\s*;?/gi, '')
                .replace(/overflow(?:-[xy])?\s*:\s*hidden\s*;?/gi, '')
                .replace(/(^|\n)\s*top\s*:\s*0(?:px)?\s*;?/gi, '$1')
                .replace(/(^|\n)\s*left\s*:\s*0(?:px)?\s*;?/gi, '$1');
            return head + cleaned + tail;
        });
    }

    // ---- 字体 ----
    // Cloudflare 字体代理：可在控制台执行
    //   localStorage.setItem('nano_cf_font_proxy', 'https://你的worker.workers.dev/?url=')
    // 或设置 window.NANO_CF_FONT_PROXY 覆盖。留空时自动使用公共 Cloudflare CORS 代理。
    function getCfFontProxy() {
        try {
            if (window.NANO_CF_FONT_PROXY) return String(window.NANO_CF_FONT_PROXY);
            var v = localStorage.getItem('nano_cf_font_proxy');
            if (v) return String(v);
        } catch (e) {}
        return '';
    }
    function fontProxyList(raw) {
        var u = String(raw || '').trim();
        if (!/^https?:/i.test(u)) return [];
        var enc = encodeURIComponent(u);
        var out = [];
        var custom = getCfFontProxy();
        if (custom) out.push(custom.indexOf('{url}') !== -1 ? custom.replace('{url}', enc) : custom + enc);
        out.push('https://test.cors.workers.dev/?' + u);
        out.push('https://cors.isomorphic-git.org/' + u);
        out.push('https://api.allorigins.win/raw?url=' + enc);
        out.push('https://corsproxy.io/?url=' + enc);
        out.push('https://api.codetabs.com/v1/proxy?quest=' + enc);
        return out.filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    }
    function normalizeFontUrl(raw) {
        var u = String(raw || '').trim();
        if (!u) return u;
        if (/^\/\//.test(u)) u = 'https:' + u;
        var gh = u.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)$/i);
        if (gh) u = 'https://raw.githubusercontent.com/' + gh[1] + '/' + gh[2] + '/' + gh[3] + '/' + gh[4];
        u = u.replace(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/raw\//i, 'https://raw.githubusercontent.com/$1/$2/');
        return u;
    }
    function fontFormatFor(source) {
        var s = String(source || '').toLowerCase().split(/[?#]/)[0];
        if (/\.woff2$/.test(s)) return 'woff2';
        if (/\.woff$/.test(s)) return 'woff';
        if (/\.(otf|tof)$/.test(s)) return 'opentype';
        if (/\.ttf$/.test(s)) return 'truetype';
        if (/\.ttc$/.test(s) || /\.otc$/.test(s)) return '';
        if (/\.eot$/.test(s)) return 'embedded-opentype';
        if (/\.svg$/.test(s)) return 'svg';
        // 无扩展名/CDN 链接不写 format()，让浏览器自行嗅探
        return '';
    }

    var _fontBlobUrl = null;
    function blobUrlFromData(data) {
        try {
            if (!data) return '';
            if (_fontBlobUrl) {
                try { URL.revokeObjectURL(_fontBlobUrl); } catch (e) {}
                _fontBlobUrl = null;
            }
            var blob = (typeof Blob !== 'undefined' && data instanceof Blob) ? data : new Blob([data]);
            _fontBlobUrl = URL.createObjectURL(blob);
            return _fontBlobUrl;
        } catch (e) { return ''; }
    }

    // 从配置里解析出可用的字体 src（文件字体优先用内存/IDB 数据转 blob URL，避免 localStorage 配额）
    function resolveFontSrc(cfg) {
        if (!cfg) return '';
        if (cfg.type === 'file') {
            if (cfg.data) {
                var u = blobUrlFromData(cfg.data);
                if (u) return u;
            }
            if (cfg.base64) {
                var fmt = cfg.format || fontFormatFor(cfg.source || cfg.name) || 'truetype';
                var ext = (fmt === 'woff2') ? 'woff2' : (fmt === 'woff') ? 'woff' : (fmt === 'opentype') ? 'otf' : 'ttf';
                return 'data:font/' + ext + ';base64,' + cfg.base64;
            }
            return '';
        }
        if (cfg.type === 'url' && cfg.source) return normalizeFontUrl(cfg.source).replace(/"/g, '\\"');
        return '';
    }

    // 收集可用的字体源：直接地址 + 允许跨域的代理兜底。
    // iOS Safari 对跨域 Web 字体严格执行 CORS，直接挂 .ttf/.otf 链接常被静默丢弃回退到系统字体；
    // 在 @font-face 的 src 列表里追加带 CORS 头的代理地址，浏览器会按顺序自动回退。
    function fontSrcCandidates(cfg) {
        var out = [];
        function add(u, f) {
            u = String(u == null ? '' : u).trim();
            if (!u) return;
            u = u.replace(/"/g, '\\"');
            for (var i = 0; i < out.length; i++) { if (out[i].url === u) return; }
            out.push({ url: u, format: f || '' });
        }
        if (!cfg) return out;
        if (cfg.type === 'file') {
            var fs = resolveFontSrc(cfg);
            if (fs) add(fs, cfg.format || fontFormatFor(cfg.source || cfg.name));
            return out;
        }
        if (cfg.type === 'url' && cfg.source) {
            var norm = normalizeFontUrl(cfg.source);
            if (cfg.__resolved) add(cfg.__resolved, fontFormatFor(cfg.__resolved));
            add(norm, cfg.format || fontFormatFor(norm));
            // https 页面里 http 字体属混合内容，会被浏览器拦掉：补一个 https 升级候选
            if (/^http:\/\//i.test(norm) && location.protocol === 'https:') {
                add(norm.replace(/^http:\/\//i, 'https://'), fontFormatFor(norm));
            }
            if (/^https?:/i.test(norm)) {
                fontProxyList(norm).forEach(function (p) { add(p, ''); });
            }
        }
        return out;
    }

    // 全站强制字体：除图标(i / svg / .fa-* 图标元素)外所有元素都换字体。
    // 用 :root * 提高优先级，确保能覆盖各页面类选择器自带的 font-family（含 !important）。
    function forceFontCss(familyToken, size) {
        var stack = familyToken + ',-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Helvetica Neue","PingFang SC",Arial,sans-serif';
        return 'html,body{font-family:' + stack + ' !important;}' +
            '*:not(i):not(svg){font-family:' + stack + ' !important;}' +
            ':root *:not(i):not(svg):not([class*="fa-"]){font-family:' + stack + ' !important;}' +
            ':root{--iv-sans:' + stack + ';--iv-serif:' + stack + ';}' +
            'html{font-size:' + size + 'px;}';
    }
    function buildFontCss(cfg) {
        if (!cfg) return '';
        var size = (cfg.size && cfg.size > 0) ? cfg.size : 16;
        // CSS 链接 / 粘贴 CSS 的字体：外部已提供 @font-face，直接使用它的字体族名
        if (cfg.cssFamily) {
            return forceFontCss('"' + String(cfg.cssFamily).replace(/"/g, '') + '"', size);
        }
        var cands = fontSrcCandidates(cfg);
        if (!cands.length) return '';
        var family = 'NanoBeautifyFont';
        var srcPart = cands.map(function (c) {
            return 'url("' + c.url + '")' + (c.format ? ' format("' + c.format + '")' : '');
        }).join(',');
        return '@font-face{font-family:"' + family + '";src:' + srcPart + ';font-display:swap;}' +
            forceFontCss('"' + family + '"', size);
    }
    // 外部字体 CSS：外链样式表 或 直接注入的 @font-face CSS
    function ensureFontLink(href) {
        try {
            var l = document.getElementById('nano-beautify-font-link');
            if (!href) { if (l) l.remove(); return; }
            if (!l) {
                l = document.createElement('link');
                l.id = 'nano-beautify-font-link'; l.rel = 'stylesheet';
                (document.head || document.documentElement).appendChild(l);
            }
            if (l.getAttribute('href') !== href) l.setAttribute('href', href);
        } catch (e) {}
    }
    function ensureFontRawCss(css) {
        try {
            var s = document.getElementById('nano-beautify-font-css');
            if (!css) { if (s) s.remove(); return; }
            if (!s) {
                s = document.createElement('style');
                s.id = 'nano-beautify-font-css';
                (document.head || document.documentElement).appendChild(s);
            }
            s.textContent = css;
        } catch (e) {}
    }
    function isCssFontUrl(u) {
        var s = String(u || '');
        return /fonts\.googleapis\.com/i.test(s) || /use\.typekit\.net/i.test(s) ||
            /fonts\.cdnfonts\.com/i.test(s) || /fontlibrary\.org/i.test(s) ||
            /\.css(?:[?#]|$)/i.test(s) || /[?&]family=/i.test(s);
    }
    function fetchTextSmart(raw) {
        var u = normalizeFontUrl(raw);
        var cands = [u].concat(fontProxyList(u));
        var i = 0;
        function next() {
            if (i >= cands.length) return Promise.reject(new Error('字体 CSS 无法读取'));
            var c = cands[i++];
            return fetch(c, { mode: 'cors', credentials: 'omit' }).then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.text();
            }).then(function (txt) {
                if (txt && /@font-face|font-family\s*:/i.test(txt)) return txt;
                return next();
            }).catch(next);
        }
        return next();
    }
    function rewriteCssFontUrls(css, baseUrl) {
        function abs(u) {
            u = String(u || '').trim();
            if (!u || /^data:|^blob:/i.test(u)) return u;
            if (/^\/\//.test(u)) u = 'https:' + u;
            if (/^https?:/i.test(u)) return u;
            try { return new URL(u, baseUrl).href; } catch (e) { return u; }
        }
        return String(css || '').replace(/@font-face\s*\{[\s\S]*?\}/gi, function (block) {
            return block.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)(\s*format\(\s*(['"]?)([^'")]+)\4\s*\))?/gi,
                function (m, q, raw, fmtPart, fq, fmt) {
                    var u = abs(raw);
                    if (!/^https?:/i.test(u)) return m;
                    var list = [u].concat(fontProxyList(u));
                    var seen = {};
                    return list.map(function (x) {
                        if (!x || seen[x]) return '';
                        seen[x] = 1;
                        return 'url("' + String(x).replace(/"/g, '\\"') + '")' + (fmt ? ' format("' + fmt + '")' : '');
                    }).filter(Boolean).join(',');
                });
        });
    }

    // Google Fonts 的 css2 链接本身不是字体文件，先解析出真正的 woff2 地址再注入
    var _gfontResolving = {};
    function resolveGoogleFontFile(url) {
        try {
            return fetch(url, { mode: 'cors', credentials: 'omit' })
                .then(function (r) { return r.text(); })
                .then(function (css) {
                    var m = String(css).match(/url\((https?:[^)'"]+?\.(?:woff2|woff|ttf|otf)[^)'"]*)\)/i);
                    return (m && m[1]) || '';
                })
                .catch(function () { return ''; });
        } catch (e) { return Promise.resolve(''); }
    }

    function applyFontCfg(cfg) {
        if (!cfg) {
            applyStyle('nano-beautify-font', '');
            ensureFontLink('');
            ensureFontRawCss('');
            return;
        }
        // 粘贴的 @font-face CSS / 外链字体样式表：直接注入，并用它的字体族名
        ensureFontRawCss((cfg.type === 'url' && cfg.cssText) ? cfg.cssText : '');
        ensureFontLink((cfg.type === 'url' && cfg.cssFamily && cfg.source && !cfg.cssText && /^(https?:|data:)/i.test(cfg.source)) ? cfg.source : '');
        applyStyle('nano-beautify-font', buildFontCss(cfg));
        // 外链字体 CSS：用 Cloudflare 代理拉取一次，补全相对地址 + 字体文件代理候选；
        // 成功后就替换掉原始 <link>，避免原站 CORS / 防盗链导致字体静默失败。
        if (cfg.type === 'url' && cfg.cssFamily && cfg.source && !cfg.cssText && isCssFontUrl(cfg.source)) {
            fetchTextSmart(cfg.source).then(function (text) {
                if (!text) return;
                ensureFontRawCss(rewriteCssFontUrls(text, cfg.source));
                ensureFontLink('');
            }).catch(function () {});
        }
        // 兼容旧配置：Google Fonts CSS 链接在无 cssFamily 时，解析成真实字体文件后重新注入
        if (!cfg.cssFamily && cfg.type === 'url' && cfg.source &&
            /fonts\.googleapis\.com\/css/i.test(cfg.source) && !cfg.__resolved && !_gfontResolving[cfg.source]) {
            _gfontResolving[cfg.source] = true;
            resolveGoogleFontFile(cfg.source).then(function (fileUrl) {
                if (!fileUrl) return;
                var next = {};
                for (var k in cfg) { if (Object.prototype.hasOwnProperty.call(cfg, k)) next[k] = cfg[k]; }
                next.__resolved = fileUrl;
                applyStyle('nano-beautify-font', buildFontCss(next));
            });
        }
    }

    // 同步读取（URL 字体存 localStorage；文件字体不走 localStorage，避免超配额）
    function readFontCfgSync() {
        try {
            var raw = localStorage.getItem('beautify_font');
            if (raw) {
                var o = JSON.parse(raw);
                if (o && o.family === 'NanoBeautifyFont' && o.type === 'url' && o.source) return o;
            }
        } catch (e) {}
        return null;
    }

    // 从 beautify 的 IndexedDB 读取已保存字体（文件字体数据较大，用 IDB 持久化）
    function loadFontCfgFromIDB() {
        return new Promise(function(resolve) {
            try {
                var req = indexedDB.open('BeautifyAppDB', 1);
                req.onupgradeneeded = function(e) {
                    try {
                        var d = e.target.result;
                        if (!d.objectStoreNames.contains('presets')) d.createObjectStore('presets', { keyPath: 'id', autoIncrement: true });
                        if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'key' });
                    } catch (e2) {}
                };
                req.onsuccess = function(e) {
                    var db = e.target.result;
                    var get;
                    try { get = db.transaction('settings', 'readonly').objectStore('settings').get('appliedFont'); }
                    catch (e2) { resolve(null); return; }
                    get.onsuccess = function() {
                        var v = get.result ? get.result.value : null;
                        if (v && v.name) {
                            resolve({
                                family: 'NanoBeautifyFont',
                                name: v.name,
                                source: v.source || '',
                                type: v.type || '',
                                size: v.size || 16,
                                format: fontFormatFor(v.source || v.name),
                                cssFamily: v.cssFamily || '',
                                cssText: v.cssText || '',
                                data: v.data || null
                            });
                        } else resolve(null);
                    };
                    get.onerror = function() { resolve(null); };
                };
                req.onerror = function() { resolve(null); };
            } catch (e) { resolve(null); }
        });
    }

    // 兜底：如果 localStorage 里的美化被清掉/写入失败，但 IndexedDB 里还存着「已应用」的 CSS，
    // 就把它补回 localStorage 并重新应用，避免返回/重进后样式恢复初始。
    function readBeautyAppliedFromIDB(key) {
        return new Promise(function (resolve) {
            try {
                var req = indexedDB.open('BeautifyAppDB', 1);
                req.onupgradeneeded = function (e) {
                    try {
                        var d = e.target.result;
                        if (!d.objectStoreNames.contains('presets')) d.createObjectStore('presets', { keyPath: 'id', autoIncrement: true });
                        if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'key' });
                    } catch (e2) {}
                };
                req.onsuccess = function (e) {
                    var db = e.target.result, get;
                    try { get = db.transaction('settings', 'readonly').objectStore('settings').get(key); }
                    catch (e2) { resolve(''); return; }
                    get.onsuccess = function () { resolve(get.result && typeof get.result.value === 'string' ? get.result.value : ''); };
                    get.onerror = function () { resolve(''); };
                };
                req.onerror = function () { resolve(''); };
            } catch (e) { resolve(''); }
        });
    }
    var _appliedSyncing = false;
    function syncAppliedFromIDB() {
        if (_appliedSyncing) return;
        if (readCss('beautify_chat_v2') && readCss('beautify_global_v2')) return;
        _appliedSyncing = true;
        var jobs = [];
        if (!readCss('beautify_chat_v2')) {
            jobs.push(readBeautyAppliedFromIDB('applied_chat').then(function (v) {
                if (!v) return;
                try { localStorage.setItem('beautify_chat_v2', v); localStorage.setItem('beautify_chat', v); } catch (e) {}
                try { applyChatCss(migrateChatCss(cssOnly(v))); runBeautifyJs('chat', v); } catch (e) {}
            }));
        }
        if (!readCss('beautify_global_v2')) {
            jobs.push(readBeautyAppliedFromIDB('applied_global').then(function (v) {
                if (!v) return;
                try { localStorage.setItem('beautify_global_v2', v); localStorage.setItem('beautify_global', v); } catch (e) {}
                try { applyGlobalCss(unlockScrollCss(migrateGlobalCss(cssOnly(v)))); runBeautifyJs('global', v); } catch (e) {}
            }));
        }
        Promise.all(jobs).catch(function () {}).then(function () { _appliedSyncing = false; });
    }

    // ---- 启动时按已保存配置注入 ----
    // 只读取「用户显式点过 应用」的 v2 键，避免首次进入美化页时默认模板就覆盖全部 UI
    function applySaved() {
        // 新页面只同步字体，不套用旧聊天/全局美化 CSS，避免破坏新设计
        if (window.__NANO_FONT_ONLY) {
            var _fOnly = readFontCfgSync();
            if (_fOnly) {
                applyFontCfg(_fOnly);
            } else {
                loadFontCfgFromIDB().then(function (c) { if (c) applyFontCfg(c); });
            }
            return;
        }
        // 先聊天后全局：全局样式永远最后注入，保证“全局”能覆盖所有页面（含聊天）
        try {
            applyChatCss(migrateChatCss(cssOnly(readCss('beautify_chat_v2'))));
            runBeautifyJs('chat', readCss('beautify_chat_v2'));
        } catch (e) {}
        try {
            // 配置里有头像框就用「原始配置重建」（避免美化页存下来的旧 CSS 字符串/旧选择器不生效）；
            // 配置里没有框则沿用已保存的 CSS 字符串。
            var _acfg = null;
            try { _acfg = JSON.parse(localStorage.getItem('beautify_chat_avatar_cfg') || 'null'); } catch (e) {}
            var _avCss = (_acfg && String(_acfg.frameUrl || '').trim())
                ? buildAvatarCssFromCfg()
                : readCss('beautify_chat_avatar');
            applyChatAvatarCss(_avCss);
        } catch (e) {}
        try {
            applyGlobalCss(unlockScrollCss(migrateGlobalCss(cssOnly(readCss('beautify_global_v2')))));
            runBeautifyJs('global', readCss('beautify_global_v2'));
        } catch (e) {}
        try {
            applyBottomShift(readCss('nanoBottomShift'));
        } catch (e) {}
        try {
            applyTopShift(readCss('nanoTopShift'));
        } catch (e) {}
        try {
            applyFlushFix();
        } catch (e) {}
        // 最后再确保头像样式在最后（有些注入会插到它后面）
        try { bringAvatarToFront(); } catch (e) {}
        try { void (document.body && document.body.offsetHeight); } catch (e) {}
        // 给每个头像插入头像框叠加元素（行内 !important），并监听后续新消息
        try { applyFrameElements(); watchAvatars(); } catch (e) {}
        var cfg = readFontCfgSync();
        if (cfg) {
            applyFontCfg(cfg);
        } else {
            loadFontCfgFromIDB().then(function(c) { if (c) applyFontCfg(c); });
        }
        // localStorage 缺失时，从美化 App 的 IndexedDB 兜底恢复「已应用」的美化
        try { syncAppliedFromIDB(); } catch (e) {}
    }

    // ---- 全局底栏位置偏移（“其他”页的底栏位置滑杆，作用于所有页面的底栏） ----
    var TOP_SHIFT_SEL = '.top-bar,.navbar,.nav-bar,.memory-topbar,.topbar,.page-topbar,.overlay-header,.status';
    // 底栏位置滑杆只作用于「聊天/群聊/线下」这几种以 chat-inner、线下为锚点的底栏；
    // 其它 App（ins / moments / halo 等的输入栏）不再跟着一起上下移动。
    var BOTTOM_SHIFT_SEL = '.bottom-bar,footer.bottom,.bottom';
    // index 外壳自己的底栏（.bottom-actions）保持贴底不动：上调后它下面会露出
    // .app 的透明区域，出现一条与主题不符的空隙。其它页面（含线下的 .bottom、
    // chat_inner/groups 的 .bottom-bar）照常跟随「底栏位置」上调。
    var BOTTOM_SHIFT_SEL_NO_ACTIONS = '.bottom-bar,footer.bottom,.bottom';
    function applyShift(kind, px) {
        var key = kind === 'top' ? 'nanoTopShift' : 'nanoBottomShift';
        var v = parseInt(px, 10);
        if (isNaN(v)) { try { v = parseInt(localStorage.getItem(key) || '0', 10) || 0; } catch (e) { v = 0; } }
        var varName = kind === 'top' ? '--nano-top-shift' : '--nano-bottom-shift';
        var isIndexShell = !!(document.body && document.body.classList.contains('nano-index'));
        var sel = kind === 'top' ? TOP_SHIFT_SEL
            : (isIndexShell ? BOTTOM_SHIFT_SEL_NO_ACTIONS : BOTTOM_SHIFT_SEL);
        applyStyle('nano-' + kind + '-shift',
            ':root{' + varName + ':' + v + 'px;}' +
            sel + '{transform:translateY(var(' + varName + ',0px)) !important;}' +
            // 底栏上移（负值）时会给聊天输入栏留出动态底部留白，避免它压住最后几条气泡
            (kind === 'bottom'
                ? ':root{--nano-bottom-overlap:' + (v < 0 ? -v : 0) + 'px;}' +
                  '.nano-chat-inner .message-scroll,.nano-groups .message-scroll{padding-bottom:calc(22px + var(--nano-bottom-overlap,0px)) !important;}'
                : ''));
    }
    function applyTopShift(px) { applyShift('top', px); }
    function applyBottomShift(px) { applyShift('bottom', px); }

    // ---- 强制所有底栏贴底（不吃缓存：始终注入，覆盖旧的页面 CSS / 旧预设） ----
    var BOTTOM_BAR_PAD = 'calc(6px + max(12px,var(--nano-safe-bottom,env(safe-area-inset-bottom,0px))))';
    var BOTTOM_FLUSH_FIX =
        'html .bottom-actions,html .nano-index .bottom-actions{bottom:20px !important;padding-bottom:0 !important;}' +
        // 只兜底底部安全区留白，不要强制 background/border/shadow —— 否则用户无法给顶栏/底栏设白底
        // 所有 App 的底栏统一成同一高度基准（以 chat-inner / 线下为锚点），
        // 比原来 chat-inner 的 48px 略低一点，其它 App 相应上移或不变。
        'html .bottom-bar,html .nano-chat-inner .bottom-bar,html .nano-groups .bottom-bar,' +
        'html footer.bottom,html .bottom,' +
        'html .dm-composer,html .mm-viewer-bar,html .comment-input,html .chat-input-bar{' +
        'padding-bottom:' + BOTTOM_BAR_PAD + ' !important;}' +
        // 键盘弹出时去掉底部安全区留白，让输入栏直接贴着键盘上沿，不在中间留一条空白
        'html.keyboard-open .bottom-bar,html.keyboard-open .nano-chat-inner .bottom-bar,' +
        'html.keyboard-open .nano-groups .bottom-bar,html.keyboard-open footer.bottom,html.keyboard-open .bottom,' +
        'html.keyboard-open .dm-composer,html.keyboard-open .mm-viewer-bar,' +
        'html.keyboard-open .comment-input,html.keyboard-open .chat-input-bar{' +
        'padding-bottom:6px !important;}' +
        // 底栏改为悬浮在页面之上：留白放进各页面自身，避免外壳出现与主题不符的白边
        'html body.nano-chat .app-content,html body.nano-chat .container,html body.nano-chat #chatList,html body.nano-chat .chat-list{padding-bottom:96px !important;}' +
        'html body.nano-api .app-content,html body.nano-api .container,html body.nano-more .app-content,html body.nano-more .container,html body.nano-discover .app-content,html body.nano-discover .container{padding-bottom:96px !important;}';
    function applyFlushFix() { applyStyle('nano-flush-fix', BOTTOM_FLUSH_FIX); }

    // ---- 键盘抬升（所有页面通用）----
    // 外壳 index.html 会把键盘高度 --nano-kb + .keyboard-open 同步到每个 iframe；
    // 这里再补一层：各页面常见的底部输入栏在键盘弹出时整体上移，避免打字看不到字。
    // 底栏位置滑杆现在只作用于聊天/线下，其它 App 的输入栏不再叠加 --nano-bottom-shift
    var KEYBOARD_CSS =
        'html.keyboard-open .dm-composer,' +
        'html.keyboard-open .live-composer,' +
        'html.keyboard-open .comment-input,' +
        'html.keyboard-open .chat-input-bar,' +
        'html.keyboard-open .bottom-area,' +
        'html.keyboard-open .vc-input-area,' +
        'html.keyboard-open .ins-emoji-panel{' +
        'transform:translateY(calc(-1 * var(--nano-kb,0px))) !important;' +
        'transition:transform .18s ease;}' +
        'html.keyboard-open footer.bottom{' +
        'transform:translateY(calc(var(--nano-bottom-shift,0px) - var(--nano-kb,0px))) !important;' +
        'transition:transform .18s ease;}';
    var __nanoKbBaseH = 0;
    try { __nanoKbBaseH = Math.max(0, window.innerHeight || 0); } catch (e) {}
    function nanoApplyKeyboard(kb, fromParent) {
        try {
            var v = Math.max(0, Math.round(Number(kb) || 0));
            // 安卓部分 WebView 会同时缩短布局视口：独立打开（非 iframe）时，
            // 100% 已经等于键盘上沿，再整体上移一次就会多出一条空白。
            // iframe 里父页面传下来的值已经处理过，这里不再重复扣。iOS 保持原样。
            if (!fromParent && /Android/i.test(navigator.userAgent || '') && __nanoKbBaseH > 0) {
                var layoutKb = Math.max(0, Math.round(__nanoKbBaseH - (window.innerHeight || 0)));
                v = Math.max(0, v - Math.min(v, layoutKb));
            }
            document.documentElement.style.setProperty('--nano-kb', v + 'px');
            document.documentElement.classList.toggle('keyboard-open', v > 0.5);
        } catch (e) {}
    }
    try { applyStyle('nano-keyboard-style', KEYBOARD_CSS); } catch (e) {}
    window.addEventListener('message', function (e) {
        var d = e.data;
        if (d && d.type === 'nanoKeyboard') nanoApplyKeyboard(d.kb, true);
    });
    // 独立打开（不在外壳里）时自行检测，iframe 内以父页面同步的值为准
    if (window.parent === window) {
        try {
            if (window.visualViewport) {
                var _vv = window.visualViewport;
                var _kbBaseH = 0;
                var _kbUpd = function () {
                    try {
                        // iOS 弹键盘时 innerHeight 会一起变小，用无键盘基准高度相减才准
                        _kbBaseH = Math.max(_kbBaseH, window.innerHeight || 0, _vv.height || 0);
                        __nanoKbBaseH = Math.max(__nanoKbBaseH, _kbBaseH);
                        nanoApplyKeyboard(_kbBaseH - _vv.height - _vv.offsetTop, false);
                    } catch (e) {}
                };
                _vv.addEventListener('resize', _kbUpd);
                _vv.addEventListener('scroll', _kbUpd);
                window.addEventListener('orientationchange', function () { _kbBaseH = 0; setTimeout(_kbUpd, 350); });
                setTimeout(_kbUpd, 300);
            }
        } catch (e) {}
    }

    // ---- 供父框架 / 其它模块调用的入口 ----
    window.__nanoAppearance = {
        applyMessage: function(data) {
            if (!data || !data.type) return;
            if (data.type === 'beautify:apply') {
                if (data.target === 'global') { applyGlobalCss(unlockScrollCss(cssOnly(data.css || ''))); runBeautifyJs('global', data.css || ''); }
                else if (data.target === 'chat') { applyChatCss(cssOnly(data.css || '')); runBeautifyJs('chat', data.css || ''); }
                else if (data.target === 'chat-avatar') applyChatAvatarCss(data.css || '');
            } else if (data.type === 'beautify:font') {
                applyFontCfg(data.cfg || null);
            } else if (data.type === 'nanoTopShift') {
                applyTopShift(data.value);
            } else if (data.type === 'nanoBottomShift') {
                applyBottomShift(data.value);
            } else if (data.type === 'beautify:refresh') {
                applySaved();
            }
        },
        applyTopShift: applyTopShift,
        applyBottomShift: applyBottomShift,
        applySaved: applySaved
    };

    window.addEventListener('message', function(e) {
        var d = e.data;
        if (!d || !d.type) return;
        if (window.__NANO_FONT_ONLY && d.type !== 'beautify:font') return;
        if (window.__nanoAppearance) {
            window.__nanoAppearance.applyMessage(d);
        }
    });

    // 跨标签页/跨 iframe 字体同步：美化页写入 beautify_font 后，其他页面立即跟随
    window.addEventListener('storage', function(e) {
        if (!e || e.key !== 'beautify_font') return;
        try { applyFontCfg(readFontCfgSync()); } catch (err) {}
    });

    // 页面重新可见 / 从后台恢复时，重读一次已保存美化，确保头像框等样式不丢
    window.addEventListener('pageshow', function() { try { applySaved(); } catch (e) {} });
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) { try { applySaved(); } catch (e) {} }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applySaved);
    } else {
        applySaved();
    }
})();
