/* ============================================================
   swipe-back.js — iOS 风格「左边缘右滑返回」（基础版，无跟手动画）

   手指从左边缘向右滑 → 等同于点击当前页面自带的返回按钮。
   完全复用页面自己的点击逻辑（element.click()），不使用 history.back()。

   优先级：
     1. 有弹窗/浮层打开 → 先点可见的 [data-close]（关闭按钮统一加 data-close）
     2. 没有弹窗 → 点可见的 [data-back]（页面返回按钮）
     3. 页面自己没有返回按钮（如首页）→ 在 iframe 里时通知主框架点它自己的返回栏

   判定：
     - 起点 clientX < 30
     - 松手时横向位移 > 70px 且 > 纵向位移 * 2
     - touchmove 用 { passive: false }，确认是边缘右滑后 preventDefault()
     - 焦点在 input / textarea / 可编辑元素时不触发
   ============================================================ */
(function () {
    'use strict';

    var EDGE_PX = 30;      // 起点必须落在屏幕左侧 30px 内
    var MIN_X_PX = 70;     // 横向位移阈值
    var X_RATIO = 2;       // 横向位移必须大于纵向位移的 2 倍

    var startX = 0, startY = 0;
    var lastX = 0, lastY = 0;
    var tracking = false;

    // 必须真正落在可视区内：页面常用 transform 把浮层移出屏幕来隐藏，
    // 这种元素的 rect 仍然有宽高，只判断尺寸会误判为可见。
    function inViewport(r) {
        var vw = window.innerWidth || 1, vh = window.innerHeight || 1;
        return r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh;
    }
    // 可见 = 自身尺寸正常 + 在可视区内 + 自身及所有祖先都不透明 + 自身可点击。
    // 页面常用 opacity:0 隐藏浮层（此时子按钮自身 opacity 仍是 1），
    // 只看自身 opacity 会点到隐藏的关闭/返回按钮。
    function isVisible(el) {
        if (!el || !el.getBoundingClientRect) return false;
        var r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return false;
        if (!inViewport(r)) return false;
        var node = el;
        for (var i = 0; node && node.nodeType === 1 && i < 40; i++, node = node.parentElement) {
            var cs = window.getComputedStyle(node);
            if (!cs) return false;
            if (cs.display === 'none' || cs.visibility === 'hidden') return false;
            // 只有元素自身、或“浮层类”祖先（fixed/absolute）的 opacity:0 才算隐藏；
            // 普通布局容器的淡入动画不应把返回按钮判定为不可见，否则会误退回上一个页面。
            if (parseFloat(cs.opacity || '1') === 0 && (node === el || cs.position === 'fixed' || cs.position === 'absolute')) return false;
            if (node === el && cs.pointerEvents === 'none') return false;
        }
        return true;
    }

    // 焦点在输入框里时不抢手势
    function isEditing() {
        var ae = document.activeElement;
        if (!ae) return false;
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return true;
        return !!ae.isContentEditable;
    }

    // 可见的关闭按钮：[data-close]（取 DOM 里最后一个 = 最上层）
    function findClose() {
        var list = document.querySelectorAll('[data-close]');
        var hit = null;
        for (var i = 0; i < list.length; i++) {
            if (isVisible(list[i])) hit = list[i];
        }
        return hit;
    }

    // 可见的返回按钮：[data-back]（取 DOM 里最后一个 = 最上层）
    function findBack() {
        var list = document.querySelectorAll('[data-back]');
        var hit = null;
        for (var i = 0; i < list.length; i++) {
            if (isVisible(list[i])) hit = list[i];
        }
        return hit;
    }

    // 当前最上层的整屏浮层（弹窗/抽屉/sheet…），用于避免“点穿浮层误触返回”
    var LAYER_NAME = /(modal|overlay|popup|sheet|dialog|alert|backdrop|drawer|fullscreen|mask|menu|panel)/i;
    function findLayer() {
        var nodes = document.body ? document.body.querySelectorAll('*') : [];
        var layer = null;
        for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            var tag = el.tagName;
            if (tag === 'IFRAME' || tag === 'SCRIPT' || tag === 'STYLE') continue;
            if (!LAYER_NAME.test((el.className || '') + ' ' + (el.id || ''))) continue;
            var cs = window.getComputedStyle(el);
            if (!cs) continue;
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
            if (parseFloat(cs.zIndex || '0') < 10) continue;
            // opacity:0 / pointer-events:none 的浮层是“隐藏但占位”的幽灵层，不能算打开
            if (parseFloat(cs.opacity || '1') === 0) continue;
            if (cs.pointerEvents === 'none') continue;
            var r = el.getBoundingClientRect();
            if (r.width < window.innerWidth * 0.6 || r.height < window.innerHeight * 0.4) continue;
            if (!inViewport(r)) continue;
            layer = el;
        }
        return layer;
    }

    function contains(parent, child) {
        return !!(parent && child && (parent === child || parent.contains(child)));
    }

    function trigger() {
        // 1) 先关弹窗
        var close = findClose();
        if (close) { close.click(); return; }

        // 2) 页面自定义的内部返回（SPA 子页 / 编辑态）：
        //    页面可用 window.__nanoInternalBack = function(){ ...; return true; } 接管，
        //    返回 true 表示已处理，返回 false 则继续走后面的通用逻辑。
        if (typeof window.__nanoInternalBack === 'function') {
            try { if (window.__nanoInternalBack() === true) return; } catch (e) {}
        }

        // 3) 再点本页返回按钮
        var layer = findLayer();
        var back = findBack();
        if (back && (!layer || contains(layer, back))) { back.click(); return; }

        // 4) 交给宿主页面处理（index.html 监听此事件：关闭浮层 / 切回聊天页）
        var handledByHost = false;
        try {
            var ev = new CustomEvent('nano:swipe-back-fallback', { cancelable: true });
            handledByHost = !document.dispatchEvent(ev); // preventDefault 了就代表宿主已处理
        } catch (e) {}
        if (handledByHost) return;

        // 有浮层但找不到关闭/返回按钮：什么都不做，避免误触返回
        if (layer) return;

        // 5) 本页没有返回按钮（如首页）：交给主框架的返回栏（index.html 里就是 #overlayBack）
        try {
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({ type: 'swipeBack' }, '*');
            }
        } catch (e) {}
    }

    // 宿主(index.html)在「边缘手势落在父文档」时会发来 nanoRequestBack，
    // 让当前页自己先处理一次返回；处理结果回报给宿主决定是否收起整层。
    function handleBackRequest() {
        var handled = false;
        try {
            var close = findClose();
            if (close) { close.click(); handled = true; }
        } catch (e) {}
        if (!handled && typeof window.__nanoInternalBack === 'function') {
            try { if (window.__nanoInternalBack() === true) handled = true; } catch (e) {}
        }
        if (!handled) {
            try { var b = findBack(); if (b) { b.click(); handled = true; } } catch (e) {}
        }
        try {
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({ type: handled ? 'nanoBackHandled' : 'nanoBackUnhandled' }, '*');
            }
        } catch (e) {}
    }
    window.addEventListener('message', function (e) {
        var d = e.data;
        if (d && d.type === 'nanoRequestBack') { try { handleBackRequest(); } catch (err) {} }
    });


    // ===== 兜住 iOS 系统边缘手势 / 浏览器「返回」=====
    // 不加这层的话：手指停几秒再滑，iOS 会自己执行「返回上一页」（历史后退），
    // 而不是走本页的返回按钮逻辑。这里把历史后退拦下来，改成本页返回按钮逻辑。
    var backGuardBusy = false;
    function installHistoryGuard() {
        try {
            // 只在最外层文档安装这层拦截。
            // iframe 里的页面再 pushState，会把「历史返回」搅乱：
            // 之后页面自己的 history.back() 会先撞到被拦截的假状态，
            // 结果返回到「上一次打开的页面 / about:blank」而不是绑定的目标页。
            if (window.parent !== window) return;
            if (!document.querySelector('[data-back]') && !document.querySelector('[data-close]')) return;
            history.pushState({ nanoBackGuard: 1 }, '');
            window.addEventListener('popstate', function () {
                if (backGuardBusy) return;
                backGuardBusy = true;
                setTimeout(function () { backGuardBusy = false; }, 400);
                try { history.pushState({ nanoBackGuard: 1 }, ''); } catch (e) {}
                try { trigger(); } catch (e) {}
            });
        } catch (e) {}
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', installHistoryGuard);
    } else {
        installHistoryGuard();
    }

    // ===== 边缘右滑手势已停用 =====
    // 之前「起点 <30px + 横向位移」的手势在多数页面不稳定（有输入框、滚动容器、
    // 收藏层时容易误判），已改为由「API 悬浮球 → 环形菜单 → 返回」统一提供返回。
    // 这里保留 trigger / handleBackRequest / 系统返回守卫，供浮层与 iOS 系统返回复用。

    // 便于调试/其它脚本主动触发
    window.__nanoSwipeBack = { trigger: trigger };
})();
